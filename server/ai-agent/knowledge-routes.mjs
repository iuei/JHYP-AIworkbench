/**
 * 知识库管理接口（管理员）：文档列表 / 上传 / 有效期 / 下线 / 删除 / 重建索引 / 纠错反馈闭环。
 *
 * 上传即生效，不做审核流程；三个补偿控制在这里落地：
 *   ① 来源与更新时间强制登记（ai_documents 字段 + 引用面板展示）
 *   ② 有效期 expires_at（到期由权限层的 isDocumentActive 自动判失效）
 *   ③ 纠错反馈闭环（/knowledge/feedback 待处理列表 + 标记已处理）
 */
import express from 'express'
import { AUDIT_ACTIONS, recordAudit } from './audit.mjs'
import { listUnhandledFeedback, markFeedbackHandled } from './conversations.mjs'
import { clientIp, handleAiError, optionalDate, optionalString, parseBatchRequest, parsePageQuery } from './http-utils.mjs'
import {
  KnowledgeValidationError,
  datasetFreshness,
  deactivateDocument,
  deleteDocument,
  extractDocumentText,
  findDocumentById,
  ingestDocument,
  knowledgeFreshness,
  listDocumentChunks,
  listDocuments,
  listVisibleDocuments,
  reactivateDocument,
  rebuildKnowledgeIndex,
  updateDocumentExpiry,
} from './knowledge.mjs'
import { canSeeDocument } from './permissions.mjs'

const MAX_PASTE_LENGTH = 200000
/** 批量动作白名单与单批上限：上限存在的意义是避免一次请求把连接与审计写入拖成"黑洞"。 */
const BATCH_ACTIONS = ['offline', 'online', 'delete']
const MAX_BATCH_SIZE = 200

function resourceId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * 批量操作的单条执行单元：成功写审计并返回标题，失败只返回原因。
 *
 * 刻意**不抛错**：批量里一条不存在/状态已变不应该让其余文档一起失败，
 * 前端需要的是"哪几条成功、哪几条为什么没成"。
 */
async function runBatchDocumentItem({ action, id, actorId, ip }) {
  try {
    if (action === 'offline') {
      const updated = await deactivateDocument({ documentId: id, actorId })
      if (!updated) return { id, ok: false, message: '文档不存在或已下线' }
      await recordAudit({
        actorId,
        action: AUDIT_ACTIONS.docOffline,
        targetType: 'ai_document',
        targetId: id,
        detail: { title: updated.title, via: 'batch' },
        ip,
      })
      return { id, ok: true, title: updated.title, status: 'inactive' }
    }

    if (action === 'online') {
      const updated = await reactivateDocument({ documentId: id })
      if (!updated) return { id, ok: false, message: '文档不存在' }
      await recordAudit({
        actorId,
        action: AUDIT_ACTIONS.docOnline,
        targetType: 'ai_document',
        targetId: id,
        detail: { title: updated.title, expiresAt: updated.expires_at, via: 'batch' },
        ip,
      })
      return { id, ok: true, title: updated.title, status: 'active' }
    }

    const deleted = await deleteDocument(id)
    if (!deleted) return { id, ok: false, message: '文档不存在' }
    await recordAudit({
      actorId,
      action: AUDIT_ACTIONS.docDelete,
      targetType: 'ai_document',
      targetId: id,
      detail: { title: deleted.title, chunkCount: deleted.chunk_count, via: 'batch' },
      ip,
    })
    return { id, ok: true, title: deleted.title, deleted: true }
  } catch (error) {
    return { id, ok: false, message: error instanceof Error ? error.message : '操作失败' }
  }
}

/**
 * 文件名通过 HTTP 头传递，中文名必须先 encodeURIComponent 再发出
 * （HTTP 头不允许非 ASCII 字符）。这里做容错解码，兼容未编码的纯 ASCII 名。
 */
function decodeFileName(value) {
  const text = optionalString(value, { max: 900 })
  if (!text) return null
  try {
    return optionalString(decodeURIComponent(text), { max: 300 })
  } catch {
    return text.slice(0, 300)
  }
}

export function createKnowledgeRouter({ adminGuard }) {
  const router = express.Router()

  router.get('/knowledge/documents', adminGuard, async (req, res, next) => {
    try {
      const { page, pageSize } = parsePageQuery(req.query)
      const result = await listDocuments({
        page,
        pageSize,
        status: optionalString(req.query.status, { max: 20 }),
        sourceType: optionalString(req.query.sourceType, { max: 20 }),
        keyword: optionalString(req.query.keyword, { max: 100 }),
      })
      res.json({
        documents: result.rows.map((row) => ({
          id: row.id,
          title: row.title,
          sourceType: row.source_type,
          sourceRef: row.source_ref,
          docVersion: row.doc_version,
          category: row.category,
          status: row.status,
          effectiveAt: row.effective_at,
          expiresAt: row.expires_at,
          chunkCount: row.chunk_count,
          createdByName: row.created_by_name,
          correctionCount: row.correction_count ?? 0,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.get('/knowledge/documents/:id/chunks', adminGuard, async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '文档参数无效。' })
    try {
      const chunks = await listDocumentChunks(id)
      res.json({
        chunks: chunks.map((chunk) => ({
          id: chunk.id,
          chunkIndex: chunk.chunk_index,
          content: chunk.content,
          tokenCount: chunk.token_count,
          createdAt: chunk.created_at,
        })),
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /*
   * ───────────────── 员工只读：团队知识库（2026-09-18） ─────────────────
   *
   * 「知识库」拆出员工面之后，团队知识库需要一份**只读**的文档视图：
   * 只列生效中的文档、只暴露对外字段、不提供任何写操作。
   *
   * **为什么不给上面的管理接口加 role 分支**：管理列表的响应里带着 `correctionCount`
   * 这类治理口径，同一个 handler 里混两种权限迟早会有人漏判；`/knowledge/public/*`
   * 一望即知是员工面，权限判断只有"登录"这一条（`router.use(requireUser)` 已在
   * `router.mjs` 统一下发），后续加接口时也不容易走错分支。
   */
  router.get('/knowledge/public/documents', async (req, res, next) => {
    try {
      const { page, pageSize } = parsePageQuery(req.query)
      const result = await listVisibleDocuments({
        user: req.user,
        page,
        pageSize,
        sourceType: optionalString(req.query.sourceType, { max: 20 }),
        keyword: optionalString(req.query.keyword, { max: 100 }),
      })
      res.json({
        documents: result.rows.map((row) => ({
          id: row.id,
          title: row.title,
          sourceType: row.source_type,
          docVersion: row.doc_version,
          category: row.category,
          status: row.status,
          effectiveAt: row.effective_at,
          expiresAt: row.expires_at,
          chunkCount: row.chunk_count,
          createdByName: row.created_by_name,
          updatedAt: row.updated_at,
        })),
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /** 团队知识库：文档切片正文（只读）。 */
  router.get(
    '/knowledge/public/documents/:id/chunks',
    async (req, res, next) => {
      const id = resourceId(req.params.id)
      if (!id) return res.status(400).json({ message: '文档参数无效。' })
      try {
        /*
         * 先确认文档存在且**生效中**：只凭 id 就吐切片，等于把已下线文档的正文
         * 继续暴露给员工 —— 下线的语义正是"不再被引用"。
         */
        const document = await findDocumentById(id)
        if (!canSeeDocument(req.user, document)) {
          return res.status(404).json({ message: '文档不存在或已下线。' })
        }
        const chunks = await listDocumentChunks(id)
        res.json({
          chunks: chunks.map((chunk) => ({
            id: chunk.id,
            chunkIndex: chunk.chunk_index,
            content: chunk.content,
            tokenCount: chunk.token_count,
            createdAt: chunk.created_at,
          })),
        })
      } catch (error) {
        handleAiError(error, res, next)
      }
    }
  )

  /** 粘贴文本入库（管理员）。 */
  router.post('/knowledge/documents', adminGuard, async (req, res, next) => {
    try {
      const body = req.body ?? {}
      const title = optionalString(body.title, { max: 300 })
      const content = typeof body.content === 'string' ? body.content : ''
      if (!title) return res.status(400).json({ message: '文档标题不能为空。' })
      if (!content.trim()) return res.status(400).json({ message: '文档内容不能为空。' })
      if (content.length > MAX_PASTE_LENGTH) {
        return res.status(400).json({ message: '粘贴内容过长，请改用文件上传。' })
      }
      const document = await ingestDocument({
        title,
        text: content,
        sourceType: 'upload',
        sourceRef: optionalString(body.sourceRef, { max: 300 }),
        category: optionalString(body.category, { max: 60 }),
        expiresAt: optionalDate(body.expiresAt) ?? null,
        createdBy: req.user.id,
        supersedesDocumentId: resourceId(body.supersedesDocumentId),
      })
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.docUpload,
        targetType: 'ai_document',
        targetId: document.id,
        detail: { title: document.title, chunkCount: document.chunkCount, channel: 'paste' },
        ip: clientIp(req),
      })
      res.status(201).json({ document: serializeDocument(document) })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /**
   * 文件上传（管理员）：TXT / Markdown / CSV / JSON。
   * 用原始 body 传输 + X-File-Name 头，避免为了一期引入 multipart 依赖；
   * PDF / Word / Excel 明确拒绝（解析库选型见需求文档 Q6）。
   */
  router.post(
    '/knowledge/documents/upload',
    adminGuard,
    express.raw({ type: () => true, limit: '2mb' }),
    async (req, res, next) => {
      try {
        const fileName = decodeFileName(req.headers['x-file-name'])
        if (!fileName) return res.status(400).json({ message: '缺少文件名（X-File-Name）。' })
        const extracted = extractDocumentText({ fileName, buffer: req.body })
        if (!extracted.ok) return res.status(400).json({ message: extracted.error })

        const document = await ingestDocument({
          title: optionalString(req.query.title, { max: 300 }) ?? fileName,
          text: extracted.text,
          sourceType: 'upload',
          sourceRef: fileName,
          expiresAt: optionalDate(req.query.expiresAt) ?? null,
          createdBy: req.user.id,
        })
        await recordAudit({
          actorId: req.user.id,
          action: AUDIT_ACTIONS.docUpload,
          targetType: 'ai_document',
          targetId: document.id,
          detail: { title: document.title, fileName, chunkCount: document.chunkCount, channel: 'file' },
          ip: clientIp(req),
        })
        res.status(201).json({ document: serializeDocument(document) })
      } catch (error) {
        handleAiError(error, res, next)
      }
    }
  )

  /** 修改有效期 / 下线 / 重新启用（管理员）。 */
  router.patch('/knowledge/documents/:id', adminGuard, async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '文档参数无效。' })
    try {
      const body = req.body ?? {}
      const wantsStatus = body.status !== undefined
      const expiresAt = optionalDate(body.expiresAt)

      if (wantsStatus && !['active', 'inactive'].includes(body.status)) {
        return res.status(400).json({ message: '文档状态参数无效。' })
      }
      if (!wantsStatus && expiresAt === undefined) {
        return res.status(400).json({ message: '没有需要更新的字段。' })
      }

      if (wantsStatus && body.status === 'inactive') {
        const updated = await deactivateDocument({ documentId: id, actorId: req.user.id })
        if (!updated) return res.status(404).json({ message: '文档不存在或已下线。' })
        await recordAudit({
          actorId: req.user.id,
          action: AUDIT_ACTIONS.docOffline,
          targetType: 'ai_document',
          targetId: id,
          detail: { title: updated.title, via: 'api' },
          ip: clientIp(req),
        })
        return res.json({ document: { id: updated.id, title: updated.title, status: 'inactive' } })
      }

      if (wantsStatus && body.status === 'active') {
        const updated = await reactivateDocument({ documentId: id, expiresAt })
        if (!updated) return res.status(404).json({ message: '文档不存在。' })
        await recordAudit({
          actorId: req.user.id,
          action: AUDIT_ACTIONS.docOnline,
          targetType: 'ai_document',
          targetId: id,
          detail: { title: updated.title, expiresAt: updated.expires_at },
          ip: clientIp(req),
        })
        return res.json({ document: serializeDocument(updated) })
      }

      // 只改有效期，不改变生效状态
      const updated = await updateDocumentExpiry({ documentId: id, expiresAt })
      if (!updated) return res.status(404).json({ message: '文档不存在。' })
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.docOnline,
        targetType: 'ai_document',
        targetId: id,
        detail: { title: updated.title, expiresAt: updated.expires_at, via: 'expiry_only' },
        ip: clientIp(req),
      })
      return res.json({ document: serializeDocument(updated) })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /** 删除文档及其切片（管理员）。审计不可删，知识文档可删。 */
  router.delete('/knowledge/documents/:id', adminGuard, async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '文档参数无效。' })
    try {
      const deleted = await deleteDocument(id)
      if (!deleted) return res.status(404).json({ message: '文档不存在。' })
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.docDelete,
        targetType: 'ai_document',
        targetId: id,
        detail: { title: deleted.title, chunkCount: deleted.chunk_count },
        ip: clientIp(req),
      })
      res.status(204).end()
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /**
   * 批量下线 / 启用 / 删除（管理员）。
   *
   * 为什么需要：知识库一次要清理几十篇过期文档，逐条点既慢又容易漏。
   * 但批量不做"一把梭"：
   *   1. 每条都走与单条接口**完全相同**的领域函数（deactivateDocument / reactivateDocument /
   *      deleteDocument），不绕过任何状态守卫（例如已下线的文档不会被重复下线）；
   *   2. **逐条写审计**，审计台仍然能回答"这一篇是谁在什么时候下线/删除的"，
   *      而不是只留下一行"批量操作 30 条"；detail 里带 batch: true 便于按批追溯；
   *   3. 单条失败不中断整批，逐条返回原因，前端据此展示"成功 N 条、失败 M 条（原因）"。
   * 响应固定 200：部分失败不是请求失败，用 failed 计数与逐条 message 表达。
   */
  router.post('/knowledge/documents/batch', adminGuard, async (req, res, next) => {
    try {
      const parsed = parseBatchRequest(req.body ?? {}, {
        actions: BATCH_ACTIONS,
        actionMessage: '批量动作只能是 offline（下线）/ online（启用）/ delete（删除）。',
        max: MAX_BATCH_SIZE,
        subject: '篇文档',
      })
      if (!parsed.ok) return res.status(400).json({ message: parsed.message })
      const { action, ids } = parsed

      const results = []
      for (const id of ids) {
        results.push(await runBatchDocumentItem({ action, id, actorId: req.user.id, ip: clientIp(req) }))
      }
      const succeeded = results.filter((item) => item.ok).length
      res.json({
        action,
        requested: ids.length,
        succeeded,
        failed: results.length - succeeded,
        results,
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.post('/knowledge/reindex', adminGuard, async (req, res, next) => {
    try {
      const result = await rebuildKnowledgeIndex()
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.reindex,
        targetType: 'ai_knowledge',
        targetId: 'index',
        detail: result,
        ip: clientIp(req),
      })
      res.json({ result })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /** 纠错反馈闭环：待处理列表（含原文引用，便于管理员定位是哪篇文档答错了）。 */
  router.get('/knowledge/feedback', adminGuard, async (req, res, next) => {
    try {
      const rows = await listUnhandledFeedback({ limit: 100 })
      res.json({
        feedback: rows.map((row) => ({
          id: row.id,
          type: row.type,
          comment: row.comment,
          messageId: row.message_id,
          conversationId: row.conversation_id,
          answerExcerpt: String(row.answer_content ?? '').slice(0, 300),
          citations: row.citations ?? [],
          reporterName: row.reporter_name,
          reporterLogin: row.reporter_login,
          createdAt: row.created_at,
        })),
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.post('/knowledge/feedback/:id/handled', adminGuard, async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '反馈参数无效。' })
    try {
      const updated = await markFeedbackHandled(id)
      // null 有两种可能：反馈不存在，或早就处理过（`handled = false` 条件不成立）。
      // 统一按 409 返回，避免"重复点击一直显示成功"。
      if (!updated) return res.status(409).json({ message: '该反馈不存在或已经处理过。' })
      // 管理动作必须留痕：谁在什么时候关闭了哪条纠错反馈。
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.feedbackHandled,
        targetType: 'ai_feedback',
        targetId: id,
        detail: { handled: true },
        ip: clientIp(req),
      })
      res.json({ feedback: updated })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /** 数据时效：知识库 + 各业务数据集最新导入时间（声明条数据源）。 */
  router.get('/datasets/freshness', adminGuard, async (req, res, next) => {
    try {
      const [knowledge, datasets] = await Promise.all([
        knowledgeFreshness(req.user),
        datasetFreshness(),
      ])
      res.json({ knowledge, datasets })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.use((error, _req, res, next) => handleAiError(error, res, next))

  return router
}

function serializeDocument(document) {
  return {
    id: document.id,
    title: document.title,
    sourceType: document.source_type ?? 'upload',
    docVersion: document.doc_version,
    status: document.status,
    expiresAt: document.expires_at,
    chunkCount: document.chunk_count ?? document.chunkCount,
    createdAt: document.created_at,
  }
}

export { KnowledgeValidationError }

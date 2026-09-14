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
import { clientIp, handleAiError, optionalDate, optionalString, parsePageQuery } from './http-utils.mjs'
import {
  KnowledgeValidationError,
  datasetFreshness,
  deactivateDocument,
  deleteDocument,
  extractDocumentText,
  ingestDocument,
  knowledgeFreshness,
  listDocumentChunks,
  listDocuments,
  reactivateDocument,
  rebuildKnowledgeIndex,
  updateDocumentExpiry,
} from './knowledge.mjs'

const MAX_PASTE_LENGTH = 200000

function resourceId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
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

/**
 * 知识沉淀接口：员工侧「我的沉淀」+ 管理员侧「沉淀管理」。
 *
 * 边界（与需求方确认过的四条）：
 *   1. 管理员在**对话检索**里看不到员工的私有沉淀；本文件的管理员接口只服务管理页。
 *   2. 私有沉淀不进公共知识库：只有管理员审核通过后，才会生成 source_type='experience' 的文档。
 *   3. 驳回必须写原因（否则提报人不知道自己错在哪）。
 *   4. 导出动作本身也写审计（需求文档 §5.4）。
 *
 * 写管道顺序固定为：校验 → 权限 → 幂等 → 执行 → 审计（借鉴受治理写管道的做法，
 * 保证"谁在什么时候把哪条沉淀变成了公司知识"永远可回溯）。
 */
import express from 'express'
import { AUDIT_ACTIONS, recordAudit } from './audit.mjs'
import {
  clientIp,
  handleAiError,
  optionalString,
  parseBatchRequest,
  parseDateRange,
  parsePageQuery,
} from './http-utils.mjs'
import { KnowledgeValidationError, loadSettings } from './knowledge.mjs'
import {
  NOTE_STATUS,
  NoteConflictError,
  NoteValidationError,
  completeDistillAudit,
  createNote,
  deleteNote,
  getAdminNote,
  getOwnedNote,
  listNoteStats,
  listNotes,
  listNotesForExport,
  EXPORT_MAX_ROWS,
  notesToCsv,
  notesToMarkdown,
  reserveDistillQuota,
  reviewNote,
  transitionNote,
  updateNote,
} from './notes.mjs'
import { DISTILL_SKILL_NAME } from './skill-contracts.mjs'
import { extractDistillDraft, loadConversationMessages, shouldOfferDistill } from './distill.mjs'
import { resolveProvider } from './providers/index.mjs'
import {
  SkillValidationError,
  getUserSkill,
  listSkills,
  listUserSkillOverview,
  saveUserSkill,
  setSkillEnabled,
  setSkillPolicy,
  resolveDistillFields,
} from './skills.mjs'

const EXPORT_FORMATS = new Set(['csv', 'md', 'json'])
const MAX_EXPORT_ROWS = 2000
/** 沉淀批量动作白名单与上限（与知识库批量接口同一套口径）。 */
const BATCH_NOTE_ACTIONS = ['archive', 'delete']
const MAX_BATCH_NOTES = 100

function resourceId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * 沉淀批量操作的单条执行单元。
 *
 * 刻意不抛错：批量里"已发布条目不能删除"这类业务拒绝只应拦下这一条，
 * 其余条目照常处理，前端需要逐条原因（否则用户只知道"批量删除失败"）。
 */
async function runBatchNoteItem({ action, id, user, ip }) {
  try {
    if (action === 'archive') {
      const note = await transitionNote({
        id,
        user,
        to: NOTE_STATUS.archived,
        scope: 'admin',
      })
      if (!note) return { id, ok: false, message: '沉淀不存在' }
      await recordAudit({
        actorId: user.id,
        action: AUDIT_ACTIONS.noteArchive,
        targetType: 'ai_knowledge_note',
        targetId: id,
        detail: {
          title: note.title,
          scope: 'admin',
          ownerUserId: note.ownerUserId,
          via: 'batch',
        },
        ip,
      })
      return { id, ok: true, title: note.title, status: note.status }
    }

    const note = await deleteNote({ id, user, scope: 'admin' })
    if (!note) return { id, ok: false, message: '沉淀不存在' }
    await recordAudit({
      actorId: user.id,
      action: AUDIT_ACTIONS.noteDelete,
      targetType: 'ai_knowledge_note',
      targetId: id,
      detail: {
        title: note.title,
        scope: 'admin',
        ownerUserId: note.ownerUserId,
        via: 'batch',
      },
      ip,
    })
    return { id, ok: true, title: note.title, deleted: true }
  } catch (error) {
    return { id, ok: false, message: error instanceof Error ? error.message : '操作失败' }
  }
}

function formatStamp(date = new Date()) {
  return date.toISOString().slice(0, 19).replace(/[:T]/g, '-')
}

function skillName(payload) {
  return optionalString(payload?.skillName, { max: 60 }) ?? DISTILL_SKILL_NAME
}

/**
 * 管理动作审计用：列出被改动的字段名。
 * 只记字段名不记正文——审计台要能回答"管理员改了什么"，同时避免把员工全文塞进日志。
 */
function changedFieldKeys(before, after) {
  const keys = []
  for (const key of ['title', 'summary', 'evidence', 'tags']) {
    if (JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null)) {
      keys.push(key)
    }
  }
  const fieldKeys = new Set([
    ...Object.keys(before?.fields ?? {}),
    ...Object.keys(after?.fields ?? {}),
  ])
  for (const key of fieldKeys) {
    if ((before?.fields?.[key] ?? '') !== (after?.fields?.[key] ?? '')) keys.push(`fields.${key}`)
  }
  return keys
}

/** 导出响应：text/csv 与 text/markdown 都带 BOM，Excel / 编辑器打开中文不乱码。 */
function sendExport(res, { filename, contentType, body }) {
  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(body)
}

function buildExportBody({ format, rows, fields }) {
  if (format === 'csv') {
    return { contentType: 'text/csv; charset=utf-8', body: notesToCsv(rows, { fields }) }
  }
  if (format === 'md') {
    return { contentType: 'text/markdown; charset=utf-8', body: notesToMarkdown(rows, { fields }) }
  }
  return { contentType: 'application/json; charset=utf-8', body: JSON.stringify({ notes: rows }, null, 2) }
}

/** 可导出字段：用技能契约里的字段定义渲染 Markdown 章节与 CSV 列。 */
async function loadExportFields() {
  const skills = await listSkills({ includeDisabled: true })
  const skill = skills.find((item) => item.name === DISTILL_SKILL_NAME)
  return Array.isArray(skill?.fieldSchema) ? skill.fieldSchema : []
}

/**
 * 管理侧筛选条件解析（列表与导出**必须**共用本函数）。
 *
 * 为什么强调共用：两处各写一遍，早晚会出现"列表筛了时间、导出没筛"这种
 * "看到的和导出的不一致"——那是最难被发现、也最容易被当成数据错误的一类 bug。
 */
function parseAdminNoteFilters(query = {}) {
  let userId = null
  if (query.userId !== undefined && query.userId !== null && query.userId !== '') {
    userId = resourceId(query.userId)
    if (!userId) throw new KnowledgeValidationError('账号参数无效。')
  }
  const range = parseDateRange({ from: query.from, to: query.to })
  return {
    userId,
    status: optionalString(query.status, { max: 20 }),
    keyword: optionalString(query.keyword, { max: 100 }),
    tag: optionalString(query.tag, { max: 20 }),
    from: range.from,
    to: range.to,
  }
}

export function createNotesRouter({ adminGuard }) {
  const router = express.Router()

  // ── 员工侧：我的知识沉淀 ──────────────────────────────────────────────────
  // 权限口径：员工接口一律按 **所有者视角** 收窄（getOwnedNote / scope='self'），
  // 他人条目（管理员也包含在内）按不存在返回 404，不泄露存在性、不改变条目状态。
  // 管理员查看与管理他人条目只能走下方 /distill/*，那里有 adminGuard + 审计留痕。

  router.get('/notes', async (req, res, next) => {
    try {
      const { page, pageSize } = parsePageQuery(req.query)
      const result = await listNotes({
        userId: req.user.id,
        status: optionalString(req.query.status, { max: 20 }),
        keyword: optionalString(req.query.keyword, { max: 100 }),
        tag: optionalString(req.query.tag, { max: 20 }),
        page,
        pageSize,
      })
      res.json(result)
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /** 我的技能配置：默认关闭，员工自行开启（已确认）。 */
  router.get('/notes/skill', async (req, res, next) => {
    try {
      const state = await getUserSkill({ userId: req.user.id, skillName: skillName(req.query) })
      if (!state) return res.status(404).json({ message: '技能不存在。' })
      res.json(state)
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.put('/notes/skill', async (req, res, next) => {
    try {
      const body = req.body ?? {}
      // 员工只能改开关：带锁定字段的请求会抛 SkillValidationError（由错误中间件映射为 400），
      // 不能静默忽略——那会显示"保存成功"但实际没生效。
      const config = await saveUserSkill({
        userId: req.user.id,
        skillName: skillName(body),
        patch: body,
      })
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.skillConfig,
        targetType: 'ai_user_skill',
        targetId: req.user.id,
        detail: { skillName: skillName(body), ...config },
        ip: clientIp(req),
      })
      res.json({ config })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.get('/notes/export', async (req, res, next) => {
    try {
      const format = optionalString(req.query.format, { max: 10 }) ?? 'csv'
      if (!EXPORT_FORMATS.has(format)) {
        return res.status(400).json({ message: '导出格式只支持 csv / md / json。' })
      }
      const rows = await listNotesForExport({
        userId: req.user.id,
        status: optionalString(req.query.status, { max: 20 }),
        keyword: optionalString(req.query.keyword, { max: 100 }),
        tag: optionalString(req.query.tag, { max: 20 }),
      })
      const fields = await loadExportFields()
      // 达到上限说明还有数据没被导出：审计与响应头都要标出来，前端据此提示用户缩小范围
      const truncated = rows.length >= EXPORT_MAX_ROWS
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.noteExport,
        targetType: 'ai_knowledge_note',
        targetId: req.user.id,
        detail: { scope: 'self', format, rows: rows.length, truncated },
        ip: clientIp(req),
      })
      if (truncated) res.setHeader('X-Export-Truncated', 'true')
      const extension = format === 'md' ? 'md' : format
      sendExport(res, {
        filename: `my-knowledge-notes-${formatStamp()}.${extension}`,
        ...buildExportBody({ format, rows, fields }),
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /**
   * 手工新建 / 会话沉淀保存：不消耗模型，因此不受技能开关与每日配额限制。
   *
   * provenance 与 source_kind 都由服务端推导：带 conversationId 就是会话来源（模型推断），
   * 否则是员工本人所写。请求体里的 provenance 一律忽略（只做枚举校验）。
   */
  router.post('/notes', async (req, res, next) => {
    try {
      const body = req.body ?? {}
      const conversationId = resourceId(body.conversationId)
      if (body.conversationId !== undefined && body.conversationId !== null && !conversationId) {
        return res.status(400).json({ message: '来源会话参数无效。' })
      }
      const { note, merged, newRevision } = await createNote({
        user: req.user,
        input: {
          title: body.title,
          summary: body.summary,
          evidence: body.evidence,
          fields: body.fields,
          tags: body.tags,
          provenance: body.provenance,
        },
        skillName: body.skillName ?? null,
        sourceKind: conversationId ? 'conversation' : 'manual',
        conversationId,
        messageIds: Array.isArray(body.messageIds) ? body.messageIds.filter(Number.isInteger) : [],
      })
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.noteCreate,
        targetType: 'ai_knowledge_note',
        targetId: note.id,
        detail: {
          title: note.title,
          merged,
          newRevision,
          sourceKind: note.sourceKind,
          provenance: note.provenance,
          revisionOfNoteId: note.revisionOfNoteId,
        },
        ip: clientIp(req),
      })
      res.status(201).json({ note, merged, newRevision })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /**
   * 从会话抽取沉淀草稿（不落库）。
   * 前置条件：技能已开启 + 未超过每日配额；模型不可用或解析失败时返回降级草稿（不编造）。
   *
   * 配额在**调用模型之前**用短事务预占（reserveDistillQuota）：并发两个请求也只有一个能过，
   * 预占失败即 429；预占成功后即使模型调用失败也照样计数（与产品口径一致）。
   */
  router.post('/notes/distill', async (req, res, next) => {
    try {
      const conversationId = resourceId(req.body?.conversationId)
      if (!conversationId) return res.status(400).json({ message: '会话参数无效。' })

      const state = await getUserSkill({ userId: req.user.id, skillName: DISTILL_SKILL_NAME })
      if (!state) return res.status(404).json({ message: '技能不存在。' })
      if (!state.skill.enabled) {
        return res.status(400).json({ message: '该技能已被管理员停用。' })
      }
      if (!state.config.enabled) {
        return res.status(400).json({ message: '请先在「我的沉淀」开启「知识沉淀」技能。' })
      }

      const owned = await loadConversationMessages({
        userId: req.user.id,
        conversationId,
        limit: 20,
      })
      if (!owned) return res.status(404).json({ message: '会话不存在。' })
      const { messages } = owned
      if (!shouldOfferDistill({ messages })) {
        return res.status(400).json({ message: '这次会话还没有可沉淀的实质回答。' })
      }

      // 配额只统计「AI 整理」次数：手工新建沉淀不消耗配额（与技能卡片上的说明一致）
      const reservation = await reserveDistillQuota({
        userId: req.user.id,
        limit: state.config.dailyQuota,
        ip: clientIp(req),
      })
      if (!reservation.allowed) {
        return res.status(429).json({
          message: `今日 AI 整理次数已达上限（${state.config.dailyQuota} 次），请明天再试或调高上限。`,
        })
      }

      const fields = resolveDistillFields(state.skill, state.config)
      const settings = await loadSettings()
      const provider = resolveProvider({ settings })
      const result = await extractDistillDraft({
        conversationId,
        messages,
        provider,
        skill: state.skill,
        fields,
      })
      // 补全预占行的明细（同一行，不新增第二条审计）
      await completeDistillAudit({
        auditId: reservation.auditId,
        conversationId,
        detail: {
          degraded: Boolean(result.draft?.degraded),
          parseError: result.parseError ?? null,
          fieldCount: Object.keys(result.draft?.fields ?? {}).length,
          // 原文依据核对结果要留痕：审核人需要知道"这条的引句是不是会话里真有的"
          evidenceRejected: Boolean(result.draft?.evidenceRejected),
          model: state.skill.name,
        },
      })

      res.json({
        draft: result.draft,
        parseError: result.parseError ?? null,
        fields,
        conversation: { id: owned.conversation.id, title: owned.conversation.title },
        quota: { used: reservation.used, limit: state.config.dailyQuota },
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.get('/notes/:id', async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '沉淀参数无效。' })
    try {
      const note = await getOwnedNote({ id, user: req.user })
      if (!note) return res.status(404).json({ message: '沉淀不存在。' })
      res.json({ note })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.patch('/notes/:id', async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '沉淀参数无效。' })
    try {
      const note = await updateNote({
        id,
        user: req.user,
        patch: req.body ?? {},
        scope: 'self',
      })
      if (!note) return res.status(404).json({ message: '沉淀不存在。' })
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.noteUpdate,
        targetType: 'ai_knowledge_note',
        targetId: id,
        detail: { title: note.title, status: note.status },
        ip: clientIp(req),
      })
      res.json({ note })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.post('/notes/:id/submit', async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '沉淀参数无效。' })
    try {
      const note = await transitionNote({
        id,
        user: req.user,
        to: NOTE_STATUS.pending,
        scope: 'self',
        action: 'submit',
      })
      if (!note) return res.status(404).json({ message: '沉淀不存在。' })
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.noteSubmit,
        targetType: 'ai_knowledge_note',
        targetId: id,
        detail: { title: note.title },
        ip: clientIp(req),
      })
      res.json({ note })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.post('/notes/:id/archive', async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '沉淀参数无效。' })
    try {
      const note = await transitionNote({
        id,
        user: req.user,
        to: NOTE_STATUS.archived,
        scope: 'self',
        action: 'archive',
      })
      if (!note) return res.status(404).json({ message: '沉淀不存在。' })
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.noteArchive,
        targetType: 'ai_knowledge_note',
        targetId: id,
        detail: { title: note.title, scope: 'self' },
        ip: clientIp(req),
      })
      res.json({ note })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.delete('/notes/:id', async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '沉淀参数无效。' })
    try {
      const note = await deleteNote({ id, user: req.user, scope: 'self' })
      if (!note) return res.status(404).json({ message: '沉淀不存在。' })
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.noteDelete,
        targetType: 'ai_knowledge_note',
        targetId: id,
        detail: { title: note.title, scope: 'self' },
        ip: clientIp(req),
      })
      res.status(204).end()
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  // ── 管理员侧：沉淀管理 ───────────────────────────────────────────────────

  router.get('/distill/notes', adminGuard, async (req, res, next) => {
    try {
      const { page, pageSize } = parsePageQuery(req.query)
      const filters = parseAdminNoteFilters(req.query)
      const result = await listNotes({ ...filters, page, pageSize })
      res.json(result)
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.get('/distill/stats', adminGuard, async (_req, res, next) => {
    try {
      res.json(await listNoteStats())
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.get('/distill/skills', adminGuard, async (req, res, next) => {
    try {
      const overview = await listUserSkillOverview({ skillName: skillName(req.query) })
      if (!overview) return res.status(404).json({ message: '技能不存在。' })
      res.json({ ...overview, skills: await listSkills({ includeDisabled: true }) })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /**
   * 技能治理（管理员）：全局启停 + 成本参数策略。
   * 策略一次改一批（触发方式 / 每日 AI 整理上限 / 字段集合），对全部账号立即生效。
   */
  router.patch('/distill/skills/:name', adminGuard, async (req, res, next) => {
    try {
      const name = optionalString(req.params.name, { max: 60 })
      const body = req.body ?? {}
      if (body.enabled === undefined && body.policy === undefined) {
        return res.status(400).json({ message: '请求必须包含 enabled 或 policy。' })
      }
      let skill = null
      let policy = null
      if (body.policy !== undefined) {
        const result = await setSkillPolicy({ skillName: name, patch: body.policy ?? {} })
        skill = result.skill
        policy = result.policy
      }
      if (body.enabled !== undefined) {
        skill = await setSkillEnabled({ skillName: name, enabled: Boolean(body.enabled) })
      }
      if (!skill) return res.status(404).json({ message: '技能不存在。' })
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.skillConfig,
        targetType: 'ai_skill',
        targetId: skill.id,
        detail: {
          scope: 'global',
          skillName: skill.name,
          enabled: skill.enabled,
          ...(policy ? { policy } : {}),
        },
        ip: clientIp(req),
      })
      res.json({ skill, policy: policy ?? skill.policy ?? null })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.get('/distill/export', adminGuard, async (req, res, next) => {
    try {
      const format = optionalString(req.query.format, { max: 10 }) ?? 'csv'
      if (!EXPORT_FORMATS.has(format)) {
        return res.status(400).json({ message: '导出格式只支持 csv / md / json。' })
      }
      // 与列表完全同一组筛选条件（同一个解析函数），避免"看到的和导出的不一致"
      const filters = parseAdminNoteFilters(req.query)
      const rows = await listNotesForExport(filters)
      const fields = await loadExportFields()
      const truncated = rows.length >= EXPORT_MAX_ROWS
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.noteExport,
        targetType: 'ai_knowledge_note',
        targetId: null,
        detail: {
          scope: 'all',
          format,
          rows: rows.length,
          truncated,
          // 完整筛选条件都留痕：审计台要能回答"这份导出到底覆盖了什么范围"
          filters: {
            userId: filters.userId,
            status: filters.status,
            keyword: filters.keyword,
            tag: filters.tag,
            from: filters.from,
            to: filters.to,
          },
        },
        ip: clientIp(req),
      })
      if (truncated) res.setHeader('X-Export-Truncated', 'true')
      const extension = format === 'md' ? 'md' : format
      sendExport(res, {
        filename: `knowledge-notes-export-${formatStamp()}.${extension}`,
        ...buildExportBody({ format, rows, fields }),
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /**
   * 批量归档 / 批量删除（管理员）。
   *
   * 只做「归档」与「删除」这两类**不改变知识内容本身**的清理动作：
   *   审核（通过/驳回）刻意不做批量 —— 通过会为每条生成一篇公共知识库文档，
   *   误操作的代价是往知识库里灌一批没人看过的内容，且驳回必须逐条给出原因。
   *
   * 与知识库批量接口同一套口径：逐条调用既有领域函数（归档已发布条目会连同公共文档
   * 一起下线）、**逐条写审计**、单条失败不中断整批并把原因返回给前端。
   */
  router.post('/distill/notes/batch', adminGuard, async (req, res, next) => {
    try {
      const parsed = parseBatchRequest(req.body ?? {}, {
        actions: BATCH_NOTE_ACTIONS,
        actionMessage: '批量动作只能是 archive（归档）/ delete（删除）。',
        max: MAX_BATCH_NOTES,
        subject: '条沉淀',
      })
      if (!parsed.ok) return res.status(400).json({ message: parsed.message })
      const { action, ids } = parsed

      const results = []
      for (const id of ids) {
        results.push(await runBatchNoteItem({ action, id, user: req.user, ip: clientIp(req) }))
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

  router.get('/distill/notes/:id', adminGuard, async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '沉淀参数无效。' })
    try {
      const note = await getAdminNote({ id, user: req.user })
      if (!note) return res.status(404).json({ message: '沉淀不存在。' })
      res.json({ note })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.patch('/distill/notes/:id', adminGuard, async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '沉淀参数无效。' })
    try {
      const before = await getAdminNote({ id, user: req.user })
      if (!before) return res.status(404).json({ message: '沉淀不存在。' })
      const note = await updateNote({
        id,
        user: req.user,
        patch: req.body ?? {},
        scope: 'admin',
      })
      if (!note) return res.status(404).json({ message: '沉淀不存在。' })
      // 管理员修改员工内容必须留痕：改了谁的内容、改前什么状态、哪些字段被改动
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.noteUpdate,
        targetType: 'ai_knowledge_note',
        targetId: id,
        detail: {
          title: note.title,
          status: note.status,
          scope: 'admin',
          ownerUserId: note.ownerUserId,
          previousStatus: before.status,
          changedKeys: changedFieldKeys(before, note),
        },
        ip: clientIp(req),
      })
      res.json({ note })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /**
   * 审核：通过 → 生成公共知识库文档（source_ref='note:<id>'，幂等，新修订会顶掉旧版本文档）；
   * 驳回 → 必须写原因。
   *
   * 实现要点（本轮加固）：行锁 + 单事务，状态更新、文档生成、关联、审计一起提交。
   * 文档生成失败时条目保持 pending，管理员可以重试；并发审核只有一个能成功（另一个 409）。
   */
  router.post('/distill/notes/:id/review', adminGuard, async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '沉淀参数无效。' })
    try {
      const decision = req.body?.decision
      if (decision !== 'approve' && decision !== 'reject') {
        return res.status(400).json({ message: '审核结论只能是 approve / reject。' })
      }
      const comment = optionalString(req.body?.comment, { max: 500 })
      if (decision === 'reject' && !comment) {
        return res.status(400).json({ message: '驳回必须填写原因。' })
      }
      const fields = decision === 'approve' ? await loadExportFields() : []
      const result = await reviewNote({
        id,
        user: req.user,
        decision,
        comment,
        fields,
        ip: clientIp(req),
      })
      if (!result) return res.status(404).json({ message: '沉淀不存在。' })
      res.json({ note: result.note, documentId: result.documentId })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.post('/distill/notes/:id/archive', adminGuard, async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '沉淀参数无效。' })
    try {
      const note = await transitionNote({
        id,
        user: req.user,
        to: NOTE_STATUS.archived,
        scope: 'admin',
      })
      if (!note) return res.status(404).json({ message: '沉淀不存在。' })
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.noteArchive,
        targetType: 'ai_knowledge_note',
        targetId: id,
        detail: { title: note.title, scope: 'admin', ownerUserId: note.ownerUserId },
        ip: clientIp(req),
      })
      res.json({ note })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.delete('/distill/notes/:id', adminGuard, async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '沉淀参数无效。' })
    try {
      const note = await deleteNote({ id, user: req.user, scope: 'admin' })
      if (!note) return res.status(404).json({ message: '沉淀不存在。' })
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.noteDelete,
        targetType: 'ai_knowledge_note',
        targetId: id,
        detail: { title: note.title, scope: 'admin', ownerUserId: note.ownerUserId },
        ip: clientIp(req),
      })
      res.status(204).end()
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.use((error, _req, res, next) => {
    // 409 与 400 分开：前者是"状态已被改变/当前状态不允许改"，后者是输入不合法
    if (error instanceof NoteConflictError) {
      return res.status(409).json({ message: error.message, conflict: true })
    }
    if (error instanceof NoteValidationError || error instanceof SkillValidationError) {
      return res.status(400).json({ message: error.message })
    }
    handleAiError(error, res, next)
  })

  return router
}

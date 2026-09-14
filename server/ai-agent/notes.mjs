/**
 * 知识沉淀条目：领域规则（纯函数）+ 仓储（DB）。
 *
 * 设计依据（借鉴行业实践，落点写在这里避免后来者重复推导）：
 * 1. 写权分离：员工只能 propose（private → pending），publish / reject **只有管理员能调**
 *    （见 canTransition 的 isAdmin 判定），避免"模型或本人把自己的推断洗成公司事实"。
 * 2. 未审内容与已发布内容物理分离：私有条目只活在 ai_knowledge_notes 里，
 *    不进 ai_documents，因此**永远不可能被检索到**（这是比"靠过滤条件挡住"更强的保证）。
 * 3. provenance 区分「本人所写 / 模型推断」，比模型自评的置信度更能预测可靠性；
 *    evidence 存会话原文引句，让审核人一眼可判，而不是通读整段会话。
 * 4. 不物理删除：归档 / 软删都保留行，供审计回溯（review_comment 也保留）。
 *
 * 权限判定不在这里重复实现：可见性统一走 permissions.mjs 的 canSeeNote / noteScopeSql。
 */
import { pool, query } from '../db.mjs'
import { AUDIT_ACTIONS, recordAudit } from './audit.mjs'
import { toCsv } from './csv.mjs'
import { isEvidenceFromConversation, loadConversationMessages } from './distill.mjs'
import { deactivateDocument, ingestDocument } from './knowledge.mjs'
import { canManageNote, canOwnNote, isEnabledAdmin, noteScopeSql } from './permissions.mjs'

export class NoteValidationError extends Error {}

/**
 * 状态冲突（映射为 HTTP 409，与 400 校验错误区分开）。
 *
 * 为什么必须单独一个类型：并发审核时后到的请求必须能识别出"这条已经被别人处理了"，
 * 而不是笼统的 400；前端据此提示"请刷新后重试"，不会让管理员以为是自己填错了。
 */
export class NoteConflictError extends Error {}

export const NOTE_STATUS = {
  private: 'private',
  pending: 'pending',
  published: 'published',
  rejected: 'rejected',
  archived: 'archived',
}

export const NOTE_STATUS_LABELS = {
  private: '私有草稿',
  pending: '待审核',
  published: '已发布',
  rejected: '已驳回',
  archived: '已归档',
}

export const MAX_TITLE_LENGTH = 200
export const MAX_TAGS = 10
export const MAX_TAG_LENGTH = 20
export const MAX_SUMMARY_LENGTH = 500

const PROVENANCE = new Set(['user_stated', 'inferred'])

/**
 * provenance（来源可信度）**由服务端按来源推导**，客户端传什么都不采纳。
 *
 * 为什么不能信客户端：会话 AI 整理出来的内容是模型推断，前端早期默认标成 user_stated，
 * 结果审核人以为"这是员工自己逐字写的"——可信度标注一旦能被客户端决定就失去了意义。
 *   source_kind = conversation → inferred（模型从会话推断）
 *   source_kind = manual       → user_stated（员工本人所写）
 */
export function deriveProvenance(sourceKind) {
  return sourceKind === 'conversation' ? 'inferred' : 'user_stated'
}

/**
 * 状态流转白名单：key = `${from}->${to}`，value = 谁可以（owner / admin / either）。
 *
 * `rejected->pending` 是本轮补上的：员工页面一直给「已驳回」条目提供"提交审核"按钮，
 * 但状态机里没有这条边，点下去必然 400（界面承诺了做不到的事）。
 * 产品口径定为"修改后可直接重新提交、状态保持已驳回直到审核人处理"，
 * 理由：保留审核意见的可见性，员工能对着意见改，改完直接重提。
 */
const TRANSITIONS = {
  'private->pending': 'owner',
  'private->archived': 'either',
  'pending->published': 'admin',
  'pending->rejected': 'admin',
  'pending->archived': 'either',
  'rejected->pending': 'owner',
  'rejected->private': 'owner',
  // 被驳回的草稿同样可以归档收起来（界面上有归档入口，不能点了报错）
  'rejected->archived': 'either',
  'published->archived': 'admin',
  'archived->private': 'either',
}

export function normalizeTags(input) {
  if (!Array.isArray(input)) return []
  const seen = new Set()
  const tags = []
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim().slice(0, MAX_TAG_LENGTH)
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
    if (tags.length >= MAX_TAGS) break
  }
  return tags
}

/**
 * 沉淀条目的输入归一化。
 * 标题与字段类型错误直接抛错（不允许静默纠正成空条目），长度类问题截断（摘要/引句是描述性的，截断可接受）。
 */
export function normalizeNoteInput(input = {}) {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) throw new NoteValidationError('沉淀标题不能为空。')
  if (title.length > MAX_TITLE_LENGTH) {
    throw new NoteValidationError(`沉淀标题不能超过 ${MAX_TITLE_LENGTH} 个字。`)
  }

  let fields = {}
  if (input.fields !== undefined && input.fields !== null) {
    if (typeof input.fields !== 'object' || Array.isArray(input.fields)) {
      throw new NoteValidationError('沉淀字段必须是键值对象。')
    }
    for (const [key, value] of Object.entries(input.fields)) {
      if (typeof value !== 'string') continue
      const text = value.trim()
      if (text) fields[key] = text
    }
  }

  const provenance = input.provenance ?? 'user_stated'
  if (!PROVENANCE.has(provenance)) {
    throw new NoteValidationError('来源可信度只能是 user_stated / inferred。')
  }

  return {
    title,
    summary: typeof input.summary === 'string' ? input.summary.trim().slice(0, MAX_SUMMARY_LENGTH) : '',
    evidence: typeof input.evidence === 'string' ? input.evidence.trim().slice(0, MAX_SUMMARY_LENGTH) : '',
    fields,
    tags: normalizeTags(input.tags),
    provenance,
  }
}

/**
 * 合并同账号同标题的沉淀：新值非空则覆盖，空值保留原值（不因一次没抽到就把已有内容抹掉）。
 * 返回 changedKeys，便于界面提示"哪几个字段被更新了"。
 */
export function mergeNoteFields(existing = {}, incoming = {}) {
  const fields = { ...(existing ?? {}) }
  const changedKeys = []
  for (const [key, value] of Object.entries(incoming ?? {})) {
    if (typeof value !== 'string' || !value.trim()) continue
    if (fields[key] === value) continue
    fields[key] = value
    changedKeys.push(key)
  }
  return { fields, changedKeys }
}

/** 状态机判定（纯函数）：同状态、未知状态、越权流转一律 false。 */
export function canTransition(from, to, { isAdmin = false } = {}) {
  const allowed = TRANSITIONS[`${from}->${to}`]
  if (!allowed) return false
  if (allowed === 'admin') return Boolean(isAdmin)
  if (allowed === 'owner') return !isAdmin
  return true
}

export function assertTransition(from, to, { isAdmin = false } = {}) {
  if (!canTransition(from, to, { isAdmin })) {
    throw new NoteValidationError(
      `不允许把沉淀从「${NOTE_STATUS_LABELS[from] ?? from}」变更为「${NOTE_STATUS_LABELS[to] ?? to}」。`
    )
  }
}

export function serializeNote(row) {
  if (!row) return null
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerLogin: row.owner_login ?? null,
    ownerName: row.owner_name ?? null,
    title: row.title,
    summary: row.summary ?? '',
    evidence: row.evidence ?? '',
    fields: row.fields ?? {},
    tags: row.tags ?? [],
    status: row.status,
    sourceKind: row.source_kind,
    conversationId: row.conversation_id,
    messageIds: row.message_ids ?? [],
    skillName: row.skill_name,
    provider: row.provider,
    model: row.model,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    noteVersion: row.note_version,
    mergedFrom: row.merged_from ?? [],
    revisionOfNoteId: row.revision_of_note_id ?? null,
    degraded: row.degraded,
    provenance: row.provenance,
    publishedDocumentId: row.published_document_id,
    reviewedBy: row.reviewed_by,
    reviewerName: row.reviewer_name ?? null,
    reviewComment: row.review_comment,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function frontmatterValue(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return JSON.stringify(value)
  return String(value).replace(/\r?\n/g, ' ')
}

/**
 * 单条沉淀 → Markdown（带 frontmatter）。
 * 用 SKILL.md 同款 frontmatter：导出物既能给人读，也能被 parseSkillFrontmatter 再读回来。
 */
export function noteToMarkdown(note = {}, { fields = [] } = {}) {
  const lines = ['---']
  const push = (key, value) => {
    const text = frontmatterValue(value)
    if (text === null) return
    lines.push(`${key}: ${text}`)
  }
  push('id', note.id)
  push('title', note.title)
  push('status', note.status)
  push('statusLabel', NOTE_STATUS_LABELS[note.status] ?? note.status)
  push('owner', note.owner_name ?? note.owner_login)
  push('ownerLogin', note.owner_login)
  push('tags', note.tags ?? [])
  push('provenance', note.provenance)
  push('skill', note.skill_name)
  push('conversationId', note.conversation_id)
  push('sourceKind', note.source_kind)
  push('createdAt', note.created_at)
  push('updatedAt', note.updated_at)
  lines.push('---', '')

  const sections = []
  if (note.summary) sections.push(`## 概述\n${note.summary}`)
  if (note.evidence) sections.push(`## 原文依据\n${note.evidence}`)
  for (const field of fields) {
    const value = note.fields?.[field.key]
    // 没有值的字段不输出空章节，避免导出文件全是空标题
    if (!value) continue
    sections.push(`## ${field.label}\n${value}`)
  }
  const body = sections.join('\n\n')
  return `${lines.join('\n')}${body ? `\n${body}` : ''}`
}

export const NOTE_EXPORT_SEPARATOR = '\n\n---\n\n'
export const NOTE_EXPORT_HEADER = '<!-- 知识沉淀导出 -->'

export function notesToMarkdown(notes = [], { fields = [] } = {}) {
  const items = (notes ?? []).map((note) => noteToMarkdown(note, { fields }))
  if (items.length === 0) return NOTE_EXPORT_HEADER
  return [NOTE_EXPORT_HEADER, ...items].join(NOTE_EXPORT_SEPARATOR)
}

/** 沉淀条目 → CSV（复用审计导出的 toCsv：带 BOM、按需加引号）。 */
export function notesToCsv(rows = [], { fields = [] } = {}) {
  const columns = [
    { key: 'id', label: 'ID' },
    { key: 'title', label: '标题' },
    { key: 'status', label: '状态', value: (row) => NOTE_STATUS_LABELS[row.status] ?? row.status },
    { key: 'owner', label: '账号', value: (row) => row.owner_name ?? row.owner_login ?? '' },
    { key: 'tags', label: '标签', value: (row) => (row.tags ?? []).join(' / ') },
    ...fields.map((field) => ({
      key: field.key,
      label: field.label,
      value: (row) => row.fields?.[field.key] ?? '',
    })),
    { key: 'evidence', label: '原文依据' },
    { key: 'provenance', label: '来源可信度', value: (row) => (row.provenance === 'inferred' ? '模型推断' : '本人所写') },
    { key: 'conversationId', label: '来源会话' },
    { key: 'createdAt', label: '创建时间', value: (row) => formatDateTime(row.created_at) },
    { key: 'updatedAt', label: '更新时间', value: (row) => formatDateTime(row.updated_at) },
  ]
  return toCsv(columns, rows ?? [])
}

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().replace('T', ' ').slice(0, 19)
}

const SELECT_NOTE = `
  SELECT n.*, u.login AS owner_login, u.name AS owner_name,
         r.name AS reviewer_name
    FROM ai_knowledge_notes n
    JOIN users u ON u.id = n.owner_user_id
    LEFT JOIN users r ON r.id = n.reviewed_by
`

/**
 * 会话来源条目的「原文依据」必须能在来源会话里逐字找到。
 *
 * 校验失败一律抛 400，**不静默清空**：静默清空会让员工以为保存成功，
 * 而审核人拿到的是一条没有出处的推断内容。要留空就显式留空。
 */
export async function assertConversationEvidence({ user, conversationId, evidence }) {
  const text = typeof evidence === 'string' ? evidence.trim() : ''
  if (!text) return null
  const owned = await loadConversationMessages({
    userId: user?.id,
    conversationId,
    limit: 50,
  })
  if (!owned) throw new NoteValidationError('来源会话不存在，或不属于当前账号。')
  if (!isEvidenceFromConversation(text, owned.messages)) {
    throw new NoteValidationError(
      '原文依据必须能在来源会话中逐字找到（可去掉首尾引号），请修改或清空后重试。'
    )
  }
  return owned
}

/**
 * 新建沉淀。
 * 同账号同标题（忽略大小写）已存在时**不新增**，而是合并为新版本：
 * union 字段 + note_version + 1 + 记 merged_from，避免同一经验在个人空间里堆成多份。
 *
 * 例外（本轮加固）：已发布条目不允许原地合并——那会让公共知识库文档与条目内容悄悄脱钩。
 * 此时旧版本转为历史归档（公共文档保持生效），新建一条同标题的 private 修订，重新走审核。
 */
export async function createNote({
  user,
  input,
  skillName = null,
  provider = null,
  model = null,
  tokensIn = 0,
  tokensOut = 0,
  conversationId = null,
  messageIds = [],
  sourceKind = 'manual',
  degraded = false,
}) {
  const normalized = normalizeNoteInput(input)
  const effectiveSourceKind = conversationId ? 'conversation' : sourceKind === 'conversation' ? 'conversation' : 'manual'
  // 会话来源：先确认会话归属，再核对原文依据（两件事都在服务端做，不依赖前端）
  if (effectiveSourceKind === 'conversation' && conversationId) {
    await assertConversationEvidence({
      user,
      conversationId,
      evidence: normalized.evidence,
    })
  }
  const provenance = deriveProvenance(effectiveSourceKind)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // 锁住同标题条目：并发提交同标题时只会有一条走到"新建"，另一条按最新状态处理
    const existing = await client.query(
      `SELECT id, status, published_document_id, revision_of_note_id
         FROM ai_knowledge_notes
        WHERE owner_user_id = $1 AND lower(title) = lower($2) AND deleted_at IS NULL
          AND status <> 'archived'
        ORDER BY id DESC
        LIMIT 1
        FOR UPDATE`,
      [user.id, normalized.title]
    )
    const row = existing.rows[0]
    if (row) {
      if (row.status === NOTE_STATUS.pending) {
        throw new NoteConflictError(
          '同标题的沉淀正在审核中，不能重复提交或修改；请等审核结果后再操作。'
        )
      }
      if (row.status !== NOTE_STATUS.published) {
        const merged = await mergeIntoNote({
          client,
          id: row.id,
          input: normalized,
          conversationId,
          messageIds,
          degraded,
          provenance,
        })
        await client.query('COMMIT')
        return { note: merged, merged: true, newRevision: false }
      }
      const revision = await createRevision({
        client,
        previous: row,
        user,
        input: normalized,
        skillName,
        provider,
        model,
        tokensIn,
        tokensOut,
        conversationId,
        messageIds,
        sourceKind: effectiveSourceKind,
        degraded,
        provenance,
      })
      await client.query('COMMIT')
      return { note: revision, merged: false, newRevision: true }
    }

    const inserted = await insertNote(client, {
      user,
      input: normalized,
      skillName,
      provider,
      model,
      tokensIn,
      tokensOut,
      conversationId,
      messageIds,
      sourceKind: effectiveSourceKind,
      degraded,
      provenance,
      revisionOfNoteId: null,
    })
    await client.query('COMMIT')
    return { note: inserted, merged: false, newRevision: false }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const INSERT_NOTE_SQL = `
  INSERT INTO ai_knowledge_notes
    (owner_user_id, title, summary, fields, tags, status, source_kind, conversation_id,
     message_ids, skill_name, provider, model, tokens_in, tokens_out, degraded, provenance,
     revision_of_note_id)
  VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
  RETURNING *
`

function insertNote(client, {
  user,
  input,
  skillName,
  provider,
  model,
  tokensIn,
  tokensOut,
  conversationId,
  messageIds,
  sourceKind,
  degraded,
  provenance,
  revisionOfNoteId,
}) {
  return client
    .query(INSERT_NOTE_SQL, [
      user.id,
      input.title,
      input.summary,
      JSON.stringify(input.fields),
      input.tags,
      NOTE_STATUS.private,
      sourceKind,
      conversationId,
      messageIds,
      skillName,
      provider,
      model,
      tokensIn,
      tokensOut,
      degraded,
      provenance,
      revisionOfNoteId,
    ])
    .then(({ rows }) => serializeNote(rows[0]))
}

/**
 * 同标题再沉淀且旧版本已发布：旧条目转历史归档（**公共文档保持生效**），
 * 新条目从 private 起步、记录 revision_of_note_id 以便审核通过时接管旧文档。
 *
 * 关键约束：不得删除旧公共文档，也不得在新修订通过审核前改动它。
 */
async function createRevision({
  client,
  previous,
  user,
  input,
  skillName,
  provider,
  model,
  tokensIn,
  tokensOut,
  conversationId,
  messageIds,
  sourceKind,
  degraded,
  provenance,
}) {
  await client.query(
    `UPDATE ai_knowledge_notes
        SET status = $2, updated_at = NOW()
      WHERE id = $1`,
    [previous.id, NOTE_STATUS.archived]
  )
  return insertNote(client, {
    user,
    input,
    skillName,
    provider,
    model,
    tokensIn,
    tokensOut,
    conversationId,
    messageIds,
    sourceKind,
    degraded,
    provenance,
    revisionOfNoteId: previous.id,
  })
}

async function mergeIntoNote({ client, id, input, conversationId, messageIds, degraded, provenance }) {
  const current = await client.query('SELECT * FROM ai_knowledge_notes WHERE id = $1 FOR UPDATE', [id])
  const row = current.rows[0]
  if (!row) throw new NoteValidationError('沉淀条目不存在。')
  const { fields, changedKeys } = mergeNoteFields(row.fields ?? {}, input.fields)
  const mergedMessageIds = [...new Set([...(row.message_ids ?? []), ...(messageIds ?? [])])]
  const { rows } = await client.query(
    `UPDATE ai_knowledge_notes
        SET fields = $2::jsonb,
            tags = $3,
            summary = CASE WHEN $4 = '' THEN summary ELSE $4 END,
            evidence = CASE WHEN $5 = '' THEN evidence ELSE $5 END,
            conversation_id = COALESCE($6, conversation_id),
            message_ids = $7,
            degraded = $8,
            -- 来源可信度只降不升：一旦有模型推断内容并进来，整条就必须标成"模型推断"，
            -- 不能因为原条目是手工写的就把后面的推断内容洗成"本人所写"
            provenance = CASE WHEN $10 = 'inferred' THEN 'inferred' ELSE provenance END,
            note_version = note_version + 1,
            merged_from = array_append(merged_from, $9),
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [
      id,
      JSON.stringify(fields),
      normalizeTags([...(row.tags ?? []), ...(input.tags ?? [])]),
      input.summary,
      input.evidence,
      conversationId,
      mergedMessageIds,
      degraded,
      row.id,
      provenance,
    ]
  )
  const note = serializeNote(rows[0])
  return { ...note, changedKeys }
}

export async function listNotes({
  userId = null,
  status = null,
  keyword = null,
  tag = null,
  from = null,
  to = null,
  page = 1,
  pageSize = 20,
} = {}) {
  const params = []
  const conditions = ['n.deleted_at IS NULL']
  if (userId !== null) {
    const scope = noteScopeSql({ id: userId }, `$${params.length + 1}`)
    conditions.push(scope.clause)
    params.push(scope.param)
  }
  if (status) {
    params.push(status)
    conditions.push(`n.status = $${params.length}`)
  }
  if (tag) {
    params.push(tag)
    conditions.push(`$${params.length} = ANY(n.tags)`)
  }
  if (keyword) {
    params.push(`%${keyword}%`)
    // 结构化字段（fields 是 JSONB）也要能搜到：员工与管理员经常按"做法/踩过的坑"里的正文找条目。
    // 先用 fields::text ILIKE 顶住（数据量小、够用）；量级上来后再评估 JSONB 索引或全文检索。
    conditions.push(
      `(n.title ILIKE $${params.length}
        OR n.summary ILIKE $${params.length}
        OR n.evidence ILIKE $${params.length}
        OR n.fields::text ILIKE $${params.length})`
    )
  }
  if (from) {
    params.push(from)
    conditions.push(`n.created_at >= $${params.length}`)
  }
  if (to) {
    params.push(to)
    conditions.push(`n.created_at <= $${params.length}`)
  }
  const where = conditions.join(' AND ')

  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM ai_knowledge_notes n WHERE ${where}`,
    params
  )
  const total = countResult.rows[0]?.total ?? 0

  const limit = Math.max(1, Math.min(Number(pageSize) || 20, 100))
  const safePage = Math.max(1, Number(page) || 1)
  const offset = (safePage - 1) * limit
  const { rows } = await query(
    `${SELECT_NOTE} WHERE ${where} ORDER BY n.updated_at DESC, n.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  )
  return { rows: rows.map(serializeNote), total, page: safePage, pageSize: limit }
}

/** 导出用：不分页，但有硬上限（防止一次导出把内存打满）。 */
export async function listNotesForExport(filters = {}) {
  const limited = { ...filters, page: 1, pageSize: 100 }
  const { rows, total } = await listNotes(limited)
  if (total <= 100) return rows
  const all = [...rows]
  let page = 2
  while (all.length < total && page <= 20) {
    const next = await listNotes({ ...filters, page, pageSize: 100 })
    all.push(...next.rows)
    page += 1
  }
  return all.slice(0, 2000)
}

async function fetchNoteRow(id) {
  const { rows } = await query(`${SELECT_NOTE} WHERE n.id = $1`, [id])
  return rows[0] ?? null
}

/**
 * 员工侧单条读取：只有所有者能拿到，他人条目（含管理员看他人）一律返回 null → 路由 404。
 * 管理员要查看/管理他人条目只能走 getAdminNote（/api/ai/distill/*），那里有 audit 留痕。
 */
export async function getOwnedNote({ id, user }) {
  const row = await fetchNoteRow(id)
  if (!canOwnNote(user, row)) return null
  return serializeNote(row)
}

/** 管理侧单条读取：仅启用状态的管理员可见（软删条目仍不可见）。 */
export async function getAdminNote({ id, user }) {
  const row = await fetchNoteRow(id)
  if (!canManageNote(user, row)) return null
  return serializeNote(row)
}

/** 所有者动作文案（用于守卫报错，避免路由里散落角色判断）。 */
export const NOTE_OWNER_ACTIONS = {
  update: '修改',
  submit: '提交审核',
  archive: '归档',
  delete: '删除',
  restore: '取回',
}

/**
 * 所有者动作守卫（第二道保险）。
 *
 * 员工接口先用 getOwnedNote 过滤（他人条目按不存在返回 404），本函数再断言一次 —
 * 目的是防止后续有人把查询换成管理视图后静默放开越权写：
 * 那等于让管理员借员工接口替员工提交/修改内容，绕过管理动作的审计口径。
 */
export function assertOwnerAction({ note, user, action = 'update' }) {
  if (!note || note.ownerUserId !== user?.id) {
    throw new NoteValidationError(
      `只有沉淀的所有者可以${NOTE_OWNER_ACTIONS[action] ?? '操作'}该条目。`
    )
  }
}

/** 按 scope 解析可写条目：self = 所有者视角，admin = 管理视角。 */
async function resolveWritableNote({ id, user, scope }) {
  return scope === 'admin' ? getAdminNote({ id, user }) : getOwnedNote({ id, user })
}

export async function updateNote({ id, user, patch = {}, scope = 'self' }) {
  const current = await resolveWritableNote({ id, user, scope })
  if (!current) return null
  if (scope === 'self') assertOwnerAction({ note: current, user, action: 'update' })
  // pending 只挡员工：审核期间员工改内容 = 审核人看到的和实际提交的不是同一版。
  // 管理员在管理页修正待审条目是允许的，但必须写审计（路由层负责），且不能改状态。
  if (scope === 'self' && current.status === NOTE_STATUS.pending) {
    throw new NoteConflictError(
      '待审核的沉淀不能修改（审核人看到的必须是你提交的那一版）。如需修改请先归档后重新提交。'
    )
  }
  if (current.status === NOTE_STATUS.published) {
    throw new NoteConflictError('已发布到知识库的沉淀不能直接修改，请先归档。')
  }
  // 会话来源条目的原文依据被改动时必须重新核对（未改动不校验：
  // 加固前历史条目里可能存着模型改写过的引句，不能因为改个标签就让员工无路可走）
  if (
    current.sourceKind === 'conversation' &&
    current.conversationId &&
    typeof patch.evidence === 'string' &&
    patch.evidence.trim() !== String(current.evidence ?? '').trim()
  ) {
    await assertConversationEvidence({
      user,
      conversationId: current.conversationId,
      evidence: patch.evidence,
    })
  }
  const normalized = normalizeNoteInput({
    title: patch.title ?? current.title,
    summary: patch.summary ?? current.summary,
    evidence: patch.evidence ?? current.evidence,
    fields: patch.fields ?? current.fields,
    tags: patch.tags ?? current.tags,
    // provenance 只做枚举校验，**不落库**：它由服务端按来源推导（见 deriveProvenance），
    // 客户端传什么都不允许改判（否则员工可以把模型推断洗成"本人所写"）
    provenance: patch.provenance ?? current.provenance,
  })
  const { rows } = await query(
    `UPDATE ai_knowledge_notes
        SET title = $2, summary = $3, evidence = $4, fields = $5::jsonb, tags = $6,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [
      id,
      normalized.title,
      normalized.summary,
      normalized.evidence,
      JSON.stringify(normalized.fields),
      normalized.tags,
    ]
  )
  return serializeNote(rows[0])
}

/**
 * 状态流转。
 * 权限：scope='self' 时必须由所有者发起（员工接口），scope='admin' 时必须是管理员（管理接口）。
 * 审核动作会记录 reviewed_by / reviewed_at / review_comment（驳回的原因必须保留给提报人看）。
 */
export async function transitionNote({
  id,
  user,
  to,
  comment = null,
  scope = 'self',
  action = null,
}) {
  const current = await resolveWritableNote({ id, user, scope })
  if (!current) return null
  if (scope === 'self') {
    assertOwnerAction({ note: current, user, action: action ?? transitionActionName(to) })
  }
  // 员工接口不具备管理员特权（即使是管理员账号操作自己的条目）：
  // "员工代管理员审核" 这条路必须断掉，管理动作一律走 /api/ai/distill/*
  const isAdmin = scope === 'admin' && isEnabledAdmin(user)
  assertTransition(current.status, to, { isAdmin })
  const isReview = to === NOTE_STATUS.published || to === NOTE_STATUS.rejected

  // 归档「已发布」条目时必须同事务把公共文档一起下线。
  //
  // 为什么：审核通过会生成 source_type='experience'、status='active' 的公共文档；
  // 若归档只改条目状态，文档会继续被检索、被引用、被要求声明数据截至，
  // 而管理页再也无法从文档回溯到来源条目（source_ref 指向已归档行）——「发布」事实上不可撤销。
  if (to === NOTE_STATUS.archived && current.publishedDocumentId) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        `UPDATE ai_knowledge_notes
            SET status = $2,
                updated_at = NOW()
          WHERE id = $1
          RETURNING *`,
        [id, to]
      )
      await deactivateDocument({ documentId: current.publishedDocumentId, actorId: user.id, client })
      await client.query('COMMIT')
      return serializeNote(rows[0])
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  const { rows } = await query(
    `UPDATE ai_knowledge_notes
        SET status = $2,
            reviewed_by = CASE WHEN $3 THEN $4 ELSE reviewed_by END,
            reviewed_at = CASE WHEN $3 THEN NOW() ELSE reviewed_at END,
            review_comment = CASE WHEN $3 THEN $5 ELSE review_comment END,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, to, isReview, user.id, comment]
  )
  return serializeNote(rows[0])
}

function transitionActionName(to) {
  if (to === NOTE_STATUS.pending) return 'submit'
  if (to === NOTE_STATUS.archived) return 'archive'
  if (to === NOTE_STATUS.private) return 'restore'
  return 'update'
}

/**
 * 软删：置 deleted_at，保留行供审计。
 *
 * 已发布条目**不允许**删除：它对应的 experience 文档已经进入公共知识库并可能被引用，
 * 直接删条目会让文档变成无主知识、review 记录也无法从文档回溯（updateNote 有同样的守卫）。
 * 需要下架请先归档——归档会连同公共文档一起下线。
 */
export async function deleteNote({ id, user, scope = 'self' }) {
  const current = await resolveWritableNote({ id, user, scope })
  if (!current) return null
  if (scope === 'self') assertOwnerAction({ note: current, user, action: 'delete' })
  if (current.status === NOTE_STATUS.published) {
    throw new NoteConflictError('已发布到知识库的沉淀不能删除，请先归档（归档会同时下线对应的公共文档）。')
  }
  await query('UPDATE ai_knowledge_notes SET deleted_at = NOW() WHERE id = $1', [id])
  return current
}

/**
 * 把已通过的沉淀发布进公共知识库（幂等）。
 *
 * 幂等键用 source_ref = 'note:<id>'：重复审核通过（或迁移重跑）不会产生第二份文档。
 * created_by 记审核管理员（操作人），owner_user_id 记提报员工（归属），两者语义不同不能混。
 *
 * 三点必须一起理解：
 * 1. 调用方已在事务里锁住 note 行，因此"先查后插"不会有两个事务同时走到 INSERT；
 *    ai_documents 上 experience + source_ref 的唯一索引是最后一道兜底。
 * 2. 若同 key 文档存在但已 inactive，重新启用而不是插新的一份——否则会留下
 *   "条目已发布、却没有任何生效文档"的坏状态。
 * 3. 新修订审核通过时用 supersedesDocumentId 让旧版本文档失效，
 *   避免同一标题在知识库里长期存在两份互相矛盾的"员工经验"。
 */
export async function publishNoteDocument({ note, reviewerId, text, client, supersedesDocumentId = null }) {
  const run = client ? (sql, params) => client.query(sql, params) : (sql, params) => query(sql, params)
  const sourceRef = `note:${note.id}`
  const existing = await run(
    `SELECT id, status FROM ai_documents
      WHERE source_ref = $1 AND source_type = 'experience'
      ORDER BY id LIMIT 1`,
    [sourceRef]
  )
  if (existing.rows[0]) {
    await run(
      `UPDATE ai_documents
          SET owner_user_id = COALESCE(owner_user_id, $2),
              status = 'active',
              updated_at = NOW()
        WHERE id = $1`,
      [existing.rows[0].id, note.ownerUserId]
    )
    return existing.rows[0].id
  }
  const document = await ingestDocument({
    title: note.title,
    text,
    sourceType: 'experience',
    sourceRef,
    category: '员工经验',
    createdBy: reviewerId,
    supersedesDocumentId,
    client: client ?? null,
  })
  await run('UPDATE ai_documents SET owner_user_id = $2 WHERE id = $1', [
    document.id,
    note.ownerUserId,
  ])
  return document.id
}

/**
 * 审核（通过 / 驳回）：**行锁 + 单事务**。
 *
 * 不变式：审核通过要么完整生成并关联公共文档，要么条目保持 pending 可重试；
 * 不允许出现"已发布但没有文档"，也不允许并发审核生成两份 source_ref = note:<id> 的文档。
 *
 * 事务边界包含：状态更新、文档生成、published_document_id 关联、审计写入。
 * 任一步失败整体回滚 → 条目仍是 pending，管理员可以重新审核（幂等键保证不会重复建文档）。
 */
export async function reviewNote({
  id,
  user,
  decision,
  comment = null,
  fields = [],
  ip = null,
}) {
  const to = decision === 'approve' ? NOTE_STATUS.published : NOTE_STATUS.rejected
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // 锁住这一行：并发的第二个审核请求会在这里排队，拿到最新状态后被下面的 pending 校验拒绝
    const locked = await client.query(
      `SELECT n.*, u.login AS owner_login, u.name AS owner_name, r.name AS reviewer_name
         FROM ai_knowledge_notes n
         JOIN users u ON u.id = n.owner_user_id
         LEFT JOIN users r ON r.id = n.reviewed_by
        WHERE n.id = $1 AND n.deleted_at IS NULL
        FOR UPDATE OF n`,
      [id]
    )
    const row = locked.rows[0]
    if (!row) {
      await client.query('ROLLBACK')
      return null
    }
    if (!isEnabledAdmin(user)) {
      await client.query('ROLLBACK')
      throw new NoteValidationError('仅管理员可审核沉淀。')
    }
    if (row.status !== NOTE_STATUS.pending) {
      await client.query('ROLLBACK')
      throw new NoteConflictError(
        `该沉淀当前状态为「${NOTE_STATUS_LABELS[row.status] ?? row.status}」，无法审核（可能已被其他人处理，请刷新后重试）。`
      )
    }

    const note = serializeNote(row)
    let documentId = null
    // 新修订：审核通过时让旧版本那份公共文档失效（不删除，仅停止被引用），
    // 否则同一标题会在知识库里长期存在两份互相矛盾的「员工经验」
    const supersededDocumentId = decision === 'approve' ? await resolveSupersededDocument({ client, note }) : null
    if (decision === 'approve') {
      documentId = await publishNoteDocument({
        note,
        reviewerId: user.id,
        text: notesToMarkdown([note], { fields }).replace(/^<!-- 知识沉淀导出 -->\s*/, ''),
        client,
        supersedesDocumentId: supersededDocumentId,
      })
    }

    const updated = await client.query(
      `UPDATE ai_knowledge_notes
          SET status = $2,
              reviewed_by = $3,
              reviewed_at = NOW(),
              review_comment = $4,
              published_document_id = COALESCE($5, published_document_id),
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, to, user.id, comment, documentId]
    )

    await recordAudit({
      actorId: user.id,
      action: AUDIT_ACTIONS.noteReview,
      targetType: 'ai_knowledge_note',
      targetId: id,
      detail: {
        decision,
        noteTitle: note.title,
        ownerUserId: note.ownerUserId,
        documentId,
        supersededDocumentId,
        revisionOfNoteId: note.revisionOfNoteId,
        hasComment: Boolean(comment),
        provenance: note.provenance,
      },
      ip,
      client,
    })

    await client.query('COMMIT')
    return { note: serializeNote(updated.rows[0]), documentId }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/** 新修订审核通过时，需要让旧版本那份公共文档失效（不删除，仅停止被引用）。 */
async function resolveSupersededDocument({ client, note }) {
  if (!note.revisionOfNoteId) return null
  const { rows } = await client.query(
    `SELECT published_document_id FROM ai_knowledge_notes WHERE id = $1`,
    [note.revisionOfNoteId]
  )
  const documentId = rows[0]?.published_document_id ?? null
  if (!documentId) return null
  if (documentId === note.publishedDocumentId) return null
  return documentId
}

/**
 * 每日配额判定（纯函数）。
 *
 * limit = 0 表示**关闭配额限制**（不是"一次都不许"）：界面上这个值由用户自己设置，
 * 若把 0 解释成禁止，用户把数字调到 0 时会以为功能坏了。
 */
export function isQuotaReached({ used, limit } = {}) {
  const safeLimit = Number(limit)
  if (!Number.isFinite(safeLimit) || safeLimit <= 0) return false
  return Number(used ?? 0) >= safeLimit
}

/**
 * 每日配额：统计今天（服务器时区）该账号**真实发起过的 AI 整理次数**。
 *
 * 为什么不用 ai_knowledge_notes 计数：手工新建的沉淀同样会落那张表，
 * 按条数计会把"手工新建不消耗配额"的承诺打破（实测：连续跑几轮验收就误报超限）。
 * 抽取草稿本身不落库，因此计数依据走审计记录（action = note_distill）——
 * 零新表，且"什么时候谁消耗了几次模型调用"天然可查。
 */
/**
 * 每日配额：统计今天（服务器时区）该账号**真实发起过的 AI 整理次数**。
 *
 * 为什么不用 ai_knowledge_notes 计数：手工新建的沉淀同样会落那张表，
 * 按条数计会把"手工新建不消耗配额"的承诺打破（实测：连续跑几轮验收就误报超限）。
 * 抽取草稿本身不落库，因此计数依据走审计记录（action = note_distill）——
 * 零新表，且"什么时候谁消耗了几次模型调用"天然可查。
 *
 * ⚠️ 只用于**展示与对账**（如审计台核对用量）。配额判定必须走 reserveDistillQuota，
 * 那里在同一个事务与 advisory 锁内完成"计数 + 预占"，本函数单独使用不具备并发安全性。
 */
export async function countDistillCallsToday({ userId }) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total
       FROM ai_audit_logs
      WHERE actor_id = $1 AND action = 'note_distill' AND created_at >= date_trunc('day', NOW())`,
    [userId]
  )
  return rows[0]?.total ?? 0
}

/** 配额预占用的咨询锁命名空间（classid），避免与其它模块的 advisory lock 撞号。 */
export const DISTILL_QUOTA_LOCK_NAMESPACE = 2026

/**
 * 每日配额**预占**（并发安全）。
 *
 * 原先的实现是"先数今天几次 → 再调模型"，两个并发请求会同时通过检查，
 * 于是配额 1 也能真发出两次模型调用（实测踩到）。这里改成短事务预占：
 *   1. 按账号加 advisory 事务锁 → 同一账号的并发请求串行化；
 *   2. 在锁内数今天的次数并判定；
 *   3. 通过则**先写入本次的 note_distill 审计行**（审计行就是计数器），再放行去调模型。
 *
 * 为什么用审计行当计数器：零新表、天然可查"谁在什么时候消耗了几次模型调用"，
 * 并且模型调用失败也照样计数（预占发生在调用之前）——这与产品口径一致。
 * limit = 0 表示不限制（isQuotaReached 已处理）。
 */
export async function reserveDistillQuota({ userId, limit, ip = null }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
      DISTILL_QUOTA_LOCK_NAMESPACE,
      userId,
    ])
    const counted = await client.query(
      `SELECT COUNT(*)::int AS total
         FROM ai_audit_logs
        WHERE actor_id = $1 AND action = 'note_distill' AND created_at >= date_trunc('day', NOW())`,
      [userId]
    )
    const used = counted.rows[0]?.total ?? 0
    if (isQuotaReached({ used, limit })) {
      await client.query('ROLLBACK')
      return { allowed: false, used, limit }
    }
    const inserted = await client.query(
      `INSERT INTO ai_audit_logs (actor_id, action, target_type, target_id, detail, ip)
       VALUES ($1, $2, 'ai_conversation', $3, $4::jsonb, $5)
       RETURNING id`,
      [
        userId,
        AUDIT_ACTIONS.noteDistill,
        null,
        JSON.stringify({ phase: 'reserved' }),
        ip,
      ]
    )
    await client.query('COMMIT')
    return { allowed: true, used: used + 1, limit, auditId: inserted.rows[0].id }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/**
 * 补全预占行的明细（模型调用之后）。
 * 只更新同一行、不新增行：一次整理 = 一条审计，计数口径才不会飘。
 */
export async function completeDistillAudit({ auditId, conversationId, detail = {} }) {
  if (!auditId) return
  await query(
    `UPDATE ai_audit_logs
        SET target_id = $2, detail = detail || $3::jsonb
      WHERE id = $1`,
    [auditId, conversationId === null ? null : String(conversationId), JSON.stringify(detail ?? {})]
  )
}

/** 管理员视图的汇总：总量、待审核量与按账号分布。 */
export async function listNoteStats() {
  const totals = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE status = 'published')::int AS published,
            COUNT(*) FILTER (WHERE status = 'private')::int AS private,
            COUNT(DISTINCT owner_user_id)::int AS accounts
       FROM ai_knowledge_notes
      WHERE deleted_at IS NULL`
  )
  const byAccount = await query(
    `SELECT n.owner_user_id, u.login, u.name,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE n.status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE n.status = 'published')::int AS published,
            MAX(n.updated_at) AS last_at
       FROM ai_knowledge_notes n
       JOIN users u ON u.id = n.owner_user_id
      WHERE n.deleted_at IS NULL
      GROUP BY n.owner_user_id, u.login, u.name
      ORDER BY total DESC, n.owner_user_id`
  )
  const row = totals.rows[0] ?? {}
  return {
    total: row.total ?? 0,
    pending: row.pending ?? 0,
    published: row.published ?? 0,
    private: row.private ?? 0,
    accounts: row.accounts ?? 0,
    byAccount: byAccount.rows.map((item) => ({
      userId: item.owner_user_id,
      login: item.login,
      name: item.name,
      total: item.total,
      pending: item.pending,
      published: item.published,
      lastAt: item.last_at,
    })),
  }
}

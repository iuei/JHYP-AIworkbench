/**
 * 审计模块（需求文档 §5.4 / §7.1）。
 *
 * 原则：
 * 1. 审计写入在**编排层强制发生**，前端无法跳过；
 * 2. 审计记录**不提供删除入口**，长期保留、不自动清理；
 * 3. 写入失败必须抛错，禁止吞异常——审计静默失败比抛错更危险。
 */
import { query } from '../db.mjs'

export const AUDIT_ACTIONS = {
  login: 'login',
  docUpload: 'doc_upload',
  docOffline: 'doc_offline',
  docOnline: 'doc_online',
  docDelete: 'doc_delete',
  reindex: 'reindex',
  auditExport: 'audit_export',
  feedback: 'feedback',
  toolBlocked: 'tool_blocked',
  forbidden: 'forbidden',
  injectionDetected: 'injection_detected',
  settingsUpdate: 'settings_update',
  import: 'import',
  // 知识沉淀（账号级）：创建、修改、提交审核、审核、归档、删除、导出、技能配置
  noteCreate: 'note_create',
  noteUpdate: 'note_update',
  noteSubmit: 'note_submit',
  noteReview: 'note_review',
  noteArchive: 'note_archive',
  noteDelete: 'note_delete',
  noteExport: 'note_export',
  noteDistill: 'note_distill',
  skillConfig: 'skill_config',
}

export const RUN_STATUS = {
  pending: 'pending',
  ok: 'ok',
  blocked: 'blocked',
  error: 'error',
}

function safeStringify(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

/**
 * 把任意值压成可用于 result_summary 的单行文本，超长截断。
 * 工具返回值可能很大，审计只留摘要，明细靠引用与日志追溯。
 */
export function summarizeValue(value, max = 200) {
  if (value === null || value === undefined) return ''
  const text = safeStringify(value).replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

function normalizationId(value) {
  if (value === null || value === undefined || value === '') return null
  return String(value)
}

/**
 * 写入管理动作 / 安全事件审计。
 *
 * `client`：可选的数据库连接/事务 client。审核通过这类"状态变更 + 文档生成 + 审计"
 * 必须原子发生的场景会传入事务 client——审计写不进去就整体回滚，
 * 不会出现"条目已发布但没留下是谁批的"这种断链。
 */
export async function recordAudit({
  actorId = null,
  action,
  targetType = null,
  targetId = null,
  detail = {},
  ip = null,
  client = null,
}) {
  if (typeof action !== 'string' || !action) {
    throw new Error('审计动作不能为空')
  }
  const run = client ? (text, params) => client.query(text, params) : query
  await run(
    `INSERT INTO ai_audit_logs (actor_id, action, target_type, target_id, detail, ip)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      actorId ?? null,
      action,
      targetType,
      normalizationId(targetId),
      JSON.stringify(detail ?? {}),
      ip,
    ]
  )
}

/**
 * 落库一次工具调用（status = pending）。
 * 编排层在**执行工具之前**调用，保证被拦截与失败的调用同样留痕。
 */
export async function startRun({ messageId, userId, toolName, params = {} }) {
  const { rows } = await query(
    `INSERT INTO ai_runs (message_id, user_id, tool_name, params, status)
     VALUES ($1, $2, $3, $4::jsonb, 'pending')
     RETURNING id`,
    [messageId, userId, toolName, JSON.stringify(params ?? {})]
  )
  return rows[0].id
}

/** 收尾一次工具调用：成功 / 被拦截 / 失败都必须调用。 */
export async function finishRun(
  runId,
  { status, resultSummary = null, rowCount = null, error = null, latencyMs = null }
) {
  if (!Object.hasOwn(RUN_STATUS, status) || status === RUN_STATUS.pending) {
    throw new Error(`无效的工具调用状态：${status}`)
  }
  await query(
    `UPDATE ai_runs
        SET status = $1, result_summary = $2, row_count = $3, error = $4, latency_ms = $5
      WHERE id = $6`,
    [status, resultSummary, rowCount, error, latencyMs, runId]
  )
}

/** 会话轨迹查询（审计台）。 */
export async function listConversationTraces({
  userId = null,
  keyword = null,
  from = null,
  to = null,
  limit = 50,
  offset = 0,
} = {}) {
  const { rows } = await query(
    `SELECT c.id, c.title, c.message_count, c.created_at, c.last_message_at,
            u.id AS user_id, u.login, u.name, u.role
       FROM ai_conversations c
       JOIN users u ON u.id = c.user_id
      WHERE ($1::int IS NULL OR c.user_id = $1)
        AND ($2::text IS NULL OR EXISTS (
              SELECT 1 FROM ai_messages m
               WHERE m.conversation_id = c.id AND m.content ILIKE '%' || $2 || '%'
            ))
        AND ($3::timestamptz IS NULL OR c.created_at >= $3)
        AND ($4::timestamptz IS NULL OR c.created_at <= $4)
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
      LIMIT $5 OFFSET $6`,
    [userId, keyword, from, to, limit, offset]
  )
  return rows
}

/** 会话完整轨迹：消息 + 每步工具调用（用于 §7.3 审计回溯）。 */
export async function loadConversationTrace(conversationId) {
  const messages = await query(
    `SELECT id, role, content, provider, model, tokens_in, tokens_out,
            latency_ms, status, citations, created_at
       FROM ai_messages
      WHERE conversation_id = $1
      ORDER BY id ASC`,
    [conversationId]
  )
  const runs = await query(
    `SELECT r.id, r.message_id, r.user_id, r.tool_name, r.params, r.result_summary,
            r.row_count, r.status, r.error, r.latency_ms, r.created_at
       FROM ai_runs r
       JOIN ai_messages m ON m.id = r.message_id
      WHERE m.conversation_id = $1
      ORDER BY r.id ASC`,
    [conversationId]
  )
  return { messages: messages.rows, runs: runs.rows }
}

/** 工具调用明细查询（含被拦截记录）。 */
export async function listRuns({
  userId = null,
  toolName = null,
  status = null,
  keyword = null,
  from = null,
  to = null,
  limit = 50,
  offset = 0,
} = {}) {
  const { rows } = await query(
    `SELECT r.id, r.message_id, r.tool_name, r.params, r.result_summary, r.row_count,
            r.status, r.error, r.latency_ms, r.created_at,
            u.id AS user_id, u.login, u.name, u.role
       FROM ai_runs r
       JOIN users u ON u.id = r.user_id
      WHERE ($1::int IS NULL OR r.user_id = $1)
        AND ($2::text IS NULL OR r.tool_name = $2)
        AND ($3::text IS NULL OR r.status = $3)
        AND ($4::text IS NULL OR r.tool_name ILIKE '%' || $4 || '%'
             OR r.params::text ILIKE '%' || $4 || '%')
        AND ($5::timestamptz IS NULL OR r.created_at >= $5)
        AND ($6::timestamptz IS NULL OR r.created_at <= $6)
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT $7 OFFSET $8`,
    [userId, toolName, status, keyword, from, to, limit, offset]
  )
  return rows
}

/** 管理动作日志查询。 */
export async function listAuditLogs({
  actorId = null,
  action = null,
  keyword = null,
  from = null,
  to = null,
  limit = 100,
  offset = 0,
} = {}) {
  const { rows } = await query(
    `SELECT l.id, l.action, l.target_type, l.target_id, l.detail, l.ip, l.created_at,
            u.id AS actor_id, u.login, u.name, u.role
       FROM ai_audit_logs l
       LEFT JOIN users u ON u.id = l.actor_id
      WHERE ($1::int IS NULL OR l.actor_id = $1)
        AND ($2::text IS NULL OR l.action = $2)
        AND ($3::text IS NULL OR l.detail::text ILIKE '%' || $3 || '%'
             OR COALESCE(l.target_id, '') ILIKE '%' || $3 || '%')
        AND ($4::timestamptz IS NULL OR l.created_at >= $4)
        AND ($5::timestamptz IS NULL OR l.created_at <= $5)
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $6 OFFSET $7`,
    [actorId, action, keyword, from, to, limit, offset]
  )
  return rows
}

/** token 用量统计（按人按天聚合，不额外建表）。 */
export async function usageByDay({ days = 14 } = {}) {
  const { rows } = await query(
    `SELECT date_trunc('day', m.created_at)::date AS day,
            COUNT(*) FILTER (WHERE m.role = 'assistant') AS answers,
            COALESCE(SUM(m.tokens_in), 0) AS tokens_in,
            COALESCE(SUM(m.tokens_out), 0) AS tokens_out
       FROM ai_messages m
      WHERE m.created_at >= NOW() - ($1::int || ' days')::interval
      GROUP BY 1
      ORDER BY 1 DESC`,
    [days]
  )
  return rows
}

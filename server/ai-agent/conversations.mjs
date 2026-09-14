/**
 * 对话与消息的持久化（会话、消息、引用、工具轨迹、反馈）。
 *
 * 拆出本文件是为了让 orchestrator.mjs 只关心编排逻辑，DB 读写集中在这里，
 * 单测时可以直接覆盖这些方法而不碰数据库。
 */
import { pool, query } from '../db.mjs'

export const DEFAULT_CONVERSATION_TITLE = '新会话'
export const MAX_TITLE_LENGTH = 200

export function deriveTitle(question) {
  const text = String(question ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return DEFAULT_CONVERSATION_TITLE
  return text.length > 24 ? `${text.slice(0, 24)}…` : text
}

function normalizeTitle(title) {
  const text = String(title ?? '').trim()
  if (!text) return DEFAULT_CONVERSATION_TITLE
  return text.slice(0, MAX_TITLE_LENGTH)
}

/** 取会话；conversationId 不存在或不属于该用户时新建（防止越权读写他人会话）。 */
export async function ensureConversation({ userId, conversationId = null, title }) {
  const id = Number(conversationId)
  if (Number.isInteger(id) && id > 0) {
    const { rows } = await query(
      `SELECT id, user_id, title, message_count FROM ai_conversations WHERE id = $1 AND user_id = $2`,
      [id, userId]
    )
    if (rows[0]) return { ...rows[0], created: false }
  }
  const { rows } = await query(
    `INSERT INTO ai_conversations (user_id, title, last_message_at)
     VALUES ($1, $2, NOW())
     RETURNING id, user_id, title, message_count`,
    [userId, normalizeTitle(title)]
  )
  return { ...rows[0], created: true }
}

export async function countAssistantTurns(conversationId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS turns FROM ai_messages WHERE conversation_id = $1 AND role = 'assistant'`,
    [conversationId]
  )
  return rows[0]?.turns ?? 0
}

/** 取最近的历史消息（用于上下文组装，不含本轮提问）。 */
export async function loadHistory({ conversationId, limit = 10 }) {
  const { rows } = await query(
    `SELECT role, content FROM (
       SELECT role, content, id FROM ai_messages
        WHERE conversation_id = $1 AND role IN ('user', 'assistant')
        ORDER BY id DESC LIMIT $2
     ) recent ORDER BY id ASC`,
    [conversationId, limit]
  )
  return rows
}

/** 追加一条消息并维护会话计数、标题与最后活跃时间。 */
export async function appendMessage({
  conversationId,
  role,
  content,
  status = 'ok',
  provider = null,
  model = null,
  tokensIn = null,
  tokensOut = null,
  latencyMs = null,
  citations = [],
  blocks = [],
}) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `INSERT INTO ai_messages
         (conversation_id, role, content, status, provider, model, tokens_in, tokens_out, latency_ms, citations, blocks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
       RETURNING id, conversation_id, role, content, status, created_at`,
      [
        conversationId,
        role,
        content,
        status,
        provider,
        model,
        tokensIn,
        tokensOut,
        latencyMs,
        JSON.stringify(citations ?? []),
        JSON.stringify(blocks ?? []),
      ]
    )
    await client.query(
      `UPDATE ai_conversations
          SET message_count = message_count + 1,
              last_message_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [conversationId]
    )
    await client.query('COMMIT')
    return rows[0]
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/** 会话列表：置顶优先，其余按最后活跃时间倒序。 */
export async function listConversations(userId, { keyword = null, limit = 100 } = {}) {
  const { rows } = await query(
    `SELECT c.id, c.title, c.message_count, c.pinned, c.created_at, c.updated_at, c.last_message_at,
            (SELECT COUNT(*)::int FROM ai_messages m
              WHERE m.conversation_id = c.id AND m.role = 'assistant' AND m.status <> 'ok') AS problem_count
       FROM ai_conversations c
      WHERE c.user_id = $1
        AND ($2::text IS NULL OR c.title ILIKE '%' || $2 || '%')
      ORDER BY c.pinned DESC, COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC
      LIMIT $3`,
    [userId, keyword, limit]
  )
  return rows
}

export async function findConversation(userId, conversationId) {
  const { rows } = await query(
    `SELECT id, user_id, title, message_count, pinned, created_at, updated_at, last_message_at
       FROM ai_conversations WHERE id = $1 AND user_id = $2`,
    [conversationId, userId]
  )
  return rows[0] ?? null
}

export async function renameConversation({ userId, conversationId, title, pinned = null }) {
  const fields = []
  const params = [conversationId, userId]
  if (title !== undefined && title !== null) {
    params.push(normalizeTitle(title))
    fields.push(`title = $${params.length}`)
  }
  if (pinned !== null) {
    params.push(Boolean(pinned))
    fields.push(`pinned = $${params.length}`)
  }
  if (fields.length === 0) {
    return findConversation(userId, conversationId)
  }
  fields.push('updated_at = NOW()')
  const { rows } = await query(
    `UPDATE ai_conversations SET ${fields.join(', ')}
      WHERE id = $1 AND user_id = $2
      RETURNING id, title, pinned, message_count, updated_at`,
    params
  )
  return rows[0] ?? null
}

export async function deleteConversation({ userId, conversationId }) {
  const { rows } = await query(
    `DELETE FROM ai_conversations WHERE id = $1 AND user_id = $2 RETURNING id`,
    [conversationId, userId]
  )
  return rows[0] ?? null
}

/** 会话消息 + 每条回答的工具轨迹（引用面板数据源）。 */
export async function listMessages({ userId, conversationId }) {
  const conversation = await findConversation(userId, conversationId)
  if (!conversation) return null
  const messages = await query(
    `SELECT id, role, content, provider, model, tokens_in, tokens_out, latency_ms,
            status, citations, blocks, created_at
       FROM ai_messages WHERE conversation_id = $1 ORDER BY id ASC`,
    [conversationId]
  )
  const runs = await query(
    `SELECT r.id, r.message_id, r.tool_name, r.params, r.result_summary, r.row_count,
            r.status, r.error, r.latency_ms, r.created_at
       FROM ai_runs r
       JOIN ai_messages m ON m.id = r.message_id
      WHERE m.conversation_id = $1
      ORDER BY r.id ASC`,
    [conversationId]
  )
  const runsByMessage = new Map()
  for (const run of runs.rows) {
    const list = runsByMessage.get(run.message_id) ?? []
    list.push(run)
    runsByMessage.set(run.message_id, list)
  }

  // 工具轨迹在库中挂在**提问消息**上（编排层的锚点；回答消息在流程末尾才创建）。
  // 展示时归到紧随其后的回答上，前端「本次回答的依据」才能拿到本次的工具调用。
  let turnAnchorId = null
  return {
    conversation,
    messages: messages.rows.map((message) => {
      if (message.role === 'user') {
        turnAnchorId = message.id
        return { ...message, runs: [] }
      }
      const turnRuns = turnAnchorId ? (runsByMessage.get(turnAnchorId) ?? []) : []
      turnAnchorId = null
      return { ...message, runs: turnRuns }
    }),
  }
}

export async function saveFeedback({ messageId, userId, type, comment = null }) {
  const { rows } = await query(
    `INSERT INTO ai_feedback (message_id, user_id, type, comment)
     VALUES ($1, $2, $3, $4)
     RETURNING id, message_id, type, comment, handled, created_at`,
    [messageId, userId, type, comment]
  )
  return rows[0]
}

/** 确认该回答消息属于当前用户（反馈接口做归属校验，防止给别人的回答打反馈）。 */
export async function findMessageOwnedByUser({ messageId, userId }) {
  const { rows } = await query(
    `SELECT m.id, m.conversation_id, m.role, m.status, m.citations
       FROM ai_messages m
       JOIN ai_conversations c ON c.id = m.conversation_id
      WHERE m.id = $1 AND c.user_id = $2`,
    [messageId, userId]
  )
  return rows[0] ?? null
}

/** 知识库页的纠错反馈闭环：待处理反馈列表。 */
export async function listUnhandledFeedback({ limit = 50 } = {}) {
  const { rows } = await query(
    `SELECT f.id, f.type, f.comment, f.created_at, f.message_id,
            m.content AS answer_content, m.citations,
            u.name AS reporter_name, u.login AS reporter_login,
            c.id AS conversation_id
       FROM ai_feedback f
       JOIN ai_messages m ON m.id = f.message_id
       JOIN ai_conversations c ON c.id = m.conversation_id
       JOIN users u ON u.id = f.user_id
      WHERE f.handled = false
      ORDER BY f.created_at DESC
      LIMIT $1`,
    [limit]
  )
  return rows
}

export async function markFeedbackHandled(feedbackId) {
  const { rows } = await query(
    `UPDATE ai_feedback SET handled = true WHERE id = $1 RETURNING id, handled`,
    [feedbackId]
  )
  return rows[0] ?? null
}

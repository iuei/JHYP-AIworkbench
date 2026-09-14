/**
 * 对话接口：SSE 流式问答 + 会话/消息 CRUD + 反馈 + 工具清单。
 *
 * 流式接口不使用 axios 默认拦截器（前端见 src/features/ai-agent/sse.ts），
 * 这里用 text/event-stream + 单通道 data 事件（事件体内带 type 字段）。
 */
import express from 'express'
import { recordAudit } from './audit.mjs'
import * as repo from './conversations.mjs'
import { clientIp, handleAiError, optionalString } from './http-utils.mjs'
import { loadSettings } from './knowledge.mjs'
import { ERROR_CODE, OrchestratorError, runChat } from './orchestrator.mjs'
import { describeProvider, resolveProvider } from './providers/index.mjs'
import { loadRegisteredTools } from './tools.mjs'

const FEEDBACK_TYPES = new Set(['helpful', 'unhelpful', 'correction'])

/**
 * 每个账号同时进行的问答流上限。
 *
 * 为什么需要：SSE 端点本身没有并发限制，而一次问答最坏会跑完 MAX_TOOL_ROUNDS 轮模型调用
 * 并长期占用数据库连接；同一个人多开几个标签页、或脚本并发打接口，就能把连接池与模型配额
 * 一起耗光，其他人的请求全部排队。超过上限直接 429，而不是让所有人一起变慢。
 */
const MAX_INFLIGHT_CHAT_PER_USER = Number(process.env.AI_CHAT_MAX_INFLIGHT ?? 3)

/** userId → 正在进行的问答数。 */
const inflightChats = new Map()

function acquireChatSlot(userId) {
  const current = inflightChats.get(userId) ?? 0
  if (current >= MAX_INFLIGHT_CHAT_PER_USER) return false
  inflightChats.set(userId, current + 1)
  return true
}

function releaseChatSlot(userId) {
  const current = inflightChats.get(userId) ?? 0
  if (current <= 1) inflightChats.delete(userId)
  else inflightChats.set(userId, current - 1)
}

function resourceId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function serializeMessage(message) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    status: message.status,
    provider: message.provider,
    model: message.model,
    tokensIn: message.tokens_in,
    tokensOut: message.tokens_out,
    latencyMs: message.latency_ms,
    citations: message.citations ?? [],
    // 结构化数据块（表格/趋势图/指标卡）：漏返回的话前端就只剩文字结论，表格与图都出不来
    blocks: message.blocks ?? [],
    createdAt: message.created_at,
    runs: (message.runs ?? []).map((run) => ({
      id: run.id,
      toolName: run.tool_name,
      params: run.params ?? {},
      summary: run.result_summary,
      rowCount: run.row_count,
      status: run.status,
      error: run.error,
      latencyMs: run.latency_ms,
      createdAt: run.created_at,
    })),
  }
}

export function createChatRouter() {
  const router = express.Router()

  /** 当前用户可用工具 + provider 模式（前端用于展示「演示模式」与权限提示）。 */
  router.get('/tools', async (req, res, next) => {
    try {
      const [tools, settings] = await Promise.all([loadRegisteredTools(req.user), loadSettings()])
      res.json({
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          paramsSchema: tool.params_schema,
          requiredRole: tool.required_role,
          enabled: tool.enabled,
        })),
        provider: describeProvider(resolveProvider({ settings })),
      })
    } catch (error) {
      next(error)
    }
  })

  router.get('/conversations', async (req, res, next) => {
    try {
      const keyword = optionalString(req.query.keyword, { max: 100 })
      const rows = await repo.listConversations(req.user.id, { keyword })
      res.json({
        conversations: rows.map((row) => ({
          id: row.id,
          title: row.title,
          messageCount: row.message_count,
          pinned: row.pinned,
          problemCount: row.problem_count ?? 0,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          lastMessageAt: row.last_message_at,
        })),
      })
    } catch (error) {
      next(error)
    }
  })

  router.get('/conversations/:id/messages', async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '会话参数无效。' })
    try {
      const data = await repo.listMessages({ userId: req.user.id, conversationId: id })
      if (!data) return res.status(404).json({ message: '会话不存在。' })
      res.json({
        conversation: {
          id: data.conversation.id,
          title: data.conversation.title,
          messageCount: data.conversation.message_count,
          pinned: data.conversation.pinned,
        },
        messages: data.messages.map(serializeMessage),
      })
    } catch (error) {
      next(error)
    }
  })

  router.patch('/conversations/:id', async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '会话参数无效。' })
    try {
      const title = req.body?.title === undefined ? undefined : String(req.body.title).trim()
      if (title !== undefined && (!title || title.length > 200)) {
        return res.status(400).json({ message: '会话标题不能为空且不能超过 200 个字符。' })
      }
      const pinned = req.body?.pinned === undefined ? null : Boolean(req.body.pinned)
      const updated = await repo.renameConversation({ userId: req.user.id, conversationId: id, title, pinned })
      if (!updated) return res.status(404).json({ message: '会话不存在。' })
      res.json({ conversation: { id: updated.id, title: updated.title, pinned: updated.pinned } })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/conversations/:id', async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '会话参数无效。' })
    try {
      const deleted = await repo.deleteConversation({ userId: req.user.id, conversationId: id })
      if (!deleted) return res.status(404).json({ message: '会话不存在。' })
      res.status(204).end()
    } catch (error) {
      next(error)
    }
  })

  router.post('/messages/:id/feedback', async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '消息参数无效。' })
    try {
      const { type, comment } = req.body ?? {}
      if (!FEEDBACK_TYPES.has(type)) {
        return res.status(400).json({ message: '反馈类型无效。' })
      }
      const message = await repo.findMessageOwnedByUser({ messageId: id, userId: req.user.id })
      if (!message) return res.status(404).json({ message: '消息不存在。' })
      if (message.role !== 'assistant') {
        return res.status(400).json({ message: '只能对 AI 回答提交反馈。' })
      }
      const record = await repo.saveFeedback({
        messageId: id,
        userId: req.user.id,
        type,
        comment: optionalString(comment, { max: 1000 }),
      })
      await recordAudit({
        actorId: req.user.id,
        action: 'feedback',
        targetType: 'ai_message',
        targetId: id,
        detail: { type, hasComment: Boolean(comment) },
        ip: clientIp(req),
      })
      res.status(201).json({ feedback: record })
    } catch (error) {
      next(error)
    }
  })

  /** SSE 问答：编排层负责落库、权限裁剪与审计，本层只做传输。 */
  router.post('/chat', async (req, res, next) => {
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : ''
    const conversationId = resourceId(req.body?.conversationId)
    if (!content) {
      return res.status(400).json({ message: '提问内容不能为空。' })
    }

    // 并发闸门必须在写 SSE 响应头之前判定，否则无法再回一个 JSON 的 429。
    if (!acquireChatSlot(req.user.id)) {
      return res.status(429).json({
        message: `同时进行的问答不能超过 ${MAX_INFLIGHT_CHAT_PER_USER} 个，请等当前回答结束后再试。`,
      })
    }

    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    if (typeof res.flushHeaders === 'function') res.flushHeaders()

    const controller = new AbortController()
    let clientClosed = false
    const onClose = () => {
      clientClosed = true
      controller.abort()
    }
    req.on('close', onClose)

    const send = (event) => {
      if (clientClosed) return
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      } catch {
        clientClosed = true
        controller.abort()
      }
    }

    try {
      await runChat({
        user: req.user,
        conversationId,
        content,
        ip: clientIp(req),
        onEvent: send,
        signal: controller.signal,
      })
    } catch (error) {
      if (error instanceof OrchestratorError) {
        send({ type: 'error', data: { message: error.message, code: error.code } })
      } else {
        process.stderr.write(`[ai-agent] chat 异常：${error?.message ?? error}\n`)
        send({
          type: 'error',
          data: { message: 'AI 服务暂不可用，请稍后重试。', code: ERROR_CODE.internal },
        })
      }
    } finally {
      releaseChatSlot(req.user.id)
      req.off('close', onClose)
      if (!clientClosed) res.end()
    }
  })

  router.use((error, _req, res, next) => handleAiError(error, res, next))

  return router
}

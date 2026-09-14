/**
 * 评测与验收脚本共用的 HTTP 客户端（零依赖，只用 fetch）。
 *
 * 被 verify-e2e.mjs、run-a1-baseline.mjs、compare-retrieval.mjs 共用，
 * 避免每个脚本各写一份 SSE 解析。
 */
import dotenv from 'dotenv'

dotenv.config()

export const DEFAULT_BASE = `http://127.0.0.1:${process.env.API_PORT ?? 8787}`
export const EVAL_OPERATOR_LOGIN = process.env.AI_EVAL_LOGIN ?? 'ai-agent-acceptance'
export const EVAL_OPERATOR_PASSWORD = process.env.AI_EVAL_PASSWORD ?? 'Acceptance#2026'

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message)
    this.status = status
    this.body = body
  }
}

export function createClient(baseUrl = DEFAULT_BASE) {
  const base = baseUrl.replace(/\/+$/, '')

  async function request(path, { token, method = 'GET', body, raw, fileName } = {}) {
    const headers = {}
    if (token) headers.authorization = `Bearer ${token}`
    let payload
    if (raw !== undefined) {
      headers['content-type'] = 'application/octet-stream'
      if (fileName) headers['x-file-name'] = encodeURIComponent(fileName)
      payload = raw
    } else if (body !== undefined) {
      headers['content-type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    const response = await fetch(`${base}${path}`, { method, headers, body: payload })
    const text = await response.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    return { status: response.status, json, text }
  }

  /** 断言状态码，失败抛 ApiError（脚本里省去逐处判断）。 */
  async function expect(path, options, expected) {
    const response = await request(path, options)
    if (response.status !== expected) {
      throw new ApiError(
        `${options?.method ?? 'GET'} ${path} 期望 ${expected}，实际 ${response.status}：${response.text.slice(0, 200)}`,
        response.status,
        response.json
      )
    }
    return response
  }

  async function login(login, password) {
    const { json } = await expect(
      '/api/auth/login',
      { method: 'POST', body: { login, password } },
      200
    )
    return json.token
  }

  async function loginAdmin() {
    const loginName = process.env.INITIAL_ADMIN_LOGIN
    const password = process.env.INITIAL_ADMIN_PASSWORD
    if (!loginName || !password) {
      throw new Error('缺少 INITIAL_ADMIN_LOGIN / INITIAL_ADMIN_PASSWORD，无法登录管理员。')
    }
    return login(loginName, password)
  }

  /**
   * 确保评测用普通用户存在（不存在则以管理员身份创建）。返回 { id, role, token }。
   * 注意：参数名不可用 login，否则会遮蔽上面的 login() 函数。
   */
  async function ensureOperator({
    adminToken,
    operatorLogin = EVAL_OPERATOR_LOGIN,
    operatorPassword = EVAL_OPERATOR_PASSWORD,
  } = {}) {
    const token = adminToken ?? (await loginAdmin())
    const list = await expect('/api/users', { token }, 200)
    let user = list.json.find((item) => item.login === operatorLogin)
    if (!user) {
      const created = await expect(
        '/api/users',
        {
          token,
          method: 'POST',
          body: { login: operatorLogin, name: 'AI 评测普通用户', password: operatorPassword, role: 'operator' },
        },
        201
      )
      user = created.json
    }
    return { id: user.id, role: user.role, token: await login(operatorLogin, operatorPassword) }
  }

  /** 读取当前 provider 信息（mode = live / demo）。 */
  async function providerInfo(token) {
    const { json } = await expect('/api/ai/tools', { token }, 200)
    return { provider: json.provider, tools: json.tools }
  }

  /**
   * 发起一次流式问答，返回事件序列与拼装后的回答。
   * 记录 firstDeltaMs / totalMs 用于性能核对。
   */
  async function streamChat(token, { content, conversationId = null } = {}) {
    const startedAt = Date.now()
    const response = await fetch(`${base}/api/ai/chat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content, conversationId }),
    })
    if (!response.ok) {
      return {
        status: response.status,
        events: [],
        answer: '',
        text: await response.text(),
        firstDeltaMs: null,
        totalMs: Date.now() - startedAt,
      }
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let answer = ''
    let firstDeltaMs = null
    const events = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const line = frame.trim()
        if (!line.startsWith('data:')) continue
        try {
          const event = JSON.parse(line.slice(5).trim())
          events.push(event)
          if (event.type === 'reset') answer = ''
          if (event.type === 'delta') {
            if (firstDeltaMs === null) firstDeltaMs = Date.now() - startedAt
            answer += event.data?.text ?? ''
          }
        } catch {
          // 忽略无法解析的帧
        }
      }
    }

    return {
      status: response.status,
      events,
      answer,
      text: '',
      firstDeltaMs,
      totalMs: Date.now() - startedAt,
    }
  }

  return { base, request, expect, login, loginAdmin, ensureOperator, providerInfo, streamChat }
}

export function findDoneEvent(events) {
  return events.find((event) => event.type === 'done') ?? null
}

export function toolNamesOf(events) {
  return [
    ...new Set(
      events
        .filter((event) => event.type === 'status' && event.data?.toolName)
        .map((event) => event.data.toolName)
    ),
  ]
}

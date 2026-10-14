/**
 * MCP（Model Context Protocol）客户端 —— 只实现本项目需要的三个方法。
 *
 * 为什么手写而不引入官方 SDK：
 * 本项目只用得到 `initialize` / `tools/list` / `tools/call` 三个方法，且需要把
 * 「超时、错误分类、审计口径」牢牢握在自己手里（工具执行层已有既定的拒绝原因枚举）。
 * 引入 SDK 会带进一整套 transport 与会话状态机，反而更难与既有 `executeTool` 的
 * 拒绝/兜底逻辑对齐。协议细节见 https://modelcontextprotocol.io（Streamable HTTP）。
 *
 * 实测（2026-09-16，https://mcp.sellersprite.com/mcp）：
 * - 服务端为**无状态**模式：不返回 `mcp-session-id`，每个请求自带鉴权头即可；
 * - 响应是 `application/json`（未使用 SSE 流），但客户端仍必须解析 SSE，否则换个
 *   服务端就会静默失败；
 * - **密钥无效时不报 HTTP 错误，而是把工具列表退化成一个名为 `secret_invalid` 的工具**
 *   （描述「密钥不合法」）。这是最容易误判成"连通成功"的坑，见 `SECRET_INVALID_TOOL`。
 */
export const MCP_PROTOCOL_VERSION = '2025-06-18'

/** 密钥不合法时卖家精灵 MCP 返回的占位工具名（必须显式识别，不能当成一个真工具）。 */
export const SECRET_INVALID_TOOL = 'secret_invalid'

/**
 * 卖家精灵工具清单里的**状态占位条目**前缀。
 *
 * 实测：有效密钥返回 49 个条目 = 45 个真实工具 + 4 个 `secret_*` 占位；
 * 密钥无效时**只**返回 `secret_invalid` 一个。因此判据是"真实工具数为 0"，不是"含占位名"。
 */
export const SECRET_PLACEHOLDER_PREFIX = 'secret_'

/** 占位条目对应的可读原因（真实工具为 0 时用来解释到底哪一步不满足）。 */
export const SECRET_PLACEHOLDER_REASONS = {
  secret_invalid: '密钥不合法',
  secret_expired: '密钥已过期，请在卖家精灵开放平台续费或重新购买 MCP 套餐',
  secret_unauthorized: '密钥未获授权，请在卖家精灵「我的密钥」里为该密钥勾选可用工具',
  secret_no_remaining: '该密钥的调用次数已用完，请查看卖家精灵开放平台的套餐额度',
}

/** 是否为状态占位条目（不是可调用工具）。 */
export function isSecretPlaceholder(tool) {
  return typeof tool?.name === 'string' && tool.name.startsWith(SECRET_PLACEHOLDER_PREFIX)
}

export const MCP_ERROR_KIND = {
  network: 'network',
  timeout: 'timeout',
  http: 'http',
  protocol: 'protocol',
  auth: 'auth',
  server: 'server',
}

export class McpError extends Error {
  constructor(message, { kind = MCP_ERROR_KIND.server, status = null, data = null } = {}) {
    super(message)
    this.name = 'McpError'
    this.kind = kind
    this.status = status
    this.data = data
  }
}

/**
 * 解析 JSON-RPC 响应体。
 *
 * 服务端可能回 `application/json`，也可能回 `text/event-stream`（SSE）。
 * SSE 下同一个事件可能由多行 `data:` 拼成，且可能夹带通知（无 id）——这里只取
 * 带 `result` 或 `error` 的那一条，避免把通知当成响应。
 */
export function decodeJsonRpcPayload(raw, contentType = '') {
  const text = String(raw ?? '').trim()
  if (!text) {
    throw new McpError('MCP 服务返回了空响应。', { kind: MCP_ERROR_KIND.protocol })
  }
  const isSse = String(contentType).includes('text/event-stream') || /^(event|data|id|retry):/m.test(text)
  if (!isSse) {
    try {
      return JSON.parse(text)
    } catch {
      throw new McpError('MCP 服务返回的不是合法 JSON。', { kind: MCP_ERROR_KIND.protocol })
    }
  }

  for (const block of text.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/)
    const dataLines = []
    for (const line of lines) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
    }
    if (dataLines.length === 0) continue
    const payload = dataLines.join('\n').trim()
    if (!payload || payload === '[DONE]') continue
    let parsed
    try {
      parsed = JSON.parse(payload)
    } catch {
      continue
    }
    if (parsed && typeof parsed === 'object' && ('result' in parsed || 'error' in parsed)) {
      return parsed
    }
  }
  throw new McpError('MCP 服务未返回有效的 JSON-RPC 响应。', { kind: MCP_ERROR_KIND.protocol })
}

/** 把 JSON-RPC 响应里的 error 转成 McpError（code 与 message 原样保留，便于排障）。 */
function unwrapJsonRpc(message, context = '') {
  if (!message || typeof message !== 'object') {
    throw new McpError(`MCP 服务返回结构异常${context ? `（${context}）` : ''}。`, {
      kind: MCP_ERROR_KIND.protocol,
    })
  }
  if (message.error) {
    const detail = message.error
    const text = typeof detail === 'string' ? detail : detail.message || '未知错误'
    throw new McpError(`MCP 服务返回错误：${text}`, {
      kind: MCP_ERROR_KIND.server,
      status: typeof detail?.code === 'number' ? detail.code : null,
      data: detail,
    })
  }
  return message.result
}

let requestSeq = 1

/** 单次响应体上限（字符）：正常的工具结果远小于此，超出说明服务端回了异常内容。 */
const MAX_RESPONSE_CHARS = 4_000_000

/** 单个 JSON-RPC 请求（含超时与错误分类）。 */
export async function mcpRequest({
  endpoint,
  secretKey,
  method,
  params = {},
  timeoutMs = 20000,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new McpError('当前运行环境不支持 fetch，无法访问 MCP 服务。', {
      kind: MCP_ERROR_KIND.network,
    })
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 20000))
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  }
  if (secretKey) headers['secret-key'] = secretKey

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: requestSeq++, method, params }),
      signal: controller.signal,
    })
    const text = await response.text()
    if (text.length > MAX_RESPONSE_CHARS) {
      // 实测：向卖家精灵 MCP 发未实现的方法会吐回完整 Java 堆栈（数 MB），必须挡住
      throw new McpError(
        `MCP 服务返回的响应体过大（${text.length} 字符），已拒绝解析。`,
        { kind: MCP_ERROR_KIND.protocol }
      )
    }
    if (!response.ok) {
      // 有的服务端会用 401/403 表达鉴权失败，这里统一归类为 auth，便于前端给出可操作提示
      const kind = response.status === 401 || response.status === 403
        ? MCP_ERROR_KIND.auth
        : MCP_ERROR_KIND.http
      throw new McpError(
        `MCP 服务返回 HTTP ${response.status}${text ? `：${text.slice(0, 200)}` : ''}`,
        { kind, status: response.status }
      )
    }
    const payload = decodeJsonRpcPayload(text, response.headers?.get?.('content-type') ?? '')
    return unwrapJsonRpc(payload, method)
  } catch (error) {
    if (error instanceof McpError) throw error
    if (error?.name === 'AbortError') {
      throw new McpError(`MCP 服务在 ${timeoutMs}ms 内未响应（已超时）。`, {
        kind: MCP_ERROR_KIND.timeout,
      })
    }
    throw new McpError(`无法连接 MCP 服务：${error?.message ?? error}`, {
      kind: MCP_ERROR_KIND.network,
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 握手缓存：`initialize` 的结果对本项目没有实际用途（不需要 session），
 * 但协议要求客户端先握手。缓存 key 里带密钥指纹，密钥一改即重新握手。
 */
const handshakeCache = new Map()
const HANDSHAKE_TTL_MS = 5 * 60 * 1000

export function clearMcpHandshakeCache() {
  handshakeCache.clear()
}

export async function mcpInitialize({
  endpoint,
  secretKey,
  timeoutMs = 20000,
  fetchImpl = globalThis.fetch,
  cacheKey = null,
  now = Date.now(),
} = {}) {
  const key = cacheKey ?? `${endpoint}|${String(secretKey ?? '').slice(-6)}`
  const cached = handshakeCache.get(key)
  if (cached && cached.expiresAt > now) return cached.info

  const info = await mcpRequest({
    endpoint,
    secretKey,
    method: 'initialize',
    timeoutMs,
    fetchImpl,
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'jhyp-ai-workbench', version: '1.0.0' },
    },
  })
  handshakeCache.set(key, { expiresAt: now + HANDSHAKE_TTL_MS, info })
  return info
}

/**
 * 拉取远端工具清单。
 *
 * ⚠️ 卖家精灵的工具清单里**始终**混着若干 `secret_*` 状态占位条目 ——
 * 实测（2026-09-16，有效密钥）：49 个条目 = 45 个真实业务工具 + `secret_invalid` +
 * `secret_expired` + `secret_unauthorized` + `secret_no_remaining`。
 * 也就是说**有效密钥下也会出现 `secret_invalid`**，"清单里含有它就判密钥无效"是错的
 * （这个误判真实发生过：用户密钥完全有效却一直报"密钥不合法"）。
 *
 * 正确的判据是**真实业务工具数为 0**：密钥无效时卖家精灵只返回那一个占位条目。
 * 占位条目一律过滤掉 —— 它们不是可调用工具，注册给模型只会让模型去调一个必然失败的东西。
 */
export async function mcpListTools({
  endpoint,
  secretKey,
  timeoutMs = 20000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const result = await mcpRequest({
    endpoint,
    secretKey,
    method: 'tools/list',
    params: {},
    timeoutMs,
    fetchImpl,
  })
  const all = Array.isArray(result?.tools) ? result.tools : []
  const placeholders = all.filter((tool) => isSecretPlaceholder(tool))
  const tools = all.filter(
    (tool) => tool && typeof tool.name === 'string' && tool.name && !isSecretPlaceholder(tool)
  )

  if (tools.length === 0) {
    const reasons = placeholders
      .map((tool) => SECRET_PLACEHOLDER_REASONS[tool.name] ?? tool.name)
      .join('；')
    throw new McpError(
      reasons
        ? `卖家精灵 MCP 未返回任何可用工具：${reasons}。`
        : '卖家精灵 MCP 未返回任何可用工具，请确认套餐是否包含 MCP 权限。',
      { kind: MCP_ERROR_KIND.auth }
    )
  }
  return tools
}

/** 调用远端工具，返回 MCP `tools/call` 的原始 result。 */
export async function mcpCallTool({
  endpoint,
  secretKey,
  name,
  args = {},
  timeoutMs = 30000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const result = await mcpRequest({
    endpoint,
    secretKey,
    method: 'tools/call',
    params: { name, arguments: args },
    timeoutMs,
    fetchImpl,
  })
  if (result?.isError) {
    throw new McpError(extractText(result) || `MCP 工具 ${name} 执行失败。`, {
      kind: MCP_ERROR_KIND.server,
      data: result,
    })
  }
  const text = extractText(result)
  if (detectAuthFailure(text)) {
    // 见 detectAuthFailure：卖家精灵在密钥无效时**不置 isError**，若不当场升级为错误，
    // 模型会把 ERROR_UNAUTHORIZED 当成业务数据继续分析，产出看似合理的幻觉结论。
    throw new McpError(`卖家精灵 MCP 拒绝了本次调用：${text.slice(0, 200)}`, {
      kind: MCP_ERROR_KIND.auth,
      data: result,
    })
  }
  return result
}

/**
 * 识别「被包成正常数据」的鉴权失败。
 *
 * 判定刻意收紧到**短文本 + 结构化错误码**：真正失败的响应体通常就是
 * `{"code":"ERROR_UNAUTHORIZED","message":"未授权"}` 这类几十字节的 JSON；
 * 而正常业务数据体量大、且不会以 error 码开头。宁可漏判（表现为工具返回无数据），
 * 也不要把含"未授权"字样的正常评论内容误判成鉴权失败。
 */
export function detectAuthFailure(text) {
  const value = String(text ?? '').trim()
  if (!value || value.length > 300) return false
  const AUTH_CODES = ['ERROR_UNAUTHORIZED', 'UNAUTHORIZED', 'ERROR_FORBIDDEN', 'SECRET_INVALID']
  const looksJson = value.startsWith('{') || value.startsWith('[')
  if (looksJson) {
    try {
      const parsed = JSON.parse(value)
      const code = String(parsed?.code ?? parsed?.error ?? '').toUpperCase()
      if (AUTH_CODES.some((item) => code === item || code.includes(item))) return true
      const message = String(parsed?.message ?? '')
      if (/未授权|密钥不合法|invalid\s*secret/i.test(message)) return true
      return false
    } catch {
      // 不是合法 JSON 时继续走下面的纯文本判定
    }
  }
  return /^(ERROR_)?(UNAUTHORIZED|FORBIDDEN)$/i.test(value) || /^密钥不合法$/.test(value)
}

/** 把 MCP 的 content 数组压成纯文本（text 类型拼接，其他类型标注占位）。 */
export function extractText(result) {
  const content = Array.isArray(result?.content) ? result.content : []
  const parts = []
  for (const item of content) {
    if (item?.type === 'text' && typeof item.text === 'string') {
      parts.push(item.text)
      continue
    }
    if (item?.type === 'resource' && typeof item.resource?.text === 'string') {
      parts.push(item.resource.text)
      continue
    }
    if (item?.type) parts.push(`[${item.type}]`)
  }
  return parts.join('\n').trim()
}

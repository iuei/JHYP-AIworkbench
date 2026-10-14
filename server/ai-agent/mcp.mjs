/**
 * 卖家精灵（SellerSprite）MCP 接入的业务层。
 *
 * 分工：
 * - `mcp-client.mjs` 只负责协议（JSON-RPC / HTTP / SSE 解析）；
 * - 本文件负责「配置解析 → 工具同步入库 → 参数校验 → 执行转发 → 结果整形」，
 *   让 MCP 工具与内置工具在**同一条**权限 / 审计 / 拒绝路径上跑（见 `tools.mjs`）。
 *
 * 三个必须守住的边界：
 * 1. **密钥只以密文入库、只以掩码出库**，与模型密钥共用 `secrets.mjs` 的一套规则；
 * 2. **远端工具必须落进 `ai_tools` 才能被注册给模型**，因此"工具开关 / 角色裁剪 / 未注册拒绝"
 *    这些既有机制对 MCP 工具自动生效，不需要在编排层开新口子；
 * 3. **远端 schema 要归一化后再用**：MCP 允许 `type: ["string","null"]`、`$ref`、`oneOf` 等
 *    本项目的 `validateParams` 不认识的写法，原样透传会让合法的模型调用被误判成"参数非法"。
 */
import { decryptSecret, resolveSecretKey } from './secrets.mjs'
import { buildTableBlock } from './data-queries.mjs'
import { parseModelBaseUrl } from './http-utils.mjs'
import { query } from '../db.mjs'
import {
  MCP_ERROR_KIND,
  McpError,
  extractText,
  isSecretPlaceholder,
  mcpCallTool,
  mcpInitialize,
  mcpListTools,
} from './mcp-client.mjs'

export const MCP_SOURCE = 'mcp'
export const DEFAULT_MCP_ENDPOINT = 'https://mcp.sellersprite.com/mcp'
export const DEFAULT_MCP_PREFIX = 'sellersprite'
export const DEFAULT_MCP_TIMEOUT_MS = 30000

/** 回灌模型的行数 / 列数上限：MCP 返回的是第三方 JSON，不设限会把上下文一次打满。 */
const MAX_MODEL_ROWS = 100
const MAX_MODEL_COLUMNS = 20
const MAX_TABLE_ROWS = 100

const PREFIX_PATTERN = /^[a-z][a-z0-9_]{1,19}$/
const LOCAL_NAME_MAX = 120

export class McpConfigError extends Error {}

/**
 * 把 `?secret-key=xxx` 从端点 URL 里拆出来。
 *
 * 为什么需要：卖家精灵官方文档同时给了"URL 直连"写法（`https://mcp.sellersprite.com/mcp?secret-key=xxx`），
 * 管理员很容易把整条 URL 粘进「MCP 端点」框、而密钥框留空 —— 实测这样也能连通，
 * 但密钥会明文写进 `ai_settings.mcp_endpoint`（不进加密列、审计与导出里都会出现），
 * 而且界面上"密钥来源：未配置"与实际可用状态自相矛盾。因此保存时自动搬运到密钥框（走加密列）。
 */
export function splitEndpointSecret(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { endpoint: text, secret: null }
  let url
  try {
    url = new URL(text)
  } catch {
    return { endpoint: text, secret: null }
  }
  const secret = url.searchParams.get('secret-key')
  if (!secret) return { endpoint: text, secret: null }
  url.searchParams.delete('secret-key')
  const query = url.searchParams.toString()
  return {
    endpoint: `${url.origin}${url.pathname}${query ? `?${query}` : ''}`,
    secret: secret.trim() || null,
  }
}

/** 端点校验：只允许 https 公网域名（复用模型 Base URL 的同一套 SSRF 口径）。 */
export function parseMcpEndpoint(raw, { max = 300 } = {}) {
  const parsed = parseModelBaseUrl(raw, { max })
  if (!parsed.ok) return parsed
  return { ok: true, value: parsed.value }
}

/** 工具名前缀：小写字母开头，2-20 位，只用 `[a-z0-9_]`（它会成为模型看到的工具名的一部分）。 */
export function normalizeMcpPrefix(raw) {
  const text = String(raw ?? '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
  return PREFIX_PATTERN.test(text) ? text : null
}

/** 远端工具名 → 本地工具名（前缀隔离，避免与内置工具重名）。 */
export function toLocalToolName(prefix, remoteName) {
  const safePrefix = normalizeMcpPrefix(prefix) ?? DEFAULT_MCP_PREFIX
  const safeRemote = String(remoteName ?? '').trim()
  if (!safeRemote) return null
  const local = `${safePrefix}__${safeRemote}`
  if (local.length > LOCAL_NAME_MAX) return null
  return /^[a-zA-Z0-9_-]+$/.test(local) ? local : null
}

/** 本地工具名 → 远端工具名（不匹配前缀时返回 null，防止把内置工具名当远端名去调）。 */
export function toRemoteToolName(prefix, localName) {
  const safePrefix = normalizeMcpPrefix(prefix) ?? DEFAULT_MCP_PREFIX
  const head = `${safePrefix}__`
  const text = String(localName ?? '')
  return text.startsWith(head) ? text.slice(head.length) : null
}

/**
 * 归一化 JSON Schema 到 `validateParams` 支持的子集。
 *
 * 处理四件事：数组式 `type` 取非 null 的第一项、嵌套 object/array 递归、
 * 不支持的关键字（`$ref` / `oneOf` / `allOf` / `anyOf` / `not` / `pattern` / `format`）直接丢弃、
 * 顶层不是 object 时退化成「任意对象」。**保持宽松**：宁可少校验，也不能把合法调用拒掉。
 */
export function normalizeMcpSchema(schema, depth = 0) {
  if (depth > 4 || !schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object', properties: {}, required: [], additionalProperties: false }
  }
  const rawType = schema.type
  const type = Array.isArray(rawType)
    ? rawType.find((item) => item && item !== 'null') ?? 'string'
    : typeof rawType === 'string'
      ? rawType
      : null

  const normalized = {}
  const SUPPORTED_TYPES = new Set(['string', 'integer', 'number', 'boolean', 'array', 'object'])
  if (type && SUPPORTED_TYPES.has(type)) normalized.type = type
  if (typeof schema.description === 'string' && schema.description.trim()) {
    normalized.description = schema.description.trim().slice(0, 500)
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    normalized.enum = schema.enum.filter((item) => typeof item === 'string' || typeof item === 'number')
  }
  for (const key of ['minimum', 'maximum', 'maxLength']) {
    if (typeof schema[key] === 'number' && Number.isFinite(schema[key])) normalized[key] = schema[key]
  }
  if (schema.default !== undefined && ['string', 'number', 'boolean'].includes(typeof schema.default)) {
    normalized.default = schema.default
  }
  if (normalized.enum) delete normalized.type

  if (normalized.type === 'object' || (!normalized.type && schema.properties)) {
    normalized.type = 'object'
    const properties = {}
    const rawProperties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {}
    for (const [key, value] of Object.entries(rawProperties)) {
      if (!/^[a-zA-Z0-9_-]{1,60}$/.test(key)) continue
      properties[key] = normalizeMcpSchema(value, depth + 1)
    }
    normalized.properties = properties
    normalized.required = Array.isArray(schema.required)
      ? schema.required.filter((key) => typeof key === 'string' && Object.hasOwn(properties, key))
      : []
    normalized.additionalProperties = false
    return normalized
  }

  if (normalized.type === 'array') {
    normalized.items = normalizeMcpSchema(schema.items, depth + 1)
    return normalized
  }
  return normalized
}

/** 归一化 MCP 返回的工具条目；缺名字或缺 schema 的条目直接丢弃（宁可少注册，不可注册出错的）。 */
export function normalizeMcpTool(remote, prefix) {
  const name = typeof remote?.name === 'string' ? remote.name.trim() : ''
  if (!name) return null
  // 状态占位条目（secret_invalid / secret_expired / …）不是可调用工具：
  // 它们的描述就是"密钥不合法"这类状态文本，注册给模型只会让它去调一个必然失败的工具。
  // mcpListTools 已经过滤过一次，这里再守一道，避免上游行为变化时静默漏进来。
  if (isSecretPlaceholder(remote)) return null
  const localName = toLocalToolName(prefix, name)
  if (!localName) return null
  const description = typeof remote?.description === 'string' && remote.description.trim()
    ? remote.description.trim().slice(0, 1000)
    : `卖家精灵 MCP 工具：${name}`
  return {
    localName,
    remoteName: name,
    description,
    paramsSchema: normalizeMcpSchema(remote?.inputSchema ?? remote?.input_schema),
  }
}

/**
 * 解析当前生效的 MCP 配置。优先级：**数据库（后台配置）> 环境变量 > 未启用**，
 * 与模型密钥的口径保持一致（后台改完即时生效，无需重启）。
 */
export function resolveMcpConfig(row, env = process.env) {
  const enabledFromDb = row?.mcp_enabled
  const endpointFromDb = row?.mcp_endpoint
  const prefixFromDb = row?.mcp_prefix

  const envEnabled = String(env?.AI_MCP_ENABLED ?? '').trim().toLowerCase()
  const enabled = enabledFromDb === undefined || enabledFromDb === null
    ? envEnabled === 'true' || envEnabled === '1'
    : Boolean(enabledFromDb)

  const endpoint = String(
    endpointFromDb || env?.AI_MCP_ENDPOINT || DEFAULT_MCP_ENDPOINT
  ).trim()
  const prefix = normalizeMcpPrefix(prefixFromDb || env?.AI_MCP_PREFIX || DEFAULT_MCP_PREFIX) ?? DEFAULT_MCP_PREFIX
  const timeoutMs = Number(row?.mcp_timeout_ms) > 0
    ? Number(row.mcp_timeout_ms)
    : Number(env?.AI_MCP_TIMEOUT_MS) > 0
      ? Number(env.AI_MCP_TIMEOUT_MS)
      : DEFAULT_MCP_TIMEOUT_MS

  // 密钥：数据库密文优先，解不开按"未配置"处理并标记 invalid；环境变量只作兜底
  let secretKey = null
  let keyInvalid = false
  let keySource = 'none'
  if (row?.mcp_secret_cipher) {
    try {
      secretKey = decryptSecret(row.mcp_secret_cipher, resolveSecretKey(env).key)
    } catch {
      secretKey = null
    }
    if (secretKey) keySource = 'database'
    else keyInvalid = true
  }
  if (!secretKey && !keyInvalid && env?.AI_MCP_SECRET) {
    secretKey = String(env.AI_MCP_SECRET).trim() || null
    if (secretKey) keySource = 'environment'
  }

  return {
    enabled,
    endpoint,
    prefix,
    timeoutMs,
    secretKey,
    keySource,
    keyInvalid,
    keyConfigured: Boolean(secretKey),
    ready: enabled && Boolean(secretKey) && !keyInvalid,
  }
}

/** 连通性测试：握手 + 拉工具清单。返回可读结论，调用方（路由）只负责落库与回包。 */
export async function testMcpConnection({
  row = null,
  env = process.env,
  candidateSecret = null,
  candidateEndpoint = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  const config = resolveMcpConfig(row, env)
  const endpoint = candidateEndpoint ? parseMcpEndpoint(candidateEndpoint) : { ok: true, value: config.endpoint }
  if (!endpoint.ok) return { ok: false, message: endpoint.error, kind: 'config' }
  const secretKey = candidateSecret ? String(candidateSecret).trim() : config.secretKey
  if (!secretKey) {
    return { ok: false, message: '尚未填写卖家精灵 MCP 密钥，未发起请求。', kind: 'config' }
  }

  const startedAt = Date.now()
  try {
    // 先握手再取清单：卖家精灵不强制，但协议要求客户端先 initialize，换个服务端就可能是硬要求
    await mcpInitialize({
      endpoint: endpoint.value,
      secretKey,
      timeoutMs: config.timeoutMs,
      fetchImpl,
    })
    const tools = await mcpListTools({
      endpoint: endpoint.value,
      secretKey,
      timeoutMs: config.timeoutMs,
      fetchImpl,
    })
    return {
      ok: true,
      message: `连接成功，共发现 ${tools.length} 个卖家精灵工具。`,
      endpoint: endpoint.value,
      toolCount: tools.length,
      latencyMs: Date.now() - startedAt,
      remoteTools: tools.map((tool) => ({
        name: tool?.name ?? '',
        description: typeof tool?.description === 'string' ? tool.description : '',
      })).filter((tool) => tool.name),
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof McpError ? error.message : `连接失败：${error?.message ?? error}`,
      kind: error instanceof McpError ? error.kind : MCP_ERROR_KIND.server,
      latencyMs: Date.now() - startedAt,
    }
  }
}

/**
 * 把远端工具清单同步进 `ai_tools`。
 *
 * 三条规则：
 * - **已存在的工具只更新描述与参数 schema，不动 `enabled`** —— 管理员关掉的工具不能被一次同步悄悄打开；
 * - 新工具默认 `enabled = true`、`required_role = 'user'`（任意启用账号可用）；
 * - 远端已经下线的工具连同本地记录一起删除（否则模型会看到一个必然失败的工具）。
 */
export async function syncMcpTools({ row = null, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = resolveMcpConfig(row, env)
  if (!config.secretKey) {
    throw new McpConfigError('尚未配置卖家精灵 MCP 密钥，无法同步工具。')
  }
  await mcpInitialize({
    endpoint: config.endpoint,
    secretKey: config.secretKey,
    timeoutMs: config.timeoutMs,
    fetchImpl,
  })
  const remoteTools = await mcpListTools({
    endpoint: config.endpoint,
    secretKey: config.secretKey,
    timeoutMs: config.timeoutMs,
    fetchImpl,
  })
  const tools = remoteTools
    .map((remote) => normalizeMcpTool(remote, config.prefix))
    .filter(Boolean)
  if (tools.length === 0) {
    throw new McpConfigError('该密钥下没有可用的卖家精灵工具，请确认套餐是否包含 MCP 权限。')
  }

  let added = 0
  let updated = 0
  for (const tool of tools) {
    const { rows } = await query(
      `INSERT INTO ai_tools (name, description, params_schema, required_role, enabled, source, remote_name)
       VALUES ($1, $2, $3::jsonb, 'user', true, 'mcp', $4)
       ON CONFLICT (name) DO UPDATE
         SET description = EXCLUDED.description,
             params_schema = EXCLUDED.params_schema,
             source = 'mcp',
             remote_name = EXCLUDED.remote_name,
             updated_at = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [tool.localName, tool.description, JSON.stringify(tool.paramsSchema), tool.remoteName]
    )
    if (rows[0]?.inserted) added += 1
    else updated += 1
  }

  const names = tools.map((tool) => tool.localName)
  const removed = await query(
    `DELETE FROM ai_tools
      WHERE source = 'mcp' AND name <> ALL($1::text[])
      RETURNING name`,
    [names]
  )

  return {
    endpoint: config.endpoint,
    prefix: config.prefix,
    toolCount: tools.length,
    added,
    updated,
    removed: removed.rows.map((row2) => row2.name),
    tools: tools.map((tool) => ({
      name: tool.localName,
      remoteName: tool.remoteName,
      description: tool.description,
    })),
  }
}

/** 从任意形态的 JSON 里挑出"像是数据行"的数组。 */
function pickRowArray(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return null
  for (const key of ['data', 'items', 'list', 'results', 'records', 'rows']) {
    if (Array.isArray(value[key])) return value[key]
  }
  return null
}

/** 裁剪列与行：MCP 是第三方返回，字段数与行数都可能远超模型上下文预算。 */
function clipRows(rows) {
  const objects = rows.filter((row) => row && typeof row === 'object' && !Array.isArray(row))
  if (objects.length === 0) return { rows: [], columns: [], total: 0 }
  const columns = []
  for (const row of objects) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key)
      if (columns.length >= MAX_MODEL_COLUMNS) break
    }
    if (columns.length >= MAX_MODEL_COLUMNS) break
  }
  const clipped = objects.slice(0, MAX_MODEL_ROWS).map((row) => {
    const next = {}
    for (const key of columns) next[key] = row[key] === undefined ? null : row[key]
    return next
  })
  // total 一定要带出去：表格块用它标注"共 N 条、已截断"，否则界面会把 500 条说成 100 条
  return { rows: clipped, columns, total: objects.length }
}

/**
 * 把 MCP `tools/call` 的结果整形成本项目统一的工具结果结构。
 *
 * 结构化数据（JSON 数组 / 含数组字段的对象）走 `rows` + 表格块，与内置数据工具一致：
 * 前端能渲染表格、模型拿到的是完整字段，而不是一段需要自己解析的文本。
 */
/**
 * 单条记录形态的载荷：`{ code:'OK', message:'成功', data:{...} }`。
 *
 * 卖家精灵的**产品类工具**（`asin_detail` / `keepa_info` 等）几乎都是这个形态 ——
 * 一次查询返回一个对象而不是数组。早期实现只认数组，于是这类结果被标成
 * `empty: true` 且没有结构化数据（模型只能读一段 JSON 文本，页面也没有块可渲染）。
 */
function pickSingleRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  for (const key of ['data', 'result', 'item', 'record', 'detail']) {
    const candidate = value[key]
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) return candidate
  }
  // 顶层没有信封字段时，它自己就是一条记录；只有信封（code/message）而没有 data 时不算 ——
  // 那样会把 `{code:'OK',message:'成功'}` 当成一行数据。
  const ENVELOPE_KEYS = ['code', 'message', 'msg', 'success']
  const keys = Object.keys(value)
  if (keys.length === 0) return null
  if (keys.some((key) => ENVELOPE_KEYS.includes(key))) return null
  return value
}

/**
 * 识别被包成"正常数据"的业务错误信封。
 *
 * 与 `detectAuthFailure`（鉴权类，在客户端层拦）互补：这里兜**其它**错误码 ——
 * 卖家精灵失败时同样不置 `isError`，返回 `{"code":"ERROR_xxx","message":"…"}`，
 * 不拦下来模型就会把错误码当成查询结果继续分析。
 */
export function detectErrorEnvelope(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const code = typeof parsed.code === 'string' ? parsed.code.toUpperCase() : ''
  if (code.startsWith('ERROR_')) {
    const message = typeof parsed.message === 'string' ? parsed.message : ''
    return message ? `${code}：${message}` : code
  }
  if (parsed.success === false) {
    return typeof parsed.message === 'string' ? parsed.message : '卖家精灵返回失败状态'
  }
  return null
}

export function shapeMcpToolResult({ remoteName, result, description = '' } = {}) {
  const text = extractText(result)
  const title = description ? description.split('\n')[0].slice(0, 60) : `卖家精灵：${remoteName}`
  if (!text) {
    return { rows: [], summary: `卖家精灵工具 ${remoteName} 未返回内容。`, blocks: [], empty: true }
  }

  let parsed = null
  const looksJson = /^[[{]/.test(text.trim())
  if (looksJson) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
  }

  const envelopeError = parsed ? detectErrorEnvelope(parsed) : null
  if (envelopeError) {
    throw new McpError(`卖家精灵工具 ${remoteName} 返回错误：${envelopeError}`, {
      kind: MCP_ERROR_KIND.server,
    })
  }

  const rowArray = parsed ? pickRowArray(parsed) : null
  if (Array.isArray(rowArray) && rowArray.length > 0 && typeof rowArray[0] === 'object' && rowArray[0] !== null) {
    const { rows, columns, total } = clipRows(rowArray)
    if (rows.length > 0) {
      return {
        rows,
        summary: `卖家精灵「${remoteName}」返回 ${total} 条数据，字段：${columns.join('、')}。`,
        blocks: [
          buildTableBlock({
            title,
            columns,
            rows,
            totalRows: total,
            maxRows: MAX_TABLE_ROWS,
            note: `数据由卖家精灵 MCP 实时返回（工具 ${remoteName}）`,
          }),
        ],
        empty: false,
      }
    }
  }

  // 单条记录：给模型的是结构化 rows（字段完整），摘要只做索引不做数据搬运。
  // 刻意不生成表格块 —— 一条记录却有几十个字段，横排表格在页面上读不下去。
  const record = parsed && !Array.isArray(parsed) ? pickSingleRecord(parsed) : null
  if (record) {
    const { rows, columns } = clipRows([record])
    if (rows.length > 0) {
      return {
        rows,
        summary: `卖家精灵「${remoteName}」返回 1 条记录，字段：${columns.join('、')}。`,
        blocks: [],
        empty: false,
      }
    }
  }

  // 非表格结果：保留文本，长文本截断（审计摘要另有 summarizeValue 收口）
  const summary = text.length > 4000 ? `${text.slice(0, 4000)}…` : text
  return { rows: [], summary, blocks: [], empty: false }
}

/**
 * 执行一次 MCP 工具调用。异常一律转成**明确错误**上抛，
 * 由 `tools.mjs` 的 `executeTool` 统一落成 `status='error'` 并写审计。
 */
export async function executeMcpTool({
  row = null,
  env = process.env,
  remoteName,
  params = {},
  timeoutMs = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  const config = resolveMcpConfig(row, env)
  if (!config.enabled) {
    throw new McpError('卖家精灵 MCP 已停用，工具未执行。', { kind: MCP_ERROR_KIND.server })
  }
  if (!config.secretKey) {
    throw new McpError('卖家精灵 MCP 密钥未配置，工具未执行。', { kind: MCP_ERROR_KIND.auth })
  }
  const result = await mcpCallTool({
    endpoint: config.endpoint,
    secretKey: config.secretKey,
    name: remoteName,
    args: params,
    timeoutMs: timeoutMs ?? config.timeoutMs,
    fetchImpl,
  })
  return result
}

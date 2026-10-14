/**
 * 审计台与系统配置接口（管理员）：会话轨迹 / 工具调用明细 / 拦截记录 / 管理动作 / CSV 导出 / 用量 / 模型与编排配置。
 *
 * 审计查询只读，本模块**不提供任何删除接口**（需求文档 §5.4）。
 */
import express from 'express'
import {
  AUDIT_ACTIONS,
  countAuditLogs,
  countConversationTraces,
  countRuns,
  listAuditLogs,
  listConversationTraces,
  listRuns,
  loadConversationTrace,
  recordAudit,
  usageByDay,
} from './audit.mjs'
import { query } from '../db.mjs'
import { clientIp, handleAiError, optionalString, parseModelBaseUrl, parsePageQuery, toCsv } from './http-utils.mjs'
import { loadSettings } from './knowledge.mjs'
import {
  McpConfigError,
  normalizeMcpPrefix,
  resolveMcpConfig,
  splitEndpointSecret,
  syncMcpTools,
  testMcpConnection,
} from './mcp.mjs'
import { KEY_SOURCE, resolveModelConfig, resolveProvider } from './providers/index.mjs'
import {
  SecretConfigError,
  encryptSecret,
  fingerprintSecret,
  maskSecret,
  resolveSecretKey,
} from './secrets.mjs'

const EXPORT_TYPES = new Set(['conversations', 'runs', 'logs'])

const SETTINGS_FIELDS = [
  { column: 'model_provider', key: 'modelProvider', max: 40 },
  { column: 'model_name', key: 'modelName', max: 80 },
  { column: 'model_base_url', key: 'modelBaseUrl', max: 300, url: true },
  { column: 'force_demo', key: 'forceDemo', boolean: true },
  { column: 'temperature', key: 'temperature', min: 0, max: 2, numeric: true },
  { column: 'max_output_tokens', key: 'maxOutputTokens', min: 256, max: 8192, numeric: true, integer: true },
  { column: 'max_turns_per_conversation', key: 'maxTurnsPerConversation', min: 1, max: 100, numeric: true, integer: true },
  { column: 'retrieval_top_k', key: 'retrievalTopK', min: 1, max: 20, numeric: true, integer: true },
  { column: 'request_timeout_ms', key: 'requestTimeoutMs', min: 1000, max: 300000, numeric: true, integer: true },
  // 卖家精灵 MCP：端点走与模型 Base URL 相同的 SSRF 校验（服务端会带着密钥出站访问它）
  { column: 'mcp_enabled', key: 'mcpEnabled', boolean: true },
  { column: 'mcp_endpoint', key: 'mcpEndpoint', max: 300, url: true },
  { column: 'mcp_prefix', key: 'mcpPrefix', max: 20, prefix: true },
  { column: 'mcp_timeout_ms', key: 'mcpTimeoutMs', min: 3000, max: 120000, numeric: true, integer: true },
]

function parseDateFilter(value) {
  const text = optionalString(value, { max: 40 })
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * 多动作筛选：`actions=tool_blocked,forbidden`。
 *
 * 用于「越权与拦截事件」这类把多个审计动作合并成一个视图的场景。
 * 为空时返回 null（SQL 里 `$::text[] IS NULL` 即不过滤），最多 10 个动作，
 * 避免用超长列表绕过分页去做全表扫描。
 */
function parseActionList(value) {
  const text = optionalString(value, { max: 300 })
  if (!text) return null
  const actions = [...new Set(text.split(',').map((item) => item.trim()).filter(Boolean))]
  return actions.length === 0 ? null : actions.slice(0, 10)
}

function parseIntFilter(value) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/** 校验并归一化设置补丁（模型/编排护栏在这里收口）。 */
export function parseSettingsPatch(input = {}) {
  const values = {}
  const providedKeys = []
  for (const field of SETTINGS_FIELDS) {
    if (input[field.key] === undefined) continue
    providedKeys.push(field.key)
    const raw = input[field.key]
    if (field.boolean) {
      if (typeof raw !== 'boolean') {
        return { ok: false, error: `参数 ${field.key} 必须是布尔值。` }
      }
      values[field.column] = raw
      continue
    }
    if (field.url) {
      // 这个地址会被服务端带着解密的 API Key 请求，不能只校验"像不像 URL"（见 http-utils.parseModelBaseUrl）。
      const parsed = parseModelBaseUrl(raw, { max: field.max })
      if (!parsed.ok) {
        return { ok: false, error: `参数 ${field.key}：${parsed.error}` }
      }
      values[field.column] = parsed.value
      continue
    }
    if (field.prefix) {
      // 前缀会拼进模型看到的工具名，必须是合法标识符片段；非法值直接拒绝而不是静默清洗
      const prefix = normalizeMcpPrefix(raw)
      if (!prefix) {
        return {
          ok: false,
          error: `参数 ${field.key} 只能是小写字母开头的 2-20 位字母、数字或下划线。`,
        }
      }
      values[field.column] = prefix
      continue
    }
    if (field.numeric) {
      const number = Number(raw)
      if (!Number.isFinite(number)) {
        return { ok: false, error: `参数 ${field.key} 必须是数字。` }
      }
      if (field.integer && !Number.isInteger(number)) {
        return { ok: false, error: `参数 ${field.key} 必须是整数。` }
      }
      if (number < field.min || number > field.max) {
        return { ok: false, error: `参数 ${field.key} 必须在 ${field.min} 到 ${field.max} 之间。` }
      }
      values[field.column] = number
      continue
    }
    const text = String(raw).trim()
    if (!text || text.length > field.max) {
      return { ok: false, error: `参数 ${field.key} 不能为空且不能超过 ${field.max} 个字符。` }
    }
    values[field.column] = text
  }
  if (providedKeys.length === 0) {
    return { ok: false, error: '没有需要更新的配置项。' }
  }
  return { ok: true, values }
}

/**
 * 密钥字段的处理规则（与 parseSettingsPatch 分开，便于单独测试）：
 * - 未传该字段              → 不修改已保存的密钥
 * - 传空字符串 / null        → 清除密钥（回落到环境变量或演示模式）
 * - 传非空字符串            → 加密后覆盖保存，同时生成掩码与指纹
 * 明文只在本次请求内存中存在，绝不写日志、绝不回传。
 *
 * 模型密钥与 MCP 密钥共用本函数（列名由 `prefix` 决定）：两处密钥的存储规则必须一致，
 * 各写一份迟早会出现"一边只存掩码、一边能回明文"这类不一致。
 */
export function buildSecretUpdate({ raw, prefix, env = process.env, label = '密钥', minLength = 8, maxLength = 400 }) {
  const columns = {
    cipher: `${prefix}_cipher`,
    hint: `${prefix}_hint`,
    fingerprint: `${prefix}_fingerprint`,
    updatedAt: `${prefix}_updated_at`,
  }
  if (raw === undefined) {
    return { ok: true, action: 'unchanged', values: {}, audit: null }
  }
  if (raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return {
      ok: true,
      action: 'clear',
      values: {
        [columns.cipher]: null,
        [columns.hint]: null,
        [columns.fingerprint]: null,
        [columns.updatedAt]: null,
      },
      audit: { keyAction: 'clear' },
    }
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: `${label}必须是字符串。` }
  }
  const plaintext = raw.trim()
  if (plaintext.length < minLength || plaintext.length > maxLength) {
    return {
      ok: false,
      error: `${label}长度不合法（应在 ${minLength}-${maxLength} 字符之间）。`,
    }
  }
  let key
  try {
    key = resolveSecretKey(env).key
  } catch (error) {
    if (error instanceof SecretConfigError) {
      return {
        ok: false,
        error: `${error.message}请在服务器 .env 配置 AI_SETTINGS_SECRET（或复用 JWT_SECRET）后重试。`,
      }
    }
    throw error
  }
  return {
    ok: true,
    action: 'set',
    values: {
      [columns.cipher]: encryptSecret(plaintext, key),
      [columns.hint]: maskSecret(plaintext),
      [columns.fingerprint]: fingerprintSecret(plaintext),
      [columns.updatedAt]: new Date().toISOString(),
    },
    // 审计只留掩码与指纹，可核对"哪一把 key"，不可反推
    audit: { keyAction: 'set', keyHint: maskSecret(plaintext), keyFingerprint: fingerprintSecret(plaintext) },
  }
}

/** 模型密钥（OpenAI 兼容服务）。 */
export function buildApiKeyUpdate(input = {}, env = process.env) {
  return buildSecretUpdate({ raw: input.modelApiKey, prefix: 'model_api_key', env, label: 'API Key' })
}

/** 卖家精灵 MCP 密钥：与模型密钥同一套加密与掩码规则（列名不同）。 */
export function buildMcpSecretUpdate(input = {}, env = process.env) {
  return buildSecretUpdate({
    raw: input.mcpSecret,
    prefix: 'mcp_secret',
    env,
    label: 'MCP 密钥',
    minLength: 6,
    maxLength: 500,
  })
}

const SETTINGS_COLUMNS = `model_provider, model_name, model_base_url, force_demo, temperature,
  max_output_tokens, max_turns_per_conversation, retrieval_top_k, request_timeout_ms,
  model_api_key_hint, model_api_key_cipher, model_api_key_updated_at,
  mcp_enabled, mcp_endpoint, mcp_prefix, mcp_timeout_ms,
  mcp_secret_hint, mcp_secret_cipher, mcp_secret_updated_at, mcp_synced_at, updated_at`

/**
 * 序列化配置给前端。**永远不返回明文密钥**，只返回掩码、是否已配置与当前实际生效的模式。
 * 判定实际生效模式必须走 resolveModelConfig，这样后台才能看到"填了 key 但没生效"这类问题。
 * MCP 部分同理走 resolveMcpConfig，`mcpReady` 才是"配了就能用"的唯一判据。
 */
export function serializeSettings(row, { env = process.env } = {}) {
  if (!row) return null
  const model = resolveModelConfig({ settings: row, env })
  const mcp = resolveMcpConfig(row, env)
  return {
    modelProvider: row.model_provider,
    modelName: row.model_name,
    modelBaseUrl: row.model_base_url,
    forceDemo: Boolean(row.force_demo),
    temperature: Number(row.temperature),
    maxOutputTokens: row.max_output_tokens,
    maxTurnsPerConversation: row.max_turns_per_conversation,
    retrievalTopK: row.retrieval_top_k,
    requestTimeoutMs: row.request_timeout_ms,
    updatedAt: row.updated_at,
    // 密钥相关：只有掩码与状态，没有明文
    apiKeyConfigured: model.keyConfigured,
    apiKeyHint: row.model_api_key_hint ?? null,
    apiKeyUpdatedAt: row.model_api_key_updated_at ?? null,
    apiKeyInvalid: model.keyInvalid,
    keySource: model.keySource,
    effectiveMode: model.forceDemo || !model.apiKey ? 'demo' : 'live',
    // MCP（卖家精灵）：同样只回掩码，不回明文
    mcpEnabled: mcp.enabled,
    mcpEndpoint: mcp.endpoint,
    mcpPrefix: mcp.prefix,
    mcpTimeoutMs: mcp.timeoutMs,
    mcpSecretConfigured: mcp.keyConfigured,
    mcpSecretHint: row.mcp_secret_hint ?? null,
    mcpSecretUpdatedAt: row.mcp_secret_updated_at ?? null,
    mcpSecretInvalid: mcp.keyInvalid,
    mcpKeySource: mcp.keySource,
    mcpReady: mcp.ready,
    mcpSyncedAt: row.mcp_synced_at ?? null,
  }
}

export function createAuditRouter({ adminGuard }) {
  const router = express.Router()

  /** 会话轨迹（分页）：左栏列表可能很长，翻页比"永远只看最近 50 条"更有用。 */
  router.get('/audit/conversations', adminGuard, async (req, res, next) => {
    try {
      const { page, pageSize } = parsePageQuery(req.query)
      const filters = {
        userId: parseIntFilter(req.query.userId),
        keyword: optionalString(req.query.keyword, { max: 100 }),
        from: parseDateFilter(req.query.from),
        to: parseDateFilter(req.query.to),
      }
      const [rows, total] = await Promise.all([
        listConversationTraces({ ...filters, limit: pageSize, offset: (page - 1) * pageSize }),
        countConversationTraces(filters),
      ])
      res.json({
        conversations: rows.map((row) => ({
          id: row.id,
          title: row.title,
          messageCount: row.message_count,
          createdAt: row.created_at,
          lastMessageAt: row.last_message_at,
          user: { id: row.user_id, login: row.login, name: row.name, role: row.role },
        })),
        total,
        page,
        pageSize,
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /** 完整轨迹：用于需求文档 §7.3 的审计完整性回溯。 */
  router.get('/audit/conversations/:id/trace', adminGuard, async (req, res, next) => {
    const id = parseIntFilter(req.params.id)
    if (!id) return res.status(400).json({ message: '会话参数无效。' })
    try {
      const trace = await loadConversationTrace(id)
      res.json({
        messages: trace.messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          provider: message.provider,
          model: message.model,
          tokensIn: message.tokens_in,
          tokensOut: message.tokens_out,
          latencyMs: message.latency_ms,
          status: message.status,
          citations: message.citations ?? [],
          createdAt: message.created_at,
        })),
        runs: trace.runs.map((run) => ({
          id: run.id,
          messageId: run.message_id,
          userId: run.user_id,
          toolName: run.tool_name,
          params: run.params ?? {},
          summary: run.result_summary,
          rowCount: run.row_count,
          status: run.status,
          error: run.error,
          latencyMs: run.latency_ms,
          createdAt: run.created_at,
        })),
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /**
   * 工具调用明细（分页）。
   *
   * 以前用 `limit=50` 一把抓：治理页看起来"有数据"，但第 51 条之后完全看不到，
   * 也没有任何提示 —— 审计要求的是可回溯，不是"能显示前 50 条"。
   * 现在返回 total 与 blockedTotal，指标卡由服务端计数，不再对当前页做 filter。
   */
  router.get('/audit/runs', adminGuard, async (req, res, next) => {
    try {
      const { page, pageSize } = parsePageQuery(req.query)
      const filters = {
        userId: parseIntFilter(req.query.userId),
        toolName: optionalString(req.query.toolName, { max: 120 }),
        status: optionalString(req.query.status, { max: 20 }),
        keyword: optionalString(req.query.keyword, { max: 100 }),
        from: parseDateFilter(req.query.from),
        to: parseDateFilter(req.query.to),
      }
      const [rows, counts] = await Promise.all([
        listRuns({ ...filters, limit: pageSize, offset: (page - 1) * pageSize }),
        countRuns(filters),
      ])
      res.json({
        runs: rows.map((row) => ({
          id: row.id,
          messageId: row.message_id,
          toolName: row.tool_name,
          params: row.params ?? {},
          summary: row.result_summary,
          rowCount: row.row_count,
          status: row.status,
          error: row.error,
          latencyMs: row.latency_ms,
          createdAt: row.created_at,
          user: { id: row.user_id, login: row.login, name: row.name, role: row.role },
        })),
        total: counts.total,
        blockedTotal: counts.blocked,
        page,
        pageSize,
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /** 管理动作日志（分页）：total / blockedTotal 由服务端统计，理由同 `/audit/runs`。 */
  router.get('/audit/logs', adminGuard, async (req, res, next) => {
    try {
      const { page, pageSize } = parsePageQuery(req.query)
      const filters = {
        actorId: parseIntFilter(req.query.actorId),
        action: optionalString(req.query.action, { max: 60 }),
        actions: parseActionList(req.query.actions),
        keyword: optionalString(req.query.keyword, { max: 100 }),
        from: parseDateFilter(req.query.from),
        to: parseDateFilter(req.query.to),
      }
      const [rows, counts] = await Promise.all([
        listAuditLogs({ ...filters, limit: pageSize, offset: (page - 1) * pageSize }),
        countAuditLogs(filters),
      ])
      res.json({
        logs: rows.map((row) => ({
          id: row.id,
          action: row.action,
          targetType: row.target_type,
          targetId: row.target_id,
          detail: row.detail ?? {},
          ip: row.ip,
          createdAt: row.created_at,
          actor: row.actor_id
            ? { id: row.actor_id, login: row.login, name: row.name, role: row.role }
            : null,
        })),
        total: counts.total,
        blockedTotal: counts.blocked,
        page,
        pageSize,
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /** CSV 导出。导出动作本身也写审计（需求文档 §5.4）。 */
  router.get('/audit/export', adminGuard, async (req, res, next) => {
    const type = optionalString(req.query.type, { max: 20 }) ?? 'runs'
    if (!EXPORT_TYPES.has(type)) {
      return res.status(400).json({ message: '导出类型无效。' })
    }
    try {
      const { filename, csv } = await buildExport(type, req.query)
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.auditExport,
        targetType: 'ai_audit',
        targetId: type,
        detail: { type, query: { ...req.query } },
        ip: clientIp(req),
      })
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      res.send(csv)
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.get('/usage', adminGuard, async (req, res, next) => {
    try {
      const days = Math.min(90, Math.max(1, Number.parseInt(req.query.days ?? '14', 10) || 14))
      const rows = await usageByDay({ days })
      res.json({
        days,
        usage: rows.map((row) => ({
          day: row.day,
          answers: Number(row.answers),
          tokensIn: Number(row.tokens_in),
          tokensOut: Number(row.tokens_out),
        })),
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.get('/settings', adminGuard, async (req, res, next) => {
    try {
      const [settings, tools, mcpCounts] = await Promise.all([
        loadSettings(),
        query('SELECT name, description, required_role, enabled, source FROM ai_tools ORDER BY source, name'),
        query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE enabled)::int AS enabled
             FROM ai_tools WHERE source = 'mcp'`
        ),
      ])
      res.json({
        settings: serializeSettings(settings),
        secretsReady: (() => {
          // 让管理员一眼看到"能不能保存密钥"：没有加密 secret 时保存会失败
          try {
            resolveSecretKey().source
            return { ok: true }
          } catch (error) {
            return { ok: false, message: error.message }
          }
        })(),
        mcpTools: {
          total: Number(mcpCounts.rows[0]?.total ?? 0),
          enabled: Number(mcpCounts.rows[0]?.enabled ?? 0),
        },
        tools: tools.rows.map((tool) => ({
          name: tool.name,
          description: tool.description,
          requiredRole: tool.required_role,
          enabled: tool.enabled,
          source: tool.source ?? 'builtin',
        })),
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.patch('/settings', adminGuard, async (req, res, next) => {
    try {
      const body = req.body ?? {}
      // 端点里若粘进了 `?secret-key=xxx`（官方文档的 URL 直连写法），保存时自动搬到密钥框：
      // 否则密钥会明文留在 mcp_endpoint 列里，而界面显示"密钥来源：未配置"。
      const split = typeof body.mcpEndpoint === 'string' ? splitEndpointSecret(body.mcpEndpoint) : null
      const movedSecret = Boolean(split?.secret) && body.mcpSecret === undefined
      // 无论密钥框是否同时填写，端点中的 secret-key 都必须被移除，避免明文进入 mcp_endpoint。
      const normalized = split
        ? { ...body, mcpEndpoint: split.endpoint, ...(movedSecret ? { mcpSecret: split.secret } : {}) }
        : body

      const fields = parseSettingsPatch(normalized)
      const keyUpdate = buildApiKeyUpdate(normalized)
      const mcpKeyUpdate = buildMcpSecretUpdate(normalized)
      if (!keyUpdate.ok) return res.status(400).json({ message: keyUpdate.error })
      if (!mcpKeyUpdate.ok) return res.status(400).json({ message: mcpKeyUpdate.error })

      const secretValues = { ...keyUpdate.values, ...mcpKeyUpdate.values }
      // 只改密钥、没动其它字段是合法用法：此时 parseSettingsPatch 的「没有需要更新的配置项」
      // 只是说明它自己没活干，不代表整个请求非法。
      if (!fields.ok && Object.keys(secretValues).length === 0) {
        return res.status(400).json({ message: fields.error })
      }

      const values = { ...(fields.ok ? fields.values : {}), ...secretValues }
      const columns = Object.keys(values)
      const params = columns.map((column) => values[column])
      const assignments = columns.map((column, index) => `${column} = $${index + 1}`)
      params.push(req.user.id)
      const { rows } = await query(
        `UPDATE ai_settings
            SET ${assignments.join(', ')}, updated_by = $${params.length}, updated_at = NOW()
          WHERE id = 1
          RETURNING ${SETTINGS_COLUMNS}`,
        params
      )

      // 管理动作审计：只记改了哪些字段与密钥掩码/指纹，绝不记明文
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.settingsUpdate,
        targetType: 'ai_settings',
        targetId: '1',
        detail: {
          fields: Object.keys(fields.ok ? fields.values : {}),
          keyAction: keyUpdate.action,
          ...(keyUpdate.audit ?? {}),
          ...(mcpKeyUpdate.action === 'unchanged'
            ? {}
            : { mcpKeyAction: mcpKeyUpdate.action, ...(mcpKeyUpdate.audit ?? {}) }),
          ...(movedSecret ? { mcpSecretMovedFromEndpoint: true } : {}),
        },
        ip: clientIp(req),
      })

      res.json({ settings: serializeSettings(rows[0]) })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /**
   * 测试卖家精灵 MCP 连通性（管理员）。
   *
   * 与模型测试同一口径：可以只测已保存的配置，也可以带上候选密钥/端点先测后存。
   * **必须显式识别"密钥无效却返回 200"的情况** —— 卖家精灵在密钥错误时不报 HTTP 错误，
   * 而是把工具清单退化成一个 `secret_invalid` 伪工具（见 mcp-client.mjs），
   * 若不特判，管理员会看到"连接成功、1 个工具"，然后模型永远查不到数据。
   */
  router.post('/settings/mcp/test', adminGuard, async (req, res, next) => {
    try {
      const body = req.body ?? {}
      const current = await loadSettings()
      const candidateSecret = typeof body.mcpSecret === 'string' && body.mcpSecret.trim()
        ? body.mcpSecret.trim()
        : null
      const result = await testMcpConnection({
        row: current,
        candidateSecret,
        candidateEndpoint: body.mcpEndpoint ? String(body.mcpEndpoint).trim() : null,
      })
      res.json(result)
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /**
   * 同步卖家精灵工具清单到 `ai_tools`（管理员）。
   *
   * 只有同步进库的工具才会被注册给模型 —— 这样"工具开关 / 角色裁剪 / 未注册拒绝"这些
   * 既有机制对 MCP 工具自动生效，不需要在编排层另开一条通道。
   * 同步使用**已保存**的配置（先测后存由 /settings/mcp/test 负责）。
   */
  router.post('/settings/mcp/sync', adminGuard, async (req, res, next) => {
    try {
      const current = await loadSettings()
      const config = resolveMcpConfig(current)
      if (!config.enabled) {
        return res.status(400).json({ ok: false, message: '请先打开「启用卖家精灵 MCP」再同步工具。' })
      }
      if (!config.keyConfigured) {
        return res.status(400).json({
          ok: false,
          message: config.keyInvalid
            ? '已保存的 MCP 密钥无法解密（通常是服务器 AI_SETTINGS_SECRET 变更过），请重新填写密钥。'
            : '请先保存卖家精灵 MCP 密钥，再同步工具。',
        })
      }
      const result = await syncMcpTools({ row: current })
      await query('UPDATE ai_settings SET mcp_synced_at = NOW() WHERE id = 1')
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.settingsUpdate,
        targetType: 'ai_settings',
        targetId: '1',
        detail: {
          mcpSync: true,
          endpoint: result.endpoint,
          prefix: result.prefix,
          toolCount: result.toolCount,
          added: result.added,
          updated: result.updated,
          removed: result.removed.length,
        },
        ip: clientIp(req),
      })
      res.json({
        ok: true,
        message: `已同步 ${result.toolCount} 个卖家精灵工具（新增 ${result.added}、更新 ${result.updated}、移除 ${result.removed.length}）。`,
        ...result,
      })
    } catch (error) {
      if (error instanceof McpConfigError) {
        return res.status(400).json({ ok: false, message: error.message })
      }
      handleAiError(error, res, next)
    }
  })


  /**
   * 测试模型连接（管理员）。
   * 支持两种用法：直接测试当前已保存的配置；或带上候选参数先测后存（避免存了错配置再回滚）。
   * 只做一次极短的补全调用，不传工具、不落库、不写审计明细中的密钥。
   */
  router.post('/settings/test', adminGuard, async (req, res, next) => {
    const startedAt = Date.now()
    try {
      const body = req.body ?? {}
      const current = await loadSettings()
      const candidateKey = typeof body.modelApiKey === 'string' && body.modelApiKey.trim()
        ? body.modelApiKey.trim()
        : null

      let settingsRow = current ?? {}
      if (candidateKey) {
        // 复用同一套加密路径得到临时密文，再走统一的配置解析，保证与保存后行为一致
        let cipher
        try {
          cipher = encryptSecret(candidateKey, resolveSecretKey().key)
        } catch (error) {
          if (error instanceof SecretConfigError) {
            return res.status(400).json({
              ok: false,
              message: `${error.message}请在服务器 .env 配置 AI_SETTINGS_SECRET（或复用 JWT_SECRET）。`,
            })
          }
          throw error
        }
        settingsRow = { ...settingsRow, model_api_key_cipher: cipher, force_demo: false }
      }
      if (body.modelBaseUrl) {
        // 连通性测试会**立即**向该地址出站（无需先落库），因此这里同样必须过白名单校验。
        const parsed = parseModelBaseUrl(body.modelBaseUrl)
        if (!parsed.ok) {
          return res.status(400).json({ ok: false, message: parsed.error })
        }
        settingsRow = { ...settingsRow, model_base_url: parsed.value }
      }
      if (body.modelName) settingsRow = { ...settingsRow, model_name: String(body.modelName).trim() }

      const config = resolveModelConfig({ settings: settingsRow })
      if (config.forceDemo && !candidateKey) {
        return res.json({
          ok: false,
          message: '当前已开启「强制演示模式」，测试前请先关闭该开关。',
          effectiveMode: 'demo',
        })
      }
      if (!config.apiKey) {
        return res.json({
          ok: false,
          message: '尚未配置 API Key，未发起请求。',
          effectiveMode: 'demo',
          keySource: config.keySource,
        })
      }

      const provider = resolveProvider({ settings: settingsRow })
      if (provider.mode !== 'live') {
        return res.json({ ok: false, message: '当前配置解析为演示模式，未发起真实请求。' })
      }

      const completion = await provider.complete({
        messages: [
          {
            role: 'user',
            content: '连通性测试：请只回复两个字「正常」。',
          },
        ],
        tools: [],
      })
      const latencyMs = Date.now() - startedAt
      res.json({
        ok: true,
        message: `连接成功（${latencyMs}ms）`,
        latencyMs,
        model: config.model,
        baseUrl: config.baseUrl,
        keySource: config.keySource,
        sample: String(completion.content ?? '').slice(0, 80),
        tokensIn: completion.tokensIn ?? 0,
        tokensOut: completion.tokensOut ?? 0,
      })
    } catch (error) {
      // 测试失败要把原因如实返回给管理员，但不能包含密钥
      const latencyMs = Date.now() - startedAt
      const raw = error?.message ?? '未知错误'
      const sanitized = raw.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
      process.stderr.write(`[ai-agent] 模型连通性测试失败：${sanitized}\n`)
      res.json({ ok: false, message: `连接失败：${sanitized}`, latencyMs })
    }
  })

  /** 工具开关：停用后该工具对所有人都不再注册（层① 直接生效）。 */
  router.patch('/tools/:name', adminGuard, async (req, res, next) => {
    // 上限必须与 ai_tools.name 的列宽一致（迁移 117 放宽到 120）：tool 名一旦被截断，
    // 这次开关就会作用到另一个名字上（或直接 404），而管理员只会看到"点了没反应"。
    const name = optionalString(req.params.name, { max: 120 })
    if (!name) return res.status(400).json({ message: '工具参数无效。' })
    if (typeof req.body?.enabled !== 'boolean') {
      return res.status(400).json({ message: '工具开关参数无效。' })
    }
    try {
      const { rows } = await query(
        `UPDATE ai_tools SET enabled = $2, updated_at = NOW()
          WHERE name = $1
          RETURNING name, enabled, required_role`,
        [name, req.body.enabled]
      )
      if (!rows[0]) return res.status(404).json({ message: '工具不存在。' })
      await recordAudit({
        actorId: req.user.id,
        action: 'tool_toggle',
        targetType: 'ai_tool',
        targetId: name,
        detail: { enabled: req.body.enabled, requiredRole: rows[0].required_role },
        ip: clientIp(req),
      })
      res.json({ tool: rows[0] })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.use((error, _req, res, next) => handleAiError(error, res, next))

  return router
}

async function buildExport(type, queryParams = {}) {
  const from = parseDateFilter(queryParams.from)
  const to = parseDateFilter(queryParams.to)
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-')

  if (type === 'conversations') {
    const rows = await listConversationTraces({
      keyword: optionalString(queryParams.keyword, { max: 100 }),
      from,
      to,
      limit: 200,
    })
    return {
      filename: `ai-conversations-${stamp}.csv`,
      csv: toCsv(
        [
          { label: '会话ID', value: (row) => row.id },
          { label: '标题', value: (row) => row.title },
          { label: '提问人', value: (row) => row.login },
          { label: '姓名', value: (row) => row.name },
          { label: '角色', value: (row) => row.role },
          { label: '消息数', value: (row) => row.message_count },
          { label: '创建时间', value: (row) => row.created_at },
          { label: '最后活跃', value: (row) => row.last_message_at },
        ],
        rows
      ),
    }
  }

  if (type === 'logs') {
    const rows = await listAuditLogs({
      action: optionalString(queryParams.action, { max: 60 }),
      keyword: optionalString(queryParams.keyword, { max: 100 }),
      from,
      to,
      limit: 300,
    })
    return {
      filename: `ai-audit-logs-${stamp}.csv`,
      csv: toCsv(
        [
          { label: '日志ID', value: (row) => row.id },
          { label: '动作', value: (row) => row.action },
          { label: '操作人', value: (row) => row.login },
          { label: '目标类型', value: (row) => row.target_type },
          { label: '目标ID', value: (row) => row.target_id },
          { label: '详情', value: (row) => row.detail },
          { label: 'IP', value: (row) => row.ip },
          { label: '时间', value: (row) => row.created_at },
        ],
        rows
      ),
    }
  }

  const rows = await listRuns({
    toolName: optionalString(queryParams.toolName, { max: 120 }),
    status: optionalString(queryParams.status, { max: 20 }),
    keyword: optionalString(queryParams.keyword, { max: 100 }),
    from,
    to,
    limit: 200,
  })
  return {
    filename: `ai-tool-runs-${stamp}.csv`,
    csv: toCsv(
      [
        { label: '调用ID', value: (row) => row.id },
        { label: '工具', value: (row) => row.tool_name },
        { label: '参数', value: (row) => row.params },
        { label: '调用人', value: (row) => row.login },
        { label: '角色', value: (row) => row.role },
        { label: '状态', value: (row) => row.status },
        { label: '返回摘要', value: (row) => row.result_summary },
        { label: '行数', value: (row) => row.row_count },
        { label: '错误', value: (row) => row.error },
        { label: '耗时ms', value: (row) => row.latency_ms },
        { label: '时间', value: (row) => row.created_at },
      ],
      rows
    ),
  }
}

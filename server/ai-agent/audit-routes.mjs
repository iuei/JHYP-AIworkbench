/**
 * 审计台与系统配置接口（管理员）：会话轨迹 / 工具调用明细 / 拦截记录 / 管理动作 / CSV 导出 / 用量 / 模型与编排配置。
 *
 * 审计查询只读，本模块**不提供任何删除接口**（需求文档 §5.4）。
 */
import express from 'express'
import {
  AUDIT_ACTIONS,
  listAuditLogs,
  listConversationTraces,
  listRuns,
  loadConversationTrace,
  recordAudit,
  usageByDay,
} from './audit.mjs'
import { query } from '../db.mjs'
import { clientIp, handleAiError, optionalString, parseLimit, toCsv } from './http-utils.mjs'
import { loadSettings } from './knowledge.mjs'
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
]

function parseDateFilter(value) {
  const text = optionalString(value, { max: 40 })
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
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
      const text = String(raw).trim().replace(/\/+$/, '')
      if (!/^https?:\/\/[^\s]+$/i.test(text) || text.length > field.max) {
        return { ok: false, error: `参数 ${field.key} 必须是合法的 http(s) 地址。` }
      }
      values[field.column] = text
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
 * - 未传 modelApiKey        → 不修改已保存的密钥
 * - 传空字符串 / null        → 清除密钥（回落到环境变量或演示模式）
 * - 传非空字符串            → 加密后覆盖保存，同时生成掩码与指纹
 * 明文只在本次请求内存中存在，绝不写日志、绝不回传。
 */
export function buildApiKeyUpdate(input = {}, env = process.env) {
  if (input.modelApiKey === undefined) {
    return { ok: true, action: 'unchanged', values: {}, audit: null }
  }
  const raw = input.modelApiKey
  if (raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return {
      ok: true,
      action: 'clear',
      values: {
        model_api_key_cipher: null,
        model_api_key_hint: null,
        model_api_key_fingerprint: null,
        model_api_key_updated_at: null,
      },
      audit: { keyAction: 'clear' },
    }
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: 'API Key 必须是字符串。' }
  }
  const plaintext = raw.trim()
  if (plaintext.length < 8 || plaintext.length > 400) {
    return { ok: false, error: 'API Key 长度不合法（应在 8-400 字符之间）。' }
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
      model_api_key_cipher: encryptSecret(plaintext, key),
      model_api_key_hint: maskSecret(plaintext),
      model_api_key_fingerprint: fingerprintSecret(plaintext),
      model_api_key_updated_at: new Date().toISOString(),
    },
    // 审计只留掩码与指纹，可核对"哪一把 key"，不可反推
    audit: { keyAction: 'set', keyHint: maskSecret(plaintext), keyFingerprint: fingerprintSecret(plaintext) },
  }
}

const SETTINGS_COLUMNS = `model_provider, model_name, model_base_url, force_demo, temperature,
  max_output_tokens, max_turns_per_conversation, retrieval_top_k, request_timeout_ms,
  model_api_key_hint, model_api_key_cipher, model_api_key_updated_at, updated_at`

/**
 * 序列化配置给前端。**永远不返回明文密钥**，只返回掩码、是否已配置与当前实际生效的模式。
 * 判定实际生效模式必须走 resolveModelConfig，这样后台才能看到"填了 key 但没生效"这类问题。
 */
export function serializeSettings(row, { env = process.env } = {}) {
  if (!row) return null
  const model = resolveModelConfig({ settings: row, env })
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
  }
}

export function createAuditRouter({ adminGuard }) {
  const router = express.Router()

  router.get('/audit/conversations', adminGuard, async (req, res, next) => {
    try {
      const rows = await listConversationTraces({
        userId: parseIntFilter(req.query.userId),
        keyword: optionalString(req.query.keyword, { max: 100 }),
        from: parseDateFilter(req.query.from),
        to: parseDateFilter(req.query.to),
        limit: parseLimit(req.query, { fallback: 50, max: 200 }),
      })
      res.json({
        conversations: rows.map((row) => ({
          id: row.id,
          title: row.title,
          messageCount: row.message_count,
          createdAt: row.created_at,
          lastMessageAt: row.last_message_at,
          user: { id: row.user_id, login: row.login, name: row.name, role: row.role },
        })),
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

  router.get('/audit/runs', adminGuard, async (req, res, next) => {
    try {
      const rows = await listRuns({
        userId: parseIntFilter(req.query.userId),
        toolName: optionalString(req.query.toolName, { max: 80 }),
        status: optionalString(req.query.status, { max: 20 }),
        keyword: optionalString(req.query.keyword, { max: 100 }),
        from: parseDateFilter(req.query.from),
        to: parseDateFilter(req.query.to),
        limit: parseLimit(req.query, { fallback: 50, max: 200 }),
      })
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
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.get('/audit/logs', adminGuard, async (req, res, next) => {
    try {
      const rows = await listAuditLogs({
        actorId: parseIntFilter(req.query.actorId),
        action: optionalString(req.query.action, { max: 60 }),
        keyword: optionalString(req.query.keyword, { max: 100 }),
        from: parseDateFilter(req.query.from),
        to: parseDateFilter(req.query.to),
        limit: parseLimit(req.query, { fallback: 100, max: 300 }),
      })
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
      const [settings, tools] = await Promise.all([
        loadSettings(),
        query('SELECT name, description, required_role, enabled FROM ai_tools ORDER BY name'),
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
        tools: tools.rows.map((tool) => ({
          name: tool.name,
          description: tool.description,
          requiredRole: tool.required_role,
          enabled: tool.enabled,
        })),
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  router.patch('/settings', adminGuard, async (req, res, next) => {
    try {
      const body = req.body ?? {}
      const fields = parseSettingsPatch(body)
      const keyUpdate = buildApiKeyUpdate(body)
      if (!keyUpdate.ok) return res.status(400).json({ message: keyUpdate.error })
      if (!fields.ok && keyUpdate.action === 'unchanged') {
        return res.status(400).json({ message: fields.error })
      }
      if (!fields.ok) return res.status(400).json({ message: fields.error })

      const values = { ...fields.values, ...keyUpdate.values }
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
          fields: Object.keys(fields.values),
          keyAction: keyUpdate.action,
          ...(keyUpdate.audit ?? {}),
        },
        ip: clientIp(req),
      })

      res.json({ settings: serializeSettings(rows[0]) })
    } catch (error) {
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
        const baseUrl = String(body.modelBaseUrl).trim()
        if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
          return res.status(400).json({ ok: false, message: 'Base URL 必须是合法的 http(s) 地址。' })
        }
        settingsRow = { ...settingsRow, model_base_url: baseUrl }
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
    const name = optionalString(req.params.name, { max: 80 })
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
    toolName: optionalString(queryParams.toolName, { max: 80 }),
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

/**
 * HTTP 层公共工具：分页参数、客户端 IP、CSV 生成、统一错误处理。
 */
import { KnowledgeValidationError } from './knowledge.mjs'
import { OrchestratorError } from './orchestrator.mjs'

export const MAX_PAGE_SIZE = 100

/**
 * 客户端 IP。
 *
 * 默认**不信任** `X-Forwarded-For`：该请求头由客户端完全可控，任何人加一行就能让自己的
 * 每次 `tool_blocked` / `forbidden` / `settings_update` 记录落上任意 IP（包括伪造他人 IP 栽赃），
 * 审计随即失去取证价值。只有确实部署在反向代理之后（`TRUST_PROXY=true`）才采信转发头，
 * 且取链上**最后一跳**（代理追加的那一段），而不是最左边那个客户端可伪造的值。
 */
export function clientIp(req) {
  const direct = (req?.socket?.remoteAddress ?? req?.ip ?? '').slice(0, 64) || null
  if (process.env.TRUST_PROXY !== 'true') return direct

  const forwarded = req?.headers?.['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const hops = forwarded
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    return (hops[hops.length - 1] ?? direct ?? '').slice(0, 64) || null
  }
  return direct
}

/**
 * 校验模型 Base URL 是否可以安全出站。
 *
 * 为什么必须限制：这个值由管理员在后台填写，服务端随后会**带着解密的 API Key** 向它发请求。
 * 只校验「http(s) + 无空白」会让内网地址（169.254.169.254、127.0.0.1、10.x）变成可探测目标，
 * 也能把任意域名填进去、让服务端把明文 Key 外发出去（用 `.env` 里的兜底 Key 同样会命中）。
 *
 * 规则：必须 https、必须是域名（拒绝 IP 字面量）、拒绝 localhost 与 .local/.internal。
 * 真正需要连内网私有模型的部署可以设 `AI_MODEL_ALLOW_PRIVATE_HOST=true` 放开（默认关闭）。
 *
 * 残余风险：不做 DNS 解析后的 IP 复核，「解析到私网 IP 的公网域名」仍可能通过；
 * 彻底闭环需要在出站前解析并校验目标 IP。
 */
export function parseModelBaseUrl(raw, { max = 300 } = {}) {
  const text = String(raw ?? '').trim().replace(/\/+$/, '')
  if (!text) return { ok: false, error: 'Base URL 不能为空。' }
  if (text.length > max) return { ok: false, error: `Base URL 不能超过 ${max} 个字符。` }

  let url
  try {
    url = new URL(text)
  } catch {
    return { ok: false, error: 'Base URL 不是合法的地址。' }
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Base URL 必须是 https 地址（不允许明文 http，避免密钥明文出网）。' }
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Base URL 不能包含用户名或密码。' }
  }

  if (process.env.AI_MODEL_ALLOW_PRIVATE_HOST === 'true') return { ok: true, value: text }

  const host = url.hostname.toLowerCase()
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
    return { ok: false, error: 'Base URL 不允许使用 IP 地址，请填写域名。' }
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return {
      ok: false,
      error: 'Base URL 不允许指向本机或内网域名。确需连接内网模型服务时，请在服务器设置 AI_MODEL_ALLOW_PRIVATE_HOST=true。',
    }
  }
  return { ok: true, value: text }
}

export function optionalString(value, { max = 200 } = {}) {
  if (value === undefined || value === null) return null
  const text = String(value).trim()
  if (!text) return null
  return text.slice(0, max)
}

export function optionalDate(value) {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) {
    throw new KnowledgeValidationError('日期参数无效。')
  }
  return date.toISOString()
}

/** 时间筛选的最大跨度（天）：导出是全量拉取，跨度过大等于把库扫一遍。 */
export const MAX_DATE_RANGE_DAYS = 366

/**
 * 解析列表/导出共用的时间范围。
 *
 * 为什么不直接信前端传的 from/to：前端控件的顺序不保证，服务端必须自己兜住
 * "开始晚于结束"（会静默查出空集合，看起来像"没有数据"）和"范围过大"（导出压力）。
 * 调用方（列表与导出）必须传同一个返回对象，否则筛选条件会不一致。
 */
export function parseDateRange({ from, to, maxDays = MAX_DATE_RANGE_DAYS } = {}) {
  const start = optionalDate(from) ?? null
  const end = optionalDate(to) ?? null
  if (start && end && new Date(start).getTime() > new Date(end).getTime()) {
    throw new KnowledgeValidationError('开始日期不能晚于结束日期。')
  }
  if (start && end) {
    const days = (new Date(end).getTime() - new Date(start).getTime()) / 86400000
    if (days > maxDays) {
      throw new KnowledgeValidationError(`时间范围不能超过 ${maxDays} 天，请缩小范围后重试。`)
    }
  }
  return { from: start, to: end }
}

export function parsePageQuery(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1)
  const rawSize = Number.parseInt(query.pageSize ?? '20', 10) || 20
  return { page, pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize)) }
}

export function parseLimit(query = {}, { fallback = 50, max = 200 } = {}) {
  const value = Number.parseInt(query.limit ?? '', 10)
  if (!Number.isInteger(value)) return fallback
  return Math.min(max, Math.max(1, value))
}

/**
 * 批量接口的公共校验：动作白名单 + id 归一化（去非法、去重、限单批上限）。
 *
 * 为什么抽出来：知识库批量与沉淀批量需要**完全一致**的边界口径。各写一份的结果是
 * 一边允许重复 id 一边不允许、一边限 200 一边不限，前端拿到的失败原因也会不一致。
 *
 * 去重不是洁癖：重复 id 会让"成功 5 条"里其实只有 3 条文档，审计也会多出几条
 * 指向同一对象的记录，事后无法解释。
 */
export function parseBatchRequest(
  body = {},
  { actions, actionMessage, max, subject } = {}
) {
  const action = optionalString(body?.action, { max: 20 })
  if (!Array.isArray(actions) || !actions.includes(action)) {
    return { ok: false, message: actionMessage ?? '批量动作无效。' }
  }
  const rawIds = Array.isArray(body?.ids) ? body.ids : []
  const ids = [
    ...new Set(
      rawIds
        .map((value) => {
          const id = Number(value)
          return Number.isInteger(id) && id > 0 ? id : null
        })
        .filter((id) => id !== null)
    ),
  ]
  if (ids.length === 0) return { ok: false, message: `请至少选择 1 ${subject}。` }
  if (ids.length > max) {
    return { ok: false, message: `一次最多处理 ${max} ${subject}，请分批操作。` }
  }
  return { ok: true, action, ids }
}

export function csvEscape(value) {
  if (value === null || value === undefined) return ''
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

export function toCsv(columns, rows) {
  const header = columns.map((column) => csvEscape(column.label)).join(',')
  const body = rows.map((row) =>
    columns.map((column) => csvEscape(column.value(row))).join(',')
  )
  // 加 BOM 保证 Excel 打开中文不乱码
  return `\uFEFF${[header, ...body].join('\r\n')}\r\n`
}

/** 统一错误处理：校验类错误 400，其它交给上层。 */
export function handleAiError(error, res, next) {
  if (error instanceof KnowledgeValidationError || error instanceof OrchestratorError) {
    return res.status(400).json({ message: error.message })
  }
  return next(error)
}

/** 管理接口的统一 403 + 审计（非管理员访问一律留痕）。 */
export function forbiddenHandler({ recordAudit, action = 'forbidden' }) {
  return async (req, res) => {
    try {
      await recordAudit({
        actorId: req.user?.id ?? null,
        action,
        targetType: 'api',
        targetId: req.originalUrl?.slice(0, 80) ?? null,
        detail: { method: req.method, reason: 'not_admin' },
        ip: clientIp(req),
      })
    } catch {
      // 审计失败不应把 403 变成 500，但也不能静默成功——这里按 403 返回，异常写服务端日志
      process.stderr.write('[ai-agent] 403 审计写入失败\n')
    }
    return res.status(403).json({ message: '仅管理员可执行此操作。' })
  }
}

/**
 * HTTP 层公共工具：分页参数、客户端 IP、CSV 生成、统一错误处理。
 */
import { KnowledgeValidationError } from './knowledge.mjs'
import { OrchestratorError } from './orchestrator.mjs'

export const MAX_PAGE_SIZE = 100

export function clientIp(req) {
  const forwarded = req?.headers?.['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 64)
  }
  return (req?.socket?.remoteAddress ?? req?.ip ?? '').slice(0, 64) || null
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

export function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
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

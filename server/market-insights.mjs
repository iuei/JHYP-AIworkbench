import { query } from './db.mjs'

const MARKETPLACE_PATTERN = /^[A-Z]{2}$/
const SCOPE_TYPES = new Set(['category', 'node', 'asin'])
const MAX_RESULT_BYTES = 8 * 1024 * 1024

export class MarketInsightValidationError extends Error {}

export class MarketInsightNotFoundError extends Error {}

function textValue(value, { label, max, required = false }) {
  if (value === undefined || value === null) {
    if (required) throw new MarketInsightValidationError(`${label}不能为空。`)
    return ''
  }
  const text = String(value).trim()
  if (required && !text) throw new MarketInsightValidationError(`${label}不能为空。`)
  if (text.length > max) {
    throw new MarketInsightValidationError(`${label}不能超过 ${max} 个字符。`)
  }
  return text
}

function objectValue(value, label, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new MarketInsightValidationError(`${label}不能为空。`)
    return {}
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new MarketInsightValidationError(`${label}必须是对象。`)
  }
  return value
}

function normalizeFetchedAt(value) {
  if (value === undefined || value === null || value === '') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new MarketInsightValidationError('抓取时间格式无效。')
  }
  return date.toISOString()
}

export function normalizeMarketInsightInput(input = {}) {
  const marketplace = textValue(input.marketplace ?? 'US', {
    label: '站点',
    max: 10,
    required: true,
  }).toUpperCase()
  if (!MARKETPLACE_PATTERN.test(marketplace)) {
    throw new MarketInsightValidationError('站点需为两位站点代码（例如 US、UK、DE、JP）。')
  }

  const scopeType = textValue(input.scopeType ?? 'category', {
    label: '报告类型',
    max: 20,
    required: true,
  }).toLowerCase()
  if (!SCOPE_TYPES.has(scopeType)) {
    throw new MarketInsightValidationError('报告类型无效。')
  }

  const scopeKey = textValue(input.scopeKey, { label: '分析对象', max: 200, required: true })
  const scopeLabel = textValue(input.scopeLabel, { label: '对象名称', max: 300 })
  const filters = objectValue(input.filters, '筛选条件')
  const result = objectValue(input.result, '报告结果', { required: true })
  const sourceMeta = objectValue(input.sourceMeta, '来源信息')
  const resultBytes = Buffer.byteLength(JSON.stringify(result), 'utf8')
  if (resultBytes > MAX_RESULT_BYTES) {
    throw new MarketInsightValidationError('报告结果过大，无法保存。')
  }

  return {
    marketplace,
    scopeType,
    scopeKey,
    scopeLabel,
    filters,
    result,
    sourceMeta,
    fetchedAt: normalizeFetchedAt(input.fetchedAt),
  }
}

function toReportSummary(row) {
  return {
    id: Number(row.id),
    marketplace: row.marketplace,
    scopeType: row.scope_type,
    scopeKey: row.scope_key,
    scopeLabel: row.scope_label,
    headline: row.headline ?? null,
    fetchedAt: row.fetched_at,
    createdAt: row.created_at,
  }
}

function toReport(row) {
  return {
    ...toReportSummary(row),
    filters: row.filters,
    result: row.result,
    sourceMeta: row.source_meta,
  }
}

export async function createMarketInsightReport({ userId, input }) {
  const normalized = normalizeMarketInsightInput(input)
  const { rows } = await query(
    `
      INSERT INTO market_insight_reports
        (owner_user_id, marketplace, scope_type, scope_key, scope_label, filters, result, source_meta, fetched_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)
      RETURNING id, marketplace, scope_type, scope_key, scope_label,
        result->>'headline' AS headline, filters, result, source_meta, fetched_at, created_at
    `,
    [
      userId,
      normalized.marketplace,
      normalized.scopeType,
      normalized.scopeKey,
      normalized.scopeLabel,
      JSON.stringify(normalized.filters),
      JSON.stringify(normalized.result),
      JSON.stringify(normalized.sourceMeta),
      normalized.fetchedAt,
    ]
  )
  return toReport(rows[0])
}

export async function listMarketInsightReports(userId, options = {}) {
  const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100)
  const offset = Math.max(Number(options.offset) || 0, 0)
  const conditions = ['owner_user_id = $1']
  const params = [userId]

  if (options.marketplace) {
    params.push(String(options.marketplace).trim().toUpperCase())
    conditions.push(`marketplace = $${params.length}`)
  }
  if (options.scopeType) {
    const scopeType = String(options.scopeType).trim().toLowerCase()
    if (!SCOPE_TYPES.has(scopeType)) {
      throw new MarketInsightValidationError('报告类型无效。')
    }
    params.push(scopeType)
    conditions.push(`scope_type = $${params.length}`)
  }

  const where = conditions.join(' AND ')
  const countResult = await query(
    `SELECT COUNT(*)::int AS total FROM market_insight_reports WHERE ${where}`,
    params
  )
  const listParams = [...params, limit, offset]
  const { rows } = await query(
    `
      SELECT id, marketplace, scope_type, scope_key, scope_label,
        result->>'headline' AS headline, fetched_at, created_at
      FROM market_insight_reports
      WHERE ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}
    `,
    listParams
  )

  return {
    items: rows.map(toReportSummary),
    total: Number(countResult.rows[0]?.total ?? 0),
    limit,
    offset,
  }
}

export async function getMarketInsightReport(userId, id) {
  const { rows } = await query(
    `
      SELECT id, marketplace, scope_type, scope_key, scope_label,
        result->>'headline' AS headline, filters, result, source_meta, fetched_at, created_at
      FROM market_insight_reports
      WHERE id = $1 AND owner_user_id = $2
    `,
    [id, userId]
  )
  return rows[0] ? toReport(rows[0]) : null
}

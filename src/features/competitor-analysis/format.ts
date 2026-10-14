import type { FindingLevel } from './types'

/** 结论严重度文案与徽章样式（与服务端 `FINDING_WEIGHTS` 的分级语义一致）。 */
export const FINDING_LEVEL_LABELS: Record<FindingLevel, string> = {
  high: '需立即处理',
  medium: '需关注',
  low: '低风险',
  info: '提示',
}

export const FINDING_LEVEL_VARIANTS: Record<
  FindingLevel,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  high: 'destructive',
  medium: 'default',
  low: 'secondary',
  info: 'outline',
}

/** 站点选项：`auto` 表示交给服务端按数据推导（不传该字段）。 */
export const MARKETPLACE_OPTIONS = [
  { label: '自动（按数据推导）', value: 'auto' },
  { label: '美国 US', value: 'US' },
  { label: '英国 UK', value: 'UK' },
  { label: '德国 DE', value: 'DE' },
  { label: '法国 FR', value: 'FR' },
  { label: '意大利 IT', value: 'IT' },
  { label: '西班牙 ES', value: 'ES' },
  { label: '日本 JP', value: 'JP' },
  { label: '加拿大 CA', value: 'CA' },
  { label: '墨西哥 MX', value: 'MX' },
  { label: '澳大利亚 AU', value: 'AU' },
]

export const COMPARE_OPTIONS = [
  { label: '环比上一等长区间', value: 'previous_period' },
  { label: '同比去年同期', value: 'last_year' },
  { label: '不做对比', value: 'none' },
]

/**
 * 统计区间预设。
 *
 * ⚠️ 与服务端 `server/competitor-analysis.mjs` 的 `WINDOW_PRESETS` / `MAX_WINDOW_DAYS`
 * 是**同一份口径**：加预设要同时放宽服务端上限，否则"页面能选、提交被 400 拒绝"。
 * 2026-09-16 新增「半年」（180 天）与「一年」（365 天）。
 */
export const WINDOW_OPTIONS = [
  { label: '7 天', value: '7' },
  { label: '30 天', value: '30' },
  { label: '90 天', value: '90' },
  { label: '半年', value: '180' },
  { label: '一年', value: '365' },
  { label: '自定义', value: 'custom' },
]

const COMPARE_LABELS: Record<string, string> = {
  previous_period: '环比上一等长区间',
  last_year: '同比去年同期',
  none: '不做对比',
}

export function compareLabelOf(value: string | null | undefined): string {
  if (!value) return '未记录'
  return COMPARE_LABELS[value] ?? value
}

/** 时间戳（ISO 字符串）→ 本地时区可读时间。 */
export function formatDateTime(value?: string | null): string {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知'
  return date.toLocaleString('zh-CN', { hour12: false })
}

/**
 * DatePicker 的 Date → `YYYY-MM-DD`。
 *
 * 刻意用本地年月日拼接，而不是 `toISOString()`：后者会按时区整体前移一天（东八区必现），
 * 这正是竞品分析历史上出现过「区间第一天被过滤掉」的同一类问题。
 */
export function toDateInputValue(date: Date | undefined): string | null {
  if (!date) return null
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

/* ---------- 卖家精灵公开数据维度 ---------- */

/**
 * 可勾选的公开数据维度。
 *
 * 每个维度都直接对应卖家精灵的 MCP 调用（**按请求次数计费**），因此这里必须把
 * "要花多少次调用"写在界面上 —— 用户有权在点「开始分析」之前知道成本。
 */
export const PUBLIC_DIMENSION_OPTIONS = [
  {
    value: 'public',
    label: '商品公开数据',
    hint: '价格、评分、评分数、BSR、卖家数、上架时间 + 月销量趋势对比',
  },
  {
    value: 'traffic',
    label: '流量与关键词',
    hint: '自然 vs 广告流量结构、TOP 流量词（搜索量/购买率/建议竞价/排名）',
  },
  {
    value: 'reviews',
    label: '评论痛点',
    hint: '竞品 1-2 星差评取样 + 高频问题词（找对方软肋）',
  },
] as const

/** 每个 ASIN 的调用次数（与服务端 `DIMENSION_CALLS_PER_ASIN` 保持一致）。 */
const DIMENSION_CALLS_PER_ASIN: Record<string, number> = {
  public: 2,
  traffic: 1,
  reviews: 1,
}

/**
 * 预估本次分析会消耗多少次卖家精灵调用。
 *
 * 只是**预估**：真实消耗以服务端返回的 `publicData.calls` 为准（命中缓存的 ASIN 不消耗额度）。
 */
export function estimatePublicCalls(dimensions: string[], asinCount: number): number {
  const count = Math.max(1, asinCount)
  return dimensions.reduce(
    (sum, dimension) => sum + (DIMENSION_CALLS_PER_ASIN[dimension] ?? 0) * count,
    0
  )
}

/* ---------- ASIN 输入 ---------- */

/** 从输入框文本里粗略数出 ASIN 个数（只用于预估调用次数，真实校验在服务端）。 */
export function countAsins(raw: string): number {
  const matches = String(raw ?? '').match(/\b[A-Z0-9]{10}\b/gi)
  return matches ? new Set(matches.map((item) => item.toUpperCase())).size : 0
}

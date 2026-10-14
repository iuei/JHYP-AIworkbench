/**
 * 卖家精灵公开数据的**零依赖**配置层：维度定义、参数校验、额度预估。
 *
 * 归属：这是**竞品分析**与**市场调研**（产品开发模块）共用的能力层，
 * 因此文件名不带 `competitor` 前缀 —— 它描述的是数据来源（卖家精灵），不是某个页面的私有实现。
 *
 * 为什么单独一层：`competitor-analysis.mjs` 需要**同步**用到维度白名单与预估（在 `parseCompetitorInput` 里校验），
 * 而采集层（`sellersprite-public.mjs`）会连带拉进 `ai-agent/mcp.mjs` → `ai-agent/data-queries.mjs` 这条重链。
 * 把那条边静态挂在 `competitor-analysis.mjs` 上，会让**所有**导入它的模块（例如 ASIN 清单的
 * `watchlist-table.mjs`）都被拉进 AI 助手的模块图 —— 实测这会与 `data-queries.mjs` 里
 * `MAX_TABLE_ROWS` 的初始化顺序打架，表现为 `Cannot access 'MAX_TABLE_ROWS' before initialization`。
 *
 * 因此：**本文件不许 import 任何模块**（连 `./db.mjs` 都不行），
 * 采集/展现层（`sellersprite-public.mjs` / `sellersprite-blocks.mjs`）由调用方按需动态导入。
 */

/* ---------- 竞品分析：ASIN 级维度 ---------- */

export const PUBLIC_DIMENSIONS = ['public', 'traffic', 'reviews']

export const DIMENSION_LABELS = {
  public: '商品公开数据（价格/评分/BSR/月销量趋势）',
  traffic: '流量与关键词（自然 vs 广告、TOP 流量词）',
  reviews: '评论痛点（差评高频词）',
}

/** 默认只拉核心维度：多维度一次分析要十几次调用，默认全开会把月额度几次吃完。 */
export const DEFAULT_DIMENSIONS = ['public']

/** 每个 ASIN 的调用次数（前端用来预估消耗）。 */
export const DIMENSION_CALLS_PER_ASIN = { public: 2, traffic: 1, reviews: 1 }

/* ---------- 市场调研：类目级（与 ASIN 无关） ---------- */

/**
 * 市场调研**不以 ASIN 为输入**：它回答的是"这个类目值不值得进"。
 * 固定三次调用：类目搜索 1 次 + 市场规模与价格带 2 次。
 * 这正是它必须与竞品分析分页的原因 —— 分析对象、输入、时机都不同（见 `docs/modules/产品开发.md`）。
 */
export const MARKET_CALLS = 2
export const CATEGORY_SEARCH_CALLS = 1

/** 单次调研最多返回多少个候选类目（类目搜索是分页的，页面只需前几个让用户选）。 */
export const CATEGORY_SEARCH_SIZE = 10

/* ---------- 公共参数 ---------- */

export const DEFAULT_TTL_HOURS = 24
export const MIN_TTL_HOURS = 1
export const MAX_TTL_HOURS = 168

/** 销量趋势取最近 N 个月入图。 */
export const TREND_MONTHS = 12

export class SellerspriteConfigError extends Error {}

/** 兼容旧名：竞品分析侧此前用的是 `CompetitorPublicError`。 */
export const CompetitorPublicError = SellerspriteConfigError

export function parseDimensions(raw) {
  if (raw === undefined || raw === null) return [...DEFAULT_DIMENSIONS]
  if (!Array.isArray(raw)) {
    throw new SellerspriteConfigError('dimensions 必须是数组。')
  }
  const list = [...new Set(raw.map((item) => String(item).trim()).filter(Boolean))]
  for (const item of list) {
    if (!PUBLIC_DIMENSIONS.includes(item)) {
      throw new SellerspriteConfigError(
        `不支持的数据维度：${item}（可选：${PUBLIC_DIMENSIONS.join(' / ')}）。类目市场结构请到「产品开发 → 市场调研」查看。`
      )
    }
  }
  return list
}

export function parseTtlHours(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_TTL_HOURS
  const value = Number(raw)
  if (!Number.isFinite(value) || value < MIN_TTL_HOURS || value > MAX_TTL_HOURS) {
    throw new SellerspriteConfigError(
      `缓存有效期必须是 ${MIN_TTL_HOURS}-${MAX_TTL_HOURS} 小时之间的数字。`
    )
  }
  return Math.round(value)
}

/** 预估竞品分析会消耗多少次卖家精灵调用（界面在勾选时展示，避免稀里糊涂把额度用完）。 */
export function estimateCalls(dimensions, asinCount) {
  const count = Math.max(1, Number(asinCount) || 1)
  return dimensions.reduce(
    (sum, dimension) => sum + (DIMENSION_CALLS_PER_ASIN[dimension] ?? 0) * count,
    0
  )
}

/** 预估一次市场调研的调用次数（类目搜索 1 次 + 市场规模与价格带 2 次）。 */
export function estimateMarketCalls({ withSearch = false } = {}) {
  return MARKET_CALLS + (withSearch ? CATEGORY_SEARCH_CALLS : 0)
}

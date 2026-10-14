/**
 * 竞品分析：对一组 ASIN 做真实广告与销售表现的横向对比，并给出确定性结论。
 *
 * 设计约束（为什么这样写）：
 * 1. 数字全部来自 SQL 与 `analytics.mjs` 的确定性计算 —— 复用 AI 助手
 *    `query_amazon_performance` 工具的同一条载荷链路（`amazonPerformancePayload`），
 *    不再返回与输入无关的固定结论。历史实现无论输入什么都返回同一组
 *    「portable blender / 电池续航不足」之类的写死文案，属于用假数据掩盖未实现功能。
 * 2. **自家数据只支持 ASIN 维度**：现有四个数据集（广告日报、业务报告、库存快照、产品主数据）里
 *    没有品牌、店铺、关键词、评论与图片字段。
 *    **2026-09-16 起**：竞品的这些维度改由**卖家精灵 MCP 公开数据**提供（见 `sellersprite-public.mjs`），
 *    因此页面能真正对比竞品了 —— 但两套数据口径不同，展示与结论**必须分开标注**，禁止混算。
 * 3. **对比必须同站点同区间**：不同窗口或不同站点的数字放在一起比是错的，因此站点与
 *    区间由服务端统一裁决（用户可显式指定，未指定时按本品数据自动推导），
 *    所有 ASIN 都按同一组参数取数。
 * 4. **本地报表口径的「竞品」**：广告日报与业务报告只包含本公司导入的报表，
 *    第三方竞品 ASIN 若不在这两份报表里就没有任何数据 —— 这条限制仍然成立，
 *    页面上的 `comparison.note` 继续如实说明；公开数据是**另一块**补充，不是替代。
 * 5. 结论（findings）由服务端规则算出（预警线、环比恶化、驱动分解、库存阈值、组内排名、
 *    以及公开数据的价格/评分/评论量/趋势/市场结构），模型不参与 ——
 *    每条都带可复算的数字证据，避免编造。
 */
import { query } from './db.mjs'
import {
  amazonPerformancePayload,
  buildChartBlock,
  buildTableBlock,
  buildSkuChannelMap,
  queryInventoryAll,
  queryLatestSalesDate,
  queryProductMaster,
  queryRecentOrders,
  querySalesForVelocity,
} from './ai-agent/data-queries.mjs'
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_VELOCITY_WINDOW_DAYS,
  INVENTORY_THRESHOLDS,
  analyzeInventoryHealth,
  computeSalesVelocity,
  computeSalesVelocityFromSales,
  mergeVelocitySources,
  resolveVelocityWindow,
  round,
} from './ai-agent/analytics.mjs'
import {
  DIMENSION_LABELS,
  estimateCalls,
  parseDimensions,
  parseTtlHours,
} from './sellersprite-config.mjs'
import { buildFix } from './finding-fixes.mjs'
import { collectFindingKeys, summarizeOpenFindings } from './finding-dispositions.mjs'

/**
 * 采集与展现层**按需动态导入**（见 `analyzeCompetitor` 内）。
 *
 * 它们会连带拉进 `ai-agent/mcp.mjs` 与 `ai-agent/data-queries.mjs`；把这条边静态挂在本文件上，
 * 会让所有导入 `competitor-analysis.mjs` 的模块（例如 ASIN 清单的 `watchlist-table.mjs`）
 * 都被拉进 AI 助手的模块图，实测会与 `data-queries.mjs` 里 `MAX_TABLE_ROWS` 的初始化顺序打架
 * （`Cannot access 'MAX_TABLE_ROWS' before initialization`）。
 * 竞品分析不需要在导入期就具备这些能力，按需加载同时也让服务启动更快。
 */

/** 输入不合法（返回 400 而不是 500）。 */
export class CompetitorInputError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CompetitorInputError'
  }
}

/**
 * 支持的输入维度。
 * 品牌名 / 店铺链接当前没有对应数据源（需要 Amazon 品牌分析或 SP-API），不在此列。
 */
export const SUPPORTED_INPUT_TYPES = ['ASIN']

/** 默认统计窗口：以数据最新日期为终点向前取的天数。 */
export const DEFAULT_WINDOW_DAYS = 30

/**
 * 页面提供的窗口预设（也允许自定义区间）。
 *
 * ⚠️ 这是前端 `src/features/competitor-analysis/format.ts` 的 `WINDOW_OPTIONS` 的**同一份口径**：
 * 增删预设必须两边同时改，否则会出现"页面能选、服务端 400 拒绝"。
 * 2026-09-16 新增 `180`（半年）与 `365`（一年）。
 */
export const WINDOW_PRESETS = [7, 30, 90, 180, 365]

export const MIN_WINDOW_DAYS = 7
/**
 * 统计窗口上限。
 *
 * 2026-09-16 由 180 放宽到 365：页面新增「一年」预设（用户口径「统计区间的日期增加可选项
 * 一年和半年」），而 365 天本来就在自定义区间上限 `MAX_RANGE_DAYS`（366 天）之内 ——
 * 预设天数不该比自定义区间允许的范围更小。
 */
export const MAX_WINDOW_DAYS = 365

/** 自定义区间的最大跨度，避免一次拉出几年数据把页面和库都拖垮。 */
export const MAX_RANGE_DAYS = 366

/** 一次最多对比的 ASIN 数（第一个为「本品」）。 */
export const MAX_ASIN_COUNT = 5

/** 对比基线：环比上一等长区间 / 同比去年同期 / 不做对比。 */
export const COMPARE_OPTIONS = ['previous_period', 'last_year', 'none']

const COMPARE_LABELS = {
  previous_period: '环比（上一等长区间）',
  last_year: '同比（去年同期）',
  none: null,
}

const ASIN_LENGTH = 10
const ASIN_TOKEN_SPLIT = /[\s,，、;；|]+/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MARKETPLACE_PATTERN = /^[A-Z]{2}$/

/** 结论严重度权重：用于排序与「本次分析最高严重度」。 */
export const FINDING_WEIGHTS = { high: 3, medium: 2, low: 1, info: 0 }

/* ---------- 输入解析 ---------- */

/**
 * 从单个 token 识别 ASIN。
 *
 * 支持两种写法：直接输入的 10 位 ASIN，以及粘贴的亚马逊商品链接（`/dp/`、`/d/`、`/gp/product/`）。
 * 不做「任意 10 位字母数字片段」的模糊提取 —— 那会把链接里的无关片段当成 ASIN，
 * 反而制造出更难排查的错数据。
 */
export function extractAsin(raw) {
  const text = String(raw ?? '')
    .trim()
    .toUpperCase()
  if (!text) return null

  const fromUrl = text.match(/\/(?:DP|D|GP\/PRODUCT)\/([A-Z0-9]{10})/)
  if (fromUrl) return fromUrl[1]

  return new RegExp(`^[A-Z0-9]{${ASIN_LENGTH}}$`).test(text) ? text : null
}

/**
 * 解析 ASIN 列表：支持逗号、顿号、分号、竖线与换行分隔，可混入商品链接。
 * 去重且保序（第一个视为本品），无法识别的片段原样收集用于错误提示，
 * 重复出现的 ASIN 收集在 `duplicates`（ASIN 清单用它提示"你粘贴里有重复"，
 * 竞品分析不关心这个字段，因此新增它是向后兼容的）。
 */
export function parseAsinList(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { asins: [], invalid: [], duplicates: [] }

  const asins = []
  const invalid = []
  const duplicates = []
  for (const token of text.split(ASIN_TOKEN_SPLIT).filter(Boolean)) {
    const asin = extractAsin(token)
    if (!asin) {
      invalid.push(token)
      continue
    }
    if (asins.includes(asin)) {
      if (!duplicates.includes(asin)) duplicates.push(asin)
      continue
    }
    asins.push(asin)
  }
  return { asins, invalid, duplicates }
}

/** 校验 `YYYY-MM-DD`；空值返回 null，格式或日期非法抛 `CompetitorInputError`。 */
export function normalizeDateInput(value, field) {
  const text = String(value ?? '').trim()
  if (!text) return null
  if (!DATE_PATTERN.test(text)) throw new CompetitorInputError(`${field}需为 YYYY-MM-DD 格式。`)
  const parsed = new Date(`${text}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new CompetitorInputError(`${field}不是有效日期。`)
  }
  return text
}

/** 校验并归一化请求体，不合法时抛 `CompetitorInputError`。 */
export function parseCompetitorInput(body) {
  const inputType = String(body?.inputType ?? '')
    .trim()
    .toUpperCase()
  // 兼容两种写法：`inputValue` 字符串（页面用法）与 `asins` 数组（接口调用更直观）
  const rawValue = Array.isArray(body?.asins) ? body.asins.join(',') : body?.inputValue
  const inputValue = String(rawValue ?? '').trim()

  if (!inputType) throw new CompetitorInputError('请选择分析维度。')
  if (!SUPPORTED_INPUT_TYPES.includes(inputType)) {
    throw new CompetitorInputError(
      `当前数据源只支持按 ASIN 分析，「${inputType}」维度需要接入 Amazon 品牌分析或 SP-API，尚未接入。`
    )
  }
  if (!inputValue) throw new CompetitorInputError('请输入要分析的 ASIN。')
  // competitor_analyses.input_value 是 VARCHAR(200)：先校验长度，避免数据库报 22001 变成 500。
  if (inputValue.length > 200) throw new CompetitorInputError('输入内容过长（最多 200 个字符）。')

  const { asins, invalid } = parseAsinList(inputValue)
  if (invalid.length > 0) {
    throw new CompetitorInputError(
      `没有识别出有效的 ASIN：${invalid.slice(0, 3).join('、')}。请输入 10 位 ASIN（例如 B0XXXXXXXX），或粘贴亚马逊商品链接；多个 ASIN 用逗号或换行分隔。`
    )
  }
  if (asins.length === 0) {
    throw new CompetitorInputError(
      '没有识别出有效的 ASIN。请输入 10 位 ASIN（例如 B0XXXXXXXX），或粘贴亚马逊商品链接。'
    )
  }
  if (asins.length > MAX_ASIN_COUNT) {
    throw new CompetitorInputError(`一次最多对比 ${MAX_ASIN_COUNT} 个 ASIN（当前 ${asins.length} 个）。`)
  }

  const marketplaceText = String(body?.marketplace ?? '')
    .trim()
    .toUpperCase()
  if (marketplaceText && !MARKETPLACE_PATTERN.test(marketplaceText)) {
    throw new CompetitorInputError('站点需为两位站点代码（例如 US、UK、DE、JP）。')
  }

  const compareWith = String(body?.compareWith ?? 'previous_period').trim() || 'previous_period'
  if (!COMPARE_OPTIONS.includes(compareWith)) {
    throw new CompetitorInputError(`对比基线只支持 ${COMPARE_OPTIONS.join(' / ')}。`)
  }

  const startDate = normalizeDateInput(body?.startDate, '开始日期')
  const endDate = normalizeDateInput(body?.endDate, '结束日期')
  if ((startDate && !endDate) || (!startDate && endDate)) {
    throw new CompetitorInputError('自定义区间需要同时提供开始日期与结束日期。')
  }

  const hasWindowInput = body?.windowDays !== undefined && body?.windowDays !== null && body?.windowDays !== ''
  let windowDays = null
  if (hasWindowInput) {
    const parsedWindow = Number(body.windowDays)
    if (!Number.isInteger(parsedWindow) || parsedWindow < MIN_WINDOW_DAYS || parsedWindow > MAX_WINDOW_DAYS) {
      throw new CompetitorInputError(`统计天数需为 ${MIN_WINDOW_DAYS}–${MAX_WINDOW_DAYS} 之间的整数。`)
    }
    windowDays = parsedWindow
  }
  if (windowDays !== null && startDate) {
    throw new CompetitorInputError('自定义区间与统计天数不能同时使用，请二选一。')
  }

  if (startDate && endDate) {
    const span = diffDays(startDate, endDate) + 1
    if (span <= 0) throw new CompetitorInputError('结束日期不能早于开始日期。')
    if (span > MAX_RANGE_DAYS) {
      throw new CompetitorInputError(`自定义区间最长 ${MAX_RANGE_DAYS} 天（当前 ${span} 天）。`)
    }
  }

  // 公开数据维度（卖家精灵 MCP）：按需勾选，不勾就不消耗额度。
  // 默认只开 `public`（价格/评分/BSR/月销量趋势）—— 它是"竞品分析"能真正对比竞品的前提。
  // 这里把维度校验的错误统一成 `CompetitorInputError`，路由的 400 映射不必认识第二个错误类。
  let dimensions
  let publicTtlHours
  try {
    dimensions = parseDimensions(body?.dimensions)
    publicTtlHours = parseTtlHours(body?.publicTtlHours)
  } catch (error) {
    throw new CompetitorInputError(error instanceof Error ? error.message : '公开数据维度参数无效。')
  }
  const refreshPublic = body?.refreshPublic === true

  return {
    inputType: 'ASIN',
    asins,
    primaryAsin: asins[0],
    competitorAsins: asins.slice(1),
    // 入库用：归一化后的 ASIN 列表
    inputValue: asins.join(','),
    marketplace: marketplaceText || null,
    compareWith,
    windowDays,
    startDate,
    endDate,
    dimensions,
    publicTtlHours,
    refreshPublic,
  }
}

/** 纯 UTC 日期位移，避免本地时区把日期推来推去。 */
export function shiftDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return isoDate
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** 两个日期之间的天数差（end - start）。 */
export function diffDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  return Math.round((end - start) / 86400000)
}

/* ---------- 目标（站点 + 区间）解析 ---------- */

const AVAILABILITY_SQL = `
  SELECT marketplace, MAX(stat_date)::text AS latest
    FROM (
      SELECT marketplace, stat_date FROM amazon_ads_daily WHERE asin = $1
      UNION ALL
      SELECT marketplace, stat_date FROM amazon_sales_daily WHERE asin = $1
    ) AS t
   GROUP BY marketplace
   ORDER BY latest DESC, marketplace ASC`

/**
 * 某个 ASIN 在各个站点上的数据可用性（最新日期）。
 *
 * 日期刻意用 `::text` 取回：pg 会把 DATE 列转成本地时区午夜的 Date 对象，
 * 再经 `toISOString()` 会整体前移一天（东八区必现）。这里直接要字符串，绕开该链路。
 */
export async function queryAsinAvailability(asin) {
  const { rows } = await query(AVAILABILITY_SQL, [asin])
  const marketplaces = rows.map((row) => ({ marketplace: row.marketplace, latest: row.latest }))
  return {
    asin,
    marketplaces,
    hasData: marketplaces.length > 0,
    latest: marketplaces[0]?.latest ?? null,
    defaultMarketplace: marketplaces[0]?.marketplace ?? null,
  }
}

/**
 * 统一裁决本次分析的站点与统计区间。
 *
 * 规则（为什么要这样）：
 * - 站点与区间必须**所有 ASIN 共用**，否则对比无意义；
 * - 用户显式指定则优先；
 * - 未指定时按「本品（第一个 ASIN）有数据的站点与最新日期」推导，本品无数据时退到同组中
 *   第一个有数据的 ASIN，最后才退到「US + 最近 N 天」，由载荷层给出「请先导入报表」的提示。
 */
export async function resolveAnalysisTarget({ asins, marketplace, windowDays, startDate, endDate }) {
  const availability = []
  for (const asin of asins) {
    availability.push(await queryAsinAvailability(asin))
  }

  const primary = availability[0]
  const firstWithData = availability.find((item) => item.hasData) ?? null
  const autoMarketplace = primary.defaultMarketplace ?? firstWithData?.defaultMarketplace ?? null
  const chosenMarketplace = marketplace ?? autoMarketplace ?? 'US'
  const marketplaceSource = marketplace ? 'request' : autoMarketplace ? 'auto' : 'fallback'

  const latestForMarketplace =
    primary.marketplaces.find((item) => item.marketplace === chosenMarketplace)?.latest ??
    firstWithData?.marketplaces.find((item) => item.marketplace === chosenMarketplace)?.latest ??
    null

  const explicitRange = Boolean(startDate && endDate)
  const days = explicitRange ? null : windowDays ?? DEFAULT_WINDOW_DAYS
  const resolvedEnd = explicitRange
    ? endDate
    : latestForMarketplace ?? new Date().toISOString().slice(0, 10)
  const resolvedStart = explicitRange ? startDate : shiftDays(resolvedEnd, -(days - 1))

  return {
    marketplace: chosenMarketplace,
    marketplaceSource,
    startDate: resolvedStart,
    endDate: resolvedEnd,
    // 自定义区间时给出实际天数，页面展示用
    windowDays: explicitRange ? diffDays(resolvedStart, resolvedEnd) + 1 : days,
    customRange: explicitRange,
    hasData: availability.some((item) => item.hasData),
    availability,
  }
}

/* ---------- 单 ASIN 指标行与组内对比 ---------- */

/** 把一次工具载荷压成一行对比指标（无数据时全为 null，而不是 0）。 */
export function asinMetricRow({ asin, role, payload }) {
  const base = {
    asin,
    role,
    roleLabel: role === 'subject' ? '本品' : '竞品',
    hasData: false,
    emptyReason: null,
    // 指标列固定为 null：表格列结构在所有 ASIN 间保持一致，也避免把「没有数据」渲染成 0
    impressions: null,
    clicks: null,
    spend: null,
    sales: null,
    orders: null,
    acos: null,
    ctr: null,
    cvr: null,
    cpc: null,
    units: null,
  }
  if (!payload || payload.empty) {
    return { ...base, emptyReason: payload?.summary ?? '没有数据' }
  }
  const current = payload.analysis?.current ?? {}
  return {
    ...base,
    hasData: true,
    impressions: current.impressions ?? null,
    clicks: current.clicks ?? null,
    spend: current.spend ?? null,
    sales: current.sales ?? null,
    orders: current.orders ?? null,
    acos: current.acos ?? null,
    ctr: current.ctr ?? null,
    cvr: current.cvr ?? null,
    cpc: current.cpc ?? null,
    units: current.units ?? null,
  }
}

const COMPARISON_COLUMNS = [
  { key: 'asin', label: 'ASIN' },
  { key: 'roleLabel', label: '角色' },
  { key: 'spend', label: '广告花费', align: 'right' },
  { key: 'sales', label: '广告销售额', align: 'right' },
  { key: 'acos', label: 'ACoS(%)', align: 'right' },
  { key: 'clicks', label: '点击', align: 'right' },
  { key: 'cvr', label: '转化率(%)', align: 'right' },
  { key: 'cpc', label: 'CPC', align: 'right' },
  { key: 'orders', label: '广告订单', align: 'right' },
  { key: 'units', label: '销量', align: 'right' },
]

/** 组内对比口径：竞品均值、本品排名（ACoS 越低越好、转化率越高越好）。 */
export function summarizeComparison(rows) {
  const list = Array.isArray(rows) ? rows : []
  const subject = list.find((row) => row.role === 'subject') ?? list[0] ?? null
  const competitors = list.filter((row) => row.role !== 'subject')
  const withData = list.filter((row) => row.hasData)
  const competitorsWithData = competitors.filter((row) => row.hasData)

  const average = (items, key) => {
    const values = items.map((item) => item[key]).filter((value) => typeof value === 'number' && !Number.isNaN(value))
    if (values.length === 0) return null
    return round(values.reduce((total, value) => total + value, 0) / values.length, 2)
  }

  const rankOf = (key, { ascending }) => {
    const ranked = withData
      .filter((row) => typeof row[key] === 'number')
      .sort((a, b) => (ascending ? a[key] - b[key] : b[key] - a[key]))
    const index = ranked.findIndex((row) => row.asin === subject?.asin)
    return {
      rank: index >= 0 ? index + 1 : null,
      total: ranked.length,
      best: ranked[0] ? { asin: ranked[0].asin, value: ranked[0][key] } : null,
    }
  }

  return {
    enabled: list.length > 1,
    subject,
    competitors,
    comparedCount: withData.length,
    missingCount: list.length - withData.length,
    competitorAverages: {
      spend: average(competitorsWithData, 'spend'),
      sales: average(competitorsWithData, 'sales'),
      acos: average(competitorsWithData, 'acos'),
      cvr: average(competitorsWithData, 'cvr'),
      cpc: average(competitorsWithData, 'cpc'),
    },
    acosRank: rankOf('acos', { ascending: true }),
    cvrRank: rankOf('cvr', { ascending: false }),
  }
}

/** 对比表 + 花费/销售额柱状图 + ACoS 柱状图（单 ASIN 时不生成）。 */
export function buildComparisonBlocks(rows, summary) {
  if (!summary?.enabled) return []
  const missing = rows.filter((row) => !row.hasData).map((row) => row.asin)
  return [
    buildTableBlock({
      title: 'ASIN 横向对比',
      dataset: 'amazon_ads_daily',
      columns: COMPARISON_COLUMNS,
      rows,
      note: [
        '同一站点、同一统计区间下的横向对比；「本品」为输入的第一个 ASIN。',
        missing.length > 0
          ? `${missing.join('、')} 在该区间内没有记录（可能没有投放/销售，或未导入对应报表），不计入均值与排名。`
          : null,
      ]
        .filter(Boolean)
        .join(' '),
    }),
    buildChartBlock({
      title: '广告花费与广告销售额对比',
      chartType: 'bar',
      xKey: 'asin',
      series: [
        { key: 'spend', label: '广告花费', kind: 'bar' },
        { key: 'sales', label: '广告销售额', kind: 'bar' },
      ],
      data: rows.filter((row) => row.hasData),
      note: '缺数据的 ASIN 不进入图表，避免把「没有数据」画成 0。',
    }),
    buildChartBlock({
      title: 'ACoS 与转化率对比',
      chartType: 'bar',
      xKey: 'asin',
      series: [
        { key: 'acos', label: 'ACoS(%)', kind: 'bar' },
        { key: 'cvr', label: '转化率(%)', kind: 'bar' },
      ],
      data: rows.filter((row) => row.hasData),
      note: 'ACoS 越低越好、转化率越高越好；两者量纲不同，仅用于横向高低对比。',
    }),
  ]
}

/* ---------- 按日对比（本品 vs 竞品） ---------- */

/**
 * AI 助手载荷里「按日明细」表的列键（与服务端 `buildDailyDetailBlock` 的输出逐项对应）。
 * 用它做**结构化识别**，不用标题文案 —— 标题改字就会让识别静默失效。
 */
const DAILY_DETAIL_KEYS = [
  'date',
  'impressions',
  'clicks',
  'spend',
  'orders',
  'sales',
  'acos',
  'units',
]

function isDailyDetailBlock(block) {
  if (block?.kind !== 'table') return false
  const keys = Array.isArray(block.columns)
    ? block.columns.map((column) => column.key)
    : []
  return (
    keys.length === DAILY_DETAIL_KEYS.length &&
    keys.every((key, index) => key === DAILY_DETAIL_KEYS[index])
  )
}

/**
 * 按日对比里展示哪些指标（顺序即列顺序）。
 * 只取对比时有意义的量：曝光/点击是上游，花费/销售额/订单是规模，ACoS 是效率，销量看动销。
 */
const DAILY_METRICS = [
  { key: 'spend', label: '花费' },
  { key: 'sales', label: '销售额' },
  { key: 'acos', label: 'ACoS(%)' },
  { key: 'orders', label: '订单' },
  { key: 'impressions', label: '曝光' },
  { key: 'clicks', label: '点击' },
  { key: 'units', label: '销量' },
]

/** 某个 ASIN 载荷里的按日行（没有该块时返回空数组）。 */
function dailyRowsOf(payload) {
  const block = (payload?.blocks ?? []).find(isDailyDetailBlock)
  return Array.isArray(block?.rows) ? block.rows : []
}

/**
 * 「按日对比」：**一行一天，每个 ASIN 一组指标**，本品与竞品逐日并排。
 *
 * 用户口径（2026-09-16）：「数据明细内的本品竞品的数据对比…按日明细对比起来不方便，
 * 我需要一一对应本品跟竞品」。原来的「按日明细」只有本品（它是 AI 助手对**单个** ASIN 的载荷产物），
 * 想看"同一天竞品花了多少"就得回到「ASIN 横向对比」去对总量，逐日是断的。
 *
 * 数据来源是**已有的载荷**：`analyzeCompetitor` 本来就为每个 ASIN 各调了一次
 * `amazonPerformancePayload`（竞品的按日数据一直在内存里，只是没被用上），因此这个块**零额外查询**。
 *
 * 日期取各 ASIN 的**并集**并排序：不同 ASIN 的报表覆盖区间可能不同，
 * 少了某个 ASIN 的那天显示「—」，不折算成 0（与全模块同一口径）。
 */
export function buildDailyComparisonBlock({ payloads = [], asins = [] } = {}) {
  const series = asins
    .map((asin, index) => ({ asin, rows: dailyRowsOf(payloads[index]) }))
    .filter((item) => item.rows.length > 0)
  if (series.length === 0) return null

  const dates = [
    ...new Set(series.flatMap((item) => item.rows.map((row) => row.date))),
  ]
    .filter(Boolean)
    .sort()
  if (dates.length === 0) return null

  const byDate = series.map(
    (item) => new Map(item.rows.map((row) => [row.date, row]))
  )

  const rows = dates.map((date) => {
    const line = { date }
    series.forEach((item, position) => {
      const source = byDate[position].get(date) ?? null
      for (const metric of DAILY_METRICS) {
        line[`${item.asin}__${metric.key}`] = source
          ? (source[metric.key] ?? null)
          : null
      }
    })
    return line
  })

  /*
   * **两行表头**：第一行是归属分组（`本品（B0SAMPLE01） | 竞品1（B0B3JGBH5）`），
   * 第二行才是各组的字段名（花费 / 销售额 / ACoS / 订单 / 曝光 / 点击 / 销量）。
   *
   * 用户口径（2026-09-16）：「这样不够明显 应该这样：表头 本品 竞品，然后再是本品字段和竞品字段」——
   * 上一版把归属塞进每一列的标签里（`花费 本品` / `花费 竞品1`…），同一组字段的归属被重复 7 遍，
   * 扫一眼看不出"哪几列属于谁"。分组表头把归属提到一整行上，一组字段只写一次。
   *
   * 列仍是**按 ASIN 成组**（本品 7 列 → 竞品 7 列），与第一行的分组一一对应。
   * 角色序号按用户输入顺序，中间某个竞品没有数据也不会错位（`roleOf` 用的是原始 `asins` 的下标）。
   */
  const roleOf = (asin) => {
    const position = asins.indexOf(asin)
    return position <= 0 ? '本品' : `竞品${position}`
  }
  /**
   * 每组的底色档位（1~5，对应主题的 `--chart-1..5`）：整组列铺同一层淡色底，
   * 让"哪几列属于本品、哪几列属于竞品"扫一眼就分得开（用户口径：颜色淡一点、能看出来就行）。
   * 超过 5 组时循环取色 —— 竞品上限是 4 个，正常到不了。
   */
  const toneOf = (position) => (position % 5) + 1

  return buildTableBlock({
    title: '按日对比（本品 vs 竞品）',
    dataset: 'amazon_ads_daily',
    columns: [
      { key: 'date', label: '日期' },
      ...series.flatMap((item, position) =>
        DAILY_METRICS.map((metric) => ({
          key: `${item.asin}__${metric.key}`,
          // 归属已由分组表头表达，这里只写字段名（组内重复是正常的，靠 key 区分）
          label: metric.label,
          align: 'right',
          tone: toneOf(position),
        }))
      ),
    ],
    // 分组表头：只描述除首列（日期）以外的列，span 之和 = 列数 - 1
    groups: series.map((item, position) => ({
      label: `${roleOf(item.asin)}（${item.asin}）`,
      span: DAILY_METRICS.length,
      tone: toneOf(position),
    })),
    rows,
    // 显式给总行数：默认 `MAX_TABLE_ROWS = 30` 会截断长区间（90 天），
    // 不显式传的话界面会把"共 90 天"说成"共 30 天"。
    totalRows: rows.length,
    note: [
      '同一站点、同一区间下按天的对比：每列归属见第一行表头（本品 / 竞品N）。',
      '不在自家报表里的 ASIN 当天显示「—」，不代表数值为 0（第三方竞品通常就没有日粒度数据）。',
    ].join(' '),
  })
}

/**
 * 用「按日对比」替换本品载荷里的「按日明细」（同一份数据不铺两遍，保持原位置）。
 * 没有可对比的数据时保留原块，绝不把已有内容删成空白。
 */
function withDailyComparison(blocks, options) {
  const dailyComparison = buildDailyComparisonBlock(options)
  if (!dailyComparison) return blocks
  const index = blocks.findIndex(isDailyDetailBlock)
  if (index < 0) return [...blocks, dailyComparison]
  return [
    ...blocks.slice(0, index),
    dailyComparison,
    ...blocks.slice(index + 1),
  ]
}

/* ---------- 结论（确定性规则） ---------- */

/**
 * 构造一条结论。
 *
 * `code` 是**稳定的诊断码**（如 `acos_up` / `stockout_risk`），用于把结论映射到结构化处置方案
 * （`finding-fixes.mjs`）—— 按标题文案匹配不可行：标题是动态拼接的（`ACoS 环比上涨 57.05%`）。
 * `extra` 里放这条结论特有的上下文（例如库存结论的 `sku`），它会一并成为处置方案的输入。
 */
function makeFinding(level, title, detail, action = null, evidence = [], code = null, extra = {}) {
  return { level, title, detail, action, evidence, code, ...extra }
}

const ANOMALY_ACTIONS = {
  acos: '建议先拉出该 ASIN 花费最高的投放词与投放位，按「花费降序 + 转化率升序」逐个降竞价或暂停，并核对 Listing 主图、价格与库存状态是否有变动。',
  cvr: '建议排查 Listing 转化要素（主图/价格/评分/库存状态）与该 ASIN 的投放结构，确认是否引入了低转化流量。',
  ctr: '建议检查主图与标题的点击吸引力、投放位与关键词的相关性，低相关词直接否掉。',
}

/**
 * 生成「问题 + 建议动作」清单。
 *
 * 纯函数：只吃服务端已经算好的数字，因此每条结论都能被复算与单测守护。
 * 没有命中任何规则时给出 info 级「未触发预警线」，而不是编一段"整体健康"的评语。
 */
export function buildFindings({
  subject,
  comparisonRows = [],
  comparison = null,
  comparisonLabel = null,
  inventory = null,
  marketplace = 'US',
  thresholds = DEFAULT_THRESHOLDS,
  inventoryThresholds = INVENTORY_THRESHOLDS,
}) {
  const findings = []
  const current = subject && !subject.empty ? subject.analysis?.current ?? null : null

  if (!current) {
    findings.push(
      makeFinding(
        'high',
        '本品在所选站点与区间内没有数据',
        subject?.summary ?? '没有查到本品的广告与销售数据。',
        '请确认 ASIN、站点与统计区间，或先到「数据源与导入」上传对应的 Amazon 广告报表与业务报告。',
        [],
        'no_data'
      )
    )
    return finalizeFindings(findings, { asin: subject?.asin ?? null, marketplace })
  }

  // 1) 预警线（口径与 AI 助手一致：ACoS > 35%、转化率 < 7%、点击率 < 0.25%）
  for (const anomaly of subject.analysis?.anomalies ?? []) {
    findings.push(
      makeFinding(
        anomaly.metric === 'acos' ? 'high' : 'medium',
        `${anomaly.label}${anomaly.direction === 'above' ? '高于' : '低于'}预警线`,
        `${anomaly.label} ${anomaly.value}${anomaly.metric === 'acos' || anomaly.metric === 'cvr' || anomaly.metric === 'ctr' ? '%' : ''}，${
          anomaly.direction === 'above' ? '高于' : '低于'
        }预警线 ${anomaly.threshold}%（站点 ${marketplace}）。`,
        ANOMALY_ACTIONS[anomaly.metric] ?? null,
        [`${anomaly.label} 实测 ${anomaly.value}，阈值 ${anomaly.threshold}`],
        // 每条预警线一个诊断码：处置方案（去哪调、怎么调）在 finding-fixes.mjs 里按码维护
        { acos: 'metric_acos_above', cvr: 'metric_cvr_below', ctr: 'metric_ctr_below' }[
          anomaly.metric
        ] ?? null
      )
    )
  }

  // 2) 对比期恶化（环比/同比）
  const metrics = subject.analysis?.comparison?.metrics ?? {}
  const deltaPctOf = (key) => metrics[key]?.deltaPct ?? null
  const detailOf = (key, label, suffix) => {
    const item = metrics[key]
    if (!item) return `${label}缺少对比期数据。`
    // 上期为 0 时 comparePeriods 给出 deltaPct = null（不做「增长 ∞%」这种误导性结论）
    if (item.deltaPct === null || item.deltaPct === undefined) {
      return `${label}上期为 ${item.previous ?? '无数据'}，无法计算百分比变化。`
    }
    return `${label} ${item.previous} → ${item.current}（${item.deltaPct > 0 ? '+' : ''}${item.deltaPct}%${suffix ?? ''}）。`
  }

  const acosDelta = deltaPctOf('acos')
  if (comparisonLabel && acosDelta !== null && acosDelta > 20) {
    const decomposition = subject.analysis?.decomposition
    const decompositionText =
      decomposition?.ok
        ? `驱动分解（服务端精确计算）：花费效应 ${decomposition.spendEffect} 个百分点、销售额效应 ${decomposition.salesEffect} 个百分点，主因是${decomposition.dominantLabel}。`
        : decomposition?.reason ?? ''
    findings.push(
      makeFinding(
        'medium',
        `ACoS ${comparisonLabel}上涨 ${acosDelta}%`,
        `${detailOf('acos', 'ACoS', '')}${decompositionText}`,
        decomposition?.ok && decomposition.dominantLabel === '花费变化'
          ? '花费是主因：先收紧竞价与预算，把增量花费集中在已验证能出单的词与投放位上。'
          : '销售额端是主因：优先解决转化端问题（Listing、价格、评分、库存状态），不要只靠加预算。',
        [`ACoS ${metrics.acos?.previous} → ${metrics.acos?.current}（${acosDelta}%）`],
        'acos_up'
      )
    )
  }

  const cvrDelta = deltaPctOf('cvr')
  if (comparisonLabel && cvrDelta !== null && cvrDelta < -20) {
    findings.push(
      makeFinding(
        'medium',
        `转化率${comparisonLabel}下滑 ${Math.abs(cvrDelta)}%`,
        detailOf('cvr', '转化率', '%'),
        ANOMALY_ACTIONS.cvr,
        [`转化率 ${metrics.cvr?.previous} → ${metrics.cvr?.current}（${cvrDelta}%）`],
        'cvr_down'
      )
    )
  }

  const spendDelta = deltaPctOf('spend')
  const salesDelta = deltaPctOf('sales')
  if (comparisonLabel && spendDelta !== null && spendDelta > 30 && salesDelta !== null && salesDelta < 0) {
    findings.push(
      makeFinding(
        'high',
        '花费上涨但广告销售额下滑',
        `${detailOf('spend', '广告花费', '')}${detailOf('sales', '广告销售额', '')}`,
        '建议按投放位与关键词拆分花费增量，优先砍掉「增量花费高且零转化」的流量，再评估是否需要重建高转化词的投放结构。',
        [`花费 ${spendDelta}%，广告销售额 ${salesDelta}%`],
        'spend_up_sales_down'
      )
    )
  }

  // 3) 组内横向对比（多 ASIN 时）
  if (comparison?.enabled && comparison.subject?.hasData) {
    const subjectRow = comparison.subject
    const averages = comparison.competitorAverages
    if (averages.acos !== null && subjectRow.acos !== null && subjectRow.acos > averages.acos * 1.2) {
      findings.push(
        makeFinding(
          'medium',
          `ACoS 高于组内竞品均值 ${round(((subjectRow.acos - averages.acos) / averages.acos) * 100, 2)}%`,
          `本品 ACoS ${subjectRow.acos}%，${comparison.competitors.filter((row) => row.hasData).map((row) => row.asin).join('、') || '竞品'} 均值 ${averages.acos}%。`,
          '建议对照组内表现更好的 ASIN，比较投放词结构、出价与 Listing 转化要素的差异，再决定调价还是调结构。',
          [`本品 ${subjectRow.acos}% vs 竞品均值 ${averages.acos}%`],
          'acos_above_group'
        )
      )
    }
    if (averages.cvr !== null && subjectRow.cvr !== null && averages.cvr > 0 && subjectRow.cvr < averages.cvr * 0.8) {
      findings.push(
        makeFinding(
          'medium',
          '转化率低于组内竞品均值',
          `本品转化率 ${subjectRow.cvr}%，竞品均值 ${averages.cvr}%。`,
          '建议优先排查本品的 Listing 转化要素（主图、价格、评分、库存状态），转化率差距通常不是广告出价能解决的。',
          [`本品 ${subjectRow.cvr}% vs 竞品均值 ${averages.cvr}%`],
          'cvr_below_group'
        )
      )
    }
    if (comparison.acosRank?.rank && comparison.acosRank.total > 1 && comparison.acosRank.rank === 1 && averages.acos !== null) {
      findings.push(
        makeFinding(
          'info',
          'ACoS 在组内最低',
          `本品 ACoS ${subjectRow.acos}% 为 ${comparison.acosRank.total} 个 ASIN 中最低，竞品均值 ${averages.acos}%。`,
          '可把本品的投放结构与出价策略作为组内参照，复用到表现较差的 ASIN 上。',
          [],
          'public_lowest_in_group'
        )
      )
    }
  }

  // 4) 库存联动（只针对本品：竞品通常不在本公司产品主数据里）
  if (inventory) {
    if (inventory.mapped === false) {
      findings.push(
        makeFinding(
          'info',
          '没有关联到库存数据',
          inventory.note,
          '如需把库存纳入分析，请在「产品主数据」里登记该 ASIN 对应的 SKU。',
          [],
          'inventory_unmapped'
        )
      )
    } else {
      for (const item of inventory.items ?? []) {
        /* 库存类结论的处置要带 SKU —— `extra` 里的字段会一并成为 `buildFix` 的上下文 */
        const skuContext = { sku: item.sku }
        if (item.risk === 'stockout') {
          findings.push(
            makeFinding(
              'high',
              `SKU ${item.sku} 存在断货风险`,
              `可用 ${item.available}、在途 ${item.inTransit}，日均销量 ${item.dailySales}，可售天数 ${item.daysOfSupply} 天（低于 ${inventoryThresholds.stockoutDays} 天判为断货风险）。`,
              item.suggestedReorder > 0
                ? `建议按 ${item.suggestedReorder} 件（补到 ${inventoryThresholds.targetDays} 天可售）安排补货，并同步确认在途时效。`
                : '建议立即安排补货，并确认在途货物的到仓时间。',
              [`可售天数 ${item.daysOfSupply} 天 < ${inventoryThresholds.stockoutDays} 天`],
              'stockout_risk',
              skuContext
            )
          )
        } else if (item.risk === 'overstock') {
          findings.push(
            makeFinding(
              'low',
              `SKU ${item.sku} 库存积压`,
              `可用 ${item.available}，日均销量 ${item.dailySales}，可售天数 ${item.daysOfSupply} 天（高于 ${inventoryThresholds.overstockDays} 天判为积压）。`,
              '建议控制补货节奏，并评估是否需要放缓广告投入以避免为滞销库存继续买流量。',
              [`可售天数 ${item.daysOfSupply} 天 > ${inventoryThresholds.overstockDays} 天`],
              'overstock',
              skuContext
            )
          )
        } else if (item.risk === 'slow_moving') {
          findings.push(
            makeFinding(
              'low',
              `SKU ${item.sku} 判定为滞销`,
              `统计窗口内销量为 0，但仍有可用库存 ${item.available}。`,
              '建议评估清库动作与广告投入产出，不要继续为无转化流量付费。',
              [],
              'slow_moving',
              skuContext
            )
          )
        } else if (item.risk === 'unknown' || item.risk === 'insufficient_sample') {
          findings.push(
            makeFinding(
              'info',
              `SKU ${item.sku} 无法测算可售天数`,
              item.risk === 'unknown'
                ? '缺少销量样本（产品主数据映射或销售报告未覆盖），无法测算可售天数。'
                : '销量样本不足 7 天，判定积压/滞销不可靠，已标记为样本不足。',
              '请补齐产品主数据映射或导入更完整的销售报告后再评估。',
              [],
              'inventory_unknown',
              skuContext
            )
          )
        }
      }
    }
  }

  if (findings.length === 0) {
    findings.push(
      makeFinding(
        'info',
        '未触发预警线与库存风险',
        `ACoS ${current.acos ?? '无'}%、转化率 ${current.cvr ?? '无'}%、点击率 ${current.ctr ?? '无'}%，均未触及预警线（ACoS>${thresholds.acos.warning}%、转化率<${thresholds.cvr.warning}%、点击率<${thresholds.ctr.warning}%）。`,
        '维持现有投放节奏即可；如需更细的优化方向，可缩小统计区间看单日波动。'
      )
    )
  }

  return finalizeFindings(findings, { asin: subject?.asin ?? null, marketplace })
}

/**
 * 按严重度排序并汇总最高级别。
 *
 * 同时按每条结论的 `code` 补上**结构化处置方案** `fix`（`finding-fixes.mjs`）：
 * 「处理什么 / 系统内去哪 / 系统外怎么做」。在收口处统一补，而不是 33 个生成点各写一遍 ——
 * 处置方案的文案只在一处维护，生成点只需要给一个稳定的诊断码。
 * `context` 提供本次分析的公共上下文（`asin` / `marketplace`），结论自带的字段（如 `sku`）优先。
 */
export function finalizeFindings(findings, context = {}) {
  const list = [...findings].sort(
    (a, b) => (FINDING_WEIGHTS[b.level] ?? 0) - (FINDING_WEIGHTS[a.level] ?? 0)
  )
  const items = list.map((finding) => {
    const withTarget =
      finding.targetAsins || !context.asin
        ? finding
        : { ...finding, targetAsins: [context.asin] }
    return withTarget.code
      ? { ...withTarget, fix: buildFix(withTarget.code, { ...context, ...withTarget }) }
      : withTarget
  })
  const top = items[0] ?? null
  return {
    items,
    level: top?.level ?? 'info',
    count: items.length,
    headline: top ? top.title : '未触发任何规则',
  }
}

/** 一句话结论：给页面顶部与历史列表用。 */
export function buildHeadline({ asin, findings, marketplace, startDate, endDate, windowDays }) {
  const actionable = findings.items.filter((item) => item.level === 'high' || item.level === 'medium')
  const scope = `${asin}（${marketplace} 站，${startDate} ~ ${endDate}，${windowDays} 天）`
  if (actionable.length === 0) {
    return `${scope}未触发预警：${findings.items[0]?.title ?? '无异常'}。`
  }
  return `${scope}命中 ${actionable.length} 项需要处理的问题：${actionable[0]?.title ?? '请查看下方结论'}。`
}

/* ---------- 库存联动（只针对本品） ---------- */

/**
 * 关联本品 ASIN 对应 SKU 的库存与可售天数。
 *
 * 只做本品：竞品 ASIN 通常不在本公司产品主数据里，硬算只会得到"无映射"的噪音。
 * 销量口径与 AI 助手的库存风险分析一致（优先「产品主数据 → 销售报告」，缺失时回退订单快照）。
 */
export async function resolveSubjectInventory({ asin, marketplace }) {
  const [productRows, inventoryRows, orderRows] = await Promise.all([
    queryProductMaster(),
    queryInventoryAll(),
    queryRecentOrders(),
  ])

  const matched = productRows.filter(
    (row) => row.asin === asin && (!marketplace || (row.marketplace ?? 'US') === marketplace)
  )
  if (matched.length === 0) {
    return {
      mapped: false,
      asin,
      marketplace,
      items: [],
      note: `「产品主数据」里没有 ${asin}（${marketplace} 站）的 SKU 映射，无法关联库存与可售天数。`,
    }
  }

  const skus = [...new Set(matched.map((row) => row.sku))]
  const scopedRows = inventoryRows.filter((row) => skus.includes(row.sku))
  if (scopedRows.length === 0) {
    return {
      mapped: true,
      asin,
      marketplace,
      skus,
      items: [],
      note: `已登记 SKU ${skus.join('、')}，但「库存快照」里没有这些 SKU 的记录，无法评估库存风险。`,
    }
  }

  const skuChannels = buildSkuChannelMap(productRows)
  const latestSalesDate = await queryLatestSalesDate()
  let salesVelocity = new Map()
  let velocityWindow = null
  if (latestSalesDate) {
    velocityWindow = resolveVelocityWindow([{ stat_date: latestSalesDate }], DEFAULT_VELOCITY_WINDOW_DAYS)
    const salesRows = await querySalesForVelocity({
      windowStart: velocityWindow?.start ?? null,
      windowEnd: velocityWindow?.end ?? null,
    })
    salesVelocity = computeSalesVelocityFromSales({
      salesRows,
      mapping: skuChannels,
      windowDays: DEFAULT_VELOCITY_WINDOW_DAYS,
    })
  }
  const velocity = mergeVelocitySources({ salesVelocity, orderVelocity: computeSalesVelocity(orderRows) })
  const health = analyzeInventoryHealth({ inventoryRows: scopedRows, velocity })

  return {
    mapped: true,
    asin,
    marketplace,
    skus,
    items: health.items,
    summary: health.summary,
    velocityWindow,
    thresholds: health.thresholds,
    note:
      health.summary.unknownCount > 0 || health.summary.insufficientSampleCount > 0
        ? '部分 SKU 缺少足够的销量样本，可售天数无法测算，已如实标记而不是按 0 处理。'
        : null,
  }
}

/** 库存卡（表格 + 指标卡），无映射时返回空数组。 */
export function buildInventoryBlocks(inventory) {
  if (!inventory || inventory.mapped === false || (inventory.items ?? []).length === 0) return []
  const items = inventory.items
  const thresholds = inventory.thresholds ?? INVENTORY_THRESHOLDS
  const RISK_LABELS = {
    stockout: '断货风险',
    overstock: '积压',
    slow_moving: '滞销',
    insufficient_sample: '样本不足',
    unknown: '缺销量数据',
    healthy: '健康',
  }
  return [
    buildTableBlock({
      title: '关联库存（本品 SKU）',
      dataset: 'inventory_snapshot',
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'available', label: '可用', align: 'right' },
        { key: 'inTransit', label: '在途', align: 'right' },
        { key: 'reserved', label: '占用', align: 'right' },
        { key: 'dailySales', label: '日均销量', align: 'right' },
        { key: 'daysOfSupply', label: '可售天数', align: 'right' },
        { key: 'velocitySource', label: '销量口径' },
        { key: 'risk', label: '判定' },
        { key: 'suggestedReorder', label: '建议补货', align: 'right' },
      ],
      rows: items.map((item) => ({
        sku: item.sku,
        available: item.available,
        inTransit: item.inTransit,
        reserved: item.reserved,
        dailySales: item.dailySales,
        daysOfSupply: item.daysOfSupply,
        velocitySource:
          item.velocitySource === 'sales_report'
            ? '销售报告'
            : item.velocitySource === 'order_snapshot'
              ? '订单快照（样本短）'
              : '无',
        risk: RISK_LABELS[item.risk] ?? item.risk,
        suggestedReorder: item.suggestedReorder,
      })),
      note: `阈值：可售天数 < ${thresholds.stockoutDays} 天判为断货风险，> ${thresholds.overstockDays} 天判为积压；补货目标 ${thresholds.targetDays} 天。${
        inventory.velocityWindow
          ? `销量口径窗口 ${inventory.velocityWindow.start} ~ ${inventory.velocityWindow.end}（${inventory.velocityWindow.days} 天）。`
          : ''
      }`,
    }),
  ]
}

/* ---------- 编排 ---------- */

/**
 * 页面上必须如实说明的口径限制：这两份报表只包含本公司导入的数据，
 * 第三方竞品 ASIN 不在这两份报表里就查不到任何记录。
 */
const COMPARISON_SCOPE_NOTE =
  '对比数据来自本公司导入的报表：不在报表中的第三方竞品 ASIN 不会有任何数据，属于「同口径组内对比」，不代表竞品整体策略。'

/**
 * 执行一次竞品分析。
 *
 * 返回结构沿用工具载荷（blocks / citations / dataFreshness），前端复用 AI 助手的
 * `AnswerBlocks` 渲染，避免同一套数字出现两种展示口径。
 */
/**
 * @param input 页面/接口传来的原始参数（见 `parseCompetitorInput`）。
 * @param options.onProgress 可选的**阶段钩子**（2026-09-17 为任务中心新增）：
 *   分析链路本身不需要它，不传时行为与之前完全一致（现有调用点零改动）。
 *   只上报阶段 **key**（`target` / `report` / `inventory` / `public` / `findings`），
 *   展示文案由调用方决定，避免两处文案各写一份后漂移；
 *   刻意**不上报百分比** —— 耗时取决于卖家精灵的响应速度，编百分比就是假进度。
 *   钩子返回 Promise 时会被 await，任务中心据此在阶段边界做取消判定。
 */
export async function analyzeCompetitor(input, { onProgress } = {}) {
  const parsed = parseCompetitorInput(input)
  const report = async (stage) => {
    if (typeof onProgress === 'function') await onProgress(stage)
  }
  await report({ stage: 'target' })
  // 采集/展现层按需加载（理由见文件头注释：避免把 AI 助手模块图静态拉进本模块）
  const { collectPublicData, pruneExpiredCache } = await import('./sellersprite-public.mjs')
  const {
    buildPublicFindings,
    buildPublicMetricsBlock,
    buildPublicProductBlock,
    buildPublicProductRows,
    buildReviewBlocks,
    buildTrafficBlocks,
    buildTrendChartBlock,
  } = await import('./sellersprite-blocks.mjs')
  // 顺带清掉过期缓存（不 await、失败无副作用）：避免缓存表随分析次数无限增长
  pruneExpiredCache().catch(() => {})
  const target = await resolveAnalysisTarget(parsed)
  const comparisonLabel = COMPARE_LABELS[parsed.compareWith] ?? null

  const buildPayload = (asin, withComparison) =>
    amazonPerformancePayload({
      asin,
      marketplace: target.marketplace,
      startDate: target.startDate,
      endDate: target.endDate,
      compareWith: withComparison ? parsed.compareWith : 'none',
      // 分析结果页需要保留完整按日数据；表格组件再负责可视行数与截断提示。
      detailLimit: null,
    })

  await report({ stage: 'report' })
  const [subjectPayload, ...competitorPayloads] = await Promise.all([
    buildPayload(parsed.primaryAsin, parsed.compareWith !== 'none'),
    ...parsed.competitorAsins.map((asin) => buildPayload(asin, false)),
  ])

  const comparisonRows = [
    asinMetricRow({ asin: parsed.primaryAsin, role: 'subject', payload: subjectPayload }),
    ...parsed.competitorAsins.map((asin, index) =>
      asinMetricRow({ asin, role: 'competitor', payload: competitorPayloads[index] })
    ),
  ]
  const comparison = summarizeComparison(comparisonRows)
  const comparisonBlocks = buildComparisonBlocks(comparisonRows, comparison)

  await report({ stage: 'inventory' })
  const inventory = await resolveSubjectInventory({
    asin: parsed.primaryAsin,
    marketplace: target.marketplace,
  })

  // ── 竞品公开数据（卖家精灵 MCP）：按勾选的维度采集 ──
  // 失败一律降级：任一外部维度出问题，本地报表那部分结论照常给出（见 sellersprite-public.mjs 的 errors）。
  await report({ stage: 'public' })
  const publicData = await collectPublicData({
    asins: parsed.asins,
    primaryAsin: parsed.primaryAsin,
    marketplace: target.marketplace,
    dimensions: parsed.dimensions,
    ttlHours: parsed.publicTtlHours,
    force: parsed.refreshPublic,
  })
  const publicRows = buildPublicProductRows({
    details: publicData.details,
    asins: parsed.asins,
    primaryAsin: parsed.primaryAsin,
  })
  const publicBlocks = [
    buildPublicProductBlock(publicRows),
    buildPublicMetricsBlock(publicRows),
    buildTrendChartBlock({
      trends: publicData.trends,
      asins: parsed.asins,
      primaryAsin: parsed.primaryAsin,
    }),
    ...buildTrafficBlocks(publicData.keywords, parsed.asins, parsed.primaryAsin),
    ...buildReviewBlocks(publicData.reviews, parsed.asins, parsed.primaryAsin),
  ].filter(Boolean)

  await report({ stage: 'findings' })
  const localFindings = buildFindings({
    subject: subjectPayload,
    comparisonRows,
    comparison,
    comparisonLabel,
    inventory,
    marketplace: target.marketplace,
  })
  const publicFindings = buildPublicFindings({
    productRows: publicRows,
    trends: publicData.trends,
    keywords: publicData.keywords,
    reviews: publicData.reviews,
    primaryAsin: parsed.primaryAsin,
    dimensions: parsed.dimensions,
    errors: publicData.meta.errors,
  })
  const findings = mergeFindings(localFindings, publicFindings, {
    // 处置方案里的入口需要"本品"的 ASIN 与站点；关键词（类目名）由前端按快照补
    asin: parsed.asins?.[0] ?? null,
    marketplace: target.marketplace,
  })

  // 本品的块保持原顺序，把横向对比插在「期间汇总」之后（对比是本次分析的主线），
  // 公开数据块追加在末尾 —— 它们来自另一个数据源，用连续一段呈现更不容易被误读成本地数据。
  /*
   * 「按日明细」升级为「按日对比（本品 vs 竞品）」：每个 ASIN 一组指标、逐日并排。
   * 竞品的按日数据来自上面已经取好的 `competitorPayloads`，零额外查询。
   */
  const subjectBlocks = withDailyComparison(subjectPayload.blocks ?? [], {
    payloads: [subjectPayload, ...competitorPayloads],
    asins: parsed.asins,
  })
  const blocks = [...subjectBlocks]
  if (comparisonBlocks.length > 0) {
    blocks.splice(subjectBlocks.length > 0 ? 1 : 0, 0, ...comparisonBlocks)
  }
  blocks.push(...buildInventoryBlocks(inventory))
  blocks.push(...publicBlocks)

  const windowDays = subjectPayload.empty
    ? target.windowDays
    : subjectPayload.analysis?.period?.days ?? target.windowDays

  return {
    inputType: parsed.inputType,
    inputValue: parsed.inputValue,
    asin: parsed.primaryAsin,
    asins: parsed.asins,
    primaryAsin: parsed.primaryAsin,
    competitorAsins: parsed.competitorAsins,
    marketplace: target.marketplace,
    marketplaceSource: target.marketplaceSource,
    startDate: target.startDate,
    endDate: target.endDate,
    windowDays,
    compareWith: parsed.compareWith,
    compareLabel: comparisonLabel,
    customRange: target.customRange,
    empty: Boolean(subjectPayload.empty),
    rowCount: subjectPayload.rowCount ?? 0,
    summary: subjectPayload.summary ?? '',
    headline: buildHeadline({
      asin: parsed.primaryAsin,
      findings,
      marketplace: target.marketplace,
      startDate: target.startDate,
      endDate: target.endDate,
      windowDays,
    }),
    findings: findings.items,
    findingLevel: findings.level,
    comparison: {
      enabled: comparison.enabled,
      rows: comparisonRows,
      summary: comparison,
      blocks: comparisonBlocks,
      note: COMPARISON_SCOPE_NOTE,
    },
    inventory,
    blocks,
    citations: subjectPayload.citations ?? [],
    // 注意：这是 `combineFreshness` 的**对象**结构（含 datasets / periodEnd / note），不是数组。
    dataFreshness: subjectPayload.dataFreshness ?? null,
    // 每个 ASIN 的可用站点与最新日期，便于前端提示「换个站点可能有数据」
    availability: target.availability,
    // 竞品公开数据（卖家精灵第三方数据，与上面所有自家口径的数字分开）
    publicData: {
      dimensions: parsed.dimensions,
      dimensionLabels: parsed.dimensions.map((dimension) => DIMENSION_LABELS[dimension] ?? dimension),
      ttlHours: parsed.publicTtlHours,
      estimatedCalls: estimateCalls(parsed.dimensions, parsed.asins.length),
      calls: publicData.meta.calls,
      cacheHits: publicData.meta.cacheHits,
      errors: publicData.meta.errors,
      rows: publicRows,
      productCount: publicRows.filter((row) => row.hasData).length,
      fetchedAt: new Date().toISOString(),
    },
  }
}

/**
 * 合并「自家数据」与「公开数据」两组结论。
 *
 * 公开数据的每条结论都打上 `scope: 'public'` —— 前端据此分组展示，
 * 用户必须能一眼看出哪条结论来自自家报表、哪条来自第三方估算数据。
 */
/**
 * 合并两组结论（自家 / 公开），并给**公开数据**的结论补结构化处置方案。
 *
 * 自家结论在 `finalizeFindings` 里已经按诊断码补过 `fix`；公开结论由 `sellersprite-blocks.mjs`
 * 生成、没走那条路径，所以在收口处统一补 —— 两处都按 `code` 走 `finding-fixes.mjs`，
 * 处置文案只有一份。
 */
export function mergeFindings(local, publicResult, context = {}) {
  const items = [
    ...(local?.items ?? []).map((item) => ({ ...item, scope: 'local' })),
    ...(publicResult?.items ?? []).map((item) => {
      const withFix = item.code && !item.fix ? buildFix(item.code, { ...context, ...item }) : null
      /* 公开结论由 `sellersprite-blocks.mjs` 生成、不走 `finalizeFindings`，
         因此归属目标要在这里补 —— 处置台账按 (code, target) 记状态，缺 target
         就等于「这条结论不可销账」（界面上也就不会出现「标记已处理」）。 */
      const withTarget =
        item.targetAsins || !context.asin ? item : { ...item, targetAsins: [context.asin] }
      return { ...withTarget, scope: 'public', ...(withFix ? { fix: withFix } : {}) }
    }),
  ]
  const level = items.reduce(
    (worst, item) => (FINDING_WEIGHTS[item.level] > FINDING_WEIGHTS[worst] ? item.level : worst),
    'info'
  )
  return { items, level }
}

/* ---------- 历史记录 ---------- */

const RECORD_COLUMNS = `
  id, input_type, input_value, marketplace, asins,
  start_date::text AS start_date, end_date::text AS end_date,
  window_days, compare_with, headline, level, finding_count, created_at`

/**
 * 写入一条分析记录（含结果快照），返回落库后的记录行。
 *
 * `finding_keys` 是**可处置结论的轻量清单**（`[{ code, target, level }]`），
 * 与快照同时写入：首页要算「这条记录里还有几条没销账」，而 `result` 是几百 KB 的
 * 快照 JSON，不能为了几个计数把它整份读出来（见迁移 202）。
 */
export async function recordCompetitorAnalysis({ userId, result }) {
  const findingKeys = collectFindingKeys(result.findings, { asin: result.asin ?? null })
  const { rows } = await query(
    `INSERT INTO competitor_analyses
       (user_id, input_type, input_value, marketplace, asins, start_date, end_date, window_days, compare_with, headline, level, finding_count, result, finding_keys)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING ${RECORD_COLUMNS}`,
    [
      userId,
      result.inputType,
      result.inputValue,
      result.marketplace,
      JSON.stringify(result.asins ?? []),
      result.startDate,
      result.endDate,
      result.windowDays,
      result.compareWith,
      result.headline,
      result.findingLevel,
      result.findings?.length ?? 0,
      JSON.stringify(result),
      JSON.stringify(findingKeys),
    ]
  )
  return rows[0]
}

/** 历史列表（不含完整快照，避免列表接口传大 JSON）。 */
export async function listCompetitorAnalyses(userId, limit = 10) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50)
  const { rows } = await query(
    `SELECT ${RECORD_COLUMNS}, finding_keys, (result IS NOT NULL) AS has_snapshot
       FROM competitor_analyses
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [userId, safeLimit]
  )
  return rows
}

/**
 * 读取单条分析（含快照）。
 *
 * 归属校验写在 SQL 里：分析记录里含经营数据，越权读他人记录一律当作不存在（返回 null → 404），
 * 不区分「没有这条」与「不是你的」。
 */
export async function getCompetitorAnalysis(userId, id) {
  const numericId = Number(id)
  if (!Number.isInteger(numericId) || numericId <= 0) return null
  const { rows } = await query(
    `SELECT ${RECORD_COLUMNS}, finding_keys, result
       FROM competitor_analyses
      WHERE id = $1 AND user_id = $2`,
    [numericId, userId]
  )
  return rows[0] ?? null
}

/**
 * 历史列表项：把记录行转成前端需要的形状（快照缺失时标记只用参数展示）。
 *
 * **处置联动**（2026-09-17）：`openFindingCount` / `openLevel` 是"扣掉已销账与已忽略之后"
 * 剩下的问题数与最高级别 —— 首页「需处理的分析」与概览统计「需立即处理 N」都用它们。
 * 不传 `dispositions` 时回退到快照自己的 `level` / `finding_count`（老记录没有
 * `finding_keys`，那时台账还不存在，回退值与改前完全一致）。
 */
export function toHistoryItem(row, dispositions = null) {
  if (!row) return null
  const asins = Array.isArray(row.asins) ? row.asins : []
  const findingKeys = Array.isArray(row.finding_keys) ? row.finding_keys : null
  const open = findingKeys
    ? summarizeOpenFindings({
        findingKeys,
        /*
         * 用 `Array.isArray` 而不是 `?? []`：调用点写成 `list.map(toHistoryItem)` 时，
         * `Array.map` 会把**下标**当第二个参数传进来（0/1/…），而 `0 ?? []` 仍是 0 ——
         * 下游 `clearedDispositionKeys(0)` 里 `0.filter` 抛 `rows.filter is not a function`，
         * 整条历史列表与 AI 工具一起挂（2026-09-18 实测：用户报
         * `query_competitor_analysis（rows.filter is not a function）`）。
         * 非数组一律按"没有销账台账"处理；两处调用点也已改成显式只传 row。
         */
        dispositions: Array.isArray(dispositions) ? dispositions : [],
      })
    : /* 没有清单（理论上迁移 203 已回填，这里是兜底）：只能整体回退到快照判定 */
      { openCount: row.finding_count ?? 0, openLevel: row.level ?? null, clearedCount: 0 }
  return {
    id: row.id,
    inputType: row.input_type,
    inputValue: row.input_value,
    asins: asins.length > 0 ? asins : String(row.input_value ?? '').split(',').filter(Boolean),
    marketplace: row.marketplace ?? null,
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    windowDays: row.window_days ?? null,
    compareWith: row.compare_with ?? null,
    headline: row.headline ?? null,
    level: row.level ?? null,
    findingCount: row.finding_count ?? 0,
    /** 未销账的问题条数与最高级别（首页报警口径）。 */
    openFindingCount: open.openCount,
    openLevel: open.openLevel,
    /**
     * **已销账的待办条数**（列表用来告诉用户"你标记过、生效了"）。
     *
     * 口径是"actionable 总数 − 未销账数"，**不含 `info` 级** —— 拿 `findingCount` 相减会让
     * 一条都没销账的记录也显示"已销账 N 条"。
     */
    clearedFindingCount: open.clearedCount ?? 0,
    hasSnapshot: Boolean(row.has_snapshot ?? row.result),
    createdAt: row.created_at ?? null,
  }
}

/**
 * 竞品公开数据的展现层：把卖家精灵的原始返回整形成项目的块结构（表格 / 图表 / 指标卡），
 * 并生成**确定性结论**（`buildPublicFindings`）。
 *
 * 口径纪律（改这个文件前必读）：
 * - 卖家精灵是**第三方估算数据**，与自家报表的真实经营数据**不能混算**：
 *   本文件里的对比一律是「公开数据 vs 公开数据」（本品与竞品同为公开口径），
 *   绝不把它和 `amazonPerformancePayload` 的广告/销量数字相加或相除。
 * - 缺失一律用 `null`（表格渲染成「—」），**不得用 0 代替** ——
 *   卖家精灵对部分 ASIN 没有收录（实测 `B08N5WRWNW` 的价格/BSR/评分全为 null），
 *   把"没数据"显示成 0 会直接误导决策。
 * - 每条结论都要带 `evidence`（可复算的数字依据），没有命中就不编评语。
 */
import {
  buildChartBlock,
  buildMetricsBlock,
  buildTableBlock,
} from './ai-agent/data-queries.mjs'
import { TREND_MONTHS } from './sellersprite-config.mjs'

const PUBLIC_SCOPE_NOTE =
  '以下为**卖家精灵第三方公开数据**（非本公司报表），用于跨店铺对比；与页面其它板块的自家经营数据口径不同，请勿直接相加。'

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null)

const round = (value, digits = 2) => {
  const parsed = num(value)
  if (parsed === null) return null
  const factor = 10 ** digits
  return Math.round(parsed * factor) / factor
}

const percent = (value, digits = 1) => {
  const parsed = num(value)
  if (parsed === null) return null
  // 卖家精灵的比例字段实测是小数（returnRatio 0.3474 / top3BrandCrn 0.8465），统一转成百分比
  return round(parsed * 100, digits)
}

const msToDate = (value) => {
  const parsed = num(value)
  if (parsed === null || parsed <= 0) return null
  const date = new Date(parsed)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

const daysSince = (isoDate, now = new Date()) => {
  if (!isoDate) return null
  const date = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  return Math.max(0, Math.round((now.getTime() - date.getTime()) / 86400000))
}

const avg = (values) => {
  const list = values.filter((value) => typeof value === 'number' && Number.isFinite(value))
  if (list.length === 0) return null
  return list.reduce((sum, value) => sum + value, 0) / list.length
}

/* ---------- 商品公开数据 ---------- */

/** 每个 ASIN 的公开商品属性行（本品与竞品同一套字段，缺失为 null）。 */
export function buildPublicProductRows({ details = {}, asins = [], primaryAsin = null, now = new Date() } = {}) {
  return asins.map((asin) => {
    const detail = details?.[asin] ?? null
    const availableDate = detail ? msToDate(detail.availableDate) : null
    return {
      asin,
      role: asin === primaryAsin ? 'subject' : 'competitor',
      roleLabel: asin === primaryAsin ? '本品' : '竞品',
      hasData: Boolean(detail),
      title: detail ? text(detail.title) : null,
      brand: detail ? text(detail.brand) : null,
      price: detail ? num(detail.price) : null,
      rating: detail ? num(detail.rating) : null,
      ratings: detail ? num(detail.ratings) : null,
      bsrRank: detail ? num(detail.bsrRank) : null,
      bsrLabel: detail ? text(detail.bsrLabel) : null,
      sellers: detail ? num(detail.sellers) : null,
      fulfillment: detail ? text(detail.fulfillment) : null,
      lqs: detail ? num(detail.lqs) : null,
      nodeLabelPath: detail ? text(detail.nodeLabelPath) : null,
      imageUrl: detail ? text(detail.imageUrl) : null,
      availableDate,
      listedDays: daysSince(availableDate, now),
    }
  })
}

const PUBLIC_COLUMNS = [
  { key: 'roleLabel', label: '角色' },
  { key: 'asin', label: 'ASIN' },
  { key: 'brand', label: '品牌' },
  { key: 'price', label: '价格', align: 'right' },
  { key: 'rating', label: '评分', align: 'right' },
  { key: 'ratings', label: '评分数', align: 'right' },
  { key: 'bsrRank', label: 'BSR', align: 'right' },
  { key: 'sellers', label: '卖家数', align: 'right' },
  { key: 'fulfillment', label: '配送' },
  { key: 'availableDate', label: '上架日期' },
]

/** 商品公开数据对比表（本品与竞品同一口径）。 */
export function buildPublicProductBlock(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const hasAny = rows.some((row) => row.hasData)
  if (!hasAny) return null
  return buildTableBlock({
    title: '商品公开数据对比（卖家精灵）',
    columns: PUBLIC_COLUMNS,
    rows,
    /**
     * 数据源标记（2026-09-16 新增）：前端靠它把这一块从 `blocks` 里**结构化地**摘出来，
     * 改由「卡片（带主图，可点进单个竞品详情页）/ 表格」两种视图渲染。
     * 不用标题文字匹配 —— 标题是给人看的文案，改一个字就会让识别静默失效。
     */
    dataset: 'sellersprite_products',
    note: `${PUBLIC_SCOPE_NOTE} 缺失字段显示「—」表示卖家精灵未收录该 ASIN 的对应数据。`,
  })
}

/**
 * 各 ASIN 的月销量趋势对比图。
 *
 * 月份取各 ASIN 的并集并按时间排序 —— 不同 ASIN 的起始月份不同，
 * 只取本品有数据的月份会让竞品曲线凭空缺一段。
 */
export function buildTrendChartBlock({ trends = {}, asins = [], primaryAsin = null } = {}) {
  const series = asins.filter((asin) => Array.isArray(trends?.[asin]) && trends[asin].length > 0)
  if (series.length === 0) return null

  const months = new Set()
  const byAsin = {}
  for (const asin of series) {
    byAsin[asin] = {}
    for (const point of trends[asin]) {
      const month = text(point?.month)
      if (!month) continue
      const units = num(point.parentUnitSales) ?? num(point.childUnitSales)
      byAsin[asin][month] = units
      months.add(month)
    }
  }
  const sorted = [...months].sort()
  const recent = sorted.slice(-TREND_MONTHS)
  if (recent.length === 0) return null

  return buildChartBlock({
    title: `月销量趋势对比（近 ${recent.length} 个月，卖家精灵估算）`,
    chartType: 'line',
    xKey: 'month',
    series: series.map((asin) => ({
      key: asin,
      label: asin === primaryAsin ? `${asin}（本品）` : asin,
      kind: 'line',
    })),
    data: recent.map((month) => {
      const row = { month }
      for (const asin of series) row[asin] = byAsin[asin][month] ?? null
      return row
    }),
    note: `${PUBLIC_SCOPE_NOTE} 数值为卖家精灵对父体月销量的估算。`,
  })
}

/** 公开口径的对比指标条（本品 vs 竞品均值）。 */
export function buildPublicMetricsBlock(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const subject = rows.find((row) => row.role === 'subject') ?? null
  const competitors = rows.filter((row) => row.role === 'competitor' && row.hasData)
  if (!subject?.hasData || competitors.length === 0) return null

  const priceAvg = avg(competitors.map((row) => row.price))
  const ratingAvg = avg(competitors.map((row) => row.rating))
  const ratingsAvg = avg(competitors.map((row) => row.ratings))
  const bsrAvg = avg(competitors.map((row) => row.bsrRank))

  const delta = (subjectValue, base) => {
    if (typeof subjectValue !== 'number' || typeof base !== 'number' || base === 0) return null
    return round(((subjectValue - base) / base) * 100, 1)
  }

  const items = [
    {
      key: 'price',
      label: '价格（本品 / 竞品均值）',
      value: subject.price === null || priceAvg === null
        ? null
        : `${subject.price} / ${round(priceAvg, 2)}`,
      unit: 'USD',
    },
    {
      key: 'priceDelta',
      label: '价格相对竞品均值',
      value: delta(subject.price, priceAvg),
      unit: '%',
    },
    {
      key: 'rating',
      label: '评分（本品 / 竞品均值）',
      value: subject.rating === null || ratingAvg === null
        ? null
        : `${subject.rating} / ${round(ratingAvg, 2)}`,
    },
    {
      key: 'ratings',
      label: '评分数（本品 / 竞品均值）',
      value: subject.ratings === null || ratingsAvg === null
        ? null
        : `${subject.ratings} / ${Math.round(ratingsAvg)}`,
    },
    {
      key: 'bsr',
      label: 'BSR（本品 / 竞品均值）',
      value: subject.bsrRank === null || bsrAvg === null
        ? null
        : `${subject.bsrRank} / ${Math.round(bsrAvg)}`,
    },
    {
      key: 'listedDays',
      label: '上架天数（本品）',
      value: subject.listedDays,
      unit: '天',
    },
  ].filter((item) => item.value !== null && item.value !== undefined)

  if (items.length === 0) return null
  return buildMetricsBlock({
    title: '公开口径对比（本品 vs 竞品均值）',
    items,
    note: PUBLIC_SCOPE_NOTE,
  })
}

/* ---------- 类目市场 ---------- */

export function buildMarketBlocks(market) {
  const research = market?.research ?? null
  const blocks = []
  const label = text(market?.nodeLabelLocale) ?? text(market?.nodeLabel) ?? '类目'

  if (research) {
    const items = [
      { key: 'totalUnits', label: '类目月销量', value: num(research.totalUnits) },
      { key: 'totalRevenue', label: '类目月销售额', value: round(research.totalRevenue, 0), unit: 'USD' },
      { key: 'totalProducts', label: '在售商品数', value: num(research.totalProducts) },
      { key: 'brands', label: '品牌数', value: num(research.brands) },
      { key: 'sellers', label: '卖家数', value: num(research.sellers) },
      { key: 'avgPrice', label: '均价', value: round(research.avgPrice, 2), unit: 'USD' },
      { key: 'avgRating', label: '平均评分', value: num(research.avgRating) },
      { key: 'avgRatings', label: '平均评分数', value: num(research.avgRatings) },
      { key: 'avgBsr', label: '平均 BSR', value: num(research.avgBsr) },
      { key: 'avgProfit', label: '平均利润率', value: round(research.avgProfit, 1), unit: '%' },
      { key: 'returnRatio', label: '退货率', value: percent(research.returnRatio), unit: '%' },
      { key: 'ebcProportion', label: 'A+ 页面占比', value: percent(research.ebcProportion), unit: '%' },
      { key: 'amazonSelfProportion', label: '亚马逊自营占比', value: percent(research.amazonSelfProportion), unit: '%' },
      { key: 'searchToPurchaseRatio', label: '搜索购买比', value: round(research.searchToPurchaseRatio, 1) },
    ].filter((item) => item.value !== null && item.value !== undefined)

    if (items.length > 0) {
      blocks.push(
        buildMetricsBlock({
          title: `类目市场概览：${label}`,
          items,
          note: `${PUBLIC_SCOPE_NOTE} 类目节点：${market.nodeLabel ?? '—'}。`,
        })
      )
    }

    // 集中度：头部商品/品牌/卖家的销售额占比 —— 判断"这个类目还能不能进"
    const concentrationRows = [3, 5, 10, 20]
      .map((top) => ({
        top: `TOP${top}`,
        productCrn: percent(research[`top${top}ProductCrn`]),
        brandCrn: percent(research[`top${top}BrandCrn`]),
        sellerCrn: percent(research[`top${top}SellerCrn`]),
        productSales: num(research[`top${top}ProductSales`]),
        brandSales: num(research[`top${top}BrandSales`]),
      }))
      .filter((row) => row.productCrn !== null || row.brandCrn !== null || row.sellerCrn !== null)
    if (concentrationRows.length > 0) {
      blocks.push(
        buildTableBlock({
          title: '市场集中度（销售额占比 %）',
          columns: [
            { key: 'top', label: '范围' },
            { key: 'productCrn', label: '商品集中度', align: 'right' },
            { key: 'brandCrn', label: '品牌集中度', align: 'right' },
            { key: 'sellerCrn', label: '卖家集中度', align: 'right' },
            { key: 'productSales', label: 'TOP 商品销量', align: 'right' },
            { key: 'brandSales', label: 'TOP 品牌销量', align: 'right' },
          ],
          rows: concentrationRows,
          note: PUBLIC_SCOPE_NOTE,
        })
      )
    }

    // 新品结构：近 1/3/6/12 个月新品占比与表现 —— 判断"新品还有没有机会"
    const newRows = [1, 3, 6, 12]
      .map((months) => ({
        window: `近 ${months} 个月`,
        ratio: percent(research[`l${months}NewRatio`]),
        count: num(research[`l${months}NewCount`]),
        avgPrice: round(research[`l${months}NewAvgPrice`], 2),
        avgRatings: num(research[`l${months}NewAvgReviews`]),
        avgRating: num(research[`l${months}NewAvgRating`]),
        avgSales: num(research[`l${months}NewAvgSales`]),
      }))
      .filter((row) => row.ratio !== null || row.count !== null)
    if (newRows.length > 0) {
      blocks.push(
        buildTableBlock({
          title: '新品结构（近 1/3/6/12 个月上架）',
          columns: [
            { key: 'window', label: '上架窗口' },
            { key: 'ratio', label: '新品占比 %', align: 'right' },
            { key: 'count', label: '新品数', align: 'right' },
            { key: 'avgPrice', label: '新品均价', align: 'right' },
            { key: 'avgRatings', label: '新品平均评分数', align: 'right' },
            { key: 'avgRating', label: '新品平均评分', align: 'right' },
            { key: 'avgSales', label: '新品平均销量', align: 'right' },
          ],
          rows: newRows,
          note: PUBLIC_SCOPE_NOTE,
        })
      )
    }
  }

  const priceRows = Array.isArray(market?.priceDistribution) ? market.priceDistribution : []
  if (priceRows.length > 0) {
    blocks.push(
      buildTableBlock({
        title: '价格带分布（卖家精灵）',
        columns: [
          { key: 'label', label: '价格区间' },
          { key: 'products', label: '商品数', align: 'right' },
          { key: 'units', label: '销量', align: 'right' },
          { key: 'revenue', label: '销售额', align: 'right' },
          { key: 'unitsRatio', label: '销量占比 %', align: 'right' },
        ],
        rows: priceRows.map((row) => ({
          label: text(row.label) ?? '—',
          products: num(row.products),
          units: num(row.units),
          revenue: round(row.revenue, 0),
          unitsRatio: percent(row.unitsRatio),
        })),
        note: PUBLIC_SCOPE_NOTE,
      })
    )
  }
  return blocks
}

/* ---------- 流量与关键词 ---------- */

const NATURAL_BADGES = new Set(['naturalSearching', 'amazonChoice', 'editorial'])
const AD_BADGES = new Set([
  'sponsorVideo',
  'sponsorBrand',
  'sponsorProducts',
  'sponsorDisplay',
  'sponsored',
])

const BADGE_LABELS = {
  naturalSearching: '自然搜索',
  amazonChoice: 'Amazon Choice',
  editorial: '编辑推荐',
  sponsorVideo: '视频广告',
  sponsorBrand: '品牌广告',
  sponsorProducts: '商品广告',
  sponsorDisplay: '展示广告',
}

/** 流量词明细表 + 流量结构指标（自然 vs 广告）。 */
export function buildTrafficBlocks(keywords = {}, asins = [], primaryAsin = null) {
  const withData = asins.filter((asin) => Array.isArray(keywords?.[asin]?.items))
  if (withData.length === 0) return []

  const blocks = []
  const structureItems = []
  const rows = []

  for (const asin of withData) {
    const data = keywords[asin]
    const items = Array.isArray(data.items) ? data.items : []
    let natural = 0
    let ad = 0
    for (const item of items) {
      const badges = Array.isArray(item?.badges) ? item.badges : []
      if (badges.some((badge) => NATURAL_BADGES.has(badge))) natural += 1
      if (badges.some((badge) => AD_BADGES.has(badge))) ad += 1
    }
    structureItems.push({
      key: `total-${asin}`,
      label: `${asin === primaryAsin ? '本品' : '竞品'} 流量词总数`,
      value: num(data.total),
    })
    structureItems.push({
      key: `natural-${asin}`,
      label: `${asin === primaryAsin ? '本品' : '竞品'} 自然流量词`,
      value: natural,
    })
    structureItems.push({
      key: `ad-${asin}`,
      label: `${asin === primaryAsin ? '本品' : '竞品'} 广告词`,
      value: ad,
    })

    for (const item of items.slice(0, 15)) {
      rows.push({
        asin,
        role: asin === primaryAsin ? '本品' : '竞品',
        keyword: text(item?.keyword) ?? '—',
        keywordCn: text(item?.keywordCn) ?? '—',
        searches: num(item?.searches),
        products: num(item?.products),
        purchaseRate: percent(item?.purchaseRate),
        bid: num(item?.bid),
        rank: num(item?.rankPosition?.position),
        adRank: num(item?.adPosition?.position),
        badges: Array.isArray(item?.badges)
          ? item.badges.filter((badge) => BADGE_LABELS[badge]).map((badge) => BADGE_LABELS[badge]).join('、')
          : '—',
      })
    }
  }

  const metricsItems = structureItems.filter((item) => item.value !== null)
  if (metricsItems.length > 0) {
    blocks.push(
      buildMetricsBlock({
        title: '流量结构（按流量词标记统计）',
        items: metricsItems,
        note: `${PUBLIC_SCOPE_NOTE} 自然/广告按卖家精灵给流量词打的标记（自然搜索、Amazon Choice、视频/品牌/商品广告等）计数。`,
      })
    )
  }

  if (rows.length > 0) {
    blocks.push(
      buildTableBlock({
        title: 'TOP 流量词（含搜索量与竞价）',
        columns: [
          { key: 'role', label: '角色' },
          { key: 'keyword', label: '关键词' },
          { key: 'keywordCn', label: '中文' },
          { key: 'searches', label: '月搜索量', align: 'right' },
          { key: 'products', label: '在售商品数', align: 'right' },
          { key: 'purchaseRate', label: '购买率 %', align: 'right' },
          { key: 'bid', label: '建议竞价', align: 'right' },
          { key: 'rank', label: '自然排名', align: 'right' },
          { key: 'adRank', label: '广告排名', align: 'right' },
          { key: 'badges', label: '流量标记' },
        ],
        rows,
        maxRows: 60,
        note: PUBLIC_SCOPE_NOTE,
      })
    )
  }
  return blocks
}

/* ---------- 评论痛点 ---------- */

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had', 'her', 'was',
  'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old', 'see',
  'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use', 'that',
  'with', 'this', 'have', 'from', 'they', 'been', 'were', 'said', 'each', 'which', 'their',
  'will', 'other', 'about', 'would', 'there', 'these', 'them', 'then', 'some', 'could', 'into',
  'than', 'when', 'what', 'your', 'just', 'like', 'very', 'also', 'only', 'even', 'back', 'after',
  'much', 'more', 'most', 'made', 'make', 'does', 'doing', 'got', 'still', 'because', 'amazon',
  'product', 'products', 'buy', 'bought', 'purchase', 'ordered', 'order', 'item', 'items', 'one',
  'really', 'think', 'know', 'want', 'need', 'used', 'using', 'doesnt', 'dont', 'didnt', 'isnt',
  'wasnt', 'ive',
])

/** 从差评正文里提词频（服务端确定性计算，不让模型介入）。 */
export function extractComplaintTerms(items, { limit = 15 } = {}) {
  const counts = new Map()
  for (const item of items ?? []) {
    const content = `${item?.title ?? ''} ${item?.content ?? ''}`.toLowerCase()
    for (const token of content.split(/[^a-z']+/)) {
      const word = token.replace(/^'+|'+$/g, '')
      if (word.length < 3 || STOP_WORDS.has(word) || /^\d+$/.test(word)) continue
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }))
}

/** 评论痛点：星级分布 + 高频差评词。 */
export function buildReviewBlocks(reviews = {}, asins = [], primaryAsin = null) {
  const withData = asins.filter((asin) => reviews?.[asin])
  if (withData.length === 0) return []

  const metricItems = []
  const termRows = []
  for (const asin of withData) {
    const data = reviews[asin]
    const items = Array.isArray(data.items) ? data.items : []
    metricItems.push({
      key: `total-${asin}`,
      label: `${asin === primaryAsin ? '本品' : '竞品'} 评论总数`,
      value: num(data.total),
    })
    metricItems.push({
      key: `sample-${asin}`,
      label: `${asin === primaryAsin ? '本品' : '竞品'} 取样差评`,
      value: items.length,
    })
    metricItems.push({
      key: `avgStar-${asin}`,
      label: `${asin === primaryAsin ? '本品' : '竞品'} 取样平均星级`,
      value: round(avg(items.map((item) => num(item?.star))), 2),
    })
    for (const term of extractComplaintTerms(items)) {
      termRows.push({
        asin,
        role: asin === primaryAsin ? '本品' : '竞品',
        term: term.term,
        count: term.count,
      })
    }
  }

  const blocks = []
  const visibleMetrics = metricItems.filter((item) => item.value !== null && item.value !== undefined)
  if (visibleMetrics.length > 0) {
    blocks.push(
      buildMetricsBlock({
        title: '评论概况（1-2 星差评取样）',
        items: visibleMetrics,
        note: `${PUBLIC_SCOPE_NOTE} 取样口径为 1-2 星差评，用于找痛点，不代表整体口碑。`,
      })
    )
  }
  if (termRows.length > 0) {
    blocks.push(
      buildTableBlock({
        title: '差评高频词（词频统计）',
        columns: [
          { key: 'role', label: '角色' },
          { key: 'asin', label: 'ASIN' },
          { key: 'term', label: '高频词' },
          { key: 'count', label: '出现次数', align: 'right' },
        ],
        rows: termRows.sort((a, b) => b.count - a.count),
        maxRows: 40,
        note: `${PUBLIC_SCOPE_NOTE} 由服务端对差评正文做词频统计（已去停用词，出现 ≥2 次才收录）。`,
      })
    )
  }
  return blocks
}

/* ---------- 确定性结论 ---------- */

const WEIGHT = { high: 3, medium: 2, low: 1, info: 0 }

/**
 * 构造一条公开数据结论。
 *
 * `code` 是稳定的**诊断码**（如 `public_price_below`）：处置方案（系统内去哪、系统外怎么做）
 * 由 `finding-fixes.mjs` 按码生成，在 `mergeFindings`（`competitor-analysis.mjs`）处统一补 ——
 * 本文件只负责给码，不关心入口路径。
 */
function finding(level, title, detail, action = null, evidence = [], code = null) {
  return { level, title, detail, action, evidence, code }
}

/**
 * 基于公开数据的确定性结论。
 *
 * 与 `buildFindings` 一样：**命中才产出**，没有命中不给评语（避免"每个 ASIN 都有一堆建议"的噪声）。
 * 与自家数据的结论分开呈现（`scope: 'public'`），前端按来源分组。
 */
export function buildPublicFindings({
  productRows = [],
  trends = {},
  keywords = {},
  reviews = {},
  primaryAsin = null,
  dimensions = null,
  errors = [],
} = {}) {
  const items = []
  const indexedSubject = productRows.find((row) => row.role === 'subject' && row.hasData) ?? null
  const subject = indexedSubject ?? (primaryAsin ? { asin: primaryAsin, role: 'subject', hasData: false } : null)
  const competitors = productRows.filter((row) => row.role === 'competitor' && row.hasData)
  // 未传维度表示旧调用方的“全部维度”语义；显式传空数组才表示不请求公开数据。
  const publicRequested = dimensions === null || dimensions.includes('public')
  const trafficRequested = dimensions === null || dimensions.includes('traffic')
  const reviewsRequested = dimensions === null || dimensions.includes('reviews')
  const publicFailed = errors.some((error) => error.dimension === 'public')

  if (!indexedSubject && publicRequested) {
    if (productRows.length > 0 && !publicFailed) {
      items.push(
        finding(
          'info',
          '卖家精灵未收录本品',
          `卖家精灵没有本品 ${primaryAsin ?? 'ASIN'} 的公开商品数据，因此无法做价格、评分与 BSR 的跨店铺对比。`,
          '可先在卖家精灵开放平台确认该 ASIN 是否在收录范围内；同时本页下方的自家经营数据不受影响。',
          [],
          'public_not_indexed'
        )
      )
    }
    if (!subject || (!trafficRequested && !reviewsRequested)) {
      return { items, level: 'info' }
    }
  }

  // 1) 价格位置
  if (indexedSubject && competitors.length > 0) {
    const priceAvg = avg(competitors.map((row) => row.price))
    if (typeof subject.price === 'number' && typeof priceAvg === 'number' && priceAvg > 0) {
      const deltaPct = ((subject.price - priceAvg) / priceAvg) * 100
      const higher = deltaPct >= 0
      const level = Math.abs(deltaPct) >= 25 ? 'medium' : Math.abs(deltaPct) >= 10 ? 'low' : 'info'
      items.push(
        finding(
          level,
          higher ? '定价高于竞品均值' : '定价低于竞品均值',
          `本品价格 ${subject.price}，竞品均值 ${round(priceAvg, 2)}，${higher ? '高' : '低'} ${round(Math.abs(deltaPct), 1)}%。`,
          higher
            ? '价格高于同类时，转化率与评论量是能否守住溢价的关键；若两者都不占优，优先用优惠券/套餐而非直接降价。'
            : '价格偏低时先确认是否牺牲了毛利，再考虑用小幅提价换取利润空间（同时观察 BSR 变化）。',
          [
            `本品价格 ${subject.price}`,
            `竞品价格：${competitors.map((row) => `${row.asin}=${row.price ?? '—'}`).join('，')}`,
            `竞品均值 ${round(priceAvg, 2)}`,
          ],
          higher ? 'public_price_above' : 'public_price_below'
        )
      )
    }

    // 2) 评分与评分数
    const ratingAvg = avg(competitors.map((row) => row.rating))
    if (typeof subject.rating === 'number' && typeof ratingAvg === 'number') {
      const gap = subject.rating - ratingAvg
      if (Math.abs(gap) >= 0.2) {
        items.push(
          finding(
            gap < 0 ? 'medium' : 'info',
            gap < 0 ? '评分低于竞品均值' : '评分领先竞品均值',
            `本品评分 ${subject.rating}，竞品均值 ${round(ratingAvg, 2)}（差 ${round(gap, 2)}）。`,
            gap < 0
              ? '评分是转化的硬门槛：优先处理差评集中的问题（见评论痛点板块），而不是继续投广告放大流量。'
              : '评分优势可以用来承接更高定价或更激进的投放。',
            [
              `本品评分 ${subject.rating}`,
              `竞品评分：${competitors.map((row) => `${row.asin}=${row.rating ?? '—'}`).join('，')}`,
            ],
            gap < 0 ? 'public_rating_below' : null
          )
        )
      }
    }

    const ratingsAvg = avg(competitors.map((row) => row.ratings))
    if (typeof subject.ratings === 'number' && typeof ratingsAvg === 'number' && ratingsAvg > 0) {
      const ratio = subject.ratings / ratingsAvg
      if (ratio < 0.5) {
        items.push(
          finding(
            'medium',
            '评分数显著少于竞品',
            `本品评分数 ${subject.ratings}，竞品均值 ${Math.round(ratingsAvg)}（约为竞品的 ${round(ratio * 100, 0)}%）。`,
            '评分数是同类目排序与转化的基础：优先把评论获取纳入节奏（Request a Review、售后卡片、Vine），而不是先加预算。',
            [`本品评分数 ${subject.ratings}`, `竞品均值 ${Math.round(ratingsAvg)}`],
            'public_ratings_fewer'
          )
        )
      } else if (ratio >= 1.5) {
        items.push(
          finding(
            'info',
            '评分数领先竞品',
            `本品评分数 ${subject.ratings}，竞品均值 ${Math.round(ratingsAvg)}（约为竞品的 ${round(ratio * 100, 0)}%）。`,
            '评分数优势可以支撑更高的定价与更激进的投放。',
            [`本品评分数 ${subject.ratings}`, `竞品均值 ${Math.round(ratingsAvg)}`]
          )
        )
      }
    }

    // 3) BSR 位置
    const bsrAvg = avg(competitors.map((row) => row.bsrRank))
    if (typeof subject.bsrRank === 'number' && typeof bsrAvg === 'number') {
      const better = subject.bsrRank < bsrAvg
      items.push(
        finding(
          better ? 'info' : 'low',
          better ? 'BSR 优于竞品均值' : 'BSR 落后于竞品均值',
          `本品 BSR ${subject.bsrRank}，竞品均值 ${Math.round(bsrAvg)}（BSR 越小越好）。`,
          better ? null : 'BSR 落后说明相对销量份额在下降，结合价格与评分数一起看差在哪一环。',
          [`本品 BSR ${subject.bsrRank}`, `竞品均值 ${Math.round(bsrAvg)}`],
          better ? null : 'public_bsr_behind'
        )
      )
    }
  }

  // 4) 上架时长（新品机会 / 老品壁垒）
  if (typeof subject.listedDays === 'number') {
    const competitorDays = avg(competitors.map((row) => row.listedDays))
    if (subject.listedDays <= 365) {
      items.push(
        finding(
          'info',
          '本品属于新上架（一年内）',
          `本品上架 ${subject.listedDays} 天${typeof competitorDays === 'number' ? `，竞品平均 ${Math.round(competitorDays)} 天` : ''}。`,
          '新品期是排名爬升最快的窗口，重点在评论积累与关键词覆盖，别在这个阶段用大幅降价换排名。',
          [`上架日期 ${subject.availableDate ?? '—'}`, `上架天数 ${subject.listedDays}`]
        )
      )
    } else if (typeof competitorDays === 'number' && subject.listedDays < competitorDays * 0.6) {
      items.push(
        finding(
          'info',
          '本品比竞品年轻',
          `本品上架 ${subject.listedDays} 天，竞品平均 ${Math.round(competitorDays)} 天。`,
          '竞品的老品优势主要来自评论与历史权重，短期追不上；用差异化卖点与更精准的关键词切细分人群更现实。',
          [`本品上架天数 ${subject.listedDays}`, `竞品平均 ${Math.round(competitorDays)}`]
        )
      )
    }
  }

  // 5) 销量趋势（公开口径）
  const subjectTrend = Array.isArray(trends?.[subject.asin]) ? trends[subject.asin] : []
  if (publicRequested && subjectTrend.length >= 6) {
    const recent = subjectTrend.slice(-3)
    const previous = subjectTrend.slice(-6, -3)
    const recentAvg = avg(recent.map((point) => num(point.parentUnitSales) ?? num(point.childUnitSales)))
    const previousAvg = avg(previous.map((point) => num(point.parentUnitSales) ?? num(point.childUnitSales)))
    if (typeof recentAvg === 'number' && typeof previousAvg === 'number' && previousAvg > 0) {
      const deltaPct = ((recentAvg - previousAvg) / previousAvg) * 100
      if (Math.abs(deltaPct) >= 15) {
        items.push(
          finding(
            deltaPct < 0 ? 'medium' : 'info',
            deltaPct < 0 ? '月销量近 3 个月下滑' : '月销量近 3 个月上升',
            `近 3 个月月均销量 ${Math.round(recentAvg)}，前 3 个月 ${Math.round(previousAvg)}（${deltaPct > 0 ? '+' : ''}${round(deltaPct, 1)}%，卖家精灵估算）。`,
            deltaPct < 0
              ? '先区分是季节波动还是份额流失：对比同期竞品趋势，竞品也在跌说明是淡季，只有本品在跌才是问题。'
              : '上升期优先保证库存与广告效率，避免断货把排名让出去。',
            [
              `近 3 个月：${recent.map((p) => `${p.month}=${num(p.parentUnitSales) ?? '—'}`).join('，')}`,
              `前 3 个月：${previous.map((p) => `${p.month}=${num(p.parentUnitSales) ?? '—'}`).join('，')}`,
            ],
            deltaPct < 0 ? 'public_trend_down' : null
          )
        )
      }
    }
  }

  // 6) 流量结构（广告依赖度）
  const subjectKeywords = keywords?.[subject.asin]
  if (trafficRequested && Array.isArray(subjectKeywords?.items) && subjectKeywords.items.length > 0) {
    let natural = 0
    let ad = 0
    for (const item of subjectKeywords.items) {
      const badges = Array.isArray(item?.badges) ? item.badges : []
      if (badges.some((badge) => NATURAL_BADGES.has(badge))) natural += 1
      if (badges.some((badge) => AD_BADGES.has(badge))) ad += 1
    }
    const total = subjectKeywords.items.length
    if (ad / total >= 0.5) {
      items.push(
        finding(
          'medium',
          '流量对广告依赖偏高',
          `取样的 ${total} 个流量词里，${ad} 个带广告标记、${natural} 个带自然标记。`,
          '广告依赖高的 listing 一旦降预算排名就掉：优先做关键词覆盖与转化优化（图片、A+、评论），把一部分词做成自然位。',
          [`取样流量词 ${total} 个`, `带广告标记 ${ad} 个`, `带自然标记 ${natural} 个`],
          'public_ad_dependency_high'
        )
      )
    }
  }

  // 7) 评论痛点
  const competitorTerms = []
  for (const row of competitors) {
    for (const term of extractComplaintTerms(reviews?.[row.asin]?.items, { limit: 8 })) {
      competitorTerms.push({ asin: row.asin, ...term })
    }
  }
  if (reviewsRequested && competitorTerms.length > 0) {
    const top = competitorTerms.sort((a, b) => b.count - a.count).slice(0, 5)
    items.push(
      finding(
        'info',
        '竞品差评集中在这些点上',
        `竞品 1-2 星差评的高频词：${top.map((term) => `${term.term}(${term.count})`).join('、')}。`,
        '这些是竞品的软肋，可作为选品/改良与详情页卖点的切入点（把"我们不这样"写进五点描述）。',
        top.map((term) => `${term.asin}：${term.term} × ${term.count}`),
        'public_review_weakness'
      )
    )
  }

  const level = items.reduce(
    (worst, item) => (WEIGHT[item.level] > WEIGHT[worst] ? item.level : worst),
    'info'
  )
  return { items, level }
}

/**
 * 类目市场的确定性结论（**市场调研页专用**）。
 *
 * 2026-09-16 从 `buildPublicFindings` 拆出来：市场结构不是任何一个 ASIN 的属性，
 * 它的输入是类目节点而不是 ASIN 列表 —— 留在竞品分析里会造成
 * 「我所在类目的结构」与「跨类目的竞品对比」被并排误读（见 `docs/modules/产品开发.md`）。
 */
export function buildMarketFindings(market) {
  const items = []
  const research = market?.research ?? null
  if (!research) {
    return { items, level: 'info' }
  }

  // 规模：判断"这个类目有没有量"
  const totalUnits = num(research.totalUnits)
  const totalRevenue = num(research.totalRevenue)
  if (totalUnits !== null) {
    const sizeLevel = totalUnits >= 500000 ? 'info' : totalUnits >= 50000 ? 'low' : 'medium'
    items.push(
      finding(
        sizeLevel,
        totalUnits >= 50000 ? '类目有一定规模' : '类目规模偏小',
        `类目月销量约 ${totalUnits.toLocaleString('zh-CN')} 件${totalRevenue !== null ? `、月销售额约 ${Math.round(totalRevenue).toLocaleString('zh-CN')} 美元` : ''}，在售商品 ${num(research.totalProducts) ?? '—'} 个。`,
        totalUnits >= 50000
          ? '有规模的类目才撑得起广告投入；接下来看集中度与价格带，确认切入口在哪。'
          : '类目整体量小，即使做到头部天花板也有限；确认它是细分高毛利品类，还是确实不值得投入。',
        [
          `类目月销量 ${totalUnits}`,
          `在售商品数 ${num(research.totalProducts) ?? '—'}`,
          `品牌数 ${num(research.brands) ?? '—'} / 卖家数 ${num(research.sellers) ?? '—'}`,
        ]
      )
    )
  }

  // 集中度：头部垄断程度
  const brandCrn = num(research.top10BrandCrn)
  if (brandCrn !== null && brandCrn >= 0.7) {
    items.push(
      finding(
        'medium',
        '类目头部品牌集中度高',
        `TOP10 品牌占类目销售额 ${percent(brandCrn)}%，TOP10 卖家占 ${percent(num(research.top10SellerCrn)) ?? '—'}%。`,
        '头部垄断的类目里，正面拼品牌与价格很难赢；优先找细分人群、差异化规格或长尾关键词切入。',
        [`TOP10 品牌集中度 ${percent(brandCrn)}%`, `类目在售商品 ${num(research.totalProducts) ?? '—'} 个`]
      )
    )
  } else if (brandCrn !== null && brandCrn <= 0.4) {
    items.push(
      finding(
        'info',
        '类目品牌集中度低（相对分散）',
        `TOP10 品牌仅占类目销售额 ${percent(brandCrn)}%。`,
        '分散类目对新进入者更友好，重点转向差异化与关键词覆盖效率。',
        [`TOP10 品牌集中度 ${percent(brandCrn)}%`]
      )
    )
  }

  // 新品机会：格局是否固化
  const newPct = percent(num(research.l12NewRatio))
  if (newPct !== null) {
    if (newPct <= 5) {
      items.push(
        finding(
          'low',
          '类目新品占比低（格局偏固化）',
          `近 12 个月上架的新品只占 ${newPct}%（${num(research.l12NewCount) ?? '—'} 个）。`,
          '新品难起量的类目，进入前先确认有明确差异化；否则容易投入广告也拉不动自然排名。',
          [`近 12 个月新品占比 ${newPct}%`]
        )
      )
    } else if (newPct >= 15) {
      items.push(
        finding(
          'info',
          '类目新品活跃（有机会窗口）',
          `近 12 个月上架的新品占 ${newPct}%（${num(research.l12NewCount) ?? '—'} 个）。`,
          '新品能起量的类目对新进入者更友好，重点看新品均价与评分数门槛（见下方新品结构表）。',
          [`近 12 个月新品占比 ${newPct}%`]
        )
      )
    }
  }

  // 价格与利润空间
  const avgPrice = num(research.avgPrice)
  const avgProfit = num(research.avgProfit)
  if (avgPrice !== null) {
    items.push(
      finding(
        'info',
        '价格与利润空间',
        `类目均价 ${round(avgPrice, 2)} 美元，平均利润率 ${avgProfit !== null ? `${round(avgProfit, 1)}%` : '—'}，退货率 ${percent(num(research.returnRatio)) ?? '—'}%。`,
        '定价落点参考下方价格带分布：销量集中在哪个区间，就把主推款放在那个区间，而不是按自己的成本倒推。',
        [
          `均价 ${round(avgPrice, 2)}`,
          `平均利润率 ${avgProfit !== null ? `${round(avgProfit, 1)}%` : '—'}`,
          `退货率 ${percent(num(research.returnRatio)) ?? '—'}%`,
        ]
      )
    )
  }

  const level = items.reduce(
    (worst, item) => (WEIGHT[item.level] > WEIGHT[worst] ? item.level : worst),
    'info'
  )
  return { items, level }
}

/**
 * 市场调研：**以类目为单位**回答"这个类目值不值得进"。
 *
 * 为什么独立于竞品分析（用户 2026-09-16 拍板分页，见 `docs/modules/产品开发.md`）：
 * - **输入不同**：这里输入的是类目（先按关键词搜节点），竞品分析输入的是 ASIN 列表；
 * - **分析对象不同**：市场结构不是任何一个 ASIN 的属性 —— 竞品 ASIN 可以是任意类目的商品，
 *   把"我所在类目的结构"和"跨类目的竞品对比"放在一页，很容易被读成同一个市场；
 * - **时机不同**：选品阶段往往**还没有 ASIN**，而竞品分析面向已有 listing 的运营优化。
 *
 * 归属：本文件属**产品开发模块**（选品调研的业务流程），数据由卖家精灵公开数据层提供。
 * 与竞品分析共用同一个采集层与缓存表（`competitor_public_cache`），额度天然去重。
 */
import { round } from './ai-agent/analytics.mjs'
import {
  CATEGORY_SEARCH_CALLS,
  DEFAULT_TTL_HOURS,
  MARKET_CALLS,
  SellerspriteConfigError,
  estimateMarketCalls,
  parseTtlHours,
} from './sellersprite-config.mjs'

/** 输入不合法 → 400。 */
export class MarketResearchError extends Error {}

const MARKETPLACE_PATTERN = /^[A-Z]{2}$/
/** 类目节点路径形如 `3760901:15342811:23700319011:15342981`（冒号分隔的数字链）。 */
const NODE_PATH_PATTERN = /^\d+(:\d+)*$/

export function parseMarketInput(body = {}) {
  const marketplace = String(body?.marketplace ?? 'US').trim().toUpperCase()
  if (!MARKETPLACE_PATTERN.test(marketplace)) {
    throw new MarketResearchError('站点需为两位站点代码（例如 US、UK、DE、JP）。')
  }
  const nodeIdPath = String(body?.nodeIdPath ?? '').trim()
  if (!nodeIdPath) throw new MarketResearchError('请先选择要调研的类目。')
  if (!NODE_PATH_PATTERN.test(nodeIdPath)) {
    throw new MarketResearchError('类目节点参数无效，请重新搜索类目后选择。')
  }
  const nodeLabel = body?.nodeLabel ? String(body.nodeLabel).trim().slice(0, 300) : null
  return {
    marketplace,
    nodeIdPath,
    nodeLabel,
    ttlHours: parseTtlHours(body?.publicTtlHours),
    force: body?.refresh === true,
  }
}

/** 关键词搜索校验（与 `product_node` 的入参对齐）。 */
export function parseCategoryQuery(query = {}) {
  const keyword = String(query?.keyword ?? '').trim()
  if (!keyword) throw new MarketResearchError('请输入类目关键词（例如 toilet paper、yoga mat）。')
  if (keyword.length > 60) throw new MarketResearchError('类目关键词最多 60 个字符。')
  const marketplace = String(query?.marketplace ?? 'US').trim().toUpperCase()
  if (!MARKETPLACE_PATTERN.test(marketplace)) {
    throw new MarketResearchError('站点需为两位站点代码（例如 US、UK、DE、JP）。')
  }
  return { keyword, marketplace }
}

/** 一句话结论：规模 + 集中度 + 新品窗口，全部取自已算出的数字。 */
export function buildMarketHeadline({ market, findings = [] }) {
  const research = market?.research ?? null
  const label = market?.nodeLabelLocale ?? market?.nodeLabel ?? '该类目'
  if (!research) return `${label}：卖家精灵没有返回该节点的市场数据。`
  const parts = []
  if (typeof research.totalUnits === 'number') {
    parts.push(`月销量约 ${research.totalUnits.toLocaleString('zh-CN')} 件`)
  }
  if (typeof research.top10BrandCrn === 'number') {
    parts.push(`TOP10 品牌集中度 ${round(research.top10BrandCrn * 100, 1)}%`)
  }
  if (typeof research.l12NewRatio === 'number') {
    parts.push(`近 12 个月新品占比 ${round(research.l12NewRatio * 100, 1)}%`)
  }
  const top = findings.find((item) => item.level === 'medium' || item.level === 'low')
  return `${label}：${parts.join('，')}。${top ? top.title + '。' : ''}`
}

/** 类目搜索（市场调研的"第一步"）：先用关键词换到类目节点，才谈得上分析。 */
export async function searchMarketCategories({ keyword, marketplace, ttlHours = DEFAULT_TTL_HOURS, force = false }) {
  const { searchCategories } = await import('./sellersprite-public.mjs')
  const result = await searchCategories({ keyword, marketplace, ttlHours, force })
  return {
    keyword: result.keyword,
    marketplace: result.marketplace,
    categories: result.categories,
    meta: {
      calls: result.meta.calls,
      cacheHits: result.meta.cacheHits,
      estimatedCalls: CATEGORY_SEARCH_CALLS,
      ttlHours: result.meta.ttlHours,
    },
  }
}

/**
 * 类目市场分析：固定两次外部调用（市场规模 + 价格带分布），失败逐项降级。
 *
 * `topAsins` 供页面做"把该市场 TOP 商品带到竞品分析"的联动 —— 这是分页之后
 * 两个模块之间唯一需要传递的东西，比原先"从本品蹭类目"顺得多。
 */
export async function analyzeMarket(input = {}) {
  const parsed = parseMarketInput(input)
  const { collectMarketData } = await import('./sellersprite-public.mjs')
  const { buildMarketBlocks, buildMarketFindings } = await import('./sellersprite-blocks.mjs')

  const market = await collectMarketData({
    marketplace: parsed.marketplace,
    nodeIdPath: parsed.nodeIdPath,
    nodeLabel: parsed.nodeLabel,
    ttlHours: parsed.ttlHours,
    force: parsed.force,
  })

  const blocks = buildMarketBlocks(market)
  const findings = buildMarketFindings(market)
  const topAsins = Array.isArray(market?.research?.top10Images)
    ? market.research.top10Images.map((item) => item?.asin).filter(Boolean).slice(0, 5)
    : []

  return {
    marketplace: parsed.marketplace,
    nodeIdPath: parsed.nodeIdPath,
    nodeLabel: market.nodeLabel ?? parsed.nodeLabel,
    nodeLabelLocale: market.nodeLabelLocale ?? null,
    headline: buildMarketHeadline({ market, findings: findings.items }),
    findings: findings.items,
    findingLevel: findings.level,
    blocks,
    market: {
      nodeIdPath: market.nodeIdPath,
      nodeLabel: market.nodeLabel,
      nodeLabelLocale: market.nodeLabelLocale,
      research: market.research,
      priceDistribution: market.priceDistribution,
    },
    topAsins,
    meta: {
      calls: market.meta.calls,
      cacheHits: market.meta.cacheHits,
      errors: market.meta.errors,
      ttlHours: market.meta.ttlHours,
      estimatedCalls: estimateMarketCalls(),
      marketCalls: MARKET_CALLS,
      fetchedAt: new Date().toISOString(),
    },
  }
}

/** 供路由把配置类错误统一映射成 400。 */
export function isMarketInputError(error) {
  return error instanceof MarketResearchError || error instanceof SellerspriteConfigError
}

/**
 * 竞品公开数据采集（卖家精灵 MCP）。
 *
 * 背景：本项目本地的四个数据集（广告日报 / 业务报告 / 库存快照 / 订单快照）**只包含本公司导入的报表**，
 * 第三方竞品 ASIN 在里面查不到任何记录 —— 这正是「竞品分析」此前名不副实的原因。
 * 卖家精灵 MCP 提供**任意 ASIN 的公开数据**（价格、评分、BSR、月销量趋势、流量词、评论、类目市场），
 * 本模块负责把它取回来、缓存住、并交给展现层整形。
 *
 * 三条必须守住的边界：
 * 1. **额度**：卖家精灵按 HTTP 请求次数计费（月付档普遍 1000–4000 次/月），
 *    因此一切外部调用都要过缓存（默认 24h），并且**限制并发**（实测限流 40 次/分钟）；
 * 2. **口径**：卖家精灵是**第三方估算数据**，与自家报表的真实经营数据不是一回事，
 *    两者在展示与结论里必须分开标注，禁止混算（例如不能把卖家精灵的月销量与自家报表销量相加）；
 * 3. **失败要隔离**：任一维度失败只记入 `errors`，不能让整次分析失败 ——
 *    本地报表那部分（本品的真实经营数据）永远要出得来。
 */
import { query } from './db.mjs'
import { loadSettings } from './ai-agent/knowledge.mjs'
import { executeMcpTool } from './ai-agent/mcp.mjs'
import { McpError, MCP_ERROR_KIND, extractText } from './ai-agent/mcp-client.mjs'
import {
  CATEGORY_SEARCH_SIZE,
  DEFAULT_DIMENSIONS,
  DEFAULT_TTL_HOURS,
  SellerspriteConfigError,
} from './sellersprite-config.mjs'

/**
 * 配置层（维度白名单、参数校验、额度预估）住在 `sellersprite-config.mjs`（零依赖），
 * 这里**原样转发**，调用方既可以只引 config、也可以从本文件一并取用。
 */
export {
  CATEGORY_SEARCH_CALLS,
  CATEGORY_SEARCH_SIZE,
  CompetitorPublicError,
  DEFAULT_DIMENSIONS,
  DEFAULT_TTL_HOURS,
  DIMENSION_CALLS_PER_ASIN,
  DIMENSION_LABELS,
  MARKET_CALLS,
  MAX_TTL_HOURS,
  MIN_TTL_HOURS,
  PUBLIC_DIMENSIONS,
  SellerspriteConfigError,
  TREND_MONTHS,
  estimateCalls,
  estimateMarketCalls,
  parseDimensions,
  parseTtlHours,
} from './sellersprite-config.mjs'

/** 差评取样条数：够做词频统计即可，拉全量评论要翻页、纯属浪费额度。 */
const REVIEW_SAMPLE_SIZE = 50
/** 流量词取样条数。 */
const KEYWORD_SAMPLE_SIZE = 50

/**
 * 卖家精灵实测限流是 40 次/分钟，且是对**单密钥**的。
 * 并发控制在 4，既不至于排太久，也不会把限流打满。
 */
const MAX_CONCURRENT_CALLS = 4

/* ---------- 缓存 ---------- */

export function cacheKeyOf({ kind, asin = null, marketplace, scope = null }) {
  return `${kind}:${scope ?? asin ?? '-'}:${marketplace}`
}

/** 读缓存；过期也算未命中（但把过期时间带出去，便于排障）。 */
export async function readCache(key, now = new Date()) {
  const { rows } = await query(
    `SELECT payload, fetched_at, expires_at FROM competitor_public_cache WHERE cache_key = $1`,
    [key]
  )
  const row = rows[0]
  if (!row) return { hit: false, payload: null, fetchedAt: null }
  const expires = new Date(row.expires_at)
  if (Number.isNaN(expires.getTime()) || expires.getTime() <= now.getTime()) {
    return { hit: false, payload: null, fetchedAt: row.fetched_at ?? null, expired: true }
  }
  return { hit: true, payload: row.payload, fetchedAt: row.fetched_at ?? null }
}

export async function writeCache({
  key,
  kind,
  asin = null,
  marketplace,
  payload,
  ttlHours = DEFAULT_TTL_HOURS,
}) {
  await query(
    `INSERT INTO competitor_public_cache (cache_key, kind, asin, marketplace, payload, fetched_at, expires_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW() + ($6 || ' hours')::interval)
     ON CONFLICT (cache_key) DO UPDATE
       SET payload = EXCLUDED.payload,
           kind = EXCLUDED.kind,
           asin = EXCLUDED.asin,
           fetched_at = NOW(),
           expires_at = EXCLUDED.expires_at`,
    [key, kind, asin, marketplace, JSON.stringify(payload ?? null), String(ttlHours)]
  )
}

/** 清理过期缓存（由分析入口顺带调用，避免表无限增长）。 */
export async function pruneExpiredCache() {
  await query('DELETE FROM competitor_public_cache WHERE expires_at < NOW()')
}

/* ---------- 外部调用 ---------- */

/**
 * 调一次卖家精灵工具并解出 `data`。
 *
 * 卖家精灵失败时**不置 isError**，而是回 `{code:'ERROR_xxx',message}` ——
 * 这里必须显式判掉，否则会把错误当数据缓存起来（一存就是 24 小时）。
 */
async function callRemote({ settings, remoteName, params, timeoutMs }) {
  const result = await executeMcpTool({
    row: settings,
    remoteName,
    params,
    ...(timeoutMs ? { timeoutMs } : {}),
  })
  const text = extractText(result)
  if (!text) {
    throw new McpError(`卖家精灵工具 ${remoteName} 未返回内容。`, { kind: MCP_ERROR_KIND.server })
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new McpError(`卖家精灵工具 ${remoteName} 返回的不是 JSON。`, {
      kind: MCP_ERROR_KIND.protocol,
    })
  }
  const code = typeof parsed?.code === 'string' ? parsed.code.toUpperCase() : ''
  if (code && code !== 'OK' && code.startsWith('ERROR_')) {
    throw new McpError(`卖家精灵工具 ${remoteName} 返回错误：${parsed.message ?? code}`, {
      kind: MCP_ERROR_KIND.server,
    })
  }
  return parsed?.data ?? parsed
}

/** 取数（缓存优先）。命中缓存不消耗额度，因此把统计放在这里。 */
async function fetchCached({
  settings,
  kind,
  cacheKey,
  asin = null,
  marketplace,
  ttlHours,
  force,
  stats,
  loader,
}) {
  if (!force) {
    const cached = await readCache(cacheKey)
    if (cached.hit) {
      stats.cacheHits += 1
      return cached.payload
    }
  }
  stats.calls += 1
  const payload = await loader()
  await writeCache({ key: cacheKey, kind, asin, marketplace, payload, ttlHours })
  return payload
}

/** 并发池：卖家精灵限流 40 次/分钟，一次分析几十个请求必须排队而不是一次打出去。 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return results
}

/**
 * 采集本次分析需要的公开数据。
 *
 * 返回结构（每个 ASIN 维度独立，失败为 null 并记入 meta.errors）：
 * `{ details, trends, keywords, reviews, market, meta }`
 */
export async function collectPublicData({
  asins = [],
  primaryAsin = null,
  marketplace,
  dimensions = DEFAULT_DIMENSIONS,
  ttlHours = DEFAULT_TTL_HOURS,
  force = false,
  settings = null,
} = {}) {
  const list = [...new Set((asins ?? []).filter(Boolean))]
  const primary = primaryAsin && list.includes(primaryAsin) ? primaryAsin : list[0] ?? null
  const stats = { calls: 0, cacheHits: 0, errors: [] }
  const result = {
    details: {},
    trends: {},
    keywords: {},
    reviews: {},
    meta: {
      dimensions,
      ttlHours,
      calls: 0,
      cacheHits: 0,
      errors: [],
      primaryAsin: primary,
      marketplace,
    },
  }
  if (list.length === 0 || dimensions.length === 0) {
    return result
  }

  let row = settings
  if (!row) {
    // 读配置都可能失败（数据库抖动 / 环境变量缺失）：那也不该让整次分析失败，
    // 本地报表那部分结论必须照常给出。
    try {
      row = await loadSettings()
    } catch (error) {
      result.meta.errors.push({
        dimension: 'public',
        asin: null,
        message: `读取卖家精灵 MCP 配置失败：${error instanceof Error ? error.message : String(error)}`,
      })
      return result
    }
  }
  const ctx = { settings: row, marketplace, ttlHours, force, stats }

  const needDetail = dimensions.includes('public')

  const guard = async (dimension, asin, worker) => {
    try {
      return await worker()
    } catch (error) {
      stats.errors.push({
        dimension,
        asin,
        message: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
      })
      return null
    }
  }

  // ── 1. 商品详情（public 与 market 都要：market 依赖 detail 里的 nodeIdPath）──
  if (needDetail) {
    const details = await mapLimit(list, MAX_CONCURRENT_CALLS, (asin) =>
      guard('public', asin, () =>
        fetchCached({
          ...ctx,
          kind: 'detail',
          cacheKey: cacheKeyOf({ kind: 'detail', asin, marketplace }),
          asin,
          loader: () => callRemote({
            settings: row,
            remoteName: 'asin_detail',
            params: { asin, marketplace },
          }),
        })
      )
    )
    list.forEach((asin, index) => {
      result.details[asin] = details[index] ?? null
    })
  }

  // ── 2. 销量趋势 + 流量词 + 评论（都是按 ASIN 并发）──
  const asinTasks = []
  if (dimensions.includes('public')) {
    for (const asin of list) asinTasks.push({ asin, kind: 'trend' })
  }
  if (dimensions.includes('traffic')) {
    for (const asin of list) asinTasks.push({ asin, kind: 'keyword' })
  }
  if (dimensions.includes('reviews')) {
    for (const asin of list) asinTasks.push({ asin, kind: 'review' })
  }

  await mapLimit(asinTasks, MAX_CONCURRENT_CALLS, async ({ asin, kind }) => {
    if (kind === 'trend') {
      const data = await guard('public', asin, () =>
        fetchCached({
          ...ctx,
          kind: 'trend',
          cacheKey: cacheKeyOf({ kind: 'trend', asin, marketplace }),
          asin,
          loader: () => callRemote({
            settings: row,
            remoteName: 'asin_sales_trend',
            params: { asin, marketplace },
          }),
        })
      )
      result.trends[asin] = data?.salesTrendPoints ?? null
      return
    }
    if (kind === 'keyword') {
      const data = await guard('traffic', asin, () =>
        fetchCached({
          ...ctx,
          kind: 'keyword',
          cacheKey: cacheKeyOf({ kind: 'keyword', asin, marketplace }),
          asin,
          loader: () => callRemote({
            settings: row,
            remoteName: 'traffic_keyword',
            params: { request: { asin, marketplace, size: KEYWORD_SAMPLE_SIZE } },
          }),
        })
      )
      result.keywords[asin] = data ?? null
      return
    }
    const data = await guard('reviews', asin, () =>
      fetchCached({
        ...ctx,
        kind: 'review',
        cacheKey: cacheKeyOf({ kind: 'review', asin, marketplace }),
        asin,
        loader: () => callRemote({
          settings: row,
          remoteName: 'review',
          // 只取 1-2 星差评：本板块的用途是找"对方软肋"，好评没有信息量
          params: { asin, marketplace, page: 1, size: REVIEW_SAMPLE_SIZE, starList: [1, 2] },
        }),
      })
    )
    result.reviews[asin] = data ?? null
  })

  result.meta.calls = stats.calls
  result.meta.cacheHits = stats.cacheHits
  result.meta.errors = stats.errors
  return result
}

/* ---------- 类目市场（市场调研页专用，与 ASIN 无关） ---------- */

/** 采集层内部的取值辅助（缺失一律 null，不用 0 或空串顶替）。 */
const asText = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null)
const asNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

/**
 * 按关键词搜类目节点。
 *
 * 市场调研的输入是**类目**而不是 ASIN，而卖家精灵的类目分析接口要 `nodeIdPath`，
 * 所以先让用户搜到类目、拿到节点路径。实测 `product_node` 支持 `keyword` + `marketplace`。
 */
export async function searchCategories({
  keyword,
  marketplace,
  ttlHours = DEFAULT_TTL_HOURS,
  force = false,
  settings = null,
} = {}) {
  const text = String(keyword ?? '').trim()
  if (!text) {
    throw new SellerspriteConfigError('请输入类目关键词（例如 toilet paper、yoga mat）。')
  }
  const row = settings ?? (await loadSettings())
  const stats = { calls: 0, cacheHits: 0 }
  const cacheKey = cacheKeyOf({
    kind: 'node',
    scope: `${marketplace}:${text.toLowerCase()}`,
    marketplace,
  })
  const data = await fetchCached({
    settings: row,
    kind: 'node',
    cacheKey,
    marketplace,
    ttlHours,
    force,
    stats,
    loader: () =>
      callRemote({
        settings: row,
        remoteName: 'product_node',
        params: { request: { keyword: text, marketplace, size: CATEGORY_SEARCH_SIZE } },
      }),
  })

  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : []
  const categories = items
    .map((item) => ({
      nodeIdPath: asText(item?.nodeIdPath),
      nodeId: asNumber(item?.nodeId),
      label: asText(item?.nodeLabelPathLocale) ?? asText(item?.nodeLabelPath),
      labelEn: asText(item?.nodeLabelPath),
      products: asNumber(item?.products),
    }))
    .filter((item) => item.nodeIdPath && item.label)

  return { keyword: text, marketplace, categories, meta: { ...stats, ttlHours } }
}

/**
 * 类目市场结构（规模 / 集中度 / 价格带 / 新品）。
 *
 * 与竞品分析里的"竞品对比"是**两件事**：这里不看任何单个 ASIN，只看这个类目本身值不值得进。
 * 固定两次调用（`market_research` + `market_price_distribution`），24 小时缓存与竞品分析共用同一张表。
 */
export async function collectMarketData({
  marketplace,
  nodeIdPath,
  nodeLabel = null,
  ttlHours = DEFAULT_TTL_HOURS,
  force = false,
  settings = null,
} = {}) {
  const scope = `${marketplace}:${nodeIdPath}`
  const row = settings ?? (await loadSettings())
  const stats = { calls: 0, cacheHits: 0, errors: [] }
  const base = { settings: row, marketplace, ttlHours, force, stats }
  const guard = async (label, worker) => {
    try {
      return await worker()
    } catch (error) {
      stats.errors.push({
        dimension: 'market',
        asin: null,
        message: `${label}：${error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160)}`,
      })
      return null
    }
  }

  const [research, priceDistribution] = await Promise.all([
    guard('市场规模', () =>
      fetchCached({
        ...base,
        kind: 'market',
        cacheKey: cacheKeyOf({ kind: 'market', scope, marketplace }),
        loader: () =>
          callRemote({
            settings: row,
            remoteName: 'market_research',
            params: { request: { marketplace, nodeIdPath, size: 1 } },
          }),
      })
    ),
    guard('价格带分布', () =>
      fetchCached({
        ...base,
        kind: 'price',
        cacheKey: cacheKeyOf({ kind: 'price', scope, marketplace }),
        loader: () =>
          callRemote({
            settings: row,
            remoteName: 'market_price_distribution',
            params: { request: { marketplace, nodeIdPath } },
          }),
      })
    ),
  ])

  const item = Array.isArray(research?.items) ? research.items[0] ?? null : research?.items ?? null
  return {
    nodeIdPath,
    nodeLabel: item?.nodeLabelPath ?? nodeLabel,
    nodeLabelLocale: item?.nodeLabelPathLocale ?? null,
    research: item,
    priceDistribution: Array.isArray(priceDistribution) ? priceDistribution : null,
    meta: { calls: stats.calls, cacheHits: stats.cacheHits, errors: stats.errors, ttlHours },
  }
}

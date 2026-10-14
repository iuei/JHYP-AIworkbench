/**
 * 竞品公开数据（卖家精灵）的单测。
 *
 * 样例数据取自 2026-09-16 对真实 ASIN 的实测返回（`B07BGLT25K` 等），
 * 而不是凭想象构造 —— 结构写错的话解析代码会静默输出空表，页面看起来"就是没数据"。
 *
 * 重点覆盖三类容易出错的地方：
 * 1. **缺失不能变成 0**：卖家精灵对部分 ASIN 没有收录（价格/BSR/评分全为 null），
 *    显示成 0 会直接误导决策；
 * 2. **结论只在命中时产出**：没有数据就不给建议，不编评语；
 * 3. **额度预估与缓存键**：调用次数估错或者缓存键碰撞，都会让账单与数据对不上。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_DIMENSIONS,
  cacheKeyOf,
  estimateCalls,
  estimateMarketCalls,
  parseDimensions,
  parseTtlHours,
} from './sellersprite-public.mjs'
import {
  buildMarketBlocks,
  buildMarketFindings,
  buildPublicFindings,
  buildPublicProductRows,
  buildReviewBlocks,
  buildTrafficBlocks,
  buildTrendChartBlock,
  extractComplaintTerms,
} from './sellersprite-blocks.mjs'
import { mergeFindings } from './competitor-analysis.mjs'

/** 实测返回（真实 ASIN，字段已按发布场景裁剪）。 */
const SUBJECT_DETAIL = {
  asin: 'B07BGLT25K',
  title: 'Scott ComfortPlus Toilet Paper',
  brand: 'Scott',
  price: 5.68,
  rating: 4.6,
  ratings: 132909,
  reviews: 0,
  bsrRank: 3,
  bsrLabel: 'Health & Household',
  sellers: 2,
  fulfillment: 'AMZ',
  lqs: 100,
  availableDate: 1521302400000, // 2018-03-17
  nodeLabelPath: 'Health & Household:Household Supplies:Toilet Paper',
}
const COMPETITOR_DETAIL = {
  asin: 'B0BB3JGBH5',
  title: 'Quilted Northern Toilet Paper',
  brand: 'Quilted Northern',
  price: 6.98,
  rating: 4.7,
  ratings: 99525,
  bsrRank: 14,
  sellers: 3,
  availableDate: 1679097600000, // 2023-03-18
}
/** 卖家精灵没有收录的 ASIN：除了品牌与上架时间，其余全为 null（实测 B08N5WRWNW 就是这种）。 */
const EMPTY_DETAIL = { asin: 'B08N5WRWNW', brand: 'Apple', availableDate: 1726876800000 }

/* ---------- 参数与额度 ---------- */

test('parseDimensions 默认只开核心维度，并拒绝未知维度', () => {
  assert.deepEqual(parseDimensions(undefined), [...DEFAULT_DIMENSIONS])
  assert.deepEqual(parseDimensions(['public', 'public', 'traffic']), ['public', 'traffic'])
  // 类目市场已迁到「产品开发 → 市场调研」：这里必须明确拒绝，并提示去哪看
  assert.throws(() => parseDimensions(['market']), /市场调研/)
  assert.throws(() => parseDimensions('public'), /必须是数组/)
  assert.throws(() => parseDimensions(['public', 'nope']), /不支持的数据维度/)
})

test('parseTtlHours 限制在 1-168 小时', () => {
  assert.equal(parseTtlHours(undefined), 24)
  assert.equal(parseTtlHours(48), 48)
  assert.throws(() => parseTtlHours(0), /1-168/)
  assert.throws(() => parseTtlHours(999), /1-168/)
})

test('estimateCalls 按维度与 ASIN 数估算调用次数（类目维度与 ASIN 数无关）', () => {
  // 2(详情+趋势) + 1(流量词) + 1(评论) 每个 ASIN；类目市场不在竞品分析里，不计入
  assert.equal(estimateCalls(['public'], 5), 10)
  assert.equal(estimateCalls(['public', 'traffic', 'reviews'], 3), 12)
  assert.equal(estimateCalls(['public', 'traffic', 'reviews'], 5), 20)
  assert.equal(estimateCalls([], 5), 0)
  // 市场调研是另一条链路：类目搜索 1 次 + 市场结构 2 次，与 ASIN 数无关
  assert.equal(estimateMarketCalls(), 2)
  assert.equal(estimateMarketCalls({ withSearch: true }), 3)
})

test('cacheKeyOf 区分维度与作用域（类目维度用 nodeIdPath 而不是 ASIN）', () => {
  assert.equal(cacheKeyOf({ kind: 'detail', asin: 'B07', marketplace: 'US' }), 'detail:B07:US')
  assert.equal(
    cacheKeyOf({ kind: 'market', scope: 'US:3760901:15342811', marketplace: 'US' }),
    'market:US:3760901:15342811:US'
  )
})

/* ---------- 商品行 ---------- */

test('buildPublicProductRows 缺失字段保持 null（绝不填 0），并算出上架天数', () => {
  const now = new Date('2026-09-16T00:00:00Z')
  const rows = buildPublicProductRows({
    details: { B07BGLT25K: SUBJECT_DETAIL, B0BB3JGBH5: COMPETITOR_DETAIL, B08N5WRWNW: EMPTY_DETAIL },
    asins: ['B07BGLT25K', 'B0BB3JGBH5', 'B08N5WRWNW'],
    primaryAsin: 'B07BGLT25K',
    now,
  })

  assert.equal(rows[0].role, 'subject')
  assert.equal(rows[0].price, 5.68)
  assert.equal(rows[0].availableDate, '2018-03-17')
  assert.ok(rows[0].listedDays > 3000)

  // 未收录的 ASIN：不能因为"没有价格"就显示 0
  const empty = rows[2]
  assert.equal(empty.hasData, true, '有 detail 就算有数据（哪怕只回来了品牌）')
  assert.equal(empty.price, null)
  assert.equal(empty.rating, null)
  assert.equal(empty.bsrRank, null)
  assert.equal(empty.brand, 'Apple')

  // 完全没有返回的 ASIN
  const missing = buildPublicProductRows({
    details: {},
    asins: ['B000000000'],
    primaryAsin: null,
    now,
  })[0]
  assert.equal(missing.hasData, false)
  assert.equal(missing.price, null)
  assert.equal(missing.listedDays, null)
})

/* ---------- 趋势图 ---------- */

test('buildTrendChartBlock 取月份并集并按时间排序（竞品起始月份不同也不能缺段）', () => {
  const block = buildTrendChartBlock({
    trends: {
      A: [
        { month: '2026-06', parentUnitSales: 100 },
        { month: '2026-07', parentUnitSales: 120 },
      ],
      B: [
        { month: '2026-07', parentUnitSales: 80 },
        { month: '2026-08', parentUnitSales: 90 },
      ],
    },
    asins: ['A', 'B'],
    primaryAsin: 'A',
  })
  assert.equal(block.kind, 'chart')
  assert.equal(block.chartType, 'line')
  assert.deepEqual(block.data.map((row) => row.month), ['2026-06', '2026-07', '2026-08'])
  // 缺失的月份是 null（不是 0），折线才不会在缺数据处塌到 0
  assert.equal(block.data[0].B, null)
  assert.equal(block.data[2].A, null)
  assert.match(block.series[0].label, /本品/)
})

test('buildTrendChartBlock 没有任何趋势数据时返回 null（不产出空图）', () => {
  assert.equal(buildTrendChartBlock({ trends: { A: [] }, asins: ['A'] }), null)
  assert.equal(buildTrendChartBlock({ trends: {}, asins: ['A'] }), null)
})

/* ---------- 流量与评论 ---------- */

test('buildTrafficBlocks 统计自然/广告词并输出 TOP 词表', () => {
  const keywords = {
    A: {
      total: 1520,
      items: [
        {
          keyword: 'toilet paper',
          keywordCn: '厕纸',
          searches: 4410118,
          products: 38708,
          purchaseRate: 0.3777,
          bid: 0.9,
          badges: ['naturalSearching', 'amazonChoice'],
          rankPosition: { position: 5 },
          adPosition: { position: 87 },
        },
        { keyword: 'soft tissue', keywordCn: '软纸', searches: 1200, badges: ['sponsorVideo'] },
      ],
    },
  }
  const blocks = buildTrafficBlocks(keywords, ['A'], 'A')
  const metrics = blocks.find((block) => block.kind === 'metrics')
  const table = blocks.find((block) => block.kind === 'table')
  assert.ok(metrics && table)
  const values = Object.fromEntries(metrics.items.map((item) => [item.key, item.value]))
  assert.equal(values['total-A'], 1520)
  assert.equal(values['natural-A'], 1)
  assert.equal(values['ad-A'], 1)
  assert.equal(table.rows.length, 2)
  assert.equal(table.rows[0].badges, '自然搜索、Amazon Choice')
  assert.equal(table.rows[0].purchaseRate, 37.8)
})

test('extractComplaintTerms 过掉停用词与单词，只留出现 ≥2 次的词', () => {
  const items = [
    { title: 'Terrible', content: 'the roll tears easily and the paper is thin' },
    { title: 'Bad', content: 'tears every time, thin paper, the roll is small' },
    { title: 'ok', content: 'fine' },
  ]
  const terms = extractComplaintTerms(items)
  const map = Object.fromEntries(terms.map((term) => [term.term, term.count]))
  assert.equal(map.tears, 2)
  assert.equal(map.thin, 2)
  assert.equal(map.roll, 2)
  assert.equal(map.paper, 2)
  assert.equal(map.the, undefined)
  assert.equal(map.fine, undefined, '只出现一次的词不进榜')
})

test('buildReviewBlocks 输出评论概况与痛点词，无数据时返回空数组', () => {
  const reviews = {
    A: { total: 284, items: [{ star: 1, content: 'thin and tears' }, { star: 2, content: 'thin tears' }] },
  }
  const blocks = buildReviewBlocks(reviews, ['A'], 'A')
  const metrics = blocks.find((block) => block.kind === 'metrics')
  assert.ok(metrics)
  const values = Object.fromEntries(metrics.items.map((item) => [item.key, item.value]))
  assert.equal(values['total-A'], 284)
  assert.equal(values['sample-A'], 2)
  assert.equal(values['avgStar-A'], 1.5)
  // thin 与 tears 各出现 2 次 → 两条痛点词
  assert.equal(blocks.find((block) => block.kind === 'table').rows.length, 2)

  assert.deepEqual(buildReviewBlocks({}, ['A'], 'A'), [])
})

/* ---------- 市场 ---------- */

test('buildMarketBlocks 输出概览指标、集中度、新品结构与价格带', () => {
  const blocks = buildMarketBlocks({
    nodeLabel: 'Toilet Paper',
    nodeLabelLocale: 'Health & Household:Toilet Paper',
    research: {
      totalUnits: 7223697,
      totalRevenue: 156705423.4,
      totalProducts: 1405,
      brands: 29,
      sellers: 28,
      avgPrice: 28.64,
      avgRating: 4.6,
      returnRatio: 0.3474,
      top3BrandCrn: 0.8465,
      top10BrandCrn: 0.9788,
      l12NewRatio: 0.08,
      l12NewCount: 8,
    },
    priceDistribution: [
      { label: '5-10', products: 22, units: 1937098, revenue: 13580460.87, unitsRatio: 0.2713 },
    ],
  })
  const titles = blocks.map((block) => block.title)
  assert.ok(titles.some((title) => title.includes('类目市场概览')))
  assert.ok(titles.includes('市场集中度（销售额占比 %）'))
  assert.ok(titles.includes('新品结构（近 1/3/6/12 个月上架）'))
  assert.ok(titles.includes('价格带分布（卖家精灵）'))

  const metrics = blocks.find((block) => block.kind === 'metrics')
  const values = Object.fromEntries(metrics.items.map((item) => [item.key, item.value]))
  // 比例字段实测是小数，必须转成百分比展示
  assert.equal(values.returnRatio, 34.7)
  assert.equal(values.totalUnits, 7223697)
})

test('buildMarketBlocks 在没有市场数据时返回空数组（不产出空卡片）', () => {
  assert.deepEqual(buildMarketBlocks(null), [])
  assert.deepEqual(buildMarketBlocks({ research: null, priceDistribution: null }), [])
})

/* ---------- 结论 ---------- */

test('buildPublicFindings 命中价格/评分/评分数差距，并只标记 high 以上才升级', () => {
  const rows = buildPublicProductRows({
    details: { A: SUBJECT_DETAIL, B0BB3JGBH5: COMPETITOR_DETAIL },
    asins: ['A', 'B0BB3JGBH5'],
    primaryAsin: 'A',
    now: new Date('2026-09-16T00:00:00Z'),
  })
  const { items, level } = buildPublicFindings({ productRows: rows })
  const titles = items.map((item) => item.title)
  assert.ok(titles.some((title) => title.includes('定价')))
  assert.ok(titles.some((title) => title.includes('BSR')))
  // 价格差 18.6%（≥10% 且 <25%）→ low；BSR 优于均值 → info；取最严重的一级
  assert.equal(level, 'low')
  // 评分数领先 33%（不到 1.5 倍门槛）与"本品更老"都不应产出结论
  assert.equal(titles.filter((title) => title.includes('评分数')).length, 0)
  for (const item of items) {
    assert.ok(item.evidence.length > 0, `结论「${item.title}」必须带可复算依据`)
  }
})

test('buildPublicFindings 对未收录的本品只给"未收录"提示，不编结论', () => {
  const rows = buildPublicProductRows({
    details: { X: EMPTY_DETAIL },
    asins: ['X'],
    primaryAsin: 'X',
    now: new Date('2026-09-16T00:00:00Z'),
  })
  const { items } = buildPublicFindings({ productRows: rows })
  // 本品有 detail（只有品牌），价格/评分缺失 → 不应产出价格或评分结论
  assert.equal(items.filter((item) => item.title.includes('定价')).length, 0)
})

test('buildPublicFindings 在完全没有公开数据时不产出任何结论', () => {
  const rows = buildPublicProductRows({ details: {}, asins: ['A', 'B'], primaryAsin: 'A' })
  const { items, level } = buildPublicFindings({ productRows: rows })
  assert.equal(level, 'info')
  assert.equal(items.length, 1)
  assert.match(items[0].title, /未收录/)
})

test('buildPublicFindings 显式未请求公开维度时不误报未收录', () => {
  const rows = buildPublicProductRows({ details: {}, asins: ['A'], primaryAsin: 'A' })
  const { items } = buildPublicFindings({
    productRows: rows,
    dimensions: [],
    primaryAsin: 'A',
  })
  assert.deepEqual(items, [])
})

test('buildPublicFindings 公开商品详情缺失时仍可独立生成流量结论', () => {
  const { items } = buildPublicFindings({
    productRows: buildPublicProductRows({ details: {}, asins: ['A'], primaryAsin: 'A' }),
    primaryAsin: 'A',
    dimensions: ['traffic'],
    keywords: {
      A: {
        items: Array.from({ length: 4 }, (_, index) => ({
          keyword: `词${index}`,
          badges: ['sponsored'],
        })),
      },
    },
  })
  assert.ok(items.some((item) => item.title.includes('广告依赖')))
})

test('buildPublicFindings 命中竞品差评痛点（市场结论已迁到 buildMarketFindings）', () => {
  const rows = buildPublicProductRows({
    details: { A: SUBJECT_DETAIL, B: COMPETITOR_DETAIL },
    asins: ['A', 'B'],
    primaryAsin: 'A',
  })
  const { items } = buildPublicFindings({
    productRows: rows,
    reviews: { B: { total: 50, items: [{ star: 1, content: 'thin tears' }, { star: 2, content: 'thin tears again' }] } },
  })
  const titles = items.map((item) => item.title)
  assert.ok(titles.some((title) => title.includes('差评')))
  assert.equal(titles.filter((title) => title.includes('集中度')).length, 0)
})

test('buildMarketFindings 产出市场判断（规模 / 集中度 / 新品 / 价格），无数据时不编结论', () => {
  const { items, level } = buildMarketFindings({
    research: {
      totalUnits: 7223697,
      totalRevenue: 156705423.4,
      totalProducts: 1405,
      brands: 29,
      sellers: 28,
      avgPrice: 28.64,
      avgProfit: 30.73,
      returnRatio: 0.3474,
      top10BrandCrn: 0.9788,
      top10SellerCrn: 0.995,
      l12NewRatio: 0.08,
      l12NewCount: 8,
    },
  })
  const titles = items.map((item) => item.title)
  assert.ok(titles.some((title) => title.includes('规模')))
  assert.ok(titles.some((title) => title.includes('集中度')))
  assert.ok(titles.some((title) => title.includes('价格与利润')))
  assert.equal(level, 'medium')
  for (const item of items) assert.ok(item.evidence.length > 0, '每条市场结论都要带依据')

  assert.deepEqual(buildMarketFindings(null).items, [])
})

/* ---------- 合并 ---------- */

test('mergeFindings 给两组结论打上 scope 并按最严重级别取头', () => {
  const merged = mergeFindings(
    { items: [{ level: 'high', title: '本地问题', detail: '', action: null, evidence: [] }], level: 'high' },
    { items: [{ level: 'info', title: '公开数据提示', detail: '', action: null, evidence: [] }], level: 'info' }
  )
  assert.deepEqual(merged.items.map((item) => item.scope), ['local', 'public'])
  assert.equal(merged.level, 'high')
})

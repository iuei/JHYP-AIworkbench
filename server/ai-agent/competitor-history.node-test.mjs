/**
 * `competitor-history.mjs` 的纯函数单测（不连库）。
 *
 * 连库的那几条路径（取记录、越权过滤、按 ASIN 命中）在 `server/verify-competitor-tool.mjs`
 * 里用真实库跑；这里守住的是**组装规则**：结论排序与转行、关键块挑选（只留横向对比与公开数据）、
 * 以及"凡是要模型说出口的数字都必须进 summary/rows"这条约束。
 *
 * 运行：node --test server/ai-agent/competitor-history.node-test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildListSummary,
  buildRecordSummary,
  comparisonMetricRows,
  findingsRows,
  findingsTableBlock,
  pickKeyBlocks,
  publicMetricRows,
} from './competitor-history.mjs'

const FINDINGS = [
  {
    level: 'medium',
    scope: 'local',
    title: 'ACoS 环比上涨 57.05%',
    detail: 'ACoS 20.44 → 32.1（+57.05%）。',
    action: '优先解决转化端问题。',
    evidence: ['花费效应 5.54 个百分点'],
  },
  {
    level: 'high',
    scope: 'local',
    title: '本品在所选站点与区间内没有数据',
    detail: '没有查到 B0CTJGJL2T（US）的记录。',
    action: '请确认 ASIN、站点与统计区间。',
    evidence: [],
  },
  {
    level: 'low',
    scope: 'public',
    title: '定价低于竞品均值',
    detail: '本品价格 17.99，竞品均值 20.89，低 13.9%。',
    action: null,
    evidence: ['本品 17.99', '竞品均值 20.89'],
  },
]

const COMPARISON_BLOCK = {
  kind: 'table',
  title: 'ASIN 横向对比',
  dataset: 'amazon_ads_daily',
  columns: [
    { key: 'asin', label: 'ASIN' },
    { key: 'roleLabel', label: '角色' },
    { key: 'spend', label: '广告花费' },
    { key: 'sales', label: '广告销售额' },
    { key: 'acos', label: 'ACoS(%)' },
    { key: 'clicks', label: '点击' },
    { key: 'cvr', label: '转化率(%)' },
    { key: 'cpc', label: 'CPC' },
    { key: 'orders', label: '广告订单' },
    { key: 'units', label: '销量' },
  ],
  rows: [
    {
      asin: 'B0SAMPLE01',
      roleLabel: '本品',
      spend: 3855.37,
      sales: 12012.23,
      acos: 32.1,
      clicks: 2969,
      cvr: 9.46,
      cpc: 1.3,
      orders: 281,
      units: 276,
    },
    {
      asin: 'B0SAMPLE02',
      roleLabel: '竞品',
      spend: 2372.58,
      sales: 6606.71,
      acos: 35.91,
      clicks: 2969,
      cvr: null,
      cpc: 0.8,
      orders: 154,
      units: 120,
    },
  ],
}

const PRODUCT_BLOCK = {
  kind: 'table',
  title: '商品公开数据对比（卖家精灵）',
  dataset: 'sellersprite_products',
  columns: [
    { key: 'roleLabel', label: '角色' },
    { key: 'asin', label: 'ASIN' },
    { key: 'brand', label: '品牌' },
    { key: 'price', label: '价格' },
    { key: 'rating', label: '评分' },
    { key: 'ratings', label: '评分数' },
    { key: 'bsrRank', label: 'BSR' },
    { key: 'sellers', label: '卖家数' },
    { key: 'fulfillment', label: '配送' },
    { key: 'availableDate', label: '上架日期' },
  ],
  rows: [
    {
      roleLabel: '本品',
      asin: 'B0SAMPLE01',
      brand: 'GODONLIF',
      price: 17.99,
      rating: 4.6,
      ratings: 106,
      bsrRank: 45,
      sellers: null,
      fulfillment: 'FBA',
      availableDate: '2025-01-01',
    },
  ],
}

const CHART_BLOCK = {
  kind: 'chart',
  title: '月销量趋势对比',
  series: [{ key: 'B0SAMPLE01', label: 'B0SAMPLE01' }],
  data: [{ month: '2026-08', B0SAMPLE01: 12 }],
}

const KEYWORD_BLOCK = {
  kind: 'table',
  title: 'TOP 流量词（含搜索量与竞价）',
  columns: [
    { key: 'role', label: '角色' },
    { key: 'keyword', label: '关键词' },
    { key: 'searches', label: '月搜索量' },
  ],
  rows: [{ role: '本品', keyword: 'candle holder', searches: 107717 }],
}

test('findingsRows：按严重度排序（high → medium → low），并带上来源与依据条数', () => {
  const rows = findingsRows(FINDINGS)
  assert.deepEqual(
    rows.map((row) => row.level),
    ['high', 'medium', 'low']
  )
  assert.equal(rows[0].levelLabel, '需立即处理')
  assert.equal(rows[1].scope, '自家经营数据')
  assert.equal(rows[2].scope, '卖家精灵公开数据')
  // action 为 null 时给空串，模型不会读到 "null"
  assert.equal(rows[2].action, '')
  assert.equal(rows[2].evidenceCount, 2)
})

test('findingsRows：稳定排序（同级保持原顺序），空值不抛错', () => {
  const rows = findingsRows([
    { level: 'medium', title: 'A', detail: '', action: null, evidence: [] },
    { level: 'medium', title: 'B', detail: '', action: null, evidence: [] },
  ])
  assert.deepEqual(
    rows.map((row) => row.title),
    ['A', 'B']
  )
  assert.deepEqual(findingsRows([]), [])
  assert.deepEqual(findingsRows(undefined), [])
})

test('findingsTableBlock：一张可渲染的结论表；没有结论时不产出块', () => {
  const block = findingsTableBlock(FINDINGS)
  assert.equal(block.kind, 'table')
  assert.equal(block.rows.length, 3)
  assert.deepEqual(
    block.columns.map((column) => column.key),
    ['levelLabel', 'scope', 'title', 'detail', 'action']
  )
  assert.match(block.title, /结论与建议（3 条/)
  assert.equal(findingsTableBlock([]), null)
})

test('comparisonMetricRows：按列键认「ASIN 横向对比」，缺列的表不认', () => {
  const rows = comparisonMetricRows([CHART_BLOCK, COMPARISON_BLOCK])
  assert.equal(rows.length, 2)
  assert.equal(rows[0].asin, 'B0SAMPLE01')
  assert.equal(rows[0].role, '本品')
  assert.equal(rows[0].spend, 3855.37)
  // 竞品缺转化率时保持 null，不折算成 0
  assert.equal(rows[1].cvr, null)
  assert.deepEqual(
    comparisonMetricRows([
      {
        kind: 'table',
        columns: [{ key: 'asin', label: 'ASIN' }],
        rows: [{ asin: 'X' }],
      },
    ]),
    []
  )
})

test('publicMetricRows：认商品公开数据块', () => {
  const rows = publicMetricRows([COMPARISON_BLOCK, PRODUCT_BLOCK])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].brand, 'GODONLIF')
  assert.equal(rows[0].price, 17.99)
  assert.deepEqual(publicMetricRows([CHART_BLOCK]), [])
})

test('pickKeyBlocks：只留结论表 + 横向对比 + 公开数据（图表 / 流量词不进回答）', () => {
  const blocks = pickKeyBlocks(
    [CHART_BLOCK, COMPARISON_BLOCK, KEYWORD_BLOCK, PRODUCT_BLOCK],
    FINDINGS
  )
  assert.deepEqual(
    blocks.map((block) => block.title),
    ['结论与建议（3 条，按严重度排序）', 'ASIN 横向对比', '商品公开数据对比（卖家精灵）']
  )
  assert.equal(blocks[0].kind, 'table')
  // 结构化列定义必须原样带过去，渲染层才能按列对齐
  assert.equal(blocks[1].columns.length, 10)
})

test('buildRecordSummary：模型要说出口的数字都在 summary 里', () => {
  const record = {
    id: 78,
    market_place: 'US',
    marketplace: 'US',
    asins: ['B0SAMPLE01', 'B0SAMPLE02'],
    start_date: '2026-08-02',
    end_date: '2026-08-31',
    window_days: 30,
    compare_with: 'previous_period',
    level: 'high',
    finding_count: 3,
    created_at: '2026-09-17T01:20:00.000Z',
  }
  const summary = buildRecordSummary({
    record,
    snapshot: {
      headline: '命中 2 项需要处理的问题。',
      findings: FINDINGS,
      blocks: [COMPARISON_BLOCK, PRODUCT_BLOCK],
    },
  })

  assert.match(summary, /竞品分析记录 #78/)
  assert.match(summary, /B0SAMPLE01、B0SAMPLE02/)
  assert.match(summary, /2026-08-02 ~ 2026-08-31（30 天）/)
  // 「只读、不消耗额度」必须写明，否则模型可能答成"我重新拉了一次"
  assert.match(summary, /不重新取数、不调用卖家精灵、不消耗任何额度/)
  assert.match(summary, /B0SAMPLE01（本品）：广告花费 3855\.37/)
  assert.match(summary, /ACoS 32\.1%/)
  assert.match(summary, /GODONLIF/)
  // 结论明细逐条列出，含判定、事实与建议
  assert.match(summary, /\[需立即处理｜自家经营数据\] 本品在所选站点与区间内没有数据/)
  assert.match(summary, /建议：优先解决转化端问题。/)
  assert.match(summary, /依据 1 条/)
})

test('buildRecordSummary：没有快照时如实说明，并提示重新分析要用户确认', () => {
  const summary = buildRecordSummary({
    record: { id: 12, asins: ['B0X'], marketplace: 'US', level: 'info' },
    snapshot: null,
  })
  assert.match(summary, /没有保存结果快照/)
  assert.match(summary, /需用户在页面上确认/)
})

test('buildListSummary：列最近几次，并告诉用户怎么继续追问', () => {
  const summary = buildListSummary([
    {
      id: 78,
      asins: ['B0SAMPLE01'],
      marketplace: 'US',
      startDate: '2026-08-02',
      endDate: '2026-08-31',
      windowDays: 30,
      level: 'medium',
      findingCount: 3,
      headline: '命中 2 项需要处理的问题。',
      createdAt: '2026-09-17T01:20:00.000Z',
      hasSnapshot: true,
    },
  ])
  assert.match(summary, /#78 · B0SAMPLE01/)
  assert.match(summary, /判定 需关注 · 结论 3 条/)
  assert.match(summary, /请告诉我记录号（例如 #78）或 ASIN/)
})

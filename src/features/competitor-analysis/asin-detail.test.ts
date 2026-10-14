import { describe, expect, it } from 'vitest'
import type { AnswerBlock } from '@/features/ai-agent/types'
import { filterBlocksForAsin, hasAsin, selectAsinDetail } from './asin-detail'
import { PUBLIC_PRODUCT_COLUMN_KEYS } from './product-view'
import type { CompetitorAnalysisResult } from './types'

const PRIMARY = 'B0PRIMARY1'
const COMPETITOR = 'B0COMPETI1'

function makeResult(
  overrides: Partial<CompetitorAnalysisResult> = {}
): CompetitorAnalysisResult {
  return {
    inputType: 'ASIN',
    inputValue: PRIMARY,
    asin: PRIMARY,
    asins: [PRIMARY, COMPETITOR],
    primaryAsin: PRIMARY,
    competitorAsins: [COMPETITOR],
    marketplace: 'US',
    marketplaceSource: 'request',
    startDate: '2026-08-01',
    endDate: '2026-08-30',
    windowDays: 30,
    compareWith: 'previous_period',
    compareLabel: '环比上一等长区间',
    customRange: false,
    empty: false,
    rowCount: 10,
    summary: '',
    headline: '',
    findings: [],
    findingLevel: 'info',
    comparison: {
      enabled: true,
      rows: [
        {
          asin: PRIMARY,
          role: 'subject',
          roleLabel: '本品',
          hasData: true,
          emptyReason: null,
          impressions: 1,
          clicks: 1,
          spend: 1,
          sales: 1,
          orders: 1,
          acos: 1,
          ctr: 1,
          cvr: 1,
          cpc: 1,
          units: 1,
        },
      ],
      summary: {
        enabled: true,
        subject: null,
        competitors: [],
        comparedCount: 1,
        missingCount: 0,
        competitorAverages: {
          spend: null,
          sales: null,
          acos: null,
          cvr: null,
          cpc: null,
        },
        acosRank: { rank: null, total: 0, best: null },
        cvrRank: { rank: null, total: 0, best: null },
      },
      blocks: [],
      note: '',
    },
    inventory: {
      mapped: true,
      asin: PRIMARY,
      marketplace: 'US',
      items: [],
      note: null,
    },
    blocks: [],
    citations: [],
    dataFreshness: null,
    availability: [
      {
        asin: PRIMARY,
        marketplaces: [{ marketplace: 'US', latest: '2026-08-30' }],
        hasData: true,
        latest: '2026-08-30',
        defaultMarketplace: 'US',
      },
    ],
    ...overrides,
  }
}

describe('hasAsin / selectAsinDetail 的归属判断', () => {
  it('大小写不敏感', () => {
    expect(hasAsin(makeResult(), PRIMARY.toLowerCase())).toBe(true)
  })

  it('不属于本次分析（手改 URL）返回 null', () => {
    expect(selectAsinDetail(makeResult(), 'B0NOTMINE01')).toBeNull()
    expect(selectAsinDetail(makeResult(), '')).toBeNull()
  })
})

describe('selectAsinDetail 的商品与自家数据', () => {
  it('取到该 ASIN 的公开属性行与自家对比行', () => {
    const result = makeResult({
      publicData: {
        dimensions: ['public'],
        dimensionLabels: ['商品公开数据'],
        ttlHours: 24,
        estimatedCalls: 4,
        calls: 4,
        cacheHits: 0,
        errors: [],
        rows: [
          {
            asin: COMPETITOR,
            role: 'competitor',
            roleLabel: '竞品',
            hasData: true,
            title: '竞品标题',
            brand: 'BrandX',
            price: 19.99,
            rating: 4.3,
            ratings: 1200,
            bsrRank: 800,
            bsrLabel: 'Kitchen',
            sellers: 3,
            fulfillment: 'FBA',
            lqs: 80,
            nodeLabelPath: 'Home:Kitchen',
            imageUrl: 'https://example.com/a.jpg',
            availableDate: '2025-01-01',
            listedDays: 600,
          },
        ],
        productCount: 1,
        fetchedAt: '2026-09-16T00:00:00.000Z',
      },
    })
    const detail = selectAsinDetail(result, COMPETITOR)
    expect(detail?.role).toBe('competitor')
    expect(detail?.roleLabel).toBe('竞品')
    expect(detail?.product?.imageUrl).toBe('https://example.com/a.jpg')
    // 竞品不在自家报表里：对比行不存在，库存也不该给
    expect(detail?.comparison).toBeNull()
    expect(detail?.inventory).toBeNull()
  })

  it('本品时才带库存与店铺可用性', () => {
    const detail = selectAsinDetail(makeResult(), PRIMARY)
    expect(detail?.role).toBe('subject')
    expect(detail?.inventory?.mapped).toBe(true)
    expect(detail?.availability?.defaultMarketplace).toBe('US')
  })

  it('没勾选公开数据维度时 product 为 null（卡片无图但不炸）', () => {
    const detail = selectAsinDetail(makeResult(), PRIMARY)
    expect(detail?.product).toBeNull()
  })
})

describe('filterBlocksForAsin', () => {
  const trafficTable: AnswerBlock = {
    kind: 'table',
    title: 'TOP 流量词（含搜索量与竞价）',
    columns: [
      { key: 'role', label: '角色' },
      { key: 'asin', label: 'ASIN' },
      { key: 'keyword', label: '关键词' },
    ],
    rows: [
      { role: '本品', asin: PRIMARY, keyword: 'blender' },
      { role: '竞品', asin: COMPETITOR, keyword: 'mixer' },
      { role: '竞品', asin: COMPETITOR, keyword: 'juicer' },
    ],
    totalRows: 3,
    truncated: true,
  }

  const trendChart: AnswerBlock = {
    kind: 'chart',
    title: '月销量趋势对比',
    chartType: 'line',
    xKey: 'month',
    series: [
      { key: PRIMARY, label: `${PRIMARY}（本品）` },
      { key: COMPETITOR, label: COMPETITOR },
    ],
    data: [
      { month: '2026-07', [PRIMARY]: 100, [COMPETITOR]: 200 },
      { month: '2026-08', [PRIMARY]: 110, [COMPETITOR]: 210 },
    ],
  }

  const structureMetrics: AnswerBlock = {
    kind: 'metrics',
    title: '流量结构（按流量词标记统计）',
    items: [
      { key: `total-${PRIMARY}`, label: '本品 流量词总数', value: 120 },
      { key: `total-${COMPETITOR}`, label: '竞品 流量词总数', value: 90 },
    ],
  }

  const groupMetrics: AnswerBlock = {
    kind: 'metrics',
    title: '期间汇总',
    items: [{ key: 'spend', label: '广告花费', value: 100 }],
  }

  it('表格按行里的 asin 过滤，并去掉不再有信息量的 asin 列', () => {
    const [table] = filterBlocksForAsin([trafficTable], COMPETITOR)
    expect(table.rows).toHaveLength(2)
    expect(table.rows?.every((row) => row.asin === COMPETITOR)).toBe(true)
    expect(table.columns?.some((column) => column.key === 'asin')).toBe(false)
    // 截断标记要跟着收敛后的行数走，否则界面会写"共 3 条（已截断）"
    expect(table.totalRows).toBe(2)
    expect(table.truncated).toBe(false)
  })

  it('趋势图只留该 ASIN 的序列与列，且沿用服务端原本的列名', () => {
    const [chart] = filterBlocksForAsin([trendChart], COMPETITOR)
    expect(chart.series).toHaveLength(1)
    expect(chart.series?.[0].key).toBe(COMPETITOR)
    expect(chart.series?.[0].label).toContain(COMPETITOR)
    expect(chart.data).toEqual([
      { month: '2026-07', [COMPETITOR]: 200 },
      { month: '2026-08', [COMPETITOR]: 210 },
    ])
  })

  it('指标按 key 里的 ASIN 后缀过滤（流量结构 / 评论概况）', () => {
    const [metricsBlock] = filterBlocksForAsin([structureMetrics], PRIMARY)
    expect(metricsBlock.items).toHaveLength(1)
    expect(metricsBlock.items?.[0].value).toBe(120)
  })

  it('组级块（不带 ASIN 标识）不进详情页', () => {
    expect(filterBlocksForAsin([groupMetrics], PRIMARY)).toEqual([])
    expect(
      filterBlocksForAsin(
        [{ kind: 'metrics', title: '公开口径对比', items: [] }],
        PRIMARY
      )
    ).toEqual([])
  })

  it('「商品公开数据对比」表不进详情页（概览卡已逐项列出，避免同一份数据渲染两遍）', () => {
    const productTable: AnswerBlock = {
      kind: 'table',
      title: '商品公开数据对比（卖家精灵）',
      dataset: 'sellersprite_products',
      columns: PUBLIC_PRODUCT_COLUMN_KEYS.map((key) => ({ key, label: key })),
      rows: [{ asin: PRIMARY, roleLabel: '本品', price: 29.99 }],
    }
    expect(filterBlocksForAsin([productTable], PRIMARY)).toEqual([])
  })

  it('过滤后为空的块被丢弃，顺序保持不变', () => {
    const kept = filterBlocksForAsin(
      [trafficTable, structureMetrics, groupMetrics],
      COMPETITOR
    )
    expect(kept.map((block) => block.title)).toEqual([
      trafficTable.title,
      structureMetrics.title,
    ])
  })
})

describe('selectAsinDetail 的结论归属', () => {
  it('优先使用结构化 targetAsins，不依赖标题或证据是否包含 ASIN', () => {
    const result = makeResult({
      findings: [
        {
          level: 'high',
          title: 'ACoS 高于预警线',
          detail: '转化率需要处理。',
          action: null,
          evidence: ['ACoS 48%'],
          targetAsins: [PRIMARY],
          scope: 'local',
        },
      ],
    })
    expect(selectAsinDetail(result, PRIMARY)?.findings).toHaveLength(1)
    expect(selectAsinDetail(result, COMPETITOR)?.findings).toHaveLength(0)
  })

  it('只保留证据里点名到该 ASIN 的结论，且按词边界匹配', () => {
    const result = makeResult({
      findings: [
        {
          level: 'medium',
          title: '竞品差评集中在漏水',
          detail: '取样差评高频词为 leak。',
          action: null,
          evidence: [`${COMPETITOR} 取样差评 20 条`],
          scope: 'public',
        },
        {
          level: 'info',
          title: '组级结论',
          detail: '本品价格高于竞品均值。',
          action: null,
          evidence: ['本品 29.99 vs 竞品均值 19.99'],
          scope: 'public',
        },
        {
          level: 'low',
          title: '相似 ASIN 的结论',
          detail: '不属于本次分析。',
          action: null,
          // 该 ASIN 是本 ASIN 的前缀 + 一个字符：词边界必须挡住它
          evidence: [`${COMPETITOR}9 的价格更低`],
          scope: 'public',
        },
      ],
    })
    const detail = selectAsinDetail(result, COMPETITOR)
    expect(detail?.findings.map((finding) => finding.title)).toEqual([
      '竞品差评集中在漏水',
    ])
  })
})

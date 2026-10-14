import { describe, expect, it } from 'vitest'
import type { AnswerBlock } from '@/features/ai-agent/types'
import type { PublicProductRow } from './types'
import {
  PUBLIC_PRODUCT_COLUMN_KEYS,
  PRODUCT_TABLE_DATASET,
  buildProductViewItems,
  isPublicProductTableBlock,
  splitPublicProductBlocks,
  transposeProductTable,
} from './product-view'

const PRODUCT_COLUMNS = PUBLIC_PRODUCT_COLUMN_KEYS.map((key) => ({
  key,
  label: key,
}))

const productTable = (dataset?: string): AnswerBlock => ({
  kind: 'table',
  title: '商品公开数据对比（卖家精灵）',
  columns: PRODUCT_COLUMNS,
  rows: [{ asin: 'B0PRIMARY1' }],
  ...(dataset ? { dataset } : {}),
})

const metrics = (): AnswerBlock => ({
  kind: 'metrics',
  title: '期间汇总',
  items: [{ key: 'spend', label: '广告花费', value: 1 }],
})

describe('isPublicProductTableBlock', () => {
  it('认 dataset 标记', () => {
    expect(isPublicProductTableBlock(productTable(PRODUCT_TABLE_DATASET))).toBe(
      true
    )
  })

  it('没有 dataset 的历史快照按列结构兜底识别', () => {
    expect(isPublicProductTableBlock(productTable())).toBe(true)
  })

  it('列结构不同则不识别（别的表不能被当成商品卡片的表格视图）', () => {
    const other: AnswerBlock = {
      kind: 'table',
      columns: [
        { key: 'role', label: '角色' },
        { key: 'keyword', label: '关键词' },
      ],
      rows: [],
    }
    expect(isPublicProductTableBlock(other)).toBe(false)
    // 列键相同但顺序不同也不认：顺序不同说明上游换了列定义，宁可回落默认渲染
    const reordered: AnswerBlock = {
      kind: 'table',
      columns: [...PRODUCT_COLUMNS].reverse(),
      rows: [],
    }
    expect(isPublicProductTableBlock(reordered)).toBe(false)
  })

  it('非表格块一律不识别', () => {
    expect(isPublicProductTableBlock(metrics())).toBe(false)
    expect(
      isPublicProductTableBlock({
        kind: 'chart',
        dataset: PRODUCT_TABLE_DATASET,
        series: [],
      })
    ).toBe(false)
  })
})

describe('splitPublicProductBlocks', () => {
  it('按商品表切成 before / product / after，并保持原顺序', () => {
    const head = metrics()
    const tail: AnswerBlock = { kind: 'metrics', title: '流量结构', items: [] }
    const split = splitPublicProductBlocks([
      head,
      productTable(PRODUCT_TABLE_DATASET),
      tail,
    ])
    expect(split.before).toEqual([head])
    expect(split.product?.title).toBe('商品公开数据对比（卖家精灵）')
    expect(split.after).toEqual([tail])
  })

  it('没有该块时 before 为全部块、product 为 null', () => {
    const blocks = [metrics()]
    const split = splitPublicProductBlocks(blocks)
    expect(split.before).toEqual(blocks)
    expect(split.product).toBeNull()
    expect(split.after).toEqual([])
  })

  it('空数组不炸', () => {
    expect(splitPublicProductBlocks([])).toEqual({
      before: [],
      product: null,
      after: [],
    })
  })
})

describe('buildProductViewItems', () => {
  const productRow = (asin: string): PublicProductRow => ({
    asin,
    role: 'competitor',
    roleLabel: '竞品',
    hasData: true,
    title: '标题',
    brand: 'BrandX',
    price: 19.99,
    rating: 4.3,
    ratings: 100,
    bsrRank: 800,
    bsrLabel: 'Kitchen',
    sellers: 3,
    fulfillment: 'FBA',
    lqs: 80,
    nodeLabelPath: 'Home:Kitchen',
    imageUrl: 'https://example.com/a.jpg',
    availableDate: '2025-01-01',
    listedDays: 600,
  })

  it('以本次分析的 ASIN 为全集：未收录的 ASIN 也要出卡片（只是没有公开属性）', () => {
    const items = buildProductViewItems({
      asins: ['B0PRIMARY1', 'B0COMPETI1'],
      primaryAsin: 'B0PRIMARY1',
      // 只有竞品被卖家精灵收录
      rows: [productRow('B0COMPETI1')],
      comparisonRows: [],
    })
    expect(items.map((item) => item.asin)).toEqual(['B0PRIMARY1', 'B0COMPETI1'])
    expect(items[0].product).toBeNull()
    expect(items[0].roleLabel).toBe('本品')
    expect(items[1].product?.imageUrl).toBe('https://example.com/a.jpg')
    expect(items[1].roleLabel).toBe('竞品')
  })

  it('本品判定大小写不敏感，自家报表行按 ASIN 对上', () => {
    const items = buildProductViewItems({
      asins: ['b0primary1'],
      primaryAsin: 'B0PRIMARY1',
      rows: [],
      comparisonRows: [
        {
          asin: 'B0PRIMARY1',
          role: 'subject',
          roleLabel: '本品',
          hasData: true,
          emptyReason: null,
          impressions: 1,
          clicks: 1,
          spend: 1,
          sales: 1,
          orders: 1,
          acos: 10,
          ctr: 1,
          cvr: 1,
          cpc: 1,
          units: 1,
        },
      ],
    })
    expect(items[0].role).toBe('subject')
    expect(items[0].comparison?.acos).toBe(10)
  })
})

describe('transposeProductTable', () => {
  const block: AnswerBlock = {
    kind: 'table',
    title: '商品公开数据对比（卖家精灵）',
    dataset: PRODUCT_TABLE_DATASET,
    columns: [
      { key: 'roleLabel', label: '角色' },
      { key: 'asin', label: 'ASIN' },
      { key: 'price', label: '价格' },
      { key: 'rating', label: '评分' },
      { key: 'bsrRank', label: 'BSR' },
    ],
    rows: [
      {
        roleLabel: '本品',
        asin: 'B0PRIMARY1',
        price: 17.99,
        rating: 4.3,
        bsrRank: 1234,
      },
      {
        // 卖家精灵没收录竞品：字段全 null，必须保留成「—」
        roleLabel: '竞品',
        asin: 'B0COMPETI1',
        price: null,
        rating: null,
        bsrRank: null,
      },
    ],
  }

  const transposed = transposeProductTable(block)

  it('列变成「属性 + 每个 ASIN 一列」，表头带角色（与「ASIN 横向对比」同一读法）', () => {
    expect(transposed.columns?.map((column) => column.key)).toEqual([
      'metric',
      'B0PRIMARY1',
      'B0COMPETI1',
    ])
    expect(transposed.columns?.[0].label).toBe('属性')
    expect(transposed.columns?.[1].label).toBe('B0PRIMARY1（本品）')
    expect(transposed.columns?.[2].label).toBe('B0COMPETI1（竞品）')
  })

  it('每个 ASIN 一档归属配色（本品 chart-1、竞品 chart-2）', () => {
    expect(transposed.columns?.[0].tone).toBeUndefined()
    expect(transposed.columns?.[1].tone).toBe(1)
    expect(transposed.columns?.[2].tone).toBe(2)
  })

  it('行变成各属性，本品与竞品的值在同一行相邻', () => {
    expect(transposed.rows).toEqual([
      { metric: '价格', B0PRIMARY1: 17.99, B0COMPETI1: null },
      { metric: '评分', B0PRIMARY1: 4.3, B0COMPETI1: null },
      { metric: 'BSR', B0PRIMARY1: 1234, B0COMPETI1: null },
    ])
  })

  it('缺失值保持 null（不用 0 顶替），且保留标题与数据源标记', () => {
    expect(transposed.rows?.[0].B0COMPETI1).toBeNull()
    expect(transposed.title).toBe('商品公开数据对比（卖家精灵）')
    expect(transposed.dataset).toBe(PRODUCT_TABLE_DATASET)
  })

  it('认不出来的块原样返回（不做半张表的转置）', () => {
    const other: AnswerBlock = {
      kind: 'table',
      columns: [{ key: 'role', label: '角色' }],
      rows: [{ role: '本品' }],
    }
    expect(transposeProductTable(other)).toBe(other)
  })
})

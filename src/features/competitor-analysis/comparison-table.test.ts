import { describe, expect, it } from 'vitest'
import type { AnswerBlock } from '@/features/ai-agent/types'
import {
  COMPARISON_COLUMN_KEYS,
  COMPARISON_TABLE_DATASET,
  isComparisonTableBlock,
  transposeComparisonTable,
} from './comparison-table'

const columns = COMPARISON_COLUMN_KEYS.map((key) => ({ key, label: key }))

const block: AnswerBlock = {
  kind: 'table',
  title: 'ASIN 横向对比',
  dataset: COMPARISON_TABLE_DATASET,
  columns,
  rows: [
    {
      asin: 'B0PRIMARY1',
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
      asin: 'B0COMPETI1',
      roleLabel: '竞品',
      spend: 2372.58,
      sales: 6606.71,
      acos: 35.91,
      clicks: 2969,
      cvr: 5.19,
      cpc: 0.8,
      orders: 154,
      units: 120,
    },
    {
      // 竞品不在自家报表里：字段为 null，必须原样保留成「—」
      asin: 'B0NODATA001',
      roleLabel: '竞品',
      spend: null,
      sales: null,
      acos: null,
      clicks: null,
      cvr: null,
      cpc: null,
      orders: null,
      units: null,
    },
  ],
}

describe('isComparisonTableBlock', () => {
  it('认列结构（历史快照没有 dataset 标记时也能认出）', () => {
    const { dataset: _dataset, ...withoutDataset } = block
    expect(isComparisonTableBlock(block)).toBe(true)
    expect(isComparisonTableBlock(withoutDataset)).toBe(true)
  })

  it('别的表不误伤（AI 助手的广告日报表列结构不同）', () => {
    expect(
      isComparisonTableBlock({
        kind: 'table',
        dataset: COMPARISON_TABLE_DATASET,
        columns: [
          { key: 'asin', label: 'ASIN' },
          { key: 'spend', label: '广告花费' },
        ],
        rows: [{ asin: 'B0PRIMARY1', spend: 1 }],
      })
    ).toBe(false)
    expect(isComparisonTableBlock({ kind: 'metrics', items: [] })).toBe(false)
  })
})

describe('transposeComparisonTable', () => {
  const transposed = transposeComparisonTable(block)

  it('列变成「指标 + 每个 ASIN 一列」，表头带角色', () => {
    expect(transposed.columns?.map((column) => column.key)).toEqual([
      'metric',
      'B0PRIMARY1',
      'B0COMPETI1',
      'B0NODATA001',
    ])
    expect(transposed.columns?.[1].label).toBe('B0PRIMARY1（本品）')
    expect(transposed.columns?.[2].label).toBe('B0COMPETI1（竞品）')
    // 数值列右对齐（指标名列保持左对齐）
    expect(transposed.columns?.[1].align).toBe('right')
    expect(transposed.columns?.[0].align).toBeUndefined()
  })

  it('行变成各指标，本品与竞品的值在同一行相邻（这就是"一一对应"）', () => {
    expect(transposed.rows).toHaveLength(8)
    const spend = transposed.rows?.find((row) => row.metric === 'spend')
    expect(spend).toEqual({
      metric: 'spend',
      B0PRIMARY1: 3855.37,
      B0COMPETI1: 2372.58,
      B0NODATA001: null,
    })
    const acos = transposed.rows?.find((row) => row.metric === 'acos')
    expect(acos?.B0PRIMARY1).toBe(32.1)
    expect(acos?.B0COMPETI1).toBe(35.91)
  })

  it('缺失值保持 null（渲染层显示「—」，前端不折算成 0）', () => {
    const units = transposed.rows?.find((row) => row.metric === 'units')
    expect(units?.B0NODATA001).toBeNull()
  })

  it('保留标题与 note（口径声明不能因为转置丢掉）', () => {
    expect(transposed.title).toBe('ASIN 横向对比')
    expect(transposed.dataset).toBe(COMPARISON_TABLE_DATASET)
  })

  it('每个 ASIN 一档归属配色（本品 chart-1、竞品依次 2/3），与「按日对比」同口径', () => {
    expect(transposed.columns?.[0].tone).toBeUndefined()
    expect(transposed.columns?.[1].tone).toBe(1)
    expect(transposed.columns?.[2].tone).toBe(2)
    expect(transposed.columns?.[3].tone).toBe(3)
  })

  it('认不出来的块原样返回（不做半张表的转置）', () => {
    const other: AnswerBlock = {
      kind: 'table',
      columns: [{ key: 'role', label: '角色' }],
      rows: [{ role: '本品' }],
    }
    expect(transposeComparisonTable(other)).toBe(other)
  })

  it('只有一行数据也照样转置（单 ASIN 分析）', () => {
    const single = transposeComparisonTable({ ...block, rows: [block.rows![0]] })
    expect(single.columns?.map((column) => column.key)).toEqual([
      'metric',
      'B0PRIMARY1',
    ])
    expect(single.rows?.[0]).toEqual({
      metric: 'spend',
      B0PRIMARY1: 3855.37,
    })
  })
})

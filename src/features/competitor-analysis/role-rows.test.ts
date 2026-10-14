import { describe, expect, it } from 'vitest'
import type { AnswerBlock } from '@/features/ai-agent/types'
import { applyRowTones } from './role-rows'

/** 「TOP 流量词」的服务端形态：一行一个词，归属写在 `role` 列里。 */
const keywordBlock = (rows: Record<string, unknown>[]): AnswerBlock => ({
  kind: 'table',
  title: 'TOP 流量词（含搜索量与竞价）',
  columns: [
    { key: 'role', label: '角色' },
    { key: 'keyword', label: '关键词' },
    { key: 'searches', label: '月搜索量', align: 'right' },
  ],
  rows,
})

describe('applyRowTones', () => {
  it('同一 ASIN 的行同色，不同 ASIN 不同色（本品 chart-1、竞品 chart-2）', () => {
    const toned = applyRowTones(
      keywordBlock([
        { asin: 'B0PRIMARY1', role: '本品', keyword: 'candle' },
        { asin: 'B0PRIMARY1', role: '本品', keyword: 'lamp' },
        { asin: 'B0COMPETI1', role: '竞品', keyword: 'candle holder' },
        { asin: 'B0COMPETI1', role: '竞品', keyword: 'warmer' },
      ])
    )
    expect(toned.rows?.map((row) => row.__tone)).toEqual([1, 1, 2, 2])
  })

  it('本品永远拿第一档：行序被打乱（差评高频词按词频排序）也不变', () => {
    const toned = applyRowTones(
      keywordBlock([
        { asin: 'B0COMPETI1', role: '竞品', term: 'working', count: 11 },
        { asin: 'B0PRIMARY1', role: '本品', term: 'cheap', count: 7 },
        { asin: 'B0COMPETI1', role: '竞品', term: 'broken', count: 3 },
      ])
    )
    expect(toned.rows?.[0].__tone).toBe(2)
    expect(toned.rows?.[1].__tone).toBe(1)
    expect(toned.rows?.[2].__tone).toBe(2)
  })

  it('多个竞品各占一档，且 ASIN 大小写 / 空白不影响归组', () => {
    const toned = applyRowTones(
      keywordBlock([
        { asin: 'b0competi2', role: '竞品', keyword: 'a' },
        { asin: ' B0PRIMARY1 ', role: '本品', keyword: 'b' },
        { asin: 'B0COMPETI2', role: '竞品', keyword: 'c' },
      ])
    )
    expect(toned.rows?.map((row) => row.__tone)).toEqual([2, 1, 2])
  })

  it('超过 5 个 ASIN 循环用色（渲染层只认 1~5）', () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({
      asin: `B0ASIN000${index}`,
      role: index === 0 ? '本品' : '竞品',
      keyword: `k${index}`,
    }))
    const toned = applyRowTones(keywordBlock(rows))
    expect(toned.rows?.map((row) => row.__tone)).toEqual([1, 2, 3, 4, 5, 1, 2])
  })

  it('不修改原行对象（渲染层拿到的是新对象，原块不被就地改写）', () => {
    const source = keywordBlock([
      { asin: 'B0PRIMARY1', role: '本品', keyword: 'a' },
      { asin: 'B0COMPETI1', role: '竞品', keyword: 'b' },
    ])
    const toned = applyRowTones(source)
    expect(toned).not.toBe(source)
    expect(source.rows?.[0].__tone).toBeUndefined()
    expect(toned.rows?.[0].__tone).toBe(1)
  })

  it('缺 asin 或 role 的表原样返回（宁可不上色，也不要乱上色）', () => {
    const noAsin = keywordBlock([
      { role: '本品', keyword: 'a' },
      { role: '竞品', keyword: 'b' },
    ])
    expect(applyRowTones(noAsin)).toBe(noAsin)
    const noRole = keywordBlock([
      { asin: 'B0PRIMARY1', keyword: 'a' },
      { asin: 'B0COMPETI1', keyword: 'b' },
    ])
    expect(applyRowTones(noRole)).toBe(noRole)
  })

  it('只有一行 / 不是表格块时原样返回', () => {
    const single = keywordBlock([
      { asin: 'B0PRIMARY1', role: '本品', keyword: 'a' },
    ])
    expect(applyRowTones(single)).toBe(single)
    const metrics: AnswerBlock = { kind: 'metrics', items: [] }
    expect(applyRowTones(metrics)).toBe(metrics)
  })

  it('保留标题 / note / 列定义（上色不能改动表本身）', () => {
    const toned = applyRowTones(
      keywordBlock([
        { asin: 'B0PRIMARY1', role: '本品', keyword: 'a' },
        { asin: 'B0COMPETI1', role: '竞品', keyword: 'b' },
      ])
    )
    expect(toned.title).toBe('TOP 流量词（含搜索量与竞价）')
    expect(toned.columns?.map((column) => column.key)).toEqual([
      'role',
      'keyword',
      'searches',
    ])
  })
})

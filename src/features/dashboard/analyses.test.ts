import { describe, expect, it } from 'vitest'
import type { HistoryItem } from '@/features/competitor-analysis/types'
import {
  ATTENTION_DISPLAY_LIMIT,
  RECENT_DISPLAY_LIMIT,
  formatRelativeTime,
  pickAttentionAnalyses,
  takeRecentAnalyses,
} from './analyses'

function item(overrides: Partial<HistoryItem>): HistoryItem {
  return {
    id: 1,
    inputType: 'ASIN',
    inputValue: 'B0C1D2E3F4',
    asins: ['B0C1D2E3F4'],
    marketplace: 'US',
    startDate: null,
    endDate: null,
    windowDays: 30,
    compareWith: 'previous_period',
    headline: null,
    level: null,
    findingCount: 0,
    hasSnapshot: true,
    createdAt: '2026-09-15T02:00:00.000Z',
    ...overrides,
  }
}

describe('pickAttentionAnalyses', () => {
  it('只保留 level 为 high 的记录，并保持输入顺序', () => {
    const items = [
      item({ id: 1, level: 'medium' }),
      item({ id: 2, level: 'high' }),
      item({ id: 3, level: null }),
      item({ id: 4, level: 'high' }),
    ]

    expect(pickAttentionAnalyses(items).map((row) => row.id)).toEqual([2, 4])
  })

  it('最多返回 3 条', () => {
    const items = Array.from({ length: 6 }, (_, index) =>
      item({ id: index + 1, level: 'high' })
    )

    expect(pickAttentionAnalyses(items)).toHaveLength(ATTENTION_DISPLAY_LIMIT)
  })

  it('没有 high 时返回空数组', () => {
    expect(pickAttentionAnalyses([item({ level: 'low' })])).toEqual([])
  })
})

describe('takeRecentAnalyses', () => {
  it('最多返回 5 条且顺序不变', () => {
    const items = Array.from({ length: 8 }, (_, index) =>
      item({ id: index + 1 })
    )

    expect(takeRecentAnalyses(items).map((row) => row.id)).toEqual([
      1, 2, 3, 4, 5,
    ])
    expect(takeRecentAnalyses(items)).toHaveLength(RECENT_DISPLAY_LIMIT)
  })
})

describe('formatRelativeTime', () => {
  const now = new Date(2026, 8, 15, 10, 0, 0) // 本地 2026-09-15 10:00

  it('1 分钟内显示「刚刚」', () => {
    expect(
      formatRelativeTime(new Date(2026, 8, 15, 9, 59, 30).toISOString(), now)
    ).toBe('刚刚')
  })

  it('1 小时内显示分钟', () => {
    expect(
      formatRelativeTime(new Date(2026, 8, 15, 9, 20).toISOString(), now)
    ).toBe('40 分钟前')
  })

  it('24 小时内显示小时', () => {
    expect(
      formatRelativeTime(new Date(2026, 8, 15, 3, 0).toISOString(), now)
    ).toBe('7 小时前')
  })

  it('7 天内显示天数', () => {
    expect(
      formatRelativeTime(new Date(2026, 8, 12, 10, 0).toISOString(), now)
    ).toBe('3 天前')
  })

  it('超过 7 天按本地日期显示，不使用 UTC 切片', () => {
    // 本地时间 2026-09-01 23:30：UTC 切片在负时区会给出 09-02，本地日期才是唯一正确答案
    const created = new Date(2026, 8, 1, 23, 30)

    expect(formatRelativeTime(created.toISOString(), now)).toBe('2026-09-01')
  })

  it('未来时间按本地日期显示，不出现负数', () => {
    const future = new Date(2026, 8, 20, 10, 0)

    expect(formatRelativeTime(future.toISOString(), now)).toBe('2026-09-20')
  })

  it('空值与不可解析值都显示「未知」', () => {
    expect(formatRelativeTime(null, now)).toBe('未知')
    expect(formatRelativeTime(undefined, now)).toBe('未知')
    expect(formatRelativeTime('not-a-date', now)).toBe('未知')
  })
})

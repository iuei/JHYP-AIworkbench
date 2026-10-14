import { describe, expect, it } from 'vitest'
import {
  describeSchedule,
  fromDateTimeLocalValue,
  scheduleState,
  toDateTimeLocalValue,
} from './format'

describe('datetime-local 与 ISO 互转', () => {
  it('往返转换保持同一时刻（本地时间串不经 UTC 漂移）', () => {
    // 用本地字段构造：断言与运行环境的时区无关
    const local = new Date(2026, 8, 20, 10, 30)
    const localValue = toDateTimeLocalValue(local.toISOString())

    expect(localValue).toBe('2026-09-20T10:30')
    expect(fromDateTimeLocalValue(localValue)).toBe(local.toISOString())
  })

  it('空值与非法值给安全结果，不抛错', () => {
    expect(toDateTimeLocalValue(null)).toBe('')
    expect(toDateTimeLocalValue(undefined)).toBe('')
    expect(toDateTimeLocalValue('not-a-date')).toBe('')
    expect(fromDateTimeLocalValue('')).toBeNull()
    expect(fromDateTimeLocalValue('not-a-date')).toBeNull()
  })
})

describe('生效状态', () => {
  const now = new Date(2026, 8, 20, 12, 0).getTime()

  it('未到生效时间是 scheduled', () => {
    expect(
      scheduleState(new Date(2026, 8, 21, 0, 0).toISOString(), null, now)
    ).toBe('scheduled')
  })

  it('已过失效时间是 expired', () => {
    expect(
      scheduleState(null, new Date(2026, 8, 19, 0, 0).toISOString(), now)
    ).toBe('expired')
  })

  it('无限制与区间内都是 active', () => {
    expect(scheduleState(null, null, now)).toBe('active')
    expect(
      scheduleState(
        new Date(2026, 8, 19, 0, 0).toISOString(),
        new Date(2026, 8, 21, 0, 0).toISOString(),
        now
      )
    ).toBe('active')
  })
})

describe('生效期文案', () => {
  it('不限制时说明"立即生效、长期有效"', () => {
    expect(describeSchedule(null, null)).toBe('立即生效 · 长期有效')
  })

  it('只有一侧限制时写明是哪一侧', () => {
    const publishAt = new Date(2026, 8, 20, 10, 0).toISOString()
    const expireAt = new Date(2026, 8, 30, 10, 0).toISOString()

    expect(describeSchedule(publishAt, null)).toContain('起 · 长期有效')
    expect(describeSchedule(null, expireAt)).toContain('立即生效 ·')
    expect(describeSchedule(publishAt, expireAt)).toContain('起 ·')
    expect(describeSchedule(publishAt, expireAt)).toContain('截止')
  })
})

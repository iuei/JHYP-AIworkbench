import { describe, expect, it } from 'vitest'
import { WINDOW_OPTIONS, countAsins } from './format'

describe('WINDOW_OPTIONS', () => {
  it('预设按天数升序、自定义在最后，且含半年与一年', () => {
    // 与服务端 `server/competitor-analysis.mjs` 的 WINDOW_PRESETS / MAX_WINDOW_DAYS 同口径：
    // 页面能选的天数必须都被服务端接受（否则是"能选、提交被 400 拒绝"）
    expect(WINDOW_OPTIONS.map((option) => option.value)).toEqual([
      '7',
      '30',
      '90',
      '180',
      '365',
      'custom',
    ])
    expect(WINDOW_OPTIONS.find((option) => option.value === '180')?.label).toBe('半年')
    expect(WINDOW_OPTIONS.find((option) => option.value === '365')?.label).toBe('一年')
  })
})

describe('countAsins', () => {
  it('只数 10 位 ASIN，换行与逗号都算分隔，重复只算一次', () => {
    expect(countAsins('')).toBe(0)
    expect(countAsins('   ')).toBe(0)
    expect(countAsins('B0C1D2E3F4')).toBe(1)
    // 一行一个（换行）与逗号/顿号分隔都要能数出来
    expect(countAsins('B0C1D2E3F4\nB0C5D6E7F8')).toBe(2)
    expect(countAsins('B0C1D2E3F4, B0C5D6E7F8、B0AAAABBBB')).toBe(3)
    // 同一个 ASIN 写两遍只算一个（额度预估不该翻倍）
    expect(countAsins('b0c1d2e3f4 B0C1D2E3F4')).toBe(1)
    // 粘贴链接也算（额度预估要跟上真实调用对象）
    expect(countAsins('https://www.amazon.com/dp/B0C1D2E3F4')).toBe(1)
    // 认不出的片段不计数（真实校验在服务端）
    expect(countAsins('not-an-asin')).toBe(0)
  })
})

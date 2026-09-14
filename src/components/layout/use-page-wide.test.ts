import { describe, expect, it } from 'vitest'
import { pickPageWide } from './use-page-wide'

const m = (wide?: boolean) => ({
  staticData: wide === undefined ? {} : { wide },
})

describe('pickPageWide', () => {
  it('默认不铺满：全链没声明时返回 false', () => {
    expect(pickPageWide([])).toBe(false)
    expect(pickPageWide([m(), m(), m()])).toBe(false)
    expect(pickPageWide([{ staticData: undefined }])).toBe(false)
    expect(pickPageWide([{}])).toBe(false)
  })

  it('取最深一层显式声明的宽度策略', () => {
    expect(pickPageWide([m(), m(false), m(), m(true)])).toBe(true)
    expect(pickPageWide([m(), m(true), m(), m(false)])).toBe(false)
  })

  it('子页声明 true 时覆盖模块级的默认居中（AI 助手对话页）', () => {
    // /ai-agent 模块级路由只声明标题，对话页 index 声明 wide: true
    expect(pickPageWide([m(), m(), { staticData: { title: 'AI 助手' } }, m(true)])).toBe(
      true
    )
  })

  it('模块级声明宽屏时，子页可以用 wide: false 关掉', () => {
    expect(pickPageWide([m(), m(true), m(), m(false)])).toBe(false)
  })

  it('只认布尔值，标题等其它 staticData 字段不影响判定', () => {
    expect(
      pickPageWide([m(), { staticData: { title: 'AI 治理' } }, m()])
    ).toBe(false)
  })
})

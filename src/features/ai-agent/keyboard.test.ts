import { describe, expect, it } from 'vitest'
import { isImeComposing } from './keyboard'

/**
 * 输入法组合态判定（2026-09-18 修「中文打字时按回车直接发送」）。
 *
 * 中文/日文输入法打字时，回车的第一职责是**确认候选词**，而不是提交。浏览器在组合期间
 * 仍会把 `keydown` 交给页面（key 就是 'Enter'），所以聊天输入框必须在最前面判断组合态，
 * 否则用户敲完拼音按回车就把半截内容发出去了（实测用户报障）。
 */
describe('isImeComposing', () => {
  it('isComposing 为 true 时判为组合态', () => {
    expect(isImeComposing({ nativeEvent: { isComposing: true } })).toBe(true)
  })

  it('keyCode 229 也判为组合态（组合结束那一下 isComposing 已回落的情况）', () => {
    expect(
      isImeComposing({ nativeEvent: { isComposing: false }, keyCode: 229 })
    ).toBe(true)
  })

  it('普通回车（isComposing=false、keyCode=13）不是组合态', () => {
    expect(
      isImeComposing({ nativeEvent: { isComposing: false }, keyCode: 13 })
    ).toBe(false)
  })

  it('模拟事件/缺少字段时保守放行（不吞掉正常回车）', () => {
    expect(isImeComposing({})).toBe(false)
    expect(isImeComposing({ nativeEvent: {} })).toBe(false)
  })
})

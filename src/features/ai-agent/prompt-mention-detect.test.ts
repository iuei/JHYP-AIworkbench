/**
 * `@提示词` 检测与替换的纯函数单测。
 *
 * 这两条规则最容易错，且错了以后表现很隐蔽（用户只是"@ 没反应"或"正文被吃掉一截"）：
 * 1. **触发条件**：`@` 前必须是行首或空白 —— 否则 `a@b.com` 这类邮箱会误触发；
 * 2. **替换范围**：只替换 `@` 到光标之间的文字 —— 越界会把用户后面的正文删掉。
 */
import { describe, expect, it } from 'vitest'
import {
  MENTION_MAX_KEYWORD_LENGTH,
  applyMention,
  detectMention,
} from './prompt-mention'

describe('detectMention：识别光标是否处于 @ 提及中', () => {
  it('行首的 @ 可触发', () => {
    expect(detectMention('@', 1)).toEqual({ start: 0, keyword: '' })
  })

  it('空白之后的 @ 可触发，并返回 @ 与光标之间的搜索词', () => {
    expect(detectMention('帮我看看 @ACoS', 10)).toEqual({
      start: 5,
      keyword: 'ACoS',
    })
  })

  it('行中间贴着字母的 @ 不触发（避免把邮箱当成提及）', () => {
    expect(detectMention('a@b.com', 7)).toBeNull()
    expect(detectMention('邮箱 zhangsan@corp.com', 22)).toBeNull()
  })

  it('换行之后的 @ 属于新的一行，可触发', () => {
    expect(detectMention('第一行\n@库存', 9)).toEqual({
      start: 4,
      keyword: '库存',
    })
  })

  it('@ 与光标之间出现换行时视为提及已结束', () => {
    expect(detectMention('@库存\n继续说', 10)).toBeNull()
  })

  it('连续输入多个 @ 时以最后一个为准', () => {
    expect(detectMention('@旧的 @新的', 8)).toEqual({
      start: 4,
      keyword: '新的',
    })
  })

  it('没有 @ 或光标在 @ 之前时不触发', () => {
    expect(detectMention('普通提问', 4)).toBeNull()
    expect(detectMention('后面才有 @ACoS', 3)).toBeNull()
  })

  it('光标位置越界时按文本长度收敛，不抛错', () => {
    expect(detectMention('@ACoS', 999)).toEqual({ start: 0, keyword: 'ACoS' })
    expect(detectMention('@ACoS', -5)).toBeNull()
  })

  it('关键字长度上限与后端保持一致（60）', () => {
    expect(MENTION_MAX_KEYWORD_LENGTH).toBe(60)
  })
})

describe('applyMention：把 @关键词 替换成提示词正文', () => {
  it('替换光标前的 @关键词，并给出插入后应有的光标位置', () => {
    const result = applyMention({
      value: '帮我看看 @ACoS',
      start: 5,
      caret: 10,
      body: '分析 ACoS 上涨的主因',
    })
    expect(result.text).toBe('帮我看看 分析 ACoS 上涨的主因')
    expect(result.caret).toBe(result.text.length)
  })

  it('保留光标之后的正文（只替换提及片段，不吃掉后文）', () => {
    const result = applyMention({
      value: '@ACoS 这段之后还有字',
      start: 0,
      caret: 5,
      body: '【模板】',
    })
    expect(result.text).toBe('【模板】 这段之后还有字')
    expect(result.caret).toBe(4)
  })

  it('正文里的换行原样保留', () => {
    const result = applyMention({
      value: '@归因',
      start: 0,
      caret: 3,
      body: '第一步\n第二步',
    })
    expect(result.text).toBe('第一步\n第二步')
  })

  it('光标位置越界时收敛到文本长度，不产生越界切片', () => {
    const result = applyMention({
      value: '@ACoS',
      start: 0,
      caret: 999,
      body: 'X',
    })
    expect(result.text).toBe('X')
  })
})

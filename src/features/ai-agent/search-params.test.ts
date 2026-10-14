import { describe, expect, it } from 'vitest'
import { parseAiAgentSearch } from './search-params'

describe('parseAiAgentSearch', () => {
  it('解析正整数 conversationId 与 focus=composer', () => {
    expect(
      parseAiAgentSearch({ conversationId: '11', focus: 'composer' })
    ).toEqual({ conversationId: 11, focus: 'composer' })
  })

  it('容忍 router 解析出的数字类型', () => {
    expect(parseAiAgentSearch({ conversationId: 11 })).toEqual({
      conversationId: 11,
    })
  })

  it('非法 conversationId 一律忽略，不抛错', () => {
    for (const value of ['abc', '0', '-3', '2.5', '', null, undefined, {}, []]) {
      expect(parseAiAgentSearch({ conversationId: value })).toEqual({})
    }
  })

  it('非枚举 focus 忽略', () => {
    expect(parseAiAgentSearch({ focus: 'asin' })).toEqual({})
    expect(parseAiAgentSearch({ focus: 'composer' })).toEqual({
      focus: 'composer',
    })
  })

  it('空 search 返回空对象', () => {
    expect(parseAiAgentSearch({})).toEqual({})
  })
})

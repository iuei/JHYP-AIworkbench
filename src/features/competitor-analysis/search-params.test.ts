import { describe, expect, it } from 'vitest'
import {
  parseSnapshotSearch,
  parseCompetitorAnalysisSearch,
} from './search-params'

describe('parseCompetitorAnalysisSearch', () => {
  it('解析正整数 analysisId 与 focus=asin', () => {
    expect(
      parseCompetitorAnalysisSearch({ analysisId: '7', focus: 'asin' })
    ).toEqual({ analysisId: 7, focus: 'asin' })
  })

  it('容忍 router 解析出的数字类型', () => {
    expect(parseCompetitorAnalysisSearch({ analysisId: 7 })).toEqual({
      analysisId: 7,
    })
  })

  it('非法 analysisId 一律忽略，不抛错', () => {
    for (const value of ['abc', '-1', '0', '1.5', '', null, undefined, {}, []]) {
      expect(parseCompetitorAnalysisSearch({ analysisId: value })).toEqual({})
    }
  })

  it('非枚举 focus 忽略', () => {
    expect(parseCompetitorAnalysisSearch({ focus: 'composer' })).toEqual({})
    expect(parseCompetitorAnalysisSearch({ focus: 'asin' })).toEqual({
      focus: 'asin',
    })
  })

  it('空 search 返回空对象', () => {
    expect(parseCompetitorAnalysisSearch({})).toEqual({})
  })
})

describe('parseSnapshotSearch', () => {
  it('解析 analysisId（字符串与数字都接受）', () => {
    expect(parseSnapshotSearch({ analysisId: '12' })).toEqual({
      analysisId: 12,
    })
    expect(parseSnapshotSearch({ analysisId: 12 })).toEqual({
      analysisId: 12,
    })
  })

  it('缺少或非法 analysisId 时返回空对象（页面据此提示"从卡片进入"）', () => {
    for (const value of [undefined, null, '', 'abc', '0', '-3', '2.5', {}, []]) {
      expect(parseSnapshotSearch({ analysisId: value })).toEqual({})
    }
    expect(parseSnapshotSearch({})).toEqual({})
  })

  it('忽略本页不认识的参数（旧链接或手改 URL 都不能炸）', () => {
    expect(
      parseSnapshotSearch({ analysisId: '9', focus: 'asin', view: 'market' })
    ).toEqual({ analysisId: 9 })
  })
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MarketInsightValidationError,
  normalizeMarketInsightInput,
} from './market-insights.mjs'

const result = {
  marketplace: 'US',
  nodeIdPath: '123:456',
  headline: '月销量约 1000 件。',
  findings: [],
  findingLevel: 'info',
  blocks: [],
  topAsins: [],
  meta: { fetchedAt: '2026-09-22T00:00:00.000Z' },
}

test('normalizeMarketInsightInput 归一化报告快照', () => {
  assert.deepEqual(
    normalizeMarketInsightInput({
      marketplace: 'us',
      scopeType: 'CATEGORY',
      scopeKey: ' 123:456 ',
      scopeLabel: '  厨房用品 ',
      filters: { keyword: ' kitchen ' },
      result,
      sourceMeta: { calls: 2 },
      fetchedAt: '2026-09-22T00:00:00.000Z',
    }),
    {
      marketplace: 'US',
      scopeType: 'category',
      scopeKey: '123:456',
      scopeLabel: '厨房用品',
      filters: { keyword: ' kitchen ' },
      result,
      sourceMeta: { calls: 2 },
      fetchedAt: '2026-09-22T00:00:00.000Z',
    }
  )
})

test('normalizeMarketInsightInput 拒绝非法站点和报告类型', () => {
  assert.throws(
    () => normalizeMarketInsightInput({ marketplace: 'USA', scopeKey: 'x', result }),
    MarketInsightValidationError
  )
  assert.throws(
    () => normalizeMarketInsightInput({ scopeType: 'brand', scopeKey: 'x', result }),
    MarketInsightValidationError
  )
})

test('normalizeMarketInsightInput 拒绝空对象和数组结果', () => {
  assert.throws(
    () => normalizeMarketInsightInput({ scopeKey: 'x', result: null }),
    MarketInsightValidationError
  )
  assert.throws(
    () => normalizeMarketInsightInput({ scopeKey: 'x', result: [] }),
    MarketInsightValidationError
  )
})

test('normalizeMarketInsightInput 校验抓取时间和对象字段', () => {
  assert.throws(
    () => normalizeMarketInsightInput({ scopeKey: 'x', result, fetchedAt: 'invalid' }),
    MarketInsightValidationError
  )
  assert.throws(
    () => normalizeMarketInsightInput({ scopeKey: 'x', result, filters: [] }),
    MarketInsightValidationError
  )
})

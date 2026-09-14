import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CompetitorInputError,
  DEFAULT_WINDOW_DAYS,
  extractAsin,
  parseCompetitorInput,
  shiftDays,
  SUPPORTED_INPUT_TYPES,
} from './competitor-analysis.mjs'

test('extractAsin 接受直接输入的 ASIN，并忽略大小写与首尾空白', () => {
  assert.equal(extractAsin('B0C1D2E3F4'), 'B0C1D2E3F4')
  assert.equal(extractAsin('  b0c1d2e3f4  '), 'B0C1D2E3F4')
})

test('extractAsin 能从亚马逊商品链接里取出 ASIN', () => {
  assert.equal(
    extractAsin('https://www.amazon.com/dp/B0C1D2E3F4?ref_=xxx'),
    'B0C1D2E3F4',
    '/dp/ 路径'
  )
  assert.equal(
    extractAsin('https://www.amazon.com/gp/product/B0C1D2E3F4/ref=ox_sc_act_title'),
    'B0C1D2E3F4',
    '/gp/product/ 路径'
  )
})

test('extractAsin 不做模糊提取，避免把无关片段当成 ASIN', () => {
  assert.equal(extractAsin('https://www.amazon.com/s?k=portable+blender'), null)
  assert.equal(extractAsin('B0C1D2E3F'), null, '长度不足')
  assert.equal(extractAsin('B0C1D2E3F45'), null, '长度超出')
  assert.equal(extractAsin('B0C1D2E3F-'), null, '含非法字符')
  assert.equal(extractAsin(''), null)
  assert.equal(extractAsin(null), null)
})

test('parseCompetitorInput 归一化合法输入', () => {
  assert.deepEqual(parseCompetitorInput({ inputType: 'asin', inputValue: 'b0c1d2e3f4' }), {
    inputType: 'ASIN',
    asin: 'B0C1D2E3F4',
  })
})

test('parseCompetitorInput 对没有数据源的维度明确报错，而不是编造结果', () => {
  // 品牌名 / 店铺链接在现有数据集里没有对应字段：这里必须 400，
  // 而不是回一份看起来专业的分析（历史实现无论输入什么都返回同一组写死结论）。
  assert.deepEqual(SUPPORTED_INPUT_TYPES, ['ASIN'])
  for (const inputType of ['品牌名', '店铺链接', 'BRAND']) {
    assert.throws(
      () => parseCompetitorInput({ inputType, inputValue: 'something' }),
      (error) => {
        assert.ok(error instanceof CompetitorInputError)
        assert.match(error.message, /尚未接入/)
        return true
      },
      `${inputType} 应被拒绝`
    )
  }
})

test('parseCompetitorInput 拒绝缺失与非法输入', () => {
  assert.throws(() => parseCompetitorInput({}), CompetitorInputError)
  assert.throws(
    () => parseCompetitorInput({ inputType: 'ASIN', inputValue: '   ' }),
    CompetitorInputError
  )
  assert.throws(
    () => parseCompetitorInput({ inputType: 'ASIN', inputValue: 'not-an-asin' }),
    CompetitorInputError
  )
  assert.throws(
    () => parseCompetitorInput({ inputType: 'ASIN', inputValue: 'B0C1D2E3F4'.repeat(30) }),
    CompetitorInputError,
    '超长输入必须在进库前被拦下（competitor_analyses.input_value 是 VARCHAR(200)）'
  )
})

test('shiftDays 按 UTC 位移，跨月跨年不跑偏', () => {
  assert.equal(shiftDays('2026-09-11', -29), '2026-08-13')
  assert.equal(shiftDays('2026-03-01', -1), '2026-02-28')
  assert.equal(shiftDays('2026-01-01', -1), '2025-12-31')
  assert.equal(shiftDays('2024-03-01', -1), '2024-02-29', '闰年')
  assert.equal(shiftDays('不是日期', -1), '不是日期', '非法输入原样返回，不抛错')
})

test('默认分析窗口为 30 天（含首尾）', () => {
  assert.equal(DEFAULT_WINDOW_DAYS, 30)
  assert.equal(shiftDays(shiftDays('2026-09-11', -(DEFAULT_WINDOW_DAYS - 1)), 1), '2026-08-14')
})

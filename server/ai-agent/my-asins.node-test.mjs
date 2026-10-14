/**
 * 「我的 ASIN」领域层单测（纯函数，不依赖数据库）。
 *
 * 覆盖重点：ASIN / 站点校验边界、批量粘贴与表格文本的解析、以 `(asin, 站点)` 为键的
 * 落库计划，以及最容易出错的一处 —— "超限必须报错而不是静默截断"。
 *
 * 不测数据库函数（`listMyAsins` / `addMyAsins` 的落库分支）：那些在
 * `verify-my-asins.mjs` 里对真实接口验证，单测只钉纯逻辑。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_ALIAS_LENGTH,
  MAX_BULK_ASINS,
  MAX_ITEMS_PER_USER,
  MY_ASIN_MARKETPLACES,
  MyAsinValidationError,
  addMyAsins,
  normalizeAsin,
  optionalText,
  parseAddPayload,
  parseAsinText,
  parseMarketplace,
  planEntryMerge,
} from './my-asins.mjs'

/* ---------- 单条 ASIN ---------- */

test('normalizeAsin 去空白并大写，空值报错', () => {
  assert.equal(normalizeAsin(' b0aaaaaaaa '), 'B0AAAAAAAA')
  assert.throws(() => normalizeAsin(''), MyAsinValidationError)
  assert.throws(() => normalizeAsin(null), MyAsinValidationError)
})

/*
  2026-09-18 实测缺陷：库里出现了一条 ASIN = 「测试」（中文）的清单数据 ——
  `normalizeAsin` 此前只做去空白 + 大写，**不校验格式**，于是任何文本都能写进「我的 ASIN」，
  之后指标查询、AI 工具都拿它没办法（用户看到的是"查不到 ASIN 数据"）。
  ASIN 的合法性判定必须复用 `extractAsin`（与批量导入同一条口径）。
*/
test('normalizeAsin 拒绝非法 ASIN 格式（与批量导入同一口径）', () => {
  for (const dirty of ['测试', 'B0ABC', 'B0AAAAAAAAA', 'B0-AAAAAAAA', 'hello world']) {
    assert.throws(() => normalizeAsin(dirty), MyAsinValidationError, dirty)
  }
  // 商品链接仍能识别（extractAsin 自带的能力），结果必须是 10 位大写 ASIN
  assert.equal(
    normalizeAsin('https://www.amazon.com/dp/B0AAAAAAAA?th=1'),
    'B0AAAAAAAA'
  )
})

/* ---------- 可选文本 ---------- */

test('optionalText：未传返回 undefined（不改动），空串按清空处理（null）', () => {
  assert.equal(optionalText(undefined, { max: 10, label: '别名' }), undefined)
  assert.equal(optionalText('   ', { max: 10, label: '别名' }), null)
  assert.equal(optionalText('  夏季款 ', { max: 10, label: '别名' }), '夏季款')
  assert.throws(
    () => optionalText('x'.repeat(11), { max: 10, label: '别名' }),
    MyAsinValidationError
  )
})

/* ---------- 站点 ---------- */

test('parseMarketplace 大写化并校验枚举，未传时默认 US', () => {
  assert.equal(parseMarketplace(undefined), 'US')
  assert.equal(parseMarketplace('us'), 'US')
  assert.equal(parseMarketplace(' jp '), 'JP')
  assert.deepEqual(MY_ASIN_MARKETPLACES.slice(0, 3), ['US', 'UK', 'DE'])
})

test('parseMarketplace 拒绝不在枚举内的站点（含空串）', () => {
  assert.throws(() => parseMarketplace('USA'), MyAsinValidationError)
  assert.throws(() => parseMarketplace(''), MyAsinValidationError)
  assert.throws(() => parseMarketplace('ZZ'), MyAsinValidationError)
})

/* ---------- 纯文本解析 ---------- */

test('parseAsinText 支持逗号/顿号/换行/商品链接混排，去重且保序', () => {
  const result = parseAsinText(
    'B0AAAAAAAA, B0BBBBBBBB、b0aaaaaaaa\nhttps://www.amazon.com/dp/B0CCCCCCCC?ref=x'
  )
  assert.deepEqual(result.asins, ['B0AAAAAAAA', 'B0BBBBBBBB', 'B0CCCCCCCC'])
  assert.deepEqual(result.invalid, [])
  assert.deepEqual(result.repeated, ['B0AAAAAAAA'])
  assert.equal(result.marketplace, 'US')
})

test('parseAsinText 原样收集无法识别的片段（不猜、不丢）', () => {
  const result = parseAsinText('B0AAAAAAAA, 夏季款水杯, B0BBBBBBBB')
  assert.deepEqual(result.asins, ['B0AAAAAAAA', 'B0BBBBBBBB'])
  assert.deepEqual(result.invalid, ['夏季款水杯'])
})

test('parseAsinText 超过单次上限时报错，而不是截断', () => {
  const many = Array.from({ length: MAX_BULK_ASINS + 1 }, (_, index) =>
    `B0${String(index).padStart(8, '0')}`
  ).join('\n')
  assert.throws(() => parseAsinText(many), MyAsinValidationError)

  const exactlyAtLimit = Array.from({ length: MAX_BULK_ASINS }, (_, index) =>
    `B0${String(index).padStart(8, '0')}`
  ).join('\n')
  assert.equal(parseAsinText(exactlyAtLimit).asins.length, MAX_BULK_ASINS)
})

/* ---------- parseAddPayload：两条入口 ---------- */

test('parseAddPayload 单列文本走文本路径，全部落到默认站点', () => {
  const result = parseAddPayload({ raw: 'B0AAAAAAAA, B0BBBBBBBB', defaultMarketplace: 'JP' })
  assert.equal(result.table, false)
  assert.deepEqual(
    result.entries.map((entry) => [entry.asin, entry.marketplace]),
    [
      ['B0AAAAAAAA', 'JP'],
      ['B0BBBBBBBB', 'JP'],
    ]
  )
  assert.equal(result.entries[0].alias, null)
})

test('parseAddPayload 表格文本带上站点、别名与备注', () => {
  const result = parseAddPayload({
    raw: 'ASIN\t站点\t别名\t备注\nB0AAAAAAAA\t德国\t主力款\t观察中',
    defaultMarketplace: 'US',
  })
  assert.equal(result.table, true)
  assert.equal(result.entries.length, 1)
  assert.deepEqual(result.entries[0], {
    asin: 'B0AAAAAAAA',
    marketplace: 'DE',
    alias: '主力款',
    note: '观察中',
    line: 2,
  })
  assert.equal(result.mapping.marketplace, 1)
})

test('parseAddPayload 表格里没有站点列时用默认站点', () => {
  const result = parseAddPayload({
    raw: 'ASIN,别名\nB0AAAAAAAA,主力款',
    defaultMarketplace: 'UK',
  })
  assert.equal(result.entries[0].marketplace, 'UK')
})

test('parseAddPayload 识别不到任何 ASIN 时返回空条目（由 addMyAsins 统一报错）', () => {
  const result = parseAddPayload({ raw: '夏季款水杯, 库存表' })
  assert.deepEqual(result.entries, [])
  assert.ok(result.invalid.length > 0)
})

/* ---------- 落库计划 ---------- */

test('planEntryMerge 以 (asin, 站点) 为键：同 ASIN 的两个站点都是新增', () => {
  const plan = planEntryMerge(
    [
      { asin: 'B0AAAAAAAA', marketplace: 'US', alias: '美国主力款' },
      { asin: 'B0AAAAAAAA', marketplace: 'DE', alias: null },
    ],
    [{ asin: 'B0AAAAAAAA', marketplace: 'US' }]
  )
  assert.deepEqual(plan.duplicated, ['B0AAAAAAAA'])
  assert.deepEqual(plan.toAdd, [{ asin: 'B0AAAAAAAA', marketplace: 'DE', alias: null, note: null }])
  assert.equal(plan.overflow, false)
})

test('planEntryMerge 大小写不敏感，且本次输入内部的重复只保留第一条', () => {
  const plan = planEntryMerge(
    [
      { asin: 'b0aaaaaaaa', marketplace: 'us', alias: '第一条' },
      { asin: 'B0AAAAAAAA', marketplace: 'US', alias: '第二条' },
    ],
    []
  )
  assert.equal(plan.toAdd.length, 1)
  assert.equal(plan.toAdd[0].alias, '第一条')
})

test('planEntryMerge 在超过单账号上限时给出 overflowBy，交由调用方报错', () => {
  const existing = Array.from({ length: MAX_ITEMS_PER_USER }, (_, index) => ({
    asin: `B0${String(index).padStart(8, '0')}`,
    marketplace: 'US',
  }))
  const plan = planEntryMerge([{ asin: 'B0ZZZZZZZZ', marketplace: 'US' }], existing)
  assert.equal(plan.overflow, true)
  assert.equal(plan.overflowBy, 1)

  const full = planEntryMerge(
    [{ asin: 'B0ZZZZZZZZ', marketplace: 'US' }],
    existing.slice(0, MAX_ITEMS_PER_USER - 1)
  )
  assert.equal(full.overflow, false)
})

test('planEntryMerge 允许空集合与空输入', () => {
  assert.deepEqual(planEntryMerge([], []), {
    toAdd: [],
    duplicated: [],
    overflow: false,
    overflowBy: 0,
  })
  assert.deepEqual(planEntryMerge(undefined, undefined), {
    toAdd: [],
    duplicated: [],
    overflow: false,
    overflowBy: 0,
  })
})

/* ---------- addMyAsins 的入参校验（在访问数据库之前就会抛错） ---------- */

test('addMyAsins 空条目报错，并回显无法识别的片段', async () => {
  await assert.rejects(
    () => addMyAsins({ userId: 1, entries: [], invalid: ['夏季款水杯'] }),
    (error) =>
      error instanceof MyAsinValidationError && error.message.includes('夏季款水杯')
  )
})

test('addMyAsins 超长别名在落库前就被拒绝', async () => {
  await assert.rejects(
    () =>
      addMyAsins({
        userId: 1,
        entries: [{ asin: 'B0AAAAAAAA', alias: 'x'.repeat(MAX_ALIAS_LENGTH + 1) }],
      }),
    MyAsinValidationError
  )
})

test('addMyAsins 非法站点在落库前就被拒绝', async () => {
  await assert.rejects(
    () => addMyAsins({ userId: 1, entries: [{ asin: 'B0AAAAAAAA', marketplace: 'ZZ' }] }),
    MyAsinValidationError
  )
})

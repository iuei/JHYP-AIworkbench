/**
 * 结论处置台账的单测（纯函数部分，不需要数据库）。
 *
 * 这里守的是四条最容易写错、且错了会"静默骗人"的规则：
 * 1. **只在本次分析评估过该目标时才判定** —— 否则跑一次别的 ASIN 的分析就会把
 *    所有待核验项误判成"已解决"（虚假销账）；
 * 2. `ignored` 是终局 —— 用户说了不处理，系统不能再自动打回；
 * 3. 打回要能被界面说清楚（`reopened` + `reopen_count`），不是无声改状态；
 * 4. 已销账的键要从首页报警口径里扣掉（否则首页永远在报警）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { FINDING_WEIGHTS, toHistoryItem } from './competitor-analysis.mjs'
import {
  LEVEL_RANK,
  collectFindingKeys,
  dispositionKeyOf,
  dispositionTargetOf,
  planDispositionUpdates,
  summarizeOpenFindings,
} from './finding-dispositions.mjs'

test('LEVEL_RANK 与 competitor-analysis 的 FINDING_WEIGHTS 完全一致', () => {
  assert.deepEqual(LEVEL_RANK, FINDING_WEIGHTS)
})

test('dispositionTargetOf 优先取结论自己的归属目标，其次才是本次分析的本品', () => {
  assert.equal(
    dispositionTargetOf({ targetAsins: ['B0COMPET01'] }, 'B0SUBJECT1'),
    'B0COMPET01'
  )
  assert.equal(dispositionTargetOf({}, 'B0SUBJECT1'), 'B0SUBJECT1')
  assert.equal(dispositionTargetOf({ targetAsins: [] }, 'B0SUBJECT1'), 'B0SUBJECT1')
  // 两个都拿不到时必须返回 null —— 调用方据此判定"这条结论不可销账"，而不是拿空串当键
  assert.equal(dispositionTargetOf({}, null), null)
})

test('collectFindingKeys 跳过没有诊断码的结论，并给缺归属的结论补上本品', () => {
  const keys = collectFindingKeys(
    [
      { level: 'high', code: 'metric_acos_above' },
      { level: 'info', code: null },
      { level: 'medium', code: 'stockout_risk', sku: 'SKU-1' },
    ],
    { asin: 'B0SUBJECT1' }
  )
  assert.deepEqual(keys, [
    { code: 'metric_acos_above', target: 'B0SUBJECT1', level: 'high' },
    { code: 'stockout_risk', target: 'B0SUBJECT1', level: 'medium' },
  ])
})

test('collectFindingKeys 允许同码不同目标（组内每个竞品各一条），同码同目标只留一条', () => {
  const keys = collectFindingKeys([
    { level: 'medium', code: 'public_price_below', targetAsins: ['B0COMPET01'] },
    { level: 'medium', code: 'public_price_below', targetAsins: ['B0COMPET02'] },
    // 同一码 + 同一目标的重复项：与台账唯一键保持一致，只保留第一条
    { level: 'low', code: 'public_price_below', targetAsins: ['B0COMPET02'] },
  ])
  assert.equal(keys.length, 2)
  assert.deepEqual(
    keys.map((key) => dispositionKeyOf(key.code, key.target)),
    ['public_price_below|B0COMPET01', 'public_price_below|B0COMPET02']
  )
})

test('summarizeOpenFindings 扣掉已销账（claimed / verified / ignored），保留 open 与无行项', () => {
  const findingKeys = [
    { code: 'metric_acos_above', target: 'B0SUBJECT1', level: 'high' },
    { code: 'stockout_risk', target: 'B0SUBJECT1', level: 'medium' },
    { code: 'cvr_down', target: 'B0SUBJECT1', level: 'medium' },
    { code: 'acos_up', target: 'B0SUBJECT1', level: 'medium' },
    { code: 'public_price_below', target: 'B0COMPET01', level: 'low' },
  ]
  const dispositions = [
    { code: 'metric_acos_above', target: 'B0SUBJECT1', status: 'claimed' },
    { code: 'stockout_risk', target: 'B0SUBJECT1', status: 'verified' },
    { code: 'cvr_down', target: 'B0SUBJECT1', status: 'ignored' },
    // 被打回的仍在报警
    { code: 'acos_up', target: 'B0SUBJECT1', status: 'open' },
  ]
  const summary = summarizeOpenFindings({ findingKeys, dispositions })
  assert.equal(summary.openCount, 2, 'acos_up（被打回）与没有台账行的公开结论都算未处理')
  assert.equal(summary.openLevel, 'medium')
})

test('summarizeOpenFindings 不计入 info 级认知型结论（它们不是待办）', () => {
  const summary = summarizeOpenFindings({
    findingKeys: [
      { code: 'public_review_weakness', target: 'B0SUBJECT1', level: 'info' },
      { code: 'public_lowest_in_group', target: 'B0SUBJECT1', level: 'info' },
      { code: 'cvr_down', target: 'B0SUBJECT1', level: 'medium' },
    ],
    dispositions: [],
  })
  assert.equal(summary.openCount, 1, '两条 info 不算待处理')
  assert.equal(summary.openLevel, 'medium')
})

test('collectFindingKeys 给没有诊断码的老快照派生 legacy:<index> 位置键（info 不派生）', () => {
  const keys = collectFindingKeys(
    [
      { level: 'high', title: '本品在所选站点与区间内没有数据' },
      { level: 'medium', title: '定价高于竞品均值' },
      { level: 'info', title: '竞品差评集中在这些点上' },
      { level: 'low', title: 'BSR 落后于竞品均值' },
    ],
    { asin: 'B0LEGACY01' }
  )
  assert.deepEqual(keys, [
    { code: 'legacy:0', target: 'B0LEGACY01', level: 'high' },
    { code: 'legacy:1', target: 'B0LEGACY01', level: 'medium' },
    // info 是认知型结论、不是待办，不派生
    { code: 'legacy:3', target: 'B0LEGACY01', level: 'low' },
  ])
})

test('核验护栏：legacy 位置键永不参与核验（不许被误判成"已核验解决"）', () => {
  const updates = planDispositionUpdates({
    rows: [{ code: 'legacy:0', target: 'B0LEGACY01', status: 'claimed' }],
    // 新分析算出来的结论带真正的诊断码，永远不可能出现 `legacy:0`
    findingKeys: [{ code: 'cvr_down', target: 'B0LEGACY01', level: 'medium' }],
    inScopeTargets: ['B0LEGACY01'],
    analysisId: 99,
  })
  assert.deepEqual(updates, [], 'legacy 只能由用户手动撤销，不能被自动核验')
})

test('summarizeOpenFindings 的 clearedCount 只数待办（含 info 的总数不能拿来相减）', () => {
  const findingKeys = [
    { code: 'metric_acos_above', target: 'B0SUBJECT1', level: 'high' },
    { code: 'cvr_down', target: 'B0SUBJECT1', level: 'medium' },
    // info 级：可以销账，但不算待办
    { code: 'public_review_weakness', target: 'B0SUBJECT1', level: 'info' },
  ]

  // 一条都没销账：clearedCount 必须是 0
  // （若拿含 info 的 finding_count=3 去减 actionable=2，这里会算出 1 —— 列表会显示"已销账 1 条"）
  const none = summarizeOpenFindings({ findingKeys, dispositions: [] })
  assert.equal(none.actionableCount, 2)
  assert.equal(none.openCount, 2)
  assert.equal(none.clearedCount, 0)

  // 销掉 high 那条：报表读数与报警级别都跟着变，已销账记 1
  const partial = summarizeOpenFindings({
    findingKeys,
    dispositions: [{ code: 'metric_acos_above', target: 'B0SUBJECT1', status: 'claimed' }],
  })
  assert.equal(partial.openCount, 1)
  assert.equal(partial.openLevel, 'medium')
  assert.equal(partial.clearedCount, 1)
})

test('summarizeOpenFindings 全部销账后没有任何待处理项', () => {
  const summary = summarizeOpenFindings({
    findingKeys: [{ code: 'acos_up', target: 'B0SUBJECT1', level: 'high' }],
    dispositions: [{ code: 'acos_up', target: 'B0SUBJECT1', status: 'verified' }],
  })
  assert.equal(summary.openCount, 0)
  assert.equal(summary.openLevel, 'info')
})

test('核验：待核验的结论在下次分析里不再命中 → 置为已核验解决', () => {
  const updates = planDispositionUpdates({
    rows: [{ code: 'metric_acos_above', target: 'B0SUBJECT1', status: 'claimed' }],
    findingKeys: [{ code: 'cvr_down', target: 'B0SUBJECT1', level: 'medium' }],
    inScopeTargets: ['B0SUBJECT1'],
    analysisId: 42,
  })
  assert.deepEqual(updates, [
    {
      code: 'metric_acos_above',
      target: 'B0SUBJECT1',
      status: 'verified',
      analysisId: 42,
      reopened: false,
    },
  ])
})

test('核验：待核验的结论仍然命中 → 打回待处理并标记 reopened', () => {
  const updates = planDispositionUpdates({
    rows: [{ code: 'metric_acos_above', target: 'B0SUBJECT1', status: 'claimed' }],
    findingKeys: [{ code: 'metric_acos_above', target: 'B0SUBJECT1', level: 'high' }],
    inScopeTargets: ['B0SUBJECT1'],
    analysisId: 43,
  })
  assert.equal(updates.length, 1)
  assert.equal(updates[0].status, 'open')
  assert.equal(updates[0].reopened, true)
})

test('核验护栏：本次分析没有评估该目标时，待核验项一律不动（不许虚假销账）', () => {
  const updates = planDispositionUpdates({
    rows: [{ code: 'metric_acos_above', target: 'B0OTHER001', status: 'claimed' }],
    // 这次跑的是另一个 ASIN：名单里根本没有 B0OTHER001
    findingKeys: [{ code: 'cvr_down', target: 'B0SUBJECT1', level: 'medium' }],
    inScopeTargets: ['B0SUBJECT1'],
    analysisId: 44,
  })
  assert.deepEqual(updates, [], '不在评估范围内 → 既不核验通过、也不打回')
})

test('核验：已核验解决的结论再次命中视为复发，打回待处理', () => {
  const updates = planDispositionUpdates({
    rows: [{ code: 'acos_up', target: 'B0SUBJECT1', status: 'verified' }],
    findingKeys: [{ code: 'acos_up', target: 'B0SUBJECT1', level: 'high' }],
    inScopeTargets: ['B0SUBJECT1'],
    analysisId: 45,
  })
  assert.equal(updates.length, 1)
  assert.equal(updates[0].status, 'open')
  assert.equal(updates[0].reopened, true)
})

test('核验：已核验解决且仍不命中时保持原状（不写任何更新）', () => {
  const updates = planDispositionUpdates({
    rows: [{ code: 'acos_up', target: 'B0SUBJECT1', status: 'verified' }],
    findingKeys: [],
    inScopeTargets: ['B0SUBJECT1'],
    analysisId: 46,
  })
  assert.deepEqual(updates, [])
})

test('核验：用户选择「不处理」的结论是终局，命中与否都不自动改动', () => {
  const updates = planDispositionUpdates({
    rows: [{ code: 'public_price_below', target: 'B0COMPET01', status: 'ignored' }],
    findingKeys: [{ code: 'public_price_below', target: 'B0COMPET01', level: 'medium' }],
    inScopeTargets: ['B0COMPET01'],
    analysisId: 47,
  })
  assert.deepEqual(updates, [], 'ignored 是用户的长期决定，系统不再打扰')
})

test('核验：已打回且本次仍命中时只刷新"最近出现"，不让 reopen_count 虚高', () => {
  const updates = planDispositionUpdates({
    rows: [{ code: 'acos_up', target: 'B0SUBJECT1', status: 'open' }],
    findingKeys: [{ code: 'acos_up', target: 'B0SUBJECT1', level: 'high' }],
    inScopeTargets: ['B0SUBJECT1'],
    analysisId: 48,
  })
  assert.deepEqual(updates, [
    {
      code: 'acos_up',
      target: 'B0SUBJECT1',
      status: 'open',
      analysisId: 48,
      reopened: false,
    },
  ])
})

test('toHistoryItem 没有 finding_keys（老记录）时回退到快照自己的判定', () => {
  const item = toHistoryItem({
    id: 7,
    input_type: 'ASIN',
    input_value: 'B0SUBJECT1',
    asins: ['B0SUBJECT1'],
    marketplace: 'US',
    level: 'high',
    finding_count: 3,
    result: {},
  })
  assert.equal(item.openFindingCount, 3)
  assert.equal(item.openLevel, 'high')
})

test('toHistoryItem 用 finding_keys 与台账算出未销账条数，销账后不再计入报警', () => {
  const row = {
    id: 8,
    input_type: 'ASIN',
    input_value: 'B0SUBJECT1',
    asins: ['B0SUBJECT1'],
    marketplace: 'US',
    level: 'high',
    finding_count: 2,
    finding_keys: [
      { code: 'metric_acos_above', target: 'B0SUBJECT1', level: 'high' },
      { code: 'cvr_down', target: 'B0SUBJECT1', level: 'medium' },
    ],
  }
  const before = toHistoryItem(row, [])
  assert.equal(before.openFindingCount, 2)
  assert.equal(before.openLevel, 'high')

  const after = toHistoryItem(row, [
    { code: 'metric_acos_above', target: 'B0SUBJECT1', status: 'claimed' },
  ])
  assert.equal(after.openFindingCount, 1)
  assert.equal(after.openLevel, 'medium', 'high 那条已销账，剩下最高是 medium')

  const allCleared = toHistoryItem(row, [
    { code: 'metric_acos_above', target: 'B0SUBJECT1', status: 'claimed' },
    { code: 'cvr_down', target: 'B0SUBJECT1', status: 'ignored' },
  ])
  assert.equal(allCleared.openFindingCount, 0)
  assert.equal(allCleared.openLevel, 'info', '全部销账后首页不该再报警')
})

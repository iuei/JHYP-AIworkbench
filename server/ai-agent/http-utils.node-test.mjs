import assert from 'node:assert/strict'
import test from 'node:test'
import { KnowledgeValidationError } from './knowledge.mjs'
import {
  MAX_DATE_RANGE_DAYS,
  parseDateRange,
  optionalDate,
  parseBatchRequest,
  parsePageQuery,
} from './http-utils.mjs'

test('parseDateRange 未传时间时返回空范围（不筛时间）', () => {
  assert.deepEqual(parseDateRange({}), { from: null, to: null })
  assert.deepEqual(parseDateRange(), { from: null, to: null })
  assert.deepEqual(parseDateRange({ from: '', to: '' }), { from: null, to: null })
})

test('parseDateRange 把起止时间统一成 ISO，供列表与导出复用', () => {
  const range = parseDateRange({ from: '2026-09-01', to: '2026-09-11T23:59:59.999Z' })
  assert.equal(range.from, new Date('2026-09-01').toISOString())
  assert.equal(range.to, '2026-09-11T23:59:59.999Z')
})

test('parseDateRange 拒绝开始晚于结束（否则会静默查出空集合）', () => {
  assert.throws(
    () => parseDateRange({ from: '2026-09-12', to: '2026-09-11' }),
    (error) => error instanceof KnowledgeValidationError && /开始日期不能晚于结束日期/.test(error.message)
  )
})

test('parseDateRange 允许同一天，且限制最大跨度', () => {
  assert.doesNotThrow(() => parseDateRange({ from: '2026-09-11', to: '2026-09-11' }))
  const long = new Date('2026-09-01')
  const tooLate = new Date(long.getTime() + (MAX_DATE_RANGE_DAYS + 5) * 86400000)
  assert.throws(
    () => parseDateRange({ from: long.toISOString(), to: tooLate.toISOString() }),
    (error) => error instanceof KnowledgeValidationError && /不能超过/.test(error.message)
  )
  const justInside = new Date(long.getTime() + MAX_DATE_RANGE_DAYS * 86400000)
  assert.doesNotThrow(() => parseDateRange({ from: long.toISOString(), to: justInside.toISOString() }))
})

test('parseDateRange 对非法日期报错，不静默忽略筛选条件', () => {
  assert.throws(() => parseDateRange({ from: '昨天' }), KnowledgeValidationError)
  assert.throws(() => parseDateRange({ to: '2026-13-45' }), KnowledgeValidationError)
})

test('optionalDate 区分"未传"与"显式清空"', () => {
  assert.equal(optionalDate(undefined), undefined)
  assert.equal(optionalDate(null), null)
  assert.equal(optionalDate(''), null)
})

test('parsePageQuery 兜住非法分页参数并限制单页上限', () => {
  assert.deepEqual(parsePageQuery({}), { page: 1, pageSize: 20 })
  assert.deepEqual(parsePageQuery({ page: '0', pageSize: '999' }), { page: 1, pageSize: 100 })
  assert.deepEqual(parsePageQuery({ page: 'abc', pageSize: '-3' }), { page: 1, pageSize: 1 })
})

/* ---------- 批量接口校验（知识库与沉淀共用） ---------- */

const BATCH = {
  actions: ['offline', 'online', 'delete'],
  actionMessage: '批量动作只能是 offline（下线）/ online（启用）/ delete（删除）。',
  max: 200,
  subject: '篇文档',
}

test('parseBatchRequest 接受合法动作并原样返回 ids', () => {
  const result = parseBatchRequest({ action: 'offline', ids: [3, 1, 2] }, BATCH)
  assert.equal(result.ok, true)
  assert.equal(result.action, 'offline')
  assert.deepEqual(result.ids, [3, 1, 2])
})

test('parseBatchRequest 拒绝白名单外的动作', () => {
  for (const action of ['publish', 'OFFLINE', '', null, undefined, 7]) {
    const result = parseBatchRequest({ action, ids: [1] }, BATCH)
    assert.equal(result.ok, false, String(action))
    assert.match(result.message, /批量动作只能是/)
  }
})

test('parseBatchRequest 去掉重复与非法 id（重复会让"成功 N 条"虚高）', () => {
  const result = parseBatchRequest({ action: 'delete', ids: [5, '5', 5, 0, -1, 'abc', null, 9] }, BATCH)
  assert.equal(result.ok, true)
  assert.deepEqual(result.ids, [5, 9])
})

test('parseBatchRequest 在没有任何有效 id 时拒绝', () => {
  for (const ids of [[], ['x'], [0], [null], undefined, 'not-an-array']) {
    const result = parseBatchRequest({ action: 'delete', ids }, BATCH)
    assert.equal(result.ok, false, JSON.stringify(ids))
    assert.match(result.message, /请至少选择 1 篇文档/)
  }
})

test('parseBatchRequest 限制单批上限，并按 subject 给出可读原因', () => {
  const justRight = parseBatchRequest(
    { action: 'delete', ids: Array.from({ length: 200 }, (_, index) => index + 1) },
    BATCH
  )
  assert.equal(justRight.ok, true)

  const tooMany = parseBatchRequest(
    { action: 'delete', ids: Array.from({ length: 201 }, (_, index) => index + 1) },
    BATCH
  )
  assert.equal(tooMany.ok, false)
  assert.match(tooMany.message, /一次最多处理 200 篇文档/)
})

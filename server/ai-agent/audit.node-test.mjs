import assert from 'node:assert/strict'
import test from 'node:test'
import { AUDIT_ACTIONS, RUN_STATUS, summarizeValue } from './audit.mjs'

test('summarizeValue 处理空值与短文本', () => {
  assert.equal(summarizeValue(null), '')
  assert.equal(summarizeValue(undefined), '')
  assert.equal(summarizeValue('短文本'), '短文本')
  assert.equal(summarizeValue(0), '0')
  assert.equal(summarizeValue(false), 'false')
})

test('summarizeValue 默认截断到 200 字符并加省略号', () => {
  const long = 'a'.repeat(500)
  const summary = summarizeValue(long)
  assert.equal(summary.length, 201)
  assert.ok(summary.endsWith('…'))
  assert.equal(summarizeValue(long, 10), `${'a'.repeat(10)}…`)
})

test('summarizeValue 把对象压成单行 JSON 文本', () => {
  const summary = summarizeValue({ query: '断货补货', topK: 5 })
  assert.equal(summary, '{"query":"断货补货","topK":5}')
  assert.ok(!summary.includes('\n'))
})

test('summarizeValue 对循环引用不抛错', () => {
  const cyclic = { name: 'x' }
  cyclic.self = cyclic
  assert.equal(summarizeValue(cyclic), '')
})

test('summarizeValue 折叠换行与多余空白', () => {
  assert.equal(summarizeValue('第一行\n\n  第二行'), '第一行 第二行')
})

test('审计动作常量覆盖本期需要的事件', () => {
  assert.equal(AUDIT_ACTIONS.login, 'login')
  assert.equal(AUDIT_ACTIONS.docUpload, 'doc_upload')
  assert.equal(AUDIT_ACTIONS.docOffline, 'doc_offline')
  assert.equal(AUDIT_ACTIONS.docDelete, 'doc_delete')
  assert.equal(AUDIT_ACTIONS.reindex, 'reindex')
  assert.equal(AUDIT_ACTIONS.auditExport, 'audit_export')
  assert.equal(AUDIT_ACTIONS.toolBlocked, 'tool_blocked')
  assert.equal(AUDIT_ACTIONS.forbidden, 'forbidden')
})

test('工具调用状态与数据库 CHECK 约束一致', () => {
  assert.deepEqual(Object.values(RUN_STATUS).sort(), ['blocked', 'error', 'ok', 'pending'])
})

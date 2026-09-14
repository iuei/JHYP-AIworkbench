import assert from 'node:assert/strict'
import test from 'node:test'
import { TOOL_CONTRACTS, findToolContract } from './tool-contracts.mjs'
import {
  BLOCKED_MESSAGE,
  GUARDRAILS,
  REJECT_REASON,
  assertDateRange,
  executeTool,
  hasExecutor,
  listToolDefinitions,
  toolDefinitionsToOpenAi,
  truncateRows,
  validateParams,
} from './tools.mjs'

const admin = { id: 1, login: 'admin', role: 'admin', status: 'enabled' }
const operator = { id: 2, login: 'op', role: 'operator', status: 'enabled' }

const searchToolRow = { name: 'search_knowledge', required_role: 'user', enabled: true }
const reindexToolRow = { name: 'rebuild_knowledge_index', required_role: 'admin', enabled: true }
const registeredForOperator = [searchToolRow]
const registeredForAdmin = [searchToolRow, reindexToolRow]

const searchContract = findToolContract('search_knowledge')

test('validateParams 拒绝超长字符串（默认上限 200）', () => {
  const result = validateParams(searchContract.paramsSchema, { query: 'a'.repeat(201) })
  assert.equal(result.ok, false)
  assert.match(result.error, /200 个字符上限/)
  assert.equal(validateParams(searchContract.paramsSchema, { query: 'a'.repeat(200) }).ok, true)
})

test('validateParams 拒绝缺失必填、空串必填与多余参数', () => {
  assert.equal(validateParams(searchContract.paramsSchema, {}).ok, false)
  assert.equal(validateParams(searchContract.paramsSchema, { query: '   ' }).ok, false)
  const extra = validateParams(searchContract.paramsSchema, { query: '补货', hack: 1 })
  assert.equal(extra.ok, false)
  assert.match(extra.error, /不支持的参数：hack/)
})

test('validateParams 拒绝枚举外取值与越界数值', () => {
  const enumFail = validateParams(searchContract.paramsSchema, {
    query: '补货',
    sourceType: 'internal',
  })
  assert.equal(enumFail.ok, false)
  assert.match(enumFail.error, /必须是/)

  assert.equal(validateParams(searchContract.paramsSchema, { query: '补货', topK: 999 }).ok, false)
  assert.equal(validateParams(searchContract.paramsSchema, { query: '补货', topK: 0 }).ok, false)
  assert.equal(validateParams(searchContract.paramsSchema, { query: '补货', topK: 10 }).ok, true)
})

test('validateParams 拒绝类型不符并去除字符串首尾空白', () => {
  assert.equal(validateParams(searchContract.paramsSchema, { query: 123 }).ok, false)
  const ok = validateParams(searchContract.paramsSchema, { query: '  补货流程  ' })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.query, '补货流程')
})

test('validateParams 对无参数工具也做对象校验', () => {
  const reindex = findToolContract('rebuild_knowledge_index')
  assert.equal(validateParams(reindex.paramsSchema, {}).ok, true)
  assert.equal(validateParams(reindex.paramsSchema, { name: 'x' }).ok, false)
  assert.equal(validateParams(reindex.paramsSchema, null).ok, false)
})

test('assertDateRange 限制区间 366 天并校验成对与顺序', () => {
  assert.equal(assertDateRange('2026-01-01', '2026-12-31').ok, true)
  assert.equal(assertDateRange('2026-01-01', '2027-01-01').days, 366)
  const tooLong = assertDateRange('2026-01-01', '2027-01-02')
  assert.equal(tooLong.ok, false)
  assert.match(tooLong.error, /366 天/)

  assert.equal(assertDateRange('2026-01-01', undefined).ok, false)
  assert.equal(assertDateRange(undefined, '2026-01-01').ok, false)
  assert.equal(assertDateRange('2026-05-01', '2026-01-01').ok, false)
  assert.equal(assertDateRange('2026/01/01', '2026-01-02').ok, false)
  assert.equal(assertDateRange(undefined, undefined).ok, true)
})

test('truncateRows 限制返回行数 2000 并标记截断', () => {
  assert.equal(GUARDRAILS.MAX_ROWS, 2000)
  const small = truncateRows([1, 2, 3])
  assert.equal(small.truncated, false)
  assert.equal(small.total, 3)
  const big = truncateRows(Array.from({ length: 2500 }, (_, index) => index))
  assert.equal(big.rows.length, 2000)
  assert.equal(big.truncated, true)
  assert.equal(big.total, 2500)
  assert.deepEqual(truncateRows(null).rows, [])
})

test('模型幻觉出的工具名被拦下并标记 not_registered', async () => {
  const result = await executeTool({
    user: admin,
    registeredTools: registeredForAdmin,
    toolName: 'drop_all_tables',
  })
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, REJECT_REASON.notRegistered)
  assert.match(result.error, /不在当前可用列表中/)
  assert.deepEqual(result.rows, [])
})

test('普通用户调用管理员工具被拦下并写入统一拦截文案', async () => {
  const result = await executeTool({
    user: operator,
    registeredTools: registeredForOperator,
    toolName: 'rebuild_knowledge_index',
    params: {},
  })
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, REJECT_REASON.forbidden)
  assert.equal(result.error, BLOCKED_MESSAGE)
})

test('即使工具出现在注册列表中，执行前二次校验仍会拦下越权调用', async () => {
  const result = await executeTool({
    user: operator,
    // 模拟注册列表被篡改 / 权限刚被收回的情况
    registeredTools: [...registeredForOperator, reindexToolRow],
    toolName: 'rebuild_knowledge_index',
    params: {},
  })
  assert.equal(result.status, 'blocked')
  assert.equal(result.reason, REJECT_REASON.forbidden)
  assert.equal(result.error, BLOCKED_MESSAGE)
})

test('参数不合法时被拦下且不泄露权限信息', async () => {
  for (const params of [
    {},
    { query: 'a'.repeat(500) },
    { query: '补货', topK: 999 },
    { query: '补货', sourceType: 'internal' },
  ]) {
    const result = await executeTool({
      user: operator,
      registeredTools: registeredForOperator,
      toolName: 'search_knowledge',
      params,
    })
    assert.equal(result.status, 'blocked')
    assert.equal(result.reason, REJECT_REASON.invalidParams)
    assert.notEqual(result.error, BLOCKED_MESSAGE)
    assert.ok(!result.error.includes('$1'))
  }
})

test('停用账号调用任何工具都被拦下', async () => {
  const result = await executeTool({
    user: { id: 3, role: 'admin', status: 'disabled' },
    registeredTools: registeredForOperator,
    toolName: 'search_knowledge',
    params: { query: '补货' },
  })
  assert.equal(result.status, 'blocked')
  assert.equal(result.error, BLOCKED_MESSAGE)
})

test('每个工具都有实现，且工具定义带角色与审计字段', () => {
  const definitions = listToolDefinitions()
  assert.equal(definitions.length, TOOL_CONTRACTS.length)
  const names = definitions.map((definition) => definition.name)
  for (const expected of [
    'search_knowledge',
    'rebuild_knowledge_index',
    'deactivate_document',
    'query_amazon_performance',
    'query_inventory_orders',
  ]) {
    assert.ok(names.includes(expected), `缺少工具 ${expected}`)
  }
  for (const definition of definitions) {
    assert.equal(hasExecutor(definition.name), true, definition.name)
    assert.ok(['user', 'admin'].includes(definition.requiredRole))
    assert.ok(Array.isArray(definition.auditFields))
  }
  assert.equal(hasExecutor('not_implemented_tool'), false)
})

test('toolDefinitionsToOpenAi 输出 Function Calling 结构且字段齐全', () => {
  const tools = toolDefinitionsToOpenAi(registeredForAdmin)
  assert.equal(tools.length, registeredForAdmin.length)
  assert.equal(tools[0].type, 'function')
  for (const tool of tools) {
    assert.ok(tool.function.name.length > 0)
    assert.ok(tool.function.description.length > 0)
    assert.equal(tool.function.parameters.type, 'object')
  }
  assert.deepEqual(toolDefinitionsToOpenAi(null), [])
})

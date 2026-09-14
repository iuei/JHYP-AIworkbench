import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BLOCKED_MESSAGE,
  allowedRolesOf,
  canManageNote,
  canOwnNote,
  canSeeDocument,
  canSeeNote,
  canUseTool,
  documentScopeSql,
  isDocumentActive,
  noteScopeSql,
  registerableTools,
  requiredRoleAllows,
} from './permissions.mjs'

const admin = { id: 1, login: 'admin', role: 'admin', status: 'enabled' }
const operator = { id: 2, login: '16686400050', role: 'operator', status: 'enabled' }
const disabledAdmin = { id: 3, login: 'off', role: 'admin', status: 'disabled' }

const searchTool = { name: 'search_knowledge', required_role: 'user', enabled: true }
const reindexTool = { name: 'rebuild_knowledge_index', required_role: 'admin', enabled: true }
const offlineTool = { name: 'deactivate_document', required_role: 'admin', enabled: true }
const disabledTool = { name: 'search_knowledge', required_role: 'user', enabled: false }

test('普通用户可用 user 级工具，不可用 admin 级工具', () => {
  assert.equal(canUseTool(operator, searchTool), true)
  assert.equal(canUseTool(operator, reindexTool), false)
  assert.equal(canUseTool(operator, offlineTool), false)
})

test('管理员两类工具都可用', () => {
  assert.equal(canUseTool(admin, searchTool), true)
  assert.equal(canUseTool(admin, reindexTool), true)
  assert.equal(canUseTool(admin, offlineTool), true)
})

test('停用账号一律拒绝，即使角色是管理员', () => {
  assert.equal(canUseTool(disabledAdmin, searchTool), false)
  assert.equal(canUseTool(disabledAdmin, reindexTool), false)
  assert.equal(requiredRoleAllows('user', disabledAdmin), false)
  assert.equal(requiredRoleAllows('admin', disabledAdmin), false)
})

test('被停用的工具对管理员同样拒绝', () => {
  assert.equal(canUseTool(admin, disabledTool), false)
  assert.equal(canUseTool(operator, disabledTool), false)
})

test('未知角色声明或非法入参一律拒绝（拒绝优先）', () => {
  assert.equal(requiredRoleAllows('superuser', admin), false)
  assert.equal(requiredRoleAllows(undefined, admin), false)
  assert.equal(canUseTool(admin, null), false)
  assert.equal(canUseTool(admin, {}), false)
  assert.equal(canUseTool(null, searchTool), false)
})

test('工具契约支持 requiredRole 驼峰写法（数据库行用 required_role）', () => {
  assert.equal(canUseTool(operator, { requiredRole: 'user', enabled: true }), true)
  assert.equal(canUseTool(operator, { requiredRole: 'admin', enabled: true }), false)
})

test('registerableTools 只返回该用户有权限且启用的工具', () => {
  const all = [searchTool, reindexTool, offlineTool, disabledTool]
  assert.deepEqual(
    registerableTools(operator, all).map((tool) => tool.name),
    ['search_knowledge']
  )
  assert.deepEqual(
    registerableTools(admin, all).map((tool) => tool.name),
    ['search_knowledge', 'rebuild_knowledge_index', 'deactivate_document']
  )
  assert.deepEqual(registerableTools(admin, null), [])
})

test('非生效或已过期文档不可见', () => {
  const now = new Date('2026-09-10T00:00:00Z')
  assert.equal(isDocumentActive({ status: 'inactive' }, now), false)
  assert.equal(isDocumentActive({ status: 'active', expires_at: null }, now), true)
  assert.equal(
    isDocumentActive({ status: 'active', expires_at: '2026-09-09T00:00:00Z' }, now),
    false
  )
  assert.equal(
    isDocumentActive({ status: 'active', expires_at: '2026-09-11T00:00:00Z' }, now),
    true
  )
  assert.equal(isDocumentActive({ status: 'active', expires_at: '不是日期' }, now), false)
})

test('data_scope 为空时两个角色都能看到文档', () => {
  const document = { status: 'active', expires_at: null, data_scope: {} }
  assert.deepEqual(allowedRolesOf(document), [])
  assert.equal(canSeeDocument(operator, document), true)
  assert.equal(canSeeDocument(admin, document), true)
})

test('data_scope 限定角色时按角色过滤', () => {
  const document = {
    status: 'active',
    expires_at: null,
    data_scope: { roles: ['admin'] },
  }
  assert.equal(canSeeDocument(admin, document), true)
  assert.equal(canSeeDocument(operator, document), false)
  assert.equal(canSeeDocument(operator, { ...document, data_scope: { roles: ['operator'] } }), true)
})

test('data_scope 结构异常时按"无范围限制"处理，不抛错', () => {
  for (const scope of [null, undefined, 'x', { roles: 'admin' }, { roles: [1, 2] }]) {
    const document = { status: 'active', expires_at: null, data_scope: scope }
    assert.deepEqual(allowedRolesOf(document), [])
    assert.equal(canSeeDocument(operator, document), true)
  }
})

test('停用账号看不到任何文档', () => {
  assert.equal(canSeeDocument(disabledAdmin, { status: 'active', data_scope: {} }), false)
})

test('documentScopeSql 生成参数化条件且校验占位符', () => {
  const scope = documentScopeSql(operator, '$2')
  assert.match(scope.clause, /d\.status = 'active'/)
  assert.match(scope.clause, /d\.expires_at > NOW\(\)/)
  assert.match(scope.clause, /jsonb_typeof/)
  assert.ok(scope.clause.includes('$2'))
  assert.equal(scope.param, 'operator')
  assert.throws(() => documentScopeSql(operator, '2'), /占位符/)
  assert.throws(() => documentScopeSql(operator), /占位符/)
})

test('未登录用户角色为空字符串，不会匹配到任何限定角色', () => {
  assert.equal(documentScopeSql(null, '$1').param, '')
})

test('拦截文案统一，不泄露权限结构', () => {
  assert.equal(BLOCKED_MESSAGE, '当前账号无权查询该数据，请联系管理员。')
  assert.ok(!/管理员工具|admin 工具|你有/.test(BLOCKED_MESSAGE))
})

test('noteScopeSql 按账号隔离沉淀条目，参数化且校验占位符', () => {
  const scope = noteScopeSql(operator, '$3')
  assert.equal(scope.clause, 'n.owner_user_id = $3')
  assert.equal(scope.param, operator.id)
  assert.throws(() => noteScopeSql(operator, '3'), /占位符/)
  assert.throws(() => noteScopeSql(operator), /占位符/)
})

test('noteScopeSql 对未登录用户给出不可能命中的账号 ID', () => {
  assert.equal(noteScopeSql(null, '$1').param, -1)
})

test('沉淀可见性：本人与管理员可见，他人不可见', () => {
  const note = { owner_user_id: operator.id, deleted_at: null }
  assert.equal(canSeeNote(operator, note), true)
  assert.equal(canSeeNote(admin, note), true)
  assert.equal(canSeeNote({ ...operator, id: 99 }, note), false)
})

test('沉淀可见性：软删与停用账号一律不可见', () => {
  const note = { owner_user_id: operator.id, deleted_at: '2026-09-11T00:00:00Z' }
  assert.equal(canSeeNote(operator, note), false)
  assert.equal(canSeeNote(admin, note), false)
  assert.equal(canSeeNote(disabledAdmin, { owner_user_id: 3, deleted_at: null }), false)
  assert.equal(canSeeNote(operator, null), false)
})

test('员工接口只认所有者：管理员看他人条目也一律不可见（可见 ≠ 可操作）', () => {
  const note = { owner_user_id: operator.id, deleted_at: null }
  assert.equal(canOwnNote(operator, note), true)
  // 这条是本轮加固的核心：管理员在员工接口上拿不到他人条目，避免借员工接口绕过管理审计
  assert.equal(canOwnNote(admin, note), false)
  assert.equal(canOwnNote({ ...operator, id: 99 }, note), false)
  assert.equal(canOwnNote(operator, null), false)
  assert.equal(canOwnNote({ ...operator, status: 'disabled' }, note), false)
})

test('管理接口只认启用管理员，且软删条目不再可见', () => {
  const note = { owner_user_id: operator.id, deleted_at: null }
  assert.equal(canManageNote(admin, note), true)
  assert.equal(canManageNote(operator, note), false)
  assert.equal(canManageNote(disabledAdmin, note), false)
  assert.equal(canManageNote(admin, { ...note, deleted_at: '2026-09-11T00:00:00Z' }), false)
  assert.equal(canManageNote(admin, null), false)
})

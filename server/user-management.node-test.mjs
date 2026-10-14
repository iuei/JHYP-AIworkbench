import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeUserDeletionBlock,
  isEnabledAdmin,
  isEnabledUser,
  isLastEnabledAdminDemotion,
  isLastEnabledAdminRemoval,
  parseUserCreate,
  parseUserRegister,
  parseUserStatusUpdate,
  parseUserUpdate,
  UserUpdateValidationError,
} from './user-management.mjs'

test('isEnabledUser requires a persisted enabled account', () => {
  assert.equal(isEnabledUser({ id: 1, status: 'enabled' }), true)
  assert.equal(isEnabledUser({ id: 1, status: 'disabled' }), false)
  assert.equal(isEnabledUser(undefined), false)
})

test('isEnabledAdmin requires both the admin role and enabled status', () => {
  assert.equal(isEnabledAdmin({ role: 'admin', status: 'enabled' }), true)
  assert.equal(isEnabledAdmin({ role: 'operator', status: 'enabled' }), false)
  assert.equal(isEnabledAdmin({ role: 'admin', status: 'disabled' }), false)
})

test('parseUserUpdate trims the name and accepts supported roles', () => {
  assert.deepEqual(parseUserUpdate({ name: '  张三  ', role: 'admin' }), {
    name: '张三',
    role: 'admin',
    department: null,
  })
})

test('parseUserUpdate treats a missing department as "keep current"', () => {
  assert.equal(parseUserUpdate({ name: '张三', role: 'operator' }).department, null)
  assert.equal(
    parseUserUpdate({ name: '张三', role: 'operator', department: undefined })
      .department,
    null
  )
})

test('parseUserUpdate trims a supplied department and allows clearing it', () => {
  assert.equal(
    parseUserUpdate({ name: '张三', role: 'operator', department: ' 供应链部 ' })
      .department,
    '供应链部'
  )
  assert.equal(
    parseUserUpdate({ name: '张三', role: 'operator', department: '   ' })
      .department,
    ''
  )
})

test('parseUserUpdate rejects an over-long department name', () => {
  assert.throws(
    () =>
      parseUserUpdate({
        name: '张三',
        role: 'operator',
        department: '部'.repeat(41),
      }),
    UserUpdateValidationError
  )
})

test('parseUserCreate requires account, name and password', () => {
  assert.throws(
    () => parseUserCreate({ login: '', name: '张三', password: 'secret123' }),
    UserUpdateValidationError
  )
  assert.throws(
    () => parseUserCreate({ login: 'a@b.com', name: '', password: 'secret123' }),
    UserUpdateValidationError
  )
  assert.throws(
    () => parseUserCreate({ login: 'a@b.com', name: '张三', password: '' }),
    UserUpdateValidationError
  )
})

test('parseUserCreate defaults the role and normalises the department', () => {
  assert.deepEqual(
    parseUserCreate({
      login: ' a@b.com ',
      name: ' 张三 ',
      password: 'secret123',
    }),
    {
      login: 'a@b.com',
      name: '张三',
      password: 'secret123',
      role: 'operator',
      department: '',
    }
  )
  assert.equal(
    parseUserCreate({
      login: 'a@b.com',
      name: '张三',
      password: 'secret123',
      role: 'admin',
      department: ' 供应链部 ',
    }).department,
    '供应链部'
  )
})

test('parseUserCreate rejects unsupported roles and over-long fields', () => {
  assert.throws(
    () =>
      parseUserCreate({
        login: 'a@b.com',
        name: '张三',
        password: 'secret123',
        role: 'guest',
      }),
    UserUpdateValidationError
  )
  assert.throws(
    () =>
      parseUserCreate({
        login: 'a@b.com',
        name: '张三',
        password: 'secret123',
        department: '部'.repeat(41),
      }),
    UserUpdateValidationError
  )
})

test('parseUserRegister trims the account and name and drops role/department', () => {
  assert.deepEqual(
    parseUserRegister({
      login: ' 13800000000 ',
      name: ' 李四 ',
      password: 'secret123',
      // 注册者自带 role/department 必须被丢弃：请求体由客户端构造，
      // 带上 role='admin' 就是一条自助提权路径；部门属管理信息，留给管理员审核时补。
      role: 'admin',
      department: '供应链部',
    }),
    { login: '13800000000', name: '李四', password: 'secret123' }
  )
})

test('parseUserRegister requires account, name and password', () => {
  assert.throws(
    () => parseUserRegister({ login: '', name: '李四', password: 'secret123' }),
    UserUpdateValidationError
  )
  assert.throws(
    () =>
      parseUserRegister({ login: '13800000000', name: '  ', password: 'secret123' }),
    UserUpdateValidationError
  )
  assert.throws(
    () => parseUserRegister({ login: '13800000000', name: '李四', password: '' }),
    UserUpdateValidationError
  )
})

test('parseUserRegister enforces the 8-128 password window', () => {
  assert.throws(
    () =>
      parseUserRegister({ login: '13800000000', name: '李四', password: '1234567' }),
    UserUpdateValidationError
  )
  assert.throws(
    () =>
      parseUserRegister({
        login: '13800000000',
        name: '李四',
        password: 'a'.repeat(129),
      }),
    UserUpdateValidationError
  )
  // 边界值必须放行（8 与 128）
  assert.equal(
    parseUserRegister({ login: '13800000000', name: '李四', password: '12345678' })
      .password,
    '12345678'
  )
  assert.equal(
    parseUserRegister({
      login: '13800000000',
      name: '李四',
      password: 'a'.repeat(128),
    }).password.length,
    128
  )
})

test('parseUserRegister rejects an over-long account or name', () => {
  assert.throws(
    () =>
      parseUserRegister({ login: 'a'.repeat(121), name: '李四', password: 'secret123' }),
    UserUpdateValidationError
  )
  assert.throws(
    () =>
      parseUserRegister({
        login: '13800000000',
        name: '李'.repeat(81),
        password: 'secret123',
      }),
    UserUpdateValidationError
  )
})

test('parseUserUpdate rejects empty names and unsupported roles', () => {
  assert.throws(
    () => parseUserUpdate({ name: '  ', role: 'admin' }),
    UserUpdateValidationError
  )
  assert.throws(
    () => parseUserUpdate({ name: '张三', role: 'guest' }),
    UserUpdateValidationError
  )
})

test('parseUserStatusUpdate accepts only supported statuses', () => {
  assert.equal(parseUserStatusUpdate({ status: 'disabled' }), 'disabled')
  assert.throws(
    () => parseUserStatusUpdate({ status: 'pending' }),
    UserUpdateValidationError
  )
})

test('isLastEnabledAdminDemotion only blocks the final enabled admin', () => {
  assert.equal(
    isLastEnabledAdminDemotion({
      currentRole: 'admin',
      currentStatus: 'enabled',
      nextRole: 'operator',
      otherEnabledAdminCount: 0,
    }),
    true
  )
  assert.equal(
    isLastEnabledAdminDemotion({
      currentRole: 'admin',
      currentStatus: 'enabled',
      nextRole: 'operator',
      otherEnabledAdminCount: 1,
    }),
    false
  )
  assert.equal(
    isLastEnabledAdminDemotion({
      currentRole: 'operator',
      currentStatus: 'enabled',
      nextRole: 'admin',
      otherEnabledAdminCount: 0,
    }),
    false
  )
})

test('isLastEnabledAdminRemoval also blocks disabling the final admin', () => {
  assert.equal(
    isLastEnabledAdminRemoval({
      currentRole: 'admin',
      currentStatus: 'enabled',
      nextRole: 'admin',
      nextStatus: 'disabled',
      otherEnabledAdminCount: 0,
    }),
    true
  )
})

test('describeUserDeletionBlock allows deleting another account', () => {
  assert.equal(
    describeUserDeletionBlock({
      actorId: 1,
      targetId: 2,
      targetRole: 'operator',
      targetStatus: 'enabled',
      otherEnabledAdminCount: 1,
    }),
    null
  )
  // 目标管理员不是"最后一个启用管理员"时也放行
  assert.equal(
    describeUserDeletionBlock({
      actorId: 1,
      targetId: 2,
      targetRole: 'admin',
      targetStatus: 'enabled',
      otherEnabledAdminCount: 1,
    }),
    null
  )
})

test('describeUserDeletionBlock refuses deleting yourself', () => {
  assert.equal(
    describeUserDeletionBlock({
      actorId: 7,
      targetId: 7,
      targetRole: 'admin',
      targetStatus: 'enabled',
      otherEnabledAdminCount: 3,
    }),
    '不能删除自己的账号。'
  )
})

test('describeUserDeletionBlock protects the final enabled admin', () => {
  assert.equal(
    describeUserDeletionBlock({
      actorId: 1,
      targetId: 2,
      targetRole: 'admin',
      targetStatus: 'enabled',
      otherEnabledAdminCount: 0,
    }),
    '必须至少保留一个已启用的管理员。'
  )
  // 已停用的管理员不占"启用管理员"名额，删除它不影响闸门
  assert.equal(
    describeUserDeletionBlock({
      actorId: 1,
      targetId: 2,
      targetRole: 'admin',
      targetStatus: 'disabled',
      otherEnabledAdminCount: 0,
    }),
    null
  )
  // 普通账号永远不触发这条闸门
  assert.equal(
    describeUserDeletionBlock({
      actorId: 1,
      targetId: 2,
      targetRole: 'operator',
      targetStatus: 'enabled',
      otherEnabledAdminCount: 0,
    }),
    null
  )
})

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isEnabledAdmin,
  isEnabledUser,
  isLastEnabledAdminDemotion,
  isLastEnabledAdminRemoval,
  parseUserCreate,
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

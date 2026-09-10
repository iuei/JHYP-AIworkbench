import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isEnabledAdmin,
  isEnabledUser,
  isLastEnabledAdminDemotion,
  isLastEnabledAdminRemoval,
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
  })
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

const supportedRoles = new Set(['admin', 'operator'])
const supportedStatuses = new Set(['enabled', 'disabled'])

export class UserUpdateValidationError extends Error {}

export function isEnabledUser(user) {
  return Boolean(user?.id && user.status === 'enabled')
}

export function isEnabledAdmin(user) {
  return user?.role === 'admin' && user?.status === 'enabled'
}

export function parseUserUpdate(input) {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  const role = input?.role

  if (!name || name.length > 80) {
    throw new UserUpdateValidationError('姓名不能为空且不能超过 80 个字符。')
  }
  if (!supportedRoles.has(role)) {
    throw new UserUpdateValidationError('角色参数无效。')
  }

  return { name, role }
}

export function parseUserStatusUpdate(input) {
  const status = input?.status
  if (!supportedStatuses.has(status)) {
    throw new UserUpdateValidationError('状态参数无效。')
  }
  return status
}

export function isLastEnabledAdminRemoval({
  currentRole,
  currentStatus,
  nextRole,
  nextStatus,
  otherEnabledAdminCount,
}) {
  return (
    currentRole === 'admin' &&
    currentStatus === 'enabled' &&
    (nextRole !== 'admin' || nextStatus !== 'enabled') &&
    otherEnabledAdminCount === 0
  )
}

export function isLastEnabledAdminDemotion({
  currentRole,
  currentStatus,
  nextRole,
  otherEnabledAdminCount,
}) {
  return isLastEnabledAdminRemoval({
    currentRole,
    currentStatus,
    nextRole,
    nextStatus: currentStatus,
    otherEnabledAdminCount,
  })
}

const supportedRoles = new Set(['admin', 'operator'])
const supportedStatuses = new Set(['enabled', 'disabled'])
const MAX_DEPARTMENT_LENGTH = 40

export class UserUpdateValidationError extends Error {}

export function isEnabledUser(user) {
  return Boolean(user?.id && user.status === 'enabled')
}

export function isEnabledAdmin(user) {
  return user?.role === 'admin' && user?.status === 'enabled'
}

/**
 * 部门由管理员配置、用户只读。
 *
 * `department` 未传时返回 null（而不是空串），SQL 侧用 COALESCE 保留原值：
 * 这样不携带该字段的旧调用方不会把已有部门静默清空，显式传空串才是清空。
 */
export function parseUserUpdate(input) {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  const role = input?.role
  const department =
    typeof input?.department === 'string' ? input.department.trim() : null

  if (!name || name.length > 80) {
    throw new UserUpdateValidationError('姓名不能为空且不能超过 80 个字符。')
  }
  if (!supportedRoles.has(role)) {
    throw new UserUpdateValidationError('角色参数无效。')
  }
  if (department !== null && department.length > MAX_DEPARTMENT_LENGTH) {
    throw new UserUpdateValidationError(
      `部门名称不能超过 ${MAX_DEPARTMENT_LENGTH} 个字符。`
    )
  }

  return { name, role, department }
}

export function parseUserCreate(input) {
  const login = typeof input?.login === 'string' ? input.login.trim() : ''
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  const password = typeof input?.password === 'string' ? input.password : ''
  const role = input?.role ?? 'operator'
  const department =
    typeof input?.department === 'string' ? input.department.trim() : ''

  if (!login || !name || !password) {
    throw new UserUpdateValidationError('请完整填写账号、姓名和初始密码。')
  }
  if (!supportedRoles.has(role)) {
    throw new UserUpdateValidationError('角色参数无效。')
  }
  if (login.length > 120) {
    throw new UserUpdateValidationError('登录账号不能超过 120 个字符。')
  }
  if (name.length > 80) {
    throw new UserUpdateValidationError('姓名不能超过 80 个字符。')
  }
  if (department.length > MAX_DEPARTMENT_LENGTH) {
    throw new UserUpdateValidationError(
      `部门名称不能超过 ${MAX_DEPARTMENT_LENGTH} 个字符。`
    )
  }

  return { login, name, password, role, department }
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

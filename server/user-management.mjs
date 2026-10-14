const supportedRoles = new Set(['admin', 'operator'])
const supportedStatuses = new Set(['enabled', 'disabled'])
const MAX_DEPARTMENT_LENGTH = 40

/**
 * 自助注册后的初始状态：行已落库但不可登录，等管理员在用户管理页放行。
 *
 * 它刻意**不在** `supportedStatuses` 里 —— 那是「管理员可设置的状态」集合，
 * 允许把已启用/已停用的账号改回"待审核"只会制造混乱（用户会以为自己被退回申请）。
 */
export const PENDING_USER_STATUS = 'pending'

/** 自助注册的密码长度口径：公开接口，必须挡住弱密码与超长输入 */
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 128

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

/**
 * 自助注册的入参校验（公开接口，逐项严格校验）。
 *
 * 与 `parseUserCreate`（管理员开通）的两处刻意差异：
 *   1. **不接受 role / department**：注册者若能自带 role 就是一条自助提权路径，
 *      部门也属于管理信息，留给管理员审核时补填；
 *   2. **密码强制 8–128 位**：注册接口对未登录者开放，弱密码（如 "1"）会让审核放行后的账号形同虚设。
 *      管理员开通接口目前未同步该校验，口径差异见责任田「注意事项」，避免顺手改动影响既有调用方。
 */
export function parseUserRegister(input) {
  const login = typeof input?.login === 'string' ? input.login.trim() : ''
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  const password = typeof input?.password === 'string' ? input.password : ''

  if (!login || !name || !password) {
    throw new UserUpdateValidationError('请完整填写账号、姓名和密码。')
  }
  if (login.length > 120) {
    throw new UserUpdateValidationError('登录账号不能超过 120 个字符。')
  }
  if (name.length > 80) {
    throw new UserUpdateValidationError('姓名不能超过 80 个字符。')
  }
  if (
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    throw new UserUpdateValidationError(
      `密码长度需为 ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} 位。`
    )
  }

  return { login, name, password }
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

/**
 * 删除账号前的守卫（纯函数，便于单测）：返回 null 表示允许删除，否则返回中文拒绝原因。
 *
 * 两条规则与改角色 / 停用共用同一套口径：
 *   - 不能删自己：管理员误删自己会当场失去管理入口（且是同一类"最后一根稻草"风险）；
 *   - 必须至少保留一个已启用的管理员：删除不可逆，比停用更需要这道闸。
 *
 * 注意这里不复用 `isLastEnabledAdminRemoval`：那个函数的语义是"这次变更会不会让启用管理员归零"，
 * 需要拼一个假的 nextRole/nextStatus；删除的判断条件就是它的一半，直接写更清楚。
 */
export function describeUserDeletionBlock({
  actorId,
  targetId,
  targetRole,
  targetStatus,
  otherEnabledAdminCount,
}) {
  if (actorId === targetId) {
    return '不能删除自己的账号。'
  }
  if (
    targetRole === 'admin' &&
    targetStatus === 'enabled' &&
    otherEnabledAdminCount === 0
  ) {
    return '必须至少保留一个已启用的管理员。'
  }
  return null
}

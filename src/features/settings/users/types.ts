export type UserRole = 'admin' | 'operator'
/**
 * `pending` = 自助注册后等待管理员审核的中间态。
 *
 * 它只可能由 `/api/auth/register` 写入，**不可能**由管理员通过状态接口设置
 * （`parseUserStatusUpdate` 只接受 enabled / disabled）—— 把已有账号改回"待审核"
 * 没有业务含义，只会让用户以为自己被退回了申请。
 */
export type UserStatus = 'enabled' | 'disabled' | 'pending'

export type ManagedUser = {
  id: number
  login: string
  name: string
  role: UserRole
  /** 部门由管理员在此维护，用户信息页只读展示；未设置时为空串。 */
  department: string
  status: UserStatus
  last_login_at: string | null
}

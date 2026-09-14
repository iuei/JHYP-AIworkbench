export type UserRole = 'admin' | 'operator'
export type UserStatus = 'enabled' | 'disabled'

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

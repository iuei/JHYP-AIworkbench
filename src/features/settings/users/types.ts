export type UserRole = 'admin' | 'operator'
export type UserStatus = 'enabled' | 'disabled'

export type ManagedUser = {
  id: number
  login: string
  name: string
  role: UserRole
  status: UserStatus
  last_login_at: string | null
}

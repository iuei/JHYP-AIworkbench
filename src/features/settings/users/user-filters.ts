import type { ManagedUser, UserRole, UserStatus } from './types'

export type UserFilters = {
  query: string
  role: UserRole | 'all'
  status: UserStatus | 'all'
}

export function filterUsers(users: ManagedUser[], filters: UserFilters) {
  const query = filters.query.trim().toLocaleLowerCase()

  return users.filter((user) => {
    const matchesQuery =
      query.length === 0 ||
      user.name.toLocaleLowerCase().includes(query) ||
      user.login.toLocaleLowerCase().includes(query)
    const matchesRole = filters.role === 'all' || user.role === filters.role
    const matchesStatus =
      filters.status === 'all' || user.status === filters.status

    return matchesQuery && matchesRole && matchesStatus
  })
}

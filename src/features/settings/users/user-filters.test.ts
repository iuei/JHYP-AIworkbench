import { describe, expect, it } from 'vitest'
import type { ManagedUser } from './types'
import { filterUsers } from './user-filters'

const users: ManagedUser[] = [
  {
    id: 1,
    login: 'admin@example.com',
    name: '系统管理员',
    role: 'admin',
    status: 'enabled',
    last_login_at: null,
  },
  {
    id: 2,
    login: 'zhangsan@example.com',
    name: '张三',
    role: 'operator',
    status: 'disabled',
    last_login_at: null,
  },
]

describe('filterUsers', () => {
  it('matches name and login case-insensitively', () => {
    expect(
      filterUsers(users, { query: 'ADMIN@', role: 'all', status: 'all' })
    ).toEqual([users[0]])
    expect(
      filterUsers(users, { query: '张三', role: 'all', status: 'all' })
    ).toEqual([users[1]])
  })

  it('combines query, role, and status filters', () => {
    expect(
      filterUsers(users, {
        query: 'example',
        role: 'operator',
        status: 'disabled',
      })
    ).toEqual([users[1]])
    expect(
      filterUsers(users, {
        query: 'example',
        role: 'admin',
        status: 'disabled',
      })
    ).toEqual([])
  })
})

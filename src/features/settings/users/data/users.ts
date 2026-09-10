import { z } from 'zod'

export const userStatusSchema = z.enum(['enabled', 'disabled', 'locked'])

export const managedUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  accountNo: z.string(),
  contact: z.string(),
  role: z.string(),
  status: userStatusSchema,
  createdAt: z.string(),
  lastLoginAt: z.string(),
})

export type UserStatus = z.infer<typeof userStatusSchema>
export type ManagedUser = z.infer<typeof managedUserSchema>

export const userStatusLabel: Record<UserStatus, string> = {
  enabled: '已开通',
  disabled: '已关闭',
  locked: '已锁定',
}

export const managedUsers: ManagedUser[] = [
  {
    id: 'user-001',
    name: '林晓',
    accountNo: 'USR001',
    contact: 'linxiao@company.local',
    role: '系统管理员',
    status: 'enabled',
    createdAt: '2026-06-18',
    lastLoginAt: '2026-07-09 09:18',
  },
  {
    id: 'user-002',
    name: '陈然',
    accountNo: 'USR002',
    contact: 'chenran@company.local',
    role: '运营主管',
    status: 'enabled',
    createdAt: '2026-06-21',
    lastLoginAt: '2026-07-08 17:42',
  },
  {
    id: 'user-003',
    name: '周宁',
    accountNo: 'USR003',
    contact: 'zhouning@company.local',
    role: '普通用户',
    status: 'disabled',
    createdAt: '2026-06-26',
    lastLoginAt: '2026-07-01 11:05',
  },
  {
    id: 'user-004',
    name: '王屿',
    accountNo: 'USR004',
    contact: 'wangyu@company.local',
    role: '财务审核',
    status: 'locked',
    createdAt: '2026-07-02',
    lastLoginAt: '2026-07-07 15:31',
  },
]

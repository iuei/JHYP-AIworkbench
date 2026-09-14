import { useMemo, useState } from 'react'
import { isAxiosError } from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ContentSection } from '../components/content-section'
import { roleLabel } from '../user-labels'
import type { ManagedUser, UserRole, UserStatus } from './types'
import { filterUsers } from './user-filters'

const emptyCreateForm = {
  name: '',
  login: '',
  password: '',
  department: '',
  role: 'operator' as UserRole,
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? fallback
  }
  return fallback
}

export function SettingsUsers() {
  const currentUser = useAuthStore((state) => state.auth.user)
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [resetUser, setResetUser] = useState<ManagedUser | null>(null)
  const [editUser, setEditUser] = useState<ManagedUser | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [createForm, setCreateForm] = useState(emptyCreateForm)
  const [editForm, setEditForm] = useState<{
    name: string
    role: UserRole
    department: string
  }>({ name: '', role: 'operator', department: '' })
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<UserRole | 'all'>('all')
  const [status, setStatus] = useState<UserStatus | 'all'>('all')
  const isAdmin = currentUser?.role.includes('admin') ?? false

  const users = useQuery<ManagedUser[]>({
    queryKey: ['users'],
    enabled: isAdmin,
    queryFn: async () => (await api.get('/users')).data,
  })
  const filteredUsers = useMemo(
    () => filterUsers(users.data ?? [], { query, role, status }),
    [query, role, status, users.data]
  )
  const hasFilters =
    query.trim().length > 0 || role !== 'all' || status !== 'all'
  const isEditingSelf = editUser?.login === currentUser?.accountNo

  const createUser = useMutation({
    mutationFn: async () => api.post('/users', createForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setCreateOpen(false)
      setCreateForm(emptyCreateForm)
      toast.success('账号已开通')
    },
    onError: () => toast.error('账号开通失败'),
  })
  const edit = useMutation({
    mutationFn: async () => {
      if (!editUser) throw new Error('未选择用户')
      return api.patch(`/users/${editUser.id}`, {
        name: editForm.name.trim(),
        role: editForm.role,
        department: editForm.department.trim(),
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setEditUser(null)
      toast.success('用户信息已更新')
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, '用户信息更新失败，请重试')),
  })
  const updateStatus = useMutation({
    mutationFn: async ({
      id,
      nextStatus,
    }: {
      id: number
      nextStatus: UserStatus
    }) => api.patch(`/users/${id}/status`, { status: nextStatus }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: (error) =>
      toast.error(apiErrorMessage(error, '用户状态更新失败，请重试')),
  })
  const resetPassword = useMutation({
    mutationFn: async () =>
      api.post(`/users/${resetUser?.id}/reset-password`, {
        password: newPassword,
      }),
    onSuccess: () => {
      toast.success('密码已重置')
      setResetUser(null)
      setNewPassword('')
    },
    onError: () => toast.error('密码重置失败'),
  })

  function openEdit(user: ManagedUser) {
    setEditUser(user)
    setEditForm({
      name: user.name,
      role: user.role,
      department: user.department ?? '',
    })
  }

  function resetFilters() {
    setQuery('')
    setRole('all')
    setStatus('all')
  }

  if (!isAdmin) {
    return (
      <ContentSection>
        <Card>
          <CardContent className='p-6 text-sm text-muted-foreground'>
            你没有访问用户管理的权限。
          </CardContent>
        </Card>
      </ContentSection>
    )
  }

  return (
    <ContentSection>
      <div className='space-y-5'>
        <div className='flex flex-col gap-3 lg:flex-row lg:items-center'>
          <div className='relative min-w-0 flex-1 lg:max-w-sm'>
            <Search className='absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
            <Input
              aria-label='搜索用户'
              className='pl-9'
              placeholder='搜索姓名或登录账号'
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className='flex flex-wrap gap-2'>
            <Select
              value={role}
              onValueChange={(value) => setRole(value as UserRole | 'all')}
            >
              <SelectTrigger aria-label='角色筛选' className='w-40'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部角色</SelectItem>
                <SelectItem value='admin'>管理员</SelectItem>
                <SelectItem value='operator'>普通运营人员</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as UserStatus | 'all')}
            >
              <SelectTrigger aria-label='状态筛选' className='w-32'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部状态</SelectItem>
                <SelectItem value='enabled'>已启用</SelectItem>
                <SelectItem value='disabled'>已停用</SelectItem>
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button variant='ghost' onClick={resetFilters}>
                <X />
                重置筛选
              </Button>
            )}
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className='lg:ml-auto'>
                <Plus />
                开通账号
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>开通内部账号</DialogTitle>
              </DialogHeader>
              <div className='space-y-3'>
                <Input
                  placeholder='姓名'
                  value={createForm.name}
                  onChange={(event) =>
                    setCreateForm({ ...createForm, name: event.target.value })
                  }
                />
                <Input
                  placeholder='登录账号 / 邮箱'
                  value={createForm.login}
                  onChange={(event) =>
                    setCreateForm({ ...createForm, login: event.target.value })
                  }
                />
                <Input
                  type='password'
                  placeholder='初始密码'
                  value={createForm.password}
                  onChange={(event) =>
                    setCreateForm({
                      ...createForm,
                      password: event.target.value,
                    })
                  }
                />
                <Input
                  aria-label='部门'
                  maxLength={40}
                  placeholder='部门（选填）'
                  value={createForm.department}
                  onChange={(event) =>
                    setCreateForm({
                      ...createForm,
                      department: event.target.value,
                    })
                  }
                />
                <Select
                  value={createForm.role}
                  onValueChange={(value) =>
                    setCreateForm({ ...createForm, role: value as UserRole })
                  }
                >
                  <SelectTrigger className='w-full'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='operator'>普通运营人员</SelectItem>
                    <SelectItem value='admin'>管理员</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button
                  disabled={
                    !createForm.name ||
                    !createForm.login ||
                    !createForm.password ||
                    createUser.isPending
                  }
                  onClick={() => createUser.mutate()}
                >
                  确认开通
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className='overflow-hidden rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户</TableHead>
                <TableHead>部门</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最近登录</TableHead>
                <TableHead className='text-right'>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <p className='font-medium'>{user.name}</p>
                    <p className='text-xs text-muted-foreground'>
                      {user.login}
                    </p>
                  </TableCell>
                  <TableCell>
                    {user.department || (
                      <span className='text-muted-foreground'>未设置</span>
                    )}
                  </TableCell>
                  <TableCell>{roleLabel(user.role)}</TableCell>
                  <TableCell>
                    {user.status === 'enabled' ? '已启用' : '已停用'}
                  </TableCell>
                  <TableCell>
                    {user.last_login_at
                      ? new Date(user.last_login_at).toLocaleString()
                      : '尚未登录'}
                  </TableCell>
                  <TableCell className='space-x-2 text-right whitespace-nowrap'>
                    <Button
                      aria-label={`编辑 ${user.name}`}
                      size='sm'
                      variant='outline'
                      onClick={() => openEdit(user)}
                    >
                      <Pencil />
                      编辑
                    </Button>
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => setResetUser(user)}
                    >
                      重置密码
                    </Button>
                    <Button
                      size='sm'
                      disabled={user.login === currentUser?.accountNo}
                      variant={
                        user.status === 'enabled' ? 'destructive' : 'outline'
                      }
                      title={
                        user.login === currentUser?.accountNo
                          ? '不能修改自己的账号状态'
                          : undefined
                      }
                      onClick={() =>
                        updateStatus.mutate({
                          id: user.id,
                          nextStatus:
                            user.status === 'enabled' ? 'disabled' : 'enabled',
                        })
                      }
                    >
                      {user.status === 'enabled' ? '停用' : '启用'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!users.isLoading && filteredUsers.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className='h-28 text-center text-muted-foreground'
                  >
                    {hasFilters ? '未找到符合条件的用户' : '暂无用户'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <Dialog
          open={Boolean(editUser)}
          onOpenChange={(value) => !value && setEditUser(null)}
        >
          <DialogContent aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>编辑用户</DialogTitle>
            </DialogHeader>
            <div className='space-y-4'>
              <div className='space-y-2'>
                <Label htmlFor='edit-login'>登录账号</Label>
                <Input id='edit-login' value={editUser?.login ?? ''} disabled />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='edit-name'>姓名</Label>
                <Input
                  id='edit-name'
                  value={editForm.name}
                  onChange={(event) =>
                    setEditForm({ ...editForm, name: event.target.value })
                  }
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='edit-department'>部门</Label>
                <Input
                  id='edit-department'
                  maxLength={40}
                  placeholder='留空表示未设置'
                  value={editForm.department}
                  onChange={(event) =>
                    setEditForm({ ...editForm, department: event.target.value })
                  }
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='edit-role'>角色</Label>
                <Select
                  value={editForm.role}
                  disabled={isEditingSelf}
                  onValueChange={(value) =>
                    setEditForm({ ...editForm, role: value as UserRole })
                  }
                >
                  <SelectTrigger
                    id='edit-role'
                    aria-label='角色'
                    className='w-full'
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value='operator'>普通运营人员</SelectItem>
                    <SelectItem value='admin'>管理员</SelectItem>
                  </SelectContent>
                </Select>
                {isEditingSelf && (
                  <p className='text-xs text-muted-foreground'>
                    为避免管理权限中断，不能修改自己的角色。
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant='outline' onClick={() => setEditUser(null)}>
                取消
              </Button>
              <Button
                disabled={!editForm.name.trim() || edit.isPending}
                onClick={() => edit.mutate()}
              >
                保存修改
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={Boolean(resetUser)}
          onOpenChange={(value) => !value && setResetUser(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>重置密码</DialogTitle>
            </DialogHeader>
            <Input
              type='password'
              placeholder='请输入新密码（至少 6 位）'
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <DialogFooter>
              <Button
                disabled={newPassword.length < 6 || resetPassword.isPending}
                onClick={() => resetPassword.mutate()}
              >
                确认重置
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ContentSection>
  )
}

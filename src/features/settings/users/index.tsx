import { useMemo, useState } from 'react'
import { isAxiosError } from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2, UserCheck, UserX, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth-store'
import {
  TABLE_CELL_ACTIONS,
  TABLE_CELL_META,
  TABLE_HEAD_ACTIONS,
} from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { useRowSelection } from '@/hooks/use-row-selection'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { TableCell, TableHead, TableRow } from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTable } from '@/components/data-table'
import { ListPageShell, ListSearchInput } from '@/components/list-page'
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

/** 用户列表查询键：抽成常量供"统一刷新"复用，避免与各调用点的字面量混在一起。 */
const USERS_QUERY_KEY = ['users'] as const

export function SettingsUsers() {
  const currentUser = useAuthStore((state) => state.auth.user)
  const queryClient = useQueryClient()
  const refreshUsers = () => {
    queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY })
    /*
     * 顺带失效顶栏待办里的「注册申请待审核」：开通 / 拒绝 / 删除 / 启停账号都会改变
     * 待审计数。不做这一步，顶栏徽章最多要等 30s 轮询才收敛 —— 用户看到的就是
     * "这个人我已经处理过了，待办里怎么还挂着他"。
     */
    queryClient.invalidateQueries({ queryKey: ['ai', 'todos'] })
  }

  const [createOpen, setCreateOpen] = useState(false)
  const [resetUser, setResetUser] = useState<ManagedUser | null>(null)
  const [editUser, setEditUser] = useState<ManagedUser | null>(null)
  const [deleteUser, setDeleteUser] = useState<ManagedUser | null>(null)
  /** 非空表示「拒绝注册申请」的确认框打开着（拒绝会让对方登不进去，值得一次确认） */
  const [rejectUser, setRejectUser] = useState<ManagedUser | null>(null)
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
  /*
    分页在前端做：`/users` 一次返回全量，切片即可，不动服务端接口。
    顺序固定为「先筛后排再分页」—— 页码必须跟着**筛选后的结果集**走，
    因此任何筛选条件变化都要把页码拉回第 1 页（见下面各 handler 与 resetFilters）。
  */
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  /*
   * 行选择（2026-09-17 新增）：勾选若干账号后批量启用/停用。
   *
   * 用全站共享的 `useRowSelection`，它刻意**只在当前页内选择** ——
   * 跨页累积会让"批量停用 12 个"变成一次看不全的批量操作。
   * 因此翻页与改筛选都必须清空选择（下面各 handler 里逐个 clear）。
   */
  const selection = useRowSelection<number>()
  /** 非空表示"批量停用"的确认框打开着（停用会影响对方登录，值得一次确认） */
  const [batchTarget, setBatchTarget] = useState<UserStatus | null>(null)
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
  /*
   * 页码夹紧：筛选变化已经会把 page 拉回 1，但还有一条路径 —— 停在第 3 页时
   * 后端数据被删（或增量刷新后结果变少），此时 page 会超出总页数，
   * 表格会渲染成「空表体 + 分页器还在」，看着像数据丢了。
   */
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pagedUsers = useMemo(
    () =>
      filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filteredUsers, currentPage, pageSize]
  )
  const hasFilters =
    query.trim().length > 0 || role !== 'all' || status !== 'all'
  const isEditingSelf = editUser?.login === currentUser?.accountNo

  const createUser = useMutation({
    mutationFn: async () => api.post('/users', createForm),
    onSuccess: () => {
      refreshUsers()
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
      refreshUsers()
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
    onSuccess: () => refreshUsers(),
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
  /*
   * 删除账号是**不可逆**操作：服务端会把该账号连同它的 AI 会话、经验沉淀、
   * 我的 ASIN、竞品分析等一起级联清掉，所以这里必须等用户在确认框里点过才发请求
   * （按钮只负责选中账号，不直接删）。
   *
   * 错误提示走服务端文案：两道闸门（不能删自己 / 必须保留一个启用管理员）的判断
   * 在服务端，前端只把原因原样告诉用户，不再自己复述一套规则。
   */
  const removeUser = useMutation({
    mutationFn: async (id: number) => api.delete(`/users/${id}`),
    onSuccess: () => {
      refreshUsers()
      setDeleteUser(null)
      toast.success('账号已删除')
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, '账号删除失败，请重试')),
  })

  function openEdit(user: ManagedUser) {
    setEditUser(user)
    setEditForm({
      name: user.name,
      role: user.role,
      department: user.department ?? '',
    })
  }

  /*
   * 批量启停走**逐条调用既有接口**（`PATCH /users/:id/status`），不新增批量接口：
   * 服务端的"必须保留一个启用中的管理员"是逐条判定的，批量接口要么重复这套规则、
   * 要么在部分失败时给出含糊结果。这里用 allSettled 收全部结果，
   * 成功的生效、失败的把**服务端原话**（如"不能停用最后一个管理员"）透出来。
   */
  const batchStatus = useMutation({
    mutationFn: async (nextStatus: UserStatus) => {
      const ids = [...selection.selectedIds]
      const results = await Promise.allSettled(
        ids.map((id) =>
          api.patch(`/users/${id}/status`, { status: nextStatus })
        )
      )
      return {
        ids,
        rejected: results.filter((item) => item.status === 'rejected'),
      }
    },
    onSuccess: ({ ids, rejected }) => {
      refreshUsers()
      // 已处理的行从选中集合里摘掉，避免"已选 N 个"里混着状态已经变了的行
      selection.removeMany(ids)
      setBatchTarget(null)
      if (rejected.length === 0) {
        toast.success(`已更新 ${ids.length} 个账号的状态`)
        return
      }
      const reason = (rejected[0] as PromiseRejectedResult).reason
      toast.error(
        `${rejected.length} 个账号未处理：${apiErrorMessage(reason, '原因未知')}`
      )
    },
    onError: () => toast.error('批量操作失败，请重试'),
  })

  function changePage(next: number) {
    selection.clear()
    setPage(next)
  }

  function resetFilters() {
    setQuery('')
    setRole('all')
    setStatus('all')
    setPage(1)
    selection.clear()
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

  const selectedCount = selection.count
  const pageIds = pagedUsers.map((user) => user.id)
  const allOnPageSelected = selection.isAllSelected(pageIds)
  const someOnPageSelected = selection.isSomeSelected(pageIds)

  return (
    <ContentSection>
      {/*
        工具区走全站统一的列表页壳（2026-09-17）：上排检索 + 筛选、下排动作按钮（左）与辅助项（右）。
        此前这一段是页面自己拼的 `flex` 布局，"搜索框多宽""筛选与按钮怎么排"每个列表页都不同。
      */}
      <ListPageShell
        search={
          <ListSearchInput
            label='搜索用户'
            placeholder='搜索姓名或登录账号'
            value={query}
            onChange={(value) => {
              setQuery(value)
              setPage(1)
              selection.clear()
            }}
          />
        }
        filters={
          <>
            <Select
              value={role}
              onValueChange={(value) => {
                setRole(value as UserRole | 'all')
                setPage(1)
                selection.clear()
              }}
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
              onValueChange={(value) => {
                setStatus(value as UserStatus | 'all')
                setPage(1)
                selection.clear()
              }}
            >
              <SelectTrigger aria-label='状态筛选' className='w-32'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部状态</SelectItem>
                {/* 待审核排在最前：它是唯一需要管理员动手处理的状态 */}
                <SelectItem value='pending'>待审核</SelectItem>
                <SelectItem value='enabled'>已启用</SelectItem>
                <SelectItem value='disabled'>已停用</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        actions={
          <>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>
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
                      setCreateForm({
                        ...createForm,
                        login: event.target.value,
                      })
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
            {/*
              未勾选任何账号时两个批量按钮置灰 —— 禁用原因写在 title 上，
              与行内「停用 / 删除」对自己置灰的既有做法一致。
            */}
            <Button
              disabled={selectedCount === 0 || batchStatus.isPending}
              title={selectedCount === 0 ? '请先勾选要启用的账号' : undefined}
              variant='outline'
              onClick={() => batchStatus.mutate('enabled')}
            >
              <UserCheck />
              批量启用
            </Button>
            <Button
              disabled={selectedCount === 0 || batchStatus.isPending}
              title={selectedCount === 0 ? '请先勾选要停用的账号' : undefined}
              variant='outline'
              onClick={() => setBatchTarget('disabled')}
            >
              <UserX />
              批量停用
            </Button>
            {hasFilters && (
              <Button variant='ghost' onClick={resetFilters}>
                <X />
                重置筛选
              </Button>
            )}
          </>
        }
      >
        <DataTable
          columns={7}
          emptyText={hasFilters ? '未找到符合条件的用户' : '暂无用户'}
          errorText='用户列表加载失败，请稍后重试。'
          isEmpty={filteredUsers.length === 0}
          isError={users.isError}
          isLoading={users.isLoading}
          pagination={{
            page: currentPage,
            pageSize,
            total: filteredUsers.length,
            onPageChange: changePage,
            onPageSizeChange: (size) => {
              setPageSize(size)
              setPage(1)
              selection.clear()
            },
          }}
          header={
            <TableRow>
              <TableHead className='w-10'>
                <Checkbox
                  aria-label='全选本页用户'
                  checked={
                    allOnPageSelected
                      ? true
                      : someOnPageSelected
                        ? 'indeterminate'
                        : false
                  }
                  onCheckedChange={() => selection.toggleAll(pageIds)}
                />
              </TableHead>
              <TableHead>用户</TableHead>
              <TableHead>部门</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>最近登录</TableHead>
              <TableHead className={TABLE_HEAD_ACTIONS}>操作</TableHead>
            </TableRow>
          }
        >
          {pagedUsers.map((user) => {
            const isSelf = user.login === currentUser?.accountNo
            return (
              <TableRow
                data-state={selection.has(user.id) ? 'selected' : undefined}
                key={user.id}
              >
                <TableCell>
                  {/*
                  自己的账号不可勾选：行内的「停用 / 删除」本来就对自己置灰，
                  若这里能勾上，批量操作会绕过那道闸门、拿到一个服务端拒绝的结果。
                */}
                  <Checkbox
                    aria-label={`选择用户 ${user.name}`}
                    checked={selection.has(user.id)}
                    disabled={isSelf}
                    title={isSelf ? '不能批量操作自己的账号状态' : undefined}
                    onCheckedChange={(checked) =>
                      selection.toggleOne(user.id, checked === true)
                    }
                  />
                </TableCell>
                <TableCell>
                  <p className='font-medium'>{user.name}</p>
                  <p className='text-xs text-muted-foreground'>{user.login}</p>
                </TableCell>
                <TableCell>
                  {user.department || (
                    <span className='text-muted-foreground'>未设置</span>
                  )}
                </TableCell>
                <TableCell>{roleLabel(user.role)}</TableCell>
                <TableCell>
                  {/*
                    待审核用 Badge 强调：它和「已停用」不是一回事 ——
                    前者等着管理员动手处理，后者是已经出过结果的状态。
                  */}
                  {user.status === 'pending' ? (
                    <Badge variant='secondary'>待审核</Badge>
                  ) : user.status === 'enabled' ? (
                    '已启用'
                  ) : (
                    '已停用'
                  )}
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {user.last_login_at
                    ? new Date(user.last_login_at).toLocaleString()
                    : '尚未登录'}
                </TableCell>
                <TableCell className={cn(TABLE_CELL_ACTIONS, 'space-x-2')}>
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
                  {/*
                    待审核走独立的一对按钮：「通过审核 / 拒绝」。
                    复用的仍是同一个状态接口（通过=enabled、拒绝=disabled），不新增审核接口 ——
                    审核在数据上就是"把状态改掉"这一件事。
                  */}
                  {user.status === 'pending' ? (
                    <>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() =>
                          updateStatus.mutate(
                            { id: user.id, nextStatus: 'enabled' },
                            {
                              onSuccess: () =>
                                toast.success(`已通过 ${user.name} 的注册申请`),
                            }
                          )
                        }
                      >
                        <UserCheck />
                        通过审核
                      </Button>
                      <Button
                        size='sm'
                        variant='destructive'
                        onClick={() => setRejectUser(user)}
                      >
                        <UserX />
                        拒绝
                      </Button>
                    </>
                  ) : (
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
                  )}
                  <Button
                    aria-label={`删除 ${user.name}`}
                    disabled={user.login === currentUser?.accountNo}
                    size='sm'
                    title={
                      user.login === currentUser?.accountNo
                        ? '不能删除自己的账号'
                        : undefined
                    }
                    variant='destructive'
                    onClick={() => setDeleteUser(user)}
                  >
                    <Trash2 />
                    删除
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </DataTable>
      </ListPageShell>

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

      {/*
          删除确认：文案必须把"连带删掉什么"和"不可恢复"说清楚 —— 服务端会级联清理
          该账号的全部业务数据，用户点这一下之前有权知道代价。
        */}
      <ConfirmDialog
        confirmText='确认删除'
        desc={
          <span>
            将永久删除账号{' '}
            <strong>
              {deleteUser?.name}（{deleteUser?.login}）
            </strong>
            ，同时清空它名下的 AI 会话、经验沉淀、我的
            ASIN、竞品分析等全部业务数据。
            <strong>此操作不可恢复。</strong>
          </span>
        }
        destructive
        isLoading={removeUser.isPending}
        open={Boolean(deleteUser)}
        title='删除账号'
        handleConfirm={() => deleteUser && removeUser.mutate(deleteUser.id)}
        onOpenChange={(open) => !open && setDeleteUser(null)}
      />

      {/*
          批量停用确认：停用会让对方**立刻登不进去**，属于影响他人的动作，值得一次确认；
          批量启用是恢复性操作，不拦（多一次点击只增加负担）。
        */}
      <ConfirmDialog
        confirmText='确认停用'
        desc={
          <span>
            将把选中的 <strong>{selectedCount}</strong> 个账号置为「已停用」，
            对方将立刻无法登录。之后可以再批量启用。
          </span>
        }
        isLoading={batchStatus.isPending}
        open={batchTarget === 'disabled'}
        title='批量停用账号'
        handleConfirm={() => batchTarget && batchStatus.mutate(batchTarget)}
        onOpenChange={(open) => !open && setBatchTarget(null)}
      />

      {/*
        拒绝注册申请：语义是「置为已停用」（保留记录、日后可再启用），**不是删除账号**。
        文案必须把这点说清楚，否则管理员会以为"拒绝"等于清掉这个人。
      */}
      <ConfirmDialog
        confirmText='确认拒绝'
        desc={
          <span>
            将把{' '}
            <strong>
              {rejectUser?.name}（{rejectUser?.login}）
            </strong>
            的注册申请标记为「已停用」，对方无法登录。账号记录会保留，之后仍可在列表里重新启用。
          </span>
        }
        destructive
        isLoading={updateStatus.isPending}
        open={Boolean(rejectUser)}
        title='拒绝注册申请'
        handleConfirm={() =>
          rejectUser &&
          updateStatus.mutate(
            { id: rejectUser.id, nextStatus: 'disabled' },
            {
              onSuccess: () => {
                toast.success('已拒绝该注册申请')
                setRejectUser(null)
              },
            }
          )
        }
        onOpenChange={(open) => !open && setRejectUser(null)}
      />
    </ContentSection>
  )
}

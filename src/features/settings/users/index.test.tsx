import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { SettingsUsers } from '.'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: {
    get: mocks.get,
    patch: mocks.patch,
    post: mocks.post,
    delete: mocks.del,
  },
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: {
      auth: { user: { accountNo: string; role: string[] } }
    }) => unknown
  ) =>
    selector({
      auth: { user: { accountNo: 'admin@example.com', role: ['admin'] } },
    }),
}))

vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sonner')>()

  return {
    ...actual,
    toast: {
      ...actual.toast,
      error: mocks.toastError,
      success: mocks.toastSuccess,
    },
  }
})

const users = [
  {
    id: 1,
    login: 'admin@example.com',
    name: '系统管理员',
    role: 'admin',
    department: '供应链部',
    status: 'enabled',
    last_login_at: null,
  },
  {
    id: 2,
    login: 'zhangsan@example.com',
    name: '张三',
    role: 'operator',
    department: '',
    status: 'disabled',
    last_login_at: null,
  },
]

/** 自助注册后等待审核的账号：`pending` 只可能由公开注册接口写入 */
const pendingUser = {
  id: 3,
  login: 'lisi@example.com',
  name: '李四',
  role: 'operator',
  department: '',
  status: 'pending',
  last_login_at: null,
}

async function renderUsers() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsUsers />
    </QueryClientProvider>
  )
}

describe('SettingsUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.get.mockResolvedValue({ data: users })
    mocks.patch.mockResolvedValue({ data: users[1] })
    mocks.del.mockResolvedValue({ status: 204 })
  })

  it('searches users by name or login', async () => {
    const screen = await renderUsers()
    await expect.element(screen.getByText('系统管理员')).toBeVisible()
    await expect.element(screen.getByText('供应链部')).toBeVisible()

    await userEvent.fill(
      screen.getByRole('textbox', { name: '搜索用户' }),
      '张三'
    )

    await expect.element(screen.getByText('张三')).toBeVisible()
    await expect.element(screen.getByText('系统管理员')).not.toBeInTheDocument()
  })

  it('edits only the selected user name, department and role', async () => {
    const screen = await renderUsers()
    await expect.element(screen.getByText('张三')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: '编辑 张三' }))
    await expect
      .element(screen.getByRole('dialog', { name: '编辑用户' }))
      .toBeVisible()
    await expect.element(screen.getByLabelText('登录账号')).toBeDisabled()

    await userEvent.fill(screen.getByLabelText('姓名'), '张三（华南）')
    await userEvent.fill(screen.getByLabelText('部门'), '华南大区')
    await userEvent.click(screen.getByRole('combobox', { name: '角色' }))
    await userEvent.click(screen.getByRole('option', { name: '管理员' }))
    await userEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await vi.waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/users/2', {
        name: '张三（华南）',
        role: 'admin',
        department: '华南大区',
      })
    )
  })

  it('pre-fills the department configured by the administrator', async () => {
    const screen = await renderUsers()
    await expect.element(screen.getByText('系统管理员')).toBeVisible()

    await userEvent.click(
      screen.getByRole('button', { name: '编辑 系统管理员' })
    )

    await expect
      .element(screen.getByLabelText('部门'))
      .toHaveValue('供应链部')
  })

  it('prevents an administrator from changing their own role', async () => {
    const screen = await renderUsers()
    await expect.element(screen.getByText('系统管理员')).toBeVisible()

    await userEvent.click(
      screen.getByRole('button', { name: '编辑 系统管理员' })
    )

    await expect
      .element(screen.getByRole('combobox', { name: '角色' }))
      .toBeDisabled()
    await expect
      .element(screen.getByText('为避免管理权限中断，不能修改自己的角色。'))
      .toBeVisible()
  })

  it('deletes an account only after the confirmation is accepted', async () => {
    const screen = await renderUsers()
    await expect.element(screen.getByText('张三')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: '删除 张三' }))
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    // 点「删除」只是选中账号：不可逆操作必须先过确认框，不能一点就发请求
    expect(mocks.del).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await vi.waitFor(() => expect(mocks.del).toHaveBeenCalledWith('/users/2'))
  })

  it('does not let an administrator delete their own account', async () => {
    const screen = await renderUsers()
    await expect.element(screen.getByText('系统管理员')).toBeVisible()

    await expect
      .element(screen.getByRole('button', { name: '删除 系统管理员' }))
      .toBeDisabled()
  })

  it('approves a pending registration', async () => {
    mocks.get.mockResolvedValue({ data: [...users, pendingUser] })
    const screen = await renderUsers()

    await expect.element(screen.getByText('李四')).toBeVisible()
    // 待审核要有明确标识，别和「已停用」混为一谈
    await expect.element(screen.getByText('待审核')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: '通过审核' }))

    await vi.waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/users/3/status', {
        status: 'enabled',
      })
    )
  })

  it('rejects a pending registration only after the confirmation is accepted', async () => {
    mocks.get.mockResolvedValue({ data: [pendingUser] })
    const screen = await renderUsers()
    await expect.element(screen.getByText('李四')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: '拒绝' }))
    await expect.element(screen.getByRole('alertdialog')).toBeVisible()
    // 与删除同一条口径：点行内按钮只负责选中，改状态要先过确认框
    expect(mocks.patch).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: '确认拒绝' }))

    await vi.waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/users/3/status', {
        status: 'disabled',
      })
    )
  })
})

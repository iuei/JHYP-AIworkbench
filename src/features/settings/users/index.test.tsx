import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { SettingsUsers } from '.'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: { get: mocks.get, patch: mocks.patch, post: mocks.post },
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
  })

  it('searches users by name or login', async () => {
    const screen = await renderUsers()
    await expect.element(screen.getByText('系统管理员')).toBeVisible()

    await userEvent.fill(
      screen.getByRole('textbox', { name: '搜索用户' }),
      '张三'
    )

    await expect.element(screen.getByText('张三')).toBeVisible()
    await expect.element(screen.getByText('系统管理员')).not.toBeInTheDocument()
  })

  it('edits only the selected user name and role', async () => {
    const screen = await renderUsers()
    await expect.element(screen.getByText('张三')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: '编辑 张三' }))
    await expect
      .element(screen.getByRole('dialog', { name: '编辑用户' }))
      .toBeVisible()
    await expect.element(screen.getByLabelText('登录账号')).toBeDisabled()

    await userEvent.fill(screen.getByLabelText('姓名'), '张三（华南）')
    await userEvent.click(screen.getByRole('combobox', { name: '角色' }))
    await userEvent.click(screen.getByRole('option', { name: '管理员' }))
    await userEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await vi.waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/users/2', {
        name: '张三（华南）',
        role: 'admin',
      })
    )
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
})

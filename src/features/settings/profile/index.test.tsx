import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { SettingsProfile } from '.'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/api/client', () => ({ api: { get: mocks.get } }))

vi.mock('@/components/sign-out-dialog', () => ({
  SignOutDialog: ({ open }: { open: boolean }) =>
    open ? <div role='dialog'>确认退出登录</div> : null,
}))

const profile = {
  id: 1,
  login: 'admin@example.com',
  name: '系统管理员',
  role: 'admin',
  department: '供应链部',
}

async function renderProfile() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsProfile />
    </QueryClientProvider>
  )
}

describe('SettingsProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.get.mockResolvedValue({ data: profile })
  })

  it('reads the admin-configured account fields from the API', async () => {
    const screen = await renderProfile()

    await expect
      .element(screen.getByRole('heading', { name: '基本信息' }))
      .toBeVisible()
    await expect.element(screen.getByText('admin@example.com')).toBeVisible()
    await expect.element(screen.getByText('系统管理员')).toBeVisible()
    await expect.element(screen.getByText('供应链部')).toBeVisible()
    await expect
      .element(screen.getByText('管理员', { exact: true }))
      .toBeVisible()
    expect(mocks.get).toHaveBeenCalledWith('/auth/me')
  })

  it('exposes no self-service form for the admin-configured fields', async () => {
    const screen = await renderProfile()

    await expect.element(screen.getByText('系统管理员')).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: '更新个人资料' }))
      .not.toBeInTheDocument()
    await expect
      .element(screen.getByRole('button', { name: '更新账户' }))
      .not.toBeInTheDocument()
    expect(document.querySelectorAll('input')).toHaveLength(0)
  })

  it('shows a placeholder when the administrator has not set a department', async () => {
    mocks.get.mockResolvedValue({ data: { ...profile, department: '' } })
    await renderProfile()

    await expect.element(document.body).toHaveTextContent('未设置')
  })

  it('reports a load failure instead of rendering empty fields', async () => {
    mocks.get.mockRejectedValue(new Error('network down'))
    await renderProfile()

    await expect
      .element(document.body)
      .toHaveTextContent('用户信息加载失败，请刷新页面重试。')
  })

  it('still lets the user sign out', async () => {
    const screen = await renderProfile()

    await userEvent.click(screen.getByRole('button', { name: '退出登录' }))
    await expect.element(screen.getByRole('dialog')).toHaveTextContent('确认退出登录')
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { ProfileDropdown } from './profile-dropdown'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/api/client', () => ({ api: { get: mocks.get } }))

vi.mock('@/components/sign-out-dialog', () => ({
  SignOutDialog: ({ open }: { open: boolean }) =>
    open ? <div role='dialog'>确认退出登录</div> : null,
}))

const profile = {
  login: '16686400050',
  name: '刘磊',
  role: 'admin',
  department: 'IT运维',
}

async function renderDropdown() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <ProfileDropdown />
    </QueryClientProvider>
  )
}

describe('ProfileDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.get.mockResolvedValue({ data: profile })
    // `useCurrentUser` 只在有登录态时才查 `/auth/me`（与侧边栏同一口径）
    useAuthStore.setState((state) => ({
      auth: {
        ...state.auth,
        user: {
          accountNo: '16686400050',
          email: '',
          name: '刘磊',
          role: ['admin'],
          exp: Date.now() + 3600_000,
        },
      },
    }))
  })

  it('点击顶部头像就地列出用户信息，不再跳 /settings', async () => {
    const { getByRole } = await renderDropdown()

    // 旧实现是 <Link to='/settings'>：整页跳走正是用户要求去掉的"弹出新界面"
    expect(document.querySelector('a[href="/settings"]')).toBeNull()

    await getByRole('button', { name: '用户信息' }).click()

    await expect
      .element(getByRole('button', { name: '退出登录' }))
      .toBeVisible()
    const text = document.body.textContent ?? ''
    for (const label of ['登录账号', '姓名', '部门', '角色']) {
      expect(text).toContain(label)
    }
    expect(text).toContain('刘磊')
    expect(text).toContain('16686400050')
    expect(text).toContain('IT运维')
    // 角色要转中文（admin → 管理员），不把接口枚举值摊给用户
    expect(text).toContain('管理员')
    expect(text).not.toContain('admin')
    expect(text).not.toContain('user@company.local')
  })

  it('头像不再显示模板占位 SN，改用真实姓名首字', async () => {
    const { getByRole } = await renderDropdown()

    const trigger = getByRole('button', { name: '用户信息' })
    await expect.element(trigger).toBeVisible()
    expect(trigger.element().textContent).toContain('刘')
    expect(document.body.textContent).not.toContain('SN')
  })

  it('卡片底部「退出登录」打开二次确认框（不直接登出）', async () => {
    const { getByRole, getByText } = await renderDropdown()

    await getByRole('button', { name: '用户信息' }).click()
    await getByRole('button', { name: '退出登录' }).click()

    await expect.element(getByText('确认退出登录')).toBeVisible()
  })
})

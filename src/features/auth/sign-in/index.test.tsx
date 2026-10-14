import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>(
    '@tanstack/react-router'
  )

  return {
    ...actual,
    useSearch: () => ({ redirect: '/settings' }),
    /*
     * 页面新增了「注册新账号」入口。单独渲染 SignIn 时没有 Router 上下文，
     * 这里用普通 <a> 顶替 —— 本用例只验证入口存在及其指向，不验证真实跳转。
     */
    Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
      <a href={to}>{children}</a>
    ),
  }
})

vi.mock(import('@/features/auth/sign-in/components/user-auth-form'), () => ({
  UserAuthForm: ({ redirectTo }: { redirectTo?: string }) => (
    <div data-testid='user-auth-form' data-redirect-to={redirectTo}>
      登录表单
    </div>
  ),
}))

describe('SignIn', () => {
  it('renders the selected split-login content', async () => {
    const { SignIn } = await import('.')
    const screen = await render(<SignIn />)

    await expect
      .element(screen.getByRole('heading', { name: '欢迎回来' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('使用账号登录 JHYP 智能工作台'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('内部工作台 · 仅限授权用户'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByRole('link', { name: '注册新账号' }))
      .toHaveAttribute('href', '/sign-up')
    await expect
      .element(screen.getByTestId('user-auth-form'))
      .toHaveAttribute('data-redirect-to', '/settings')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<
    typeof import('@tanstack/react-router')
  >('@tanstack/react-router')

  return {
    ...actual,
    useSearch: () => ({ redirect: '/settings' }),
  }
})

vi.mock(
  import('@/features/auth/sign-in/components/user-auth-form'),
  () => ({
    UserAuthForm: ({ redirectTo }: { redirectTo?: string }) => (
      <div data-testid='user-auth-form' data-redirect-to={redirectTo}>
        登录表单
      </div>
    ),
  })
)

describe('SignIn', () => {
  it('renders the selected split-login content', async () => {
    const { SignIn } = await import('.')
    const screen = await render(<SignIn />)

    await expect
      .element(screen.getByRole('heading', { name: '欢迎回来' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('使用公司分配的账号登录 JHYP 智能工作台'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('内部工作台 · 仅限授权用户'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByTestId('user-auth-form'))
      .toHaveAttribute('data-redirect-to', '/settings')
  })
})

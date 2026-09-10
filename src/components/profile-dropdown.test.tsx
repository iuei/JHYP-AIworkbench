import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { ProfileDropdown } from './profile-dropdown'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: React.PropsWithChildren<{ to: string }>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useLocation: () => ({ href: '/dashboard' }),
  useNavigate: () => vi.fn(),
}))

describe('ProfileDropdown', () => {
  it('links directly to the unified user information page', async () => {
    const { getByRole } = await render(<ProfileDropdown />)

    const link = getByRole('link', { name: '打开用户信息' })
    await expect.element(link).toHaveAttribute('href', '/settings')
    expect(document.body.textContent).not.toContain('退出登录')
  })
})

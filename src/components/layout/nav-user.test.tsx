import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { NavUser } from './nav-user'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: React.PropsWithChildren<{ to: string }>) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useLocation: () => ({ href: '/dashboard' }),
  useNavigate: () => vi.fn(),
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenu: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SidebarMenuItem: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  SidebarMenuButton: ({ children }: React.PropsWithChildren) => <>{children}</>,
  useSidebar: () => ({ isMobile: false }),
}))

describe('NavUser', () => {
  it('links directly to the unified user information page', async () => {
    const { getByRole } = await render(
      <NavUser
        user={{
          name: '内部用户',
          email: 'user@company.local',
          avatar: '/avatars/01.png',
        }}
      />
    )

    const link = getByRole('link', { name: /内部用户/ })
    await expect.element(link).toHaveAttribute('href', '/settings')
    expect(document.body.textContent).not.toContain('退出登录')
  })
})

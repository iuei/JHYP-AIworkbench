import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { NavUser } from './nav-user'

/** 侧边栏上下文：测试要断言"移动端点击后关抽屉"，所以 setOpenMobile 必须可观察。 */
const sidebar = vi.hoisted(() => ({ setOpenMobile: vi.fn() }))

vi.mock('@tanstack/react-router', () => ({
  // 拦住真实跳转：这里只关心"点击是否请求关闭抽屉"，不需要真的导航到 /settings
  Link: ({
    children,
    to,
    onClick,
    ...props
  }: React.PropsWithChildren<{ to: string; onClick?: () => void }>) => (
    <a
      href={to}
      onClick={(event) => {
        event.preventDefault()
        onClick?.()
      }}
      {...props}
    >
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
  useSidebar: () => sidebar,
}))

describe('NavUser', () => {
  it('shows the signed-in user name and account, not a placeholder', async () => {
    const { getByRole } = await render(
      <NavUser accountNo='16686400050' name='张三' />
    )

    const link = getByRole('link', { name: /张三/ })
    await expect.element(link).toHaveAttribute('href', '/settings')
    // 姓名与登录账号都要露出来；模板里那套「内部用户 / user@company.local」不得再出现
    expect(document.body.textContent).toContain('张三')
    expect(document.body.textContent).toContain('16686400050')
    expect(document.body.textContent).not.toContain('user@company.local')
    expect(document.body.textContent).not.toContain('退出登录')
  })

  it('falls back to the account when the name is unavailable', async () => {
    const { getByRole } = await render(
      <NavUser accountNo='operator@example.com' name='' />
    )

    await expect
      .element(getByRole('link', { name: /operator@example.com/ }))
      .toBeVisible()
  })

  /*
    2026-09-18：移动端抽屉里点「用户信息」后必须自己关抽屉 —— 其它导航项都走
    `NavGroup` 的 `setOpenMobile(false)`，只有这一项漏了（实测 URL 已到 `/settings`、
    抽屉仍盖在新页面上）。
  */
  it('移动端点击底部用户入口时关闭抽屉', async () => {
    sidebar.setOpenMobile.mockClear()
    const { getByRole } = await render(
      <NavUser accountNo='16686400050' name='张三' />
    )

    await getByRole('link', { name: /张三/ }).click()

    expect(sidebar.setOpenMobile).toHaveBeenCalledWith(false)
  })
})

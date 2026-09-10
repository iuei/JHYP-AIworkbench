import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { Settings } from '.'

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => <div>当前设置页面</div>,
}))

vi.mock('@/components/layout/header', () => ({
  Header: ({ children }: React.PropsWithChildren) => <header>{children}</header>,
}))

vi.mock('@/components/layout/main', () => ({
  Main: ({ children }: React.PropsWithChildren) => <main>{children}</main>,
}))

vi.mock('@/components/profile-dropdown', () => ({
  ProfileDropdown: () => <div>用户入口</div>,
}))

vi.mock('@/components/search', () => ({ Search: () => <div>搜索</div> }))
vi.mock('@/components/theme-switch', () => ({
  ThemeSwitch: () => <div>主题</div>,
}))

describe('Settings', () => {
  it('lets each child page own the page heading', async () => {
    await render(<Settings />)

    expect(document.body.textContent).not.toContain(
      '管理用户信息、内部账户和界面外观偏好。'
    )
    expect(document.body.textContent).toContain('当前设置页面')
  })
})

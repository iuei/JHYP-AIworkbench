import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { Settings } from '.'

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => <div>当前设置页面</div>,
}))

// 顶栏由 authenticated-layout 统一渲染、页面名来自路由 staticData，设置外壳自己不再渲染 Header。
vi.mock('@/components/layout/main', () => ({
  Main: ({ children }: React.PropsWithChildren) => <main>{children}</main>,
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

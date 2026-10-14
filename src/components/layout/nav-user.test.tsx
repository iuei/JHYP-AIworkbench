import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { NavUser } from './nav-user'

/** 退出确认框：只关心"是否被打开"，真实弹窗逻辑在 sign-out-dialog 自己的测试里。 */
vi.mock('@/components/sign-out-dialog', () => ({
  SignOutDialog: ({ open }: { open: boolean }) =>
    open ? <div role='dialog'>确认退出登录</div> : null,
}))

/**
 * 侧边栏上下文：`SidebarMenuButton` 的 tooltip 等样式能力与本次行为无关，
 * 这里只保留"渲染成一个可点击按钮"这一个事实，便于按可访问名点击。
 */
vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenu: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SidebarMenuItem: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  SidebarMenuButton: ({
    children,
    tooltip,
    size,
    ...props
  }: React.PropsWithChildren<{ tooltip?: unknown; size?: string }>) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
}))

const profile = {
  accountNo: '16686400050',
  name: '刘磊',
  department: 'IT运维',
  role: 'admin',
}

describe('NavUser', () => {
  it('shows the signed-in user name and account, not a placeholder', async () => {
    const { getByRole } = await render(<NavUser {...profile} />)

    await expect.element(getByRole('button', { name: /刘磊/ })).toBeVisible()
    // 姓名与登录账号都要露出来；模板里那套「内部用户 / user@company.local」不得再出现
    expect(document.body.textContent).toContain('刘磊')
    expect(document.body.textContent).toContain('16686400050')
    expect(document.body.textContent).not.toContain('user@company.local')
    // 信息卡默认不展开：点之前连「退出登录」都不该在页面上
    expect(document.body.textContent).not.toContain('退出登录')
  })

  it('点击头像就地列出登录账号 / 姓名 / 部门 / 角色，且不再跳到 /settings', async () => {
    const { getByRole } = await render(<NavUser {...profile} />)

    // 旧实现是 <Link to='/settings'>：整页跳走正是用户要求去掉的"弹出新界面"
    expect(document.querySelector('a[href="/settings"]')).toBeNull()

    await getByRole('button', { name: /刘磊/ }).click()

    await expect
      .element(getByRole('button', { name: '退出登录' }))
      .toBeVisible()
    const text = document.body.textContent ?? ''
    for (const label of ['登录账号', '姓名', '部门', '角色']) {
      expect(text).toContain(label)
    }
    expect(text).toContain('16686400050')
    expect(text).toContain('IT运维')
    // 角色必须转成中文（admin → 管理员），不能把接口枚举值摊给用户
    expect(text).toContain('管理员')
    expect(text).not.toContain('admin')
  })

  it('部门未配置时如实显示「未设置」，不显示空白', async () => {
    const { getByRole } = await render(
      <NavUser {...profile} department={null} />
    )

    await getByRole('button', { name: /刘磊/ }).click()

    await expect
      .element(getByRole('button', { name: '退出登录' }))
      .toBeVisible()
    expect(document.body.textContent).toContain('未设置')
  })

  it('底部「退出登录」打开二次确认框（不直接登出）', async () => {
    // 注意：Radix Popover 的内容本身也带 role='dialog'（aria-label=用户信息），
    // 所以这里按文案定位确认框，而不是按 dialog 角色（会同时命中两个）
    const { getByRole, getByText } = await render(<NavUser {...profile} />)

    await getByRole('button', { name: /刘磊/ }).click()
    await getByRole('button', { name: '退出登录' }).click()

    await expect.element(getByText('确认退出登录')).toBeVisible()
  })

  it('falls back to the account when the name is unavailable', async () => {
    const { getByRole } = await render(
      <NavUser accountNo='operator@example.com' name='' />
    )

    // 姓名缺失时宁可重复账号，也不出现空白与占位假名
    await expect
      .element(getByRole('button', { name: /operator@example.com/ }))
      .toBeVisible()
    expect(document.body.textContent).not.toContain('内部用户')
  })
})

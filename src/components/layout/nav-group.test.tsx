import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { NavGroup } from './nav-group'
import type { NavItem } from './types'

/** 侧边栏上下文：测试里只关心"是不是移动端"，其余按最小实现给。 */
const sidebar = vi.hoisted(() => ({
  isMobile: false,
  state: 'expanded' as const,
  setOpenMobile: vi.fn(),
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarGroup: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  SidebarGroupLabel: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  SidebarMenu: ({ children }: React.PropsWithChildren) => <ul>{children}</ul>,
  SidebarMenuItem: ({
    children,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) => (
    <li {...props}>{children}</li>
  ),
  // 透传 props（含 ref）—— DropdownMenuTrigger 用 asChild 把 props 注入这个按钮
  SidebarMenuButton: ({
    children,
    isActive: _isActive,
    asChild: _asChild,
    tooltip: _tooltip,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  SidebarMenuSub: ({ children }: React.PropsWithChildren) => (
    <ul>{children}</ul>
  ),
  SidebarMenuSubItem: ({ children }: React.PropsWithChildren) => (
    <li>{children}</li>
  ),
  SidebarMenuSubButton: ({ children }: React.PropsWithChildren) => (
    <div>{children}</div>
  ),
  useSidebar: () => sidebar,
}))

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
  useLocation: ({
    select,
  }: {
    select: (location: { href: string }) => unknown
  }) => select({ href: '/' }),
}))

const items: NavItem[] = [
  {
    title: 'AI 助手',
    items: [
      { title: '对话', url: '/ai-agent' },
      { title: '我的沉淀', url: '/ai-agent/notes' },
    ],
  },
  { title: '提示词广场', url: '/prompts' },
]

describe('NavGroup', () => {
  beforeEach(() => {
    sidebar.isMobile = false
    sidebar.setOpenMobile.mockClear()
  })

  it('点击一级类目弹出二级类目浮窗', async () => {
    const screen = await render(<NavGroup items={items} />)

    await userEvent.click(screen.getByRole('button', { name: 'AI 助手' }))

    await expect
      .element(screen.getByRole('menuitem', { name: '对话' }))
      .toBeVisible()
    await expect
      .element(screen.getByRole('menuitem', { name: '我的沉淀' }))
      .toBeVisible()
    expect(screen.getByRole('menuitem', { name: '对话' })).toHaveAttribute(
      'href',
      '/ai-agent'
    )
  })

  it('悬停一级类目即可弹出浮窗（无需点击）', async () => {
    const screen = await render(<NavGroup items={items} />)

    await userEvent.hover(screen.getByRole('button', { name: 'AI 助手' }))

    // 悬停带 120ms 打开延迟，expect.element 会重试直到出现
    await expect
      .element(screen.getByRole('menuitem', { name: '对话' }))
      .toBeVisible()
  })

  /*
    「悬停已打开时再点一级类目不关浮窗」这条细节**不在这里断言**：
    `userEvent.click` 在 DOM 模拟下会附带指针出入事件，误触发我们的"移出后延迟关闭"，
    与真实浏览器的行为不一致（实机验证见 CHANGELOG：悬停打开后点击仍保持展开）。
    单测只守住"点击能打开、悬停能打开、移动端内联"这三条稳定不变式。
  */

  it('移动端保留点击内联展开（不弹浮窗）', async () => {
    sidebar.isMobile = true
    const screen = await render(<NavGroup items={items} />)

    await userEvent.click(screen.getByRole('button', { name: 'AI 助手' }))

    await expect.element(screen.getByText('我的沉淀')).toBeVisible()
    // 移动端不该出现浮窗（DropdownMenu 的菜单项）
    expect(document.querySelectorAll('[role="menuitem"]').length).toBe(0)
  })

  /*
    2026-09-18：层级要"一眼可见"——带子菜单的入口必须有右箭头，直达入口不能有。
    （此前两类入口外观完全一样，用户只能逐项试。）
  */
  it('只有带子菜单的入口显示右箭头', async () => {
    await render(<NavGroup items={items} />)

    // items 里只有「AI 助手」带子项，所以整棵树恰好一个箭头
    expect(document.querySelectorAll('svg.lucide-chevron-right').length).toBe(1)
  })

  /*
    业务域分组：域标题与域里唯一一项同名时不渲染分组小字，
    改用一条分隔线表达"换了一个域"（否则会连着出现同一个词两次）。
    这里用**构造数据**而不是真实 `sidebarData` —— 2026-09-20 任务中心下线后，真实数据里
    已经没有"同名单域"的项了，但这条规则本身仍是 `NavGroup` 的能力，要继续守住。
  */
  it('域标题与唯一项同名时只留分隔线，不重复同一个词', async () => {
    const sectioned: NavItem[] = [
      { section: '业务运营', title: '我的 ASIN', url: '/asin-watchlists' },
      {
        section: '执行日志',
        title: '执行日志',
        url: '/exec-logs',
        matchPrefix: true,
      },
      { section: '系统管理', title: 'AI 治理', url: '/admin/ai' },
      { section: '系统管理', title: '用户管理', url: '/admin/users' },
    ]
    const screen = await render(<NavGroup items={sectioned} />)

    await expect.element(screen.getByText('业务运营')).toBeVisible()
    await expect.element(screen.getByText('系统管理')).toBeVisible()
    // 「执行日志」整页只出现一次（就是那个入口本身），没有同名分组小字
    expect((document.body.textContent ?? '').split('执行日志').length - 1).toBe(
      1
    )
    expect(document.querySelectorAll('[data-slot="separator"]').length).toBe(1)
  })
})

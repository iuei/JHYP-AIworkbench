import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import '@/styles/index.css'
import { Dashboard } from '.'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/api/client', () => ({ api: { get: mocks.get, put: mocks.put } }))

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
}))

vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sonner')>()

  return {
    ...actual,
    toast: { ...actual.toast, error: mocks.toastError },
  }
})

// 顶栏由 authenticated-layout 统一渲染、页面名来自路由 staticData，仪表盘自己不再渲染 Header，
// 因此这里不再需要 mock Header / Search / ThemeSwitch / ProfileDropdown。
vi.mock('@/components/layout/main', () => ({
  Main: ({ children }: React.PropsWithChildren) => <main>{children}</main>,
}))

const shortcutTitles = ['AI 助手', '快捷导航', '竞品分析', '我的沉淀']

const dashboardData = {
  shortcutIds: ['ai-chat', 'quick-navigation', 'competitor', 'my-notes'],
  analyses: [{ id: 1, input_type: 'ASIN', input_value: 'B0BBB222' }],
}

/** 「我的 AI」卡片的数据源：员工可读的对话与沉淀接口。 */
const aiConversations = [
  {
    id: 11,
    title: '上个月广告 ACoS 为什么变高',
    messageCount: 4,
    lastMessageAt: '2026-09-10T02:00:00.000Z',
    updatedAt: '2026-09-10T02:00:00.000Z',
  },
  {
    id: 12,
    title: '库存还剩多少',
    messageCount: 2,
    lastMessageAt: '2026-09-09T03:00:00.000Z',
    updatedAt: '2026-09-09T03:00:00.000Z',
  },
]

/**
 * 首页现在会打三个接口：仪表盘 + 最近对话 + 沉淀条数（全部/待审核）。
 * 按 URL 分派，避免所有请求都拿到同一份响应。
 */
function mockDashboardApi(url: string) {
  if (url === '/dashboard') return Promise.resolve({ data: dashboardData })
  if (url.startsWith('/ai/conversations')) {
    return Promise.resolve({ data: { conversations: aiConversations } })
  }
  if (url.startsWith('/ai/notes')) {
    const pending = url.includes('status=pending')
    return Promise.resolve({
      data: { rows: [], total: pending ? 2 : 5, page: 1, pageSize: 1 },
    })
  }
  return Promise.resolve({ data: {} })
}

async function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  )
}

/** 按 DOM 顺序读出常用入口：排序按钮的 aria-label 里带着入口名称。 */
function shortcutOrder() {
  return Array.from(
    document.querySelectorAll('button[aria-label^="下移 "]')
  ).map((element) => (element.getAttribute('aria-label') ?? '').slice(3))
}

async function shortcutCardTop(title: string) {
  const locator = page.getByRole('button', { name: `上移 ${title}` })
  await expect.element(locator).toBeVisible()

  return Math.round(locator.element().getBoundingClientRect().top)
}

/** 用各入口首行位置判断当前排成几行（行数即布局的列数）。 */
async function shortcutRowCount() {
  const tops = await Promise.all(shortcutTitles.map(shortcutCardTop))
  return new Set(tops).size
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.get.mockImplementation(mockDashboardApi)
    mocks.put.mockResolvedValue({ data: null })
    void page.viewport(1440, 900)
  })

  it('shows only the four real entries and no placeholder content', async () => {
    await renderDashboard()

    // 用排序按钮的 aria-label 定位入口：卡片标题「我的沉淀」与「我的 AI」卡片里的小节同名，
    // 文本查询会同时命中两处，按钮名才唯一。
    for (const title of shortcutTitles) {
      await expect
        .element(page.getByRole('button', { name: `上移 ${title}` }))
        .toBeVisible()
    }

    expect(document.body.textContent).not.toContain('即将上线')
    expect(mocks.get).toHaveBeenCalledWith('/dashboard')
  })

  it('不再渲染顶部标题横幅：页面名统一由 Header 负责', async () => {
    await renderDashboard()

    // 改造前这里有一个 text-2xl 的 h1 加一段口号，占掉首屏两行；
    // 它是装饰性的，删掉后内容区首个元素直接是「常用入口」。
    expect(document.body.textContent).not.toContain('JHYP 智能工作台')
    expect(document.body.textContent).not.toContain(
      '用 AI 与自动化加速跨境电商运营工作。'
    )
    expect(document.querySelectorAll('h1')).toHaveLength(0)
  })

  it('keeps the homepage free of AI governance content', async () => {
    await renderDashboard()

    await expect
      .element(page.getByText('我的 AI', { exact: true }))
      .toBeVisible()
    for (const forbidden of [
      '知识库',
      '数据源',
      '经验审核',
      '模型与配置',
      '审计台',
    ]) {
      expect(document.body.textContent).not.toContain(forbidden)
    }
  })

  it('keeps all four entries when the saved order only holds retired ids', async () => {
    mocks.get.mockResolvedValue({
      data: {
        ...dashboardData,
        shortcutIds: ['competitor', 'project', 'listing', 'reviews'],
      },
    })

    await renderDashboard()

    for (const title of shortcutTitles) {
      await expect
        .element(page.getByRole('button', { name: `上移 ${title}` }))
        .toBeVisible()
    }
    expect(shortcutOrder()).toEqual([
      '竞品分析',
      'AI 助手',
      '快捷导航',
      '我的沉淀',
    ])
  })

  it('reorders with the move buttons and persists the new order', async () => {
    const screen = await renderDashboard()

    await userEvent.click(
      screen.getByRole('button', { name: '下移 AI 助手' })
    )

    await vi.waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith('/dashboard/shortcuts', {
        shortcutIds: [
          'quick-navigation',
          'ai-chat',
          'competitor',
          'my-notes',
        ],
      })
    )
    expect(shortcutOrder()).toEqual([
      '快捷导航',
      'AI 助手',
      '竞品分析',
      '我的沉淀',
    ])
  })

  it('disables the move buttons at the ends of the list', async () => {
    const screen = await renderDashboard()

    await expect
      .element(screen.getByRole('button', { name: '上移 AI 助手' }))
      .toBeDisabled()
    await expect
      .element(screen.getByRole('button', { name: '下移 我的沉淀' }))
      .toBeDisabled()
  })

  it('keeps the new order and warns when saving fails', async () => {
    mocks.put.mockRejectedValue(new Error('保存失败'))

    const screen = await renderDashboard()
    await userEvent.click(
      screen.getByRole('button', { name: '下移 AI 助手' })
    )

    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalled())
    // 保存失败不能让用户刚调好的顺序弹回去。
    expect(shortcutOrder()).toEqual([
      '快捷导航',
      'AI 助手',
      '竞品分析',
      '我的沉淀',
    ])
  })

  it('shows skeletons while the dashboard request is pending', async () => {
    mocks.get.mockReturnValue(new Promise(() => {}))

    await renderDashboard()

    await expect.element(page.getByText('常用入口', { exact: true })).toBeVisible()
    expect(
      document.querySelectorAll('[data-slot="skeleton"]').length
    ).toBeGreaterThan(0)
  })

  it('offers a retry button when loading fails, and recovers', async () => {
    // 只让仪表盘请求失败：首页现在还会打「我的 AI」的接口，用 Once 会被那些请求抢先消费掉。
    let dashboardFailed = false
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/dashboard' && !dashboardFailed) {
        dashboardFailed = true
        throw new Error('网络异常')
      }
      return mockDashboardApi(url)
    })

    const screen = await renderDashboard()
    const retry = screen.getByRole('button', { name: '重新加载' })
    await expect.element(retry).toBeVisible()

    await userEvent.click(retry)

    await expect
      .element(page.getByRole('button', { name: '上移 AI 助手' }))
      .toBeVisible()
  })

  it('shows explicit empty states instead of hiding the sections', async () => {
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/dashboard') {
        return { data: { shortcutIds: [], analyses: [] } }
      }
      if (url.startsWith('/ai/conversations')) {
        return { data: { conversations: [] } }
      }
      return { data: { rows: [], total: 0, page: 1, pageSize: 1 } }
    })

    const screen = await renderDashboard()

    await expect
      .element(screen.getByText('我的 AI', { exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByText('最近活动', { exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByText('还没有对话记录，去 AI 助手提第一个问题。'))
      .toBeVisible()
    await expect.element(screen.getByText('共 0 条')).toBeVisible()
    await expect
      .element(screen.getByText('完成一次竞品分析后，最近的记录会显示在这里'))
      .toBeVisible()
  })

  it('用「我的 AI」展示账号自己的数据，并让长标题不撑破布局', async () => {
    await page.viewport(390, 844)
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/dashboard') return { data: dashboardData }
      if (url.startsWith('/ai/conversations')) {
        return {
          data: {
            conversations: [
              {
                id: 21,
                title: '一件标题特别特别长的对话在窄屏下会不会把卡片撑破',
                messageCount: 3,
                lastMessageAt: '2026-09-10T02:00:00.000Z',
                updatedAt: '2026-09-10T02:00:00.000Z',
              },
            ],
          },
        }
      }
      const pending = url.includes('status=pending')
      return { data: { rows: [], total: pending ? 2 : 5, page: 1, pageSize: 1 } }
    })

    const screen = await renderDashboard()

    await expect
      .element(screen.getByRole('link', { name: /特别特别长的对话/ }))
      .toHaveAttribute('href', '/ai-agent')
    await expect
      .element(screen.getByRole('link', { name: /共 5 条/ }))
      .toHaveAttribute('href', '/ai-agent/notes')
    await expect.element(screen.getByText('2 条待审核')).toBeVisible()

    // 依赖假进度的 work_items 卡片已下线：文案与 65% 这类占位数字都不应再出现。
    expect(document.body.textContent).not.toContain('正在进行的工作')

    // 标题用 truncate 裁剪，不允许把页面撑出横向滚动。
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth
    )
  })

  it('lays the four entries out in a single row on desktop', async () => {
    await page.viewport(1440, 900)
    await renderDashboard()

    expect(await shortcutRowCount()).toBe(1)
  })

  it('lays the four entries out in two columns on tablet', async () => {
    await page.viewport(1024, 900)
    await renderDashboard()

    expect(await shortcutRowCount()).toBe(2)
  })

  it('stacks the four entries in one column on mobile', async () => {
    await page.viewport(390, 844)
    await renderDashboard()

    expect(await shortcutRowCount()).toBe(4)
  })
})

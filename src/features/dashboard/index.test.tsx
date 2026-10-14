import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/styles/index.css'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { Dashboard } from '.'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/api/client', () => ({ api: { get: mocks.get, put: mocks.put } }))

/**
 * 真实 `Link` 用 `search` 生成查询串，mock 必须等效拼出来：
 * 首页的深链（analysisId / conversationId / focus）全部在 search 里，
 * 只拼 `to` 的话这些断言永远看不到参数。
 */
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    ...props
  }: React.PropsWithChildren<{
    to: string
    search?: Record<string, unknown>
  }>) => {
    const query = search
      ? `?${new URLSearchParams(
          Object.entries(search).map(([key, value]) => [key, String(value)])
        ).toString()}`
      : ''
    return (
      <a href={`${to}${query}`} {...props}>
        {children}
      </a>
    )
  },
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

const shortcutTitles = ['AI 助手', '竞品分析', '个人知识库']

const dashboardData = {
  shortcutIds: ['ai-chat', 'competitor', 'my-notes'],
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

/** 分析历史摘要（`/competitor-analyses`）：一条需立即处理、一条需关注。 */
const analysisHistory = [
  {
    id: 31,
    inputType: 'ASIN',
    inputValue: 'B0BBB222',
    asins: ['B0BBB222'],
    marketplace: 'US',
    startDate: null,
    endDate: null,
    windowDays: 30,
    compareWith: 'previous_period',
    headline: 'ACoS 环比上升 12%，广告花费需要立即处理',
    level: 'high' as const,
    findingCount: 3,
    hasSnapshot: true,
    createdAt: '2026-09-14T02:00:00.000Z',
  },
  {
    id: 32,
    inputType: 'ASIN',
    inputValue: 'B0CCC333',
    asins: ['B0CCC333'],
    marketplace: 'US',
    startDate: null,
    endDate: null,
    windowDays: 30,
    compareWith: 'previous_period',
    headline: '库存偏低，需关注',
    level: 'medium' as const,
    findingCount: 1,
    hasSnapshot: true,
    createdAt: '2026-09-13T02:00:00.000Z',
  },
]

/**
 * 首页现在会打五个请求：仪表盘 + 分析历史 + 最近对话 + 沉淀条数（全部/待审核）。
 * 按 URL 分派，避免所有请求都拿到同一份响应。
 */
function mockDashboardApi(url: string) {
  if (url === '/dashboard') return Promise.resolve({ data: dashboardData })
  if (url.startsWith('/competitor-analyses')) {
    return Promise.resolve({ data: { items: analysisHistory } })
  }
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

/** 只覆盖分析历史这一个接口，其余走默认分派。 */
function mockAnalysisHistory(items: unknown[]) {
  mocks.get.mockImplementation((url: string) =>
    url.startsWith('/competitor-analyses')
      ? Promise.resolve({ data: { items } })
      : mockDashboardApi(url)
  )
}

/** 按 DOM 顺序读出页面里所有链接的 href（深链断言用）。 */
function hrefs() {
  return Array.from(document.querySelectorAll('a')).map((a) =>
    a.getAttribute('href')
  )
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

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.get.mockImplementation(mockDashboardApi)
    mocks.put.mockResolvedValue({ data: null })
    void page.viewport(1440, 900)
  })

  it('shows only the four real entries and no placeholder content', async () => {
    await renderDashboard()

    // 用排序按钮的 aria-label 定位入口：卡片标题「个人知识库」与「我的 AI」卡片里的小节同名，
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
    /*
     * 「知识库」不再列入禁用词（2026-09-18）：它已拆出**员工面**
     * （侧边栏「AI 工作台 → 知识库」，首页快捷入口也叫「个人知识库」），
     * 首页出现它是正确的。守护改由治理类目名 + 四个治理子页承担，强度不变 ——
     * 这些词一旦出现在首页，仍然说明治理面被误挂到了使用面。
     */
    for (const forbidden of [
      'AI 治理',
      '数据源',
      '经验审核',
      '模型与配置',
      '审计台',
    ]) {
      expect(document.body.textContent).not.toContain(forbidden)
    }
  })

  it('keeps every entry when the saved order only holds retired ids', async () => {
    mocks.get.mockImplementation((url: string) =>
      url === '/dashboard'
        ? Promise.resolve({
            data: {
              ...dashboardData,
              shortcutIds: ['competitor', 'project', 'listing', 'reviews'],
            },
          })
        : mockDashboardApi(url)
    )

    await renderDashboard()

    for (const title of shortcutTitles) {
      await expect
        .element(page.getByRole('button', { name: `上移 ${title}` }))
        .toBeVisible()
    }
    expect(shortcutOrder()).toEqual(['竞品分析', 'AI 助手', '个人知识库'])
  })

  it('reorders with the move buttons and persists the new order', async () => {
    const screen = await renderDashboard()

    await userEvent.click(screen.getByRole('button', { name: '下移 AI 助手' }))

    await vi.waitFor(() =>
      expect(mocks.put).toHaveBeenCalledWith('/dashboard/shortcuts', {
        shortcutIds: ['competitor', 'ai-chat', 'my-notes'],
      })
    )
    expect(shortcutOrder()).toEqual(['竞品分析', 'AI 助手', '个人知识库'])
  })

  it('disables the move buttons at the ends of the list', async () => {
    const screen = await renderDashboard()

    await expect
      .element(screen.getByRole('button', { name: '上移 AI 助手' }))
      .toBeDisabled()
    await expect
      .element(screen.getByRole('button', { name: '下移 个人知识库' }))
      .toBeDisabled()
  })

  it('keeps the new order and warns when saving fails', async () => {
    mocks.put.mockRejectedValue(new Error('保存失败'))

    const screen = await renderDashboard()
    await userEvent.click(screen.getByRole('button', { name: '下移 AI 助手' }))

    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalled())
    // 保存失败不能让用户刚调好的顺序弹回去。
    expect(shortcutOrder()).toEqual(['竞品分析', 'AI 助手', '个人知识库'])
  })

  it('shows skeletons while the dashboard request is pending', async () => {
    mocks.get.mockReturnValue(new Promise(() => {}))

    await renderDashboard()

    await expect
      .element(page.getByText('常用入口', { exact: true }))
      .toBeVisible()
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

  it('快捷入口顺序读取失败时，其它数据区仍独立显示', async () => {
    mocks.get.mockImplementation((url: string) =>
      url === '/dashboard'
        ? Promise.reject(new Error('顺序读取失败'))
        : mockDashboardApi(url)
    )

    const screen = await renderDashboard()
    await expect
      .element(screen.getByText('自定义顺序暂时无法读取，当前按默认顺序展示。'))
      .toBeVisible()
    await expect
      .element(screen.getByText('ACoS 环比上升 12%，广告花费需要立即处理'))
      .toBeVisible()
    await expect
      .element(screen.getByText('上个月广告 ACoS 为什么变高'))
      .toBeVisible()
  })

  it('需处理统计包含扫描范围内全部高优先级记录，不被三行展示上限截断', async () => {
    mockAnalysisHistory(
      Array.from({ length: 5 }, (_, index) => ({
        ...analysisHistory[0],
        id: 100 + index,
        headline: `需处理结论 ${index + 1}`,
      }))
    )

    const screen = await renderDashboard()
    await expect
      .element(
        screen.getByText(/最近 20 次分析中有 5 条尚未销账的高优先级记录/)
      )
      .toBeVisible()
    await expect
      .element(screen.getByText('这里只展示最近 3 条。', { exact: false }))
      .toBeVisible()
    const attentionCard = screen
      .getByRole('heading', { name: '需处理的分析' })
      .element()
      .closest('[data-slot="card"]')
    expect(attentionCard?.querySelectorAll('tbody tr')).toHaveLength(3)
  })

  it('需处理只取「未销账」级别为 high 的记录，并链接到那条快照', async () => {
    await renderDashboard()

    // 卡片描述里也有「需立即处理」字样，不能拿它当渲染完成的信号，直接等链接出现
    await vi.waitFor(() =>
      expect(hrefs()).toContain('/competitor-analysis?analysisId=31')
    )
    // medium 那条的结论摘要不得进「需处理」（最近分析卡不显示摘要，所以它只该出现在那里）
    expect(document.body.textContent).not.toContain('库存偏低，需关注')
    expect(hrefs()).toContain('/competitor-analysis?analysisId=32')
  })

  it('已销账（待核验 / 已核验 / 已忽略）的记录不再计入「需处理」', async () => {
    /*
     * 快照判定仍是 high，但服务端算出的 `openLevel` 已经降到 medium —— 这代表用户标记了
     * 「我已处理」或选择「不处理」。首页必须跟着停止报警，否则闭环没闭上：用户处理完，
     * 首页还在一直红字报警。
     */
    mockAnalysisHistory([
      {
        ...analysisHistory[0],
        openLevel: 'medium' as const,
        openFindingCount: 1,
      },
    ])

    const screen = await renderDashboard()

    await expect
      .element(screen.getByText('最近 20 次分析里没有需要立即处理的问题'))
      .toBeVisible()
  })

  it('有分析但没有需立即处理的结论时，空态写明扫描范围', async () => {
    mockAnalysisHistory([analysisHistory[1]])

    const screen = await renderDashboard()

    // 只说"这批记录里没有"，不说"全库没有"
    await expect
      .element(screen.getByText('最近 20 次分析里没有需要立即处理的问题'))
      .toBeVisible()
  })

  it('一条分析记录都没有时不提供「继续上次分析」，并给出引导', async () => {
    mockAnalysisHistory([])

    const screen = await renderDashboard()

    await expect
      .element(screen.getByText('还没有分析记录，从上面的「新建分析」开始'))
      .toBeVisible()
    expect(document.body.textContent).not.toContain('继续上次分析')
  })

  it('shows explicit empty states instead of hiding the sections', async () => {
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/dashboard') {
        return { data: { shortcutIds: [], analyses: [] } }
      }
      // 分析历史必须是空数组而不是缺字段：React Query v5 不接受 undefined 作为查询数据，
      // 缺 items 会让查询进入 error 态，测到的就不是"空数据"而是"加载失败"了。
      if (url.startsWith('/competitor-analyses')) {
        return { data: { items: [] } }
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
      .element(screen.getByText('最近分析', { exact: true }))
      .toBeVisible()
    await expect
      .element(screen.getByText('还没有对话记录，去 AI 助手提第一个问题。'))
      .toBeVisible()
    await expect.element(screen.getByText('共 0 条')).toBeVisible()
    // 一条分析记录都没有时的引导（与「有记录但没有 high」的空态是两种文案）
    await expect
      .element(screen.getByText('还没有分析记录，从上面的「新建分析」开始'))
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
      if (url.startsWith('/competitor-analyses')) return mockDashboardApi(url)
      const pending = url.includes('status=pending')
      return {
        data: { rows: [], total: pending ? 2 : 5, page: 1, pageSize: 1 },
      }
    })

    const screen = await renderDashboard()

    // 最近对话必须能直接继续那个会话，而不是只跳到 AI 助手首页
    await expect
      .element(screen.getByRole('link', { name: /特别特别长的对话/ }))
      .toHaveAttribute('href', '/ai-agent?conversationId=21')
    await expect
      .element(screen.getByRole('link', { name: /共 5 条/ }))
      // 知识库默认子页是「团队知识库」，个人沉淀入口必须显式带 view=mine
      .toHaveAttribute('href', '/knowledge?view=mine')
    await expect.element(screen.getByText('2 条待审核')).toBeVisible()

    // 依赖假进度的 work_items 卡片已下线：文案与 65% 这类占位数字都不应再出现。
    expect(document.body.textContent).not.toContain('正在进行的工作')

    // 标题用 truncate 裁剪，不允许把页面撑出横向滚动。
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth
    )
  })

  it('宽屏把概览放在顶部，两排卡片边界和列起点对齐', async () => {
    await page.viewport(1440, 900)
    const screen = await renderDashboard()
    const start = screen.getByRole('heading', { name: '开始工作' })
    const attention = screen.getByRole('heading', { name: '需处理的分析' })
    const overview = screen.getByRole('heading', { name: '工作概览' })
    await expect.element(start).toBeVisible()
    await expect.element(attention).toBeVisible()
    expect(attention.element().getBoundingClientRect().left).toBeLessThan(
      start.element().getBoundingClientRect().left
    )
    expect(overview.element().getBoundingClientRect().top).toBeLessThan(
      start.element().getBoundingClientRect().top
    )
    const attentionCard = attention.element().closest('[data-slot="card"]')
    const startCard = start.element().closest('[data-slot="card"]')
    const recentCard = screen
      .getByRole('heading', { name: '最近分析' })
      .element()
      .closest('[data-slot="card"]')
    const aiCard = screen
      .getByRole('heading', { name: '我的 AI' })
      .element()
      .closest('[data-slot="card"]')
    expect(
      Math.abs(
        attentionCard!.getBoundingClientRect().bottom -
          startCard!.getBoundingClientRect().bottom
      )
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(
        recentCard!.getBoundingClientRect().bottom -
          aiCard!.getBoundingClientRect().bottom
      )
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(
        attentionCard!.getBoundingClientRect().left -
          recentCard!.getBoundingClientRect().left
      )
    ).toBeLessThanOrEqual(1)
    expect(
      Math.abs(
        startCard!.getBoundingClientRect().left -
          aiCard!.getBoundingClientRect().left
      )
    ).toBeLessThanOrEqual(1)
    await vi.waitFor(() =>
      expect(attentionCard?.querySelector('tbody a')).not.toBeNull()
    )
    const action = attentionCard?.querySelector('tbody a')
    const tableScroller = attentionCard?.querySelector('table')?.parentElement
    expect(action!.getBoundingClientRect().right).toBeLessThanOrEqual(
      tableScroller!.getBoundingClientRect().right + 1
    )
  })

  it('平板让开始工作先于待处理，且页面不产生横向滚动', async () => {
    await page.viewport(820, 900)
    const screen = await renderDashboard()
    const start = screen.getByRole('heading', { name: '开始工作' })
    const attention = screen.getByRole('heading', { name: '需处理的分析' })
    const overview = screen.getByRole('heading', { name: '工作概览' })
    await expect.element(start).toBeVisible()
    expect(overview.element().getBoundingClientRect().top).toBeLessThan(
      start.element().getBoundingClientRect().top
    )
    expect(start.element().getBoundingClientRect().top).toBeLessThan(
      attention.element().getBoundingClientRect().top
    )
    const attentionCard = attention.element().closest('[data-slot="card"]')
    await vi.waitFor(() =>
      expect(
        attentionCard?.querySelector('a[aria-label="回看分析记录 #31"]')
      ).not.toBeNull()
    )
    expect(attentionCard?.querySelector('table')).toBeNull()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth
    )
  })

  it('窄屏保持快捷入口可见且页面不产生横向滚动', async () => {
    await page.viewport(390, 844)
    const screen = await renderDashboard()
    for (const title of shortcutTitles) {
      await expect
        .element(screen.getByRole('button', { name: `上移 ${title}` }))
        .toBeVisible()
    }
    const overviewTop = screen
      .getByRole('heading', { name: '工作概览' })
      .element()
      .getBoundingClientRect().top
    const startTop = screen
      .getByRole('heading', { name: '开始工作' })
      .element()
      .getBoundingClientRect().top
    expect(overviewTop).toBeLessThan(startTop)
    const statValues = document.querySelectorAll(
      '[aria-labelledby="overview-heading"] dd'
    )
    expect(
      Math.abs(
        statValues[0].getBoundingClientRect().top -
          statValues[1].getBoundingClientRect().top
      )
    ).toBeLessThanOrEqual(1)
    const attentionCard = screen
      .getByRole('heading', { name: '需处理的分析' })
      .element()
      .closest('[data-slot="card"]')
    await vi.waitFor(() =>
      expect(
        attentionCard?.querySelector('a[aria-label="回看分析记录 #31"]')
      ).not.toBeNull()
    )
    const mobileAction = attentionCard!.querySelector(
      'a[aria-label="回看分析记录 #31"]'
    )!
    expect(mobileAction.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(mobileAction.getBoundingClientRect().right).toBeLessThanOrEqual(
      attentionCard!.getBoundingClientRect().right
    )
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth
    )
  })
})

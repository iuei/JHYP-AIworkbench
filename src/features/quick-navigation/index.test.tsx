import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QuickNavigation } from '.'
import type { QuickNavigationData } from './types'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: { get: mocks.get },
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (
    selector: (state: {
      auth: { user: { accountNo: string; role: string[] } }
    }) => unknown
  ) =>
    selector({
      auth: { user: { accountNo: 'admin@example.com', role: ['admin'] } },
    }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('@/components/layout/header', () => ({
  Header: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
}))

vi.mock('@/components/layout/main', () => ({
  Main: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}))

vi.mock('@/components/profile-dropdown', () => ({
  ProfileDropdown: () => null,
}))

vi.mock('@/components/theme-switch', () => ({
  ThemeSwitch: () => null,
}))

const data: QuickNavigationData = {
  featuredItems: [
    {
      id: 1,
      categoryId: null,
      name: '积加 ERP',
      url: 'https://example.com/erp',
      description: '',
      placement: 'featured',
      sortOrder: 0,
      tags: [],
    },
  ],
  categories: [
    {
      id: 1,
      name: '常用查询',
      sortOrder: 0,
      items: [
        {
          id: 2,
          categoryId: 1,
          name: '美国商标查询入口',
          url: 'https://example.com/trademark',
          description: '美国官方商标检索平台',
          placement: 'category',
          sortOrder: 0,
          tags: [{ id: 1, name: '合规' }],
        },
      ],
    },
  ],
  tags: [{ id: 1, name: '合规' }],
}

async function renderNavigation() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <QuickNavigation />
    </QueryClientProvider>
  )
}

describe('QuickNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.get.mockResolvedValue({ data })
  })

  it('优先展示搜索与紧凑导航内容', async () => {
    const screen = await renderNavigation()

    await expect.element(screen.getByLabelText('搜索快捷导航')).toBeVisible()
    await expect.element(screen.getByText('常用入口')).toBeVisible()
    await expect.element(screen.getByText('美国商标查询入口')).toBeVisible()
    await expect.element(screen.getByText('美国官方商标检索平台')).toBeVisible()
    await expect
      .element(screen.getByText('Internal workflow'))
      .not.toBeInTheDocument()
    await expect.element(screen.getByText('合规')).not.toBeInTheDocument()
  })

  it('标签不占用页面空间但仍可被搜索', async () => {
    const screen = await renderNavigation()

    await userEvent.fill(screen.getByLabelText('搜索快捷导航'), '合规')

    await expect.element(screen.getByText('美国商标查询入口')).toBeVisible()
  })
})

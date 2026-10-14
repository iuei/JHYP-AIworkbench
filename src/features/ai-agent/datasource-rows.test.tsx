import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { DatasourceManagement } from './pages/datasource-management'

const mocks = vi.hoisted(() => ({ get: vi.fn(), rawRequest: vi.fn() }))

vi.mock('@/api/client', () => ({
  api: {
    get: mocks.get,
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  rawRequest: mocks.rawRequest,
}))

const datasetOverview = {
  key: 'amazon_ads_daily',
  label: 'Amazon 广告日报',
  description: '广告活动/关键词层级的每日曝光、点击、花费、订单与销售额',
  rows: 1,
  columns: [
    { key: 'stat_date', label: '日期', required: true },
    { key: 'asin', label: 'ASIN', required: true },
    { key: 'spend', label: '花费', required: false },
  ],
  importedAt: '2026-09-11T00:00:00.000Z',
  lastImportAt: '2026-09-11T00:00:00.000Z',
  lastImportStatus: 'ok',
  lastImportError: null,
  periodStart: '2026-09-01',
  periodEnd: '2026-09-01',
}

const rowsPayload = {
  dataset: 'amazon_ads_daily',
  label: 'Amazon 广告日报',
  description: datasetOverview.description,
  columns: [
    { key: 'stat_date', label: '日期', type: 'date', required: true },
    { key: 'asin', label: 'ASIN', type: 'string', required: true },
    { key: 'spend', label: '花费', type: 'decimal', required: false },
  ],
  rows: [{ id: 1, stat_date: '2026-09-01', asin: 'B0TEST1234', spend: '12.50' }],
  total: 1,
  page: 1,
  pageSize: 20,
}

/** 按 URL 分派：清单、导入记录、行详情是三个独立接口。 */
function mockApi(url: string) {
  const path = String(url)
  if (path.startsWith('/ai/datasets/rows')) {
    return Promise.resolve({ data: rowsPayload })
  }
  if (path.startsWith('/ai/datasets')) {
    return Promise.resolve({
      data: { datasets: [datasetOverview], recentImports: [] },
    })
  }
  if (path.startsWith('/ai/imports')) {
    return Promise.resolve({
      data: { imports: [], total: 0, page: 1, pageSize: 20 },
    })
  }
  return Promise.resolve({ data: {} })
}

async function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <DatasourceManagement />
    </QueryClientProvider>
  )
}

/** 行详情请求的 URL 列表（用来断言"只有点开才拉数据"与关键词筛选走服务端）。 */
function rowRequests() {
  return mocks.get.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith('/ai/datasets/rows'))
}

describe('数据源与导入：查看数据源详情数据', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.get.mockImplementation(mockApi)
    void page.viewport(1280, 900)
  })

  it('未点开卡片时不请求行详情', async () => {
    await renderPage()

    await expect
      .element(page.getByRole('button', { name: '查看Amazon 广告日报数据详情' }))
      .toBeVisible()
    // 清单接口只给统计：管理员没点开就不该为一份没人看的数据买单
    expect(rowRequests()).toHaveLength(0)
  })

  it('点击数据集卡片打开详情弹窗并显示数据行', async () => {
    await renderPage()

    await page
      .getByRole('button', { name: '查看Amazon 广告日报数据详情' })
      .click()

    await expect
      .element(page.getByText('数据详情 · Amazon 广告日报'))
      .toBeVisible()
    await expect.element(page.getByText('B0TEST1234')).toBeVisible()
    // 行数据落在表格单元格里（弹窗描述里也有同样的日期文案，因此按单元格断言）
    await expect
      .element(page.getByRole('cell', { name: '2026-09-01' }))
      .toBeVisible()
    expect(rowRequests()[0]).toContain('dataset=amazon_ads_daily')
  })

  it('卡片可键盘打开（Enter）', async () => {
    await renderPage()

    const card = page.getByRole('button', {
      name: '查看Amazon 广告日报数据详情',
    })
    await expect.element(card).toBeVisible()
    card.element().focus()
    await userEvent.keyboard('{Enter}')

    await expect
      .element(page.getByText('数据详情 · Amazon 广告日报'))
      .toBeVisible()
  })

  it('关键词筛选走服务端参数，而不是前端过滤', async () => {
    await renderPage()

    await page
      .getByRole('button', { name: '查看Amazon 广告日报数据详情' })
      .click()
    const search = page.getByLabelText('搜索数据行')
    await expect.element(search).toBeVisible()

    await search.fill('B0ABC')

    // 输入防抖 300ms 后才发请求
    await vi.waitFor(
      () => {
        expect(rowRequests().some((url) => url.includes('keyword=B0ABC'))).toBe(
          true
        )
      },
      { timeout: 5000 }
    )
  })
})

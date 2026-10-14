import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { useAuthStore } from '@/stores/auth-store'
import { clearCookies } from '@/test-utils/cookies'
import { AnnouncementGate } from './components/announcement-gate'
import type { PendingAnnouncement } from './types'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('@/api/client', () => ({
  api: {
    get: mocks.get,
    post: mocks.post,
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

function announcement(
  id: number,
  title: string,
  displayMode: PendingAnnouncement['displayMode'] = 'once'
): PendingAnnouncement {
  return {
    id,
    title,
    // 正文刻意不重复标题：弹窗标题与正文各一份同名文本会让断言（和读屏）分不清
    body: `第 ${id} 条的正文，**请相互转告**。`,
    displayMode,
    publishedAt: '2026-09-15T09:00:00.000Z',
  }
}

/** 只有 `/announcements/pending` 会被这条链路请求；其余路径返回空对象兜底。 */
function mockApi(url: string) {
  const path = String(url)
  if (path.startsWith('/announcements/pending')) {
    return Promise.resolve({ data: { items: pendingItems } })
  }
  return Promise.resolve({ data: {} })
}

let pendingItems: PendingAnnouncement[] = []

function renderGate() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AnnouncementGate />
    </QueryClientProvider>
  )
}

/** 模拟"刚刚登录成功"：`loginAt` 只由 setAccessToken 写入（内存态）。 */
function signIn() {
  useAuthStore.getState().auth.setAccessToken('token-after-login')
}

function pendingRequests() {
  return mocks.get.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.startsWith('/announcements/pending'))
}

function ackCalls() {
  return mocks.post.mock.calls.map(([url]) => String(url))
}

describe('公告弹窗：登录时弹出', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearCookies()
    useAuthStore.getState().auth.reset()
    pendingItems = []
    mocks.get.mockImplementation(mockApi)
    mocks.post.mockResolvedValue({ status: 204 })
    void page.viewport(1280, 900)
  })

  it('没有登录过（刷新页面 / 站内跳转）时一次都不请求，也不弹窗', async () => {
    pendingItems = [announcement(1, '系统维护通知')]

    await renderGate()

    expect(pendingRequests()).toHaveLength(0)
    await expect
      .element(page.getByText('系统维护通知'))
      .not.toBeInTheDocument()
  })

  it('登录后弹出「只弹一次」的公告，点「我知道了」才上报已读', async () => {
    pendingItems = [announcement(7, '系统维护通知', 'once')]
    signIn()

    await renderGate()

    await expect.element(page.getByText('系统维护通知')).toBeVisible()
    // 正文走 Markdown 渲染：加粗变成元素，星号不该出现在可见文本里
    await expect.element(page.getByText('请相互转告')).toBeVisible()
    await expect
      .element(page.getByText('**请相互转告**'))
      .not.toBeInTheDocument()
    expect(ackCalls()).toHaveLength(0)

    await page.getByRole('button', { name: '我知道了' }).click()

    // 关闭后弹窗消失，且已读上报了正确的公告
    await expect.element(page.getByText('系统维护通知')).not.toBeInTheDocument()
    expect(ackCalls()).toEqual(['/announcements/7/ack'])
  })

  it('用 Esc 关掉也算已读（否则"关掉了又弹"）', async () => {
    pendingItems = [announcement(9, '报销制度更新', 'once')]
    signIn()

    await renderGate()
    await expect.element(page.getByText('报销制度更新')).toBeVisible()

    await userEvent.keyboard('{Escape}')

    await expect.element(page.getByText('报销制度更新')).not.toBeInTheDocument()
    // 模态弹窗被关掉即视为已处理：不上报已读的话，下次登录同一条公告会再弹一次
    expect(ackCalls()).toEqual(['/announcements/9/ack'])
  })

  it('多条公告排队逐条展示，并提示还剩几条', async () => {
    pendingItems = [
      announcement(1, '第一条公告'),
      announcement(2, '第二条公告'),
    ]
    signIn()

    await renderGate()

    await expect.element(page.getByText('第一条公告')).toBeVisible()
    // 服务端给的顺序原样展示；此时第二条不出现
    await expect.element(page.getByText('第二条公告')).not.toBeInTheDocument()
    await expect.element(page.getByText('还有 1 条公告待查看')).toBeVisible()

    await page.getByRole('button', { name: '我知道了' }).click()

    await expect.element(page.getByText('第二条公告')).toBeVisible()
    await expect.element(page.getByText('第一条公告')).not.toBeInTheDocument()

    await page.getByRole('button', { name: '我知道了' }).click()

    await expect.element(page.getByText('第二条公告')).not.toBeInTheDocument()
    expect(ackCalls()).toEqual(['/announcements/1/ack', '/announcements/2/ack'])
  })

  it('「每次登录都弹」的公告同样记已读（管理员据此看触达情况）', async () => {
    pendingItems = [announcement(3, '安全提醒', 'every_login')]
    signIn()

    await renderGate()
    await expect.element(page.getByText('安全提醒')).toBeVisible()

    await page.getByRole('button', { name: '我知道了' }).click()

    expect(ackCalls()).toEqual(['/announcements/3/ack'])
  })
})

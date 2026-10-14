import { AxiosError, type AxiosResponse } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { ChatWorkbench } from './pages/chat-workbench'
import type { AiMessage, Conversation } from './types'

/**
 * 会话删除的交互闭环。
 *
 * 覆盖的是"**删掉正在看的那条**"这一条最容易被忽略的路径：会话行消失很容易，
 * 难的是中栏也要跟着回到空态 —— `GET /ai/conversations/:id/messages` 对已删除会话
 * 返回 404，而中栏没有任何错误分支，只把左栏条目拿掉会留下一片"没有内容也没有引导"的空白。
 */
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  remove: vi.fn(),
  patch: vi.fn(),
  search: {} as Record<string, unknown>,
  rows: [] as Conversation[],
  messages: new Map<number, AiMessage[]>(),
  /** 模拟"会话已不存在"（他人会话 / 被删除后仍有深链指向它）。 */
  missing: new Set<number>(),
}))

// 工作台链路上的 `sse.ts` 会 import `apiUrl`，因此 client 的每个导出都要给出替身
vi.mock('@/api/client', () => ({
  API_BASE_URL: 'http://localhost:8787/api',
  apiUrl: (path: string) => path,
  authHeaders: () => ({}),
  handleUnauthorized: vi.fn(),
  api: {
    get: mocks.get,
    post: vi.fn(),
    patch: mocks.patch,
    put: vi.fn(),
    delete: mocks.remove,
  },
  rawRequest: vi.fn(),
}))

// 真实模块整体保留：工作台只用到 `useSearch`，其余子组件可能继续用 Link 等导出
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return { ...actual, useSearch: () => mocks.search }
})

function notFound() {
  const error = new AxiosError('会话不存在。')
  error.response = {
    status: 404,
    statusText: 'Not Found',
    data: {},
  } as AxiosResponse
  return error
}

function mockApi(url: string) {
  const path = String(url)
  const messageMatch = /^\/ai\/conversations\/(\d+)\/messages$/.exec(path)
  if (messageMatch) {
    const id = Number(messageMatch[1])
    if (mocks.missing.has(id)) return Promise.reject(notFound())
    return Promise.resolve({ data: { messages: mocks.messages.get(id) ?? [] } })
  }
  if (path.startsWith('/ai/conversations')) {
    return Promise.resolve({
      data: {
        conversations: mocks.rows,
        total: mocks.rows.length,
        page: 1,
        pageSize: 20,
      },
    })
  }
  if (path.startsWith('/ai/tools')) {
    return Promise.resolve({
      data: {
        tools: [],
        // demo: false —— 空态不追加"演示模式"说明段，断言只盯引导文案
        provider: { name: 'demo', mode: 'demo', model: 'demo', demo: false },
      },
    })
  }
  return Promise.resolve({ data: {} })
}

const STAMP = '2026-09-18T02:00:00.000Z'
const EMPTY_HINT = '用自然语言提问，系统自动检索企业知识并给出带出处的结论。'

function conversation(id: number, title: string): Conversation {
  return {
    id,
    title,
    messageCount: 2,
    pinned: false,
    problemCount: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
    lastMessageAt: STAMP,
  }
}

function userMessage(id: number, content: string): AiMessage {
  return {
    id,
    role: 'user',
    content,
    status: 'ok',
    provider: null,
    model: null,
    tokensIn: null,
    tokensOut: null,
    latencyMs: null,
    citations: [],
    blocks: [],
    createdAt: STAMP,
    runs: [],
  }
}

async function renderWorkbench() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ChatWorkbench />
    </QueryClientProvider>
  )
}

/** 会话行右端的「⋯」操作菜单触发器（常显，不依赖鼠标悬停）。 */
function rowMenu(title: string) {
  return page.getByRole('button', { name: `会话操作：${title}` })
}

describe('会话列表的「⋯」操作菜单与删除', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.search = {}
    mocks.rows = []
    mocks.messages = new Map()
    mocks.missing = new Set()
    mocks.get.mockImplementation(mockApi)
    mocks.patch.mockResolvedValue({
      data: { conversation: { id: 0, title: '', pinned: false } },
    })
    mocks.remove.mockImplementation((url: string) => {
      const id = Number(String(url).split('/').pop())
      // 真实服务端删除后列表不再返回它，前端靠 invalidate 重新取
      mocks.rows = mocks.rows.filter((row) => row.id !== id)
      return Promise.resolve({ status: 204, data: undefined })
    })
    void page.viewport(1280, 900)
  })

  it('「⋯」按钮常显，菜单内含置顶 / 重命名 / 删除', async () => {
    mocks.rows = [conversation(1, '库存补货流程')]

    await renderWorkbench()

    await expect.element(rowMenu('库存补货流程')).toBeVisible()
    // 常显：按钮不得被任何 opacity-0 容器包着 —— 改前正是如此（只有鼠标悬停该行才显形，
    // 触屏设备上永远看不到，用户根本找不到删除入口）
    expect(rowMenu('库存补货流程').element().closest('.opacity-0')).toBeNull()

    await rowMenu('库存补货流程').click()
    await expect
      .element(page.getByRole('menuitem', { name: '置顶会话' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('menuitem', { name: '重命名' }))
      .toBeVisible()
    await expect
      .element(page.getByRole('menuitem', { name: '删除' }))
      .toBeVisible()
  })

  it('删除正在查看的会话后回到新会话空态', async () => {
    mocks.rows = [conversation(1, '库存补货流程')]
    mocks.messages.set(1, [userMessage(11, '库存补货流程是什么？')])

    await renderWorkbench()

    await page.getByRole('button', { name: /^库存补货流程/ }).click()
    await expect.element(page.getByText('库存补货流程是什么？')).toBeVisible()

    await rowMenu('库存补货流程').click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    await page.getByRole('button', { name: '删除', exact: true }).click()

    // 左栏条目已消失，中栏必须一起回到空态：否则用户看到的是"没有内容也没有引导"的空白页
    await expect.element(page.getByText(EMPTY_HINT)).toBeVisible()
    await expect
      .element(page.getByText('库存补货流程是什么？'))
      .not.toBeInTheDocument()
  })

  it('删除其他会话不影响正在查看的会话', async () => {
    mocks.rows = [
      conversation(1, '库存补货流程'),
      conversation(2, '广告 ACoS 归因'),
    ]
    mocks.messages.set(2, [userMessage(21, 'ACoS 怎么归因？')])

    await renderWorkbench()

    await page.getByRole('button', { name: /^广告 ACoS 归因/ }).click()
    await expect.element(page.getByText('ACoS 怎么归因？')).toBeVisible()

    // 删掉「库存补货流程」这条（不是正在看的那条）
    await rowMenu('库存补货流程').click()
    await page.getByRole('menuitem', { name: '删除' }).click()
    await page.getByRole('button', { name: '删除', exact: true }).click()

    await expect.element(page.getByText('ACoS 怎么归因？')).toBeVisible()
    await expect.element(page.getByText(EMPTY_HINT)).not.toBeInTheDocument()
  })

  it('重命名仍可从菜单进入编辑态', async () => {
    mocks.rows = [conversation(1, '库存补货流程')]

    await renderWorkbench()

    await rowMenu('库存补货流程').click()
    await page.getByRole('menuitem', { name: '重命名' }).click()

    await expect.element(page.getByLabelText('会话标题')).toBeVisible()
  })

  it('置顶仍可从菜单触发', async () => {
    mocks.rows = [conversation(1, '库存补货流程')]

    await renderWorkbench()

    await rowMenu('库存补货流程').click()
    await page.getByRole('menuitem', { name: '置顶会话' }).click()

    await vi.waitFor(() => {
      expect(mocks.patch).toHaveBeenCalledWith('/ai/conversations/1', {
        title: undefined,
        pinned: true,
      })
    })
  })

  it('深链指向已不存在的会话时回到空态，而不是永久空白', async () => {
    // 首页「最近对话」深链 / 旧书签指向一条后来被删除的会话
    mocks.search = { conversationId: 1 }
    mocks.rows = [conversation(2, '广告 ACoS 归因')]
    mocks.missing.add(1)

    await renderWorkbench()

    await expect.element(page.getByText(EMPTY_HINT)).toBeVisible()
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
// 布局断言必须让 Tailwind 真正生效：不导入全局样式时 `hidden lg:flex` / `flex-1` / `truncate`
// 全是空类，量出来的宽度与真实页面无关（踩过：不导入时怎么量都不复现溢出）
import '@/styles/index.css'
import { ChatWorkbench } from './pages/chat-workbench'
import type { AiMessage, Conversation } from './types'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  rows: [] as Conversation[],
}))

vi.mock('@/api/client', () => ({
  API_BASE_URL: 'http://localhost:8787/api',
  apiUrl: (path: string) => path,
  authHeaders: () => ({}),
  handleUnauthorized: vi.fn(),
  api: {
    get: mocks.get,
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  rawRequest: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return { ...actual, useSearch: () => ({}) }
})

/**
 * 左栏收窄到最小宽度时的横向溢出。
 *
 * 踩过的坑：`ScrollArea`（Radix）会在 Viewport 里插一层 `display: table; min-width: 100%`
 * 的包装（内联样式，class 覆盖不掉）。table 布局按内容的 **min-content** 撑宽，于是这一层
 * 不跟随容器而是固定在 407px —— 左栏拖窄后，行右端的「⋯」按钮与「加载更早的会话」按钮的右段
 * 落到容器之外，被 Viewport 的 `overflow-x: hidden` 裁掉（用户看到按钮被遮挡/截断）。
 * 修复方式与中栏消息流一致：改用原生 block 滚动容器。
 *
 * 这里必须用**真实工作台**（而不是把 ConversationList 塞进一个窄 div）：ScrollArea 的 table
 * 包装依赖真实的 flex 高度链，脱离它测不出这个缺陷。
 */
const NARROW_WIDTH = 200
const LONG_TITLE =
  '我的 ASIN 列表与广告 ACoS 归因分析会话（长标题用来逼近 min-content 极限）'
const STAMP = '2026-09-18T02:00:00.000Z'

function conversation(id: number, title: string): Conversation {
  return {
    id,
    title,
    messageCount: 3,
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

function mockApi(url: string) {
  const path = String(url)
  const messageMatch = /^\/ai\/conversations\/(\d+)\/messages$/.exec(path)
  if (messageMatch) {
    return Promise.resolve({ data: { messages: [userMessage(1, '占位问题')] } })
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
        provider: { name: 'demo', mode: 'demo', model: 'demo', demo: false },
      },
    })
  }
  return Promise.resolve({ data: {} })
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

function aside() {
  return document.querySelector('aside') as HTMLElement
}

/** 直接查 DOM：布局断言要轮询到稳定值，不能用同步快照（全量并行跑时会量到中间帧）。 */
function rowTrigger(title: string) {
  return document.querySelector<HTMLElement>(
    `aside button[aria-label="会话操作：${title}"]`
  )
}

function loadMoreButton() {
  return [...document.querySelectorAll<HTMLElement>('aside button')].find((button) =>
    button.textContent?.includes('加载更早')
  )
}

/** 等左栏宽度收敛到 cookie 里设定的最小值。 */
async function waitForNarrowPane() {
  await vi.waitFor(
    () => {
      const width = aside().getBoundingClientRect().width
      expect(width).toBeGreaterThan(150)
      expect(width).toBeLessThan(240)
    },
    { timeout: 5000 }
  )
}

describe('左栏收窄：行内操作与「加载更早的会话」不能被裁切', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 左栏拖到最小宽度（PANE_SPEC.min = 200）：宽度从 cookie 读取
    document.cookie = `ai_chat_pane_widths=${NARROW_WIDTH}; path=/`
    // 21 条 → 触发「加载更早的会话」
    mocks.rows = [
      conversation(1, LONG_TITLE),
      ...Array.from({ length: 20 }, (_, index) =>
        conversation(index + 2, `历史会话 ${index + 2}`)
      ),
    ]
    mocks.get.mockImplementation(mockApi)
    void page.viewport(1280, 900)
  })

  it('左栏真的收窄到最小宽度，且「⋯」按钮完整落在栏内', async () => {
    await renderWorkbench()
    await waitForNarrowPane()

    await vi.waitFor(
      () => {
        const trigger = rowTrigger(LONG_TITLE)
        expect(trigger).not.toBeNull()
        expect(trigger!.getBoundingClientRect().right).toBeLessThanOrEqual(
          aside().getBoundingClientRect().right + 0.5
        )
      },
      { timeout: 5000 }
    )
  })

  it('滚动区域没有横向溢出（内容宽度跟随容器，而不是被撑成固定值）', async () => {
    await renderWorkbench()
    await waitForNarrowPane()

    // 修复前 ScrollArea 的 table 包装会把整层撑成固定 407px（行的宽度因此远超左栏）；
    // 改用原生滚动容器后，行宽跟随容器
    await vi.waitFor(
      () => {
        const row = rowTrigger(LONG_TITLE)?.closest('li')
        expect(row).not.toBeNull()
        expect(row!.getBoundingClientRect().width).toBeLessThanOrEqual(
          aside().getBoundingClientRect().width + 0.5
        )
      },
      { timeout: 5000 }
    )
  })

  it('「加载更早的会话」按钮不超出左栏，文字不被截断', async () => {
    await renderWorkbench()
    await waitForNarrowPane()

    await vi.waitFor(
      () => {
        const loadMore = loadMoreButton()
        expect(loadMore).toBeTruthy()
        expect(loadMore!.getBoundingClientRect().right).toBeLessThanOrEqual(
          aside().getBoundingClientRect().right + 0.5
        )
        expect(loadMore!.scrollWidth).toBeLessThanOrEqual(loadMore!.clientWidth + 1)
      },
      { timeout: 5000 }
    )
  })
})

/**
 * 回答卡片的「查看依据」——依据现在**只有这一个展示载体**（2026-09-15 取消右栏，
 * 依据从右栏「本次回答的依据」移入卡片内按需展开）。
 *
 * 三条硬约束都钉在这里：
 * 1. **默认收起**：未点按钮时引用文档与工具调用都不可见（用户要求"点开按钮内容才可见"，
 *    不能一进页面就铺一屏依据）；
 * 2. **没有依据就不给按钮**：既无引用文档又无工具调用时按钮不出现 ——
 *    能点开一个空面板比没有入口更糟；
 * 3. **点开后有内容**：引用文档与「工具调用与参数」两块都在卡片内给出。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { AnswerCard } from './components/answer-card'
import type { AiMessage } from './types'

vi.mock('@/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  rawRequest: vi.fn(),
}))

const MESSAGE: AiMessage = {
  id: 1,
  role: 'assistant',
  content: '断货后先看可用库存与在途，再走补货流程。',
  status: 'ok',
  provider: 'demo',
  model: null,
  tokensIn: 120,
  tokensOut: 60,
  latencyMs: 800,
  citations: [
    {
      kind: 'document',
      title: '补货 SOP',
      sourceType: 'feishu',
      updatedAt: '2026-09-01T00:00:00.000Z',
      documentId: 7,
      docVersion: 2,
      snippet: '第一步：核对可用库存与在途数量。',
    },
  ],
  blocks: [],
  createdAt: '2026-09-15T00:00:00.000Z',
  runs: [
    {
      id: 11,
      toolName: 'search_knowledge',
      params: { query: '断货补货流程' },
      summary: '命中 1 篇文档',
      rowCount: 1,
      status: 'ok',
      error: null,
      latencyMs: 120,
      createdAt: '2026-09-15T00:00:00.000Z',
    },
  ],
}

async function renderCard(message: AiMessage) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  await render(
    <QueryClientProvider client={queryClient}>
      <AnswerCard message={message} />
    </QueryClientProvider>
  )
}

const evidenceButton = () => page.getByRole('button', { name: '查看依据' })

describe('回答卡片内的「查看依据」', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    void page.viewport(1280, 900)
  })

  it('默认收起：未点按钮时依据内容不可见', async () => {
    await renderCard(MESSAGE)

    await expect.element(evidenceButton()).toBeVisible()
    expect(page.getByText('引用文档').query()).toBeNull()
    expect(page.getByText('工具调用与参数').query()).toBeNull()
    // 声明条是固定展示的，不受依据开合影响
    await expect.element(page.getByText(/数据来源：/)).toBeVisible()
  })

  it('点开按钮后卡片内出现引用文档与工具调用与参数', async () => {
    await renderCard(MESSAGE)
    await userEvent.click(evidenceButton())

    await expect.element(page.getByText('引用文档')).toBeVisible()
    await expect.element(page.getByText('补货 SOP')).toBeVisible()
    await expect.element(page.getByText('工具调用与参数')).toBeVisible()
    // 工具名在卡片顶部进展区也出现过（`✓ 已search_knowledge`），精确匹配才能唯一命中参数区的 code 元素
    await expect
      .element(page.getByText('search_knowledge', { exact: true }))
      .toBeVisible()
  })

  it('再点一次收起，回到只有按钮的状态', async () => {
    await renderCard(MESSAGE)
    await userEvent.click(evidenceButton())
    await expect.element(page.getByText('引用文档')).toBeVisible()

    await userEvent.click(evidenceButton())
    expect(page.getByText('引用文档').query()).toBeNull()
  })

  it('既无引用文档也无工具调用时不给按钮', async () => {
    await renderCard({ ...MESSAGE, citations: [], runs: [] })

    expect(evidenceButton().query()).toBeNull()
    await expect.element(page.getByText(/数据来源：/)).toBeVisible()
  })
})

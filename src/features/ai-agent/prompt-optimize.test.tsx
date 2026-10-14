/**
 * 「优化提示词」的集成测试：**采用前不覆盖用户内容**。
 *
 * 这是本功能唯一会造成真实损失的地方：AI 改写有不确定性，用户刚写完的草稿
 * 如果被"优化结果"直接顶掉，是一句话解释不清的事故。因此用最小宿主渲染真实的
 * 编辑弹窗，断言四条：
 * 1. 点「优化提示词」后展示原文/优化后对比，**输入框内容不变**；
 * 2. 点「采用优化结果」才替换正文，并可「撤销采用」回到原文；
 * 3. 草稿太短时按钮禁用（不发起请求，不白烧一次模型调用）；
 * 4. 演示模式（未接入云模型）下按钮禁用 —— 否则用户点了才发现"这功能是坏的"。
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { PromptEditorDialog } from './components/prompt-dialogs'
import type { PromptOptimizeResult } from './types'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('@/api/client', () => ({
  api: {
    get: mocks.get,
    post: mocks.post,
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  rawRequest: vi.fn(),
}))

const DRAFT = '帮我看下 ACoS 为什么涨'
const OPTIMIZED_BODY =
  '任务：分析 ACoS 上涨原因\n输出要求：结论 + 依据，不要编造数据'

const OPTIMIZED: PromptOptimizeResult = {
  body: OPTIMIZED_BODY,
  truncated: false,
  model: 'deepseek-chat',
  demo: false,
}

/** 演示模式开关：每个用例单独决定（`useAiTools` 的 provider.demo）。 */
let demoMode = false

function mockGet(url: string) {
  if (String(url).startsWith('/ai/tools')) {
    return Promise.resolve({
      data: {
        tools: [],
        provider: {
          name: 'openai-compatible',
          mode: demoMode ? 'demo' : 'live',
          model: 'deepseek-chat',
          demo: demoMode,
        },
      },
    })
  }
  return Promise.resolve({ data: {} })
}

async function renderEditor() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  await render(
    <QueryClientProvider client={queryClient}>
      <PromptEditorDialog open onOpenChange={() => {}} />
    </QueryClientProvider>
  )
}

const bodyBox = () => page.getByRole('textbox', { name: '提示词正文' })
const bodyValue = () => (bodyBox().element() as HTMLTextAreaElement).value
const optimizeButton = () => page.getByRole('button', { name: '优化提示词' })

describe('提示词广场：AI 优化提示词', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    demoMode = false
    mocks.get.mockImplementation(mockGet)
    mocks.post.mockResolvedValue({ data: OPTIMIZED })
    void page.viewport(1280, 900)
  })

  it('表单只保留「名称」：已下线的「标题」字段不再出现', async () => {
    await renderEditor()
    await expect
      .element(page.getByRole('textbox', { name: '名称' }))
      .toBeVisible()
    // 名称与标题原本是上下两个输入框、说的是同一件事，2026-09-15 按用户要求下线标题
    await expect
      .element(page.getByText('标题', { exact: true }))
      .not.toBeInTheDocument()
  })

  it('点优化后展示原文/优化后对比，且不改动输入框内容', async () => {
    await renderEditor()
    await userEvent.fill(bodyBox(), DRAFT)
    await userEvent.click(optimizeButton())

    await expect.element(page.getByText('优化结果（尚未采用）')).toBeVisible()
    await expect.element(page.getByText('原文')).toBeVisible()
    await expect.element(page.getByText(OPTIMIZED_BODY)).toBeVisible()

    // 核心断言：AI 结果只做展示，草稿还在
    expect(bodyValue()).toBe(DRAFT)
    expect(mocks.post).toHaveBeenCalledWith('/ai/prompts/optimize', {
      body: DRAFT,
      name: '',
    })
  })

  it('点「采用优化结果」才替换正文，撤销后回到原文', async () => {
    await renderEditor()
    await userEvent.fill(bodyBox(), DRAFT)
    await userEvent.click(optimizeButton())
    await expect.element(page.getByText('优化结果（尚未采用）')).toBeVisible()

    await userEvent.click(page.getByRole('button', { name: '采用优化结果' }))
    await expect.poll(() => bodyValue()).toBe(OPTIMIZED_BODY)
    await expect.element(page.getByText('优化结果（已采用）')).toBeVisible()

    await userEvent.click(page.getByRole('button', { name: '撤销采用' }))
    await expect.poll(() => bodyValue()).toBe(DRAFT)
  })

  it('草稿太短时按钮禁用，不发起优化请求', async () => {
    await renderEditor()
    await userEvent.fill(bodyBox(), '看看')

    await expect.element(optimizeButton()).toBeDisabled()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('演示模式下按钮禁用（未接入云模型时不假装能优化）', async () => {
    demoMode = true
    await renderEditor()
    await userEvent.fill(bodyBox(), DRAFT)

    await expect.element(optimizeButton()).toBeDisabled()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('优化失败时给出提示且不动输入框内容', async () => {
    mocks.post.mockRejectedValueOnce(new Error('boom'))
    await renderEditor()
    await userEvent.fill(bodyBox(), DRAFT)
    await userEvent.click(optimizeButton())

    await expect.poll(() => mocks.post.mock.calls.length).toBe(1)
    expect(bodyValue()).toBe(DRAFT)
    await expect
      .element(page.getByText('优化结果（尚未采用）'))
      .not.toBeInTheDocument()
  })
})

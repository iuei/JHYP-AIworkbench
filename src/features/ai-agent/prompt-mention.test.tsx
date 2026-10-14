/**
 * `@提示词` 与输入框的集成测试：**按键归属**。
 *
 * 输入框的 `Enter` 本来是"发送"，面板里的 `Enter` 是"确认选中"。两者抢同一个键，
 * 判错方向就是真实事故：用户敲 `@ACoS` 想挑一条提示词，结果把半截的 `@ACoS` 当提问发了出去。
 * 因此这里用一个最小宿主复刻聊天页输入区的接线方式（同一 hook + 同一面板），
 * 断言三种情形：
 * 1. 有候选时 `Enter` 只能选中，不能发送；
 * 2. `Esc` 关掉面板后 `Enter` 恢复发送；
 * 3. **没有候选时 `Enter` 照常发送**（吃掉回车会让人以为"回车坏了"）。
 */
import { useRef, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { Textarea } from '@/components/ui/textarea'
import { PromptMentionPanel } from './components/prompt-mention-panel'
import { usePromptMention } from './prompt-mention'
import type { AiPrompt } from './types'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/api/client', () => ({
  api: {
    get: mocks.get,
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  rawRequest: vi.fn(),
}))

const SHARED_PROMPT: AiPrompt = {
  id: 1,
  name: 'ACoS 归因',
  body: '分析 ACoS 上涨的主因并给出可执行的排查建议',
  summary: '广告效率排查',
  tags: ['广告'],
  status: 'published',
  usageCount: 3,
  isOwner: false,
  reviewComment: null,
  reviewedAt: null,
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt: '2026-09-15T00:00:00.000Z',
}

const MINE_PROMPT: AiPrompt = {
  ...SHARED_PROMPT,
  id: 2,
  name: '库存检查',
  body: '看看这个 SKU 的可用库存、在途与占用',
  status: 'private',
  isOwner: true,
}

/** 按关键字返回不同结果：用 `zzz` 模拟"没有任何匹配"。 */
function mockApi(url: string) {
  const text = String(url)
  if (text.startsWith('/ai/prompts')) {
    const keyword = new URLSearchParams(text.split('?')[1] ?? '').get('keyword')
    const all = [SHARED_PROMPT, MINE_PROMPT]
    const prompts = keyword
      ? all.filter((prompt) => prompt.name.includes(keyword))
      : all
    return Promise.resolve({ data: { prompts } })
  }
  return Promise.resolve({ data: {} })
}

/** 最小宿主：与 chat-workbench 输入区同一套接线（hook + 面板 + 发送分支）。 */
function MentionHost({ onSend }: { onSend: (text: string) => void }) {
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const mention = usePromptMention({
    value: draft,
    onChange: setDraft,
    textareaRef,
  })

  return (
    <div className='relative w-96'>
      <Textarea
        aria-label='提问内容'
        ref={textareaRef}
        rows={1}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          mention.syncCaret()
        }}
        onClick={() => mention.syncCaret()}
        onKeyUp={() => mention.syncCaret()}
        onKeyDown={(event) => {
          if (mention.handleKeyDown(event)) return
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            onSend(draft)
          }
        }}
      />
      {mention.open && (
        <PromptMentionPanel
          activeIndex={mention.activeIndex}
          error={mention.error}
          groups={mention.groups}
          keyword={mention.keyword}
          loading={mention.loading}
          truncated={mention.truncated}
          onHover={mention.setActiveIndex}
          onSelect={mention.selectItem}
        />
      )}
    </div>
  )
}

async function renderHost() {
  const onSend = vi.fn()
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  await render(
    <QueryClientProvider client={queryClient}>
      <MentionHost onSend={onSend} />
    </QueryClientProvider>
  )
  return { onSend }
}

function textareaValue(): string {
  const element = page.getByRole('textbox', { name: '提问内容' }).element()
  return (element as HTMLTextAreaElement).value
}

describe('对话内 @提示词', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.get.mockImplementation(mockApi)
    void page.viewport(1280, 900)
  })

  it('键入 @ 后弹出面板，并分组展示共享与自己的提示词', async () => {
    await renderHost()
    await userEvent.fill(page.getByRole('textbox', { name: '提问内容' }), '@')

    await expect
      .element(page.getByRole('listbox', { name: '提示词选择' }))
      .toBeVisible()
    await expect.element(page.getByText('共享提示词')).toBeVisible()
    await expect.element(page.getByText('我的提示词')).toBeVisible()
    await expect.element(page.getByText('ACoS 归因')).toBeVisible()
  })

  it('面板打开时 Enter 用于插入提示词正文，不会发送提问', async () => {
    const { onSend } = await renderHost()
    await userEvent.fill(page.getByRole('textbox', { name: '提问内容' }), '@')

    await expect
      .element(page.getByRole('listbox', { name: '提示词选择' }))
      .toBeVisible()
    await userEvent.keyboard('{Enter}')

    // 这是本用例的核心：Enter 被面板消费，不能触发发送
    expect(onSend).not.toHaveBeenCalled()
    await expect.poll(() => textareaValue()).toBe(SHARED_PROMPT.body)
  })

  it('Esc 关闭面板后 Enter 恢复发送', async () => {
    const { onSend } = await renderHost()
    await userEvent.fill(page.getByRole('textbox', { name: '提问内容' }), '@')

    await expect
      .element(page.getByRole('listbox', { name: '提示词选择' }))
      .toBeVisible()
    await userEvent.keyboard('{Escape}')
    expect(page.getByRole('listbox', { name: '提示词选择' }).query()).toBeNull()

    await userEvent.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledWith('@')
  })

  it('没有匹配项时不吞回车：Enter 照常发送用户输入', async () => {
    const { onSend } = await renderHost()
    await userEvent.fill(
      page.getByRole('textbox', { name: '提问内容' }),
      '@zzz'
    )

    await expect
      .element(page.getByText('没有匹配的提示词，可直接继续输入你的问题。'))
      .toBeVisible()
    await userEvent.keyboard('{Enter}')

    expect(onSend).toHaveBeenCalledWith('@zzz')
  })

  it('关键字过滤发给服务端（前端不自行过滤列表）', async () => {
    await renderHost()
    await userEvent.fill(
      page.getByRole('textbox', { name: '提问内容' }),
      '@库存'
    )

    await expect.element(page.getByText('库存检查')).toBeVisible()
    const urls = () => mocks.get.mock.calls.map(([url]) => String(url))
    expect(urls().some((url) => url.includes('scope=usable'))).toBe(true)
    // 防抖后仍会把关键字带上，而不是本地过滤
    await expect
      .poll(() => urls().some((url) => url.includes('keyword=')))
      .toBe(true)
  })
})

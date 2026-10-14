/**
 * 「一级类目 → 它自己的页内子页」的默认页契约（2026-10-14）。
 *
 * 两个导航组件（`PromptSquareNav` / `KnowledgeNav`）各自要回答同三个问题，且必须一致：
 * 1. 不带参数时落在哪个子页（默认页）；
 * 2. 哪一枚选项卡高亮（`aria-current='page'`）；
 * 3. 默认页的链接带不带参数（默认页 URL 必须干净，非默认页必须带 `?view=mine`）。
 *
 * 这条契约 2026-10-14 刚被用户口径翻转（默认由「我的提示词 / 个人知识库」改为
 * 「共享提示词 / 团队知识库」），而它同时决定"点击侧边栏入口看到什么"——
 * 用 mock 的 `Link` / `useSearch` 把这三件事钉在这里，真实路由跳转仍由
 * `server/verify-nav-ia.mjs` 与 `server/ai-agent/verify-prompt-optimize-ui.mjs` 验。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { KnowledgeNav } from './knowledge-nav'
import { PromptSquareNav } from './prompt-square-nav'

/** 当前 search（`view` 缺省 = 默认页）；每个用例前重设。 */
const state = vi.hoisted(() => ({ view: undefined as string | undefined }))

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => (state.view ? { view: state.view } : {}),
  Link: ({
    children,
    to,
    search,
    activeOptions,
    ...props
  }: React.PropsWithChildren<{
    to: string
    search?: { view?: string }
    activeOptions?: { exact?: boolean }
  }>) => (
    <a
      // 真实 Router 会用 exact 决定 active：不传 exact 时 `search={{}}` 会被判成
      // `{ view: 'mine' }` 的部分匹配，两枚选项卡同时带 aria-current='page'（实测过）
      data-exact={String(activeOptions?.exact ?? false)}
      href={search?.view ? `${to}?view=${search.view}` : to}
      {...props}
    >
      {children}
    </a>
  ),
}))

/** 读取某个选项卡的 `aria-current`、href 与 exact active 判定。 */
function tab(label: string) {
  const element = page.getByRole('link', { name: label }).element()
  return {
    current: element.getAttribute('aria-current'),
    href: element.getAttribute('href'),
    exact: element.getAttribute('data-exact'),
  }
}

describe('提示词广场：默认子页 = 共享提示词', () => {
  beforeEach(() => {
    state.view = undefined
  })

  it('无参数进页面：共享提示词高亮，且链接不带参数', async () => {
    await render(<PromptSquareNav />)

    expect(tab('共享提示词').current).toBe('page')
    expect(tab('共享提示词').href).toBe('/prompts')

    // 非默认页必须带参数，否则点过去与默认页无法区分
    expect(tab('我的提示词').current).toBeNull()
    expect(tab('我的提示词').href).toBe('/prompts?view=mine')
  })

  it('默认页排在第一位（高亮不该落在第二枚按钮上）', async () => {
    await render(<PromptSquareNav />)

    const labels = page
      .getByRole('link')
      .elements()
      .map((element) => element.textContent?.trim())
    expect(labels).toEqual(['共享提示词', '我的提示词'])
  })

  it('两枚选项卡都要求 exact active 判定（否则会同时 aria-current）', async () => {
    await render(<PromptSquareNav />)

    // 真实 Router 实测过：不带 exact 时无参数的 `search={{}}` 会被判成 `?view=mine`
    // 的部分匹配，两枚选项卡同时 `aria-current='page'`，读屏读出两个"当前页"
    expect(tab('共享提示词').exact).toBe('true')
    expect(tab('我的提示词').exact).toBe('true')
  })

  it('?view=mine 时切换高亮与内容口径', async () => {
    state.view = 'mine'
    await render(<PromptSquareNav />)

    expect(tab('我的提示词').current).toBe('page')
    expect(tab('我的提示词').href).toBe('/prompts?view=mine')
    expect(tab('共享提示词').current).toBeNull()
  })
})

describe('知识库：默认子页 = 团队知识库', () => {
  beforeEach(() => {
    state.view = undefined
  })

  it('无参数进页面：团队知识库高亮，且链接不带参数', async () => {
    await render(<KnowledgeNav />)

    expect(tab('团队知识库').current).toBe('page')
    expect(tab('团队知识库').href).toBe('/knowledge')

    expect(tab('个人知识库').current).toBeNull()
    expect(tab('个人知识库').href).toBe('/knowledge?view=mine')
    // 与提示词广场同一防御：两枚 `to` 相同，必须 exact 才不会同时 aria-current
    expect(tab('团队知识库').exact).toBe('true')
    expect(tab('个人知识库').exact).toBe('true')
  })

  it('默认页排在第一位', async () => {
    await render(<KnowledgeNav />)

    const labels = page
      .getByRole('link')
      .elements()
      .map((element) => element.textContent?.trim())
    expect(labels).toEqual(['团队知识库', '个人知识库'])
  })

  it('?view=mine 时落到个人知识库', async () => {
    state.view = 'mine'
    await render(<KnowledgeNav />)

    expect(tab('个人知识库').current).toBe('page')
    expect(tab('团队知识库').current).toBeNull()
    expect(tab('团队知识库').href).toBe('/knowledge')
  })
})

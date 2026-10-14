import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * 旧入口兼容（2026-09-16 阶段 C）：提示词广场早已是侧边栏**一级类目**，路径却仍是
 * `/ai-agent/prompts`（二级路径），与本项目的"URL 层级 = 导航层级"口径冲突。
 * 现在规范化到 `/prompts`，旧链接沿用既有的 `beforeLoad` + `redirect` 模式继续可用。
 *
 * `view` 按其**新**口径透传（2026-10-14 默认页改为「共享提示词」）：只有分享出去的
 * "我的提示词"链接（`?view=mine`）需要带参数，`?view=shared` 与其它值一并落到默认页。
 */
export const Route = createFileRoute('/_authenticated/ai-agent/prompts')({
  beforeLoad: ({ location }) => {
    const { view } = location.search as { view?: unknown }
    throw redirect({
      to: '/prompts',
      search: view === 'mine' ? { view: 'mine' } : {},
    })
  },
})

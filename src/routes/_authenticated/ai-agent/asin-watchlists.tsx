import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * 旧入口兼容（2026-09-16 阶段 C）：「我的 ASIN」由「AI 助手」的二级子页升为一级类目，
 * 路径从 `/ai-agent/asin-watchlists` 迁到 `/asin-watchlists`。
 *
 * 老书签、聊天里粘过的链接、以及此前写死这个路径的验收脚本都还有效 —— 沿用项目既有的
 * `beforeLoad` + `redirect` 模式（同 `/ai-agent/knowledge` → `/knowledge?view=team`）。
 *
 * 2026-09-18：`?list=`（清单 id）随清单这一层一起消失，不再透传。
 */
export const Route = createFileRoute(
  '/_authenticated/ai-agent/asin-watchlists'
)({
  beforeLoad: () => {
    throw redirect({ to: '/asin-watchlists' })
  },
})

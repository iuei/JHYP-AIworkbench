import { createFileRoute } from '@tanstack/react-router'
import { PromptsLayout } from '@/features/ai-agent/pages/prompts-layout'

/**
 * 「提示词广场」模块路由（2026-09-16 阶段 C）。
 *
 * 它已是侧边栏**一级类目**（2026-09-15 升格），路径却仍是 `/ai-agent/prompts` ——
 * 一级类目住在二级路径下，与"URL 层级 = 导航层级"的口径冲突，也让 `/ai-agent` 这个
 * 模块路径里混进一个不属于它的页面。现在迁到 `/prompts`。
 *
 * 旧链接 `/ai-agent/prompts` 由同级路由文件 `ai-agent/prompts.tsx` 重定向过来（保留 `view` 参数）。
 */
export const Route = createFileRoute('/_authenticated/prompts')({
  component: PromptsLayout,
})

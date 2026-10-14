import { createFileRoute } from '@tanstack/react-router'
import { KnowledgeLayout } from '@/features/ai-agent/pages/knowledge-layout'

/**
 * 「知识库」模块布局（2026-09-18）。
 *
 * **它是一个侧边栏一级类目**（挂在「AI 工作台」分区下），因此路径是一级的 `/knowledge`，
 * 而不是继续住在 `/ai-agent/*` 或 `/admin/ai/*` 里 —— 后两者分别是「AI 助手」的子路径
 * 与「系统管理 → AI 治理」的子路径，一级类目住进去又会出现"URL 层级 ≠ 导航层级"的旧问题
 * （提示词广场 2026-09-16 才刚从 `/ai-agent/prompts` 迁出来）。
 *
 * 知识库的治理动作（上传 / 下线 / 纠错反馈）2026-09-18 起也并入本模块的「团队知识库」
 * 子页（管理员看到管理视图），`/admin/ai/knowledge` 只剩一个指向这里的历史链接跳转。
 */
export const Route = createFileRoute('/_authenticated/knowledge')({
  component: KnowledgeLayout,
})

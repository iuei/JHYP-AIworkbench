import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * 旧入口兼容：知识库已迁到一级入口 `/knowledge`，老书签直接跳转过去。
 *
 * 落点是知识库的**默认子页 = 团队知识库**（2026-10-14 起默认页由「个人知识库」改为
 * 「团队知识库」），因此不再需要显式 `?view=team` —— 默认页 URL 保持干净。
 */
export const Route = createFileRoute('/_authenticated/ai-agent/knowledge')({
  beforeLoad: () => {
    throw redirect({ to: '/knowledge' })
  },
})

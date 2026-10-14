import { createFileRoute, redirect } from '@tanstack/react-router'

/** 旧入口兼容：知识库已迁到一级入口 `/knowledge`（团队知识库），老书签直接跳转过去。 */
export const Route = createFileRoute('/_authenticated/ai-agent/knowledge')({
  beforeLoad: () => {
    throw redirect({ to: '/knowledge', search: { view: 'team' } })
  },
})

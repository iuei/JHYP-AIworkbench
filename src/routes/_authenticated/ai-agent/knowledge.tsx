import { createFileRoute, redirect } from '@tanstack/react-router'

/** 旧入口兼容：知识库已迁到后台 /admin/ai/knowledge，老书签直接跳转过去。 */
export const Route = createFileRoute('/_authenticated/ai-agent/knowledge')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/ai/knowledge' })
  },
})

import { createFileRoute, redirect } from '@tanstack/react-router'

/** 旧入口兼容：经验审核已迁到后台 /admin/ai/distill，老书签直接跳转过去。 */
export const Route = createFileRoute('/_authenticated/ai-agent/distill')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/ai/distill' })
  },
})

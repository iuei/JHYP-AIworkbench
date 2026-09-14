import { createFileRoute, redirect } from '@tanstack/react-router'

/** 旧入口兼容：审计台已迁到后台 /admin/ai/audit，老书签直接跳转过去。 */
export const Route = createFileRoute('/_authenticated/ai-agent/audit')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/ai/audit' })
  },
})

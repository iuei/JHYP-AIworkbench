import { createFileRoute, redirect } from '@tanstack/react-router'

/** 旧入口兼容：数据源与导入已迁到后台 /admin/ai/datasources，老书签直接跳转过去。 */
export const Route = createFileRoute('/_authenticated/ai-agent/datasources')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/ai/datasources' })
  },
})

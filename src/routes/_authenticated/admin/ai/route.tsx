import { createFileRoute } from '@tanstack/react-router'
import { AiAdminLayout } from '@/features/ai-agent/pages/ai-admin-layout'

/** AI 治理子区域布局：五个治理页共享同一排内导航。 */
export const Route = createFileRoute('/_authenticated/admin/ai')({
  // 标题设在模块层：子页由 Header 里的治理导航高亮表达位置，避免标题与导航项重复。
  staticData: { title: 'AI 治理' },
  component: AiAdminLayout,
})

import { createFileRoute } from '@tanstack/react-router'
import { AiAdminOverview } from '@/features/ai-agent/pages/ai-admin-overview'

/** AI 治理概览（管理员，后台治理区域）：/admin/ai */
export const Route = createFileRoute('/_authenticated/admin/ai/')({
  component: AiAdminOverview,
})

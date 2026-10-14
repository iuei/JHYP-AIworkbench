import { createFileRoute } from '@tanstack/react-router'
import { DistillManagement } from '@/features/ai-agent/pages/distill-management'

/** 经验审核（管理员，后台治理区域）：/admin/ai/distill —— 标题口径同 `knowledge.tsx`。 */
export const Route = createFileRoute('/_authenticated/admin/ai/distill')({
  staticData: { title: '经验审核' },
  component: DistillManagement,
})

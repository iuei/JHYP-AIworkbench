import { createFileRoute } from '@tanstack/react-router'
import { AuditConsole } from '@/features/ai-agent/pages/audit-console'

/** 审计台（管理员，后台治理区域）：/admin/ai/audit —— 标题口径同 `knowledge.tsx`。 */
export const Route = createFileRoute('/_authenticated/admin/ai/audit')({
  staticData: { title: '审计台' },
  component: AuditConsole,
})

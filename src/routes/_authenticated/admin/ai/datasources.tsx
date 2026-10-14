import { createFileRoute } from '@tanstack/react-router'
import { DatasourceManagement } from '@/features/ai-agent/pages/datasource-management'

/** 数据源与导入（管理员，后台治理区域）：/admin/ai/datasources —— 标题口径同 `knowledge.tsx`。 */
export const Route = createFileRoute('/_authenticated/admin/ai/datasources')({
  staticData: { title: '数据源与导入' },
  component: DatasourceManagement,
})

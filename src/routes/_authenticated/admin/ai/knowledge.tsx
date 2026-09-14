import { createFileRoute } from '@tanstack/react-router'
import { KnowledgeManagement } from '@/features/ai-agent/pages/knowledge-management'

/** 知识库（管理员，后台治理区域）：/admin/ai/knowledge */
export const Route = createFileRoute('/_authenticated/admin/ai/knowledge')({
  component: KnowledgeManagement,
})

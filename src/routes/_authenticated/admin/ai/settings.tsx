import { createFileRoute } from '@tanstack/react-router'
import { AiSettings } from '@/features/ai-agent/pages/ai-settings'

/** 模型与配置（管理员，后台治理区域）：/admin/ai/settings */
export const Route = createFileRoute('/_authenticated/admin/ai/settings')({
  component: AiSettings,
})

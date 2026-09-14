import { createFileRoute } from '@tanstack/react-router'
import { AiAgentLayout } from '@/features/ai-agent/pages/layout'

export const Route = createFileRoute('/_authenticated/ai-agent')({
  staticData: { title: 'AI 助手' },
  component: AiAgentLayout,
})

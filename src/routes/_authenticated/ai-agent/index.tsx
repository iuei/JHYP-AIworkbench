import { createFileRoute } from '@tanstack/react-router'
import { ChatWorkbench } from '@/features/ai-agent/pages/chat-workbench'

export const Route = createFileRoute('/_authenticated/ai-agent/')({
  component: ChatWorkbench,
})

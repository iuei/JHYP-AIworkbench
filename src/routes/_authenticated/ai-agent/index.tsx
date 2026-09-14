import { createFileRoute } from '@tanstack/react-router'
import { ChatWorkbench } from '@/features/ai-agent/pages/chat-workbench'

export const Route = createFileRoute('/_authenticated/ai-agent/')({
  // 三栏工作台：左右固定栏吃掉 576px 后主区过窄，这里铺满可用宽度（标题仍继承模块级的「AI 助手」）
  staticData: { wide: true },
  component: ChatWorkbench,
})

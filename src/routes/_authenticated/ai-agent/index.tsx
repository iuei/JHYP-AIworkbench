import { createFileRoute } from '@tanstack/react-router'
import { ChatWorkbench } from '@/features/ai-agent/pages/chat-workbench'
import { parseAiAgentSearch } from '@/features/ai-agent/search-params'

export const Route = createFileRoute('/_authenticated/ai-agent/')({
  // 三栏工作台：左右固定栏吃掉 576px 后主区过窄，这里铺满可用宽度（标题仍继承模块级的「AI 助手」）
  staticData: { wide: true },
  // 首页深链的两个可选参数（/ai-agent?conversationId=&focus=composer）。
  // 只作用于本路由，不影响 notes / asin-watchlists 等子路由；脏值由解析器忽略。
  validateSearch: parseAiAgentSearch,
  component: ChatWorkbench,
})

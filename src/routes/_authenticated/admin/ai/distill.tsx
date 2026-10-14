import { createFileRoute } from '@tanstack/react-router'
import { DistillManagement } from '@/features/ai-agent/pages/distill-management'

/**
 * 经验审核（管理员，后台治理区域）：/admin/ai/distill —— 标题口径同 `knowledge.tsx`。
 *
 * **子视图用 search 参数 `queue` 表达**（2026-10-14）：顶栏「待办」按钮点"沉淀待审核"
 * 时要直达「沉淀条目」子视图，而子视图原先只是组件内的 `useState` —— 跳转过去会停在
 * 默认的「提示词审核」，用户还得自己再切一次。
 *
 * 与「知识库 / 提示词广场」同一口径：**参数表达的是非默认页**，默认页
 * （提示词审核）URL 保持干净；乱值一律回落到默认页。
 */
export type DistillSearch = { queue?: 'notes' | 'skill' }

export const Route = createFileRoute('/_authenticated/admin/ai/distill')({
  staticData: { title: '经验审核' },
  validateSearch: (search: Record<string, unknown>): DistillSearch => {
    if (search.queue === 'notes') return { queue: 'notes' }
    if (search.queue === 'skill') return { queue: 'skill' }
    return {}
  },
  component: DistillManagement,
})

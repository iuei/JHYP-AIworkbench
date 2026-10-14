import { Badge } from '@/components/ui/badge'
import { FINDING_LEVEL_LABELS, FINDING_LEVEL_VARIANTS } from '../format'
import type { HistoryItem } from '../types'

/**
 * 历史记录列表里的「判定」徽章（2026-09-17 第二次修正）。
 *
 * **口径**：用 `openLevel` —— **扣掉已销账 / 已核验 / 已忽略之后**，仍未处理问题里的最高级别；
 * 不是快照的 `level`。
 *
 * 为什么改（用户实测反馈）：「在分析结果页标记为已处理后历史分析为什么还是展示需立即处理」。
 * 上一版这里显示快照判定，理由是"历史事实不该被后来的销账改写" —— 这个理由**只对了一半**：
 * 快照判定确实是事实，但列表要回答的是"**这条记录现在还要不要我处理**"。用户销账后回到列表
 * 仍看到红字「需立即处理」，唯一合理的解读就是"标记没生效"。
 * 原始判定仍然可以在快照与详情页里查到，因此**不是篡改历史**，只是换了这一列要回答的问题。
 *
 * 有销账时补一句「已销账 N 条」：让用户看到自己的操作**生效了**，而不是以为记录被改写。
 * `N` 由服务端算（`clearedFindingCount`，只数 actionable）—— 前端**不要**拿
 * `findingCount - openFindingCount` 自己减：`findingCount` 含 `info` 级，一条都没销账也会减出正数。
 *
 * 这个徽章被两处复用（竞品分析的「历史分析」表、首页的「最近分析」表）——
 * 它们问的是同一个问题，口径必须一份。
 */
export function HistoryLevelBadge({ item }: { item: HistoryItem }) {
  const level = item.openLevel ?? item.level
  if (!level) return <Badge variant='outline'>历史记录</Badge>
  const cleared = item.clearedFindingCount ?? 0
  return (
    <span className='flex flex-wrap items-center gap-1.5'>
      <Badge variant={FINDING_LEVEL_VARIANTS[level]}>
        {FINDING_LEVEL_LABELS[level]}
      </Badge>
      {cleared > 0 && (
        <span
          className='text-xs whitespace-nowrap text-muted-foreground'
          data-history-cleared={cleared}
        >
          已销账 {cleared} 条
        </span>
      )}
    </span>
  )
}

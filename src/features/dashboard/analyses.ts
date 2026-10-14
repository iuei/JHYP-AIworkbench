import type { FindingLevel, HistoryItem } from '@/features/competitor-analysis/types'

/** 首页一次拉取的分析条数：既要支撑「最近分析」展示，也要作为「需处理」的扫描范围。 */
export const ATTENTION_SCAN_LIMIT = 20
/** 「需处理的分析」最多展示条数。 */
export const ATTENTION_DISPLAY_LIMIT = 3
/** 「最近分析」最多展示条数。 */
export const RECENT_DISPLAY_LIMIT = 5

/**
 * 首页报警用的级别：**未销账**的最高级别。
 *
 * 为什么不用 `level`：`level` 是**那一次分析的快照判定**（历史事实，回看时要保持原样，
 * 不能被后来的销账改写）；`openLevel` 扣掉了已销账（待核验）、已核验解决、已忽略的结论，
 * 回答的是"**现在还需要我处理什么**"。
 *
 * 两者都要有：用户处理完回系统标记后，首页必须停止报警（否则闭环没闭上）；
 * 而历史回看仍要如实展示当时的判定。老记录（服务端还没有 `finding_keys`）缺 `openLevel`，
 * 回退到 `level` —— 与改前行为完全一致。
 */
export function attentionLevelOf(item: HistoryItem): FindingLevel | null {
  return item.openLevel ?? item.level
}

/** 未销账的问题条数（老记录回退到快照结论总数）。 */
export function attentionCountOf(item: HistoryItem): number {
  return item.openFindingCount ?? item.findingCount
}

/**
 * 需要立即处理的记录（未销账问题里最高级别为 `high`）。
 *
 * 只说"这批记录里没有"，不讲"全库没有"：调用方必须在卡片上写明扫描范围（`ATTENTION_SCAN_LIMIT`），
 * 否则用户会把「最近 20 次里没有」读成「全部历史都没有」。
 */
export function pickAttentionAnalyses(items: HistoryItem[]): HistoryItem[] {
  return items
    .filter((item) => attentionLevelOf(item) === 'high')
    .slice(0, ATTENTION_DISPLAY_LIMIT)
}

/** 最近分析：服务端已按时间倒序，这里只截断。 */
export function takeRecentAnalyses(items: HistoryItem[]): HistoryItem[] {
  return items.slice(0, RECENT_DISPLAY_LIMIT)
}

/**
 * 相对时间（本地时区）。
 *
 * 刻意不用 `toISOString().slice(0, 10)`：那是 UTC 日期，东八区凌晨会整体早一天
 * （`src/features/ai-agent/format.ts` 的 `formatDate` 就是这个问题，属该模块的独立改动）。
 */
export function formatRelativeTime(
  value: string | null | undefined,
  now: Date = new Date()
): string {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知'

  const diff = now.getTime() - date.getTime()
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  // 未来时间（服务端与客户端时钟不同步时可能发生）不显示负数，直接给日期
  if (diff < 0) return formatLocalDate(date)
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  return formatLocalDate(date)
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

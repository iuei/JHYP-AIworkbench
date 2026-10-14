import { BarChart3, Bot, NotebookPen } from 'lucide-react'
import type { DashboardShortcut, DashboardShortcutId } from './types'

/**
 * 首页常用入口。只放有真实路由、有真实数据的入口，
 * 不再出现「即将上线」这类会误导用户的占位卡片。
 *
 * 顺序即默认顺序，也是 `normalizeShortcutIds` 补齐缺失入口时使用的顺序。
 */
export const dashboardShortcuts: DashboardShortcut[] = [
  {
    id: 'ai-chat',
    title: 'AI 助手',
    description: '进入 AI 对话工作台',
    icon: Bot,
    to: '/ai-agent',
  },
  {
    id: 'competitor',
    title: '竞品分析',
    description: '进行 ASIN、品牌或店铺分析',
    icon: BarChart3,
    to: '/competitor-analysis',
  },
  {
    /*
     * `my-notes` 这个 id **刻意不改**：它是用户拖拽顺序的持久化键，
     * 改名会让已保存的顺序被重置（`normalizeShortcutIds` 只认识当前有效 id）。
     * 2026-09-18 起它的落脚点是「知识库 → 个人知识库」（`/knowledge`），
     * 标题随之与侧边栏入口逐字一致 —— 同一件东西在侧边栏、顶栏、首页叫同一个名字。
     */
    id: 'my-notes',
    title: '个人知识库',
    description: '查看个人知识沉淀',
    icon: NotebookPen,
    to: '/knowledge',
  },
]

export const defaultShortcutIds: DashboardShortcutId[] = dashboardShortcuts.map(
  (item) => item.id
)

const knownShortcutIds = new Set<string>(defaultShortcutIds)

/**
 * 把服务端保存的入口顺序归一化成当前有效入口的稳定顺序。
 *
 * 需要归一化的原因：历史用户在数据库里可能已经保存了 `project/listing/reviews`
 * 这类已下线的占位 ID。若直接按保存值渲染，首页会只剩一个竞品分析入口，甚至出现空白卡片。
 *
 * 规则（顺序稳定、结果完整）：
 * 1. 丢弃不认识的和重复的 ID；
 * 2. 保留仍然有效的 ID 的原有相对顺序；
 * 3. 缺失的入口按默认顺序追加到末尾；
 * 4. 因此无论输入多脏，返回结果恒为当前全部有效入口。
 */
export function normalizeShortcutIds(savedIds: unknown): DashboardShortcutId[] {
  const seen = new Set<string>()
  const result: DashboardShortcutId[] = []

  if (Array.isArray(savedIds)) {
    for (const id of savedIds) {
      if (typeof id !== 'string' || !knownShortcutIds.has(id) || seen.has(id)) {
        continue
      }
      seen.add(id)
      result.push(id as DashboardShortcutId)
    }
  }

  for (const id of defaultShortcutIds) {
    if (!seen.has(id)) result.push(id)
  }

  return result
}

/** 把归一化后的 ID 顺序映射回入口定义，供渲染使用。 */
export function orderShortcuts(savedIds: unknown): DashboardShortcut[] {
  const byId = new Map(dashboardShortcuts.map((item) => [item.id, item]))
  return normalizeShortcutIds(savedIds).flatMap((id) => {
    const shortcut = byId.get(id)
    return shortcut ? [shortcut] : []
  })
}

/**
 * 把 `fromId` 移动到 `toId` 之前/之后的位置，返回新的 ID 顺序。
 *
 * 供拖拽与键盘「上移/下移」共用，保证两种排序方式走同一套位置计算。
 */
export function moveShortcut(
  ids: string[],
  fromId: string,
  toId: string,
  position: 'before' | 'after' = 'before'
): string[] {
  const from = ids.indexOf(fromId)
  const to = ids.indexOf(toId)
  if (from === -1 || to === -1 || from === to) return ids

  const next = [...ids]
  const [moved] = next.splice(from, 1)
  // 先移除再插入，插入位置要按移除后的下标重新校正。
  const target = next.indexOf(toId)
  next.splice(position === 'after' ? target + 1 : target, 0, moved)
  return next
}

/** 相邻位置上移/下移一步，越界时返回原顺序。 */
export function shiftShortcut(
  ids: string[],
  id: string,
  direction: 'up' | 'down'
): string[] {
  const index = ids.indexOf(id)
  if (index === -1) return ids

  const targetIndex = direction === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= ids.length) return ids

  const next = [...ids]
  next.splice(index, 1)
  next.splice(targetIndex, 0, id)
  return next
}

import type { LucideIcon } from 'lucide-react'

/**
 * 首页「常用入口」的 ID 契约。
 *
 * 第一期只保留有真实路由的四个入口。历史版本用过 `project` / `listing` / `reviews`
 * 三个占位 ID（无路由、无数据），它们的清理与兼容由 `normalizeShortcutIds` 负责。
 */
export type DashboardShortcutId =
  | 'ai-chat'
  | 'quick-navigation'
  | 'competitor'
  | 'my-notes'

export type DashboardShortcut = {
  id: DashboardShortcutId
  title: string
  description: string
  icon: LucideIcon
  /** 使用字面量联合而不是 string，保证传给 TanStack Router 的 Link 时仍受路由类型约束。 */
  to:
    | '/ai-agent'
    | '/quick-navigation'
    | '/competitor-analysis'
    | '/ai-agent/notes'
}

/** 最近竞品分析记录，来自 `GET /api/dashboard` 的 `analyses`。 */
export type DashboardAnalysis = {
  id: number
  input_type: string
  input_value: string
}

/**
 * `GET /api/dashboard` 的响应结构。
 *
 * 说明：服务端响应里还有一个 `workItems` 字段（`work_items` 表），首页**不再读取**它 ——
 * 该表只剩历史上由竞品分析写入的假进度（progress 固定 65、没有任何更新入口），
 * 首页的内容位已由「我的 AI」卡片（真实对话与沉淀数据）取代。
 * 服务端保留该字段是为了不破坏既有响应契约。
 */
export type DashboardData = {
  /** 服务端保存的入口顺序，可能是历史 ID，使用前必须过 `normalizeShortcutIds`。 */
  shortcutIds: string[]
  analyses: DashboardAnalysis[]
}

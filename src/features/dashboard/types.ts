import type { LucideIcon } from 'lucide-react'

/**
 * 首页「常用入口」的 ID 契约。
 *
 * 只保留有真实路由、有真实数据的入口。历史版本用过 `project` / `listing` / `reviews` 三个占位 ID，
 * 以及 `quick-navigation`（2026-09-15 随快捷导航模块一并删除）——
 * 它们无路由或页面已不存在，清理与兼容一律由 `normalizeShortcutIds` 负责。
 */
export type DashboardShortcutId = 'ai-chat' | 'competitor' | 'my-notes'

export type DashboardShortcut = {
  id: DashboardShortcutId
  title: string
  description: string
  icon: LucideIcon
  /** 使用字面量联合而不是 string，保证传给 TanStack Router 的 Link 时仍受路由类型约束。 */
  to: '/ai-agent' | '/competitor-analysis' | '/knowledge'
}

/**
 * `GET /api/dashboard` 的响应结构。
 *
 * 说明：服务端响应里还有 `workItems`（`work_items` 表）与 `analyses`（最近竞品分析）两个字段，
 * 首页**都不再读取** —— 前者只剩历史假进度，后者字段太弱（无时间、无结论分级、无问题数），
 * 已由 `fetchAnalysisHistory(20)` 的富字段摘要取代。服务端保留这两个字段只为不破坏既有响应契约。
 */
export type DashboardData = {
  /** 服务端保存的入口顺序，可能是历史 ID，使用前必须过 `normalizeShortcutIds`。 */
  shortcutIds: string[]
}

/**
 * 首页「常用入口」的默认顺序：用户还没有保存过偏好时使用。
 *
 * 必须与前端 `src/features/dashboard/shortcuts.ts` 的 `defaultShortcutIds` 保持一致 ——
 * 服务端只负责给出新用户的初始顺序，前端 `normalizeShortcutIds` 负责兼容历史偏好、去重并补齐缺失入口。
 *
 * 历史版本用过 `project` / `listing` / `reviews` 三个没有路由、没有数据的占位 ID，
 * 它们会让首页出现「即将上线」的假卡片，不要再加回来。
 *
 * 2026-09-15：`quick-navigation` 已随快捷导航模块删除一并移除；
 * 前台 `normalizeShortcutIds` 会把历史用户偏好里的旧 ID 丢弃并补齐缺失项。
 */
export const defaultDashboardShortcutIds = [
  'ai-chat',
  'competitor',
  'my-notes',
]

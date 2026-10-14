import { createFileRoute } from '@tanstack/react-router'
import { WatchlistPage } from '@/features/asin-watchlist/pages/watchlist-page'

/**
 * 「我的 ASIN」（模块唯一页面，2026-09-18 起）。
 *
 * `?list=` 与旧参数 `?view=items` 的解析都在父路由 `route.tsx` 里完成
 * （search 校验与重定向对整棵子树只写一次）。
 */
export const Route = createFileRoute('/_authenticated/asin-watchlists/')({
  component: WatchlistPage,
})

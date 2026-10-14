import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * 兼容旧链接：`/asin-watchlists/items`（2026-09-17 ~ 2026-09-18 期间的「商品明细」页）。
 *
 * 2026-09-18 起模块只剩一个页面（数据可切表格 / 卡片），旧路径不能变成 404 ——
 * 用户的书签、聊天里粘过的链接、以及既有验收脚本都指向它。
 *
 * 历史参数一并丢弃：`?list=`（清单已不存在）、`?view=`（不再有第二个视图）。
 * 这里不渲染任何内容（`beforeLoad` 必然抛出重定向），因此不定义 `component`。
 */
export const Route = createFileRoute('/_authenticated/asin-watchlists/items')({
  beforeLoad: () => {
    throw redirect({ to: '/asin-watchlists' })
  },
})

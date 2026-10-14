import { createFileRoute, Outlet } from '@tanstack/react-router'

/**
 * 「我的 ASIN」模块路由（2026-09-18：无清单、无 search 参数）。
 *
 * **一个页面**：`/asin-watchlists` 是带业务指标的数据表（可切表格 / 卡片）。
 *
 * 历史沿革（旧链接继续有效，见 `items.tsx` 与 `/_authenticated/ai-agent/asin-watchlists.tsx`）：
 * - `?view=items` / `?view=analysis`：两个视图曾用于在页面间切换，两页合一后没有含义，
 *   这里**就地忽略**（不做重定向：同路径换个 search 再跳一次只会让历史多一条无用记录）；
 * - `?list=`：当前清单 id。清单这一层已不存在，同样忽略。
 *
 * `component` 直接用 `Outlet`：本模块没有跨子路由的布局需要包，再写一个"只 return <Outlet />"
 * 的本地组件既没有收益，也会让 `react-refresh/only-export-components` 报警
 * （本文件导出的是 `Route` 而非组件）。
 */
export const Route = createFileRoute('/_authenticated/asin-watchlists')({
  staticData: { title: '我的 ASIN' },
  component: Outlet,
})

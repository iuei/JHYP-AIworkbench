import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { findNavChildren } from '@/components/layout/nav-children'
import { sidebarData } from '@/components/layout/data/sidebar-data'

/** 与侧边栏子项同一个 url：用它判断"这一项是不是结果页"，避免按文案匹配。 */
const RESULTS_PATH = '/competitor-analysis/results'

/**
 * 「竞品分析」的顶栏中段导航（分析 ｜ 分析结果）。
 *
 * **与侧边栏同源**：子项从 `sidebarData.navItems` 的「竞品分析」类目派生（`findNavChildren`），
 * 不在这里另写一份名称与路径 —— 同「AI 助手」「产品开发」顶栏导航的口径。
 *
 * **为什么需要它（2026-09-16）**：用户反馈「没有直接的子页面入口」。把分析结果拆成
 * 独立路由时只做了一个"结果卡上的按钮"，于是这个子页在导航里根本不存在：
 * 侧边栏进不去、命令菜单搜不到、两个页面之间也只能靠"回主页再点一次"。
 * 现在它是导航里的一个真实入口，且两个页面在顶栏一键互跳。
 *
 * 高亮口径：结果页精确匹配；**其余路径（含 `/competitor-analysis/<ASIN>` 竞品详情页）
 * 都算「分析」** —— 详情页是从卡片点进去的单品页，它属于"分析"这条线。
 */
export function CompetitorAnalysisNav() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const items = findNavChildren(sidebarData.navItems, '竞品分析')
  const onResults = pathname === RESULTS_PATH

  return (
    // 单行布局：本组件渲染在全局 Header 的中段槽位里，不能换行（槽位是固定高度）。
    <nav aria-label='竞品分析功能导航' className='flex items-center gap-1'>
      {items.map((item) => {
        const active = item.url === RESULTS_PATH ? onResults : !onResults
        const Icon = item.icon
        return (
          <Link
            aria-current={active ? 'page' : undefined}
            /*
             * TanStack 的 `Link` 会按**前缀**自己加 `aria-current`（`/competitor-analysis/details`
             * 也命中 `/competitor-analysis`），所以「当前是哪一个」不能用它来判断。
             * 高亮口径由本组件的 `active` 决定，并挂成显式属性供端到端脚本定位。
             */
            data-active={active ? 'true' : undefined}
            data-nav-item={item.url}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
            key={item.url}
            to={item.url}
          >
            {Icon && <Icon className='size-4' />}
            {item.title}
          </Link>
        )
      })}
    </nav>
  )
}

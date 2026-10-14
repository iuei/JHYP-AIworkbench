import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { adminAiNavItems } from '@/components/layout/data/sidebar-data'

/**
 * 「AI 治理」页内顶部导航（管理员专属）。
 *
 * 四个同级入口：数据源与导入｜经验审核｜模型与配置｜审计台。
 * 设计意图（对齐需求口径）：
 *   - 治理面整体收缩在「系统管理 → AI 治理」（2026-09-18 起「AI 治理」是侧边栏一级入口）下面，
 *     侧边栏**不再挂**这些子页（避免三级菜单与层级分散）；
 *   - 子页由本导航以同一层级横向承载，进入任意子页都能一键横向切换；
 *   - 曾经的第六项「AI 治理」（概览首页）已于 2026-09-15 移除：它只是总览 + 横向入口的中转页，
 *     而各子页在顶栏本来就一键可达，实用性不大；`/admin/ai` 现在重定向到第一项「数据源与导入」，
 *     因此这里不再有 `/admin/ai` 的导航项，模块名由 Header 的标题（`staticData.title`）表达；
 *   - 原第一项「知识库」2026-09-18 移除：知识库治理已并入「AI 工作台 → 知识库 → 团队知识库」
 *     （管理员视图），治理面不再重复留一个知识库入口。
 *
 * **数据来源已收进数据层（2026-09-16）**：清单是 `sidebar-data.ts` 的 `adminAiNavItems`，
 * 不在本文件里重复写 —— 顶栏导航与全局命令菜单取同一份，避免"加了一个治理子页却只改了一边"。
 */
export function AdminAiNav() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    // 单行布局：本组件渲染在全局 Header 的中段槽位里，不能换行（槽位是固定高度）。
    <nav aria-label='AI 治理功能导航' className='flex items-center gap-1'>
      {adminAiNavItems.map((item) => {
        // 全部按精确路径高亮：子页各亮自己
        const active = pathname === item.url
        const Icon = item.icon
        return (
          <Link
            aria-current={active ? 'page' : undefined}
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

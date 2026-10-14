import { Link, useRouterState } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { sidebarData } from '@/components/layout/data/sidebar-data'
import { findNavChildren } from '@/components/layout/nav-children'
import { filterNavItemsByRole } from '@/components/layout/nav-filter'

type AgentNavProps = {
  isAdmin: boolean
  toolCount: number
  demoMode: boolean
}

/**
 * 员工侧模块导航：只放**使用面**。
 *
 * 治理动作（知识库、数据源与导入、经验审核、模型与配置、审计台）已迁到后台 /admin/ai/*，
 * 员工在这里看不到、也不需要看到；管理员通过左侧边栏「系统管理 → AI 治理」进入。
 *
 * **数据来源与侧边栏同源（2026-09-16）**：子项不再在本文件里重复写一遍，
 * 而是从 `sidebarData.navItems` 的「AI 助手」类目取（`findNavChildren`），
 * 角色过滤也复用侧边栏那套 `filterNavItemsByRole` —— 顶栏与侧边栏因此永远一致，
 * 加/删一个子页只改 `sidebar-data.ts` 一处。
 * 由此带来的口径：**顶栏该显示什么，由该子页在侧边栏里的可见性决定**（`adminOnly` 生效）。
 *
 * **2026-09-18 起该导航通常是空的**：「AI 助手」由折叠类目改为单页类目
 * （「我的沉淀」迁进「知识库」，「我的 ASIN」「提示词广场」早已各自升为一级类目），
 * 于是这里只剩状态徽标。保留派生逻辑而不是直接删掉 `<nav>`，是为了让"将来再加子项"
 * 时导航自动出现 —— 空的 `<nav>` 不渲染即可，见下方 `items.length > 0`。
 */
export function AgentNav({ isAdmin, toolCount, demoMode }: AgentNavProps) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const items = findNavChildren(
    filterNavItemsByRole(sidebarData.navItems, isAdmin),
    'AI 助手'
  )

  return (
    // 单行布局：本组件渲染在全局 Header 的中段槽位里，不能换行（槽位是固定高度）。
    <div className='flex items-center gap-2'>
      {items.length > 0 && (
        <nav aria-label='AI 助手功能导航' className='flex items-center gap-1'>
          {items.map((item) => {
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
      )}
      <div className='flex items-center gap-2 text-xs text-muted-foreground'>
        <Badge className='gap-1 font-normal' variant='outline'>
          <ShieldCheck className='size-3.5' />
          可用工具 {toolCount} 个
        </Badge>
        {demoMode && (
          <Badge className='font-normal' variant='secondary'>
            演示模式：未接入云模型
          </Badge>
        )}
      </div>
    </div>
  )
}

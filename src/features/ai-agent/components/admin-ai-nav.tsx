import { Link, useRouterState } from '@tanstack/react-router'
import {
  Database,
  LayoutDashboard,
  ScrollText,
  Settings2,
  Sparkles,
  Upload,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 「AI 治理」页内顶部导航（管理员专属）。
 *
 * 六个同级入口：AI 治理（首页/概览）｜知识库｜数据源与导入｜经验审核｜模型与配置｜审计台。
 * 设计意图（对齐需求口径）：
 *   - 治理面整体收缩在「设置 → AI 治理」下面，侧边栏**不再挂**这五个子页（避免三级菜单与层级分散）；
 *   - 子页由本导航以同一层级横向承载，进入任意子页都能一键横向切换；
 *   - 「AI 治理」是概览首页，承担总览与快捷入口，避免治理页只有一张单列表格、右侧空旷。
 */
const ADMIN_ITEMS = [
  // 首页/概览入口：精确匹配，避免所有子页都把"AI 治理"点亮
  { to: '/admin/ai', label: 'AI 治理', icon: LayoutDashboard, exact: true },
  { to: '/admin/ai/knowledge', label: '知识库', icon: Database },
  { to: '/admin/ai/datasources', label: '数据源与导入', icon: Upload },
  { to: '/admin/ai/distill', label: '经验审核', icon: Sparkles },
  { to: '/admin/ai/settings', label: '模型与配置', icon: Settings2 },
  { to: '/admin/ai/audit', label: '审计台', icon: ScrollText },
]

export function AdminAiNav() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    // 单行布局：本组件渲染在全局 Header 的中段槽位里，不能换行（槽位是固定高度）。
    <nav
      aria-label='AI 治理功能导航'
      className='flex items-center gap-1'
    >
      {ADMIN_ITEMS.map((item) => {
        // 全部按精确路径高亮：「AI 治理」只在首页点亮，子页各亮自己
        const active = pathname === item.to
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
            key={item.to}
            to={item.to}
          >
            <Icon className='size-4' />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

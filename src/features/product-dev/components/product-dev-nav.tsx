import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { sidebarData } from '@/components/layout/data/sidebar-data'
import { findNavChildren } from '@/components/layout/nav-children'

/** 与侧边栏子项同一个 url：用它判断"这一项是不是对比页"，避免按文案匹配。 */
const COMPARE_PATH = '/product-dev/compare'

/**
 * 「产品开发」的顶栏中段导航（候选池 ｜ 对比与历史 ｜ 市场调研）。
 *
 * **与侧边栏同源**：子项从 `sidebarData.navItems` 的「产品开发」类目派生（`findNavChildren`），
 * 不在这里另写一份名称与路径 —— 同「AI 助手」顶栏导航的口径（见 `agent-nav.tsx`）。
 *
 * **「已选 N」挂在对比页这一项**上：选择候选这件事的结果只在对比页被消费，
 * 原先它挂在页内页签的标签上，拆成路由后页签没了，徽标必须跟着走到能看见的地方。
 */
export function ProductDevNav({ selectedCount }: { selectedCount: number }) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const items = findNavChildren(sidebarData.navItems, '产品开发')

  return (
    // 单行布局：本组件渲染在全局 Header 的中段槽位里，不能换行（槽位是固定高度）。
    <nav aria-label='产品开发功能导航' className='flex items-center gap-1'>
      {items.map((item) => {
        const active = pathname === item.url
        const Icon = item.icon
        const showSelected = item.url === COMPARE_PATH && selectedCount > 0
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
            {showSelected && `（已选 ${selectedCount}）`}
          </Link>
        )
      })}
    </nav>
  )
}

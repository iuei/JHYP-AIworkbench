import { Link, useRouterState } from '@tanstack/react-router'
import { MessageSquareText, NotebookPen, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

type AgentNavProps = {
  isAdmin: boolean
  toolCount: number
  demoMode: boolean
}

const baseItems = [
  { to: '/ai-agent', label: '对话', icon: MessageSquareText, adminOnly: false },
  {
    to: '/ai-agent/notes',
    label: '我的沉淀',
    icon: NotebookPen,
    adminOnly: false,
  },
]

/**
 * 员工侧模块导航：只放**使用面**（对话、我的沉淀）。
 *
 * 治理动作（知识库、数据源与导入、经验审核、模型与配置、审计台）已迁到后台 /admin/ai/*，
 * 员工在这里看不到、也不需要看到；管理员通过左侧边栏「AI 治理」进入。
 * adminOnly 字段保留，用于将来出现"仅管理员可见的使用面增强"时复用。
 */
export function AgentNav({ isAdmin, toolCount, demoMode }: AgentNavProps) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const items = baseItems.filter((item) => isAdmin || !item.adminOnly)

  return (
    // 单行布局：本组件渲染在全局 Header 的中段槽位里，不能换行（槽位是固定高度）。
    <div className='flex items-center gap-2'>
      <nav
        aria-label='AI 助手功能导航'
        className='flex items-center gap-1'
      >
        {items.map((item) => {
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

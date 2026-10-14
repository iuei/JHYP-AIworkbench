import { Link, useRouterState } from '@tanstack/react-router'
import { FileClock, LayoutGrid } from 'lucide-react'
import { cn } from '@/lib/utils'

const items = [
  { title: '类目洞察', url: '/market-insights', icon: LayoutGrid },
  { title: '报告记录', url: '/market-insights/reports', icon: FileClock },
]

export function MarketInsightsNav() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  return (
    <nav aria-label='市场洞察功能导航' className='flex items-center gap-1'>
      {items.map((item) => {
        const active = pathname === item.url
        const Icon = item.icon
        return (
          <Link
            key={item.url}
            to={item.url}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Icon className='size-4' aria-hidden='true' />
            {item.title}
          </Link>
        )
      })}
    </nav>
  )
}

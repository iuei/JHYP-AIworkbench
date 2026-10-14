import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { useBreadcrumb } from './breadcrumb'

/**
 * 顶栏面包屑：`仪表盘 / 系统管理 / 用户管理`。
 *
 * 结构上刻意用 `nav > ol > li`（而不是一串 `span` 加斜杠）：
 * 面包屑是"位置层级"的语义化表达，读屏用户需要知道它是导航、有几级、当前在哪一级。
 * 末级渲染成 `h1[aria-current=page]` —— 全站唯一的页面标题仍然是它，
 * 这是 2026-09-11 "顶部栏是唯一的页面标题位"这条口径的延续，不是推翻。
 *
 * 分隔符用 `/` 而不是 `ChevronRight`：面包屑里每一级都是**路径段**，
 * 斜杠直接对应 URL 的层级读法；箭头图标在窄屏还多占宽度。
 */
export function AppBreadcrumb({ className }: { className?: string }) {
  const entries = useBreadcrumb()
  if (entries.length === 0) return null

  return (
    <nav
      aria-label='面包屑'
      className={cn('min-w-0 shrink', className)}
      data-breadcrumb
    >
      <ol className='flex min-w-0 items-center gap-1.5 text-sm'>
        {entries.map((entry, index) => {
          const isLast = index === entries.length - 1
          return (
            <li
              key={`${entry.title}-${index}`}
              className='flex min-w-0 items-center gap-1.5'
            >
              {index > 0 && (
                <span aria-hidden='true' className='text-muted-foreground/50'>
                  /
                </span>
              )}
              {isLast ? (
                <h1
                  aria-current='page'
                  className='truncate text-sm font-medium'
                  data-breadcrumb-current
                >
                  {entry.title}
                </h1>
              ) : entry.href ? (
                <Link
                  to={entry.href}
                  className='max-w-40 truncate text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none'
                >
                  {entry.title}
                </Link>
              ) : (
                // 折叠类目（「系统管理」「产品开发」这类）本身没有落地页，
                // 只作为层级标签出现，不给一个点不动的假链接。
                <span className='max-w-40 truncate text-sm text-muted-foreground'>
                  {entry.title}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

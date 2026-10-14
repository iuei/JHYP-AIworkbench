import { Link, useSearch } from '@tanstack/react-router'
import { Globe2, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 「提示词广场」自己的页内顶部导航（我的提示词 ｜ 共享提示词）。
 *
 * 它取代 AI 助手模块导航出现在提示词广场页面：提示词广场在侧边栏是**一级类目**，
 * 顶栏再挂「对话 / 我的 ASIN / 我的沉淀」会让它看起来仍是 AI 助手的子页
 * （用户口径："提示词广场没有顶部子页面" —— 要的是属于它自己的子页）。
 *
 * **2026-09-16 阶段 C**：提示词广场迁到自己的路径 `/prompts`（此前是 `/ai-agent/prompts`，
 * 一级类目住在二级路径里），本组件的 `from` 与 `to` 随之更新 ——
 * 它现在由 `routes/_authenticated/prompts/route.tsx` 注入，不再依赖 `AiAgentLayout` 的按路径分流。
 *
 * 两个子页共用同一路由、用 search 参数 `view` 表达（`?view=shared`）：
 * 新建独立路由要动路由树（拆成目录），而这里只是同一份列表的两种取数范围，
 * search 参数既能让 URL 可分享/可刷新，也不影响侧边栏对 `/prompts` 的高亮。
 */
const ITEMS = [
  { view: 'mine', label: '我的提示词', icon: UserRound },
  { view: 'shared', label: '共享提示词', icon: Globe2 },
] as const

export function PromptSquareNav() {
  const { view } = useSearch({ from: '/_authenticated/prompts/' })
  const current = view ?? 'mine'

  return (
    // 单行布局：本组件渲染在全局 Header 的中段槽位里，不能换行（槽位是固定高度）
    <nav aria-label='提示词广场功能导航' className='flex items-center gap-1'>
      {ITEMS.map((item) => {
        const active = current === item.view
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
            key={item.view}
            // 默认页（我的提示词）不带参数：URL 干净，侧边栏链接与它天然一致
            search={item.view === 'mine' ? {} : { view: item.view }}
            to='/prompts'
          >
            <Icon className='size-4' />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

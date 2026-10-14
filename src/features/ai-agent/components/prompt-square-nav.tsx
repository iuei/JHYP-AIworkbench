import { Link, useSearch } from '@tanstack/react-router'
import { Globe2, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 「提示词广场」自己的页内顶部导航（共享提示词 ｜ 我的提示词）。
 *
 * 它取代 AI 助手模块导航出现在提示词广场页面：提示词广场在侧边栏是**一级类目**，
 * 顶栏再挂「对话 / 我的 ASIN / 我的沉淀」会让它看起来仍是 AI 助手的子页
 * （用户口径："提示词广场没有顶部子页面" —— 要的是属于它自己的子页）。
 *
 * **2026-09-16 阶段 C**：提示词广场迁到自己的路径 `/prompts`（此前是 `/ai-agent/prompts`，
 * 一级类目住在二级路径里），本组件的 `from` 与 `to` 随之更新 ——
 * 它现在由 `routes/_authenticated/prompts/route.tsx` 注入，不再依赖 `AiAgentLayout` 的按路径分流。
 *
 * 两个子页共用同一路由、用 search 参数 `view` 表达（`?view=mine`）：
 * 新建独立路由要动路由树（拆成目录），而这里只是同一份列表的两种取数范围，
 * search 参数既能让 URL 可分享/可刷新，也不影响侧边栏对 `/prompts` 的高亮。
 *
 * **2026-10-14：默认页由「我的提示词」改为「共享提示词」**（用户口径："用户点击提示词广场
 * 时默认页面从我的提示词改为共享提示词页面"）。两处口径同步：① 默认值 `view ?? 'shared'`；
 * ② **选项卡顺序也把共享放前**（默认页排在第一位，否则高亮落在第二枚按钮上会像选错了）；
 * ③ 「共享提示词」不带参数（默认页 URL 干净、与侧边栏 `/prompts` 天然一致），
 * 「我的提示词」带 `?view=mine`。
 */
const ITEMS = [
  { view: 'shared', label: '共享提示词', icon: Globe2 },
  { view: 'mine', label: '我的提示词', icon: UserRound },
] as const

export function PromptSquareNav() {
  const { view } = useSearch({ from: '/_authenticated/prompts/' })
  const current = view ?? 'shared'

  return (
    // 单行布局：本组件渲染在全局 Header 的中段槽位里，不能换行（槽位是固定高度）
    <nav aria-label='提示词广场功能导航' className='flex items-center gap-1'>
      {ITEMS.map((item) => {
        const active = current === item.view
        const Icon = item.icon
        return (
          <Link
            /*
             * `activeOptions={{ exact: true }}` 是必须的（2026-10-14 真实浏览器实测）：
             * 两个选项卡的 `to` 都是 `/prompts`，Router 的 active 判定默认是**路径前缀 +
             * search 部分匹配**，而无参数的默认页 `search={}` 会被判成 `{ view: 'mine' }`
             * 的"部分匹配"——结果**两枚选项卡同时带 `aria-current='page'`**，
             * 读屏会读出两个"当前页"。exact 打开后 search 走严格深比较，只剩正确的一枚。
             */
            activeOptions={{ exact: true }}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
            key={item.view}
            // 默认页（共享提示词）不带参数：URL 干净，侧边栏链接与它天然一致
            search={item.view === 'shared' ? {} : { view: item.view }}
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

import { Link, useSearch } from '@tanstack/react-router'
import { Building2, UserRound } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 「知识库」自己的页内顶部导航（团队知识库 ｜ 个人知识库）。
 *
 * 形态与 `PromptSquareNav` 完全一致：侧边栏一级类目 + 顶栏两个子页 +
 * 单路由 + `?view=` 表达子页。这样 URL 可分享、可刷新，侧边栏对 `/knowledge`
 * 的高亮也不受影响；顶栏挂的**必须是它自己的子页**，否则一级类目看起来仍是别人的子页
 * （提示词广场 2026-09-15 正是因为这一点把 AI 助手导航换掉的）。
 *
 * 两个子页的**写权限完全不同**，这是它们必须分开的原因：
 * - **个人知识库**：自己的经验沉淀，可新建 / 编辑 / 提报审核（数据在 `ai_knowledge_notes`）；
 * - **团队知识库**：已经生效的公司知识文档（数据在 `ai_documents`）——
 *   员工看到的是**只读视图**，管理员看到的是**管理视图**（上传 / 有效期 / 重建索引 /
 *   下线启用删除 / 纠错反馈），两者由 `pages/knowledge-base.tsx` 按角色分发）。
 *
 * **2026-10-14：默认页由「个人知识库」改为「团队知识库」**（用户口径："点击知识库时
 * 默认页面…知识库也是"）。三处口径同步：① 默认值 `view ?? 'team'`；② 选项卡顺序把团队放前
 * （默认页排在第一位）；③ 「团队知识库」不带参数（默认页 URL 干净、与侧边栏 `/knowledge`
 * 天然一致），「个人知识库」带 `?view=mine`。
 * 注意：首页「个人知识库」快捷入口与旧链接因此改为显式 `?view=mine`（语义不能变）。
 */
const ITEMS = [
  { view: 'team', label: '团队知识库', icon: Building2 },
  { view: 'mine', label: '个人知识库', icon: UserRound },
] as const

export function KnowledgeNav() {
  const { view } = useSearch({ from: '/_authenticated/knowledge/' })
  const current = view ?? 'team'

  return (
    // 单行布局：本组件渲染在全局 Header 的中段槽位里，不能换行（槽位是固定高度）
    <nav aria-label='知识库功能导航' className='flex items-center gap-1'>
      {ITEMS.map((item) => {
        const active = current === item.view
        const Icon = item.icon
        return (
          <Link
            /*
             * `activeOptions={{ exact: true }}` 与 `PromptSquareNav` 同一原因（2026-10-14
             * 真实浏览器实测）：两个选项卡共用 `to='/knowledge'`，Router 默认的
             * "路径前缀 + search 部分匹配"会让 `search={}` 的默认页也匹配 `?view=mine`，
             * 两枚同时 `aria-current='page'`。exact 让 search 严格比较，只剩当前那一枚。
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
            // 默认页（团队知识库）不带参数：URL 干净，侧边栏链接与它天然一致
            search={item.view === 'team' ? {} : { view: item.view }}
            to='/knowledge'
          >
            <Icon className='size-4' aria-hidden='true' />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}

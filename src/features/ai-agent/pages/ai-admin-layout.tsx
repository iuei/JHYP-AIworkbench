import { Outlet } from '@tanstack/react-router'
import { HeaderSlot } from '@/components/layout/header-slot'
import { AdminAiNav } from '../components/admin-ai-nav'

/**
 * AI 治理子区域布局：统一承载治理页的内导航。
 *
 * 导航注入全局 Header 中段，不再占内容区一整行、也不再压在页面标题之上。
 * 页面标题（「AI 治理」）由 `/admin/ai` 路由的 `staticData` 提供，
 * 具体在哪一页由导航高亮表达 —— 避免标题与导航项写着同一个名字。
 *
 * 拆成独立一层是为了让 `/admin/ai/*` 各页面共享同一排导航，而 `/admin` 下将来
 * 若新增其他治理域，不会被迫复用 AI 的导航。
 *
 * 内容容器同样必须是 flex 列容器：它嵌在 `AdminAreaLayout` 的 flex 容器里，
 * 页面外壳 `PageShell` 靠 `flex-1 / h-full` 拿到确定高度后自己滚动。
 * 少了 `flex flex-col`，这一层高度退回内容高度，治理页就会「内容超出但滚不动」。
 */
export function AiAdminLayout() {
  return (
    <>
      <HeaderSlot>
        <AdminAiNav />
      </HeaderSlot>
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
        <Outlet />
      </div>
    </>
  )
}

import { Outlet } from '@tanstack/react-router'
import { Main } from '@/components/layout/main'

/**
 * 后台治理区域外壳（管理员）。
 *
 * 只负责内容容器；内导航由 `ai-admin-layout.tsx` 注入全局 Header 中段。
 * 角色校验在路由层（`routes/_authenticated/admin/route.tsx` 的 beforeLoad）完成，
 * 服务端每个接口另有 adminGuard 兜底 —— 前端守卫只为体验。
 */
export function AdminAreaLayout() {
  return (
    <Main className='flex min-h-0 flex-col' fixed>
      <div className='min-h-0 flex-1 overflow-hidden'>
        <Outlet />
      </div>
    </Main>
  )
}

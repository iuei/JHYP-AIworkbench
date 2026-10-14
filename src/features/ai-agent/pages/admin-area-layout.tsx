import { Outlet } from '@tanstack/react-router'
import { Main } from '@/components/layout/main'

/**
 * 后台治理区域外壳（管理员）。
 *
 * 只负责内容容器；内导航由 `ai-admin-layout.tsx` 注入全局 Header 中段。
 * 角色校验在路由层（`routes/_authenticated/admin/route.tsx` 的 beforeLoad）完成，
 * 服务端每个接口另有 adminGuard 兜底 —— 前端守卫只为体验。
 *
 * 内容容器必须是 **flex 列容器**（`flex flex-col`）：页面外壳 `PageShell` 用
 * `h-full / flex-1 + overflow-y-auto` 撑满并自己滚动，只有父级高度确定时才能解析。
 * 这里以前是普通 block 容器，子级的 `flex-1` 失效、`h-full` 的百分比也无从解析，
 * 于是页面高度退化成内容高度并被外层 `overflow-hidden` 裁掉 —— 表现为整页滚不动。
 */
export function AdminAreaLayout() {
  return (
    <Main className='flex min-h-0 flex-col' fixed>
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
        <Outlet />
      </div>
    </Main>
  )
}

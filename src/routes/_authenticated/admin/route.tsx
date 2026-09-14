import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { AdminAreaLayout } from '@/features/ai-agent/pages/admin-area-layout'

/**
 * 后台治理区域（管理员专属）。
 * 角色校验在这里统一做，服务端每个治理接口另有 adminGuard 兜底 —— 前端守卫只为体验。
 */
export const Route = createFileRoute('/_authenticated/admin')({
  beforeLoad: () => {
    const { auth } = useAuthStore.getState()
    if (!auth.user?.role.includes('admin')) {
      throw redirect({ to: '/403' })
    }
  },
  component: AdminAreaLayout,
})

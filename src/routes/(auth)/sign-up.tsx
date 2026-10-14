import { createFileRoute } from '@tanstack/react-router'
import { SignUp } from '@/features/auth/sign-up'

/**
 * 自助注册页（公开路由，未登录可访问）。
 *
 * 提交后账号以 `status='pending'` 落库，拿不到 token ——
 * 放行由管理员在「用户管理」页完成（见 server/index.mjs 的 /api/auth/register）。
 */
export const Route = createFileRoute('/(auth)/sign-up')({
  component: SignUp,
})

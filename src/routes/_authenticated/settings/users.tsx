import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * 旧入口兼容（2026-09-16 阶段 D）：用户管理是**公司级治理**页，已从 `/settings/*`
 * （个人设置路径段）迁到 `/admin/users`。老书签与老验收脚本继续可用。
 */
export const Route = createFileRoute('/_authenticated/settings/users')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/users' })
  },
})

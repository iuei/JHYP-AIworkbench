import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * 旧入口兼容（2026-09-16 阶段 D）：公告管理是**公司级广播**，已从 `/settings/announcements`
 * （个人设置路径段）迁到 `/admin/announcements`。老书签继续可用。
 */
export const Route = createFileRoute('/_authenticated/settings/announcements')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/announcements' })
  },
})

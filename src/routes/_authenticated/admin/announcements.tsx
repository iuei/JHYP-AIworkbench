import { createFileRoute } from '@tanstack/react-router'
import { AnnouncementsAdmin } from '@/features/announcements'

/**
 * 「系统管理 → 公告管理」（2026-09-16 阶段 D：由 `/settings/announcements` 迁入后台治理区）。
 *
 * 公告是面向全公司的广播：管理员发布，员工在**登录后**看到弹窗（见 `src/features/announcements`）。
 * 它属于"公司级设置"而不是"个人设置"，因此随用户管理一起从 `/settings/*` 迁到 `/admin/*`：
 * `/settings` 从此只放**个人**的东西（用户信息）。
 */
export const Route = createFileRoute('/_authenticated/admin/announcements')({
  staticData: { title: '公告管理' },
  component: AnnouncementsAdmin,
})

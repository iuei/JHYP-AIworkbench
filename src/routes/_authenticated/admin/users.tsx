import { createFileRoute } from '@tanstack/react-router'
import { SettingsUsers } from '@/features/settings/users'

/**
 * 「系统管理 → 用户管理」（2026-09-16 阶段 D：由 `/settings/users` 迁入后台治理区）。
 *
 * **为什么迁**：它此前与**个人**的用户信息页同在 `/settings/*` 一个路径段下 ——
 * 一个是"我自己的资料"，一个是"全公司账号的治理"，放在同一层级下读起来是一类东西。
 * 迁到 `/admin/users` 之后：① 「系统管理」类目与 `/admin` 这个一级路径段对齐
 * （URL 层级 = 导航层级）；② `/admin/route.tsx` 的管理员守卫自动覆盖本页，
 * 前端不再需要页面自己兜底（服务端接口另有 adminGuard，三层不冲突）。
 */
export const Route = createFileRoute('/_authenticated/admin/users')({
  staticData: { title: '用户管理' },
  component: SettingsUsers,
})

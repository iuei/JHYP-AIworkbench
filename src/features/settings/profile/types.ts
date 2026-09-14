import type { UserRole } from '../users/types'

/**
 * `GET /api/auth/me` 的响应结构。
 *
 * 注意与登录接口的区别：`POST /api/auth/login` 的 `user` 里 `role` 是数组（供
 * `useAuthStore` 做权限判断），而这里直接是数据库中的单个角色字符串。
 * 该接口只读，不接受任何写入 —— 姓名、部门、角色都由管理员在用户管理中配置。
 */
export type CurrentUserProfile = {
  id: number
  login: string
  name: string
  role: UserRole
  department: string
}

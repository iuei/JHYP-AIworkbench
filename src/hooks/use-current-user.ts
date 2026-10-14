import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth-store'

/** `/auth/me` 里界面用得到的字段（与「用户信息」页同一接口、同一 query key）。 */
export type CurrentUserProfile = {
  login: string
  name: string
  /** 部门由管理员配置、用户只读（`users.department`），可能为空串。 */
  department: string | null
  /** 角色：`admin` / `operator`，展示前经 `roleLabel()` 转中文。 */
  role: string
}

/** 界面直接可用的当前用户展示值（都已做过空值兜底）。 */
export type CurrentUserDisplay = {
  /** 姓名；接口与登录态都没有时退化成登录账号，绝不返回空白或占位假名。 */
  name: string
  accountNo: string
  /** 部门；未配置为空串，由展示层决定写「未设置」。 */
  department: string
  /** 角色标识（admin / operator）；取不到为空串。 */
  role: string
}

/**
 * 当前登录用户的展示数据。
 *
 * 为什么抽成一个 hook（2026-10-14）：侧边栏底部（`AppSidebar` / `NavUser`）与顶部头像
 * （`ProfileDropdown`）展示的是**同一个人、同一批字段**，此前只有侧边栏去查 `/auth/me`，
 * 顶部头像还挂着模板写死的 `SN`。两处各写一遍取数逻辑必然漂移，且会重复发请求 ——
 * 这里统一用 query key `['current-user']`（与「用户信息」页一致，React Query 缓存共享）。
 *
 * 三条兜底口径（与责任田「全局布局与导航」一致）：
 * 1. 以 `/auth/me` 为准（管理员改了姓名 / 部门 / 角色后，缓存刷新即同步）；
 * 2. 接口未回来时先用登录态里的值（登录响应本来就带 name 与 role），旧会话 cookie 没有
 *    `name` 时退化成账号；
 * 3. 都没有时返回空串，由展示层写「未设置」，**不回退到任何占位假名**。
 */
export function useCurrentUser(): CurrentUserDisplay {
  const { auth } = useAuthStore()
  const profile = useQuery<CurrentUserProfile>({
    queryKey: ['current-user'],
    queryFn: async () => (await api.get('/auth/me')).data,
    enabled: Boolean(auth.user),
  })
  const accountNo = profile.data?.login ?? auth.user?.accountNo ?? ''
  const name = profile.data?.name || auth.user?.name || accountNo
  const department = profile.data?.department ?? ''
  const role = profile.data?.role ?? auth.user?.role?.[0] ?? ''

  return { name, accountNo, department, role }
}

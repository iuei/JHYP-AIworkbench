import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth-store'
import { useLayout } from '@/context/layout-provider'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '@/components/ui/sidebar'
import { sidebarData } from './data/sidebar-data'
import { filterNavItemsByRole } from './nav-filter'
import { NavGroup } from './nav-group'
import { NavUser } from './nav-user'
import { TeamSwitcher } from './team-switcher'

/** `/auth/me` 里本组件用到的字段（与「用户信息」页同一接口、同一 query key）。 */
type CurrentUser = {
  login: string
  name: string
}

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  const { auth } = useAuthStore()
  const isAdmin = auth.user?.role.includes('admin') ?? false
  const navItems = filterNavItemsByRole(sidebarData.navItems, isAdmin)
  /*
   * 底部用户区展示**当前登录的人**：
   * - 以 `/auth/me` 为准（query key 与「用户信息」页一致，缓存共享、不额外发请求），
   *   这样管理员改了姓名后侧边栏会跟着更新，不会出现"页面里是新姓名、侧边栏还是旧的"；
   * - 接口没回来之前先用登录态里的值（登录响应本来就带 name）避免闪烁；
   * - 老会话 cookie 里没有 name 时退化成账号，绝不回退到任何占位假名。
   */
  const profile = useQuery<CurrentUser>({
    queryKey: ['current-user'],
    queryFn: async () => (await api.get('/auth/me')).data,
    enabled: Boolean(auth.user),
  })
  const accountNo = profile.data?.login ?? auth.user?.accountNo ?? ''
  const name = profile.data?.name || auth.user?.name || accountNo

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <TeamSwitcher teams={sidebarData.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavGroup items={navItems} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser accountNo={accountNo} name={name} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

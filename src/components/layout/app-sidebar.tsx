import { useAuthStore } from '@/stores/auth-store'
import { useLayout } from '@/context/layout-provider'
import { useCurrentUser } from '@/hooks/use-current-user'
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

export function AppSidebar() {
  const { collapsible, variant } = useLayout()
  const { auth } = useAuthStore()
  const isAdmin = auth.user?.role.includes('admin') ?? false
  const navItems = filterNavItemsByRole(sidebarData.navItems, isAdmin)
  /*
   * 底部用户区的取数口径统一在 `useCurrentUser()`（2026-10-14 从本组件内联逻辑抽出）：
   * `/auth/me` 为准、登录态兜底、旧会话 cookie 没有 name 时退化成账号，绝不回退占位假名。
   * 顶部头像（`ProfileDropdown`）用的是同一个 hook —— 同一份数据不再各查各的。
   */
  const user = useCurrentUser()

  return (
    <Sidebar collapsible={collapsible} variant={variant}>
      <SidebarHeader>
        <TeamSwitcher teams={sidebarData.teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavGroup items={navItems} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser
          accountNo={user.accountNo}
          name={user.name}
          department={user.department}
          role={user.role}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

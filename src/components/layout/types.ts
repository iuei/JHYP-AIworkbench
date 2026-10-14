import { type LinkProps } from '@tanstack/react-router'

type Team = {
  name: string
  logo: React.ElementType
  plan: string
}

type BaseNavItem = {
  title: string
  /** 侧边栏中的业务域标题；同一域只在第一次出现时渲染一次。 */
  section?: string
  badge?: string
  icon?: React.ElementType
  /** 仅管理员可见（侧边栏按角色过滤；服务端另有各自的守卫兜底） */
  adminOnly?: boolean
  /** 子页也算激活（例如入口 /admin/ai 在 /admin/ai/datasources 下仍高亮） */
  matchPrefix?: boolean
}

type NavLink = BaseNavItem & {
  url: LinkProps['to'] | (string & {})
  items?: never
}

/**
 * 二级子项（一级类目下的子页）。
 *
 * 单独抽出来是为了让「顶栏中段导航」与「侧边栏浮窗」取**同一份**数据：
 * 二级子页此前在 `sidebar-data.ts` 与各模块自己的导航组件里各写一遍，
 * 改一处漏一处（见 `nav-children.ts` 与 `2026-09-16-sidebar-category-ia-refactor.md`）。
 */
type NavChildItem = BaseNavItem & {
  url: LinkProps['to'] | (string & {})
}

type NavCollapsible = BaseNavItem & {
  items: NavChildItem[]
  url?: never
}

type NavItem = NavCollapsible | NavLink

type SidebarData = {
  teams: Team[]
  /** 侧边栏一级类目，扁平列表：不再分「常用 / 其他」这类人为分组 */
  navItems: NavItem[]
}

export type {
  SidebarData,
  NavItem,
  NavCollapsible,
  NavLink,
  NavChildItem,
}

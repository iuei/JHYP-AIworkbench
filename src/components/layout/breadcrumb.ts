import { useMemo } from 'react'
import {
  useMatches,
  useRouterState,
  type LinkProps,
} from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { sidebarData } from './data/sidebar-data'
import { filterNavItemsByRole } from './nav-filter'
import { findNavTrail } from './nav-match'
import type { NavItem } from './types'
import { pickPageTitle } from './use-page-title'

/**
 * 顶栏面包屑（2026-09-17 新增，取代原来的"单个页面标题"）。
 *
 * ### 为什么取代而不是并存
 *
 * `Header` 原先渲染的 `h1` 只有一个页面名。加上面包屑后两者会**信息重复**：
 * 面包屑的末级就是当前页名。项目 2026-09-11 立的口径是"顶部栏是唯一的页面标题位"，
 * 面包屑正是这条口径的加强版 —— 它把"我在哪"从"一个词"变成"一条路径"，
 * 层级信息（属于哪个类目）第一次出现在顶栏。
 *
 * ### 两条硬约束（都有验收脚本守着）
 *
 * 1. **末级必须仍是全页唯一的 `h1`**：`verify-artifacts/asin-redesign-check.mjs`
 *    断言 `getByRole('heading', { level: 1 })` 恰好 1 个且名字是当前页名。
 *    所以末级渲染成 `<h1 aria-current='page'>` 而不是 `<span>` —— 去掉 h1 是 a11y 退化。
 * 2. **层级名必须与侧边栏同源**：类目名从 `sidebar-data.ts` 反查（`findNavTrail`），
 *    不另写一份字面映射，否则加一类目就要改两处。
 */
export type BreadcrumbEntry = {
  title: string
  /** 有值且不是末级时可点击跳转；末级恒无链接 */
  href?: LinkProps['to'] | (string & {})
}

/**
 * 由路径 + 路由标题 + 侧边栏数据推导面包屑。
 *
 * 形态（根 / 类目层级 / 当前页）：
 * - `/admin/users` → 仪表盘 / 用户管理（**两级**：「系统管理」只是侧边栏的分组标签、
 *   不是导航层级，所以 2026-09-18 起它不再出现在面包屑里）
 * - `/product-dev/market` → 仪表盘 / 产品开发 / 市场调研（三级）
 * - `/admin/ai/datasources` → 仪表盘 / AI 治理 / 数据源与导入（三级：侧边栏只到「AI 治理」，
 *   它的四个治理子页由顶栏中段导航承载并各自声明标题）
 * - `/competitor-analysis/B0XXXX` → 仪表盘 / 竞品分析 / 竞品详情（详情页在导航里没有对应项，逐级回退）
 * - `/settings` → 仪表盘 / 用户信息（个人页刻意不在 navItems 里，退化成"根 + 路由标题"）
 */
export function buildBreadcrumb({
  pathname,
  title,
  navItems,
}: {
  pathname: string
  /** 路由 `staticData.title`（`pickPageTitle` 的结果），找不到导航项时的兜底 */
  title?: string
  navItems: NavItem[]
}): BreadcrumbEntry[] {
  /*
   * 根节点的名字取自侧边栏第一项（`url: '/'`）而不是写死"主页"：
   * 侧边栏那个入口叫「仪表盘」，面包屑再叫「主页」就是同一个地方两个名字，
   * 而两边同源之后，将来改名只需要改 `sidebar-data.ts` 一处。
   */
  const home = navItems.find((item) => item.url === '/')
  const homeTitle = home?.title ?? '主页'
  const path = pathname.split('?')[0].replace(/\/+$/, '') || '/'

  if (path === '/') return [{ title: homeTitle }]

  const entries: BreadcrumbEntry[] = [{ title: homeTitle, href: '/' }]
  const trail = findNavTrail(path, navItems)
  /*
   * 精确命中：末项就是当前页，照导航的名字显示（`/product-dev/market` → 「市场调研」，
   * 比路由上的模块名「产品开发」更具体）。
   * 回退命中：导航里根本没有这个路径（`/competitor-analysis/<ASIN>`），
   * **只取业务域那一级当祖先** —— 把回退层的子页名（「分析」）也拼上会得到四级，
   * 而它对一个竞品详情页没有任何定位意义。末级留给下面的路由标题。
   */
  const ancestors = trail.exact
    ? trail.entries.slice(0, -1)
    : trail.entries.slice(0, 1)
  for (const entry of ancestors) {
    entries.push({ title: entry.title, href: entry.url })
  }
  if (trail.exact && trail.entries.length > 0) {
    const tip = trail.entries[trail.entries.length - 1]
    entries.push({ title: tip.title, href: tip.url })
  }

  /*
   * 路由标题比导航末项更具体时补一级，**同名不补**：
   * 带二级导航的模块只在模块级路由声明标题（`/product-dev/market` 的标题是「产品开发」，
   * 而导航项叫「市场调研」），此时两者都该出现；而 `/admin/users` 两者同名，
   * 补一级就会得到"用户管理 / 用户管理"。
   */
  const last = entries[entries.length - 1]
  if (
    title &&
    title !== last.title &&
    !entries.some((e) => e.title === title)
  ) {
    entries.push({ title })
  }

  // 末级是"我在哪"，不是可去的地方：去掉它的链接。
  const tail = entries[entries.length - 1]
  return [...entries.slice(0, -1), { title: tail.title }]
}

/** 当前页面在顶栏要显示的面包屑。 */
export function useBreadcrumb(): BreadcrumbEntry[] {
  const matches = useMatches()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  // 普通账号看不到管理类目；面包屑与侧边栏用同一份过滤，避免出现"看得见但点不动"的层级。
  const isAdmin = useAuthStore(
    (state) => state.auth.user?.role.includes('admin') ?? false
  )

  return useMemo(
    () =>
      buildBreadcrumb({
        pathname,
        title: pickPageTitle(matches),
        navItems: filterNavItemsByRole(sidebarData.navItems, isAdmin),
      }),
    [isAdmin, matches, pathname]
  )
}

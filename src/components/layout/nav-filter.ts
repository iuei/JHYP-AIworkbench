import type { NavItem } from './types'

/**
 * 按当前账号角色过滤侧边栏一级类目。
 *
 * 为什么必须在客户端过滤：侧边栏数据是静态的，此前「设置 → 用户管理」对所有角色可见，
 * 而 `/api/users` 是管理员专属 —— 普通账号点进去只看到报错，等于把治理入口暴露给全员。
 * 过滤后子项被清空的折叠类目也会被移除（例如普通账号看不到整个「设置」）。
 *
 * 注意：这里只解决"看得见"，真正的权限判断在服务端（各接口 adminGuard）与路由守卫。
 */
export function filterNavItemsByRole(
  items: NavItem[],
  isAdmin: boolean
): NavItem[] {
  if (isAdmin) return items
  return items
    .filter((item) => !item.adminOnly)
    .map((item) =>
      item.items
        ? { ...item, items: item.items.filter((sub) => !sub.adminOnly) }
        : item
    )
    .filter((item) => !item.items || item.items.length > 0)
}

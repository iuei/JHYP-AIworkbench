import type { NavChildItem, NavItem } from './types'

/**
 * 从一级类目列表里取出某个类目的二级子项。
 *
 * **为什么需要它（2026-09-16）**：二级子页此前有**两份字面数据** ——
 * 侧边栏取 `sidebarData.navItems[].items`，而 AI 助手顶栏导航（`agent-nav.tsx`）
 * 自己又写了一份同样的「对话 / 我的 ASIN / 我的沉淀」；AI 治理的五项同理。
 * 两份数据各自演化，改一处漏一处（加一个子页只加了侧边栏、顶栏没有），
 * 且写测试要各测一遍。现在顶栏导航一律从这里派生，`navItems` 是唯一数据源。
 *
 * 找不到同名类目、或该类目是叶子项（没有子页）时返回空数组：
 * 调用方渲染出空导航即为"这个类目没有子页"，不需要额外判空分支。
 */
export function findNavChildren(
  items: NavItem[],
  parentTitle: string
): NavChildItem[] {
  const parent = items.find((item) => item.title === parentTitle)
  return parent?.items ?? []
}

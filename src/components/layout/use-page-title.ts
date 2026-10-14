/**
 * 路由匹配链里能提供标题的最小形状。
 *
 * 导出而不是内联：`breadcrumb.ts` 要用同一个类型接 `useMatches()` 的结果，
 * 各写一份会在路由类型变化时只改一边。
 */
export type MatchLike = { staticData?: { title?: string } | undefined }

/**
 * 从匹配路由链里取标题：从最深的匹配往上找第一个声明了 `staticData.title` 的路由。
 *
 * 为什么从深往浅找：模块级路由可以声明模块名（如 `/admin/ai` → 「AI 治理」），
 * 子页不重复声明，于是带二级导航的模块标题保持稳定，普通页面各自声明自己的名字。
 * 全部没声明时返回 `undefined`，顶栏面包屑会退化成"只剩导航层级、没有当前页名"。
 *
 * 抽成纯函数是为了能直接单测这条继承规则 —— 它是"页面名只出现一次"的关键。
 *
 * **消费方在 2026-09-17 变了**：原先是 `usePageTitle()` 给 `Header` 渲染单个 `h1`，
 * 现在是 `useBreadcrumb()` 把它当作面包屑的末级标题（导航里找不到同名项时的兜底）。
 * `usePageTitle` 这个 hook 随之删除 —— 留着一个没人用的 hook 只会让人以为顶栏还在渲染单标题。
 */
export function pickPageTitle(matches: MatchLike[]): string | undefined {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const title = matches[index]?.staticData?.title
    if (title) return title
  }
  return undefined
}

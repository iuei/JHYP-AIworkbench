import { useMatches } from '@tanstack/react-router'

type MatchLike = { staticData?: { title?: string } | undefined }

/**
 * 从匹配路由链里取标题：从最深的匹配往上找第一个声明了 `staticData.title` 的路由。
 *
 * 为什么从深往浅找：模块级路由可以声明模块名（如 `/admin/ai` → 「AI 治理」），
 * 子页不重复声明，于是带二级导航的模块标题保持稳定，普通页面各自声明自己的名字。
 * 全部没声明时返回 `undefined`，`Header` 会退化成只显示控件、不显示空标题。
 *
 * 抽成纯函数是为了能直接单测这条继承规则 —— 它是"页面名只出现一次"的关键。
 */
export function pickPageTitle(matches: MatchLike[]): string | undefined {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const title = matches[index]?.staticData?.title
    if (title) return title
  }
  return undefined
}

/** 当前页面的标题，供全局 `Header` 渲染成唯一的 `h1`。 */
export function usePageTitle(): string | undefined {
  return useMatches({ select: pickPageTitle })
}

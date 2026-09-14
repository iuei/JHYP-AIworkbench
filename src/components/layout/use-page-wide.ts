import { useMatches } from '@tanstack/react-router'

type MatchLike = { staticData?: { wide?: boolean; title?: string } | undefined }

/**
 * 当前页面是否要铺满可用宽度（绕过 `Main` 的 `max-w-[1280px]` 居中）。
 *
 * 与 `pickPageTitle` 的取舍不同：标题是"子页继承模块名"，只认有值的项；
 * 宽度策略则要求**显式声明**——沿匹配链由深往浅取第一个布尔值，
 * 这样子页能用 `wide: false` 关掉模块级继承来的宽屏策略，而"没声明"就仍按默认居中。
 *
 * 抽成纯函数是为了能直接单测这条继承规则，避免以后有人顺手改成"有值才认"或"取最浅的"。
 */
export function pickPageWide(matches: MatchLike[]): boolean {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const wide = matches[index]?.staticData?.wide
    if (typeof wide === 'boolean') return wide
  }
  return false
}

/** 当前页面的宽度策略，供模块 layout 决定是否给 `Main` 传 `fluid`。 */
export function usePageWide(): boolean {
  return useMatches({ select: pickPageWide })
}

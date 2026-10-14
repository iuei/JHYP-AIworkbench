import type { LinkProps } from '@tanstack/react-router'
import type { NavItem } from './types'

/**
 * 导航项命中判定（全站唯一一份口径）。
 *
 * **为什么抽出来（2026-09-17）**：这套判定原本只写在 `nav-group.tsx` 的 `checkIsActive`
 * 里，服务于"侧边栏哪一项高亮"。新增面包屑后，"当前路径属于哪个类目"必须与它**完全一致** ——
 * 两份实现各写一遍的话，会出现"侧边栏点亮了 A，面包屑却说是 B"这种自相矛盾的状态，
 * 而且两边都要各自补测试。这里做纯函数搬运，`nav-group.tsx` 改为引用，行为一字未改。
 */

/**
 * 某个 url 是否命中当前路径。
 *
 * `matchPrefix` 是**显式字段**而不是对所有项做前缀匹配：入口页 `/admin/ai`
 * 需要在子页 `/admin/ai/datasources` 下保持高亮，而 `/ai-agent` 不应该连带点亮 `/ai-agent/notes`。
 */
export function isNavUrlActive(
  pathname: string,
  url: string | undefined,
  matchPrefix?: boolean
): boolean {
  if (!url) return false
  // 带 ?search 参数时按路径比对
  const path = pathname.split('?')[0]
  if (path === url) return true
  if (matchPrefix !== true || url.length <= 1) return false
  return path.startsWith(`${url}/`)
}

/** 在一个折叠菜单中选择当前路径最具体的子项。 */
export function findActiveNavChild<
  T extends { url?: string; matchPrefix?: boolean },
>(pathname: string, items: T[]): T | undefined {
  const path = pathname.split('?')[0].replace(/\/+$/, '') || '/'
  const exact = items.find((item) =>
    isNavUrlActive(path, item.url, item.matchPrefix)
  )
  if (exact) return exact

  return items
    .filter((item): item is T & { url: string } =>
      item.url ? path.startsWith(`${item.url.replace(/\/+$/, '')}/`) : false
    )
    .sort((left, right) => right.url.length - left.url.length)[0]
}

/**
 * 面包屑用的一级/二级条目（只取渲染需要的两个字段，不绑死 `NavItem` 的其余结构）。
 *
 * `url` 的类型与 `NavItem.url` 保持一致（`LinkProps['to'] | (string & {})`），
 * 上层才能直接把它交给 `<Link to={...}>` 而不需要类型断言。
 */
export type NavTrailEntry = {
  title: string
  url?: LinkProps['to'] | (string & {})
}

/**
 * 路径由深到浅的候选列表（不含根 `/`，根由调用方单独处理）。
 *
 * 逐级回退是必要的：`/competitor-analysis/<ASIN>`（从卡片点进去的详情页）
 * 与 `/asin-watchlists/items`（升为独立路由的明细页）在侧边栏里都没有同名项，
 * 只做精确匹配会让面包屑退化成一个孤零零的页面名。
 */
function pathCandidates(pathname: string): string[] {
  const path = pathname.split('?')[0].replace(/\/+$/, '')
  if (!path || path === '/') return []
  const segments = path.split('/').filter(Boolean)
  const candidates: string[] = []
  for (let depth = segments.length; depth >= 1; depth -= 1) {
    candidates.push(`/${segments.slice(0, depth).join('/')}`)
  }
  return candidates
}

/**
 * 面包屑命中的结果。
 *
 * `exact` 是调用方**必须**区分的一件事（2026-09-17 补）：
 * - `true`：当前路径就是导航里的这一项（含 `matchPrefix` 的前缀命中，如 `/admin/ai/datasources` → 「AI 治理」）
 *   —— 末项就是"我在哪"，该照导航的名字显示；
 * - `false`：只是**逐级回退**到了上层，说明当前路径（`/competitor-analysis/<ASIN>`）在导航里没有对应项
 *   —— 此时导航只能说明"在哪个业务域下面"，中间那一层子页名（「分析」）对详情页没有意义，
 *   再拼上去会得到"仪表盘 / 竞品分析 / 分析 / 竞品详情"这种四级面包屑（参考形态是三级）。
 */
export type NavTrail = {
  entries: NavTrailEntry[]
  exact: boolean
}

/**
 * 找出当前路径在侧边栏里的位置，最多两级（类目 + 子项）。
 *
 * 返回值只含**祖先与当前项**，不含根节点 —— 根节点由 `buildBreadcrumb` 统一加，
 * 这样"仪表盘"这一级的名字永远与侧边栏第一项同源，不会出现两处各写一个"主页 / 首页"。
 */
export function findNavTrail(pathname: string, items: NavItem[]): NavTrail {
  const candidates = pathCandidates(pathname)
  for (const [index, candidate] of candidates.entries()) {
    // 候选由深到浅排列，第一个就是路径本身 —— 命中它才算"精确"
    const exact = index === 0
    for (const item of items) {
      if (item.items) {
        const child = findActiveNavChild(candidate, item.items)
        if (child) {
          /*
           * 子项是**前缀回退**选中的（`/competitor-analysis/B0XXX` 落到「分析」）时不算精确命中：
           * 这时导航只能说明"在哪个业务域下面"，把子项名也拼进面包屑会得到
           * "仪表盘 / 竞品分析 / 分析 / 竞品详情"这种冗余四级（2026-09-18 复验时抓到回归，
           * 判据从"候选就是路径本身"收紧为"子项真的命中了这个候选"）。
           */
          const precise =
            exact && isNavUrlActive(candidate, child.url, child.matchPrefix)
          return {
            entries: precise
              ? [{ title: item.title }, { title: child.title, url: child.url }]
              : [{ title: item.title }],
            exact: precise,
          }
        }
        continue
      }
      if (isNavUrlActive(candidate, item.url, item.matchPrefix)) {
        return { entries: [{ title: item.title, url: item.url }], exact }
      }
    }
  }
  return { entries: [], exact: false }
}

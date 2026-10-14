import { createFileRoute, redirect } from '@tanstack/react-router'
import { ProductDevPoolPage } from '@/features/product-dev/pages/pool-page'

/**
 * 「产品开发 → 候选池」（本模块默认子页）。
 *
 * **旧链接兼容（2026-09-16 阶段 B）**：这三个子页此前是同一个页面里的页签，
 * 用 `?view=market` / `?view=compare` 表达，前者还被竞品分析页的跳转与验收脚本引用过。
 * 现在它们各自有真实路径，旧 URL 必须继续可用（老书签、聊天里粘过的链接），
 * 因此在这里做重定向 —— 放在**候选池路由**而不是模块布局：只有落到默认子页时才需要判断，
 * 而且跳转目标与来源在同一层，读起来最直接。
 *
 * `keyword` / `marketplace` 一并透传：竞品分析页是"带着类目名"跳过来的，丢了就要用户重敲。
 */
type LegacyProductDevSearch = {
  view?: unknown
  keyword?: unknown
  marketplace?: unknown
}

export const Route = createFileRoute('/_authenticated/product-dev/')({
  // 只为读旧参数：老链接的 view 用不上，但解析出来才能判断该跳到哪个新路径
  validateSearch: (search: Record<string, unknown>): LegacyProductDevSearch => ({
    view: search.view,
    keyword: search.keyword,
    marketplace: search.marketplace,
  }),
  beforeLoad: ({ location }) => {
    const { view, keyword, marketplace } = location.search as LegacyProductDevSearch
    if (view !== 'market' && view !== 'compare') return

    if (view === 'market') {
      throw redirect({
        to: '/product-dev/market',
        search: {
          keyword: typeof keyword === 'string' && keyword.trim() ? keyword.trim() : undefined,
          marketplace:
            typeof marketplace === 'string' && /^[A-Za-z]{2}$/.test(marketplace)
              ? marketplace.toUpperCase()
              : undefined,
        },
      })
    }

    throw redirect({ to: '/product-dev/compare' })
  },
  component: ProductDevPoolPage,
})

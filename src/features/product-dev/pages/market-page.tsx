import { useSearch } from '@tanstack/react-router'
import { MarketResearchPanel } from '../components/market-research-panel'

/**
 * 「产品开发 → 市场调研」子页（2026-09-16 阶段 B 由单页页签改为独立路由）。
 *
 * 本页刻意**不接收模块 context**：市场调研的输入是类目而不是候选，与候选池 / 对比没有共享状态，
 * 因此它是三个子页里唯一可以完全独立渲染的一个。
 *
 * `keyword` / `marketplace` 由跳转方带过来（竞品分析页的"去看这个类目"）：
 * 带关键词进来即自动搜一次，用户不必重新输入。脏值由路由的 `validateSearch` 过滤。
 */
export function ProductDevMarketPage() {
  const search = useSearch({ from: '/_authenticated/product-dev/market' })

  return (
    <MarketResearchPanel
      initialKeyword={search.keyword ?? null}
      initialMarketplace={search.marketplace ?? 'US'}
    />
  )
}

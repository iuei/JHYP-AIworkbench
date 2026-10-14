import { createFileRoute } from '@tanstack/react-router'
import { ProductDevMarketPage } from '@/features/product-dev/pages/market-page'

/**
 * 「产品开发 → 市场调研」。
 *
 * 可选 URL 参数：
 * - `keyword` / `marketplace`：竞品分析页"去看这个类目"带过来的关键词与站点，
 *   进去即自动搜一次，免去重新输入。
 *
 * 脏值一律忽略（同项目其他页面的 search 口径），不白屏。
 */
export const Route = createFileRoute('/_authenticated/product-dev/market')({
  validateSearch: (search: Record<string, unknown>) => ({
    keyword:
      typeof search.keyword === 'string' && search.keyword.trim()
        ? search.keyword.trim().slice(0, 60)
        : undefined,
    marketplace:
      typeof search.marketplace === 'string' && /^[A-Za-z]{2}$/.test(search.marketplace)
        ? search.marketplace.toUpperCase()
        : undefined,
  }),
  component: ProductDevMarketPage,
})

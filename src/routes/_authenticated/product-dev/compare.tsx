import { createFileRoute } from '@tanstack/react-router'
import { ProductDevComparePage } from '@/features/product-dev/pages/compare-page'

/** 「产品开发 → 对比与历史」：选候选、跑对比、看结果与回看历史（同屏）。 */
export const Route = createFileRoute('/_authenticated/product-dev/compare')({
  component: ProductDevComparePage,
})

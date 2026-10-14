import { createFileRoute } from '@tanstack/react-router'
import { AsinDetailPage } from '@/features/competitor-analysis/components/asin-detail-page'
import { parseSnapshotSearch } from '@/features/competitor-analysis/search-params'

/**
 * 竞品详情页：`/competitor-analysis/B0XXXXXXXX?analysisId=12`。
 *
 * 与主页面同一套 search 参数解析纪律：`analysisId` 只认正整数，脏值一律忽略
 * （页面会给出"通过卡片进入"的提示，而不是白屏）。
 *
 * ASIN 走**路径参数**而不是 search 参数：它是这个页面唯一的主体，
 * 放在路径里才能被收藏、分享，也能让"上一个/下一个 ASIN"的链接语义自然成立。
 */
export const Route = createFileRoute(
  '/_authenticated/competitor-analysis/$asin'
)({
  staticData: { title: '竞品详情' },
  validateSearch: parseSnapshotSearch,
  component: AsinDetailRoute,
})

/*
 * 同 `index.tsx`：文件里除 `Route` 外还有 URL ↔ props 的桥接组件，
 * react-refresh 的热更提示在此显式豁免（桥接必须持有本文件的 `Route` 才有正确参数类型）。
 */
// eslint-disable-next-line react-refresh/only-export-components
function AsinDetailRoute() {
  const { asin } = Route.useParams()
  const { analysisId } = Route.useSearch()
  return <AsinDetailPage analysisId={analysisId} asin={asin} />
}

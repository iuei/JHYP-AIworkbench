import { createFileRoute } from '@tanstack/react-router'
import { AnalysisResultsPage } from '@/features/competitor-analysis/components/analysis-results-page'
import { parseSnapshotSearch } from '@/features/competitor-analysis/search-params'

/**
 * 分析结果页：`/competitor-analysis/results?analysisId=12`。
 *
 * 用户口径（2026-09-16）：「数据明细应该修改为分析结果，分析页面的分析结果卡片移动到新名称为分析结果页面内，
 * 分析结果页面内包含数据明细」——
 * 于是这一页是**一次分析的全部产出**：结果头卡（判定 + 头条 + 口径）+ 结论与建议 + 全部数据块 + 数据口径声明。
 * 分析页（`/competitor-analysis`）只留「发起分析 + 历史」。
 *
 * 与竞品详情页 `/competitor-analysis/$asin` 并列：都只读同一次分析的快照，
 * 区别是本页**不筛 ASIN**、展示组级结果；详情页只讲其中一个 ASIN。
 * 两页共用同一套 `analysisId` 解析与快照查询键，因此互跳不会多请求一次。
 */
export const Route = createFileRoute(
  '/_authenticated/competitor-analysis/results'
)({
  staticData: { title: '分析结果' },
  validateSearch: parseSnapshotSearch,
  component: AnalysisResultsRoute,
})

/*
 * 同 `index.tsx`：文件里除 `Route` 外还有 URL ↔ props 的桥接组件（react-refresh 热更提示豁免），
 * 页面组件本身不依赖路由，可独立渲染与测试。
 */
// eslint-disable-next-line react-refresh/only-export-components
function AnalysisResultsRoute() {
  const { analysisId } = Route.useSearch()
  return <AnalysisResultsPage analysisId={analysisId} />
}

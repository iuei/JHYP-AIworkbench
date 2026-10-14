import { MarketResearchPanel } from '@/features/product-dev/components/market-research-panel'

/**
 * 市场洞察首期工作台。
 *
 * 页面先承载已经可用的类目检索、市场分析和报告快照能力；报告保存后可在同一页
 * 回看，避免用户在“产品开发”和新的业务入口之间来回寻找同一份结果。
 */
export function MarketInsightsPage() {
  return <MarketResearchPanel />
}

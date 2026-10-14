import type { AnswerBlock } from '@/features/ai-agent/types'

/** 候选阶段（与 `server/product-dev-table.mjs` 的 STAGES 一一对应）。 */
export type CandidateStage = 'candidate' | 'researching' | 'approved' | 'rejected'

/** 候选产品的来源：人工新建或表格导入。 */
export type CandidateSource = 'manual' | 'import'

export interface Candidate {
  id: number
  marketplace: string
  asin: string | null
  product_name: string
  category: string
  target_price: number | null
  stage: CandidateStage
  stageLabel: string
  note: string | null
  /** 选品附加维度，键来自用户表头，值一律字符串 */
  attributes: Record<string, string>
  source: CandidateSource
  created_at: string
  updated_at: string
}

export interface CandidateListResult {
  items: Candidate[]
  total: number
  page: number
  pageSize: number
  /** 阶段枚举由服务端下发：前端自己维护一份副本，改一处忘一处就会让筛选器出现服务端不认的选项 */
  stages: { value: CandidateStage; label: string }[]
  maxCandidates: number
  maxPageSize: number
  maxImportRows: number
}

/** 附加维度在表单里是键值行数组（对象无法直接绑定到受控输入）。 */
export interface AttributeRow {
  key: string
  value: string
}

export interface CandidateFormValues {
  productName: string
  asin: string
  category: string
  targetPrice: string
  marketplace: string
  stage: CandidateStage
  note: string
  attributes: AttributeRow[]
}

export interface ImportIssue {
  line: number
  value: string
  reason: string
}

export interface ImportPreviewRow {
  line: number
  marketplace: string
  asin: string | null
  product_name: string
  category: string
  target_price: number | null
  stage: CandidateStage
  stageLabel: string
  attributes: Record<string, string>
}

export interface ImportCounts {
  added: number
  duplicated: number
  repeated: number
  invalid: number
  emptyRows: number
}

/** 导入预览（`?dryRun=true` 的返回，**未写库**）。 */
export interface ImportPreview {
  dryRun: true
  fileName: string | null
  headerRecognized: boolean
  columns: string[]
  extraColumns: string[]
  maxRows: number
  preview: ImportPreviewRow[]
  counts: ImportCounts
  duplicated: { line: number; label: string }[]
  repeated: { line: number; label: string }[]
  invalid: ImportIssue[]
  priceUnparsed: { line: number; value: string }[]
}

/** 正式导入结果（已写库）。 */
export interface ImportResult {
  dryRun: false
  added: number
  counts: ImportCounts
  duplicated: { line: number; label: string }[]
  repeated: { line: number; label: string }[]
  invalid: ImportIssue[]
  priceUnparsed: { line: number; value: string }[]
}

/** 维度来源：人工录入 vs 我方报表 —— 两者在界面上必须能一眼分辨。 */
export type DimensionSource = 'manual' | 'report'

export type DimensionFormat = 'text' | 'currency' | 'number' | 'percent' | 'stage'

export interface ComparisonDimension {
  key: string
  label: string
  source: DimensionSource
  format: DimensionFormat
}

/** 候选与我方报表指标的关联情况。 */
export type CandidateCoverage = 'ok' | 'no_asin' | 'no_report_data'

export interface ComparisonRow {
  id: number
  name: string
  asin: string | null
  stage: CandidateStage
  coverage: CandidateCoverage
  coverageLabel: string
  emptyReason: string | null
  /** 已按维度 key 摊平：前端不需要再写"固定字段 / 附加字段"的取值分支 */
  values: Record<string, string | number | null>
}

export interface ComparisonResult {
  comparisonId?: number
  createdAt?: string
  marketplace: string
  marketplaceLabel: string
  marketplaceSource: string
  startDate: string
  endDate: string
  windowDays: number
  candidateIds: number[]
  candidateCount: number
  coverage: { withData: number; withoutData: number; note: string }
  dimensions: ComparisonDimension[]
  omittedDimensionCount: number
  rows: ComparisonRow[]
  dataFreshness: { note?: string | null }
  note: string
  conclusionNote: string
}

export interface ComparisonHistoryItem {
  id: number
  title: string
  marketplace: string
  candidateCount: number
  startDate: string
  endDate: string
  createdAt: string
}

export interface ComparisonParams {
  candidateIds: number[]
  windowDays?: number | null
  startDate?: string | null
  endDate?: string | null
}

/* ---------- 市场调研（类目级，与候选池是两件事） ---------- */

/**
 * 一个候选类目（来自卖家精灵 `product_node` 的关键词搜索）。
 *
 * 市场调研的输入是**类目**而不是 ASIN：用户先敲品类词、选中类目，
 * 才谈得上"这个市场值不值得进"（见 `docs/modules/产品开发.md`）。
 */
export interface MarketCategory {
  nodeIdPath: string
  nodeId: number | null
  label: string
  labelEn: string | null
  products: number | null
}

export interface MarketCategoryResult {
  keyword: string
  marketplace: string
  categories: MarketCategory[]
  meta: { calls: number; cacheHits: number; estimatedCalls: number; ttlHours: number }
}

/** 一条市场结论（结构同竞品分析的 findings，但全部来自市场结构，不带 scope）。 */
export interface MarketFinding {
  level: 'high' | 'medium' | 'low' | 'info'
  title: string
  detail: string
  action: string | null
  evidence: string[]
}

export interface MarketAnalysisResult {
  marketplace: string
  nodeIdPath: string
  nodeLabel: string | null
  nodeLabelLocale: string | null
  headline: string
  findings: MarketFinding[]
  findingLevel: MarketFinding['level']
  blocks: AnswerBlock[]
  /** 该市场 TOP 商品 ASIN，供"带到竞品分析做对比" */
  topAsins: string[]
  meta: {
    calls: number
    cacheHits: number
    errors: { dimension: string; asin: string | null; message: string }[]
    ttlHours: number
    estimatedCalls: number
    marketCalls: number
    fetchedAt: string
  }
}

/** 市场报告列表摘要；列表不下发完整 blocks，详情页再读取冻结结果。 */
export interface MarketInsightReportSummary {
  id: number
  marketplace: string
  scopeType: 'category' | 'node' | 'asin'
  scopeKey: string
  scopeLabel: string
  headline: string | null
  fetchedAt: string | null
  createdAt: string
}

/** 已保存的市场报告，result 是保存时的不可变快照。 */
export interface MarketInsightReport extends MarketInsightReportSummary {
  filters: Record<string, unknown>
  result: MarketAnalysisResult
  sourceMeta: Record<string, unknown>
}

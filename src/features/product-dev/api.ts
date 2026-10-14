import { api, rawRequest } from '@/api/client'
import type {
  Candidate,
  CandidateFormValues,
  CandidateListResult,
  CandidateStage,
  ComparisonHistoryItem,
  ComparisonParams,
  ComparisonResult,
  ImportPreview,
  ImportResult,
  MarketAnalysisResult,
  MarketCategoryResult,
  MarketInsightReport,
  MarketInsightReportSummary,
} from './types'

export interface CandidateQuery {
  keyword?: string
  marketplace?: string | null
  stage?: CandidateStage | null
  page?: number
  pageSize?: number
}

export async function fetchCandidates(
  query: CandidateQuery = {}
): Promise<CandidateListResult> {
  const { data } = await api.get<CandidateListResult>(
    '/product-dev/candidates',
    {
      params: {
        ...(query.keyword ? { keyword: query.keyword } : {}),
        ...(query.marketplace ? { marketplace: query.marketplace } : {}),
        ...(query.stage ? { stage: query.stage } : {}),
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
      },
    }
  )
  return data
}

/**
 * 表单值 → 请求体。
 *
 * 附加维度的空键直接丢掉（用户点了"添加一行"但没填名字）。空字符串的价格转 `null`：
 * 服务端的 `parseTargetPrice` 把 `''` 当"清空"，但显式传 `null` 语义更清楚。
 */
function toCandidatePayload(values: CandidateFormValues) {
  const attributes: Record<string, string> = {}
  for (const row of values.attributes) {
    const key = row.key.trim()
    if (!key) continue
    if (!row.value.trim()) continue
    attributes[key] = row.value.trim()
  }
  return {
    productName: values.productName,
    asin: values.asin,
    category: values.category,
    targetPrice: values.targetPrice.trim() === '' ? null : values.targetPrice,
    marketplace: values.marketplace,
    stage: values.stage,
    note: values.note,
    attributes,
  }
}

export async function createCandidate(
  values: CandidateFormValues
): Promise<Candidate> {
  const { data } = await api.post<{ candidate: Candidate }>(
    '/product-dev/candidates',
    toCandidatePayload(values)
  )
  return data.candidate
}

export async function updateCandidate(
  id: number,
  values: CandidateFormValues
): Promise<Candidate> {
  const { data } = await api.patch<{ candidate: Candidate }>(
    `/product-dev/candidates/${id}`,
    toCandidatePayload(values)
  )
  return data.candidate
}

export async function deleteCandidate(id: number): Promise<void> {
  await api.delete(`/product-dev/candidates/${id}`)
}

/**
 * 表格文件导入（CSV / XLSX）。
 *
 * 走 `rawRequest`（裸 fetch）而不是 axios：上传要发原始 body + `X-File-Name` 头，
 * 同时仍复用统一的鉴权头与错误体解析 —— 自己写 `fetch` 会丢掉服务端返回的中文原因
 * （`api/client.ts` 的注释里写明了这个代价）。
 * `dryRun` 为真时只解析、**不写库**。
 */
export async function importCandidateFile({
  file,
  dryRun,
}: {
  file: File
  dryRun: boolean
}): Promise<ImportPreview | ImportResult> {
  const response = await rawRequest(
    `/product-dev/candidates/import?dryRun=${dryRun ? 'true' : 'false'}`,
    {
      method: 'POST',
      body: file,
      headers: { 'X-File-Name': encodeURIComponent(file.name) },
    }
  )
  return (await response.json()) as ImportPreview | ImportResult
}

/** 粘贴文本导入（表格文本或一行一个产品名称 / ASIN）。 */
export async function importCandidateText({
  text,
  dryRun,
}: {
  text: string
  dryRun: boolean
}): Promise<ImportPreview | ImportResult> {
  const { data } = await api.post<ImportPreview | ImportResult>(
    `/product-dev/candidates/import?dryRun=${dryRun ? 'true' : 'false'}`,
    { text }
  )
  return data
}

/** 下载导入模板 CSV。 */
export async function downloadCandidateTemplate(): Promise<void> {
  const response = await rawRequest('/product-dev/candidates/template')
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = '产品开发候选导入模板.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/**
 * 发起对比：服务端装配结果并落库快照。
 *
 * 这里**不做任何口径计算** —— 指标、覆盖率、"无我方数据"的判定全部来自服务端。
 * 前端自己算一遍必然与服务端漂移，而用户看到的是两套数字。
 */
export async function runComparison(
  params: ComparisonParams
): Promise<ComparisonResult> {
  const { data } = await api.post<{ result: ComparisonResult }>(
    '/product-dev/comparisons',
    {
      candidateIds: params.candidateIds,
      ...(params.windowDays ? { windowDays: params.windowDays } : {}),
      ...(params.startDate && params.endDate
        ? { startDate: params.startDate, endDate: params.endDate }
        : {}),
    }
  )
  return data.result
}

export async function fetchComparisonHistory(
  limit = 10
): Promise<ComparisonHistoryItem[]> {
  const { data } = await api.get<{ items: ComparisonHistoryItem[] }>(
    '/product-dev/comparisons',
    { params: { limit } }
  )
  return data.items
}

/** 读取历史快照；记录不存在或不属于当前账号时服务端返回 404。 */
export async function fetchComparisonSnapshot(
  id: number
): Promise<ComparisonResult | null> {
  const { data } = await api.get<{ result: ComparisonResult | null }>(
    `/product-dev/comparisons/${id}`
  )
  return data.result
}

export async function deleteComparison(id: number): Promise<void> {
  await api.delete(`/product-dev/comparisons/${id}`)
}

/* ---------- 市场调研 ---------- */

/** 按关键词搜类目（1 次卖家精灵调用，24h 缓存）。 */
export async function searchMarketCategories(query: {
  keyword: string
  marketplace: string
}): Promise<MarketCategoryResult> {
  const { data } = await api.get<MarketCategoryResult>(
    '/product-dev/market/categories',
    {
      params: { keyword: query.keyword, marketplace: query.marketplace },
    }
  )
  return data
}

/** 类目市场结构分析（固定 2 次卖家精灵调用，缓存与竞品分析共用）。 */
export async function analyzeMarket(params: {
  marketplace: string
  nodeIdPath: string
  nodeLabel?: string | null
  refresh?: boolean
}): Promise<MarketAnalysisResult> {
  const { data } = await api.post<{ result: MarketAnalysisResult }>(
    '/product-dev/market/analyze',
    {
      marketplace: params.marketplace,
      nodeIdPath: params.nodeIdPath,
      ...(params.nodeLabel ? { nodeLabel: params.nodeLabel } : {}),
      ...(params.refresh ? { refresh: true } : {}),
    }
  )
  return data.result
}

export async function fetchMarketInsightReports(
  options: {
    marketplace?: string
    limit?: number
  } = {}
): Promise<{ items: MarketInsightReportSummary[]; total: number }> {
  const { data } = await api.get<{
    items: MarketInsightReportSummary[]
    total: number
  }>('/market-insights/reports', {
    params: {
      ...(options.marketplace ? { marketplace: options.marketplace } : {}),
      limit: options.limit ?? 20,
    },
  })
  return data
}

export async function saveMarketInsightReport(params: {
  marketplace: string
  scopeKey: string
  scopeLabel?: string | null
  filters?: Record<string, unknown>
  result: MarketAnalysisResult
}): Promise<MarketInsightReport> {
  const { data } = await api.post<{ report: MarketInsightReport }>(
    '/market-insights/reports',
    {
      marketplace: params.marketplace,
      scopeType: 'category',
      scopeKey: params.scopeKey,
      scopeLabel:
        params.scopeLabel ??
        params.result.nodeLabelLocale ??
        params.result.nodeLabel ??
        '',
      filters: params.filters ?? {},
      result: params.result,
      sourceMeta: params.result.meta,
      fetchedAt: params.result.meta.fetchedAt,
    }
  )
  return data.report
}

export async function fetchMarketInsightReport(
  id: number
): Promise<MarketInsightReport> {
  const { data } = await api.get<{ report: MarketInsightReport }>(
    `/market-insights/reports/${id}`
  )
  return data.report
}

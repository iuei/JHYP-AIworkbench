import { api } from '@/api/client'
import { isAxiosError } from 'axios'
import type {
  CompetitorAnalysisResult,
  FindingDisposition,
  HistoryItem,
  PublicDimension,
} from './types'

/**
 * 失败请求的中文原因。
 *
 * **优先读服务端 `message`**（校验失败、越权 404 等都带具体原因），读不到才用兜底文案。
 * 放在 api 层是因为三个页面（主页 / 数据明细 / 竞品详情）都要用同一套口径。
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? fallback
  }
  return fallback
}

/** 分析参数（与 `server/competitor-analysis.mjs` 的 `parseCompetitorInput` 对应）。 */
export interface AnalysisParams {
  /** 一个或多个 ASIN，逗号/换行分隔；第一个视为本品。 */
  inputValue: string
  /** 站点代码；不传表示由服务端按数据推导。 */
  marketplace?: string | null
  /** 统计天数（7/30/90/180/365…）；与自定义区间互斥。 */
  windowDays?: number | null
  startDate?: string | null
  endDate?: string | null
  compareWith?: 'previous_period' | 'last_year' | 'none'
  /** 竞品公开数据维度（卖家精灵 MCP，按调用次数计费）。 */
  dimensions?: PublicDimension[]
  /** 强制忽略缓存重新拉取（默认走 24 小时缓存，重复分析同一批 ASIN 不消耗额度）。 */
  refreshPublic?: boolean
}

export async function runCompetitorAnalysis(
  params: AnalysisParams
): Promise<CompetitorAnalysisResult> {
  const payload = {
    inputType: 'ASIN' as const,
    inputValue: params.inputValue,
    ...(params.marketplace ? { marketplace: params.marketplace } : {}),
    ...(params.windowDays ? { windowDays: params.windowDays } : {}),
    ...(params.startDate && params.endDate
      ? { startDate: params.startDate, endDate: params.endDate }
      : {}),
    ...(params.compareWith ? { compareWith: params.compareWith } : {}),
    ...(params.dimensions ? { dimensions: params.dimensions } : {}),
    ...(params.refreshPublic ? { refreshPublic: true } : {}),
  }
  const { data } = await api.post<{ result: CompetitorAnalysisResult }>(
    '/competitor-analyses',
    payload
  )
  return data.result
}

export async function fetchAnalysisHistory(limit = 10): Promise<HistoryItem[]> {
  const { data } = await api.get<{ items: HistoryItem[] }>('/competitor-analyses', {
    params: { limit },
  })
  return data.items
}

/** 读取历史快照；记录不存在或不属于当前账号时服务端返回 404。 */
export async function fetchAnalysisSnapshot(
  id: number
): Promise<CompetitorAnalysisResult | null> {
  const { data } = await api.get<{ result: CompetitorAnalysisResult | null }>(
    `/competitor-analyses/${id}`
  )
  return data.result
}

/**
 * 标记一条结论的处置状态（2026-09-17）。
 *
 * 只允许用户置 `claimed`（我已处理，等下次分析核验）与 `ignored`（不处理，**必须给原因**）；
 * `verified` 只能由服务端在下次分析时判定，`open` 是打回结果 —— 前端传不了。
 */
export async function setFindingDisposition(params: {
  analysisId: number
  code: string
  target: string
  status: 'claimed' | 'ignored'
  note?: string
}): Promise<FindingDisposition> {
  const { data } = await api.put<{ disposition: FindingDisposition }>(
    `/competitor-analyses/${params.analysisId}/findings/disposition`,
    {
      code: params.code,
      target: params.target,
      status: params.status,
      note: params.note ?? '',
    }
  )
  return data.disposition
}

/** 撤销自己的标记（回到待处理）—— 服务端删行，语义是"我什么都没标记过"。 */
export async function clearFindingDisposition(params: {
  analysisId: number
  code: string
  target: string
}): Promise<void> {
  await api.delete(`/competitor-analyses/${params.analysisId}/findings/disposition`, {
    params: { code: params.code, target: params.target },
  })
}

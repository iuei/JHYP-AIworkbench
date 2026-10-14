/**
 * 竞品分析的 URL 参数解析。
 *
 * 放在 feature 侧而不是路由文件里：路由文件只做装配，纯函数才好单测。
 * 所有脏值（手改 URL、负数、小数、非枚举 focus）一律忽略并回落默认行为，不抛错、不白屏。
 */
export type CompetitorAnalysisSearch = {
  /** 打开指定历史分析的快照（首页「需处理 / 最近分析」深链）。 */
  analysisId?: number
  /** `asin`：进场即聚焦 ASIN 输入框（首页「新建分析」深链）。 */
  focus?: 'asin'
}

export function parseCompetitorAnalysisSearch(
  search: Record<string, unknown>
): CompetitorAnalysisSearch {
  const result: CompetitorAnalysisSearch = {}

  const id = toPositiveInt(search.analysisId)
  if (id !== null) result.analysisId = id
  if (search.focus === 'asin') result.focus = 'asin'

  return result
}

/** 只接受正整数：0、负数、小数、空串与非数字字符串一律视为"没有这个参数"。 */
function toPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}

/**
 * 「读某一次分析快照」的页面共用的 URL 参数。
 *
 * 用到它的页面（2026-09-16 起）：竞品详情页 `/competitor-analysis/$asin`、
 * 分析结果页 `/competitor-analysis/results`。两页的数据都来自**那一次分析的结果快照**
 * （服务端按 id 读，越权 404），所以这条链接离开记录 id 就没有意义 ——
 * 少了它页面提示"从结果卡进入"，不去猜"最近一条"。
 */
export type SnapshotSearch = {
  /** 要展示的分析记录 id。 */
  analysisId?: number
}

export function parseSnapshotSearch(
  search: Record<string, unknown>
): SnapshotSearch {
  const id = toPositiveInt(search.analysisId)
  return id === null ? {} : { analysisId: id }
}

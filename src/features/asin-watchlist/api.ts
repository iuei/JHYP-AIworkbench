/**
 * 「我的 ASIN」数据访问层。
 *
 * 组件不直接调用 axios：统一走这里，便于集中处理服务端返回的中文错误原因。
 */
import { api, rawRequest } from '@/api/client'
import type {
  ImportOutcome,
  ManualMetricInput,
  MetricsQuery,
  MyAsinItem,
  MyAsinMetricsResult,
  MyAsinTableImportResult,
} from './types'

export interface MyAsinListResult {
  items: MyAsinItem[]
  /** 单账号条目上限（由服务端下发，避免前端再写一份会漂移的常量）。 */
  maxItems: number
  marketplaces: string[]
}

export interface AddMyAsinsPayload {
  /** 批量粘贴：纯 ASIN 文本，或从 Excel 复制的一片区域（表格感知）。 */
  asins?: string
  /** 单条弹窗：结构化字段。 */
  items?: Array<{
    asin: string
    marketplace?: string
    alias?: string | null
    note?: string | null
  }>
  /** 表格里没写站点时的落点。 */
  defaultMarketplace?: string
  /**
   * 新增时**顺带录入**的人工指标（与 `period` 成对使用，仅单条新增生效）。
   * 与条目在同一次请求里写完 —— 分两步会在列表刷新时把弹窗卸载，第二步的回调就丢了。
   */
  metrics?: ManualMetricInput
  period?: { startDate: string; endDate: string }
}

export interface AddMyAsinsResult extends ImportOutcome {
  table: boolean
  columns: string[]
  mapping: Record<string, number | null>
  invalidRows: Array<{ line: number; value: string }>
  repeatedRows: Array<{ line: number; asin: string; firstLine: number }>
  /** 随条目一起写入的人工指标（没传 `metrics` 时为 null） */
  override?: ManualMetricInput | null
  /** 条目建好了但人工指标没保存成功时的原因（如实回报，不静默） */
  manualError?: string | null
}

export async function fetchMyAsins(): Promise<MyAsinListResult> {
  const { data } = await api.get<MyAsinListResult>('/ai/my-asins')
  return data
}

/**
 * 新增 ASIN（单条与批量共用一条接口）。
 *
 * 单条走 `items`（结构化，字段明确），批量走 `asins`（文本/表格文本）——
 * 两者在服务端共用同一套解析与四分类口径。
 */
export async function addMyAsins(
  payload: AddMyAsinsPayload
): Promise<AddMyAsinsResult> {
  const { data } = await api.post<AddMyAsinsResult>(
    '/ai/my-asins/items',
    payload
  )
  return data
}

/**
 * 从表格文件导入（CSV / XLSX）。
 *
 * `dryRun: true` 只让服务端解析一遍并回报"会新增什么"，**不写库** ——
 * 表格里的列识别对不对、有多少行读不出来，都应该在导入前让人看到。
 * 上传走"原始 body + `X-File-Name` 头"（与数据源导入同一套约定，不引入 multipart）。
 */
export async function importMyAsinTable(
  file: File,
  {
    dryRun = false,
    defaultMarketplace,
  }: { dryRun?: boolean; defaultMarketplace?: string } = {}
): Promise<MyAsinTableImportResult> {
  const params = new URLSearchParams()
  if (dryRun) params.set('dryRun', 'true')
  if (defaultMarketplace) params.set('defaultMarketplace', defaultMarketplace)
  const query = params.toString()

  const response = await rawRequest(
    `/ai/my-asins/import${query ? `?${query}` : ''}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent(file.name),
      },
      body: await file.arrayBuffer(),
    }
  )
  return (await response.json()) as MyAsinTableImportResult
}

/**
 * 导入模板：真 `.xlsx`（表头 ASIN / 站点 / 别名 / 备注，由服务端生成）。
 *
 * 表头即约定，模板保证用户填出来的表格一定能被解析 —— 这是"批量导入"最省事也最稳的路径。
 */
export async function fetchMyAsinTemplate(): Promise<Blob> {
  const response = await rawRequest('/ai/my-asins/template')
  return response.blob()
}

/**
 * 指标（页面数据表的唯一数据源）。
 *
 * 与 AI 工具共用服务端 `myAsinMetricsPayload`：页面里的数字与对话里问出来的完全一致。
 * 只提交区间，不做任何数字加工；**跨站点没有合计**，金额一律看 `groups`。
 */
export async function fetchMyAsinMetrics(
  query: MetricsQuery
): Promise<MyAsinMetricsResult> {
  const { data } = await api.get<MyAsinMetricsResult>('/ai/my-asins/metrics', {
    params: query,
  })
  return data
}

export async function updateMyAsinItem(
  itemId: number,
  patch: {
    asin?: string
    alias?: string | null
    note?: string | null
    marketplace?: string
  }
): Promise<MyAsinItem> {
  const { data } = await api.patch<{ item: MyAsinItem }>(
    `/ai/my-asins/items/${itemId}`,
    patch
  )
  return data.item
}

export async function removeMyAsinItem(itemId: number): Promise<void> {
  await api.delete(`/ai/my-asins/items/${itemId}`)
}

/** 批量移除的结果：成功的条数 + 失败条目的 id（失败绝不能静默当成成功）。 */
export interface BulkRemoveResult {
  removed: number
  failedIds: number[]
}

/**
 * 批量移除。
 *
 * 服务端只有单条 DELETE，这里按小批量（每批 8 个）并发 —— 一次发几百个请求会把
 * 连接池排满，而串行发几百次又要等几十秒。分批是这两者之间唯一合理的落点。
 * 任何一批里失败的条目都会被如实回报，不静默吞掉。
 */
export async function removeMyAsinItems(
  itemIds: number[]
): Promise<BulkRemoveResult> {
  const BATCH_SIZE = 8
  const failedIds: number[] = []
  let removed = 0

  for (let start = 0; start < itemIds.length; start += BATCH_SIZE) {
    const batch = itemIds.slice(start, start + BATCH_SIZE)
    const settled = await Promise.allSettled(
      batch.map((itemId) => removeMyAsinItem(itemId))
    )
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') removed += 1
      else failedIds.push(batch[index])
    })
  }

  return { removed, failedIds }
}

/**
 * 录入 / 更新某条 ASIN 在某个区间的人工指标（2026-09-18）。
 *
 * 区间用**服务端实际采用的起止日期**（页面上选「近 30 天」时，先读回 period 再提交），
 * 保证"录入的区间"与"页面看到的区间"是同一个 —— 否则人工值永远匹配不上。
 *
 * 6 个数字全部留空 = 清除该区间的人工值（回到报表口径）。
 */
export async function saveMyAsinMetricOverride(
  itemId: number,
  payload: { startDate: string; endDate: string } & ManualMetricInput
): Promise<{ override: ManualMetricInput | null }> {
  const { data } = await api.put<{ override: ManualMetricInput | null }>(
    `/ai/my-asins/items/${itemId}/metrics`,
    payload
  )
  return data
}

/** 清除某条 ASIN 在某个区间的人工指标。 */
export async function removeMyAsinMetricOverride(
  itemId: number,
  period: { startDate: string; endDate: string }
): Promise<{ removed: boolean }> {
  const { data } = await api.delete<{ removed: boolean }>(
    `/ai/my-asins/items/${itemId}/metrics`,
    { params: period }
  )
  return data
}

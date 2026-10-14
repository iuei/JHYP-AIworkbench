/**
 * 「我的 ASIN」的 React Query 封装。
 *
 * 失效策略：任何写操作都让 `['my-asins']` 整体失效 —— 列表与指标共用这个前缀，
 * 避免出现"加了 ASIN、指标还是旧的"这类不一致。
 */
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  addMyAsins,
  fetchMyAsinMetrics,
  fetchMyAsins,
  fetchMyAsinTemplate,
  importMyAsinTable,
  removeMyAsinItem,
  removeMyAsinItems,
  removeMyAsinMetricOverride,
  saveMyAsinMetricOverride,
  updateMyAsinItem,
  type AddMyAsinsPayload,
} from './api'
import type { ManualMetricInput, MetricsQuery } from './types'

export const myAsinKeys = {
  all: ['my-asins'] as const,
  list: () => ['my-asins', 'list'] as const,
  /**
   * 指标按区间缓存。
   *
   * `query` 是对象，React Query 会做稳定序列化，所以 `{ windowDays: 30 }` 与
   * `{ windowDays: 30 }` 命中同一个 key —— 用户在 7 天 / 30 天之间来回切换时不再重复请求。
   */
  metrics: (query: MetricsQuery) => ['my-asins', 'metrics', query] as const,
}

export function useMyAsins() {
  return useQuery({
    queryKey: myAsinKeys.list(),
    queryFn: fetchMyAsins,
  })
}

/**
 * 指标（区间相关）。
 *
 * `placeholderData: keepPreviousData` 不是可选项：切换 7 天 / 30 天时若让表格先回到
 * 空态再长出数字，整张表会闪一下（5000 行时尤其明显）；而"上一区间的数字"比"空白"
 * 更接近用户此刻要对比的对象。数字区会同时给出加载指示，不会让人误以为已经刷新。
 *
 * `enabled` 用于"自定义区间只选了一半"这种中间态：此时**不发请求**，
 * 而不是拿一个默认区间去查 —— 后者会让界面显示"自定义区间"、数字却是 30 天的。
 */
export function useMyAsinMetrics(
  query: MetricsQuery,
  { enabled = true }: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: myAsinKeys.metrics(query),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: () => fetchMyAsinMetrics(query),
  })
}

function useInvalidateMyAsins() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: myAsinKeys.all })
}

export function useAddMyAsins() {
  const invalidate = useInvalidateMyAsins()
  return useMutation({
    mutationFn: (payload: AddMyAsinsPayload) => addMyAsins(payload),
    onSuccess: () => invalidate(),
  })
}

/**
 * 表格导入（两阶段）。
 *
 * `dryRun: true` 是预览：解析结果只用于展示，**不失效缓存**（库里什么都没变）；
 * 正式导入成功才触发失效，避免预览就把列表刷成"正在重新拉取"。
 */
export function useImportMyAsinTable() {
  const invalidate = useInvalidateMyAsins()
  return useMutation({
    mutationFn: ({
      file,
      dryRun = false,
      defaultMarketplace,
    }: {
      file: File
      dryRun?: boolean
      defaultMarketplace?: string
    }) => importMyAsinTable(file, { dryRun, defaultMarketplace }),
    onSuccess: (_result, variables) => {
      if (!variables.dryRun) invalidate()
    },
  })
}

/** 模板下载：拿到 Blob 后由组件落盘（`.xlsx`）。 */
export function useMyAsinTemplate() {
  return useMutation({ mutationFn: () => fetchMyAsinTemplate() })
}

export function useUpdateMyAsinItem() {
  const invalidate = useInvalidateMyAsins()
  return useMutation({
    mutationFn: ({
      itemId,
      ...patch
    }: {
      itemId: number
      asin?: string
      alias?: string | null
      note?: string | null
      marketplace?: string
    }) => updateMyAsinItem(itemId, patch),
    onSuccess: () => invalidate(),
  })
}

export function useRemoveMyAsinItem() {
  const invalidate = useInvalidateMyAsins()
  return useMutation({
    mutationFn: (itemId: number) => removeMyAsinItem(itemId),
    onSuccess: () => invalidate(),
  })
}

/** 批量移除：一次失效即可（逐条失效会把列表刷成连续重拉）。 */
export function useRemoveMyAsinItems() {
  const invalidate = useInvalidateMyAsins()
  return useMutation({
    mutationFn: (itemIds: number[]) => removeMyAsinItems(itemIds),
    onSuccess: () => invalidate(),
  })
}

/**
 * 录入人工指标。
 *
 * 失效整个 `['my-asins']`：指标行（含 `manual` 标记）与汇总都必须跟着变，
 * 只失效某一处会出现"数字变了、合计没变"。
 */
export function useSaveMyAsinMetricOverride() {
  const invalidate = useInvalidateMyAsins()
  return useMutation({
    mutationFn: ({
      itemId,
      ...payload
    }: { itemId: number; startDate: string; endDate: string } & ManualMetricInput) =>
      saveMyAsinMetricOverride(itemId, payload),
    onSuccess: () => invalidate(),
  })
}

/** 清除人工指标（回到报表口径）。 */
export function useRemoveMyAsinMetricOverride() {
  const invalidate = useInvalidateMyAsins()
  return useMutation({
    mutationFn: ({
      itemId,
      ...period
    }: { itemId: number; startDate: string; endDate: string }) =>
      removeMyAsinMetricOverride(itemId, period),
    onSuccess: () => invalidate(),
  })
}

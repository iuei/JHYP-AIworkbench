import { isAxiosError } from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type {
  Announcement,
  AnnouncementInput,
  AnnouncementListResult,
  AnnouncementStatus,
  PendingAnnouncement,
} from './types'

export type AnnouncementListFilters = {
  status: AnnouncementStatus | 'all'
  keyword: string
  page: number
  pageSize: number
}

export const announcementKeys = {
  all: ['announcements'] as const,
  list: (filters: AnnouncementListFilters) =>
    ['announcements', 'list', filters] as const,
  pending: ['announcements', 'pending'] as const,
}

/**
 * 服务端非 2xx 一律返回 `{ message: '中文原因' }`（见 server/index.mjs 的统一错误出口）。
 * 统一从这里取，页面不各自解析错误对象 —— 否则用户只会看到"操作失败"，
 * 而真正的原因（标题为空、不是管理员、公告已被别人删掉）全被丢掉。
 */
export function announcementErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? fallback
  }
  return fallback
}

export function useAnnouncementList(filters: AnnouncementListFilters) {
  return useQuery<AnnouncementListResult>({
    queryKey: announcementKeys.list(filters),
    queryFn: async () =>
      (
        await api.get('/announcements', {
          params: {
            status: filters.status,
            keyword: filters.keyword.trim() || undefined,
            page: filters.page,
            pageSize: filters.pageSize,
          },
        })
      ).data,
    // 上一页的数据留在屏幕上（`placeholderData`）而不是闪一下骨架：翻页是高频操作。
    placeholderData: (previous) => previous,
  })
}

export function useCreateAnnouncement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: AnnouncementInput) =>
      (await api.post<Announcement>('/announcements', input)).data,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: announcementKeys.all }),
  })
}

export function useUpdateAnnouncement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: number
      input: AnnouncementInput
    }) => (await api.patch<Announcement>(`/announcements/${id}`, input)).data,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: announcementKeys.all }),
  })
}

export function useSetAnnouncementStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: number
      status: AnnouncementStatus
    }) =>
      (await api.post<Announcement>(`/announcements/${id}/status`, { status }))
        .data,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: announcementKeys.all }),
  })
}

export function useDeleteAnnouncement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => api.delete(`/announcements/${id}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: announcementKeys.all }),
  })
}

/**
 * 当前用户这次进入系统应弹的公告。
 *
 * 参数是 `auth.loginAt`（内存态，登录成功那一刻写入）：
 * - `enabled: loginAt > 0` —— 刷新页面、站内跳转时为 0，**一次都不请求**；
 * - `queryKey` 里带上 `loginAt` —— 同一次页面会话内登出再登录时 key 会变，
 *   否则会命中上一次登录的缓存，结果是"新公告看不到、已确认的旧公告又弹一遍"。
 *
 * `retry: false` 是刻意的：这个查询只在登录那一刻触发一次，
 * 失败（401、后端没起）时再重试三次，只会让弹窗在用户已经进入工作状态后突然跳出来。
 * 弹公告失败不该影响任何主流程，静默放弃即可。
 */
export function usePendingAnnouncements(loginAt: number) {
  return useQuery<PendingAnnouncement[]>({
    queryKey: [...announcementKeys.pending, loginAt],
    enabled: loginAt > 0,
    retry: false,
    /*
      这条查询的结果是"**这次登录**要弹什么"，是一次性的快照，不是实时数据：
      - `staleTime: Infinity` + 关闭聚焦重取：生产环境默认会在窗口重新获得焦点时重取，
        届时应弹列表被重新计算（用户已经关掉但没点确定的公告会回到队首、弹窗凭空再出现一次）；
      - 服务端已读记录只影响**下一次登录**，本次队列由前端本地推进。
    */
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async () =>
      (
        await api.get<{ items: PendingAnnouncement[] }>(
          '/announcements/pending'
        )
      ).data.items,
  })
}

/**
 * 确认已读。
 *
 * **不 invalidate**：`pending` 查询的结果是"这次登录要弹什么"，用户刚点完确定就被失效重拉，
 * 队列会被服务端的最新结果覆盖（`once` 的公告消失、`every_login` 的又回来），弹窗会闪。
 * 队列只由前端本地推进，服务端记录只影响**下一次登录**。
 */
export function useAcknowledgeAnnouncement() {
  return useMutation({
    mutationFn: async (id: number) => api.post(`/announcements/${id}/ack`),
    /*
      重试一次（写已读是幂等的，重复请求不会产生副作用）。
      代价对比很不对称：一次网络抖动丢掉"已确认"记录，用户下次登录会被同一条公告再打扰一次，
      而这正是他刚刚反馈过的问题；重试的成本只是一次多余的 204。
    */
    retry: 1,
  })
}

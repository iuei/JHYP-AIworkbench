import type { PendingAnnouncement } from './types'

/**
 * 公告弹窗的**判定逻辑**（纯函数，可单测）。
 *
 * 需求是「每次用户登录时弹出，或只弹一次、确定后就不再弹出」。这句话里其实有两个不同的问题，
 * 分界必须清楚，否则很容易做错：
 *
 * 1. **什么算"一次登录"**：`auth.loginAt` 只在登录成功那一刻写入、且只存在于内存，
 *    刷新页面即归零。所以"刷新不再弹、重新登录才弹"不需要任何额外状态就成立。
 * 2. **同一次登录内不要重复弹**：用户关掉的公告要记在本地（本文件的 `DismissState`）。
 *    它**不等于**服务端的已读记录 —— 按 Esc 关掉只是"这次先不看"，服务端那边不算数。
 * 3. **下次登录还弹不弹**：由服务端 `isPendingForUser` 按账号判断，这里是拿不到也不需要判断的。
 */

export type DismissState = {
  /** 该状态属于哪一次登录（对应 `auth.loginAt`）。 */
  loginAt: number
  dismissedIds: number[]
}

export const EMPTY_DISMISS_STATE: DismissState = { loginAt: 0, dismissedIds: [] }

/**
 * 当前登录批次内已经关闭过的公告 id。
 *
 * `loginAt` 变了（= 又登录了一次）就返回空：上一位使用者关掉几条，不该影响这一次的弹窗 ——
 * 这正是"每次登录都弹"的公告能再次出现的原因。
 */
export function dismissedIdsForLogin(
  state: DismissState,
  loginAt: number
): number[] {
  return state.loginAt === loginAt ? state.dismissedIds : []
}

/**
 * 还要弹的公告。
 *
 * **保持服务端给的顺序**（优先级 → 发布时间），前端不重排：排序口径只能有一处，
 * 两处各排一次迟早会出现"列表里看到的顺序和弹出来不一样"。
 */
export function visibleAnnouncements(
  items: PendingAnnouncement[],
  dismissedIds: number[]
): PendingAnnouncement[] {
  if (!items.length) return []
  return items.filter((item) => !dismissedIds.includes(item.id))
}

/** 关闭一条公告（推进队列）。重复关闭同一条是幂等的。 */
export function dismissAnnouncement(
  state: DismissState,
  loginAt: number,
  id: number
): DismissState {
  const dismissedIds = dismissedIdsForLogin(state, loginAt)
  if (dismissedIds.includes(id)) return { loginAt, dismissedIds }
  return { loginAt, dismissedIds: [...dismissedIds, id] }
}

/**
 * 关闭当前弹窗时要上报哪条公告的已读（没有当前公告则 null）。
 *
 * **任何关闭方式都算已读** —— 点「我知道了」、点右上角 ✕、按 Esc、点遮罩，一视同仁。
 *
 * 为什么（2026-09-16 实测缺陷修复，勿回退）：早期实现只把「我知道了」当确认，
 * ✕ / Esc / 遮罩关掉不写已读记录。实测复现的后果是 —— 用户用 ✕ 关掉「只弹一次」的公告后，
 * **下次登录它又弹**，用户看到的就是"关掉了还一直弹"（线上库中也确实留下了这一现象：
 * 公告有已读记录，但仍被反复弹出）。
 *
 * 判据是"弹窗是模态阻塞的"：用户必须先处理掉它才能继续用系统，关掉这个动作本身就代表
 * "我已经处理过了"。至于"关掉后想再看怎么办"——需要反复强调的内容应该用
 * **「每次登录都弹」**，而不是指望用户去点某个按钮。
 */
export function ackIdForDismiss(
  announcement: PendingAnnouncement | undefined
): number | null {
  return announcement ? announcement.id : null
}

/**
 * 公告的时间处理（纯函数）。
 *
 * 「生效时间 / 失效时间」用原生 `<input type="datetime-local">`，它只认
 * `YYYY-MM-DDTHH:mm` 这种**本地时间**串。最容易踩的坑是拿 `toISOString().slice(0, 16)` 去填：
 * 那是 UTC，东八区下输入框会显示成 8 小时前，管理员"把时间调回来 8 小时"改一次就再错一次。
 * 因此本地格式化必须手写（`getFullYear` 等取的就是本地字段），提交时再转成 ISO UTC。
 *
 * 这两个方向互为一对，除此之外**不要**在别处再写一遍时间串转换。
 */

function pad(value: number) {
  return String(value).padStart(2, '0')
}

/** ISO（或任何 Date 可解析的字符串）→ `datetime-local` 需要的本地时间串；空值/非法值给空串。 */
export function toDateTimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** `datetime-local` 的本地时间串 → 提交给服务端的 ISO UTC；空串表示"不限制"。 */
export function fromDateTimeLocalValue(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** 展示用的本地时间；空值统一给 `—`（与表格规范一致，不写整句）。 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, { hour12: false })
}

export type ScheduleState = 'scheduled' | 'active' | 'expired'

/**
 * 公告当前的生效状态。
 *
 * 为什么列表要显示它：公告到点才弹、过点就停，管理员看到"已发布但没人反馈"时，
 * 第一件要确认的事就是"它到底生效了没有"。以前只能自己去比对两个时间。
 */
export function scheduleState(
  publishAt: string | null,
  expireAt: string | null,
  now: number = Date.now()
): ScheduleState {
  const start = publishAt ? new Date(publishAt).getTime() : null
  const end = expireAt ? new Date(expireAt).getTime() : null
  if (start !== null && !Number.isNaN(start) && start > now) return 'scheduled'
  if (end !== null && !Number.isNaN(end) && end <= now) return 'expired'
  return 'active'
}

/** 列表里的生效期文案：一句话说清"什么时候开始、什么时候停"。 */
export function describeSchedule(
  publishAt: string | null,
  expireAt: string | null
): string {
  if (!publishAt && !expireAt) return '立即生效 · 长期有效'
  if (publishAt && !expireAt) return `${formatDateTime(publishAt)} 起 · 长期有效`
  if (!publishAt && expireAt) return `立即生效 · ${formatDateTime(expireAt)} 截止`
  return `${formatDateTime(publishAt)} 起 · ${formatDateTime(expireAt)} 截止`
}

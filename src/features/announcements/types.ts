/** 公告的三种状态：草稿只对管理员可见，已归档是"曾经发过、只留痕"。 */
export type AnnouncementStatus = 'draft' | 'published' | 'archived'

/**
 * 弹出方式 —— 需求里的核心开关：
 * - `once`：只弹一次，用户点「我知道了」后不再弹（服务端按账号记已读）；
 * - `every_login`：每次登录进入系统都弹（已读记录只用于管理员统计）。
 */
export type AnnouncementDisplayMode = 'once' | 'every_login'

export type Announcement = {
  id: number
  title: string
  body: string
  status: AnnouncementStatus
  displayMode: AnnouncementDisplayMode
  /** 数值越大越先弹；同一批待弹公告按它排序。 */
  priority: number
  publishAt: string | null
  expireAt: string | null
  publishedAt: string | null
  /** 点过「我知道了」的人数（「只弹一次」看它就是已读率，其余是触达人次）。 */
  readCount: number
  createdAt: string
  updatedAt: string
}

/** 员工侧只拿到展示需要的字段，不暴露状态、优先级、已读人数这些管理信息。 */
export type PendingAnnouncement = {
  id: number
  title: string
  body: string
  displayMode: AnnouncementDisplayMode
  publishedAt: string | null
}

export type AnnouncementInput = {
  title: string
  body: string
  displayMode: AnnouncementDisplayMode
  priority: number
  publishAt: string | null
  expireAt: string | null
}

export type AnnouncementListResult = {
  items: Announcement[]
  total: number
  page: number
  pageSize: number
}

export const ANNOUNCEMENT_STATUS_LABELS: Record<AnnouncementStatus, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
}

export const DISPLAY_MODE_LABELS: Record<AnnouncementDisplayMode, string> = {
  once: '只弹一次',
  every_login: '每次登录都弹',
}

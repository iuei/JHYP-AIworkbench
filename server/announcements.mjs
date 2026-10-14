/**
 * 公告领域层（校验 + 查询 + 已读）。
 *
 * 与 `user-management.mjs` 同构：**校验是纯函数**（可在没有数据库的环境下单测），
 * SQL 只负责取数与写入。之所以把校验抽出来，是因为"公告标题空着也能发布"
 * 这类问题必须在服务端拦住 —— 前端表单校验只是体验，直接调接口就能绕过。
 *
 * 弹出策略的**唯一判定入口**是 `isPendingForUser`：
 * 「只弹一次」与「每次登录都弹」的差别只有这一行，其他任何地方都不应再写一遍这个 if，
 * 否则服务端过滤、前端队列、验收脚本三处口径迟早会分叉。
 */
import { query } from './db.mjs'

export const ANNOUNCEMENT_STATUSES = ['draft', 'published', 'archived']
export const DISPLAY_MODES = ['once', 'every_login']

export const MAX_TITLE_LENGTH = 120
export const MAX_BODY_LENGTH = 20000
export const MAX_PRIORITY = 100
export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

export class AnnouncementValidationError extends Error {}

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 生效 / 失效时间：空值表示"不限制"，非法值必须报错而不是静默当作不限。
 *
 * 静默回退的代价很具体：管理员填了 `2026-13-45` 本想定时发布，结果公告**立刻全量弹给所有人**，
 * 而且没有任何提示。这里明确 400，由管理员改对为止。
 */
export function parseAnnouncementSchedule(value, label) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') {
    throw new AnnouncementValidationError(`${label}格式无效。`)
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new AnnouncementValidationError(`${label}格式无效。`)
  }
  return date.toISOString()
}

/** 新建 / 编辑公告的统一入参校验（两个接口共用，避免规则分叉）。 */
export function parseAnnouncementInput(input) {
  const title = asTrimmedString(input?.title)
  const body = typeof input?.body === 'string' ? input.body.trim() : ''
  const displayMode = input?.displayMode ?? 'once'
  const priority = Number(input?.priority ?? 0)
  const publishAt = parseAnnouncementSchedule(input?.publishAt, '生效时间')
  const expireAt = parseAnnouncementSchedule(input?.expireAt, '失效时间')

  if (!title) throw new AnnouncementValidationError('请填写公告标题。')
  if (title.length > MAX_TITLE_LENGTH) {
    throw new AnnouncementValidationError(
      `公告标题不能超过 ${MAX_TITLE_LENGTH} 个字符。`
    )
  }
  if (!body) throw new AnnouncementValidationError('请填写公告内容。')
  if (body.length > MAX_BODY_LENGTH) {
    throw new AnnouncementValidationError(
      `公告内容不能超过 ${MAX_BODY_LENGTH} 个字符。`
    )
  }
  if (!DISPLAY_MODES.includes(displayMode)) {
    throw new AnnouncementValidationError('弹出方式无效。')
  }
  if (
    !Number.isInteger(priority) ||
    priority < -MAX_PRIORITY ||
    priority > MAX_PRIORITY
  ) {
    throw new AnnouncementValidationError(
      `优先级需为 -${MAX_PRIORITY} 到 ${MAX_PRIORITY} 之间的整数。`
    )
  }
  const start = publishAt ? new Date(publishAt).getTime() : null
  const end = expireAt ? new Date(expireAt).getTime() : null
  if (start !== null && end !== null && end <= start) {
    throw new AnnouncementValidationError('失效时间必须晚于生效时间。')
  }

  return { title, body, displayMode, priority, publishAt, expireAt }
}

export function parseAnnouncementStatus(value) {
  if (!ANNOUNCEMENT_STATUSES.includes(value)) {
    throw new AnnouncementValidationError('公告状态无效。')
  }
  return value
}

/**
 * 这条公告**对这个用户**现在还要不要弹？
 *
 * - `every_login`：忽略已读记录，每次登录都弹（`readAt` 仍会被写下来，供管理员看已读人数）；
 * - `once`：点过确定就不再弹。
 *
 * 有效期不在这里判断：它由 SQL 用数据库的 `NOW()` 过滤，避免应用进程与数据库时区/时钟不一致时
 * 出现"服务端以为还没生效、数据库以为已经生效"的双口径。
 */
export function isPendingForUser({ displayMode, readAt }) {
  if (displayMode === 'every_login') return true
  return !readAt
}

function serializeAnnouncement(row) {
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    displayMode: row.display_mode,
    priority: row.priority,
    publishAt: row.publish_at,
    expireAt: row.expire_at,
    publishedAt: row.published_at,
    readCount: row.read_count === undefined ? 0 : Number(row.read_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const ADMIN_SELECT = `
  SELECT a.id, a.title, a.body, a.status, a.display_mode, a.priority,
         a.publish_at, a.expire_at, a.published_at, a.created_at, a.updated_at,
         (SELECT COUNT(*) FROM announcement_reads r WHERE r.announcement_id = a.id) AS read_count
    FROM announcements a
`

function adminFilters({ status = null, keyword = null }) {
  const conditions = ['a.deleted_at IS NULL']
  const params = []
  if (status) {
    params.push(status)
    conditions.push(`a.status = $${params.length}`)
  }
  const trimmedKeyword = asTrimmedString(keyword)
  if (trimmedKeyword) {
    params.push(`%${trimmedKeyword}%`)
    conditions.push(
      `(a.title ILIKE $${params.length} OR a.body ILIKE $${params.length})`
    )
  }
  return { where: `WHERE ${conditions.join(' AND ')}`, params }
}

/** 管理员列表：含草稿与归档，带已读人数与分页。 */
export async function listAnnouncements({
  status = null,
  keyword = null,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
} = {}) {
  const size = Math.min(Math.max(Number(pageSize) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
  const current = Math.max(Number(page) || 1, 1)
  const { where, params } = adminFilters({ status, keyword })

  const totalResult = await query(
    `SELECT COUNT(*)::int AS total FROM announcements a ${where}`,
    params
  )
  const { rows } = await query(
    `${ADMIN_SELECT} ${where}
     ORDER BY (a.status = 'published') DESC, a.priority DESC, a.updated_at DESC, a.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, size, (current - 1) * size]
  )

  return {
    items: rows.map(serializeAnnouncement),
    total: totalResult.rows[0]?.total ?? 0,
    page: current,
    pageSize: size,
  }
}

export async function findAnnouncement(id) {
  const { rows } = await query(`${ADMIN_SELECT} WHERE a.id = $1 AND a.deleted_at IS NULL`, [id])
  return serializeAnnouncement(rows[0])
}

export async function createAnnouncement(input, actorId) {
  const { rows } = await query(
    `INSERT INTO announcements
       (title, body, display_mode, priority, publish_at, expire_at, created_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     RETURNING id`,
    [
      input.title,
      input.body,
      input.displayMode,
      input.priority,
      input.publishAt,
      input.expireAt,
      actorId ?? null,
    ]
  )
  return findAnnouncement(rows[0].id)
}

export async function updateAnnouncement(id, input) {
  const { rows } = await query(
    `UPDATE announcements
        SET title = $2, body = $3, display_mode = $4, priority = $5,
            publish_at = $6, expire_at = $7, updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id`,
    [
      id,
      input.title,
      input.body,
      input.displayMode,
      input.priority,
      input.publishAt,
      input.expireAt,
    ]
  )
  if (!rows.length) return null
  return findAnnouncement(rows[0].id)
}

/**
 * 状态流转：草稿 ⇄ 已发布 → 已归档。
 *
 * `published_at` / `published_by` 只在**首次**发布时写入（`COALESCE` 保留旧值）：
 * 「下线 → 改文案 → 再上线」时保留最初的发布时间，员工侧看到的仍是这条公告的首次发布时刻，
 * 而不是管理员最后一次手抖的时间。
 *
 * 已读记录不随下线清空：`once` 公告下线再上线，此前点过确定的人不会再被弹一次 ——
 * 那是"同一条公告"，重复打扰比"少弹一次"更糟。
 *
 * **`$2::text` 的显式转型不能去掉**：同一个参数既出现在 `status = $2`（varchar 列）
 * 又出现在 `CASE WHEN $2 = 'published'`，PostgreSQL 会为这两个位置各自推断类型并报
 * `inconsistent types deduced for parameter $2`（实测 500）。统一成 text 后赋值给 varchar 列
 * 是允许的隐式转换。
 */
export async function setAnnouncementStatus(id, status, actorId) {
  const { rows } = await query(
    `UPDATE announcements
        SET status = $2::text,
            published_at = CASE WHEN $2::text = 'published' THEN COALESCE(published_at, NOW()) ELSE published_at END,
            published_by = CASE WHEN $2::text = 'published' THEN COALESCE(published_by, $3::int) ELSE published_by END,
            updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING id`,
    [id, status, actorId ?? null]
  )
  if (!rows.length) return null
  return findAnnouncement(rows[0].id)
}

export async function softDeleteAnnouncement(id) {
  const { rowCount } = await query(
    'UPDATE announcements SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
    [id]
  )
  return rowCount > 0
}

/**
 * 当前用户**这次进入系统**应该弹的公告。
 *
 * 过滤分两段，边界很清楚：
 * 1. SQL 只做"客观条件"——已发布、未删除、在有效期内，并用数据库的 `NOW()` 判时间；
 * 2. 应用层用 `isPendingForUser` 做"跟人有关"的判断——该用户点过确定没有。
 *
 * 排序由服务端定：优先级高的在前，其次按发布时间倒序。前端只按数组顺序排队展示，
 * 不再自己排一次（两处排序必然分叉）。
 */
export async function listPendingAnnouncements(userId) {
  const { rows } = await query(
    `SELECT a.id, a.title, a.body, a.display_mode, a.priority, a.published_at, r.read_at
       FROM announcements a
       LEFT JOIN announcement_reads r
              ON r.announcement_id = a.id AND r.user_id = $1
      WHERE a.status = 'published'
        AND a.deleted_at IS NULL
        AND (a.publish_at IS NULL OR a.publish_at <= NOW())
        AND (a.expire_at IS NULL OR a.expire_at > NOW())
      ORDER BY a.priority DESC, a.published_at DESC NULLS LAST, a.id DESC`,
    [userId]
  )

  return rows
    .filter((row) =>
      isPendingForUser({ displayMode: row.display_mode, readAt: row.read_at })
    )
    .map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      displayMode: row.display_mode,
      publishedAt: row.published_at,
    }))
}

/**
 * 记录"这个用户确认看过这条公告"。
 *
 * 只接受**已发布且未删除**的公告：草稿的 id 被猜中也没有任何可写的语义，
 * 直接 404 比写一行无法解释的已读记录干净。
 */
export async function acknowledgeAnnouncement(userId, announcementId) {
  const { rows } = await query(
    `INSERT INTO announcement_reads (announcement_id, user_id)
     SELECT a.id, $2
       FROM announcements a
      WHERE a.id = $1 AND a.status = 'published' AND a.deleted_at IS NULL
        AND (a.publish_at IS NULL OR a.publish_at <= NOW())
        AND (a.expire_at IS NULL OR a.expire_at > NOW())
     ON CONFLICT (announcement_id, user_id) DO NOTHING
     RETURNING announcement_id`,
    [announcementId, userId]
  )
  return rows.length > 0
}

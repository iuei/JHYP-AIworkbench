/**
 * 公告路由：挂载 /api/announcements/*。
 *
 * 两类使用者的边界很硬：
 * - **员工侧只有两条接口**（`GET /pending`、`POST /:id/ack`）——都是"我自己的"数据：
 *   待弹公告只按 `req.user.id` 查，已读只写自己那一行，员工之间互不可见、也无法伪造他人已读；
 * - **其余全部是管理员接口**，逐个挂 `requireAdmin`（与 `/api/users` 同款，非管理员 403）。
 *
 * 路由注册顺序有个坑：`/pending` 必须写在 `/:id` 系列**之前**。Express 是按注册顺序匹配的，
 * 顺序写反时 `GET /pending` 会先命中 `/:id`（`id = 'pending'`）并返回 400「公告 ID 不合法」——
 * 该问题在 ASIN 清单的 `template` 路由上真实发生过一次。
 */
import express from 'express'
import { AUDIT_ACTIONS, recordAudit } from './ai-agent/audit.mjs'
import { clientIp } from './ai-agent/http-utils.mjs'
import {
  ANNOUNCEMENT_STATUSES,
  acknowledgeAnnouncement,
  AnnouncementValidationError,
  createAnnouncement,
  DEFAULT_PAGE_SIZE,
  findAnnouncement,
  listAnnouncements,
  listPendingAnnouncements,
  parseAnnouncementInput,
  parseAnnouncementStatus,
  setAnnouncementStatus,
  softDeleteAnnouncement,
  updateAnnouncement,
} from './announcements.mjs'

function parseResourceId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

export function createAnnouncementRouter({ requireUser, requireAdmin }) {
  const router = express.Router()

  router.use(requireUser)

  // ---- 员工侧 --------------------------------------------------------------

  /** 本次进入系统应弹给当前用户的公告（已按策略与已读在服务端过滤）。 */
  router.get('/pending', async (req, res, next) => {
    try {
      const items = await listPendingAnnouncements(req.user.id)
      res.json({ items })
    } catch (error) {
      next(error)
    }
  })

  /**
   * 确认已读。
   *
   * 先查一次公告再写：只有"已发布且未删除"的公告才有可写的语义，
   * 草稿的 id 被猜中时应当 404，而不是留下一行解释不通的已读记录。
   * 重复调用（前端重试、双开页面）由主键冲突兜住，照样返回 204。
   */
  router.post('/:id/ack', async (req, res, next) => {
    const id = parseResourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '公告 ID 不合法。' })
    try {
      const announcement = await findAnnouncement(id)
      const now = Date.now()
      const notStarted = announcement?.publishAt && new Date(announcement.publishAt).getTime() > now
      const expired = announcement?.expireAt && new Date(announcement.expireAt).getTime() <= now
      if (!announcement || announcement.status !== 'published' || notStarted || expired) {
        return res.status(404).json({ message: '公告不存在或已下线。' })
      }
      await acknowledgeAnnouncement(req.user.id, id)
      return res.status(204).end()
    } catch (error) {
      return next(error)
    }
  })

  // ---- 管理员侧 ------------------------------------------------------------

  router.get('/', requireAdmin, async (req, res, next) => {
    try {
      const status = req.query.status ?? ''
      if (status && status !== 'all' && !ANNOUNCEMENT_STATUSES.includes(status)) {
        return res.status(400).json({ message: '公告状态无效。' })
      }
      const pageSize = Number(req.query.pageSize ?? DEFAULT_PAGE_SIZE)
      if (!Number.isFinite(pageSize) || pageSize <= 0) {
        return res.status(400).json({ message: '每页条数无效。' })
      }
      const data = await listAnnouncements({
        status: status && status !== 'all' ? status : null,
        keyword: typeof req.query.keyword === 'string' ? req.query.keyword : null,
        page: Number(req.query.page ?? 1),
        pageSize,
      })
      return res.json(data)
    } catch (error) {
      return next(error)
    }
  })

  router.post('/', requireAdmin, async (req, res, next) => {
    let input
    try {
      input = parseAnnouncementInput(req.body)
    } catch (error) {
      if (error instanceof AnnouncementValidationError) {
        return res.status(400).json({ message: error.message })
      }
      return next(error)
    }
    try {
      const created = await createAnnouncement(input, req.user.id)
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.announcementCreate,
        targetType: 'announcement',
        targetId: created.id,
        detail: {
          title: created.title,
          displayMode: created.displayMode,
          priority: created.priority,
          publishAt: created.publishAt,
          expireAt: created.expireAt,
        },
        ip: clientIp(req),
      })
      return res.status(201).json(created)
    } catch (error) {
      return next(error)
    }
  })

  router.patch('/:id', requireAdmin, async (req, res, next) => {
    const id = parseResourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '公告 ID 不合法。' })
    let input
    try {
      input = parseAnnouncementInput(req.body)
    } catch (error) {
      if (error instanceof AnnouncementValidationError) {
        return res.status(400).json({ message: error.message })
      }
      return next(error)
    }
    try {
      const updated = await updateAnnouncement(id, input)
      if (!updated) return res.status(404).json({ message: '公告不存在。' })
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.announcementUpdate,
        targetType: 'announcement',
        targetId: updated.id,
        // 已发布公告的文案改动会立刻影响所有员工下次登录看到的弹窗，必须有痕可查。
        detail: {
          title: updated.title,
          status: updated.status,
          displayMode: updated.displayMode,
        },
        ip: clientIp(req),
      })
      return res.json(updated)
    } catch (error) {
      return next(error)
    }
  })

  router.post('/:id/status', requireAdmin, async (req, res, next) => {
    const id = parseResourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '公告 ID 不合法。' })
    let status
    try {
      status = parseAnnouncementStatus(req.body?.status)
    } catch (error) {
      if (error instanceof AnnouncementValidationError) {
        return res.status(400).json({ message: error.message })
      }
      return next(error)
    }
    try {
      const updated = await setAnnouncementStatus(id, status, req.user.id)
      if (!updated) return res.status(404).json({ message: '公告不存在。' })
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.announcementPublish,
        targetType: 'announcement',
        targetId: updated.id,
        detail: { title: updated.title, status },
        ip: clientIp(req),
      })
      return res.json(updated)
    } catch (error) {
      return next(error)
    }
  })

  router.delete('/:id', requireAdmin, async (req, res, next) => {
    const id = parseResourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '公告 ID 不合法。' })
    try {
      const announcement = await findAnnouncement(id)
      if (!announcement) return res.status(404).json({ message: '公告不存在。' })
      await softDeleteAnnouncement(id)
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.announcementDelete,
        targetType: 'announcement',
        targetId: id,
        detail: { title: announcement.title, status: announcement.status },
        ip: clientIp(req),
      })
      return res.status(204).end()
    } catch (error) {
      return next(error)
    }
  })

  return router
}

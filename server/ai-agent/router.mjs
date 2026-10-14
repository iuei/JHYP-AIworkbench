/**
 * AI 助手模块路由入口：挂载 /api/ai/*。
 *
 * 鉴权设计：
 * 1. 全部接口先过 requireUser（复用既有 JWT 中间件）；
 * 2. 再过 identityGuard——需求文档 §6.7 要求"所有接口服务端实时校验角色，不信任前端"，
 *    因此每个请求都回源查一次 users，用库里的 role/status 覆盖 JWT 里的旧值
 *    （管理员刚被降权时，旧 token 也无法继续越权）；
 * 3. 管理类接口再过 adminGuard——这里**不复用** server/index.mjs 的 requireAdmin，
 *    因为需求文档 §6.7 还要求"非管理员一律 403 **并写审计**"，
 *    而 requireAdmin 直接返回 403，没有插入审计写入的位置。
 */
import express from 'express'
import { createAuditRouter } from './audit-routes.mjs'
import { recordAudit } from './audit.mjs'
import { createChatRouter } from './chat.mjs'
import { createDatasourceRouter } from './datasource-routes.mjs'
import { clientIp } from './http-utils.mjs'
import { createKnowledgeRouter } from './knowledge-routes.mjs'
import { createNotesRouter } from './notes-routes.mjs'
import { createPromptLibraryRouter } from './prompt-library-routes.mjs'
import { createMyAsinRouter } from './my-asin-routes.mjs'
import { isEnabledAdmin } from './permissions.mjs'
import { createTodoRouter } from './todo-routes.mjs'
import { query } from '../db.mjs'

export function createIdentityGuard() {
  return async (req, res, next) => {
    try {
      const { rows } = await query(
        'SELECT id, login, role, status, token_version FROM users WHERE id = $1',
        [req.user?.id]
      )
      const row = rows[0]
      if (!row || row.status !== 'enabled') {
        return res.status(401).json({ message: '账号已停用或不存在。' })
      }
      // 与 server/index.mjs 的 requireUser 保持同一口径：改密码后旧 token 立即失效。
      // AI 路由挂在独立 router 上、不共用 requireUser，漏了这一句旧 token 仍能访问 /api/ai/*。
      if (Number(req.user?.ver ?? 0) !== Number(row.token_version ?? 0)) {
        return res.status(401).json({ message: '密码已变更，请重新登录。' })
      }
      req.user = { ...req.user, id: row.id, login: row.login, role: row.role, status: row.status }
      return next()
    } catch (error) {
      return next(error)
    }
  }
}

export function createAdminGuard() {
  return async (req, res, next) => {
    if (isEnabledAdmin(req.user)) return next()
    try {
      await recordAudit({
        actorId: req.user?.id ?? null,
        action: 'forbidden',
        targetType: 'api',
        targetId: String(req.originalUrl ?? '').slice(0, 80),
        detail: { method: req.method, reason: 'not_admin' },
        ip: clientIp(req),
      })
    } catch {
      // 审计写入失败不把 403 变成 500，但要留痕到服务端日志
      process.stderr.write('[ai-agent] 403 审计写入失败\n')
    }
    return res.status(403).json({ message: '仅管理员可执行此操作。' })
  }
}

export function createAiAgentRouter({ requireUser }) {
  const router = express.Router()
  const identityGuard = createIdentityGuard()
  const adminGuard = createAdminGuard()

  router.use(requireUser)
  router.use(identityGuard)
  router.use(createChatRouter())
  router.use(createKnowledgeRouter({ adminGuard }))
  router.use(createDatasourceRouter({ adminGuard }))
  router.use(createNotesRouter({ adminGuard }))
  router.use(createPromptLibraryRouter({ adminGuard }))
  router.use(createMyAsinRouter())
  router.use(createAuditRouter({ adminGuard }))
  router.use(createTodoRouter({ adminGuard }))

  return router
}

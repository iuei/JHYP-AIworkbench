import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, query } from './db.mjs'
import { runUserMigrations } from './user-migrations.mjs'
import { runCompetitorMigrations } from './competitor-migrations.mjs'
import { defaultDashboardShortcutIds } from './dashboard-shortcuts.mjs'
import {
  analyzeCompetitor,
  CompetitorInputError,
  getCompetitorAnalysis,
  listCompetitorAnalyses,
  recordCompetitorAnalysis,
  toHistoryItem,
} from './competitor-analysis.mjs'
import {
  attachDispositions,
  clearDisposition,
  collectFindingKeys,
  listDispositions,
  setDisposition,
  USER_SETTABLE_STATUSES,
  verifyDispositions,
} from './finding-dispositions.mjs'
import { runAiAgentMigrations } from './ai-agent/migrations.mjs'
import { createAiAgentRouter } from './ai-agent/router.mjs'
import { createAnnouncementRouter } from './announcement-routes.mjs'
import { runAnnouncementMigrations } from './announcement-migrations.mjs'
import { createProductDevRouter } from './product-dev-routes.mjs'
import { runProductDevMigrations } from './product-dev-migrations.mjs'
import { createMarketInsightRouter } from './market-insight-routes.mjs'
import { runMarketInsightMigrations } from './market-insight-migrations.mjs'
import { AUDIT_ACTIONS, recordAudit } from './ai-agent/audit.mjs'
import { clientIp } from './ai-agent/http-utils.mjs'
import {
  describeUserDeletionBlock,
  isEnabledAdmin,
  isEnabledUser,
  isLastEnabledAdminDemotion,
  isLastEnabledAdminRemoval,
  parseUserCreate,
  parseUserRegister,
  parseUserStatusUpdate,
  parseUserUpdate,
  PENDING_USER_STATUS,
  UserUpdateValidationError,
} from './user-management.mjs'

dotenv.config()
const app = express()
const port = Number(process.env.API_PORT ?? 8787)
const secret = process.env.JWT_SECRET
const corsOrigin = process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:5173', 'http://127.0.0.1:5173']
if (!secret) throw new Error('JWT_SECRET 未配置')
app.use(cors({ origin: corsOrigin }))
app.use(express.json())
/**
 * 签发 JWT。
 *
 * `ver` 是账号的令牌版本号（`users.token_version`）：改密码时该字段 +1，
 * 此前签发的所有 token 会在下一次请求回源比对时立即失效。
 */
const sign = (user) => jwt.sign(
  { id: user.id, login: user.login, role: user.role, ver: Number(user.token_version ?? 0) },
  secret,
  { expiresIn: '8h' }
)
async function requireUser(req, res, next) {
  let claims
  try {
    claims = jwt.verify(
      req.headers.authorization?.replace('Bearer ', ''),
      secret
    )
  } catch {
    return res.status(401).json({ message: '登录已失效，请重新登录。' })
  }
  try {
    const { rows } = await query(
      'SELECT id, login, role, status, token_version FROM users WHERE id = $1',
      [claims.id]
    )
    if (!isEnabledUser(rows[0])) {
      return res.status(401).json({ message: '账号已停用或不存在。' })
    }
    // 令牌版本比对：改密码后旧 token 立即失效。
    // 旧 token 没有 ver 声明时按 0 处理，与库里的初始值一致，因此不会把所有在线用户踢下线。
    if (Number(claims.ver ?? 0) !== Number(rows[0].token_version ?? 0)) {
      return res.status(401).json({ message: '密码已变更，请重新登录。' })
    }
    // status 一并下发：AI 助手模块的权限判定（permissions.mjs）依赖它，
    // 且这里已经实时校验过账号启用状态，下发的值即当前真实状态。
    req.user = { ...claims, login: rows[0].login, role: rows[0].role, status: rows[0].status }
    return next()
  } catch (error) {
    return next(error)
  }
}
async function requireAdmin(req, res, next) {
  try {
    const { rows } = await query(
      'SELECT role, status FROM users WHERE id = $1',
      [req.user?.id]
    )
    if (!isEnabledAdmin(rows[0])) {
      return res.status(403).json({ message: '仅管理员可执行此操作。' })
    }
    next()
  } catch (error) {
    next(error)
  }
}

async function hasCurrentAdminAccess(client, userId) {
  const { rows } = await client.query(
    'SELECT role, status FROM users WHERE id = $1',
    [userId]
  )
  return isEnabledAdmin(rows[0])
}

function resourceId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * 注册接口的简易频率限制（进程内存计数）。
 *
 * 为什么必须有：`/api/auth/register` 是本项目唯一的「未登录可写」接口。没有它，
 * 任何人都能用脚本每分钟灌进成千上万条 pending 账号，把 users 表与审计表刷爆
 * （服务端目前没有任何其他限流设施，为一个注册接口专门引入 Redis 不划算）。
 *
 * 已知限制：只对**单进程**生效。将来若多实例部署，必须换成共享存储（如 Redis），
 * 否则各实例各算各的窗口，限流等于没做。
 */
const REGISTER_WINDOW_MS = 60_000
const REGISTER_MAX_PER_WINDOW = 3
const registerAttempts = new Map()

function registerRateLimitExceeded(ip) {
  const now = Date.now()
  const key = ip || 'unknown'
  const hits = (registerAttempts.get(key) ?? []).filter(
    (at) => now - at < REGISTER_WINDOW_MS
  )

  if (hits.length >= REGISTER_MAX_PER_WINDOW) {
    registerAttempts.set(key, hits)
    return true
  }

  hits.push(now)
  registerAttempts.set(key, hits)

  // 顺手清理整窗已过期的 IP，避免 Map 随扫描来源数量无限增长
  if (registerAttempts.size > 1000) {
    for (const [staleKey, times] of registerAttempts) {
      if (times.every((at) => now - at >= REGISTER_WINDOW_MS)) {
        registerAttempts.delete(staleKey)
      }
    }
  }

  return false
}

/**
 * 自助注册（公开接口，无需登录）。
 *
 * 落库即 `pending`：注册者**拿不到 token**，必须在管理员于「用户管理」页放行后才能登录。
 * role 固定 operator、department 留空 —— 注册者不能自选角色（那是一条自助提权路径），
 * 部门属于管理信息，由管理员审核时补填。
 */
app.post('/api/auth/register', async (req, res, next) => {
  const ip = clientIp(req)
  if (registerRateLimitExceeded(ip)) {
    return res.status(429).json({ message: '提交过于频繁，请稍后再试。' })
  }

  let input
  try {
    input = parseUserRegister(req.body)
  } catch (error) {
    if (error instanceof UserUpdateValidationError) {
      return res.status(400).json({ message: error.message })
    }
    return next(error)
  }

  try {
    const hash = await bcrypt.hash(input.password, 12)
    const { rows } = await query(
      "INSERT INTO users (login, name, password_hash, role, status, department) VALUES ($1,$2,$3,'operator',$4,'') RETURNING id, login, name, status",
      [input.login, input.name, hash, PENDING_USER_STATUS]
    )
    // 申请入库必须留痕：这是「谁在什么时候申请了什么账号」的唯一记录（detail 绝不记密码）。
    await recordAudit({
      actorId: null,
      action: AUDIT_ACTIONS.userRegister,
      targetType: 'user',
      targetId: rows[0].id,
      detail: { login: rows[0].login, name: rows[0].name, status: rows[0].status },
      ip,
    })
    return res.status(201).json({ message: '注册申请已提交，请等待管理员审核。' })
  } catch (error) {
    // 账号唯一约束：与管理员开通同口径返回 409，而不是 500
    if (error?.code === '23505') return res.status(409).json({ message: '该账号已存在。' })
    return next(error)
  }
})

app.post('/api/auth/login', async (req, res, next) => {
  const { login, password } = req.body ?? {}

  // 空密码一律拒绝，且必须在查库前拦下。
  // 历史实现把缺失的 password 当作空串去和哈希比对（bcrypt.compare('', hash)），
  // 只要库里存在空密码的哈希（重置密码接口此前允许把密码置空），任何人就能未认证登录。
  if (typeof password !== 'string' || password.length === 0 || typeof login !== 'string' || !login.trim()) {
    await recordAudit({
      action: AUDIT_ACTIONS.login,
      targetType: 'user',
      detail: { login: String(login ?? '').slice(0, 120), result: 'failed', reason: 'empty_credentials' },
      ip: clientIp(req),
    }).catch(() => {})
    return res.status(401).json({ message: '账号或密码错误。' })
  }

  try {
    const { rows } = await query('SELECT * FROM users WHERE login = $1', [login.trim()])
    const user = rows[0]
    const passwordOk = user ? await bcrypt.compare(password, user.password_hash) : false

    if (!user || !passwordOk) {
      // 登录失败也留痕：这是暴力尝试与异常时间登录的唯一回溯依据。detail 只记账号，绝不记密码。
      await recordAudit({
        actorId: user?.id ?? null,
        action: AUDIT_ACTIONS.login,
        targetType: 'user',
        targetId: user?.id ?? null,
        detail: {
          login: login.trim().slice(0, 120),
          result: 'failed',
          reason: !user ? 'unknown_account' : 'bad_password',
        },
        ip: clientIp(req),
      })
      return res.status(401).json({ message: '账号或密码错误。' })
    }

    /*
     * 账号状态在**密码校验通过之后**才区分，这是刻意的：
     * 注册接口会用 409 告诉调用方「某账号已存在」，因此对已经输对密码的人如实说明状态
     * 不会新增账号枚举面；反之若密码错误时也回「等待审核 / 已停用」，不用密码就能白拿账号状态。
     */
    if (user.status === PENDING_USER_STATUS) {
      await recordAudit({
        actorId: user.id,
        action: AUDIT_ACTIONS.login,
        targetType: 'user',
        targetId: user.id,
        detail: { login: user.login, result: 'failed', reason: 'pending_account' },
        ip: clientIp(req),
      })
      return res.status(401).json({ message: '账号正在等待管理员审核，通过后即可登录。' })
    }

    if (user.status !== 'enabled') {
      await recordAudit({
        actorId: user.id,
        action: AUDIT_ACTIONS.login,
        targetType: 'user',
        targetId: user.id,
        detail: { login: user.login, result: 'failed', reason: 'disabled_account' },
        ip: clientIp(req),
      })
      return res.status(401).json({ message: '账号已被停用，请联系管理员。' })
    }

    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id])
    await recordAudit({
      actorId: user.id,
      action: AUDIT_ACTIONS.login,
      targetType: 'user',
      targetId: user.id,
      detail: { login: user.login, grant: user.role, result: 'success' },
      ip: clientIp(req),
    })
    return res.json({ token: sign(user), user: { id: user.id, accountNo: user.login, email: user.login, name: user.name, department: user.department, role: [user.role], exp: Date.now() + 8 * 3600_000 } })
  } catch (error) {
    return next(error)
  }
})
// 用户信息由管理员在「用户管理」维护，前端 /settings 只读展示，因此这里只读下发、不接受写入。
app.get('/api/auth/me', requireUser, async (req, res) => { const { rows } = await query('SELECT id, login, name, role, department FROM users WHERE id = $1', [req.user.id]); res.json(rows[0]) })
app.get('/api/users', requireUser, requireAdmin, async (_req, res) => { const { rows } = await query('SELECT id, login, name, role, department, status, created_at, last_login_at FROM users ORDER BY created_at DESC'); res.json(rows) })
app.post('/api/users', requireUser, requireAdmin, async (req, res, next) => {
  let input
  try { input = parseUserCreate(req.body) } catch (error) {
    if (error instanceof UserUpdateValidationError) return res.status(400).json({ message: error.message })
    return next(error)
  }
  try {
    const hash = await bcrypt.hash(input.password, 12)
    const { rows } = await query(
      'INSERT INTO users (login, name, password_hash, role, department) VALUES ($1,$2,$3,$4,$5) RETURNING id, login, name, role, department, status, created_at',
      [input.login, input.name, hash, input.role, input.department]
    )
    // 新建账号可以指定 role=admin —— 这是提权路径，必须留痕（detail 绝不记密码）。
    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.userCreate,
      targetType: 'user',
      targetId: rows[0].id,
      detail: { login: rows[0].login, role: rows[0].role, department: rows[0].department ?? null },
      ip: clientIp(req),
    })
    return res.status(201).json(rows[0])
  } catch (error) {
    // 账号唯一约束：返回 409 而不是 500（同一文件里导航接口已有这个映射范例）
    if (error?.code === '23505') return res.status(409).json({ message: '该账号已存在。' })
    return next(error)
  }
})
app.patch('/api/users/:id', requireUser, requireAdmin, async (req, res, next) => {
  let update
  try { update = parseUserUpdate(req.body) } catch (error) {
    if (error instanceof UserUpdateValidationError) return res.status(400).json({ message: error.message })
    return next(error)
  }
  // 参数先校验再进 SQL：把 'abc' 直接传进 `WHERE id = $1` 会让 PG 抛 22P02 变成 500，
  // 而这是典型的客户端错误，应当是 400（同文件的导航接口早就是这么处理的）。
  const targetId = resourceId(req.params.id)
  if (!targetId) return res.status(400).json({ message: '用户 ID 不合法。' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      "SELECT id FROM users WHERE role = 'admin' AND status = 'enabled' FOR UPDATE"
    )
    if (!(await hasCurrentAdminAccess(client, req.user.id))) {
      await client.query('ROLLBACK')
      return res.status(403).json({ message: '仅管理员可执行此操作。' })
    }
    const targetResult = await client.query(
      'SELECT id, role, status FROM users WHERE id = $1 FOR UPDATE',
      [targetId]
    )
    const target = targetResult.rows[0]
    if (!target) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '用户不存在。' })
    }
    if (target.id === req.user.id && update.role !== target.role) {
      await client.query('ROLLBACK')
      return res.status(409).json({ message: '不能修改自己的角色。' })
    }
    const adminCountResult = await client.query(
      "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND status = 'enabled' AND id <> $1",
      [target.id]
    )
    if (
      isLastEnabledAdminDemotion({
        currentRole: target.role,
        currentStatus: target.status,
        nextRole: update.role,
        otherEnabledAdminCount: adminCountResult.rows[0].count,
      })
    ) {
      await client.query('ROLLBACK')
      return res
        .status(409)
        .json({ message: '必须至少保留一个已启用的管理员。' })
    }
    // department 为 null 时保留原值：未携带该字段的调用方不会把已有部门清空。
    const { rows } = await client.query(
      'UPDATE users SET name = $1, role = $2, department = COALESCE($3, department) WHERE id = $4 RETURNING id, login, name, role, department, status, created_at, last_login_at',
      [update.name, update.role, update.department, target.id]
    )
    // 改角色是提权路径（user → admin）。审计写在事务内：与账号变更同生共死，不会出现"改了没记"。
    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.userUpdate,
      targetType: 'user',
      targetId: target.id,
      detail: { login: rows[0].login, roleFrom: target.role, roleTo: rows[0].role },
      ip: clientIp(req),
      client,
    })
    await client.query('COMMIT')
    return res.json(rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }
})
app.patch('/api/users/:id/status', requireUser, requireAdmin, async (req, res, next) => {
  let nextStatus
  try {
    nextStatus = parseUserStatusUpdate(req.body)
  } catch (error) {
    if (error instanceof UserUpdateValidationError) {
      return res.status(400).json({ message: error.message })
    }
    return next(error)
  }
  // 同 PATCH /api/users/:id：非法 id 必须是 400，而不是让 PG 抛错变成 500
  const targetId = resourceId(req.params.id)
  if (!targetId) return res.status(400).json({ message: '用户 ID 不合法。' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      "SELECT id FROM users WHERE role = 'admin' AND status = 'enabled' FOR UPDATE"
    )
    if (!(await hasCurrentAdminAccess(client, req.user.id))) {
      await client.query('ROLLBACK')
      return res.status(403).json({ message: '仅管理员可执行此操作。' })
    }
    const targetResult = await client.query(
      'SELECT id, role, status FROM users WHERE id = $1 FOR UPDATE',
      [targetId]
    )
    const target = targetResult.rows[0]
    if (!target) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '用户不存在。' })
    }
    if (target.id === req.user.id && nextStatus !== target.status) {
      await client.query('ROLLBACK')
      return res.status(409).json({ message: '不能修改自己的账号状态。' })
    }
    const adminCountResult = await client.query(
      "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND status = 'enabled' AND id <> $1",
      [target.id]
    )
    if (
      isLastEnabledAdminRemoval({
        currentRole: target.role,
        currentStatus: target.status,
        nextRole: target.role,
        nextStatus,
        otherEnabledAdminCount: adminCountResult.rows[0].count,
      })
    ) {
      await client.query('ROLLBACK')
      return res
        .status(409)
        .json({ message: '必须至少保留一个已启用的管理员。' })
    }
    const { rows } = await client.query(
      'UPDATE users SET status = $1 WHERE id = $2 RETURNING id, status',
      [nextStatus, target.id]
    )
    // 停用/启用他人账号直接影响其访问能力（停用会立刻让旧 JWT 失效），必须留痕。
    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.userStatus,
      targetType: 'user',
      targetId: target.id,
      detail: { statusFrom: target.status, statusTo: rows[0].status },
      ip: clientIp(req),
      client,
    })
    await client.query('COMMIT')
    return res.json(rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }
})
app.post('/api/users/:id/reset-password', requireUser, requireAdmin, async (req, res, next) => {
  // 服务端必须自己校验密码长度：前端校验是纯客户端的，直接调 API 即可绕过。
  // 历史实现允许把密码置空（bcrypt.hash('')），配合登录侧的"缺失密码当空串"就是一条
  // 「未认证者接管任意账号」的路径。
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ message: '密码长度需为 8-128 位。' })
  }
  const id = resourceId(req.params.id)
  if (!id) return res.status(400).json({ message: '用户 ID 不合法。' })

  try {
    const { rows } = await query(
      // token_version + 1：让该账号此前签发的所有 JWT 立即失效 —— 改密码必须真的把攻击者踢下线
      'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING id, login',
      [await bcrypt.hash(password, 12), id]
    )
    if (rows.length === 0) return res.status(404).json({ message: '账号不存在。' })

    // 重置他人密码是一条提权路径，必须留痕（谁、在什么时候、对谁做的）。
    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.userResetPassword,
      targetType: 'user',
      targetId: rows[0].id,
      detail: { login: rows[0].login },
      ip: clientIp(req),
    })
    return res.status(204).end()
  } catch (error) {
    return next(error)
  }
})
/**
 * 删除账号（DELETE /api/users/:id）。
 *
 * **不可逆**：users 行删除后，外键按既有语义级联 —— 该账号的业务数据
 * （AI 会话与消息、经验沉淀、我的 ASIN、竞品分析、公告已读、快捷偏好、工作任务）
 * 是 ON DELETE CASCADE，一并清掉；审计与「创建人 / 审核人」类字段是 ON DELETE SET NULL，
 * 记录保留但操作人置空。因此这里的三道闸一个都不能少：
 *   1. 仅管理员（requireAdmin + 事务内 hasCurrentAdminAccess，防"刚被降级的人还在删"）；
 *   2. 不能删自己；
 *   3. 必须至少保留一个已启用的管理员。
 * 后两条与改角色 / 停用共用 `describeUserDeletionBlock`（纯函数、有单测）。
 *
 * 审计写在同一个事务里，且**落 detail 身份信息**：`ai_audit_logs.actor_id` 对 users 是
 * SET NULL，被删者自己的历史记录会失去操作人；只有这次删除的 detail 里记下 login / role，
 * 事后才回答得了"删的是谁"（只留一个 target_id 是没有意义的，那行已经不存在了）。
 */
app.delete('/api/users/:id', requireUser, requireAdmin, async (req, res, next) => {
  // 同 PATCH：非法 id 必须先判成 400，不能让 PG 抛 22P02 变成 500
  const targetId = resourceId(req.params.id)
  if (!targetId) return res.status(400).json({ message: '用户 ID 不合法。' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // 与改角色 / 改状态同一把锁：先锁住启用中的管理员集合，
    // 否则两个管理员并发互删时，双方都能读到"还有一个管理员"而各删各的。
    await client.query(
      "SELECT id FROM users WHERE role = 'admin' AND status = 'enabled' FOR UPDATE"
    )
    if (!(await hasCurrentAdminAccess(client, req.user.id))) {
      await client.query('ROLLBACK')
      return res.status(403).json({ message: '仅管理员可执行此操作。' })
    }
    const targetResult = await client.query(
      'SELECT id, login, role, status, department, last_login_at FROM users WHERE id = $1 FOR UPDATE',
      [targetId]
    )
    const target = targetResult.rows[0]
    if (!target) {
      await client.query('ROLLBACK')
      return res.status(404).json({ message: '用户不存在。' })
    }
    const adminCountResult = await client.query(
      "SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND status = 'enabled' AND id <> $1",
      [target.id]
    )
    const blockedReason = describeUserDeletionBlock({
      actorId: req.user.id,
      targetId: target.id,
      targetRole: target.role,
      targetStatus: target.status,
      otherEnabledAdminCount: adminCountResult.rows[0].count,
    })
    if (blockedReason) {
      await client.query('ROLLBACK')
      return res.status(409).json({ message: blockedReason })
    }
    await recordAudit({
      actorId: req.user.id,
      action: AUDIT_ACTIONS.userDelete,
      targetType: 'user',
      targetId: target.id,
      detail: {
        login: target.login,
        role: target.role,
        status: target.status,
        department: target.department || null,
        lastLoginAt: target.last_login_at ?? null,
      },
      ip: clientIp(req),
      client,
    })
    await client.query('DELETE FROM users WHERE id = $1', [target.id])
    await client.query('COMMIT')
    return res.status(204).end()
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }
})
app.get('/api/dashboard', requireUser, async (req, res) => { const work = await query('SELECT id,module,title,progress,route,updated_at FROM work_items WHERE user_id=$1 AND progress < 100 ORDER BY updated_at DESC', [req.user.id]); const pref = await query('SELECT shortcut_ids FROM shortcut_preferences WHERE user_id=$1', [req.user.id]); const analyses = await query('SELECT id,input_type,input_value,created_at FROM competitor_analyses WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5', [req.user.id]); res.json({ workItems: work.rows, shortcutIds: pref.rows[0]?.shortcut_ids ?? defaultDashboardShortcutIds, analyses: analyses.rows }) })
app.put('/api/dashboard/shortcuts', requireUser, async (req, res) => { await query('INSERT INTO shortcut_preferences (user_id, shortcut_ids) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET shortcut_ids=EXCLUDED.shortcut_ids,updated_at=NOW()', [req.user.id, JSON.stringify(req.body.shortcutIds)]); res.status(204).end() })
/**
 * 竞品分析：一组 ASIN（第一个为「本品」）在同一站点、同一区间的真实广告与销售表现对比。
 *
 * 改动原因：历史实现返回与输入无关的写死结论（无论输入什么都得到同一组
 * 「portable blender / 电池续航不足」），并顺带往 work_items 写一条 progress=65 的假任务
 * —— 那条任务永远不会完成、也没有任何入口能清除它，首页「正在进行的工作」因此长期挂着假数据。
 * 现在数字全部来自数据集与 analytics 的确定性计算，也不再写假进度。
 *
 * 本轮扩展：多 ASIN 横向对比、站点/区间/对比基线可选、确定性结论、库存联动，
 * 并把结果快照一起落库以支持历史回看。
 */
app.post('/api/competitor-analyses', requireUser, async (req, res, next) => {
  try {
    // req.body 可能为 undefined（缺 Content-Type 时），先兜底再校验，避免 TypeError。
    const analysis = await analyzeCompetitor(req.body ?? {})
    // 快照落库：历史回看看到的是「当时的结论」，而不是用今天的数据重算出来的另一套数字
    const record = await recordCompetitorAnalysis({ userId: req.user.id, result: analysis })
    /*
     * 处置核验必须落在"分析已经落库"之后：用户上次标记的「我已处理」在这里被判定
     * —— 该结论不再命中 → 已核验解决；仍然命中 → 打回待处理并在界面上说明原因。
     * 顺序不能反：核验结果要跟着 `attachDispositions` 一起返回给前端。
     */
    await verifyDispositions({ userId: req.user.id, analysisId: record.id, result: analysis })
    const result = await attachDispositions(req.user.id, {
      ...analysis,
      analysisId: record.id,
      createdAt: record.created_at,
    })
    res.json({ record, result })
  } catch (error) {
    if (error instanceof CompetitorInputError) {
      return res.status(400).json({ message: error.message })
    }
    return next(error)
  }
})

/** 历史分析记录列表（只返回摘要，不返回快照，避免列表接口传大 JSON）。 */
app.get('/api/competitor-analyses', requireUser, async (req, res, next) => {
  try {
    const rows = await listCompetitorAnalyses(req.user.id, req.query.limit)
    // 台账一次读全（每账号几十行），在内存里算"每条记录还有几条没销账" —— 用于首页报警口径
    const dispositions = await listDispositions(req.user.id)
    res.json({ items: rows.map((row) => toHistoryItem(row, dispositions)) })
  } catch (error) {
    return next(error)
  }
})

/** 单条历史分析（含结果快照）；越权或不存在一律 404，不区分两者。 */
app.get('/api/competitor-analyses/:id', requireUser, async (req, res, next) => {
  try {
    const row = await getCompetitorAnalysis(req.user.id, req.params.id)
    if (!row) return res.status(404).json({ message: '分析记录不存在。' })
    // 快照里的结论要带上当前处置状态，界面才能显示「待核验 / 已核验解决 / 已忽略」
    const result = row.result
      ? await attachDispositions(req.user.id, row.result)
      : null
    res.json({ record: toHistoryItem(row), result })
  } catch (error) {
    return next(error)
  }
})

/**
 * 结论处置：标记「我已处理（待核验）」或「不处理（必填原因）」。
 *
 * `code` + `target` 必须**真的属于这次分析** —— 否则前端一旦传错（或有人手工构造请求），
 * 台账里就会沉淀一条永远不会被任何分析核验到的垃圾状态。校验用分析自己的
 * `finding_keys`；老记录没有这一列时回退到从快照里现算。
 */
app.put('/api/competitor-analyses/:id/findings/disposition', requireUser, async (req, res, next) => {
  try {
    const row = await getCompetitorAnalysis(req.user.id, req.params.id)
    if (!row) return res.status(404).json({ message: '分析记录不存在。' })

    const body = req.body ?? {}
    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const target = typeof body.target === 'string' ? body.target.trim() : ''
    const status = typeof body.status === 'string' ? body.status.trim() : ''
    const note = typeof body.note === 'string' ? body.note.trim() : ''

    if (!code || !target) {
      return res.status(400).json({ message: '缺少结论的诊断码或处置目标。' })
    }
    if (!USER_SETTABLE_STATUSES.includes(status)) {
      return res.status(400).json({ message: `处置状态只能是 ${USER_SETTABLE_STATUSES.join(' / ')}。` })
    }
    /*
     * 「不处理」必须给原因：它是**长期**决定（系统之后不再自动核验、也不再报警），
     * 没有原因的话，半年后没人记得为什么忽略了一条「需立即处理」。
     */
    if (status === 'ignored' && !note) {
      return res.status(400).json({ message: '选择「不处理」时必须填写原因。' })
    }

    const knownKeys = Array.isArray(row.finding_keys) && row.finding_keys.length > 0
      ? row.finding_keys
      : collectFindingKeys(row.result?.findings, { asin: row.result?.asin ?? null })
    const belongs = knownKeys.some(
      (key) => String(key.code) === code && String(key.target) === target
    )
    if (!belongs) {
      return res.status(400).json({ message: '这条结论不属于该次分析，无法标记处置状态。' })
    }

    const saved = await setDisposition({
      userId: req.user.id,
      analysisId: row.id,
      code,
      target,
      status,
      note: note || null,
    })
    res.json({ disposition: saved })
  } catch (error) {
    return next(error)
  }
})

/** 撤销自己刚才的标记（回到「待处理」）—— 删行，语义是"我什么都没标记过"。 */
app.delete('/api/competitor-analyses/:id/findings/disposition', requireUser, async (req, res, next) => {
  try {
    const row = await getCompetitorAnalysis(req.user.id, req.params.id)
    if (!row) return res.status(404).json({ message: '分析记录不存在。' })
    const code = typeof req.query.code === 'string' ? req.query.code.trim() : ''
    const target = typeof req.query.target === 'string' ? req.query.target.trim() : ''
    if (!code || !target) {
      return res.status(400).json({ message: '缺少结论的诊断码或处置目标。' })
    }
    await clearDisposition({ userId: req.user.id, code, target })
    res.json({ disposition: null })
  } catch (error) {
    return next(error)
  }
})

// AI 助手模块（企业 AI 与 Agent 统一入口），见 docs/modules/AI 助手.md
app.use('/api/ai', createAiAgentRouter({ requireUser }))

// 公告（管理员发布、员工登录时弹窗），见 docs/modules/公告.md
app.use(
  '/api/announcements',
  createAnnouncementRouter({ requireUser, requireAdmin })
)

// 产品开发（候选产品池、横向对比与保存），见 docs/modules/产品开发.md
app.use('/api/product-dev', createProductDevRouter({ requireUser }))

// 市场洞察（市场报告快照与回看），见 docs/modules/市场洞察.md
app.use('/api/market-insights', createMarketInsightRouter({ requireUser }))

/**
 * 统一错误出口（必须注册在所有路由之后）。
 *
 * 没有它时未捕获异常会走 Express 默认处理器：返回 HTML 错误页，非 production 下还带堆栈
 * （泄露文件绝对路径与 SQL 片段）；而前端所有接口都按 JSON 解析错误体，拿到 HTML 会二次报错
 * 并丢掉服务端本来写好的中文原因。这里只回一句通用提示，堆栈只留在服务端日志。
 */
app.use((error, _req, res, _next) => {
  process.stderr.write(`[api] 未处理异常：${error?.stack ?? error}\n`)
  if (res.headersSent) return
  res.status(500).json({ message: '服务器内部错误，请稍后重试。' })
})

const migrationClient = await pool.connect()
try {
  await runUserMigrations(migrationClient)
  await runCompetitorMigrations(migrationClient)
  await runAiAgentMigrations(migrationClient)
  // 公告的审计写进 ai_audit_logs，因此必须在 AI 助手迁移（建表）之后运行。
  await runAnnouncementMigrations(migrationClient)
  // 产品开发复用 AI 助手建立的报表表（只读），同样必须排在它之后。
  await runProductDevMigrations(migrationClient)
  await runMarketInsightMigrations(migrationClient)
} finally {
  migrationClient.release()
}

app.listen(port, () => process.stdout.write(`JHYP 智能工作台 API 已启动：http://localhost:${port}\n`))

if (process.env.SERVE_STATIC !== 'false') {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const site = express()
  site.use(express.static(path.join(root, 'dist')))
  site.use((_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')))
  site.listen(5173, () => process.stdout.write('JHYP 智能工作台前端已启动：http://localhost:5173\n'))
}

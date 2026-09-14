import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, query } from './db.mjs'
import { runNavigationMigrations } from './navigation-migrations.mjs'
import { runUserMigrations } from './user-migrations.mjs'
import { defaultDashboardShortcutIds } from './dashboard-shortcuts.mjs'
import { analyzeCompetitor, CompetitorInputError } from './competitor-analysis.mjs'
import { runAiAgentMigrations } from './ai-agent/migrations.mjs'
import { createAiAgentRouter } from './ai-agent/router.mjs'
import { AUDIT_ACTIONS, recordAudit } from './ai-agent/audit.mjs'
import { clientIp } from './ai-agent/http-utils.mjs'
import {
  isEnabledAdmin,
  isEnabledUser,
  isLastEnabledAdminDemotion,
  isLastEnabledAdminRemoval,
  parseUserCreate,
  parseUserStatusUpdate,
  parseUserUpdate,
  UserUpdateValidationError,
} from './user-management.mjs'
import {
  assembleQuickNavigation,
  parseCategoryInput,
  parseNavigationItemInput,
  parseTagInput,
  QuickNavigationValidationError,
} from './quick-navigation.mjs'

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

function handleNavigationError(error, res, next) {
  if (error instanceof QuickNavigationValidationError) {
    return res.status(400).json({ message: error.message })
  }
  if (error?.code === '23505') {
    return res.status(409).json({ message: '名称或导航地址已存在。' })
  }
  if (error?.code === '23503') {
    return res.status(409).json({ message: '该数据仍被导航项使用，无法删除。' })
  }
  return next(error)
}

async function loadQuickNavigation() {
  const [categories, items, tags, itemTags] = await Promise.all([
    query('SELECT id, name, sort_order FROM navigation_categories'),
    query(
      'SELECT id, category_id, name, url, description, placement, sort_order FROM navigation_items'
    ),
    query('SELECT id, name FROM navigation_tags'),
    query('SELECT item_id, tag_id, sort_order FROM navigation_item_tags'),
  ])
  return assembleQuickNavigation({
    categories: categories.rows,
    items: items.rows,
    tags: tags.rows,
    itemTags: itemTags.rows,
  })
}

async function validateNavigationReferences(client, item) {
  if (item.categoryId !== null) {
    const category = await client.query(
      'SELECT id FROM navigation_categories WHERE id = $1',
      [item.categoryId]
    )
    if (!category.rowCount) {
      throw new QuickNavigationValidationError('所选分类不存在。')
    }
  }
  if (item.tagIds.length) {
    const tags = await client.query(
      'SELECT id FROM navigation_tags WHERE id = ANY($1::int[])',
      [item.tagIds]
    )
    if (tags.rowCount !== item.tagIds.length) {
      throw new QuickNavigationValidationError('所选标签包含无效数据。')
    }
  }
}

async function replaceNavigationItemTags(client, itemId, tagIds) {
  await client.query('DELETE FROM navigation_item_tags WHERE item_id = $1', [
    itemId,
  ])
  for (const [sortOrder, tagId] of tagIds.entries()) {
    await client.query(
      'INSERT INTO navigation_item_tags (item_id, tag_id, sort_order) VALUES ($1, $2, $3)',
      [itemId, tagId, sortOrder]
    )
  }
}

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

    if (!user || user.status !== 'enabled' || !passwordOk) {
      // 登录失败也留痕：这是暴力尝试与异常时间登录的唯一回溯依据。detail 只记账号，绝不记密码。
      await recordAudit({
        actorId: user?.id ?? null,
        action: AUDIT_ACTIONS.login,
        targetType: 'user',
        targetId: user?.id ?? null,
        detail: {
          login: login.trim().slice(0, 120),
          result: 'failed',
          reason: !user ? 'unknown_account' : user.status !== 'enabled' ? 'disabled_account' : 'bad_password',
        },
        ip: clientIp(req),
      })
      return res.status(401).json({ message: '账号或密码错误。' })
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
app.get('/api/quick-navigation', requireUser, async (_req, res, next) => {
  try {
    res.json(await loadQuickNavigation())
  } catch (error) {
    next(error)
  }
})
app.post(
  '/api/navigation-categories',
  requireUser,
  requireAdmin,
  async (req, res, next) => {
    try {
      const input = parseCategoryInput(req.body)
      const { rows } = await query(
        'INSERT INTO navigation_categories (name, sort_order) VALUES ($1, $2) RETURNING id, name, sort_order',
        [input.name, input.sortOrder]
      )
      res.status(201).json({
        id: rows[0].id,
        name: rows[0].name,
        sortOrder: rows[0].sort_order,
      })
    } catch (error) {
      handleNavigationError(error, res, next)
    }
  }
)
app.patch(
  '/api/navigation-categories/:id',
  requireUser,
  requireAdmin,
  async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) return res.status(400).json({ message: '分类参数无效。' })
      const input = parseCategoryInput(req.body)
      const { rows } = await query(
        'UPDATE navigation_categories SET name = $1, sort_order = $2, updated_at = NOW() WHERE id = $3 RETURNING id, name, sort_order',
        [input.name, input.sortOrder, id]
      )
      if (!rows[0]) return res.status(404).json({ message: '分类不存在。' })
      return res.json({
        id: rows[0].id,
        name: rows[0].name,
        sortOrder: rows[0].sort_order,
      })
    } catch (error) {
      return handleNavigationError(error, res, next)
    }
  }
)
app.delete(
  '/api/navigation-categories/:id',
  requireUser,
  requireAdmin,
  async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) return res.status(400).json({ message: '分类参数无效。' })
      const result = await query(
        'DELETE FROM navigation_categories WHERE id = $1',
        [id]
      )
      if (!result.rowCount) {
        return res.status(404).json({ message: '分类不存在。' })
      }
      return res.status(204).end()
    } catch (error) {
      return handleNavigationError(error, res, next)
    }
  }
)
app.post(
  '/api/navigation-tags',
  requireUser,
  requireAdmin,
  async (req, res, next) => {
    try {
      const input = parseTagInput(req.body)
      const { rows } = await query(
        'INSERT INTO navigation_tags (name) VALUES ($1) RETURNING id, name',
        [input.name]
      )
      res.status(201).json(rows[0])
    } catch (error) {
      handleNavigationError(error, res, next)
    }
  }
)
app.patch(
  '/api/navigation-tags/:id',
  requireUser,
  requireAdmin,
  async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) return res.status(400).json({ message: '标签参数无效。' })
      const input = parseTagInput(req.body)
      const { rows } = await query(
        'UPDATE navigation_tags SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING id, name',
        [input.name, id]
      )
      if (!rows[0]) return res.status(404).json({ message: '标签不存在。' })
      return res.json(rows[0])
    } catch (error) {
      return handleNavigationError(error, res, next)
    }
  }
)
app.delete(
  '/api/navigation-tags/:id',
  requireUser,
  requireAdmin,
  async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) return res.status(400).json({ message: '标签参数无效。' })
      const result = await query('DELETE FROM navigation_tags WHERE id = $1', [
        id,
      ])
      if (!result.rowCount) {
        return res.status(404).json({ message: '标签不存在。' })
      }
      return res.status(204).end()
    } catch (error) {
      return handleNavigationError(error, res, next)
    }
  }
)
app.post(
  '/api/navigation-items',
  requireUser,
  requireAdmin,
  async (req, res, next) => {
    let input
    try {
      input = parseNavigationItemInput(req.body)
    } catch (error) {
      return handleNavigationError(error, res, next)
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await validateNavigationReferences(client, input)
      const { rows } = await client.query(
        `INSERT INTO navigation_items
          (category_id, name, url, description, placement, sort_order, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          input.categoryId,
          input.name,
          input.url,
          input.description,
          input.placement,
          input.sortOrder,
          req.user.id,
        ]
      )
      await replaceNavigationItemTags(client, rows[0].id, input.tagIds)
      await client.query('COMMIT')
      return res.status(201).json({ id: rows[0].id })
    } catch (error) {
      await client.query('ROLLBACK')
      return handleNavigationError(error, res, next)
    } finally {
      client.release()
    }
  }
)
app.patch(
  '/api/navigation-items/:id',
  requireUser,
  requireAdmin,
  async (req, res, next) => {
    const id = resourceId(req.params.id)
    if (!id) return res.status(400).json({ message: '导航参数无效。' })
    let input
    try {
      input = parseNavigationItemInput(req.body)
    } catch (error) {
      return handleNavigationError(error, res, next)
    }
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await validateNavigationReferences(client, input)
      const { rows } = await client.query(
        `UPDATE navigation_items
         SET category_id = $1, name = $2, url = $3, description = $4,
             placement = $5, sort_order = $6, updated_at = NOW()
         WHERE id = $7 RETURNING id`,
        [
          input.categoryId,
          input.name,
          input.url,
          input.description,
          input.placement,
          input.sortOrder,
          id,
        ]
      )
      if (!rows[0]) {
        await client.query('ROLLBACK')
        return res.status(404).json({ message: '导航项不存在。' })
      }
      await replaceNavigationItemTags(client, id, input.tagIds)
      await client.query('COMMIT')
      return res.json({ id })
    } catch (error) {
      await client.query('ROLLBACK')
      return handleNavigationError(error, res, next)
    } finally {
      client.release()
    }
  }
)
app.delete(
  '/api/navigation-items/:id',
  requireUser,
  requireAdmin,
  async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) return res.status(400).json({ message: '导航参数无效。' })
      const result = await query('DELETE FROM navigation_items WHERE id = $1', [
        id,
      ])
      if (!result.rowCount) {
        return res.status(404).json({ message: '导航项不存在。' })
      }
      return res.status(204).end()
    } catch (error) {
      return handleNavigationError(error, res, next)
    }
  }
)
app.get('/api/dashboard', requireUser, async (req, res) => { const work = await query('SELECT id,module,title,progress,route,updated_at FROM work_items WHERE user_id=$1 AND progress < 100 ORDER BY updated_at DESC', [req.user.id]); const pref = await query('SELECT shortcut_ids FROM shortcut_preferences WHERE user_id=$1', [req.user.id]); const analyses = await query('SELECT id,input_type,input_value,created_at FROM competitor_analyses WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5', [req.user.id]); res.json({ workItems: work.rows, shortcutIds: pref.rows[0]?.shortcut_ids ?? defaultDashboardShortcutIds, analyses: analyses.rows }) })
app.put('/api/dashboard/shortcuts', requireUser, async (req, res) => { await query('INSERT INTO shortcut_preferences (user_id, shortcut_ids) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET shortcut_ids=EXCLUDED.shortcut_ids,updated_at=NOW()', [req.user.id, JSON.stringify(req.body.shortcutIds)]); res.status(204).end() })
/**
 * 竞品分析：单个 ASIN 的真实广告与销售表现。
 *
 * 改动原因：历史实现返回与输入无关的写死结论（无论输入什么都得到同一组
 * 「portable blender / 电池续航不足」），并顺带往 work_items 写一条 progress=65 的假任务
 * —— 那条任务永远不会完成、也没有任何入口能清除它，首页「正在进行的工作」因此长期挂着假数据。
 * 现在数字全部来自数据集与 analytics 的确定性计算，也不再写假进度。
 */
app.post('/api/competitor-analyses', requireUser, async (req, res, next) => {
  try {
    // req.body 可能为 undefined（缺 Content-Type 时），先兜底再校验，避免 TypeError。
    const analysis = await analyzeCompetitor(req.body ?? {})
    const { rows } = await query(
      'INSERT INTO competitor_analyses (user_id,input_type,input_value) VALUES ($1,$2,$3) RETURNING id,input_type,input_value,created_at',
      [req.user.id, analysis.inputType, analysis.inputValue]
    )
    res.json({ record: rows[0], result: analysis })
  } catch (error) {
    if (error instanceof CompetitorInputError) {
      return res.status(400).json({ message: error.message })
    }
    return next(error)
  }
})

// AI 助手模块（企业 AI 与 Agent 统一入口），见 docs/modules/AI 助手.md
app.use('/api/ai', createAiAgentRouter({ requireUser }))

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
  await runNavigationMigrations(migrationClient)
  await runUserMigrations(migrationClient)
  await runAiAgentMigrations(migrationClient)
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

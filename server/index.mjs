import express from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, query } from './db.mjs'
import { runNavigationMigrations } from './navigation-migrations.mjs'
import {
  isEnabledAdmin,
  isEnabledUser,
  isLastEnabledAdminDemotion,
  isLastEnabledAdminRemoval,
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
const sign = (user) => jwt.sign({ id: user.id, login: user.login, role: user.role }, secret, { expiresIn: '8h' })
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
      'SELECT id, login, role, status FROM users WHERE id = $1',
      [claims.id]
    )
    if (!isEnabledUser(rows[0])) {
      return res.status(401).json({ message: '账号已停用或不存在。' })
    }
    req.user = { ...claims, login: rows[0].login, role: rows[0].role }
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

app.post('/api/auth/login', async (req, res) => {
  const { login, password } = req.body
  const { rows } = await query('SELECT * FROM users WHERE login = $1', [login])
  const user = rows[0]
  if (!user || user.status !== 'enabled' || !(await bcrypt.compare(password ?? '', user.password_hash))) return res.status(401).json({ message: '账号或密码错误。' })
  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id])
  res.json({ token: sign(user), user: { id: user.id, accountNo: user.login, email: user.login, name: user.name, role: [user.role], exp: Date.now() + 8 * 3600_000 } })
})
app.get('/api/auth/me', requireUser, async (req, res) => { const { rows } = await query('SELECT id, login, name, role FROM users WHERE id = $1', [req.user.id]); res.json(rows[0]) })
app.get('/api/users', requireUser, requireAdmin, async (_req, res) => { const { rows } = await query('SELECT id, login, name, role, status, created_at, last_login_at FROM users ORDER BY created_at DESC'); res.json(rows) })
app.post('/api/users', requireUser, requireAdmin, async (req, res) => { const { login, name, password, role = 'operator' } = req.body; if (!login || !name || !password) return res.status(400).json({ message: '请完整填写账号、姓名和初始密码。' }); const hash = await bcrypt.hash(password, 12); const { rows } = await query('INSERT INTO users (login, name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, login, name, role, status, created_at', [login, name, hash, role]); res.status(201).json(rows[0]) })
app.patch('/api/users/:id', requireUser, requireAdmin, async (req, res, next) => {
  let update
  try { update = parseUserUpdate(req.body) } catch (error) {
    if (error instanceof UserUpdateValidationError) return res.status(400).json({ message: error.message })
    return next(error)
  }
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
      [req.params.id]
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
    const { rows } = await client.query(
      'UPDATE users SET name = $1, role = $2 WHERE id = $3 RETURNING id, login, name, role, status, created_at, last_login_at',
      [update.name, update.role, target.id]
    )
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
      [req.params.id]
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
    await client.query('COMMIT')
    return res.json(rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    return next(error)
  } finally {
    client.release()
  }
})
app.post('/api/users/:id/reset-password', requireUser, requireAdmin, async (req, res) => { const hash = await bcrypt.hash(req.body.password ?? '', 12); await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]); res.status(204).end() })
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
app.get('/api/dashboard', requireUser, async (req, res) => { const work = await query('SELECT id,module,title,progress,route,updated_at FROM work_items WHERE user_id=$1 AND progress < 100 ORDER BY updated_at DESC', [req.user.id]); const pref = await query('SELECT shortcut_ids FROM shortcut_preferences WHERE user_id=$1', [req.user.id]); const analyses = await query('SELECT id,input_type,input_value,created_at FROM competitor_analyses WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5', [req.user.id]); res.json({ workItems: work.rows, shortcutIds: pref.rows[0]?.shortcut_ids ?? ['competitor','project','listing','reviews'], analyses: analyses.rows }) })
app.put('/api/dashboard/shortcuts', requireUser, async (req, res) => { await query('INSERT INTO shortcut_preferences (user_id, shortcut_ids) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET shortcut_ids=EXCLUDED.shortcut_ids,updated_at=NOW()', [req.user.id, JSON.stringify(req.body.shortcutIds)]); res.status(204).end() })
app.post('/api/competitor-analyses', requireUser, async (req, res) => { const { inputType, inputValue } = req.body; const { rows } = await query('INSERT INTO competitor_analyses (user_id,input_type,input_value) VALUES ($1,$2,$3) RETURNING id,input_type,input_value,created_at', [req.user.id,inputType,inputValue]); await query(`INSERT INTO work_items (user_id,module,title,progress,route) VALUES ($1,'竞品分析',$2,65,'/competitor-analysis')`, [req.user.id, `解读 ${inputValue}`]); res.json({ record: rows[0], result: { keywords: ['portable blender','smoothie maker','USB rechargeable'], listing: ['容量与续航说明不足','强调便携与易清洁','A+ 页面聚焦使用场景'], imagePoints: ['首图突出容量刻度','场景图展示通勤使用','对比图强调可拆洗'], reviewPainPoints: ['电池续航不足','密封圈易漏液','清洗死角较多'] } }) })

const migrationClient = await pool.connect()
try {
  await runNavigationMigrations(migrationClient)
} finally {
  migrationClient.release()
}
app.listen(port, () => process.stdout.write(`JHYP API 已启动：http://localhost:${port}\n`))

if (process.env.SERVE_STATIC !== 'false') {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const site = express()
  site.use(express.static(path.join(root, 'dist')))
  site.use((_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')))
  site.listen(5173, () => process.stdout.write('JHYP 前端已启动：http://localhost:5173\n'))
}

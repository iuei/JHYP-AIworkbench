/**
 * 权限裁剪集中实现（需求文档 §3.3）。
 *
 * 三层权限全部经由本模块，禁止在业务代码里散落角色判断：
 *   ① 工具注册裁剪  → registerableTools(user, tools)
 *   ② 执行前二次校验 → canUseTool(user, tool)
 *   ③ 检索范围过滤  → documentScopeSql(user) / visibleDocuments(user)
 *
 * 角色映射（关键）：
 *   现有 users.role 实际取值是 'admin' / 'operator'（见 server/user-management.mjs），
 *   而工具契约里的 requiredRole 用需求文档口径的 'user' / 'admin'。映射只在本文件里做：
 *     requiredRole = 'user'  → 任意启用账号（admin 与 operator 均可）
 *     requiredRole = 'admin' → 必须 role = 'admin' 且账号启用
 */
import { query } from '../db.mjs'
import { isEnabledAdmin, isEnabledUser } from '../user-management.mjs'

export const BLOCKED_MESSAGE = '当前账号无权查询该数据，请联系管理员。'
export const ROLE_ADMIN = 'admin'

const TOOL_ROLES = new Set(['user', 'admin'])

export { isEnabledUser, isEnabledAdmin }

/**
 * 判断某个工具所需角色是否被该用户满足。
 * 未知的 requiredRole 一律拒绝（拒绝优先，避免新增角色声明时静默放行）。
 */
export function requiredRoleAllows(requiredRole, user) {
  if (!isEnabledUser(user)) return false
  if (!TOOL_ROLES.has(requiredRole)) return false
  if (requiredRole === 'user') return true
  return isEnabledAdmin(user)
}

/**
 * ② 执行前二次校验。tool 接受数据库行（required_role / enabled）或工具契约（requiredRole）。
 */
export function canUseTool(user, tool) {
  if (!tool || typeof tool !== 'object') return false
  if (tool.enabled === false) return false
  const requiredRole = tool.required_role ?? tool.requiredRole
  return requiredRoleAllows(requiredRole, user)
}

/** ① 工具注册裁剪：只有该用户有权限且已启用的工具才会被交给模型。 */
export function registerableTools(user, tools) {
  if (!Array.isArray(tools)) return []
  return tools.filter((tool) => canUseTool(user, tool))
}

/** 文档是否处于生效状态（含有效期判断）。 */
export function isDocumentActive(document, now = new Date()) {
  if (!document || document.status !== 'active') return false
  if (!document.expires_at) return true
  const expiresAt = new Date(document.expires_at)
  if (Number.isNaN(expiresAt.getTime())) return false
  return expiresAt.getTime() > now.getTime()
}

/** 读取文档的可见角色范围；返回空数组表示对全部角色可见（一期默认）。 */
export function allowedRolesOf(document) {
  const scope = document?.data_scope
  if (!scope || typeof scope !== 'object') return []
  const roles = scope.roles
  if (!Array.isArray(roles)) return []
  return roles.filter((role) => typeof role === 'string' && role.length > 0)
}

/** ③ 文档级可见性判定（纯函数，便于单测）。 */
export function canSeeDocument(user, document, now = new Date()) {
  if (!isEnabledUser(user)) return false
  if (!isDocumentActive(document, now)) return false
  const roles = allowedRolesOf(document)
  if (roles.length === 0) return true
  return roles.includes(user.role)
}

/**
 * ③ 生成检索用的 SQL 条件片段。
 *
 * 调用方自行决定占位符编号，例如：
 *   const scope = documentScopeSql(user, '$3')
 *   query(`... WHERE ${scope.clause}`, [a, b, scope.param])
 *
 * 条件含义：文档生效且未过期，并且（未配置可见角色 或 当前角色在可见角色内）。
 * 用 jsonb_typeof 做保护，避免 data_scope 结构异常时 jsonb_array_length 直接报错。
 */
export function documentScopeSql(user, placeholder) {
  if (!placeholder || !/^\$\d+$/.test(placeholder)) {
    throw new Error('documentScopeSql 需要一个形如 $1 的占位符')
  }
  return {
    clause: `d.status = 'active'
      AND (d.expires_at IS NULL OR d.expires_at > NOW())
      AND (
        jsonb_typeof(d.data_scope -> 'roles') IS DISTINCT FROM 'array'
        OR jsonb_array_length(d.data_scope -> 'roles') = 0
        OR d.data_scope -> 'roles' ? ${placeholder}
      )`,
    param: user?.role ?? '',
  }
}

/** ③ 检索范围过滤：返回该用户可见的全部生效文档 ID。 */export async function visibleDocumentIds(user) {
  if (!isEnabledUser(user)) return []
  const scope = documentScopeSql(user, '$1')
  const { rows } = await query(
    `SELECT d.id FROM ai_documents d WHERE ${scope.clause}`,
    [scope.param]
  )
  return rows.map((row) => row.id)
}

/** ③ 检索范围过滤：返回该用户可见的生效文档行。 */
export async function visibleDocuments(user) {
  if (!isEnabledUser(user)) return []
  const scope = documentScopeSql(user, '$1')
  const { rows } = await query(
    `SELECT d.id, d.title, d.source_type, d.category, d.doc_version,
            d.status, d.expires_at, d.chunk_count, d.updated_at, d.data_scope
       FROM ai_documents d
      WHERE ${scope.clause}
      ORDER BY d.updated_at DESC`,
    [scope.param]
  )
  return rows
}

/**
 * 知识沉淀（ai_knowledge_notes）的账号隔离条件。
 *
 * 与 documentScopeSql 的区别：文档按**角色**可见（公司制度对全员），
 * 沉淀按**账号**可见（个人经验只属于本人）。两者都是三层裁剪的第三层，
 * 必须留在本文件里，禁止业务模块自己拼 owner_user_id 条件。
 */
export function noteScopeSql(user, placeholder) {
  if (!placeholder || !/^\$\d+$/.test(placeholder)) {
    throw new Error('noteScopeSql 需要一个形如 $1 的占位符')
  }
  return { clause: `n.owner_user_id = ${placeholder}`, param: user?.id ?? -1 }
}

/**
 * 单条沉淀的可见性：本人或管理员。
 *
 * 注意：管理员可见**仅用于管理视图**（沉淀管理页详情/列表）。对话检索**不**使用本函数，
 * 因此管理员在问答里不会看到员工的私有沉淀（已与需求方确认）。
 *
 * ⚠️ 员工接口（/api/ai/notes/*）**不得**使用本函数：管理员通过员工接口访问他人条目
 * 会同时拿到条目内容与所有者身份，等同于绕过管理审计。员工接口一律用 canOwnNote。
 */
export function canSeeNote(user, note) {
  if (!isEnabledUser(user)) return false
  if (!note) return false
  if (note.deleted_at) return false
  if (note.owner_user_id === user.id) return true
  return isEnabledAdmin(user)
}

/**
 * 沉淀的**所有者**可见性（员工接口 /api/ai/notes/* 专用）。
 *
 * 与 canSeeNote 的区别就是"可见 ≠ 可操作"：管理视图需要管理员看到他人条目，
 * 但员工接口既能读也能写，必须收窄到 owner。管理员访问他人条目按不存在处理（404），
 * 不泄露"这条沉淀存在但你看不到"。
 */
export function canOwnNote(user, note) {
  if (!isEnabledUser(user)) return false
  if (!note) return false
  if (note.deleted_at) return false
  return note.owner_user_id === user.id
}

/**
 * 沉淀的**管理员**可见性（管理接口 /api/ai/distill/* 专用）。
 *
 * 管理视图不过滤 owner，但要求调用方是启用状态的管理员；
 * 已软删条目同样不可见（软删保留行只为审计回溯）。
 */
export function canManageNote(user, note) {
  if (!isEnabledAdmin(user)) return false
  if (!note) return false
  return !note.deleted_at
}

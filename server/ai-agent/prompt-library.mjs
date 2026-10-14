/**
 * 提示词广场（员工自建提问模板）领域层。
 *
 * 产品定位：把员工反复输入的提问沉淀成可复用模板，对话中通过 `@名称` 或输入框旁入口调出，
 * 选中后把正文填进输入框（**不自动发送**，也不把 `@名称` 当消息内容上送）。
 *
 * 三条约束：
 * 1. **账号隔离**：提示词默认只属于本人（`owner_user_id`），他人私有条目一律按 404 处理，
 *    与 `ai_knowledge_notes`、`asin_watchlists` 的所有者视角一致——可见 ≠ 可操作。
 * 2. **名称两层唯一**：个人库内唯一（避免自己撞名）+ 共享池内全局唯一（`@名称` 无歧义）。
 *    只做全局唯一的话，任一人私有占用某名称后其他人再也建不了同名提示词。
 *    应用层检查只是"提前给出友好提示"，真正的唯一性由 `migrations.mjs` 的部分唯一索引兜底
 *    （并发下应用层检查不可靠）。
 * 3. **与技能互不相关**：提示词只存纯文本，不带变量字段、不参与知识抽取、不注入系统提示词；
 *    技能仍走 `ai_skills` / SKILL.md 那一套。两者不引用、不合并。
 *
 * 术语提醒：本文件的"提示词"指**员工提问模板**，与 `prompt.mjs`（系统提示词组装与注入防护）
 * 是两件事，刻意分成两个文件、不做合并。
 */
import { query } from '../db.mjs'

/** 校验类错误 → 400。 */
export class PromptValidationError extends Error {}

/** 资源不存在或不属于当前账号 → 404（不区分"不存在"与"无权"，避免探测）。 */
export class PromptNotFoundError extends Error {}

/** 名称冲突、非法状态流转、共享池重名 → 409。 */
export class PromptConflictError extends Error {}

export const PROMPT_STATUS = {
  private: 'private',
  pending: 'pending',
  published: 'published',
  rejected: 'rejected',
}

export const PROMPT_STATUS_LABELS = {
  private: '私有',
  pending: '待审核',
  published: '已共享',
  rejected: '已驳回',
}

export const MAX_NAME_LENGTH = 60
export const MAX_TITLE_LENGTH = 120
export const MAX_BODY_LENGTH = 4000
export const MAX_SUMMARY_LENGTH = 300
export const MAX_TAGS = 10
export const MAX_TAG_LENGTH = 20
export const MAX_PROMPTS_PER_USER = 200
export const MAX_KEYWORD_LENGTH = 60

/**
 * 状态流转表：`起点 → { 终点: 有权发起的一方 }`。
 *
 * `owner` 表示条目作者本人（调用方必须先确认所有权），`admin` 表示管理员。
 * 未列出的组合一律拒绝（**报 409 而不是静默忽略**：静默会把"我没提报成功"变成看不见的数据状态）。
 *
 * 这里没有 `archived`：删除走 `deleted_at` 软删，再引入一个"归档"状态只会与软删语义重叠。
 */
const TRANSITIONS = {
  private: { pending: 'owner' },
  rejected: { pending: 'owner' },
  pending: { private: 'owner', published: 'admin', rejected: 'admin' },
  // 已共享条目被作者修改后回到待审，因此 published 也有一条回 pending 的边
  published: { pending: 'owner' },
}

export function canTransition(from, to, { isAdmin = false } = {}) {
  const actor = TRANSITIONS[from]?.[to]
  if (!actor) return false
  if (actor === 'admin') return Boolean(isAdmin)
  return true
}

export function assertTransition(from, to, { isAdmin = false } = {}) {
  if (canTransition(from, to, { isAdmin })) return
  throw new PromptConflictError(
    `不能从「${PROMPT_STATUS_LABELS[from] ?? from}」变更为「${PROMPT_STATUS_LABELS[to] ?? to}」。`
  )
}

/* ---------- 纯函数：校验与归一化（单测直接覆盖，不需要数据库） ---------- */

/**
 * 提示词名称：折叠空白、长度 1..60，且**不允许 `@`**。
 *
 * 禁 `@` 的理由是 `@名称` 是调用入口：名称里再带 `@`，用户输入 `@ACoS@分析` 时
 * 触发位置与匹配范围都会变得无法预期。
 */
export function normalizeName(raw) {
  const text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) throw new PromptValidationError('提示词名称不能为空。')
  if (text.length > MAX_NAME_LENGTH) {
    throw new PromptValidationError(`提示词名称不能超过 ${MAX_NAME_LENGTH} 个字符。`)
  }
  if (text.includes('@')) {
    throw new PromptValidationError('提示词名称不能包含 @ 符号（@ 是调用入口）。')
  }
  return text
}

/**
 * 正文：保留换行（提问模板常是多行），只去掉首尾空白。
 * 不做空白折叠——用户排版的换行是有意义的。
 */
export function normalizeBody(raw) {
  const text = String(raw ?? '').trim()
  if (!text) throw new PromptValidationError('提示词正文不能为空。')
  if (text.length > MAX_BODY_LENGTH) {
    throw new PromptValidationError(`提示词正文不能超过 ${MAX_BODY_LENGTH} 个字符。`)
  }
  return text
}

/** 可选说明：空串按"清空"处理（返回空串），超长报错。 */
export function optionalSummary(raw) {
  if (raw === undefined) return undefined
  const text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length > MAX_SUMMARY_LENGTH) {
    throw new PromptValidationError(`说明不能超过 ${MAX_SUMMARY_LENGTH} 个字符。`)
  }
  return text
}

/** 标签：去空、去重、限个数与长度；非数组输入按空数组处理。 */
export function normalizeTags(input) {
  if (input === undefined) return undefined
  const list = Array.isArray(input) ? input : []
  const seen = new Set()
  const tags = []
  for (const raw of list) {
    const tag = String(raw ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!tag) continue
    if (tag.length > MAX_TAG_LENGTH) {
      throw new PromptValidationError(`单个标签不能超过 ${MAX_TAG_LENGTH} 个字符。`)
    }
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
  }
  if (tags.length > MAX_TAGS) {
    throw new PromptValidationError(`标签最多 ${MAX_TAGS} 个。`)
  }
  return tags
}

/**
 * 标题（2026-09-15 已下线：与名称重复，列表里两行说的是同一件事）。
 *
 * 列还在（`ai_prompts.title NOT NULL`，历史数据不删），因此创建时写入空串；
 * 这里保留长度校验是为了兼容仍在传该字段的旧调用方（例如外部脚本），
 * 但**接口不再返回它**（`serializePrompt` 已移除），前端也不再展示。
 */
export function optionalTitle(raw) {
  const text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length > MAX_TITLE_LENGTH) {
    throw new PromptValidationError(`标题不能超过 ${MAX_TITLE_LENGTH} 个字符。`)
  }
  return text
}

/** 新建时的完整入参归一化。`title` 缺省为空串（字段已下线）、`tags` 缺省为空数组。 */
export function normalizePromptInput(input = {}) {
  return {
    name: normalizeName(input.name),
    title: optionalTitle(input.title),
    body: normalizeBody(input.body),
    summary: optionalSummary(input.summary) ?? '',
    tags: normalizeTags(input.tags) ?? [],
  }
}

/** 搜索关键字：折叠空白并限长，空值表示不过滤。 */
export function normalizeKeyword(raw) {
  const text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length > MAX_KEYWORD_LENGTH) {
    throw new PromptValidationError(`搜索词不能超过 ${MAX_KEYWORD_LENGTH} 个字符。`)
  }
  return text
}

export function serializePrompt(row, { userId } = {}) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    // 标题（row.title）2026-09-15 已下线：与名称重复，列与历史值仍在库里，但接口不再返回
    body: row.body,
    summary: row.summary ?? '',
    tags: row.tags ?? [],
    status: row.status,
    usageCount: Number(row.usage_count ?? 0),
    isOwner: userId === undefined ? undefined : Number(row.owner_user_id) === Number(userId),
    ownerLogin: row.owner_login ?? undefined,
    reviewComment: row.review_comment ?? null,
    reviewedAt: row.reviewed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/* ---------- 数据库访问 ---------- */

// ownerLogin 用 LEFT JOIN 取：审核队列要显示作者，员工侧用不到但不额外查一次
const PROMPT_COLUMNS = `p.id, p.owner_user_id, p.name, p.title, p.body, p.summary, p.tags,
  p.status, p.usage_count, p.review_comment, p.reviewed_at, p.created_at, p.updated_at,
  u.login AS owner_login`

const PROMPT_FROM = `FROM ai_prompts p LEFT JOIN users u ON u.id = p.owner_user_id`

const PG_UNIQUE_VIOLATION = '23505'

/**
 * 唯一索引冲突转成语义明确的 409。
 *
 * 用 `error.constraint` 区分两个索引：个人库撞名和共享池撞名要给用户不同的处理动作
 * （前者改名即可，后者要先看共享池里那条是谁的）。
 */
function rethrowUnique(error, name) {
  if (error?.code !== PG_UNIQUE_VIOLATION) throw error
  if (error.constraint === 'ai_prompts_published_name_uidx') {
    throw new PromptConflictError(
      `共享提示词中已存在「${name}」，请改名后再提报（或联系管理员确认是否重复）。`
    )
  }
  throw new PromptConflictError(`你已有一条同名提示词「${name}」，请换一个名称。`)
}

async function assertPromptQuota({ userId }) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total FROM ai_prompts WHERE owner_user_id = $1 AND deleted_at IS NULL`,
    [userId]
  )
  if (Number(rows[0]?.total ?? 0) >= MAX_PROMPTS_PER_USER) {
    throw new PromptValidationError(
      `每个账号最多创建 ${MAX_PROMPTS_PER_USER} 条提示词，请先删除不再使用的提示词。`
    )
  }
}

/** 共享池里是否已有同名（可排除某个 id），用于提报与审核前的友好提示。 */
async function findPublishedByName({ name, excludeId = null }) {
  const { rows } = await query(
    `SELECT id, owner_user_id FROM ai_prompts
      WHERE status = 'published' AND deleted_at IS NULL AND lower(name) = lower($1)
        AND ($2::int IS NULL OR id <> $2::int)
      LIMIT 1`,
    [name, excludeId]
  )
  return rows[0] ?? null
}

/**
 * 读取一条提示词：作者本人可读全部状态，其他人只能读已共享的。
 * 不可见时返回 null，由调用方转 404（不区分"不存在"与"无权"）。
 */
export async function findVisiblePrompt({ id, userId }) {
  const { rows } = await query(
    `SELECT ${PROMPT_COLUMNS} ${PROMPT_FROM}
      WHERE p.id = $1 AND p.deleted_at IS NULL
        AND (p.owner_user_id = $2 OR p.status = 'published')`,
    [id, userId]
  )
  return rows[0] ?? null
}

/** 读取一条**属于本人**的提示词；他人条目返回 null（调用方转 404）。 */
export async function findOwnedPrompt({ id, userId }) {
  const { rows } = await query(
    `SELECT ${PROMPT_COLUMNS} ${PROMPT_FROM}
      WHERE p.id = $1 AND p.owner_user_id = $2 AND p.deleted_at IS NULL`,
    [id, userId]
  )
  return rows[0] ?? null
}

/**
 * 列表查询。
 *
 * `scope`：
 * - `mine`：本人的全部未删除条目（含待审与已驳回，状态由界面用徽标区分）
 * - `published`：共享池（全员可用）
 * - `usable`：二者合并，供对话内 `@` 浮层使用
 *
 * 关键字走**服务端** `ILIKE`（库已启用 pg_trgm）。不做前端过滤：本项目在会话搜索上
 * 已经踩过"只在前 N 条里过滤、更早的数据搜不到"的坑（见 chat-workbench 的注释）。
 * 排序把**名称精确匹配放最前**：用户直接敲完 `@ACoS 归因` 时，那条应当排在第一位。
 *
 * **分页（2026-09-15）**：此前无 LIMIT —— `mine` 有 200 条上限尚可，`published` 是
 * 全公司共享池、无总量上限，列表与 `@` 浮层都得把全池拉下来。改为服务端分页，
 * 计数与列表共用同一组条件（分页后总数对不上是最难解释的一类缺陷）。
 */
export async function listPrompts({ userId, scope = 'mine', keyword = '', page = 1, pageSize = 20 }) {
  const conditions = ['p.deleted_at IS NULL']
  /**
   * 参数必须**按分支按需添加**，不能先塞一个 `[userId]` 进去。
   *
   * 曾经写成 `const params = [userId]` + 各分支硬编码 `$1`：`published` 分支的 SQL 里
   * 一个占位符都没有，却带着 1 个参数发给 PostgreSQL —— 直接报
   * "bind message supplies 1 parameters, but prepared statement requires 0"。
   * 纯函数单测与前端测试都覆盖不到这一层，是端到端验证才暴露出来的。
   */
  const params = []

  if (scope === 'mine') {
    params.push(userId)
    conditions.push(`p.owner_user_id = $${params.length}`)
  } else if (scope === 'published') {
    conditions.push(`p.status = 'published'`)
  } else if (scope === 'usable') {
    params.push(userId)
    conditions.push(`(p.status = 'published' OR p.owner_user_id = $${params.length})`)
  } else {
    throw new PromptValidationError(`不支持的查询范围：${scope}。`)
  }

  let orderParams = []
  /**
   * 关键词要**两个**参数，而它们必须分开存放：
   * 一个给条件里的 ILIKE（带 `%`），一个给 ORDER BY 的名称精确匹配（不带 `%`）。
   *
   * 踩过的坑（2026-09-16）：曾把两个都 push 进同一个 `params`，而这个数组**同时**被
   * count 查询与列表查询复用 —— count 的 SQL 里没有 ORDER BY，于是收到"多出来的"参数，
   * PostgreSQL 直接报 `bind message supplies 2 parameters, but prepared statement requires 1`，
   * **任何带关键词的提示词列表请求都 500**（不带关键词正常，所以单测与页面冒烟都不容易发现：
   * 前端拿到 500 后渲染的是空态，看起来像"没搜到"）。
   * 现在 `params` 只装过滤条件用的参数，精确匹配参数单独走 `orderParams`。
   */
  const safeKeyword = normalizeKeyword(keyword)
  if (safeKeyword) {
    params.push(`%${safeKeyword}%`)
    const idx = params.length
    conditions.push(
      `(p.name ILIKE $${idx} OR p.title ILIKE $${idx} OR p.summary ILIKE $${idx} OR p.body ILIKE $${idx})`
    )
    // 占位符编号 = 过滤参数个数 + 1（精确匹配参数紧跟在过滤参数之后）
    orderParams = [safeKeyword]
  }

  // 精确命中名称的排最前；其余按最近更新排序
  const orderBy = orderParams.length
    ? `(lower(p.name) = lower($${params.length + 1})) DESC, p.updated_at DESC, p.id DESC`
    : `p.updated_at DESC, p.id DESC`

  // count 只吃过滤参数 —— 顺序参数的个数不算进 LIMIT/OFFSET 的编号里就错了
  const limitIndex = params.length + orderParams.length + 1
  const offsetIndex = limitIndex + 1

  const countResult = await query(
    `SELECT count(*)::int AS total ${PROMPT_FROM} WHERE ${conditions.join(' AND ')}`,
    params
  )
  const total = countResult.rows[0]?.total ?? 0
  const limit = Math.max(1, Math.min(Number(pageSize) || 20, 100))
  const safePage = Math.max(1, Number(page) || 1)
  const offset = (safePage - 1) * limit

  const { rows } = await query(
    `SELECT ${PROMPT_COLUMNS} ${PROMPT_FROM}
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    [...params, ...orderParams, limit, offset]
  )
  return {
    prompts: rows.map((row) => serializePrompt(row, { userId })),
    total,
    page: safePage,
    pageSize: limit,
  }
}

/** 管理端审核队列：按状态过滤，默认只看待审。分页口径与 `listPrompts` 完全一致。 */
export async function listPromptsForReview({
  status = 'pending',
  keyword = '',
  page = 1,
  pageSize = 20,
} = {}) {
  const allowed = new Set(Object.values(PROMPT_STATUS))
  const safeStatus = String(status ?? '').trim()
  if (safeStatus && !allowed.has(safeStatus)) {
    throw new PromptValidationError(`不支持的审核状态：${status}。`)
  }
  const params = []
  const conditions = ['p.deleted_at IS NULL']
  if (safeStatus) {
    params.push(safeStatus)
    conditions.push(`p.status = $${params.length}`)
  }
  const safeKeyword = normalizeKeyword(keyword)
  if (safeKeyword) {
    params.push(`%${safeKeyword}%`)
    conditions.push(`(p.name ILIKE $${params.length} OR p.title ILIKE $${params.length})`)
  }

  const where = conditions.join(' AND ')
  const countResult = await query(
    `SELECT count(*)::int AS total ${PROMPT_FROM} WHERE ${where}`,
    params
  )
  const total = countResult.rows[0]?.total ?? 0
  const limit = Math.max(1, Math.min(Number(pageSize) || 20, 100))
  const safePage = Math.max(1, Number(page) || 1)
  const offset = (safePage - 1) * limit

  const { rows } = await query(
    `SELECT ${PROMPT_COLUMNS} ${PROMPT_FROM}
      WHERE ${where}
      ORDER BY p.updated_at ASC, p.id ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  )
  return {
    prompts: rows.map((row) => serializePrompt(row)),
    total,
    page: safePage,
    pageSize: limit,
  }
}

export async function countPendingPrompts() {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total FROM ai_prompts WHERE status = 'pending' AND deleted_at IS NULL`
  )
  return Number(rows[0]?.total ?? 0)
}

export async function createPrompt({ userId, input = {} }) {
  const fields = normalizePromptInput(input)
  await assertPromptQuota({ userId })

  let created
  try {
    const { rows } = await query(
      `INSERT INTO ai_prompts (owner_user_id, name, title, body, summary, tags)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [userId, fields.name, fields.title, fields.body, fields.summary, fields.tags]
    )
    created = rows[0]
  } catch (error) {
    rethrowUnique(error, fields.name)
  }
  return serializePrompt(await findOwnedPrompt({ id: created.id, userId }), { userId })
}

/**
 * 修改本人提示词。
 *
 * **已共享条目修改后回到待审**：改完的内容没经过审核就不该继续以"共享"身份被全员调用，
 * 否则审核形同虚设（先提报一个合规的，通过后再改成别的）。
 * 回到待审意味着名称从共享池释放，重审通过时可能撞上他人新占用的同名——那时由
 * `approvePrompt` 报 409，而不是让唯一索引把错误抛成 500。
 */
export async function updatePrompt({ id, userId, patch = {} }) {
  const existing = await findOwnedPrompt({ id, userId })
  if (!existing) return null

  const merged = normalizePromptInput({
    name: patch.name === undefined ? existing.name : patch.name,
    title: patch.title === undefined ? existing.title : patch.title,
    body: patch.body === undefined ? existing.body : patch.body,
    summary: patch.summary === undefined ? existing.summary : patch.summary,
    tags: patch.tags === undefined ? existing.tags : patch.tags,
  })

  const backToPending = existing.status === PROMPT_STATUS.published
  try {
    await query(
      `UPDATE ai_prompts
          SET name = $2, title = $3, body = $4, summary = $5, tags = $6,
              status = CASE WHEN $7::bool THEN 'pending' ELSE status END,
              reviewed_by = CASE WHEN $7::bool THEN NULL ELSE reviewed_by END,
              reviewed_at = CASE WHEN $7::bool THEN NULL ELSE reviewed_at END,
              review_comment = CASE WHEN $7::bool THEN NULL ELSE review_comment END,
              updated_at = NOW()
        WHERE id = $1 AND owner_user_id = $8 AND deleted_at IS NULL`,
      [
        id,
        merged.name,
        merged.title,
        merged.body,
        merged.summary,
        merged.tags,
        backToPending,
        userId,
      ]
    )
  } catch (error) {
    rethrowUnique(error, merged.name)
  }
  return serializePrompt(await findOwnedPrompt({ id, userId }), { userId })
}

export async function deletePrompt({ id, userId }) {
  const { rowCount } = await query(
    `UPDATE ai_prompts SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`,
    [id, userId]
  )
  return rowCount > 0
}

/**
 * 状态流转。
 *
 * 提报（→ pending）前先查共享池同名，把"审核时才发现撞名"提前到提报时暴露，
 * 用户当时就能改名，不用等一轮审核被驳回。
 */
export async function transitionPrompt({ id, user, to, comment = null, scope = 'self' }) {
  const prompt =
    scope === 'admin'
      ? await findPromptAnyOwner({ id })
      : await findOwnedPrompt({ id, userId: user.id })
  if (!prompt) return null

  const isAdmin = scope === 'admin'
  assertTransition(prompt.status, to, { isAdmin })

  if (to === PROMPT_STATUS.pending) {
    const clash = await findPublishedByName({ name: prompt.name, excludeId: prompt.id })
    if (clash) {
      throw new PromptConflictError(
        `共享提示词中已存在「${prompt.name}」，请改名后再提报。`
      )
    }
  }

  if (to === PROMPT_STATUS.rejected && !String(comment ?? '').trim()) {
    throw new PromptValidationError('驳回必须填写原因。')
  }

  try {
    await query(
      `UPDATE ai_prompts
          SET status = $2,
              reviewed_by = CASE WHEN $3::bool THEN $4 ELSE reviewed_by END,
              reviewed_at = CASE WHEN $3::bool THEN NOW() ELSE reviewed_at END,
              review_comment = CASE WHEN $3::bool THEN $5 ELSE review_comment END,
              updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL`,
      [id, to, isAdmin, user.id, comment ? String(comment).trim() : null]
    )
  } catch (error) {
    rethrowUnique(error, prompt.name)
  }

  const updated = isAdmin
    ? await findPromptAnyOwner({ id })
    : await findOwnedPrompt({ id, userId: user.id })
  return serializePrompt(updated, { userId: user.id })
}

/** 管理端按 id 读取（不限所有者）。 */
export async function findPromptAnyOwner({ id }) {
  const { rows } = await query(
    `SELECT ${PROMPT_COLUMNS} ${PROMPT_FROM} WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [id]
  )
  return rows[0] ?? null
}

/**
 * 调用计数 +1。
 *
 * 只对**调用者可见**的条目生效（`usable` 口径），避免拿别人私有条目的 id 刷计数。
 * 计数失败不影响调用本身，因此调用方应忽略异常。
 */
export async function incrementPromptUsage({ id, userId }) {
  const { rowCount } = await query(
    `UPDATE ai_prompts SET usage_count = usage_count + 1
      WHERE id = $1 AND deleted_at IS NULL
        AND (status = 'published' OR owner_user_id = $2)`,
    [id, userId]
  )
  return rowCount > 0
}

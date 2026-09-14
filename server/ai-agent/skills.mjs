/**
 * 技能（账号级知识沉淀能力）：定义解析/渲染 + 账号级配置读写。
 *
 * 技能定义格式沿用 Claude SKILL.md 的约定：frontmatter（name / description / version / triggers）
 * + 正文指令。`description` 写「何时使用」，即触发条件声明位——与外部技能生态互通，
 * 导入/导出都走这一份解析器（导入接口下一轮，导出本轮已用于导出技能说明）。
 *
 * 权限与边界：
 * - 账号只能读写自己的 ai_user_skills 行（本模块不接收调用方传入的 userId 之外的身份）；
 * - 技能正文（body）是提示词，必须与 skill-contracts.mjs 的契约一致，禁止在这里硬编码第二份。
 */
import { query } from '../db.mjs'
import { DEFAULT_SKILL_POLICY, DISTILL_SKILL_NAME } from './skill-contracts.mjs'

export class SkillValidationError extends Error {}

export { DISTILL_SKILL_NAME }

const TRIGGER_MODES = new Set(['manual', 'auto', 'both'])
const VISIBILITIES = new Set(['private', 'review'])
export const MAX_DAILY_QUOTA = 200
export const DEFAULT_DAILY_QUOTA = 20
export const DEFAULT_TRIGGER_MODE = 'manual'
export const DEFAULT_VISIBILITY = 'private'

function stripQuotes(value) {
  const text = String(value ?? '').trim()
  if (text.length >= 2 && (text.startsWith('"') || text.startsWith("'")) && text.endsWith(text[0])) {
    return text.slice(1, -1)
  }
  return text
}

/** 把 frontmatter 的一行值解析成标量：数组 / 对象(JSON) / 布尔 / 整数 / 字符串。 */
function parseScalar(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return ''
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => stripQuotes(item))
      .filter((item) => item.length > 0)
  }
  if (value.startsWith('{') && value.endsWith('}')) {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+$/.test(value)) return Number(value)
  return stripQuotes(value)
}

/**
 * 解析 SKILL.md：`---` 包裹的 frontmatter + 正文。
 * 没有 frontmatter 时不报错（外部技能常见只有正文），返回空对象与原文本。
 */
export function parseSkillFrontmatter(markdown) {
  const text = String(markdown ?? '').replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (!match) return { frontmatter: {}, body: text.trim() }
  const frontmatter = {}
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf(':')
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    frontmatter[key] = parseScalar(trimmed.slice(separator + 1))
  }
  return { frontmatter, body: text.slice(match[0].length).trim() }
}

/**
 * 渲染成 SKILL.md 文本。
 * 必须与 parseSkillFrontmatter 往返一致（单测锁定），导出后的技能可以直接被别人装回去。
 */
export function renderSkillMarkdown(skill = {}) {
  const lines = ['---']
  const push = (key, value) => {
    if (value === undefined || value === null || value === '') return
    lines.push(`${key}: ${value}`)
  }
  push('name', skill.name)
  push('displayName', skill.displayName)
  push('description', skill.description)
  push('version', skill.version)
  if (skill.triggers && typeof skill.triggers === 'object') {
    push('triggers', JSON.stringify(skill.triggers))
  }
  lines.push('---', '', String(skill.body ?? '').trim())
  return lines.join('\n')
}

/** 账号级技能配置校验与默认值。非法枚举直接抛错，不静默纠正。 */
export function normalizeUserSkillConfig(input = {}) {
  const triggerMode = input.triggerMode ?? DEFAULT_TRIGGER_MODE
  if (!TRIGGER_MODES.has(triggerMode)) {
    throw new SkillValidationError('触发方式只能是 manual / auto / both。')
  }
  const defaultVisibility = input.defaultVisibility ?? DEFAULT_VISIBILITY
  if (!VISIBILITIES.has(defaultVisibility)) {
    throw new SkillValidationError('默认可见性只能是 private / review。')
  }
  const quota = Number(input.dailyQuota ?? DEFAULT_DAILY_QUOTA)
  const dailyQuota = Number.isInteger(quota)
    ? Math.max(0, Math.min(quota, MAX_DAILY_QUOTA))
    : DEFAULT_DAILY_QUOTA
  const fieldKeys = Array.isArray(input.fieldKeys)
    ? [...new Set(input.fieldKeys.filter((key) => typeof key === 'string' && key.length > 0))]
    : []
  return {
    enabled: Boolean(input.enabled),
    triggerMode,
    defaultVisibility,
    dailyQuota,
    fieldKeys,
  }
}

/**
 * 员工**不可修改**的技能参数（由管理员统一设置）。
 * 这些是成本与合规参数，不是个人偏好：把每日上限交给员工自调等于没有成本控制。
 */
export const LOCKED_SKILL_FIELDS = ['triggerMode', 'defaultVisibility', 'dailyQuota', 'fieldKeys', 'policy']

/**
 * 技能策略（管理员设定）校验：触发方式 / 每日 AI 整理上限 / 要整理的字段。
 * 非法枚举直接抛错，不静默纠正。
 */
export function normalizeSkillPolicy(input = {}) {
  const triggerMode = input.triggerMode ?? DEFAULT_SKILL_POLICY.triggerMode
  if (!TRIGGER_MODES.has(triggerMode)) {
    throw new SkillValidationError('触发方式只能是 manual / auto / both。')
  }
  const quota = Number(input.dailyQuota ?? DEFAULT_SKILL_POLICY.dailyQuota)
  const dailyQuota = Number.isInteger(quota)
    ? Math.max(0, Math.min(quota, MAX_DAILY_QUOTA))
    : DEFAULT_SKILL_POLICY.dailyQuota
  const fieldKeys = Array.isArray(input.fieldKeys)
    ? [...new Set(input.fieldKeys.filter((key) => typeof key === 'string' && key.length > 0))]
    : []
  return { triggerMode, dailyQuota, fieldKeys }
}

/**
 * 员工提交的技能补丁守卫：只接受 enabled，出现任何被锁定字段就报错。
 * 为什么选择报错而不是静默忽略：静默忽略会让界面显示"设置成功"但实际没生效，
 * 属于用假成功掩盖未实现逻辑。
 */
export function assertEditableSkillPatch(patch = {}) {
  if (!patch || typeof patch !== 'object') return {}
  const locked = LOCKED_SKILL_FIELDS.filter((key) => patch[key] !== undefined)
  if (locked.length > 0) {
    throw new SkillValidationError('触发方式、每日 AI 整理上限与字段集合由管理员统一设置，员工只能开关技能。')
  }
  return patch.enabled === undefined ? {} : { enabled: Boolean(patch.enabled) }
}

/**
 * 该账号实际要抽取的字段：按技能契约顺序返回，忽略配置里不存在的 key；
 * 未配置字段时返回全部字段（默认全部，语义上"都要"）。
 */
export function resolveDistillFields(skill, config = {}) {
  const schema = Array.isArray(skill?.fieldSchema) ? skill.fieldSchema : []
  if (schema.length === 0) return []
  const selected = Array.isArray(config.fieldKeys) ? config.fieldKeys : []
  if (selected.length === 0) return schema
  return schema.filter((field) => selected.includes(field.key))
}

export function serializeSkill(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    version: row.version,
    source: row.source,
    body: row.body,
    fieldSchema: row.field_schema ?? [],
    triggers: row.triggers ?? {},
    policy: normalizeSkillPolicy(row.policy ?? {}),
    enabled: row.enabled,
    updatedAt: row.updated_at,
  }
}

export async function listSkills({ includeDisabled = false } = {}) {
  const { rows } = await query(
    `SELECT id, name, display_name, description, version, source, body, field_schema, triggers,
            policy, enabled, updated_at
       FROM ai_skills
      ${includeDisabled ? '' : 'WHERE enabled = TRUE'}
      ORDER BY name`
  )
  return rows.map(serializeSkill)
}

export async function getSkillByName(name) {
  const { rows } = await query(
    `SELECT id, name, display_name, description, version, source, body, field_schema, triggers,
            policy, enabled, updated_at
       FROM ai_skills
      WHERE name = $1`,
    [name]
  )
  return serializeSkill(rows[0])
}

/**
 * 读取账号级技能配置。
 * 技能不存在时返回 null（调用方按 404 处理）；账号没配过时返回默认值（**默认关闭**）。
 */
export async function getUserSkill({ userId, skillName = DISTILL_SKILL_NAME }) {
  const skill = await getSkillByName(skillName)
  if (!skill) return null
  const { rows } = await query(
    `SELECT enabled, trigger_mode, default_visibility, daily_quota, config, updated_at
       FROM ai_user_skills
      WHERE user_id = $1 AND skill_id = $2`,
    [userId, skill.id]
  )
  const row = rows[0]
  const policy = normalizeSkillPolicy(skill.policy ?? {})
  // 有效配置 = 管理员策略 + 员工自己的开关。
  // 历史遗留的 ai_user_skills.trigger_mode / daily_quota 不再参与生效（策略已上收），
  // 保留列只为兼容旧数据，不再读取，避免"看起来能配、实际不生效"的假象。
  const config = {
    enabled: row?.enabled ?? false,
    triggerMode: policy.triggerMode,
    defaultVisibility: row?.default_visibility ?? DEFAULT_VISIBILITY,
    dailyQuota: policy.dailyQuota,
    fieldKeys: policy.fieldKeys,
  }
  return {
    skill: {
      name: skill.name,
      displayName: skill.displayName,
      description: skill.description,
      version: skill.version,
      // body 是提示词本体，抽取时必须带上：漏返回会让抽取提示词变成空串
      body: skill.body,
      fieldSchema: skill.fieldSchema,
      triggers: skill.triggers,
      enabled: skill.enabled,
    },
    policy,
    config,
    // 员工可改的字段只有开关；界面上其余输入项应渲染为只读
    editable: ['enabled'],
    configured: Boolean(row),
    updatedAt: row?.updated_at ?? null,
  }
}

/** 保存账号级技能配置（只作用于传入的 userId，接口层固定传当前登录账号）。 */
export async function saveUserSkill({ userId, skillName = DISTILL_SKILL_NAME, patch = {} }) {
  const skill = await getSkillByName(skillName)
  if (!skill) throw new SkillValidationError('技能不存在。')
  // 员工只能改开关：带锁定字段的补丁直接报错（不静默忽略）
  const editable = assertEditableSkillPatch(patch)
  const current = await getUserSkill({ userId, skillName })
  const enabled = editable.enabled ?? current.config.enabled
  await query(
    `INSERT INTO ai_user_skills
       (user_id, skill_id, enabled, trigger_mode, default_visibility, daily_quota, config)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (user_id, skill_id) DO UPDATE
       SET enabled = EXCLUDED.enabled,
           updated_at = NOW()`,
    [
      userId,
      skill.id,
      enabled,
      current.config.triggerMode,
      current.config.defaultVisibility,
      current.config.dailyQuota,
      JSON.stringify({}),
    ]
  )
  return { ...current.config, enabled }
}

/**
 * 管理员设置技能策略（触发方式 / 每日 AI 整理上限 / 字段集合）。
 * 只改 ai_skills.policy，不改任何员工行——策略对全部账号立即生效。
 */
export async function setSkillPolicy({ skillName = DISTILL_SKILL_NAME, patch = {} }) {
  const skill = await getSkillByName(skillName)
  if (!skill) throw new SkillValidationError('技能不存在。')
  const policy = normalizeSkillPolicy({ ...skill.policy, ...patch })
  const { rows } = await query(
    `UPDATE ai_skills SET policy = $2::jsonb, updated_at = NOW()
      WHERE name = $1
      RETURNING id, name, display_name, description, version, source, body, field_schema, triggers, policy, enabled, updated_at`,
    [skillName, JSON.stringify(policy)]
  )
  return { skill: serializeSkill(rows[0]), policy }
}

/** 管理员视图：技能 + 启用该技能的账号清单（用于「按账号查看沉淀技能」）。 */
export async function listUserSkillOverview({ skillName = DISTILL_SKILL_NAME } = {}) {
  const skill = await getSkillByName(skillName)
  if (!skill) return null
  const { rows } = await query(
    `SELECT us.user_id, u.login, u.name, us.enabled, us.trigger_mode, us.default_visibility,
            us.daily_quota, us.config, us.updated_at
       FROM ai_user_skills us
       JOIN users u ON u.id = us.user_id
      WHERE us.skill_id = $1
      ORDER BY us.enabled DESC, us.updated_at DESC`,
    [skill.id]
  )
  return {
    skill: {
      name: skill.name,
      displayName: skill.displayName,
      description: skill.description,
      version: skill.version,
      fieldSchema: skill.fieldSchema,
      triggers: skill.triggers,
      policy: skill.policy,
      enabled: skill.enabled,
    },
    accounts: rows.map((row) => ({
      userId: row.user_id,
      login: row.login,
      name: row.name,
      enabled: row.enabled,
      triggerMode: row.trigger_mode,
      defaultVisibility: row.default_visibility,
      dailyQuota: row.daily_quota,
      fieldKeys: row.config?.fieldKeys ?? [],
      updatedAt: row.updated_at,
    })),
  }
}

/** 管理员全局启停技能（停用后所有账号都不能新增沉淀）。 */
export async function setSkillEnabled({ skillName = DISTILL_SKILL_NAME, enabled }) {
  const { rows } = await query(
    `UPDATE ai_skills SET enabled = $2, updated_at = NOW() WHERE name = $1
     RETURNING id, name, display_name, description, version, source, body, field_schema, triggers, policy, enabled, updated_at`,
    [skillName, Boolean(enabled)]
  )
  return serializeSkill(rows[0])
}

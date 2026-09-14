/** AI 助手模块的展示格式化工具（与组件分开，避免影响 fast refresh）。 */

export function formatDate(value?: string | null): string {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知'
  return date.toISOString().slice(0, 10)
}

export function formatTime(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { hour12: false })
}

export const SOURCE_LABELS: Record<string, string> = {
  feishu: '飞书同步',
  upload: '人工上传',
  experience: '员工经验',
}

/** 沉淀状态文案（与 server/ai-agent/notes.mjs 的 NOTE_STATUS_LABELS 保持一致）。 */
export const NOTE_STATUS_LABELS: Record<string, string> = {
  private: '私有草稿',
  pending: '待审核',
  published: '已发布',
  rejected: '已驳回',
  archived: '已归档',
}

/** 沉淀来源文案。 */
export const NOTE_SOURCE_LABELS: Record<string, string> = {
  manual: '手工新建',
  conversation: '会话沉淀',
  feedback: '纠错沉淀',
}

/** 来源可信度：模型推断的经验必须与本人所写区分（审核人先看这一项）。 */
export const NOTE_PROVENANCE_LABELS: Record<string, string> = {
  user_stated: '本人所写',
  inferred: '模型推断',
}

/** 触发方式文案。 */
export const NOTE_TRIGGER_LABELS: Record<string, string> = {
  manual: '仅手动',
  auto: '自动（下一轮上线）',
  both: '自动 + 手动（下一轮上线）',
}

/**
 * 能否编辑这条沉淀（与 server/ai-agent/notes.mjs 的规则一一对应）。
 *
 * 待审核：审核人看到的必须与员工提交的完全一致，审核期间员工不允许改（服务端返回 409），
 *        管理员可以改（管理页修正待审内容，但服务端会写审计）；
 * 已发布：内容已生成公共知识库文档，改条目不会同步文档，必须先归档。
 * 前端禁用只是提示，真正的拦截在服务端——不要把这个函数当权限控制用。
 */
export function canEditNote(
  note: { status: string },
  scope: 'self' | 'admin' = 'self'
): boolean {
  if (note.status === 'published') return false
  if (scope === 'admin') return true
  return note.status !== 'pending'
}

/** 待审核/已发布条目不可编辑的原因文案（悬浮提示与按钮禁用提醒共用）。 */
export const NOTE_LOCKED_HINTS: Record<string, string> = {
  pending: '审核期间不能修改：审核人看到的必须是你提交的那一版',
  published: '已进入公司知识库，不能直接修改；如需更新请归档后重新沉淀',
}

/**
 * 删除权限：已发布条目不能删除。
 *
 * 原因：审核通过后会生成 `source_type='experience'` 的公共文档并可能被检索引用，
 * 删掉条目会让文档变成无主知识、也无法再从文档回溯到来源（`source_ref` 指向已删行）。
 * 需要下架请先归档 —— 归档会在同一事务里把公共文档一起下线。
 * 与 `server/ai-agent/notes.mjs` 的 `deleteNote` 守卫一一对应；前端禁用只是提示。
 */
export function canDeleteNote(note: { status: string }): boolean {
  return note.status !== 'published'
}

/** 已发布条目删除按钮的悬浮提示。 */
export const NOTE_DELETE_HINT =
  '已发布到知识库的沉淀不能删除；如需下架请先归档（归档会同时下线对应的公共文档）'

/**
 * 归档权限：已发布条目的归档在服务端要求管理员（published->archived = admin），
 * 员工侧按钮必须同步禁用，否则点了必然报错。
 */
export function canArchiveNote(note: { status: string }, scope: 'self' | 'admin' = 'self'): boolean {
  if (note.status === 'archived') return false
  if (scope === 'admin') return true
  return note.status !== 'published'
}

export const NOTE_ARCHIVE_HINTS: Record<string, string> = {
  published: '已发布条目的归档由管理员在「沉淀管理」页执行',
  archived: '已归档',
}

/** 状态徽章样式：待审核要显眼，已发布用主色，驳回用警示色。 */
export const NOTE_STATUS_VARIANTS: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  private: 'outline',
  pending: 'default',
  published: 'secondary',
  rejected: 'destructive',
  archived: 'outline',
}

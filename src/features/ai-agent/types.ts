/**
 * AI 助手模块共享类型（与 server/ai-agent 的序列化字段一一对应）。
 */

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'ok' | 'blocked' | 'error'
export type RunStatus = 'pending' | 'ok' | 'blocked' | 'error'
export type DocumentStatus = 'active' | 'inactive'
export type SourceType = 'feishu' | 'upload' | 'experience'
export type ProviderMode = 'live' | 'demo'

export interface ToolRun {
  id: number
  toolName: string
  params: Record<string, unknown>
  summary: string | null
  rowCount: number | null
  status: RunStatus
  error: string | null
  latencyMs: number | null
  createdAt: string
}

export interface Citation {
  kind: 'document' | 'dataset'
  title: string
  sourceType: SourceType | 'dataset'
  updatedAt?: string | null
  /** 文档引用字段 */
  documentId?: number
  docVersion?: number
  chunkIndex?: number
  submitter?: string | null
  snippet?: string
  /** 数据集引用字段 */
  dataset?: string
  importedAt?: string | null
  periodEnd?: string | null
  rowCount?: number
}

export interface AnswerMetricItem {
  key: string
  label: string
  /** metrics 块用 value；对比块用 current/previous/delta */
  value?: number | string | null
  unit?: string
  current?: number | null
  previous?: number | null
  delta?: number | null
  deltaPct?: number | null
}

export interface AnswerTableColumn {
  key: string
  label: string
  align?: 'left' | 'right'
}

export interface AnswerChartSeries {
  key: string
  label: string
  kind?: 'line' | 'bar'
}

/** 回答卡片的结构化数据块，由服务端生成、前端渲染 */
export interface AnswerBlock {
  kind: 'metrics' | 'table' | 'chart'
  title?: string
  dataset?: string | null
  note?: string | null
  /** metrics */
  items?: AnswerMetricItem[]
  /** table */
  columns?: AnswerTableColumn[]
  rows?: Record<string, unknown>[]
  totalRows?: number
  truncated?: boolean
  /** chart */
  chartType?: 'line' | 'bar'
  xKey?: string
  series?: AnswerChartSeries[]
  data?: Record<string, unknown>[]
}

export interface DataFreshnessItem {
  dataset: string
  label?: string
  importedAt: string | null
  documentCount?: number
  note?: string
}

export interface ProviderInfo {
  name: string
  mode: ProviderMode
  model: string
  demo: boolean
}

export interface AiMessage {
  id: number
  role: MessageRole
  content: string
  status: MessageStatus
  provider: string | null
  model: string | null
  tokensIn: number | null
  tokensOut: number | null
  latencyMs: number | null
  citations: Citation[]
  blocks: AnswerBlock[]
  createdAt: string
  runs: ToolRun[]
}

export interface Conversation {
  id: number
  title: string
  messageCount: number
  pinned: boolean
  problemCount?: number
  createdAt: string
  updatedAt: string
  lastMessageAt: string | null
}

export interface ToolInfo {
  name: string
  description: string
  paramsSchema: Record<string, unknown>
  requiredRole: 'user' | 'admin'
  enabled: boolean
}

export interface KnowledgeDocument {
  id: number
  title: string
  sourceType: SourceType
  sourceRef: string | null
  docVersion: number
  category: string | null
  status: DocumentStatus
  effectiveAt: string | null
  expiresAt: string | null
  chunkCount: number
  createdByName: string | null
  correctionCount: number
  createdAt: string
  updatedAt: string
}

export interface DocumentChunk {
  id: number
  chunkIndex: number
  content: string
  tokenCount: number | null
  createdAt: string
}

export interface CorrectionFeedback {
  id: number
  type: 'helpful' | 'unhelpful' | 'correction'
  comment: string | null
  messageId: number
  conversationId: number
  answerExcerpt: string
  citations: Citation[]
  reporterName: string | null
  reporterLogin: string | null
  createdAt: string
}

export interface AuditRunRow extends ToolRun {
  messageId: number
  user: { id: number; login: string; name: string; role: string }
}

export interface AuditLogRow {
  id: number
  action: string
  targetType: string | null
  targetId: string | null
  detail: Record<string, unknown>
  ip: string | null
  createdAt: string
  actor: { id: number; login: string; name: string; role: string } | null
}

export interface AuditConversationRow {
  id: number
  title: string
  messageCount: number
  createdAt: string
  lastMessageAt: string | null
  user: { id: number; login: string; name: string; role: string }
}

export interface AiSettings {
  modelProvider: string
  modelName: string
  modelBaseUrl: string
  forceDemo: boolean
  temperature: number
  maxOutputTokens: number
  maxTurnsPerConversation: number
  retrievalTopK: number
  requestTimeoutMs: number
  updatedAt?: string
  /** 密钥相关：只有掩码与状态，服务端从不回传明文 */
  apiKeyConfigured: boolean
  apiKeyHint: string | null
  apiKeyUpdatedAt: string | null
  apiKeyInvalid: boolean
  keySource: 'database' | 'environment' | 'none'
  effectiveMode: 'live' | 'demo'
}

export interface ModelConnectionTestResult {
  ok: boolean
  message: string
  latencyMs?: number
  model?: string
  baseUrl?: string
  keySource?: string
  sample?: string
  tokensIn?: number
  tokensOut?: number
  effectiveMode?: string
}

export interface UsageRow {
  day: string
  answers: number
  tokensIn: number
  tokensOut: number
}

export interface FeedbackType {
  type: 'helpful' | 'unhelpful' | 'correction'
  comment?: string
}

/** 流式过程可见：编排进展步骤。 */
export interface StreamStep {
  key: string
  label: string
  state: 'running' | 'done' | 'failed'
  toolName?: string
}

export interface ChatStreamState {
  conversationId: number | null
  question: string
  text: string
  steps: StreamStep[]
  citations: Citation[]
  blocks: AnswerBlock[]
  toolRuns: ToolRun[]
  provider: ProviderInfo | null
  status: 'streaming' | 'blocked' | 'error' | 'done'
  errorMessage: string | null
}

export interface DatasetColumnBrief {
  key: string
  label: string
  required: boolean
}

export interface DatasetOverviewItem {
  key: string
  label: string
  description: string
  rows: number
  columns: DatasetColumnBrief[]
  importedAt: string | null
  lastImportAt: string | null
  lastImportStatus: 'ok' | 'failed' | null
  lastImportError: string | null
  periodStart: string | null
  periodEnd: string | null
}

export interface DatasetImportRow {
  id: number
  dataset: string
  datasetLabel: string
  fileName: string
  mode: 'overwrite' | 'append'
  periodStart: string | null
  periodEnd: string | null
  rowCount: number
  failedRows: number
  failReason: string | null
  status: 'ok' | 'failed'
  importedAt: string
  importedByName: string | null
  importedByLogin: string | null
}

export interface DatasetImportResult {
  ok: boolean
  importId: number | null
  inserted: number
  skipped: number
  rowCount: number
  failedRows: number
  period: { start: string | null; end: string | null } | null
  ignoredColumns: string[]
  rowErrors: Array<{ line: number; column: string; reason: string }>
  encoding: string | null
  error: string | null
}

/* ---------- 知识沉淀（账号级） ---------- */

export type NoteStatus =
  | 'private'
  | 'pending'
  | 'published'
  | 'rejected'
  | 'archived'
export type NoteSourceKind = 'manual' | 'conversation' | 'feedback'
export type NoteProvenance = 'user_stated' | 'inferred'

/** 沉淀字段定义（来自技能契约，服务端下发） */
export interface NoteFieldDef {
  key: string
  label: string
  hint: string
  required: boolean
}

export interface KnowledgeNote {
  id: number
  ownerUserId: number
  ownerLogin: string | null
  ownerName: string | null
  title: string
  summary: string
  evidence: string
  fields: Record<string, string>
  tags: string[]
  status: NoteStatus
  sourceKind: NoteSourceKind
  conversationId: number | null
  messageIds: number[]
  skillName: string | null
  provider: string | null
  model: string | null
  tokensIn: number
  tokensOut: number
  noteVersion: number
  mergedFrom: number[]
  /** 新修订指向被替代的旧版本条目（同标题再次沉淀且旧版本已发布时） */
  revisionOfNoteId: number | null
  /** 模型抽取失败降级为原文草稿：界面必须提示"字段待补充" */
  degraded: boolean
  provenance: NoteProvenance
  publishedDocumentId: number | null
  reviewedBy: number | null
  reviewerName: string | null
  reviewComment: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface NoteListResult {
  rows: KnowledgeNote[]
  total: number
  page: number
  pageSize: number
}

export type SkillTriggerMode = 'manual' | 'auto' | 'both'

/** 技能策略：管理员统一设置的成本与合规参数（员工不可改） */
export interface SkillPolicy {
  triggerMode: SkillTriggerMode
  dailyQuota: number
  fieldKeys: string[]
}

export interface UserSkillConfig {
  enabled: boolean
  triggerMode: SkillTriggerMode
  defaultVisibility: 'private' | 'review'
  dailyQuota: number
  fieldKeys: string[]
}

export interface SkillBrief {
  name: string
  displayName: string
  description: string
  version: string
  body?: string
  fieldSchema: NoteFieldDef[]
  triggers: Record<string, unknown>
  policy?: SkillPolicy
  enabled: boolean
  source?: string
}

export interface UserSkillState {
  skill: SkillBrief
  /** 管理员策略（只读展示，员工不可改）；服务端版本不一致时可能缺失，界面需兜底 */
  policy?: SkillPolicy
  /** 有效配置 = 策略 + 员工开关 */
  config: UserSkillConfig
  /** 当前账号可修改的字段，员工只有 enabled */
  editable: string[]
  configured: boolean
  updatedAt: string | null
}

export interface DistillDraft {
  title: string
  summary: string
  evidence: string
  fields: Record<string, string>
  degraded: boolean
  /** 模型给出的原文依据没有通过服务端逐字核对，已置空（界面提示"原文依据待补充"） */
  evidenceRejected?: boolean
}

export interface DistillPreview {
  draft: DistillDraft
  parseError: string | null
  fields: NoteFieldDef[]
  conversation: { id: number; title: string }
  quota: { used: number; limit: number }
}

export interface NoteAccountStat {
  userId: number
  login: string
  name: string
  total: number
  pending: number
  published: number
  lastAt: string
}

export interface DistillStats {
  total: number
  pending: number
  published: number
  private: number
  accounts: number
  byAccount: NoteAccountStat[]
}

export interface SkillAccountRow {
  userId: number
  login: string
  name: string
  enabled: boolean
  triggerMode: SkillTriggerMode
  defaultVisibility: string
  dailyQuota: number
  fieldKeys: string[]
  updatedAt: string
}

export interface SkillOverview {
  skill: SkillBrief
  accounts: SkillAccountRow[]
  skills: SkillBrief[]
}

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
  /**
   * 列底色分组（1~5，对应主题的 `--chart-1..5` 分类色）。
   *
   * 用途：一张表里并列两套同构字段时（「按日对比」里本品与竞品各 7 列），
   * 光靠表头分组还不够醒目 —— 整组列铺**同一层淡色底**，扫表时一眼能分出"这几列是一家的"。
   * 颜色取主题分类色、透明度很低（10%/20%），**不抢数字**；不填则不加底色。
   */
  tone?: number
}

/**
 * 表头的**分组行**（`colSpan` 分组）。
 *
 * 用途：一张表里并列两套同构字段时（例如「按日对比」里本品与竞品各 7 个指标），
 * 单行表头只能把归属写进每一列的标签里（`花费 本品` / `花费 竞品1`…），读起来重复且不明显。
 * 分组表头把归属提到一整行上：第一行是 `本品 | 竞品1`，第二行才是各自的字段名。
 *
 * 约定：`groups` **只描述除首列以外的列**，`span` 之和必须等于 `columns.length - 1`；
 * 首列（日期/名称那类）由渲染层自动 `rowSpan=2`，不必也不应写进 `groups`。
 */
export interface AnswerTableGroup {
  label: string
  span: number
  /** 与所辖列的 `tone` 一致；分组表头用更浓一档的同色，形成色带。 */
  tone?: number
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
  /** table：可选的分组表头（见 `AnswerTableGroup` 的约定） */
  groups?: AnswerTableGroup[]
  /**
   * 数据行。
   *
   * 每行可以带一个可选的 **`__tone`（1~5，主题分类色）作为行级归属色**：一张表里
   * "一行属于本品、另一行属于竞品"时（竞品分析的 TOP 流量词、差评高频词），
   * 归属写在**角色列**里，列上没法着色（同一列里混着两家），改由**整行铺淡色底**区分 ——
   * 与列上的 `tone` 用同一块色板、同一档透明度（见 `answer-blocks.tsx` 的 `toneClass`）。
   *
   * 约定：`__tone` 只是**渲染元数据** —— 它不产生列、不参与排序、不参与任何计算，
   * 排序后跟着行一起走（渲染层读的是 `row.original`）。越界（0 / 负数 / >5）一律不加底色。
   */
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
  /**
   * 拦截的细分原因（`tool_unavailable` / `forbidden` / `wording:*`）。
   *
   * `status === 'blocked'` 只说"被拦了"：工具没上线（后端没重启）与真的没权限处置完全不同，
   * 提示文案必须分开（2026-09-17 实测踩到过）。`null` 表示旧记录、未记录原因。
   */
  blockReason?: string | null
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
  /** 工具来源：内置实现，还是从 MCP 服务同步进来的远端工具。 */
  source?: 'builtin' | 'mcp'
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
  /** 卖家精灵 MCP：同样只回掩码与状态，明文永不回传 */
  mcpEnabled: boolean
  mcpEndpoint: string
  mcpPrefix: string
  mcpTimeoutMs: number
  mcpSecretConfigured: boolean
  mcpSecretHint: string | null
  mcpSecretUpdatedAt: string | null
  mcpSecretInvalid: boolean
  mcpKeySource: 'database' | 'environment' | 'none'
  /** 配好了不等于能用：必须「已启用 + 密钥可解密」才算就绪 */
  mcpReady: boolean
  mcpSyncedAt: string | null
}

export interface McpToolTestItem {
  name: string
  remoteName?: string
  description: string
}

export interface McpConnectionTestResult {
  ok: boolean
  message: string
  kind?: string
  endpoint?: string
  toolCount?: number
  latencyMs?: number
  remoteTools?: McpToolTestItem[]
}

export interface McpSyncResult {
  ok: boolean
  message: string
  endpoint?: string
  prefix?: string
  toolCount?: number
  added?: number
  updated?: number
  removed?: string[]
  tools?: McpToolTestItem[]
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

/**
 * 流式问答的临时状态（`stream`）。
 *
 * **不含依据（2026-09-15 取消右栏后下线）**：依据由回答卡片从落库消息的
 * `AiMessage.citations` 读取并就地展开，流式状态再存一份只会多出一个真相。
 */
export interface ChatStreamState {
  conversationId: number | null
  /** 服务端落库的本轮用户消息 ID；用于避免重复问题文本造成错误去重。 */
  userMessageId?: number | null
  /**
   * 服务端落库的本轮助手消息 ID（`done.messageId`）。
   *
   * 2026-09-22 新增：`send()` 收尾是「先 `await refresh()` 再 `setStream(null)`」，
   * 而 refresh 一让 React Query 写入缓存，`persisted` 里就有了这一问一答 ——
   * 用这对 id 判断"问答是否已落库"，可以在这个窗口里撤下流式卡片，避免同一问答渲染两份。
   * 中止 / 报错时该值为 `null`（没有落库回答），此时不撤卡片。
   */
  assistantMessageId?: number | null
  question: string
  text: string
  steps: StreamStep[]
  blocks: AnswerBlock[]
  toolRuns: ToolRun[]
  provider: ProviderInfo | null
  status: 'streaming' | 'blocked' | 'error' | 'done'
  errorMessage: string | null
  /** 实时流的拦截细分原因（与 `AiMessage.blockReason` 同义）。 */
  blockReason?: string | null
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

/** 行详情的展示列：模板列 + 数据集附加列（如库存快照的快照时间）。 */
export interface DatasetRowColumn {
  key: string
  label: string
  type: 'date' | 'string' | 'integer' | 'decimal' | 'marketplace' | 'timestamp'
  required: boolean
}

/** 行详情按需拉取（点开卡片才请求），因此单独成接口，不塞进 `/ai/datasets` 清单。 */
export interface DatasetRowsResult {
  dataset: string
  label: string
  description: string
  columns: DatasetRowColumn[]
  rows: Array<Record<string, string | number | null>>
  total: number
  page: number
  pageSize: number
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

/* ---------- 提示词广场 ---------- */

/** 提示词状态，与后端 `ai_prompts.status` 一致。 */
export type PromptStatus = 'private' | 'pending' | 'published' | 'rejected'

/**
 * 列表范围：
 * - `mine` 我的（含待审与已驳回，状态由徽标区分）
 * - `published` 共享池（审核通过后全员可用）
 * - `usable` 二者合并，供对话内 `@` 浮层使用
 */
export type PromptScope = 'mine' | 'published' | 'usable'

export interface AiPrompt {
  id: number
  name: string
  /**
   * 「标题」字段已下线（2026-09-15，按用户要求）：一条提示词只保留名称。
   * 服务端仍保留 `ai_prompts.title` 列与历史值（不删数据），但接口不再返回。
   */
  body: string
  summary: string
  tags: string[]
  status: PromptStatus
  usageCount: number
  /** 当前用户是否为作者（列表接口返回） */
  isOwner?: boolean
  /** 作者登录名（审核队列返回） */
  ownerLogin?: string
  reviewComment: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * 列表接口统一的分页信封。
 *
 * 服务端所有分页接口都返回这三个字段（`parsePageQuery` 解析 `page`/`pageSize`，
 * `pageSize` 上限 100），前端不再各自猜"有没有 total"。
 */
export interface PageMeta {
  total: number
  page: number
  pageSize: number
}

export interface ConversationListResult extends PageMeta {
  conversations: Conversation[]
}

export interface PromptListResult extends PageMeta {
  prompts: AiPrompt[]
}

/**
 * 审核队列：`pendingTotal` 是**待审总数**（页签角标口径，与当前筛选无关），
 * 与列表的 `total`（当前筛选下的总条数）不是同一个数，不要混用。
 */
export interface PromptReviewListResult extends PromptListResult {
  pendingTotal: number
}

/** 新建 / 编辑提示词的入参（编辑时字段可部分缺省）。标题已下线，不再提交。 */
export interface PromptInput {
  name: string
  body: string
  summary?: string
  tags?: string[]
}

/**
 * AI 优化提示词正文的结果。
 *
 * 只是**建议**：不落库、不改状态 —— 用户在弹窗里点「采用」才替换正文，
 * 再点「保存」才写库。`truncated` 为真时必须提示，不能静默丢内容。
 */
export interface PromptOptimizeResult {
  body: string
  truncated: boolean
  /** 实际使用的模型名；演示模式下接口直接拒绝，因此这里是真实模型名 */
  model: string | null
  demo: boolean
}

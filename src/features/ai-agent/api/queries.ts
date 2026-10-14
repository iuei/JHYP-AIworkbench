/**
 * AI 助手数据访问层（React Query）。
 * 组件不得散落 fetch / axios，统一通过本文件的 hook 访问接口。
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { api, rawRequest } from '@/api/client'
import type {
  AiMessage,
  AiPrompt,
  AiSettings,
  AuditConversationRow,
  AuditLogRow,
  AuditRunRow,
  Conversation,
  ConversationListResult,
  CorrectionFeedback,
  DataFreshnessItem,
  DatasetImportResult,
  DatasetImportRow,
  DatasetOverviewItem,
  DatasetRowsResult,
  DistillPreview,
  DistillStats,
  DocumentChunk,
  FeedbackType,
  KnowledgeDocument,
  KnowledgeNote,
  McpConnectionTestResult,
  McpSyncResult,
  ModelConnectionTestResult,
  NoteListResult,
  PromptInput,
  PromptListResult,
  PromptOptimizeResult,
  PromptReviewListResult,
  PromptScope,
  ProviderInfo,
  SkillBrief,
  SkillOverview,
  SkillPolicy,
  ToolInfo,
  UsageRow,
  UserSkillConfig,
  UserSkillState,
} from '../types'

export const aiQueryKeys = {
  tools: ['ai', 'tools'] as const,
  conversations: (keyword?: string) =>
    ['ai', 'conversations', keyword ?? ''] as const,
  messages: (conversationId: number | null) =>
    ['ai', 'messages', conversationId ?? 0] as const,
  documents: (params: Record<string, unknown>) =>
    ['ai', 'documents', params] as const,
  /** 员工面（团队知识库）：与管理员列表分开缓存，避免两处互相污染 */
  publicDocuments: (params: Record<string, unknown>) =>
    ['ai', 'public-documents', params] as const,
  chunks: (documentId: number | null) =>
    ['ai', 'chunks', documentId ?? 0] as const,
  publicChunks: (documentId: number | null) =>
    ['ai', 'public-chunks', documentId ?? 0] as const,
  feedback: ['ai', 'knowledge-feedback'] as const,
  freshness: ['ai', 'freshness'] as const,
  datasets: ['ai', 'datasets'] as const,
  datasetRows: (params: Record<string, unknown>) =>
    ['ai', 'dataset-rows', params] as const,
  imports: (params: Record<string, unknown>) =>
    ['ai', 'imports', params] as const,
  auditConversations: (params: Record<string, unknown>) =>
    ['ai', 'audit-conversations', params] as const,
  auditTrace: (conversationId: number | null) =>
    ['ai', 'audit-trace', conversationId ?? 0] as const,
  auditRuns: (params: Record<string, unknown>) =>
    ['ai', 'audit-runs', params] as const,
  auditLogs: (params: Record<string, unknown>) =>
    ['ai', 'audit-logs', params] as const,
  usage: (days: number) => ['ai', 'usage', days] as const,
  settings: ['ai', 'settings'] as const,
  notes: (params: Record<string, unknown>) => ['ai', 'notes', params] as const,
  mySkill: ['ai', 'notes', 'skill'] as const,
  distillNotes: (params: Record<string, unknown>) =>
    ['ai', 'distill', 'notes', params] as const,
  distillStats: ['ai', 'distill', 'stats'] as const,
  distillSkills: ['ai', 'distill', 'skills'] as const,
  prompts: (params: Record<string, unknown>) =>
    ['ai', 'prompts', params] as const,
  distillPrompts: (params: Record<string, unknown>) =>
    ['ai', 'distill', 'prompts', params] as const,
}

function queryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

/* ---------- 对话 ---------- */

export function useAiTools() {
  return useQuery({
    queryKey: aiQueryKeys.tools,
    queryFn: async () => {
      const { data } = await api.get<{
        tools: ToolInfo[]
        provider: ProviderInfo
      }>('/ai/tools')
      return data
    },
    staleTime: 60_000,
  })
}

/** 会话列表每页条数：与左栏滚动区域的高度相称，滚到这里再点「加载更多」。 */
const CONVERSATION_PAGE_SIZE = 20

/**
 * 工作台会话列表（累积式分页）。
 *
 * 服务端 2026-09-15 起返回 `total`/`page`/`pageSize`：此前是 `LIMIT 100` 的**固定截断**，
 * 超过 100 个会话的用户在第 101 条起什么都看不到、界面上也没有任何提示。
 *
 * 用累积分页而不是 `TablePagination`：左栏是一条按"置顶 / 今天 / 昨天…"分组的滚动时间轴，
 * 在其中嵌一个带页码与"每页条数"的分页器既占高度，也和分组语义打架。
 */
export function useInfiniteConversations(keyword?: string) {
  return useInfiniteQuery({
    queryKey: aiQueryKeys.conversations(keyword),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get<ConversationListResult>(
        `/ai/conversations${queryString({
          keyword,
          page: pageParam,
          pageSize: CONVERSATION_PAGE_SIZE,
        })}`
      )
      return data
    },
    getNextPageParam: (lastPage) =>
      lastPage.page * lastPage.pageSize < lastPage.total
        ? lastPage.page + 1
        : undefined,
  })
}

export function useConversationMessages(conversationId: number | null) {
  return useQuery({
    queryKey: aiQueryKeys.messages(conversationId),
    enabled: Boolean(conversationId),
    queryFn: async () => {
      const { data } = await api.get<{ messages: AiMessage[] }>(
        `/ai/conversations/${conversationId}/messages`
      )
      return data.messages
    },
  })
}

export function useRenameConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      title,
      pinned,
    }: {
      id: number
      title?: string
      pinned?: boolean
    }) => {
      const { data } = await api.patch<{ conversation: Conversation }>(
        `/ai/conversations/${id}`,
        { title, pinned }
      )
      return data.conversation
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'conversations'] })
    },
  })
}

export function useDeleteConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/ai/conversations/${id}`)
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'conversations'] })
      // 会话已不存在：把它的消息一并从缓存移除，免得"删了还能看到旧消息"，
      // 也避免同一 key 上残留的 404 错误状态被下一次选中读到。
      queryClient.removeQueries({ queryKey: aiQueryKeys.messages(id) })
    },
  })
}

export function useMessageFeedback() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      messageId,
      ...payload
    }: FeedbackType & { messageId: number }) => {
      const { data } = await api.post(
        `/ai/messages/${messageId}/feedback`,
        payload
      )
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'knowledge-feedback'] })
    },
  })
}

/* ---------- 知识库（管理员） ---------- */

export function useKnowledgeDocuments(params: {
  page?: number
  pageSize?: number
  status?: string
  sourceType?: string
  keyword?: string
}) {
  return useQuery({
    queryKey: aiQueryKeys.documents(params),
    queryFn: async () => {
      const { data } = await api.get<{
        documents: KnowledgeDocument[]
        total: number
        page: number
        pageSize: number
      }>(`/ai/knowledge/documents${queryString(params)}`)
      return data
    },
  })
}

/**
 * 团队知识库文档列表（员工只读，`/api/ai/knowledge/public/*`）。
 *
 * 与管理员的 `useKnowledgeDocuments` **刻意分开**：两者打不同接口、缓存键也不同。
 * 员工面只回生效中的文档、且不含治理口径字段（纠错数等），共用一份缓存会让两边互相污染
 * —— 治理页刚做完下线，团队库那边不该还显示着缓存里的旧列表。
 */
export function usePublicKnowledgeDocuments(params: {
  page?: number
  pageSize?: number
  sourceType?: string
  keyword?: string
}) {
  return useQuery({
    queryKey: aiQueryKeys.publicDocuments(params),
    queryFn: async () => {
      const { data } = await api.get<{
        documents: KnowledgeDocument[]
        total: number
        page: number
        pageSize: number
      }>(`/ai/knowledge/public/documents${queryString(params)}`)
      return data
    },
  })
}

/**
 * 文档切片正文。
 *
 * `scope` 决定打哪一组接口：管理员在治理页核对引用来源时用 `admin`；
 * 「知识库 → 团队知识库」里员工查看正文用 `public`
 * （服务端会再校验该文档是否生效中，已下线的返回 404）。
 */
export function useDocumentChunks(
  documentId: number | null,
  scope: 'admin' | 'public' = 'admin'
) {
  return useQuery({
    queryKey:
      scope === 'public'
        ? aiQueryKeys.publicChunks(documentId)
        : aiQueryKeys.chunks(documentId),
    enabled: Boolean(documentId),
    queryFn: async () => {
      const base =
        scope === 'public'
          ? '/ai/knowledge/public/documents'
          : '/ai/knowledge/documents'
      const { data } = await api.get<{ chunks: DocumentChunk[] }>(
        `${base}/${documentId}/chunks`
      )
      return data.chunks
    },
  })
}

export function useCreateDocumentFromText() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      title: string
      content: string
      category?: string
      expiresAt?: string | null
    }) => {
      const { data } = await api.post<{ document: KnowledgeDocument }>(
        '/ai/knowledge/documents',
        payload
      )
      return data.document
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['ai', 'freshness'] })
    },
  })
}

/**
 * 文件上传：用原始 body + X-File-Name 头传输，避免为一期引入 multipart 依赖。
 * 文件名必须 encodeURIComponent —— HTTP 头不允许非 ASCII 字符。
 */
export function useUploadDocumentFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      file,
      expiresAt,
    }: {
      file: File
      expiresAt?: string | null
    }) => {
      const response = await rawRequest(
        `/ai/knowledge/documents/upload${queryString({ title: file.name, expiresAt })}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/octet-stream',
            'x-file-name': encodeURIComponent(file.name),
          },
          body: await file.arrayBuffer(),
        }
      )
      const text = await response.text()
      const parsed = text
        ? (JSON.parse(text) as {
            message?: string
            document?: KnowledgeDocument
          })
        : {}
      // 非 2xx 已由 rawRequest 抛出（带服务端的中文原因），这里只处理成功响应体
      if (!parsed.document)
        throw new Error(parsed.message ?? '上传失败，请稍后重试。')
      return parsed.document
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['ai', 'freshness'] })
    },
  })
}

export function useUpdateDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      ...payload
    }: {
      id: number
      status?: 'active' | 'inactive'
      expiresAt?: string | null
    }) => {
      const { data } = await api.patch(`/ai/knowledge/documents/${id}`, payload)
      return data.document
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'documents'] })
    },
  })
}

export function useDeleteDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/ai/knowledge/documents/${id}`)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['ai', 'freshness'] })
    },
  })
}

/**
 * 批量操作结果：服务端逐条执行、逐条写审计，因此前端必须能展示"哪几条没成、为什么"。
 * 部分失败不是请求失败，用 failed 与 results[].message 表达。
 */
export type BatchActionResult = {
  action: string
  requested: number
  succeeded: number
  failed: number
  results: { id: number; ok: boolean; title?: string; message?: string }[]
}

/**
 * 知识库批量下线 / 启用 / 删除（管理员）。
 *
 * 走服务端批量接口而不是前端循环调用单条接口：一次请求完成、单条失败不牵连整批，
 * 且每一条都会各自写审计（审计台仍能回答"这一篇是谁在什么时候下线的"）。
 */
export function useBatchDocuments() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      action: 'offline' | 'online' | 'delete'
      ids: number[]
    }) => {
      const { data } = await api.post<BatchActionResult>(
        '/ai/knowledge/documents/batch',
        payload
      )
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['ai', 'freshness'] })
    },
  })
}

export function useReindexKnowledge() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{
        result: { documents: number; chunks: number; refreshedAt: string }
      }>('/ai/knowledge/reindex')
      return data.result
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'documents'] })
    },
  })
}

export function useCorrectionFeedback() {
  return useQuery({
    queryKey: aiQueryKeys.feedback,
    queryFn: async () => {
      const { data } = await api.get<{ feedback: CorrectionFeedback[] }>(
        '/ai/knowledge/feedback'
      )
      return data.feedback
    },
  })
}

export function useMarkFeedbackHandled() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.post(`/ai/knowledge/feedback/${id}/handled`)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiQueryKeys.feedback })
    },
  })
}

export function useDatasets() {
  return useQuery({
    queryKey: aiQueryKeys.datasets,
    queryFn: async () => {
      const { data } = await api.get<{
        datasets: DatasetOverviewItem[]
        recentImports: DatasetImportRow[]
      }>('/ai/datasets')
      return data
    },
  })
}

/**
 * 数据集行详情（管理员）：点开数据源卡片才拉取。
 *
 * dataset 为空时不发请求（`enabled`），因此弹窗关闭期间不会产生无谓请求；
 * 关键词走服务端筛选而不是前端过滤——数据集行数上万，前端过滤要先拉全量。
 */
export function useDatasetRows(params: {
  dataset: string | null
  page?: number
  pageSize?: number
  keyword?: string
}) {
  return useQuery({
    queryKey: aiQueryKeys.datasetRows(params),
    enabled: Boolean(params.dataset),
    queryFn: async () => {
      const { data } = await api.get<DatasetRowsResult>(
        `/ai/datasets/rows${queryString(params)}`
      )
      return data
    },
    // 翻页回来直接命中缓存，不必重拉；导入成功后会显式失效该前缀
    placeholderData: (previous) => previous,
  })
}

/**
 * 行数据导出：带当前筛选条件下载 CSV。
 * 触达服务端行数上限时用 `X-Export-Truncated` 明示，前端必须提示而不是静默给半个文件。
 */
export function useExportDatasetRows() {
  return useMutation({
    mutationFn: async ({
      dataset,
      keyword,
    }: {
      dataset: string
      keyword?: string
    }) => {
      const response = await rawRequest(
        `/ai/datasets/rows/export${queryString({ dataset, keyword })}`
      )
      return {
        text: await response.text(),
        truncated: response.headers.get('X-Export-Truncated') === 'true',
      }
    },
  })
}

/** 导入记录（分页）：失败导入同样留痕，历史必须能往前翻。 */ export function useImportHistory(params: {
  dataset: string
  page?: number
  pageSize?: number
}) {
  return useQuery({
    queryKey: aiQueryKeys.imports(params),
    queryFn: async () => {
      const { data } = await api.get<{
        imports: DatasetImportRow[]
        total: number
        page: number
        pageSize: number
      }>(`/ai/imports${queryString(params)}`)
      return data
    },
  })
}

/** 上传导入：原始 body + X-File-Name 头，文件名需 encodeURIComponent。 */
export function useImportDataset() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      dataset,
      mode,
      file,
      onRowError = 'reject',
    }: {
      dataset: string
      mode: 'overwrite' | 'append'
      file: File
      onRowError?: 'reject' | 'skip'
    }) => {
      const response = await rawRequest(
        `/ai/imports${queryString({ dataset, mode, onRowError })}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/octet-stream',
            'x-file-name': encodeURIComponent(file.name),
          },
          body: await file.arrayBuffer(),
        }
      )
      const text = await response.text()
      const parsed = text
        ? (JSON.parse(text) as DatasetImportResult & { message?: string })
        : null
      if (!parsed) throw new Error('导入失败，请稍后重试')
      if (parsed.message) throw new Error(parsed.message)
      return parsed
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'datasets'] })
      // 导入后行详情缓存立即过期：否则刚上传完点开卡片看到的还是上一批数据
      queryClient.invalidateQueries({ queryKey: ['ai', 'dataset-rows'] })
      queryClient.invalidateQueries({ queryKey: ['ai', 'imports'] })
      queryClient.invalidateQueries({ queryKey: ['ai', 'freshness'] })
    },
  })
}

export function useDatasetFreshness() {
  return useQuery({
    queryKey: aiQueryKeys.freshness,
    queryFn: async () => {
      const { data } = await api.get<{
        knowledge: DataFreshnessItem
        datasets: DataFreshnessItem[]
      }>('/ai/datasets/freshness')
      return data
    },
  })
}

/* ---------- 审计与配置（管理员） ---------- */

/** 分页响应通用形状（服务端各审计列表统一返回）。 */
export type PagedResult<T, K extends string> = {
  total: number
  page: number
  pageSize: number
} & { [key in K]: T[] }

export function useAuditConversations(params: Record<string, unknown>) {
  return useQuery({
    queryKey: aiQueryKeys.auditConversations(params),
    queryFn: async () => {
      const { data } = await api.get<
        PagedResult<AuditConversationRow, 'conversations'>
      >(`/ai/audit/conversations${queryString(params)}`)
      return data
    },
  })
}

export function useAuditTrace(conversationId: number | null) {
  return useQuery({
    queryKey: aiQueryKeys.auditTrace(conversationId),
    enabled: Boolean(conversationId),
    queryFn: async () => {
      const { data } = await api.get<{
        messages: AiMessage[]
        runs: AuditRunRow[]
      }>(`/ai/audit/conversations/${conversationId}/trace`)
      return data
    },
  })
}

/**
 * 工具调用明细（分页）。
 *
 * `blockedTotal` 是服务端按同一组筛选条件统计的拦截数：分页后**不能**再对当前页
 * 做 filter 当指标卡 —— 那会让数字随翻页变化，是最容易被当成 bug 的假数据。
 */
export function useAuditRuns(params: Record<string, unknown>) {
  return useQuery({
    queryKey: aiQueryKeys.auditRuns(params),
    queryFn: async () => {
      const { data } = await api.get<
        PagedResult<AuditRunRow, 'runs'> & { blockedTotal: number }
      >(`/ai/audit/runs${queryString(params)}`)
      return data
    },
  })
}

/** 管理动作日志（分页）：统计口径同上。 */
export function useAuditLogs(params: Record<string, unknown>) {
  return useQuery({
    queryKey: aiQueryKeys.auditLogs(params),
    queryFn: async () => {
      const { data } = await api.get<
        PagedResult<AuditLogRow, 'logs'> & { blockedTotal: number }
      >(`/ai/audit/logs${queryString(params)}`)
      return data
    },
  })
}

export function useUsageStats(days = 14) {
  return useQuery({
    queryKey: aiQueryKeys.usage(days),
    queryFn: async () => {
      const { data } = await api.get<{ usage: UsageRow[] }>(
        `/ai/usage?days=${days}`
      )
      return data.usage
    },
  })
}

export function useAiSettings() {
  return useQuery({
    queryKey: aiQueryKeys.settings,
    queryFn: async () => {
      const { data } = await api.get<{
        settings: AiSettings
        tools: ToolInfo[]
        secretsReady: { ok: boolean; message?: string }
        /** 已同步入库的 MCP 工具数：`enabled` 才是真正交给模型的数量 */
        mcpTools: { total: number; enabled: number }
      }>('/ai/settings')
      return data
    },
  })
}

/** 保存模型配置（含密钥）。服务端只回传掩码，前端不留存明文。 */
export function useSaveModelCredentials() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      modelApiKey?: string | null
      modelBaseUrl?: string
      modelName?: string
      forceDemo?: boolean
      temperature?: number
      maxOutputTokens?: number
      maxTurnsPerConversation?: number
      retrievalTopK?: number
      requestTimeoutMs?: number
    }) => {
      const { data } = await api.patch<{ settings: AiSettings }>(
        '/ai/settings',
        payload
      )
      return data.settings
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiQueryKeys.settings })
      queryClient.invalidateQueries({ queryKey: aiQueryKeys.tools })
    },
  })
}

/** 测试模型连通性：可带未保存的候选参数先测后存。 */
export function useTestModelConnection() {
  return useMutation({
    mutationFn: async (payload: {
      modelApiKey?: string
      modelBaseUrl?: string
      modelName?: string
    }) => {
      const { data } = await api.post<ModelConnectionTestResult>(
        '/ai/settings/test',
        payload
      )
      return data
    },
  })
}

export function useUpdateAiSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Partial<AiSettings> & { mcpSecret?: string | null }) => {
      const { data } = await api.patch<{ settings: AiSettings }>(
        '/ai/settings',
        payload
      )
      return data.settings
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiQueryKeys.settings })
      queryClient.invalidateQueries({ queryKey: aiQueryKeys.tools })
    },
  })
}

/**
 * 测试卖家精灵 MCP 连通性：可带未保存的候选密钥先测后存。
 *
 * 服务端会**显式识别**「密钥无效却返回 200」的形态（卖家精灵把工具清单退化成一个
 * `secret_invalid` 伪工具），因此这里的 ok=false 可能就是密钥问题，不要只看 HTTP 状态。
 */
export function useTestMcpConnection() {
  return useMutation({
    mutationFn: async (payload: { mcpSecret?: string; mcpEndpoint?: string }) => {
      const { data } = await api.post<McpConnectionTestResult>(
        '/ai/settings/mcp/test',
        payload
      )
      return data
    },
  })
}

/** 同步卖家精灵工具清单到后端工具注册表（只有入库的工具才会被注册给模型）。 */
export function useSyncMcpTools() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<McpSyncResult>('/ai/settings/mcp/sync')
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiQueryKeys.settings })
      queryClient.invalidateQueries({ queryKey: aiQueryKeys.tools })
    },
  })
}

export function useToggleTool() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      name,
      enabled,
    }: {
      name: string
      enabled: boolean
    }) => {
      const { data } = await api.patch(`/ai/tools/${name}`, { enabled })
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiQueryKeys.settings })
      queryClient.invalidateQueries({ queryKey: aiQueryKeys.tools })
    },
  })
}

/** CSV 导出：带 token 直接下载，导出动作本身由服务端写审计。 */
export function useExportAudit() {
  return useMutation({
    mutationFn: async ({
      type,
      params,
    }: {
      type: string
      params: Record<string, unknown>
    }) => {
      const response = await rawRequest(
        `/ai/audit/export${queryString({ type, ...params })}`
      )
      return await response.text()
    },
  })
}

/* ---------- 知识沉淀（账号级） ---------- */

/** 导出结果：文本 + 是否因达到服务端上限而被截断。 */
export type ExportPayload = { text: string; truncated: boolean }

/** 带 token 拉取导出文本（服务端同时写导出审计）。 */
async function fetchExport(path: string): Promise<ExportPayload> {
  // 服务端会给出可操作的原因（时间范围超限、筛选参数非法等），rawRequest 会把它原样抛出，
  // 而不是统一吞成"导出失败"。
  const response = await rawRequest(path)
  return {
    text: await response.text(),
    // 达到导出上限时服务端会带这个头：静默截断会让"导出成功"被误解成拿到了全量数据
    truncated: response.headers.get('X-Export-Truncated') === 'true',
  }
}

export function useMyNotes(params: {
  page?: number
  pageSize?: number
  status?: string
  keyword?: string
  tag?: string
}) {
  return useQuery({
    queryKey: aiQueryKeys.notes(params),
    queryFn: async () => {
      const { data } = await api.get<NoteListResult>(
        `/ai/notes${queryString(params)}`
      )
      return data
    },
  })
}

/** 我的技能配置：默认关闭，员工自行开启。 */
export function useMySkill() {
  return useQuery({
    queryKey: aiQueryKeys.mySkill,
    queryFn: async () => {
      const { data } = await api.get<UserSkillState>('/ai/notes/skill')
      return data
    },
  })
}

export function useSaveMySkill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: Partial<UserSkillConfig>) => {
      const { data } = await api.put<{ config: UserSkillConfig }>(
        '/ai/notes/skill',
        payload
      )
      return data.config
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiQueryKeys.mySkill })
    },
  })
}

/** 从会话抽取沉淀草稿（不落库，返回给用户确认）。 */
export function useDistillPreview() {
  return useMutation({
    mutationFn: async (payload: { conversationId: number }) => {
      const { data } = await api.post<DistillPreview>(
        '/ai/notes/distill',
        payload
      )
      return data
    },
  })
}

export function useCreateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      title: string
      summary?: string
      evidence?: string
      fields?: Record<string, string>
      tags?: string[]
      conversationId?: number | null
      skillName?: string | null
    }) => {
      // provenance 不由客户端提交：服务端按来源（会话/手工）自行判定
      const { data } = await api.post<{
        note: KnowledgeNote
        merged: boolean
        newRevision: boolean
      }>('/ai/notes', payload)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'notes'] })
    },
  })
}

export function useUpdateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      patch,
      scope = 'self',
    }: {
      id: number
      patch: Record<string, unknown>
      scope?: 'self' | 'admin'
    }) => {
      const base = scope === 'admin' ? '/ai/distill/notes' : '/ai/notes'
      const { data } = await api.patch<{ note: KnowledgeNote }>(
        `${base}/${id}`,
        patch
      )
      return data.note
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'notes'] })
      queryClient.invalidateQueries({ queryKey: ['ai', 'distill'] })
    },
  })
}

function useNoteAction(path: (id: number) => string, keys: string[]) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.post<{ note: KnowledgeNote }>(path(id))
      return data.note
    },
    onSuccess: () => {
      for (const key of keys) queryClient.invalidateQueries({ queryKey: [key] })
    },
  })
}

export function useSubmitNote() {
  return useNoteAction((id) => `/ai/notes/${id}/submit`, ['ai'])
}

export function useArchiveNote() {
  return useNoteAction((id) => `/ai/notes/${id}/archive`, ['ai'])
}

export function useArchiveDistillNote() {
  return useNoteAction((id) => `/ai/distill/notes/${id}/archive`, ['ai'])
}

export function useDeleteNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      scope = 'self',
    }: {
      id: number
      scope?: 'self' | 'admin'
    }) => {
      const base = scope === 'admin' ? '/ai/distill/notes' : '/ai/notes'
      await api.delete(`${base}/${id}`)
      return id
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'notes'] })
      queryClient.invalidateQueries({ queryKey: ['ai', 'distill'] })
    },
  })
}

export function useExportNotes() {
  return useMutation({
    mutationFn: async ({
      format,
      params = {},
    }: {
      format: 'csv' | 'md' | 'json'
      params?: Record<string, unknown>
    }) =>
      await fetchExport(
        `/ai/notes/export${queryString({ format, ...params })}`
      ),
  })
}

/* ---------- 沉淀管理（管理员） ---------- */

export function useDistillNotes(params: {
  page?: number
  pageSize?: number
  userId?: number | null
  status?: string
  keyword?: string
  tag?: string
  from?: string
  to?: string
}) {
  return useQuery({
    queryKey: aiQueryKeys.distillNotes(params),
    queryFn: async () => {
      const { data } = await api.get<NoteListResult>(
        `/ai/distill/notes${queryString(params)}`
      )
      return data
    },
  })
}

export function useDistillStats() {
  return useQuery({
    queryKey: aiQueryKeys.distillStats,
    queryFn: async () => {
      const { data } = await api.get<DistillStats>('/ai/distill/stats')
      return data
    },
  })
}

export function useDistillSkills() {
  return useQuery({
    queryKey: aiQueryKeys.distillSkills,
    queryFn: async () => {
      const { data } = await api.get<SkillOverview>('/ai/distill/skills')
      return data
    },
  })
}

/**
 * 技能治理（管理员）：全局启停 + 成本参数策略。
 * policy 一并提交时服务端会做范围校验（触发方式枚举、配额 0–200）。
 */
export function useUpdateGlobalSkill() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      name,
      enabled,
      policy,
    }: {
      name: string
      enabled?: boolean
      policy?: Partial<SkillPolicy>
    }) => {
      const { data } = await api.patch<{
        skill: SkillBrief
        policy: SkillPolicy | null
      }>(`/ai/distill/skills/${name}`, {
        ...(enabled === undefined ? {} : { enabled }),
        ...(policy ? { policy } : {}),
      })
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: aiQueryKeys.distillSkills })
      queryClient.invalidateQueries({ queryKey: aiQueryKeys.mySkill })
    },
  })
}

export function useReviewNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      decision,
      comment,
    }: {
      id: number
      decision: 'approve' | 'reject'
      comment?: string
    }) => {
      const { data } = await api.post<{
        note: KnowledgeNote
        documentId: number | null
      }>(`/ai/distill/notes/${id}/review`, { decision, comment })
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'distill'] })
      queryClient.invalidateQueries({ queryKey: ['ai', 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['ai', 'freshness'] })
    },
  })
}

/**
 * 沉淀批量归档 / 批量删除（管理员）。
 *
 * 审核（通过/驳回）刻意不做批量：通过会为每条生成一篇公共知识库文档，
 * 误操作代价过大；驳回必须逐条给出原因。批量只覆盖"清理"类动作。
 */
export function useBatchDistillNotes() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      action: 'archive' | 'delete'
      ids: number[]
    }) => {
      const { data } = await api.post<BatchActionResult>(
        '/ai/distill/notes/batch',
        payload
      )
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'distill'] })
      queryClient.invalidateQueries({ queryKey: ['ai', 'documents'] })
      queryClient.invalidateQueries({ queryKey: ['ai', 'freshness'] })
    },
  })
}

export function useExportDistill() {
  return useMutation({
    mutationFn: async ({
      format,
      params = {},
    }: {
      format: 'csv' | 'md' | 'json'
      params?: Record<string, unknown>
    }) =>
      await fetchExport(
        `/ai/distill/export${queryString({ format, ...params })}`
      ),
  })
}

/* ---------- 提示词广场 ---------- */

/**
 * 提示词列表（服务端分页）。
 *
 * 关键字走**服务端**查询（与 /ai/conversations 同一考虑）：本地过滤在数据变多后
 * 会出现"明明有却搜不到"，而且浮层按名称精确匹配排序也依赖服务端。
 *
 * `scope=published` 是**全公司共享池、没有总量上限**，因此必须分页 —— 此前无 LIMIT，
 * 列表与 `@` 浮层都要把整个共享池拉下来。
 */
export function usePrompts(params: {
  scope?: PromptScope
  keyword?: string
  page?: number
  pageSize?: number
  enabled?: boolean
}) {
  const { enabled = true, ...query } = params
  return useQuery({
    queryKey: aiQueryKeys.prompts(query),
    queryFn: async () => {
      const { data } = await api.get<PromptListResult>(
        `/ai/prompts${queryString({
          scope: query.scope ?? 'mine',
          keyword: query.keyword,
          page: query.page,
          pageSize: query.pageSize,
        })}`
      )
      return data
    },
    enabled,
    staleTime: 30_000,
  })
}

function useInvalidatePrompts() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['ai', 'prompts'] })
    queryClient.invalidateQueries({ queryKey: ['ai', 'distill', 'prompts'] })
  }
}

export function useCreatePrompt() {
  const invalidate = useInvalidatePrompts()
  return useMutation({
    mutationFn: async (payload: PromptInput) => {
      const { data } = await api.post<{ prompt: AiPrompt }>(
        '/ai/prompts',
        payload
      )
      return data.prompt
    },
    onSuccess: invalidate,
  })
}

export function useUpdatePrompt() {
  const invalidate = useInvalidatePrompts()
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: number
      patch: Partial<PromptInput>
    }) => {
      const { data } = await api.patch<{ prompt: AiPrompt }>(
        `/ai/prompts/${id}`,
        patch
      )
      return data.prompt
    },
    onSuccess: invalidate,
  })
}

export function useDeletePrompt() {
  const invalidate = useInvalidatePrompts()
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete(`/ai/prompts/${id}`)
      return id
    },
    onSuccess: invalidate,
  })
}

/** 提报共享：private / rejected → pending。 */
export function useSubmitPrompt() {
  const invalidate = useInvalidatePrompts()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.post<{ prompt: AiPrompt }>(
        `/ai/prompts/${id}/submit`
      )
      return data.prompt
    },
    onSuccess: invalidate,
  })
}

/** 撤回提报：pending → private。 */
export function useWithdrawPrompt() {
  const invalidate = useInvalidatePrompts()
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.post<{ prompt: AiPrompt }>(
        `/ai/prompts/${id}/withdraw`
      )
      return data.prompt
    },
    onSuccess: invalidate,
  })
}

/**
 * 调用计数 +1。
 *
 * 失败不提示、不回滚：这只是统计，不该让用户因为计数失败而用不了提示词。
 * 因此这里刻意不写 onError。
 */
export function useMarkPromptUsed() {
  return useMutation({
    mutationFn: async (id: number) => {
      await api.post(`/ai/prompts/${id}/use`)
    },
  })
}

/**
 * AI 优化提示词正文（**不落库**）。
 *
 * 刻意不 invalidate：接口只返回建议，库里的数据没变，是否采用由弹窗决定
 * （采用后仍需用户点「保存」，那条路径上已有 useUpdatePrompt 在失效列表）。
 */
export function useOptimizePrompt() {
  return useMutation({
    mutationFn: async (payload: { body: string; name?: string }) => {
      const { data } = await api.post<PromptOptimizeResult>(
        '/ai/prompts/optimize',
        payload
      )
      return data
    },
  })
}

/**
 * 管理端审核队列（服务端分页）。
 *
 * 待审队列随提报持续增长，此前无 LIMIT；返回值里的 `pendingTotal`（待审总数，
 * 用于页签角标）与 `total`（当前状态筛选下的总条数）是两个口径，不要互相替代。
 */
export function useDistillPrompts(params: {
  status?: string
  keyword?: string
  page?: number
  pageSize?: number
}) {
  return useQuery({
    queryKey: aiQueryKeys.distillPrompts(params),
    queryFn: async () => {
      const { data } = await api.get<PromptReviewListResult>(
        `/ai/distill/prompts${queryString(params)}`
      )
      return data
    },
  })
}

/** 管理端审核：通过与驳回。驳回原因必填由服务端强制。 */
export function useReviewPrompt() {
  const invalidate = useInvalidatePrompts()
  return useMutation({
    mutationFn: async ({
      id,
      decision,
      comment,
    }: {
      id: number
      decision: 'approve' | 'reject'
      comment?: string
    }) => {
      const { data } = await api.post<{ prompt: AiPrompt }>(
        `/ai/distill/prompts/${id}/${decision}`,
        { comment }
      )
      return data.prompt
    },
    onSuccess: invalidate,
  })
}

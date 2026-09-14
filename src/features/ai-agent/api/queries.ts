/**
 * AI 助手数据访问层（React Query）。
 * 组件不得散落 fetch / axios，统一通过本文件的 hook 访问接口。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, rawRequest } from '@/api/client'
import type {
  AiMessage,
  AiSettings,
  AuditConversationRow,
  AuditLogRow,
  AuditRunRow,
  Conversation,
  CorrectionFeedback,
  DataFreshnessItem,
  DatasetImportResult,
  DatasetImportRow,
  DatasetOverviewItem,
  DistillPreview,
  DistillStats,
  DocumentChunk,
  FeedbackType,
  KnowledgeDocument,
  KnowledgeNote,
  ModelConnectionTestResult,
  NoteListResult,
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
  chunks: (documentId: number | null) =>
    ['ai', 'chunks', documentId ?? 0] as const,
  feedback: ['ai', 'knowledge-feedback'] as const,
  freshness: ['ai', 'freshness'] as const,
  datasets: ['ai', 'datasets'] as const,
  imports: (dataset: string) => ['ai', 'imports', dataset] as const,
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

export function useConversations(keyword?: string) {
  return useQuery({
    queryKey: aiQueryKeys.conversations(keyword),
    queryFn: async () => {
      const { data } = await api.get<{ conversations: Conversation[] }>(
        `/ai/conversations${queryString({ keyword })}`
      )
      return data.conversations
    },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'conversations'] })
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

export function useDocumentChunks(documentId: number | null) {
  return useQuery({
    queryKey: aiQueryKeys.chunks(documentId),
    enabled: Boolean(documentId),
    queryFn: async () => {
      const { data } = await api.get<{ chunks: DocumentChunk[] }>(
        `/ai/knowledge/documents/${documentId}/chunks`
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
      if (!parsed.document) throw new Error(parsed.message ?? '上传失败，请稍后重试。')
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

export function useImportHistory(dataset: string) {
  return useQuery({
    queryKey: aiQueryKeys.imports(dataset),
    queryFn: async () => {
      const { data } = await api.get<{ imports: DatasetImportRow[] }>(
        `/ai/imports${queryString({ dataset })}`
      )
      return data.imports
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

export function useAuditConversations(params: Record<string, unknown>) {
  return useQuery({
    queryKey: aiQueryKeys.auditConversations(params),
    queryFn: async () => {
      const { data } = await api.get<{ conversations: AuditConversationRow[] }>(
        `/ai/audit/conversations${queryString(params)}`
      )
      return data.conversations
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

export function useAuditRuns(params: Record<string, unknown>) {
  return useQuery({
    queryKey: aiQueryKeys.auditRuns(params),
    queryFn: async () => {
      const { data } = await api.get<{ runs: AuditRunRow[] }>(
        `/ai/audit/runs${queryString(params)}`
      )
      return data.runs
    },
  })
}

export function useAuditLogs(params: Record<string, unknown>) {
  return useQuery({
    queryKey: aiQueryKeys.auditLogs(params),
    queryFn: async () => {
      const { data } = await api.get<{ logs: AuditLogRow[] }>(
        `/ai/audit/logs${queryString(params)}`
      )
      return data.logs
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
    mutationFn: async (payload: Partial<AiSettings>) => {
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

/** 带 token 拉取导出文本（服务端同时写导出审计）。 */
async function fetchExport(path: string): Promise<string> {
  // 服务端会给出可操作的原因（时间范围超限、筛选参数非法等），rawRequest 会把它原样抛出，
  // 而不是统一吞成"导出失败"。
  const response = await rawRequest(path)
  return await response.text()
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

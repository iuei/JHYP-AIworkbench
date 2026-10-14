import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'

/**
 * 「我的 AI」数据源（2026-09-17 抽出）。
 *
 * 为什么抽成 hook：首页现在有两处要用同一批数字 —— 首屏的**概览统计行**（最近对话数、
 * 沉淀总数、待审核数）与右下的「我的 AI」卡片（对话列表 + 沉淀入口）。
 * 原先这三个查询写在卡片组件内部，统计行要么再打一遍请求、要么把数字从卡片里"抠"出来。
 * 抽到这里之后两处共用同一份 React Query 缓存，**请求数不变**（仍是三次）。
 *
 * 三条纪律沿用原实现，不要改：
 * 1. `pageSize=1` 只取 `total` —— 首页只需要条数，不该把整页沉淀拉下来；
 * 2. 只读员工可读接口（`/ai/conversations`、`/ai/notes`），**不碰治理面接口**；
 * 3. 不展示治理面词汇（知识库 / 数据源 / 经验审核 / 模型与配置 / 审计台），`index.test.tsx` 有守护断言。
 */
const RECENT_LIMIT = 3

export type MyAiConversation = {
  id: number
  title: string
  messageCount: number
  lastMessageAt: string | null
  updatedAt: string
}

type NotePage = { total: number }

/** 只取 `total`：这里只需要条数，`pageSize=1` 让服务端少读数据。 */
async function fetchNoteTotal(status?: string) {
  const query = new URLSearchParams({ page: '1', pageSize: '1' })
  if (status) query.set('status', status)
  const { data } = await api.get<NotePage>(`/ai/notes?${query.toString()}`)
  return data.total
}

export type MyAiSummary = {
  /** 最近对话（最多 3 条，供卡片列表使用） */
  recent: MyAiConversation[]
  /** 对话总数（供概览统计行使用；`/ai/conversations` 返回的就是全量） */
  conversationCount: number
  notesTotal: number
  pendingTotal: number
  /** 三个查询任一还在加载 */
  isLoading: boolean
  /** 三个查询任一失败（首页按"整块降级"处理，与改造前的联动口径一致） */
  failed: boolean
}

export function useMyAiSummary(): MyAiSummary {
  const conversations = useQuery({
    queryKey: ['dashboard', 'ai-conversations'],
    queryFn: async () => {
      const { data } = await api.get<{ conversations: MyAiConversation[] }>(
        '/ai/conversations'
      )
      return data.conversations
    },
  })

  const notesTotal = useQuery({
    queryKey: ['dashboard', 'ai-notes-total'],
    queryFn: () => fetchNoteTotal(),
  })

  const pendingTotal = useQuery({
    queryKey: ['dashboard', 'ai-notes-pending'],
    queryFn: () => fetchNoteTotal('pending'),
  })

  const all = conversations.data ?? []

  return {
    recent: all.slice(0, RECENT_LIMIT),
    conversationCount: all.length,
    notesTotal: notesTotal.data ?? 0,
    pendingTotal: pendingTotal.data ?? 0,
    isLoading:
      conversations.isLoading || notesTotal.isLoading || pendingTotal.isLoading,
    failed:
      conversations.isError || notesTotal.isError || pendingTotal.isError,
  }
}

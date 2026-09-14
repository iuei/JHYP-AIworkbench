import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { MessageSquareText, NotebookPen } from 'lucide-react'
import { api } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/features/ai-agent/format'

/**
 * 首页「我的 AI」卡片。
 *
 * 为什么替换掉原来的「正在进行的工作」：那块内容读的是 `work_items` 表，而该表只由
 * 竞品分析写入**一条 progress 固定 65 的假任务**（全仓库没有任何更新入口）——
 * 实测库里 0 行，界面长期是空态；一旦产生就永远挂着、也清不掉。
 * 这里改为展示账号自己的真实 AI 使用状态：最近对话 + 沉淀待办，
 * 数据来自员工可读的现有接口（`/ai/conversations`、`/ai/notes`）。
 *
 * 刻意不展示治理面内容（知识库、数据源、经验审核、模型配置、审计台）：
 * 员工面与治理面分离是既定信息架构，`index.test.tsx` 也有对应守护断言。
 */
const RECENT_LIMIT = 3

type ConversationRow = {
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

export function MyAiCard({ className }: { className?: string }) {
  const conversations = useQuery({
    queryKey: ['dashboard', 'ai-conversations'],
    queryFn: async () => {
      const { data } = await api.get<{ conversations: ConversationRow[] }>(
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

  const isLoading =
    conversations.isLoading || notesTotal.isLoading || pendingTotal.isLoading
  const failed =
    conversations.isError || notesTotal.isError || pendingTotal.isError
  const recent = (conversations.data ?? []).slice(0, RECENT_LIMIT)
  const pending = pendingTotal.data ?? 0
  const total = notesTotal.data ?? 0

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>我的 AI</CardTitle>
        <CardDescription>继续最近的对话，或查看自己的知识沉淀</CardDescription>
      </CardHeader>
      <CardContent className='space-y-5'>
        <section aria-labelledby='my-ai-conversations' className='space-y-2'>
          <div className='flex items-baseline justify-between gap-2'>
            <h3
              id='my-ai-conversations'
              className='flex items-center gap-2 text-sm font-medium'
            >
              <MessageSquareText
                aria-hidden='true'
                className='size-4 text-primary'
              />
              最近对话
            </h3>
            <Link
              to='/ai-agent'
              className='text-xs text-muted-foreground hover:text-foreground'
            >
              打开 AI 助手
            </Link>
          </div>

          {isLoading ? (
            <Skeleton className='h-[68px] rounded-lg' />
          ) : recent.length > 0 ? (
            <ul className='space-y-2'>
              {recent.map((item) => (
                <li key={item.id}>
                  <Link
                    to='/ai-agent'
                    className='flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50'
                  >
                    <span className='min-w-0 flex-1 truncate text-sm'>
                      {item.title}
                    </span>
                    <span className='shrink-0 text-xs text-muted-foreground'>
                      {formatDate(item.lastMessageAt ?? item.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className='py-4 text-center text-sm text-muted-foreground'>
              {failed
                ? '对话记录暂时无法读取，稍后重试即可。'
                : '还没有对话记录，去 AI 助手提第一个问题。'}
            </p>
          )}
        </section>

        <section aria-labelledby='my-ai-notes' className='space-y-2'>
          <h3
            id='my-ai-notes'
            className='flex items-center gap-2 text-sm font-medium'
          >
            <NotebookPen aria-hidden='true' className='size-4 text-primary' />
            我的沉淀
          </h3>

          {isLoading ? (
            <Skeleton className='h-[52px] rounded-lg' />
          ) : (
            <Link
              to='/ai-agent/notes'
              className='flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50'
            >
              <span className='text-sm'>
                {failed ? '沉淀数据暂时无法读取' : `共 ${total} 条`}
              </span>
              {pending > 0 && <Badge>{pending} 条待审核</Badge>}
            </Link>
          )}
        </section>
      </CardContent>
    </Card>
  )
}

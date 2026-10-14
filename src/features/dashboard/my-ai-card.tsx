import { Link } from '@tanstack/react-router'
import { MessageSquareText, NotebookPen } from 'lucide-react'
import { cn } from '@/lib/utils'
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
import { useMyAiSummary } from './use-my-ai'

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
 *
 * 2026-09-17：三个查询搬到 `use-my-ai.ts` 的 `useMyAiSummary`，与首屏概览统计行共用
 * 同一份 React Query 缓存（请求数不变），本组件只负责渲染。
 */
export function MyAiCard({ className }: { className?: string }) {
  const {
    recent,
    notesTotal: total,
    pendingTotal: pending,
    isLoading,
    failed,
  } = useMyAiSummary()

  return (
    <Card className={cn('gap-4 py-5', className)}>
      <CardHeader className='gap-1'>
        <CardTitle className='text-base'>
          <h2>我的 AI</h2>
        </CardTitle>
        <CardDescription>继续最近的对话，或查看自己的知识沉淀</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-1 flex-col justify-between gap-5'>
        <section
          aria-labelledby='my-ai-conversations'
          className='flex min-h-0 flex-1 flex-col gap-2'
        >
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
            <ul className='divide-y divide-border/70'>
              {recent.map((item) => (
                <li key={item.id}>
                  <Link
                    to='/ai-agent'
                    search={{ conversationId: item.id }}
                    className='flex min-w-0 items-center justify-between gap-3 rounded-md py-2.5 transition-colors hover:bg-muted/40'
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
            <p className='flex flex-1 items-center justify-center py-4 text-center text-sm text-muted-foreground'>
              {failed
                ? '对话记录暂时无法读取，稍后重试即可。'
                : '还没有对话记录，去 AI 助手提第一个问题。'}
            </p>
          )}
        </section>

        <section
          aria-labelledby='my-ai-notes'
          className='space-y-2 border-t pt-4'
        >
          <h3
            id='my-ai-notes'
            className='flex items-center gap-2 text-sm font-medium'
          >
            <NotebookPen aria-hidden='true' className='size-4 text-primary' />
            个人知识库
          </h3>

          {isLoading ? (
            <Skeleton className='h-[52px] rounded-lg' />
          ) : (
            <Link
              to='/knowledge'
              // 知识库的默认子页是「团队知识库」，本卡片的语义是个人沉淀 —— 必须显式指定
              search={{ view: 'mine' }}
              className='flex items-center justify-between gap-3 rounded-md py-2.5 transition-colors hover:bg-muted/40'
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

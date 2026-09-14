import { useCallback, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  BookOpenCheck,
  CircleStop,
  PanelLeftOpen,
  PanelRightOpen,
  Send,
  Sparkles,
  Truck,
  Wand2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  useAiTools,
  useConversationMessages,
  useConversations,
} from '../api/queries'
import { AnswerBlocks } from '../components/answer-blocks'
import { AnswerCard, EvidencePanel } from '../components/answer-card'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { ConversationList } from '../components/conversation-list'
import { DistillButton } from '../components/distill-button'
import { BlockedNotice, StreamSteps } from '../components/tool-trace-panel'
import {
  isAbortError,
  mergeStreamStep,
  streamChat,
  toStreamStep,
  type ChatEvent,
} from '../sse'
import type { ChatStreamState } from '../types'

const GUIDE_QUESTIONS = [
  {
    icon: BookOpenCheck,
    title: '制度 / SOP 查询',
    prompt: '亚马逊断货了怎么补货？流程是什么，有没有踩过坑？',
  },
  {
    icon: Truck,
    title: '流程与规范',
    prompt: '新品上架的 SOP 是什么？需要经过哪些环节？',
  },
  {
    icon: Wand2,
    title: '经验沉淀',
    prompt: '旺季备货有哪些容易踩的坑？有没有同事的经验记录？',
  },
]

const MAX_QUESTION_LENGTH = 2000

export function ChatWorkbench() {
  const { auth } = useAuthStore()
  const isAdmin = auth.user?.role.includes('admin') ?? false
  const scopeLabel = isAdmin
    ? '全部生效知识文档与业务数据'
    : '全体可见的生效知识文档'

  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [stream, setStream] = useState<ChatStreamState | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  /**
   * 会话搜索词。
   *
   * 必须走**服务端**查询：`GET /ai/conversations` 只返回最近 100 条，
   * 旧实现只在这 100 条里做客户端过滤，第 101 条起既看不着也搜不到（用户以为会话丢了）。
   * 这里用防抖值发请求，输入框仍用即时值，保证输入手感不受网络影响。
   */
  const [conversationKeyword, setConversationKeyword] = useState('')
  const debouncedKeyword = useDebouncedValue(conversationKeyword)
  const abortRef = useRef<AbortController | null>(null)
  /**
   * 本次流式问答**实际使用**的会话 ID。
   * 新会话时 activeId 在发请求时还是 null，仅靠闭包里的 activeId 无法刷新到真正落库的那个会话，
   * 会出现"答案流式显示完就消失"（演示模式响应极快，碰巧晚于落库才没暴露）。
   */
  const conversationIdRef = useRef<number | null>(null)

  const conversations = useConversations(debouncedKeyword.trim() || undefined)
  const messages = useConversationMessages(activeId)
  const tools = useAiTools()

  const persisted = useMemo(() => messages.data ?? [], [messages.data])
  const lastAssistant = useMemo(
    () =>
      [...persisted]
        .reverse()
        .find((message) => message.role === 'assistant') ?? null,
    [persisted]
  )
  const lastUser = useMemo(
    () =>
      [...persisted].reverse().find((message) => message.role === 'user') ??
      null,
    [persisted]
  )

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['ai', 'conversations'] })
    // 必须用本次流式问答真正使用的会话 ID：新会话时闭包里的 activeId 仍是 null，
    // 用它刷新会刷到 ['ai','messages',0]，落库的回答永远拉不回来
    const conversationId = conversationIdRef.current ?? activeId
    if (conversationId) {
      await queryClient.invalidateQueries({
        queryKey: ['ai', 'messages', conversationId],
      })
    }
  }, [activeId, queryClient])

  const handleEvent = useCallback((event: ChatEvent) => {
    // 副作用放在 updater 之外：updater 在 StrictMode 下会被调用两次，
    // 在它内部调用 setActiveId 属于渲染期副作用。
    if (event.type === 'meta' && event.data.conversationId) {
      conversationIdRef.current = event.data.conversationId
      setActiveId((current) =>
        current === event.data.conversationId
          ? current
          : event.data.conversationId
      )
    }
    if (event.type === 'done' && event.data.conversationId) {
      conversationIdRef.current = event.data.conversationId
    }
    setStream((previous) => {
      if (!previous) return previous
      switch (event.type) {
        case 'meta':
          return {
            ...previous,
            conversationId: event.data.conversationId,
            provider: event.data.provider ?? previous.provider,
            steps: event.data.provider
              ? mergeStreamStep(previous.steps, {
                  key: 'think-start',
                  label: '已裁剪可用工具并组装上下文',
                  state: 'done',
                })
              : previous.steps,
          }
        case 'status':
          return {
            ...previous,
            steps: mergeStreamStep(previous.steps, toStreamStep(event.data)),
          }
        case 'reset':
          return { ...previous, text: '', steps: [] }
        case 'delta':
          return { ...previous, text: previous.text + event.data.text }
        case 'error':
          return {
            ...previous,
            status: 'error',
            errorMessage: event.data.message,
          }
        case 'done':
          return {
            ...previous,
            status:
              event.data.status === 'blocked'
                ? 'blocked'
                : event.data.status === 'ok'
                  ? 'done'
                  : previous.status === 'error'
                    ? 'error'
                    : 'error',
            text: event.data.answer || previous.text,
            citations: event.data.citations ?? [],
            toolRuns: event.data.toolRuns ?? [],
            provider: event.data.provider ?? previous.provider,
            errorMessage:
              event.data.status === 'blocked'
                ? '当前账号无权查询该数据，请联系管理员。'
                : event.data.status === 'aborted'
                  ? '已停止生成。'
                  : previous.errorMessage,
          }
        default:
          return previous
      }
    })
  }, [])

  const send = useCallback(
    async (question: string) => {
      const content = question.trim()
      if (!content || stream?.status === 'streaming') return
      setDraft('')
      setStream({
        conversationId: activeId,
        question: content,
        text: '',
        steps: [],
        citations: [],
        blocks: [],
        toolRuns: [],
        provider: null,
        status: 'streaming',
        errorMessage: null,
      })

      conversationIdRef.current = activeId
      const controller = new AbortController()
      abortRef.current = controller
      try {
        await streamChat({
          conversationId: activeId,
          content,
          signal: controller.signal,
          onEvent: handleEvent,
        })
      } catch (error) {
        if (isAbortError(error)) {
          toast.info('已停止生成')
        } else {
          const message =
            error instanceof Error ? error.message : '请求失败，请稍后重试。'
          setStream((previous) =>
            previous
              ? { ...previous, status: 'error', errorMessage: message }
              : previous
          )
          toast.error(message)
        }
      } finally {
        abortRef.current = null
        await refresh()
        setStream(null)
      }
    },
    [activeId, handleEvent, refresh, stream?.status]
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const persistedHasQuestion =
    stream !== null &&
    persisted.some(
      (message) =>
        message.role === 'user' && message.content === stream.question
    )
  const streaming = stream?.status === 'streaming'

  return (
    <div className='flex h-full min-h-0 gap-4'>
      {/* 三栏工作台没有可见标题，补一个只读屏可见的 h1，保证标题层级不缺失 */}
      <h1 className='sr-only'>AI 对话</h1>
      {/* 左栏：会话列表（页面铺满宽度后同步放宽：会话标题常带日期与长主题，256px 会频繁截断） */}
      <aside className='hidden w-72 shrink-0 flex-col border-e pe-4 lg:flex'>
        <ConversationList
          activeId={activeId}
          conversations={conversations.data ?? []}
          isLoading={conversations.isLoading}
          keyword={conversationKeyword}
          onKeywordChange={setConversationKeyword}
          onNew={() => {
            setActiveId(null)
            setStream(null)
            conversationIdRef.current = null
          }}
          onSelect={(id) => {
            setActiveId(id)
            setStream(null)
            conversationIdRef.current = id
          }}
        />
      </aside>

      {/* 中栏：消息流 */}
      <section className='flex min-h-0 min-w-0 flex-1 flex-col'>
        <ScrollArea className='min-h-0 flex-1 pe-2'>
          <div className='space-y-4 pb-4'>
            {activeId === null && !stream && (
              <div className='mx-auto max-w-4xl pt-6'>
                <div className='mb-6 text-center'>
                  <Sparkles className='mx-auto mb-3 size-6 text-primary' />
                  <h2 className='text-2xl font-bold tracking-tight'>AI 助手</h2>
                  <p className='mt-1 text-sm text-muted-foreground'>
                    用自然语言提问，系统自动检索企业知识并给出带出处的结论。
                  </p>
                </div>
                <div className='grid gap-3 sm:grid-cols-3'>
                  {GUIDE_QUESTIONS.map((guide) => {
                    const Icon = guide.icon
                    return (
                      <button
                        className='rounded-xl border p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/40'
                        key={guide.title}
                        type='button'
                        onClick={() => void send(guide.prompt)}
                      >
                        <Icon className='mb-2 size-4 text-primary' />
                        <p className='text-sm font-medium'>{guide.title}</p>
                        <p className='mt-1 text-xs text-muted-foreground'>
                          {guide.prompt}
                        </p>
                      </button>
                    )
                  })}
                </div>
                {tools.data?.provider.demo && (
                  <p className='mt-4 rounded-lg border border-dashed p-3 text-xs text-muted-foreground'>
                    当前为
                    <strong className='font-medium text-foreground'>
                      演示模式
                    </strong>
                    ：环境未配置云模型 API
                    Key，回答由知识库检索结果直接汇总生成，
                    用于验证链路与权限，不代表模型效果。
                  </p>
                )}
              </div>
            )}

            {messages.isLoading && activeId !== null && (
              <div className='space-y-3'>
                <Skeleton className='h-16 w-2/3' />
                <Skeleton className='h-32 w-full' />
              </div>
            )}

            {persisted.map((message) =>
              message.role === 'user' ? (
                <UserBubble content={message.content} key={message.id} />
              ) : (
                <AnswerCard
                  canRegenerate={Boolean(lastUser) && !streaming}
                  key={message.id}
                  message={message}
                  onRegenerate={() => {
                    if (lastUser) void send(lastUser.content)
                  }}
                />
              )
            )}

            {stream && (
              <>
                {!persistedHasQuestion && (
                  <UserBubble content={stream.question} />
                )}
                <article
                  className='rounded-xl border bg-card p-4'
                  aria-label='AI 正在回答'
                >
                  <header className='mb-3 flex items-center gap-2 text-xs text-muted-foreground'>
                    <span className='font-medium text-foreground'>AI 回答</span>
                    {stream.provider?.demo && (
                      <Badge className='font-normal' variant='secondary'>
                        演示模式
                      </Badge>
                    )}
                    {streaming && <span>生成中…</span>}
                  </header>
                  <StreamSteps steps={stream.steps} />
                  {stream.status === 'blocked' && (
                    <BlockedNotice className='mt-3' />
                  )}
                  {stream.text && (
                    <p className='mt-3 text-sm leading-relaxed whitespace-pre-wrap'>
                      {stream.text}
                    </p>
                  )}
                  <AnswerBlocks blocks={stream.blocks ?? []} />
                  {stream.errorMessage && stream.status === 'error' && (
                    <p className='mt-3 text-sm text-destructive' role='alert'>
                      {stream.errorMessage}
                    </p>
                  )}
                </article>
              </>
            )}
          </div>
        </ScrollArea>

        <div className='mt-3 shrink-0 border-t pt-3'>
          <div className='flex items-end gap-2'>
            <Button
              aria-label='打开会话列表'
              className='lg:hidden'
              size='icon'
              variant='outline'
              onClick={() => setHistoryOpen(true)}
            >
              <PanelLeftOpen />
            </Button>
            <Textarea
              aria-label='提问内容'
              className='max-h-40 min-h-[44px] resize-none'
              placeholder='例如：亚马逊断货了怎么补货？流程是什么？'
              rows={1}
              value={draft}
              onChange={(event) =>
                setDraft(event.target.value.slice(0, MAX_QUESTION_LENGTH))
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void send(draft)
                }
              }}
            />
            {streaming ? (
              <Button className='gap-2' variant='outline' onClick={stop}>
                <CircleStop className='size-4' />
                停止生成
              </Button>
            ) : (
              <Button
                className='gap-2'
                disabled={!draft.trim()}
                onClick={() => void send(draft)}
              >
                <Send className='size-4' />
                发送
              </Button>
            )}
            <Button
              aria-label='查看本次回答的依据'
              className='lg:hidden'
              size='icon'
              variant='outline'
              onClick={() => setPanelOpen(true)}
            >
              <PanelRightOpen />
            </Button>
            {/* 沉淀为知识：抽取草稿后由用户确认，不直接落库 */}
            <DistillButton conversationId={activeId} disabled={streaming} />
          </div>
          <p className='mt-2 text-xs text-muted-foreground'>
            回答内容以知识库现有文档为准，非实时数据 · 按 Enter 发送，Shift +
            Enter 换行 · 无权查询的数据会被拦截并记录审计
          </p>
        </div>
      </section>

      {/* 右栏：本次回答的依据（引用文档标题与工具调用参数较长，320px 会频繁换行） */}
      <aside className='hidden w-96 shrink-0 border-s ps-4 xl:block'>
        <h2 className='mb-3 text-sm font-semibold'>本次回答的依据</h2>
        <ScrollArea className='h-full pb-6'>
          {(stream ?? lastAssistant) ? (
            <EvidencePanel
              citations={
                stream ? stream.citations : (lastAssistant?.citations ?? [])
              }
              runs={stream ? stream.toolRuns : (lastAssistant?.runs ?? [])}
              scopeLabel={scopeLabel}
            />
          ) : (
            <p className='text-sm text-muted-foreground'>
              提问后这里会显示引用文档、工具调用与数据时效。
            </p>
          )}
        </ScrollArea>
      </aside>

      <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
        <SheetContent
          className='w-full overflow-y-auto sm:max-w-md'
          side='right'
        >
          <SheetHeader>
            <SheetTitle>本次回答的依据</SheetTitle>
          </SheetHeader>
          <div className='mt-4'>
            <EvidencePanel
              citations={
                stream ? stream.citations : (lastAssistant?.citations ?? [])
              }
              runs={stream ? stream.toolRuns : (lastAssistant?.runs ?? [])}
              scopeLabel={scopeLabel}
            />
          </div>
        </SheetContent>
      </Sheet>

      {/* 窄屏：会话列表折叠为左侧抽屉，保证历史会话仍可访问 */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent
          className='w-full overflow-y-auto sm:max-w-sm'
          side='left'
        >
          <SheetHeader>
            <SheetTitle>会话列表</SheetTitle>
          </SheetHeader>
          <div className='mt-4 h-[calc(100svh-8rem)]'>
            <ConversationList
              activeId={activeId}
              conversations={conversations.data ?? []}
              isLoading={conversations.isLoading}
              keyword={conversationKeyword}
              onKeywordChange={setConversationKeyword}
              onNew={() => {
                setActiveId(null)
                setStream(null)
                conversationIdRef.current = null
                setHistoryOpen(false)
              }}
              onSelect={(id) => {
                setActiveId(id)
                setStream(null)
                conversationIdRef.current = id
                setHistoryOpen(false)
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className='flex justify-end'>
      <div className='max-w-[80%] rounded-xl bg-primary/10 px-4 py-2.5'>
        <p className='text-sm leading-relaxed whitespace-pre-wrap text-foreground'>
          {content}
        </p>
      </div>
    </div>
  )
}

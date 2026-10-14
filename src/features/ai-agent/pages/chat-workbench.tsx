import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import { isAxiosError } from 'axios'
import {
  BookOpenCheck,
  CircleStop,
  PanelLeftOpen,
  Send,
  Sparkles,
  SquareLibrary,
  Truck,
  Wand2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useMediaQuery } from '@/hooks/use-media-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  useInfiniteConversations,
} from '../api/queries'
import { AnswerBlocks } from '../components/answer-blocks'
import { AnswerMarkdown } from '../components/answer-markdown'
import { AnswerCard } from '../components/answer-card'
import { ConversationList } from '../components/conversation-list'
import { DistillButton } from '../components/distill-button'
import { PaneResizer } from '../components/pane-resizer'
import { PromptMentionPanel } from '../components/prompt-mention-panel'
import { BlockedNotice, StreamSteps } from '../components/tool-trace-panel'
import { blockedNoticeText } from '../blocked-notice'
import { isImeComposing } from '../keyboard'
import { streamOverlapsPersisted, applyMetaPatch } from '../stream-merge'
import {
  clearPaneWidths,
  defaultPaneWidths,
  isWideViewportNow,
  LEFT_PANE_QUERY,
  limitPaneWidths,
  readPaneWidths,
  writePaneWidths,
  type PaneWidths,
} from '../pane-width'
import { usePromptMention } from '../prompt-mention'
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
  /** 首页深链参数：`conversationId` 直接选中该会话，`focus=composer` 聚焦输入框。 */
  const search = useSearch({ from: '/_authenticated/ai-agent/' })
  const [activeId, setActiveId] = useState<number | null>(
    search.conversationId ?? null
  )
  const [draft, setDraft] = useState('')
  const [stream, setStream] = useState<ChatStreamState | null>(null)
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
  /** 当前流请求序号；切换会话后旧流事件必须全部失效。 */
  const streamRequestSeqRef = useRef(0)
  const currentStreamRequestRef = useRef<number | null>(null)
  /**
   * 本次流式问答**实际使用**的会话 ID。
   * 新会话时 activeId 在发请求时还是 null，仅靠闭包里的 activeId 无法刷新到真正落库的那个会话，
   * 会出现"答案流式显示完就消失"（演示模式响应极快，碰巧晚于落库才没暴露）。
   */
  const conversationIdRef = useRef<number | null>(search.conversationId ?? null)
  /** 输入框引用：`@提示词` 选中后要把光标落到插入内容末尾，必须直接操作 DOM 选区 */
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  // 首页「问 AI」深链：进场即聚焦输入框，落页就能打字
  useEffect(() => {
    if (search.focus !== 'composer') return
    promptTextareaRef.current?.focus()
  }, [search.focus])

  const conversations = useInfiniteConversations(
    debouncedKeyword.trim() || undefined
  )
  /**
   * 累积已加载的会话。服务端按页返回，左栏是一个连续的时间轴，
   * 因此要把各页摊平后再交给分组渲染（不能只显示最后一页）。
   */
  const conversationItems = useMemo(
    () => conversations.data?.pages.flatMap((page) => page.conversations) ?? [],
    [conversations.data]
  )
  const messages = useConversationMessages(activeId)
  const tools = useAiTools()

  /**
   * 会话已不存在（服务端 404）。
   *
   * `GET /ai/conversations/:id/messages` 对已删除、或不属于本账号的会话一律返回 404。
   * 触发入口有两个：删除动作与「会话列表还没刷新」的竞态，以及首页「最近对话」深链 /
   * 旧书签指向一条早已被删除的会话。
   */
  const conversationMissing =
    activeId !== null &&
    isAxiosError(messages.error) &&
    messages.error.response?.status === 404

  /**
   * 界面与请求实际使用的会话 ID：会话不存在时一律按「新会话」处理。
   *
   * **派生而不是在 effect 里 setState 修正**：`react-hooks/set-state-in-effect`
   * 明确禁止这种写法（多一轮级联渲染）；而且"服务端说这条会话没有"本来就是每次渲染
   * 都算得出来的事实，不需要额外一份 state 去记住它。
   */
  const currentConversationId = conversationMissing ? null : activeId

  /**
   * 对话内 `@提示词` 调出。
   *
   * 按键归属（`Enter` 到底是"选中提示词"还是"发送提问"）全部由这个 hook 判断，
   * 聊天页只负责在 `onKeyDown` 里优先把它交出去，见下方输入框的写法。
   */
  const mention = usePromptMention({
    value: draft,
    onChange: setDraft,
    textareaRef: promptTextareaRef,
  })

  /**
   * 「提示词」按钮：在光标处插入一个 `@` 来打开面板。
   *
   * 刻意不另做一条"点按钮直接展开面板"的分支：两条路径最终都走 `@` 检测，
   * 少一条状态分支就少一处"按钮打开的面板与 `@` 打开的面板行为不一致"的隐患。
   */
  const openPromptPicker = useCallback(() => {
    const element = promptTextareaRef.current
    const start = element?.selectionStart ?? draft.length
    const before = draft.slice(0, start)
    // `@` 前必须是行首或空白才被认作提及，否则这里补一个空格，避免插进词中间不触发
    const inserted = before.length > 0 && !/\s$/.test(before) ? ' @' : '@'
    setDraft(
      `${before}${inserted}${draft.slice(start)}`.slice(0, MAX_QUESTION_LENGTH)
    )
    const caret = before.length + inserted.length
    // 光标要等 DOM 更新后再落位，否则会被重渲染覆盖回原处
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(caret, caret)
      mention.syncCaret()
    })
  }, [draft, mention])

  /**
   * 左栏宽度由用户自己定（拖拽分隔条），并记住选择。
   *
   * 分工要分清：`paneWidths` 是**用户意图**（写进 cookie），`displayPaneWidths` 是
   * 按当前容器宽度收敛后的**实际渲染值**。分开的理由是窗口变小时不能让用户的选择
   * 把中栏压没——显示收敛、存储不动，窗口恢复后仍是用户设定值。
   *
   * 右栏（本次回答的依据）已取消：依据改由回答卡片内「查看依据」按钮展开，
   * 工作台因此只剩"会话列表 + 消息流"两栏，宽度偏好也只剩左栏一份。
   */
  const containerRef = useRef<HTMLDivElement>(null)
  const leftPaneVisible = useMediaQuery(LEFT_PANE_QUERY)
  const [paneWidths, setPaneWidths] = useState<PaneWidths>(() =>
    readPaneWidths(defaultPaneWidths(isWideViewportNow()))
  )
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    setContainerWidth(element.clientWidth)
    const observer = new ResizeObserver(() => {
      setContainerWidth(element.clientWidth)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const displayPaneWidths = useMemo(
    () =>
      limitPaneWidths(paneWidths, {
        containerWidth,
        leftVisible: leftPaneVisible,
      }),
    [paneWidths, containerWidth, leftPaneVisible]
  )

  // 拖拽中只改界面，松手才落偏好：cookie 每帧写一次既无意义也拖慢手感
  const handlePaneResize = useCallback((next: PaneWidths) => {
    setPaneWidths(next)
  }, [])

  const handlePaneCommit = useCallback((next: PaneWidths) => {
    setPaneWidths(next)
    writePaneWidths(next)
  }, [])

  const handlePaneReset = useCallback(() => {
    clearPaneWidths()
    setPaneWidths(defaultPaneWidths(isWideViewportNow()))
  }, [])

  /**
   * 会话不存在时不再渲染它的消息。
   *
   * React Query 在 refetch 失败时会**保留上一次成功的数据**，只把 error 挂上去：
   * 不在这里清空，就会出现"服务端说这条会话没了、界面还挂着它的旧消息"。
   */
  const persisted = useMemo(
    () => (conversationMissing ? [] : (messages.data ?? [])),
    [conversationMissing, messages.data]
  )
  /** 每张回答卡绑定它前面的那一条用户问题，避免历史卡片误重跑最新问题。 */
  const questionByAnswerId = useMemo(() => {
    const result = new Map<number, string>()
    let pendingQuestion: string | null = null
    for (const message of persisted) {
      if (message.role === 'user') {
        pendingQuestion = message.content
      } else if (pendingQuestion !== null) {
        result.set(message.id, pendingQuestion)
        pendingQuestion = null
      }
    }
    return result
  }, [persisted])

  const refresh = useCallback(
    async (streamConversationId: number | null = null) => {
      await queryClient.invalidateQueries({ queryKey: ['ai', 'conversations'] })
      const conversationId = streamConversationId ?? currentConversationId
      if (conversationId) {
        await queryClient.invalidateQueries({
          queryKey: ['ai', 'messages', conversationId],
        })
      }
    },
    [currentConversationId, queryClient]
  )

  const handleEvent = useCallback((event: ChatEvent, requestId: number) => {
    if (currentStreamRequestRef.current !== requestId) return
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
          /*
           * 用 `applyMetaPatch` 而不是直接赋值：服务端每轮发**两条** meta
           * （第二条只带 `registeredTools`），直接赋值会把第一条记下的 `userMessageId`
           * 覆盖成 undefined，`streamOverlapsPersisted()` 便认不出"用户消息已落库"，
           * 乐观气泡与落库气泡同时渲染 —— 用户看到"发送一条消息展示出两条"
           * （2026-09-22 实测根因，见 `stream-merge.ts`）。
           */
          return {
            ...applyMetaPatch(previous, event.data),
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
            /*
             * 记下落库的助手消息 id：`send()` 收尾会先 `await refresh()` 再清流式状态，
             * 这段窗口里 persisted 已经含这一问一答 —— 靠它把流式卡片与落库卡片去重
             * （中止 / 报错时服务端给的是 null，此时不撤卡片）。见 `stream-merge.ts`。
             */
            assistantMessageId: event.data.messageId,
            status:
              event.data.status === 'blocked'
                ? 'blocked'
                : event.data.status === 'ok'
                  ? 'done'
                  : previous.status === 'error'
                    ? 'error'
                    : 'error',
            text: event.data.answer || previous.text,
            toolRuns: event.data.toolRuns ?? [],
            provider: event.data.provider ?? previous.provider,
            /*
             * 被拦截时按**真实原因**给提示（2026-09-17 修）：工具没上线与真的没权限
             * 都曾被写成"当前账号无权查询该数据"，把人引向错误的排查方向。
             * 文案统一由 `blockedNoticeText` 出，与回答卡片上的提示条同源。
             */
            blockReason: event.data.blockReason ?? null,
            errorMessage:
              event.data.status === 'blocked'
                ? blockedNoticeText(event.data.blockReason)
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
      if (!content || currentStreamRequestRef.current !== null) return
      setDraft('')
      setStream({
        conversationId: currentConversationId,
        userMessageId: null,
        assistantMessageId: null,
        question: content,
        text: '',
        steps: [],
        blocks: [],
        toolRuns: [],
        provider: null,
        status: 'streaming',
        errorMessage: null,
      })

      const requestId = ++streamRequestSeqRef.current
      currentStreamRequestRef.current = requestId
      let requestConversationId = currentConversationId
      let streamErrorMessage: string | null = null
      conversationIdRef.current = currentConversationId
      const controller = new AbortController()
      abortRef.current = controller
      try {
        await streamChat({
          conversationId: currentConversationId,
          content,
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'meta' || event.type === 'done') {
              requestConversationId = event.data.conversationId
            }
            if (event.type === 'error') streamErrorMessage = event.data.message
            handleEvent(event, requestId)
          },
        })
        if (streamErrorMessage) throw new Error(streamErrorMessage)
      } catch (error) {
        if (isAbortError(error)) {
          toast.info('已停止生成')
        } else if (currentStreamRequestRef.current === requestId) {
          const message =
            error instanceof Error ? error.message : '请求失败，请稍后重试。'
          setDraft(content)
          setStream((previous) =>
            previous
              ? { ...previous, status: 'error', errorMessage: message }
              : previous
          )
          toast.error(message)
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        if (currentStreamRequestRef.current === requestId) {
          try {
            await refresh(requestConversationId)
          } catch {
            setStream((previous) =>
              previous
                ? { ...previous, status: 'error', errorMessage: '消息同步失败，请刷新页面查看。' }
                : previous
            )
          } finally {
            setStream((previous) => (previous?.status === 'error' ? previous : null))
            currentStreamRequestRef.current = null
          }
        }
      }
    },
    [currentConversationId, handleEvent, refresh]
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const abandonCurrentStream = useCallback(() => {
    streamRequestSeqRef.current += 1
    currentStreamRequestRef.current = null
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  /**
   * 回到「新会话」空态：中止在途流、清空选中会话与流状态。
   *
   * 新建会话、删除正在看的会话、深链指向已不存在的会话这三条路径都必须走它 ——
   * 只清一半会留下"左栏已经没有这条会话、中栏还在等它的消息"的空白页。
   */
  const resetToNewConversation = useCallback(() => {
    abandonCurrentStream()
    setActiveId(null)
    setStream(null)
    conversationIdRef.current = null
  }, [abandonCurrentStream])

  /**
   * 只有删掉的正是**中栏正在看的那条**会话才需要重置。
   *
   * 删的是别的会话时中栏那条仍然存在，跟着清空等于"删了一条却把当前对话也弄丢了"。
   */
  const handleConversationDeleted = useCallback(
    (id: number) => {
      if (id !== activeId) return
      resetToNewConversation()
    },
    [activeId, resetToNewConversation]
  )

  /*
   * 流式卡片与已落库消息的重叠判定（2026-09-22 修「一条消息有时显示两条」）：
   * `send()` 的收尾是「先 `await refresh()` 再 `setStream(null)`」，refresh 让 persisted
   * 拿到新问答之后、流式卡片撤下之前，两张卡片会同时渲染 —— 用这一问一答的两个落库 id
   * 判断"是否已被 persisted 覆盖"，覆盖了就整块撤下（判据与理由见 `stream-merge.ts`）。
   */
  const persistedIds = useMemo(
    () => new Set(persisted.map((message) => message.id)),
    [persisted]
  )
  const streamOverlap = useMemo(
    () => streamOverlapsPersisted(persistedIds, stream),
    [persistedIds, stream]
  )
  const streaming = stream?.status === 'streaming'

  return (
    <div className='flex h-full min-h-0' ref={containerRef}>
      {/* 两栏工作台没有可见标题，补一个只读屏可见的 h1，保证标题层级不缺失 */}
      <h1 className='sr-only'>AI 对话</h1>
      {/* 左栏：会话列表（宽度由用户拖拽或「页面宽度」菜单决定，默认见 pane-width.ts） */}
      <aside
        className='hidden shrink-0 flex-col pe-4 lg:flex'
        style={{ width: displayPaneWidths.left }}
      >
        <ConversationList
          activeId={currentConversationId}
          conversations={conversationItems}
          hasMore={conversations.hasNextPage}
          isLoading={conversations.isLoading}
          isLoadingMore={conversations.isFetchingNextPage}
          keyword={conversationKeyword}
          onLoadMore={() => void conversations.fetchNextPage()}
          onKeywordChange={setConversationKeyword}
          onDeleted={handleConversationDeleted}
          onNew={resetToNewConversation}
          onSelect={(id) => {
            abandonCurrentStream()
            setActiveId(id)
            setStream(null)
            conversationIdRef.current = id
          }}
        />
      </aside>

      {/* 分隔条：占据的正是改造前 gap-4 的位置，既能拖拽也支持键盘 */}
      <PaneResizer
        containerRef={containerRef}
        leftVisible={leftPaneVisible}
        widths={displayPaneWidths}
        onCommit={handlePaneCommit}
        onReset={handlePaneReset}
        onResize={handlePaneResize}
      />

      {/* 中栏：消息流 */}
      <section className='flex min-h-0 min-w-0 flex-1 flex-col'>
        {/*
          这里刻意**不用** `ScrollArea`：Radix 会在 Viewport 里插一层
          `style="display:table; min-width:100%"` 的包装（内联样式，无法用 class 覆盖），
          table 布局按内容的 **min-content 宽度**撑开 —— 回答里只要有一个长 URL、无空格长串
          或宽表格，整条消息流就按上千像素布局，右侧被 Viewport 的 `overflow-x: hidden` 裁掉
          （实测 544px 中栏内内容被撑到 2204px，长 URL 与超长标识在中途被硬切）。
          用原生 block 滚动容器：内容宽度恒等于栏宽，长文本由 `wrap-anywhere` 换行，
          宽表格由自身 `overflow-x-auto` 滚动。左栏仍用 `ScrollArea`（内容以短文本为主）。
        */}
        <div className='min-h-0 flex-1 overflow-x-hidden overflow-y-auto'>
          {/*
            消息流限宽居中（`max-w-4xl`，与空态同宽）：右栏取消后中栏在宽屏会超过 1300px，
            一行文字过长反而难读 —— 两侧留白同时也是阅读节奏。
            `px-6` 是对话内容与栏边的呼吸位：窄屏下这是唯一的留白来源，宽屏下与居中留白叠加。
          */}
          <div className='mx-auto max-w-4xl min-w-0 space-y-4 px-6 pb-4'>
            {currentConversationId === null && !stream && (
              <div className='mx-auto max-w-4xl pt-6'>
                <div className='mb-6 text-center'>
                  <Sparkles className='mx-auto mb-3 size-6 text-primary' />
                  <h2 className='text-2xl font-bold tracking-tight'>AI 助手</h2>
                  <p className='mt-1 text-sm text-muted-foreground'>
                    用自然语言提问，系统自动检索企业知识并给出带出处的结论。
                  </p>
                  {/*
                    使用边界的说明放在空态里逐行展示，而不是常驻输入框下方：
                    这些是"开口之前需要知道"的信息，一旦开始对话就只是视觉噪音，
                    真正与本次回答相关的数据来源/时效由回答卡片的声明条承担。
                  */}
                  <div className='mt-3 space-y-1 text-xs text-muted-foreground'>
                    <p>回答内容以知识库现有文档为准，非实时数据</p>
                    <p>
                      按 Enter 发送，Shift + Enter
                      换行，无权查询的数据会被拦截并记录审计
                    </p>
                  </div>
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

            {messages.isLoading && currentConversationId !== null && (
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
                  canRegenerate={questionByAnswerId.has(message.id) && !streaming}
                  key={message.id}
                  message={message}
                  scopeLabel={scopeLabel}
                  onRegenerate={() => {
                    const question = questionByAnswerId.get(message.id)
                    if (question) void send(question)
                  }}
                />
              )
            )}

            {stream && !streamOverlap.fullyPersisted && (
              <>
                {!streamOverlap.questionPersisted && (
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
                    <BlockedNotice
                      className='mt-3'
                      reason={stream.blockReason ?? null}
                    />
                  )}
                  {stream.text && (
                    /* 同 AnswerCard：正文走统一渲染层，断行约束（wrap-anywhere）由它承载 */
                    <AnswerMarkdown className='mt-3' content={stream.text} />
                  )}
                  <AnswerBlocks blocks={stream.blocks ?? []} />
                  {stream.errorMessage && stream.status === 'error' && (
                    <div className='mt-3' role='alert'>
                      <p className='text-sm text-destructive'>{stream.errorMessage}</p>
                      <p className='mt-1 text-xs text-muted-foreground'>问题已保留在输入框，可检查会话后重新发送。</p>
                    </div>
                  )}
                </article>
              </>
            )}
          </div>
        </div>

        <div className='mt-3 shrink-0 border-t pt-3'>
          {/*
            与消息流同宽同留白：否则宽屏下输入框与上面的内容各占一套边距、左右不对齐。

            这一行所有控件**统一 44px 高**（图标按钮 `size-11`、文字按钮 `h-11`），
            等于 `Textarea` 的 `min-h-[44px]`：整行是 `items-end` 底对齐，控件比文本域矮
            就会"陷进去一截"（实测按钮 36px vs 文本域 44px），三个按钮看着也各不成一体。
            44px 同时是 WCAG 2.5.8 触控目标尺寸的下限。
          */}
          <div className='mx-auto flex max-w-4xl items-end gap-2 px-6'>
            <Button
              aria-label='打开会话列表'
              className='size-11 lg:hidden'
              size='icon'
              variant='outline'
              onClick={() => setHistoryOpen(true)}
            >
              <PanelLeftOpen />
            </Button>
            {/*
              提示词入口常驻在输入框旁，而不是只靠 `@`：
              不知道 `@` 能用的用户永远发现不了这个能力。
            */}
            <Button
              aria-label='插入提示词'
              className='size-11 shrink-0'
              size='icon'
              title='插入提示词（也可在输入框键入 @）'
              variant='outline'
              onClick={openPromptPicker}
            >
              <SquareLibrary />
            </Button>
            {/* 相对定位容器：`@` 面板浮在输入框上方，宽度与输入框一致，不遮挡正在写的内容 */}
            <div className='relative min-w-0 flex-1'>
              <Textarea
                aria-label='提问内容'
                className='max-h-40 min-h-[44px] w-full resize-none'
                placeholder='例如：亚马逊断货了怎么补货？流程是什么？（输入 @ 可调出提示词）'
                ref={promptTextareaRef}
                rows={1}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value.slice(0, MAX_QUESTION_LENGTH))
                  mention.syncCaret()
                }}
                onClick={() => mention.syncCaret()}
                onKeyUp={() => mention.syncCaret()}
                onKeyDown={(event) => {
                  /*
                   * 输入法组合中（中文/日文打字）的回车是"确认候选词"，不是发送。
                   * 这一步必须在最前面：否则中文用户敲完拼音一按回车就把半截内容发出去了
                   * （2026-09-18 用户报障「打字时只要回车就会直接发送内容」）。
                   */
                  if (isImeComposing(event)) return
                  // 面板打开时 Enter 属于"确认选中"，必须先于发送判断，否则会把半截的 @ 发出去
                  if (mention.handleKeyDown(event)) return
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send(draft)
                  }
                }}
              />
              {mention.open && (
                <PromptMentionPanel
                  activeIndex={mention.activeIndex}
                  error={mention.error}
                  groups={mention.groups}
                  keyword={mention.keyword}
                  loading={mention.loading}
                  truncated={mention.truncated}
                  onHover={mention.setActiveIndex}
                  onSelect={mention.selectItem}
                />
              )}
            </div>
            {streaming ? (
              <Button className='h-11 gap-2' variant='outline' onClick={stop}>
                <CircleStop className='size-4' />
                停止生成
              </Button>
            ) : (
              <Button
                className='h-11 gap-2'
                disabled={!draft.trim()}
                onClick={() => void send(draft)}
              >
                <Send className='size-4' />
                发送
              </Button>
            )}
            {/*
              这里**没有**"查看依据"按钮（2026-09-15 取消右栏后一并删掉）：
              依据已由每张回答卡片自己的「查看依据」按钮承载，
              一个会话里哪条回答都能各自看依据，比"整页只看最后一条"更准确。
            */}
            {/* 沉淀为知识：抽取草稿后由用户确认，不直接落库 */}
            <DistillButton
              conversationId={currentConversationId}
              disabled={streaming}
            />
          </div>
        </div>
      </section>

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
              activeId={currentConversationId}
              conversations={conversationItems}
              hasMore={conversations.hasNextPage}
              isLoading={conversations.isLoading}
              isLoadingMore={conversations.isFetchingNextPage}
              keyword={conversationKeyword}
              onLoadMore={() => void conversations.fetchNextPage()}
              onKeywordChange={setConversationKeyword}
              onDeleted={handleConversationDeleted}
              onNew={() => {
                resetToNewConversation()
                setHistoryOpen(false)
              }}
              onSelect={(id) => {
                abandonCurrentStream()
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
      {/* max-w-[80%] 只约束宽度上限：内容本身不可断行时仍会溢出，故同样要 wrap-anywhere */}
      <div className='max-w-[80%] min-w-0 rounded-xl bg-primary/10 px-4 py-2.5'>
        <p className='text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap text-foreground'>
          {content}
        </p>
      </div>
    </div>
  )
}

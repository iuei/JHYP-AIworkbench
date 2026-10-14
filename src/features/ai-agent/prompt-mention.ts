/**
 * 对话内 `@提示词` 调出逻辑。
 *
 * 为什么单独抽成一个 hook 文件：这里最容易出错的是**按键归属**——
 * 输入框的 `Enter` 本来是"发送"，而浮层里的 `Enter` 是"确认选中"。
 * 两者抢同一个键，一旦归属判断写错，用户按下回车会把半截的 `@ACoS` 当提问发出去。
 * 把检测、选中、按键消费全部收在这一个文件里，聊天页只调用 `handleKeyDown(event)`，
 * 并让它返回"这个键我已经用掉了"，避免各处各写一遍判断。
 *
 * 服务端不参与：`@名称` 不会被上送，选中后只是把**提示词正文**填进输入框，
 * 用户可以继续编辑再发送。
 */
import { useCallback, useMemo, useState, type RefObject } from 'react'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useMarkPromptUsed, usePrompts } from './api/queries'
import type { AiPrompt } from './types'

/** 与后端 MAX_KEYWORD_LENGTH 一致：超长就不再当作提及，直接当普通输入。 */
export const MENTION_MAX_KEYWORD_LENGTH = 60

/** 浮层最多展示的条目数：更多时提示用户继续输入缩小范围，而不是无限滚动。 */
export const MENTION_PAGE_SIZE = 20

export type MentionContext = {
  /** 触发用的 `@` 在文本中的下标 */
  start: number
  /** `@` 与光标之间的文字（用于搜索） */
  keyword: string
}

/**
 * 检测光标处是否正处于一次 `@` 提及中。
 *
 * 规则（刻意保守，宁可少触发也不要误触发）：
 * 1. `@` 之前必须是行首或空白 —— 否则 `a@b.com` 这类邮箱会被当成提及；
 * 2. `@` 与光标之间不能有换行 —— 换行视为这次提及已经结束；
 * 3. 只认**最后一个** `@` —— 连续输入时以最近的为准。
 */
export function detectMention(
  value: string,
  caret: number
): MentionContext | null {
  const text = String(value ?? '')
  const position = Math.max(0, Math.min(caret, text.length))
  const before = text.slice(0, position)
  const at = before.lastIndexOf('@')
  if (at < 0) return null

  const previous = at > 0 ? before[at - 1] : ''
  if (previous && !/\s/.test(previous)) return null

  const keyword = before.slice(at + 1)
  if (keyword.includes('\n')) return null

  return { start: at, keyword }
}

/** 把 `@关键词` 替换为提示词正文，返回新文本与选中后应落的光标位置。 */
export function applyMention({
  value,
  start,
  caret,
  body,
}: {
  value: string
  start: number
  caret: number
  body: string
}): { text: string; caret: number } {
  const text = String(value ?? '')
  const end = Math.max(0, Math.min(caret, text.length))
  const head = text.slice(0, start)
  const tail = text.slice(end)
  return { text: `${head}${body}${tail}`, caret: head.length + body.length }
}

export type PromptMentionGroup = {
  label: string
  items: AiPrompt[]
}

type Options = {
  value: string
  onChange: (next: string) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

/**
 * `@` 提及状态机。
 *
 * 调用方需要做的三件事：
 * 1. 在 `onChange` / `onKeyUp` / `onClick` 里调用 `syncCaret()`（更新光标位置）；
 * 2. 在 `onKeyDown` 里 `if (mention.handleKeyDown(event)) return`；
 * 3. 渲染 `mention.groups` 面板并接上 `onHoverItem` / `onSelectItem`。
 */
export function usePromptMention({ value, onChange, textareaRef }: Options) {
  const [caret, setCaret] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  /**
   * 被 `Esc` 关闭的提及位置。
   * 记位置而不是布尔值：用户按 Esc 关掉后继续打字不该重新弹出，
   * 但另起一个 `@`（位置变了）应当照常弹出。
   */
  const [dismissedStart, setDismissedStart] = useState<number | null>(null)

  const context = useMemo(() => detectMention(value, caret), [value, caret])
  const tooLong = (context?.keyword.length ?? 0) > MENTION_MAX_KEYWORD_LENGTH
  const open = Boolean(context) && !tooLong && context?.start !== dismissedStart

  const debouncedKeyword = useDebouncedValue(context?.keyword ?? '')
  const query = usePrompts({
    scope: 'usable',
    keyword: open ? debouncedKeyword.trim() || undefined : undefined,
    // 浮层一次最多展示 MENTION_PAGE_SIZE 条候选，多拉无意义（服务端 pageSize 上限 100）
    pageSize: MENTION_PAGE_SIZE,
    enabled: open,
  })

  const markUsed = useMarkPromptUsed()

  const groups = useMemo<PromptMentionGroup[]>(() => {
    const list = query.data?.prompts ?? []
    // 分组与广场页一致：共享在前（更通用），自己的在后
    const shared = list.filter((prompt) => prompt.status === 'published')
    const mine = list.filter((prompt) => prompt.status !== 'published')
    return [
      { label: '共享提示词', items: shared },
      { label: '我的提示词', items: mine },
    ]
      .filter((group) => group.items.length > 0)
      .map((group) => ({
        ...group,
        items: group.items.slice(0, MENTION_PAGE_SIZE),
      }))
  }, [query.data])

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups])
  // 服务端分页后 total 是"匹配总数"（不再等于已加载条数），截断提示因此更准
  const total = query.data?.total ?? 0
  const truncated = total > MENTION_PAGE_SIZE
  // 列表变化后旧的高亮下标可能越界：clamp 而不是用 effect 回写 state（避免级联渲染）
  const safeIndex = flat.length > 0 ? Math.min(activeIndex, flat.length - 1) : 0

  const syncCaret = useCallback(() => {
    const element = textareaRef.current
    if (element) setCaret(element.selectionStart ?? 0)
  }, [textareaRef])

  const selectItem = useCallback(
    (index: number) => {
      const prompt = flat[index]
      if (!prompt || !context) return
      const { text, caret: nextCaret } = applyMention({
        value,
        start: context.start,
        caret,
        body: prompt.body,
      })
      onChange(text)
      setDismissedStart(context.start)
      // 光标要等 DOM 更新后再落位，否则会被 React 的重渲染覆盖回原处
      requestAnimationFrame(() => {
        const element = textareaRef.current
        if (!element) return
        element.focus()
        element.setSelectionRange(nextCaret, nextCaret)
        setCaret(nextCaret)
      })
      markUsed.mutate(prompt.id)
    },
    [caret, context, flat, markUsed, onChange, textareaRef, value]
  )

  const close = useCallback(() => {
    setDismissedStart(context?.start ?? null)
  }, [context])

  /**
   * 处理按键，返回 `true` 表示本 hook 已消费该键，调用方**不得**再执行发送等默认行为。
   *
   * 列表为空（加载中或无匹配）时刻意返回 `false`：此时没有任何可确认的项，
   * 吃掉回车只会让用户觉得"回车坏了"。用户明确按回车就是发送，照常发送。
   */
  const handleKeyDown = useCallback(
    (event: {
      key: string
      preventDefault: () => void
      shiftKey?: boolean
    }): boolean => {
      if (!open || flat.length === 0) return false

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex(safeIndex + 1 >= flat.length ? 0 : safeIndex + 1)
        return true
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex(safeIndex <= 0 ? flat.length - 1 : safeIndex - 1)
        return true
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        selectItem(safeIndex)
        return true
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return true
      }
      return false
    },
    [close, flat.length, open, safeIndex, selectItem]
  )

  return {
    open,
    keyword: context?.keyword ?? '',
    groups,
    activeIndex: safeIndex,
    loading: query.isLoading,
    /** 查询失败时面板给一句人话提示，不阻塞继续输入 */
    error: query.isError,
    /** 命中总数超过展示上限时，面板提示用户继续输入以缩小范围 */
    truncated,
    handleKeyDown,
    selectItem,
    setActiveIndex,
    syncCaret,
    close,
  }
}

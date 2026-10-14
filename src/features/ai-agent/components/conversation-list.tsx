import { useMemo, useState } from 'react'
import {
  ChevronDown,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Search,
  Trash2,
} from 'lucide-react'
import { TABLE_SEARCH_ICON, TABLE_SEARCH_INPUT } from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useDeleteConversation, useRenameConversation } from '../api/queries'
import type { Conversation } from '../types'

type ConversationListProps = {
  conversations: Conversation[]
  isLoading: boolean
  /** 还有更早的会话没加载（服务端 total 大于已加载条数）。 */
  hasMore?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void
  activeId: number | null
  onSelect: (id: number) => void
  onNew: () => void
  /** 搜索词由父组件持有并透传给服务端查询（受控）：只在本层过滤会漏掉更早的会话。 */
  keyword: string
  onKeywordChange: (value: string) => void
  /**
   * 删除成功后的通知。
   *
   * 删掉的那条**可能正是中栏正在看的会话**：左栏条目消失很容易，中栏却会停在
   * 一个不再存在的会话上（`GET /ai/conversations/:id/messages` 返回 404），
   * 变成"没有内容也没有引导"的空白页。只有父组件知道当前选中的是哪一条，
   * 因此重置选中态的责任必须交出去。
   */
  onDeleted?: (id: number) => void
}

function groupLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '更早'
  const now = new Date()
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days <= 7) return '最近 7 天'
  if (days <= 30) return '最近 30 天'
  return '更早'
}

/** 左栏：会话列表（新建、搜索、重命名、置顶、删除、加载更多）。 */
export function ConversationList({
  conversations,
  isLoading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  activeId,
  onSelect,
  onNew,
  keyword,
  onKeywordChange,
  onDeleted,
}: ConversationListProps) {
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null)
  const rename = useRenameConversation()
  const remove = useDeleteConversation()

  // 服务端已经按关键词过滤过；这里再过滤一次是为了让输入到响应之间的这段时间
  // 列表也能即时收敛（同一套判断，不会出现"看到的和查到的"不一致）。
  const filtered = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    if (!text) return conversations
    return conversations.filter((item) =>
      item.title.toLowerCase().includes(text)
    )
  }, [conversations, keyword])

  const grouped = useMemo(() => {
    const map = new Map<string, Conversation[]>()
    for (const conversation of filtered) {
      const label = conversation.pinned
        ? '已置顶'
        : groupLabel(conversation.lastMessageAt ?? conversation.createdAt)
      const list = map.get(label) ?? []
      list.push(conversation)
      map.set(label, list)
    }
    return [...map.entries()]
  }, [filtered])

  const commitRename = (conversation: Conversation) => {
    const title = editingTitle.trim()
    setEditingId(null)
    if (!title || title === conversation.title) return
    rename.mutate({ id: conversation.id, title })
  }

  return (
    <div className='flex h-full min-h-0 flex-col gap-3'>
      <Button className='w-full justify-start gap-2' onClick={onNew}>
        <MessageSquarePlus className='size-4' />
        新建会话
      </Button>

      <div className='relative'>
        <Search className={TABLE_SEARCH_ICON} />
        <Input
          aria-label='搜索历史会话'
          className={TABLE_SEARCH_INPUT}
          placeholder='搜索会话标题'
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
        />
      </div>

      {/*
        这里刻意**不用** `ScrollArea`（与中栏消息流同一结论）：
        Radix 会在 Viewport 内插一层 `display: table; min-width: 100%` 的包装（内联样式，class 覆盖不掉），
        table 布局按内容的 **min-content** 撑宽而不是跟随容器 —— 实测左栏 200 / 240 / 288 三档下，
        这一层恒为 **407px**：行右端的「⋯」按钮（right 611）与「加载更早的会话」按钮的右段
        落到左栏之外，被 Viewport 的 `overflow-x: hidden` 裁掉，用户看到按钮被遮挡/截断。
        原生 block 滚动容器让内容宽度恒等于栏宽（长标题由 `truncate` 自己收），
        与 `chat-workbench.tsx` 的中栏保持一致。
      */}
      <div className='min-h-0 flex-1 overflow-x-hidden overflow-y-auto'>
        <div className='space-y-4 pe-2'>
          {isLoading &&
            [0, 1, 2].map((index) => (
              <Skeleton className='h-14 w-full' key={index} />
            ))}

          {!isLoading && filtered.length === 0 && (
            <p className='rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'>
              {keyword ? '没有匹配的会话。' : '还没有会话，从下方提问开始。'}
            </p>
          )}

          {grouped.map(([label, items]) => (
            <div key={label}>
              <p className='mb-1.5 px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
                {label}
              </p>
              <ul className='space-y-1'>
                {items.map((conversation) => {
                  const active = conversation.id === activeId
                  return (
                    <li key={conversation.id}>
                      {editingId === conversation.id ? (
                        <Input
                          aria-label='会话标题'
                          autoFocus
                          value={editingTitle}
                          onBlur={() => commitRename(conversation)}
                          onChange={(event) =>
                            setEditingTitle(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter')
                              commitRename(conversation)
                            if (event.key === 'Escape') setEditingId(null)
                          }}
                        />
                      ) : (
                        <div
                          className={cn(
                            'group flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors',
                            active ? 'bg-primary/10' : 'hover:bg-muted'
                          )}
                        >
                          <button
                            className='min-w-0 flex-1 text-left'
                            type='button'
                            onClick={() => onSelect(conversation.id)}
                          >
                            <span
                              className={cn(
                                'block truncate text-sm',
                                active
                                  ? 'font-medium text-primary'
                                  : 'text-foreground'
                              )}
                            >
                              {conversation.title}
                            </span>
                            <span className='mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground'>
                              {conversation.messageCount} 条消息
                              {(conversation.problemCount ?? 0) > 0 && (
                                <Badge
                                  className='h-4 px-1 text-[10px] font-normal'
                                  variant='destructive'
                                >
                                  {conversation.problemCount} 条异常
                                </Badge>
                              )}
                            </span>
                          </button>
                          {/*
                            行操作收进常显的「⋯」菜单。
                            改前是三个 hover 才显形的图标按钮（`opacity-0 group-hover:opacity-100`）：
                            鼠标用户得先猜到"要悬停"，触屏设备（`hover: none`）则**永远看不到**，
                            等于找不到删除入口。常显菜单两种设备都能用，也避免每行挂三个图标。
                          */}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                aria-label={`会话操作：${conversation.title}`}
                                className='shrink-0 text-muted-foreground hover:text-foreground'
                                size='icon'
                                variant='ghost'
                              >
                                <MoreHorizontal />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align='end' className='w-40'>
                              <DropdownMenuItem
                                onClick={() =>
                                  rename.mutate({
                                    id: conversation.id,
                                    pinned: !conversation.pinned,
                                  })
                                }
                              >
                                {conversation.pinned ? <PinOff /> : <Pin />}
                                {conversation.pinned ? '取消置顶' : '置顶会话'}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditingId(conversation.id)
                                  setEditingTitle(conversation.title)
                                }}
                              >
                                <Pencil />
                                重命名
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant='destructive'
                                onClick={() => setPendingDelete(conversation)}
                              >
                                <Trash2 />
                                删除
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}

          {/*
            会话超过一页时累积加载。这里刻意不用 TablePagination：左栏是一条按
            "置顶 / 今天 / 昨天…"分组的滚动时间轴，嵌一个带页码与"每页条数"的
            分页器既占高度，也和分组语义打架。
          */}
          {hasMore && (
            <Button
              className='w-full'
              disabled={isLoadingMore}
              size='sm'
              type='button'
              variant='outline'
              onClick={onLoadMore}
            >
              {isLoadingMore ? (
                <Loader2 className='animate-spin' aria-hidden='true' />
              ) : (
                <ChevronDown aria-hidden='true' />
              )}
              {isLoadingMore ? '加载中…' : '加载更早的会话'}
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        destructive
        confirmText='删除'
        desc={`删除后该会话的全部问答与工具轨迹将不可恢复，审计记录仍会保留。确定删除「${pendingDelete?.title ?? ''}」吗？`}
        open={Boolean(pendingDelete)}
        title='删除会话'
        isLoading={remove.isPending}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        handleConfirm={() => {
          if (!pendingDelete) return
          // 用快照而不是 state：请求在途中 pendingDelete 可能已被 onSettled 清空，
          // 回调里再读它就会拿到 null，通知也随之丢掉。
          const target = pendingDelete
          remove.mutate(target.id, {
            onSuccess: () => onDeleted?.(target.id),
            onSettled: () => setPendingDelete(null),
          })
        }}
      />
    </div>
  )
}

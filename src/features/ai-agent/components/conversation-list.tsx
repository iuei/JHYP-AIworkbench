import { useMemo, useState } from 'react'
import {
  MessageSquarePlus,
  Pencil,
  Pin,
  PinOff,
  Search,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useDeleteConversation, useRenameConversation } from '../api/queries'
import type { Conversation } from '../types'

type ConversationListProps = {
  conversations: Conversation[]
  isLoading: boolean
  activeId: number | null
  onSelect: (id: number) => void
  onNew: () => void
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

/** 左栏：会话列表（新建、搜索、重命名、置顶、删除）。 */
export function ConversationList({
  conversations,
  isLoading,
  activeId,
  onSelect,
  onNew,
}: ConversationListProps) {
  const [keyword, setKeyword] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null)
  const rename = useRenameConversation()
  const remove = useDeleteConversation()

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
        <Search className='absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
        <Input
          aria-label='搜索历史会话'
          className='pl-9'
          placeholder='搜索会话标题'
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </div>

      <ScrollArea className='min-h-0 flex-1'>
        <div className='space-y-4 pr-2'>
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
                          <div className='flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100'>
                            <Button
                              aria-label={
                                conversation.pinned ? '取消置顶' : '置顶会话'
                              }
                              size='icon'
                              variant='ghost'
                              onClick={() =>
                                rename.mutate({
                                  id: conversation.id,
                                  pinned: !conversation.pinned,
                                })
                              }
                            >
                              {conversation.pinned ? <PinOff /> : <Pin />}
                            </Button>
                            <Button
                              aria-label='重命名会话'
                              size='icon'
                              variant='ghost'
                              onClick={() => {
                                setEditingId(conversation.id)
                                setEditingTitle(conversation.title)
                              }}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              aria-label='删除会话'
                              size='icon'
                              variant='ghost'
                              onClick={() => setPendingDelete(conversation)}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </ScrollArea>

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
          remove.mutate(pendingDelete.id, {
            onSettled: () => setPendingDelete(null),
          })
        }}
      />
    </div>
  )
}

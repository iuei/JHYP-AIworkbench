import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  RotateCcw,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { MyAiCard } from './my-ai-card'
import { moveShortcut, orderShortcuts, shiftShortcut } from './shortcuts'
import type { DashboardAnalysis, DashboardData, DashboardShortcut } from './types'

const SHORTCUT_CARD_HEIGHT = 'min-h-40'

export function Dashboard() {
  const queryClient = useQueryClient()
  const [draggedId, setDraggedId] = useState<string | null>(null)
  // 本地排序意图：拖拽后立即生效，保存失败也不回退（失败时只提示，不丢用户刚调好的顺序）。
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const dashboard = useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get('/dashboard')).data,
  })

  const saveShortcuts = useMutation({
    mutationFn: async (shortcutIds: string[]) =>
      api.put('/dashboard/shortcuts', { shortcutIds }),
    // 保存成功后只刷新服务端数据，不清空 pendingOrder：
    // 清空会让界面在重新拉取完成前闪回旧顺序，而 pendingOrder 与服务端此刻的值本就相同。
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
    onError: () =>
      toast.error('常用入口顺序保存失败，当前顺序仅在本页有效。'),
  })

  // 服务端可能存着历史 ID（project/listing/reviews），必须归一化后再渲染，
  // 否则首页会缺卡片甚至出现无法跳转的空白卡片。
  const shortcuts = orderShortcuts(pendingOrder ?? dashboard.data?.shortcutIds ?? [])

  function commitOrder(nextIds: string[], movedId: string) {
    setPendingOrder(nextIds)
    const title =
      shortcuts.find((item) => item.id === movedId)?.title ?? movedId
    setAnnouncement(
      `已将 ${title} 移动到第 ${nextIds.indexOf(movedId) + 1} 位，共 ${nextIds.length} 个入口。`
    )
    saveShortcuts.mutate(nextIds)
  }

  function reorder(id: string, direction: 'up' | 'down') {
    const ids = shortcuts.map((item) => item.id)
    const nextIds = shiftShortcut(ids, id, direction)
    if (isSameOrder(ids, nextIds)) return
    commitOrder(nextIds, id)
  }

  function dropOn(targetId: string) {
    const movedId = draggedId
    setDraggedId(null)
    if (!movedId || movedId === targetId) return

    const ids = shortcuts.map((item) => item.id)
    const nextIds = moveShortcut(ids, movedId, targetId, 'before')
    if (isSameOrder(ids, nextIds)) return
    commitOrder(nextIds, movedId)
  }

  return (
    <>
      <Main>
        <ShortcutSection
          shortcuts={shortcuts}
          isLoading={dashboard.isLoading}
          orderUnavailable={dashboard.isError}
          saving={saveShortcuts.isPending}
          draggedId={draggedId}
          onDragStart={setDraggedId}
          onDragEnd={() => setDraggedId(null)}
          onDropOn={dropOn}
          onReorder={reorder}
        />

        {/* 排序结果对屏幕阅读器不可见（拖拽和按钮顺序变化都不是可朗读的内容），这里播报一次。 */}
        <p aria-live='polite' className='sr-only'>
          {announcement}
        </p>

        {dashboard.isError ? (
          <DashboardRetry
            retrying={dashboard.isFetching}
            onRetry={() => dashboard.refetch()}
          />
        ) : (
          <div className='grid gap-6 xl:grid-cols-12'>
            {/*
              min-w-0 是必需的：grid item 默认 min-width: auto，列宽又是 1fr（最小值为 auto），
              列表里 truncate 的长标题会把整列撑宽、把页面顶出横向滚动。
            */}
            <MyAiCard className='min-w-0 xl:col-span-7' />
            <RecentActivityCard
              className='min-w-0 xl:col-span-5'
              items={dashboard.data?.analyses ?? []}
              isLoading={dashboard.isLoading}
            />
          </div>
        )}
      </Main>
    </>
  )
}

function isSameOrder(current: string[], next: string[]) {
  return (
    current.length === next.length &&
    current.every((id, index) => id === next[index])
  )
}

type ShortcutSectionProps = {
  shortcuts: DashboardShortcut[]
  isLoading: boolean
  orderUnavailable: boolean
  saving: boolean
  draggedId: string | null
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDropOn: (targetId: string) => void
  onReorder: (id: string, direction: 'up' | 'down') => void
}

function ShortcutSection({
  shortcuts,
  isLoading,
  orderUnavailable,
  saving,
  draggedId,
  onDragStart,
  onDragEnd,
  onDropOn,
  onReorder,
}: ShortcutSectionProps) {
  return (
    <section className='mb-6' aria-labelledby='shortcut-heading'>
      <div className='mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'>
        <h2 id='shortcut-heading' className='font-semibold'>
          常用入口
        </h2>
        <p className='text-xs text-muted-foreground'>
          拖拽卡片，或用卡片上的按钮调整顺序
        </p>
      </div>

      {isLoading ? (
        <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
          {[0, 1, 2, 3].map((index) => (
            <Skeleton
              key={index}
              className={cn(SHORTCUT_CARD_HEIGHT, 'rounded-xl')}
            />
          ))}
        </div>
      ) : (
        <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
          {shortcuts.map((shortcut, index) => (
            <ShortcutCard
              key={shortcut.id}
              shortcut={shortcut}
              index={index}
              total={shortcuts.length}
              saving={saving}
              dragging={draggedId === shortcut.id}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDropOn={onDropOn}
              onReorder={onReorder}
            />
          ))}
        </div>
      )}

      {orderUnavailable && !isLoading && (
        <p className='mt-2 text-xs text-muted-foreground'>
          自定义顺序暂时无法读取，当前按默认顺序展示。
        </p>
      )}
    </section>
  )
}

type ShortcutCardProps = {
  shortcut: DashboardShortcut
  index: number
  total: number
  saving: boolean
  dragging: boolean
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDropOn: (targetId: string) => void
  onReorder: (id: string, direction: 'up' | 'down') => void
}

function ShortcutCard({
  shortcut,
  index,
  total,
  saving,
  dragging,
  onDragStart,
  onDragEnd,
  onDropOn,
  onReorder,
}: ShortcutCardProps) {
  const Icon = shortcut.icon
  const isFirst = index === 0
  const isLast = index === total - 1

  return (
    <Card
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => onDropOn(shortcut.id)}
      className={cn(
        SHORTCUT_CARD_HEIGHT,
        'gap-0 overflow-hidden py-0 transition-shadow hover:shadow-md',
        dragging && 'opacity-50'
      )}
    >
      {/* 拖拽只从卡片主体发起，避免按住排序按钮时误触发拖动。 */}
      <Link
        to={shortcut.to}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', shortcut.id)
          event.dataTransfer.effectAllowed = 'move'
          onDragStart(shortcut.id)
        }}
        onDragEnd={onDragEnd}
        className='flex flex-1 cursor-grab flex-col gap-1.5 p-5 active:cursor-grabbing'
      >
        <Icon aria-hidden='true' className='mb-1 size-5 text-primary' />
        <span className='font-semibold'>{shortcut.title}</span>
        <span className='text-sm text-muted-foreground'>
          {shortcut.description}
        </span>
      </Link>

      {/* 拖拽不是唯一排序方式：键盘和屏幕阅读器用户用这两个按钮。 */}
      <div className='flex items-center justify-between border-t px-3 py-1.5'>
        <GripVertical
          aria-hidden='true'
          className='size-4 text-muted-foreground'
        />
        <div className='flex items-center gap-1'>
          <Button
            type='button'
            size='icon'
            variant='ghost'
            className='size-7'
            disabled={isFirst || saving}
            aria-label={`上移 ${shortcut.title}`}
            onClick={() => onReorder(shortcut.id, 'up')}
          >
            <ArrowUp aria-hidden='true' className='size-4' />
          </Button>
          <Button
            type='button'
            size='icon'
            variant='ghost'
            className='size-7'
            disabled={isLast || saving}
            aria-label={`下移 ${shortcut.title}`}
            onClick={() => onReorder(shortcut.id, 'down')}
          >
            <ArrowDown aria-hidden='true' className='size-4' />
          </Button>
        </div>
      </div>
    </Card>
  )
}

function RecentActivityCard({
  items,
  isLoading,
  className,
}: {
  items: DashboardAnalysis[]
  isLoading: boolean
  className?: string
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>最近活动</CardTitle>
        <CardDescription>最近完成的竞品分析记录。</CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {isLoading ? (
          <ListSkeleton />
        ) : items.length > 0 ? (
          items.map((item) => (
            <Link
              key={item.id}
              to='/competitor-analysis'
              className='block rounded-lg border p-3 transition-colors hover:bg-muted/50'
            >
              <p className='truncate font-medium'>{item.input_value}</p>
              <p className='text-sm text-muted-foreground'>
                {item.input_type}
              </p>
            </Link>
          ))
        ) : (
          <DashboardEmpty text='完成一次竞品分析后，最近的记录会显示在这里' />
        )}
      </CardContent>
    </Card>
  )
}

function ListSkeleton() {
  return (
    <div className='space-y-3'>
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className='h-20 rounded-lg' />
      ))}
    </div>
  )
}

function DashboardEmpty({ text }: { text: string }) {
  return (
    <p className='py-8 text-center text-sm text-muted-foreground'>{text}</p>
  )
}

function DashboardRetry({
  retrying,
  onRetry,
}: {
  retrying: boolean
  onRetry: () => void
}) {
  return (
    <Card>
      <CardContent className='flex flex-col items-center gap-3 py-10 text-center'>
        <p className='text-sm text-muted-foreground'>
          首页数据加载失败，请检查网络后重试。
        </p>
        <Button variant='outline' disabled={retrying} onClick={onRetry}>
          <RotateCcw aria-hidden='true' />
          {retrying ? '重新加载中…' : '重新加载'}
        </Button>
      </CardContent>
    </Card>
  )
}

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, GripVertical, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Main } from '@/components/layout/main'
import { fetchAnalysisHistory } from '@/features/competitor-analysis/api'
import type { HistoryItem } from '@/features/competitor-analysis/types'
import { ActionBar } from './action-bar'
import {
  ATTENTION_SCAN_LIMIT,
  attentionLevelOf,
  pickAttentionAnalyses,
  takeRecentAnalyses,
} from './analyses'
import { AttentionCard, RecentAnalysesCard } from './analyses-cards'
import { MyAiCard } from './my-ai-card'
import { OverviewStats } from './overview-stats'
import { moveShortcut, orderShortcuts, shiftShortcut } from './shortcuts'
import type { DashboardData, DashboardShortcut } from './types'
import { useMyAiSummary } from './use-my-ai'

/** 仪表盘按两行等列宽卡片组织：上方处理与操作，下方分析与 AI。 */
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

  // 同一份分析历史同时供「待处理」「概览」与「最近分析」使用。
  const analyses = useQuery<HistoryItem[]>({
    // 不能复用竞品分析页的 ['competitor-analyses']：那边 limit 是 10，
    // React Query 同 key 共享缓存会让两个页面互相覆盖条数。
    queryKey: ['dashboard', 'recent-analyses'],
    queryFn: () => fetchAnalysisHistory(ATTENTION_SCAN_LIMIT),
  })

  // 「我的 AI」与统计行共用查询缓存（见 use-my-ai.ts）。
  const myAi = useMyAiSummary()

  const saveShortcuts = useMutation({
    mutationFn: async (shortcutIds: string[]) =>
      api.put('/dashboard/shortcuts', { shortcutIds }),
    // 保存成功后只刷新服务端数据，不清空 pendingOrder：
    // 清空会让界面在重新拉取完成前闪回旧顺序，而 pendingOrder 与服务端此刻的值本就相同。
    // exact 是必需的：前缀匹配会连带刷新本页的分析记录与「我的 AI」卡片（每次排序多发三个请求）。
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['dashboard'], exact: true }),
    onError: () => toast.error('常用入口顺序保存失败，当前顺序仅在本页有效。'),
  })

  // 服务端可能存着历史 ID（project/listing/reviews），必须归一化后再渲染，
  // 否则首页会缺卡片甚至出现无法跳转的空白卡片。
  const shortcuts = orderShortcuts(
    pendingOrder ?? dashboard.data?.shortcutIds ?? []
  )

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

  const analysisItems = analyses.data ?? []
  const attentionItems = pickAttentionAnalyses(analysisItems)
  const attentionCount = analysisItems.filter(
    (item) => attentionLevelOf(item) === 'high'
  ).length
  const recentItems = takeRecentAnalyses(analysisItems)

  return (
    <Main className='space-y-6'>
      <OverviewStats
        analysisCount={analysisItems.length}
        attentionCount={attentionCount}
        conversationCount={myAi.conversationCount}
        analysisLoading={analyses.isLoading}
        analysisError={analyses.isError}
        aiLoading={myAi.isLoading}
        aiError={myAi.failed}
        notesTotal={myAi.notesTotal}
        pendingTotal={myAi.pendingTotal}
      />

      <div className='grid items-stretch gap-5 xl:grid-cols-12'>
        <Card className='h-full min-w-0 gap-4 py-5 xl:order-2 xl:col-span-4'>
          <CardHeader className='gap-1'>
            <CardTitle className='text-base'>
              <h2>开始工作</h2>
            </CardTitle>
            <CardDescription>
              从最近的工作继续，或发起新的分析与提问。
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <ActionBar lastAnalysisId={analysisItems[0]?.id ?? null} />
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
              onRetry={() => void dashboard.refetch()}
              retrying={dashboard.isFetching}
            />
          </CardContent>
        </Card>

        <AttentionCard
          className='h-full min-w-0 xl:order-1 xl:col-span-8'
          items={attentionItems}
          totalCount={attentionCount}
          hasRecords={analysisItems.length > 0}
          isLoading={analyses.isLoading}
          isError={analyses.isError}
          onRetry={() => void analyses.refetch()}
        />
      </div>

      {/* 排序结果对屏幕阅读器不可见（拖拽和按钮顺序变化都不是可朗读的内容），这里播报一次。 */}
      <p aria-live='polite' className='sr-only'>
        {announcement}
      </p>

      <div className='grid items-stretch gap-5 xl:grid-cols-12'>
        <RecentAnalysesCard
          className='h-full min-w-0 xl:col-span-8'
          items={recentItems}
          isLoading={analyses.isLoading}
          isError={analyses.isError}
          onRetry={() => void analyses.refetch()}
        />
        <MyAiCard className='h-full min-w-0 xl:col-span-4' />
      </div>
    </Main>
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
  onRetry: () => void
  retrying: boolean
}

/** 开始工作卡片里的常用入口；保留拖拽、键盘排序与顺序持久化。 */
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
  onRetry,
  retrying,
}: ShortcutSectionProps) {
  return (
    <section aria-labelledby='shortcut-heading' className='border-t pt-3'>
      <div className='mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1'>
        <h3 id='shortcut-heading' className='text-sm font-semibold'>
          常用入口
        </h3>
      </div>

      {isLoading ? (
        <div className='space-y-1'>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className='h-9 rounded-md' />
          ))}
        </div>
      ) : (
        <div className='divide-y divide-border/70'>
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
        <div className='mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
          <span>自定义顺序暂时无法读取，当前按默认顺序展示。</span>
          <Button
            size='sm'
            variant='ghost'
            disabled={retrying}
            onClick={onRetry}
          >
            <RotateCcw aria-hidden='true' />
            {retrying ? '重新加载中…' : '重新加载'}
          </Button>
        </div>
      )}
      <p className='sr-only'>拖拽入口，或使用右侧按钮调整顺序。</p>
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
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => onDropOn(shortcut.id)}
      className={cn(
        'min-w-0 transition-colors hover:bg-muted/40',
        dragging && 'opacity-50'
      )}
    >
      <div className='flex min-w-0 items-stretch'>
        {/* 拖拽只从卡片主体发起，避免按住排序按钮时误触发拖动。 */}
        <Link
          to={shortcut.to}
          search={shortcut.search}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('text/plain', shortcut.id)
            event.dataTransfer.effectAllowed = 'move'
            onDragStart(shortcut.id)
          }}
          onDragEnd={onDragEnd}
          className='flex min-w-0 flex-1 cursor-grab items-center gap-2 py-1 pr-2 active:cursor-grabbing'
        >
          <Icon aria-hidden='true' className='size-4 shrink-0 text-primary' />
          <span className='flex min-w-0 items-baseline gap-2 text-sm'>
            <span className='shrink-0 font-medium'>{shortcut.title}</span>
            <span
              className='min-w-0 truncate text-xs text-muted-foreground'
              title={shortcut.description}
            >
              {shortcut.description}
            </span>
          </span>
        </Link>

        {/* 拖拽不是唯一排序方式：键盘和屏幕阅读器用户用这两个按钮。 */}
        <div className='flex shrink-0 items-center gap-0.5'>
          <GripVertical
            aria-hidden='true'
            className='size-4 text-muted-foreground'
          />
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
    </div>
  )
}

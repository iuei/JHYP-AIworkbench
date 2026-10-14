import { Link } from '@tanstack/react-router'
import { AlertTriangle, CircleCheck, CircleHelp, RotateCcw } from 'lucide-react'
import {
  TABLE_CELL_ACTIONS,
  TABLE_CELL_META,
  TABLE_CELL_MONO,
  TABLE_CELL_NUMERIC,
  TABLE_EMPTY_VALUE,
  TABLE_HEAD_ACTIONS,
  TABLE_HEAD_NUMERIC,
} from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/hooks/use-media-query'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TableCell, TableHead, TableRow } from '@/components/ui/table'
import { DataTable } from '@/components/data-table'
/*
 * 跨模块复用竞品分析的「判定」徽章：它回答的是同一个问题（这条记录现在还要不要我处理），
 * 口径必须只有一份（`openLevel` + 已销账提示）—— 首页与竞品分析历史表各写一套必然分叉。
 * 同类复用已有先例：本模块一直用 `@/features/competitor-analysis/format` 的严重度文案。
 */
import { HistoryLevelBadge } from '@/features/competitor-analysis/components/history-level-badge'
import type { HistoryItem } from '@/features/competitor-analysis/types'
import {
  ATTENTION_DISPLAY_LIMIT,
  ATTENTION_SCAN_LIMIT,
  attentionCountOf,
  formatRelativeTime,
} from './analyses'

type AnalysisErrorProps = {
  onRetry: () => void
}

type AttentionCardProps = AnalysisErrorProps & {
  /** 已筛出未销账高优先级的记录（最多 3 条）。 */
  items: HistoryItem[]
  /** 最近 20 次内全部需处理记录数，可能多于表格展示上限。 */
  totalCount: number
  /** 扫描范围内是否存在任何分析记录：决定空态说"没有需处理的"还是"还没有记录"。 */
  hasRecords: boolean
  isLoading: boolean
  isError: boolean
  className?: string
}

/**
 * 需立即处理的分析。
 *
 * 两种空态必须区分：范围内没有 `high` ≠ 一条记录都没有。
 * 且描述里写明扫描范围——否则用户会把「最近 20 次里没有」读成「全部历史都没有」。
 *
 * 2026-09-17 从卡片列表改为**数据表格**：改造前 3 条记录各占约 170px 的红框卡片
 * （实测整块 880px，独占首屏 88%），而每条要读的只有"哪条记录、几个问题、什么时候"。
 * 表格一行一条之后整块降到约 250px，首屏能同时容下需处理与最近分析。
 * 行首不再重复「需立即处理」徽标 —— 整块标题已经说了这件事。
 */
export function AttentionCard({
  items,
  totalCount,
  hasRecords,
  isLoading,
  isError,
  onRetry,
  className,
}: AttentionCardProps) {
  const isCompact = useMediaQuery('(max-width: 1023px)')
  const emptyText = hasRecords
    ? `最近 ${ATTENTION_SCAN_LIMIT} 次分析里没有需要立即处理的问题`
    : '还没有分析记录，做完一次分析后这里会列出需立即处理的问题'

  return (
    <Card className={cn('gap-4 py-5', className)}>
      <CardHeader className='gap-1'>
        <CardTitle className='flex items-center gap-2 text-base'>
          {isLoading || isError ? (
            <CircleHelp
              aria-hidden='true'
              className='size-4 text-muted-foreground'
            />
          ) : totalCount > 0 ? (
            <AlertTriangle
              aria-hidden='true'
              className='size-4 text-destructive'
            />
          ) : (
            <CircleCheck
              aria-hidden='true'
              className='size-4 text-muted-foreground'
            />
          )}
          <h2>需处理的分析</h2>
        </CardTitle>
        <CardDescription>
          {isError
            ? '分析记录暂时无法读取，请重新加载。'
            : isLoading
              ? `正在检查最近 ${ATTENTION_SCAN_LIMIT} 次分析。`
              : totalCount > 0
                ? `最近 ${ATTENTION_SCAN_LIMIT} 次分析中有 ${totalCount} 条尚未销账的高优先级记录。${totalCount > ATTENTION_DISPLAY_LIMIT ? `这里只展示最近 ${ATTENTION_DISPLAY_LIMIT} 条。` : ''}`
                : `最近 ${ATTENTION_SCAN_LIMIT} 次分析中没有尚未销账的高优先级记录。`}
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-1 flex-col gap-4'>
        {isError ? (
          <AnalysisError onRetry={onRetry} />
        ) : isCompact ? (
          isLoading ? (
            <div className='space-y-2'>
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className='h-16 rounded-md' />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className='py-6 text-center text-sm text-muted-foreground'>
              {emptyText}
            </p>
          ) : (
            <div className='divide-y divide-border/70'>
              {items.map((item) => (
                <div
                  key={item.id}
                  className='flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0'
                >
                  <div className='min-w-0 flex-1 space-y-1'>
                    <p
                      className='truncate text-sm font-medium'
                      title={item.headline ?? item.inputValue}
                    >
                      {item.headline ?? item.inputValue}
                    </p>
                    <p
                      className='truncate font-mono text-xs text-muted-foreground'
                      title={item.inputValue}
                    >
                      {item.inputValue}
                    </p>
                    <p className='text-xs text-muted-foreground'>
                      待处理 {attentionCountOf(item)} ·{' '}
                      {formatRelativeTime(item.createdAt)}
                    </p>
                  </div>
                  <Button
                    asChild
                    size='sm'
                    variant='outline'
                    className='shrink-0'
                  >
                    <Link
                      to='/competitor-analysis'
                      search={{ analysisId: item.id }}
                      aria-label={`回看分析记录 #${item.id}`}
                    >
                      回看
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
          )
        ) : (
          <DataTable
            columns={5}
            className='[&_table]:min-w-[46rem] [&_table]:table-fixed'
            isLoading={isLoading}
            isEmpty={items.length === 0}
            emptyText={emptyText}
            header={
              <TableRow>
                <TableHead className='w-[40%]'>结论</TableHead>
                <TableHead className='w-[24%]'>ASIN</TableHead>
                <TableHead
                  className={cn('w-[12%]', TABLE_HEAD_NUMERIC)}
                  title='扣掉已销账 / 已核验 / 已忽略之后，还剩几条待处理'
                >
                  待处理
                </TableHead>
                <TableHead className='w-[14%]'>时间</TableHead>
                <TableHead className={cn('w-[10%]', TABLE_HEAD_ACTIONS)}>
                  操作
                </TableHead>
              </TableRow>
            }
          >
            {items.map((item) => (
              <TableRow key={item.id}>
                {/*
                  `min-w` + `max-w` + `truncate`：宽屏下最多 32rem、内容短时自动收缩，
                  窄屏下不再把这一列压成 "B…"（表格自己横向滚动，页面不溢出）。
                  不要改成 `max-w-0`：那会让窄屏下整列宽度趋近 0、内容完全读不出来。
                */}
                <TableCell
                  className='max-w-[32rem] min-w-[16rem] truncate font-medium'
                  title={item.headline ?? item.inputValue}
                >
                  {item.headline ?? item.inputValue}
                </TableCell>
                <TableCell
                  className={cn(TABLE_CELL_MONO, 'truncate')}
                  title={item.inputValue}
                >
                  {item.inputValue}
                </TableCell>
                <TableCell className={TABLE_CELL_NUMERIC}>
                  {attentionCountOf(item)}
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {formatRelativeTime(item.createdAt)}
                </TableCell>
                <TableCell className={TABLE_CELL_ACTIONS}>
                  <Button asChild size='sm' variant='outline'>
                    <Link
                      to='/competitor-analysis'
                      search={{ analysisId: item.id }}
                      aria-label={`回看分析记录 #${item.id}`}
                    >
                      回看
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        )}
        {!isLoading && !isError && items.length > 0 && (
          <p className='mt-auto border-t pt-3 text-xs text-muted-foreground'>
            消除提醒：回看分析，在结论页将问题标记为已处理或不处理。
          </p>
        )}
      </CardContent>
    </Card>
  )
}

type RecentAnalysesCardProps = AnalysisErrorProps & {
  /** 最近的分析记录（最多 5 条，服务端已按时间倒序）。 */
  items: HistoryItem[]
  isLoading: boolean
  isError: boolean
  className?: string
}

/**
 * 最近分析。
 *
 * 2026-09-17 从卡片列表改为**数据表格**（与「需处理的分析」同源、同形态）。
 * **刻意不显示结论文本**：这一块回答的是"我最近做过哪些分析、结果严不严重"，
 * 结论详情在快照里读；把 `headline` 也摆上来会让每行变成两行、并重新把列表拉高。
 * `index.test.tsx` 有断言守住这一点（medium 那条的结论不得出现在首页）。
 */
export function RecentAnalysesCard({
  items,
  isLoading,
  isError,
  onRetry,
  className,
}: RecentAnalysesCardProps) {
  const isCompact = useMediaQuery('(max-width: 1023px)')

  return (
    <Card className={cn('gap-4 py-5', className)}>
      <CardHeader className='gap-1'>
        <CardTitle className='text-base'>
          <h2>最近分析</h2>
        </CardTitle>
        <CardDescription>点击任意记录可回看当时的分析结果。</CardDescription>
      </CardHeader>
      <CardContent>
        {isError ? (
          <AnalysisError onRetry={onRetry} />
        ) : isCompact ? (
          isLoading ? (
            <div className='space-y-2'>
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className='h-16 rounded-md' />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className='py-6 text-center text-sm text-muted-foreground'>
              还没有分析记录，从上面的「新建分析」开始
            </p>
          ) : (
            <div className='divide-y divide-border/70'>
              {items.map((item) => (
                <div
                  key={item.id}
                  className='flex min-w-0 items-center gap-3 py-3 first:pt-0 last:pb-0'
                >
                  <div className='min-w-0 flex-1 space-y-1'>
                    <p
                      className='truncate font-mono text-sm font-medium'
                      title={item.inputValue}
                    >
                      {item.inputValue}
                    </p>
                    <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground'>
                      <span>{item.marketplace ?? TABLE_EMPTY_VALUE}</span>
                      <span>问题 {item.findingCount}</span>
                      <HistoryLevelBadge item={item} />
                      <span>{formatRelativeTime(item.createdAt)}</span>
                    </div>
                  </div>
                  <Button
                    asChild
                    size='sm'
                    variant='outline'
                    className='shrink-0'
                  >
                    <Link
                      to='/competitor-analysis'
                      search={{ analysisId: item.id }}
                      aria-label={`回看分析记录 #${item.id}`}
                    >
                      回看
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
          )
        ) : (
          <DataTable
            columns={6}
            isLoading={isLoading}
            isEmpty={items.length === 0}
            emptyText='还没有分析记录，从上面的「新建分析」开始'
            header={
              <TableRow>
                <TableHead>查询</TableHead>
                <TableHead className='w-16'>站点</TableHead>
                <TableHead className={cn('w-20', TABLE_HEAD_NUMERIC)}>
                  问题数
                </TableHead>
                <TableHead className='w-28'>严重度</TableHead>
                <TableHead className='w-28'>时间</TableHead>
                <TableHead className={cn('w-20', TABLE_HEAD_ACTIONS)}>
                  操作
                </TableHead>
              </TableRow>
            }
          >
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell
                  className={cn(
                    TABLE_CELL_MONO,
                    'max-w-[20rem] min-w-[9rem] truncate'
                  )}
                  title={item.inputValue}
                >
                  {item.inputValue}
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {item.marketplace ?? TABLE_EMPTY_VALUE}
                </TableCell>
                <TableCell className={TABLE_CELL_NUMERIC}>
                  {item.findingCount}
                </TableCell>
                <TableCell>
                  <HistoryLevelBadge item={item} />
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {formatRelativeTime(item.createdAt)}
                </TableCell>
                <TableCell className={TABLE_CELL_ACTIONS}>
                  <Button asChild size='sm' variant='outline'>
                    <Link
                      to='/competitor-analysis'
                      search={{ analysisId: item.id }}
                      aria-label={`回看分析记录 #${item.id}`}
                    >
                      回看
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        )}
      </CardContent>
    </Card>
  )
}

function AnalysisError({ onRetry }: AnalysisErrorProps) {
  return (
    <div className='flex flex-col items-center gap-3 py-6 text-center'>
      <p className='text-sm text-muted-foreground'>
        分析记录加载失败，请检查网络后重试。
      </p>
      <Button variant='outline' size='sm' onClick={onRetry}>
        <RotateCcw aria-hidden='true' />
        重新加载
      </Button>
    </div>
  )
}

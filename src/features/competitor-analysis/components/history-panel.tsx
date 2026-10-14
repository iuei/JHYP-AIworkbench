import { History, RefreshCw } from 'lucide-react'
import {
  TABLE_CELL_ACTIONS,
  TABLE_CELL_META,
  TABLE_HEAD_ACTIONS,
} from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { TableCell, TableHead, TableRow } from '@/components/ui/table'
import { DataTable } from '@/components/data-table'
import { compareLabelOf, formatDateTime } from '../format'
import { HistoryLevelBadge } from './history-level-badge'
import type { HistoryItem } from '../types'

/** 列数：判定 / 结论 / ASIN / 站点 / 区间 / 时间 / 操作。 */
const HISTORY_COLUMNS = 7

type HistoryPanelProps = {
  items: HistoryItem[]
  loading: boolean
  refreshing: boolean
  activeId: number | null
  onSelect: (id: number) => void
  onRefresh: () => void
}

/**
 * 历史分析（数据表格）。
 *
 * 只列当前账号自己的记录（服务端按 user_id 过滤，越权读取一律 404）；
 * 「回看」打开的是**落库时的结果快照**，不是用今天的数据重算 —— 这样"当时的结论"可追溯。
 *
 * 2026-09-16 由右栏卡片列表改为**整宽表格**（用户口径：「系统内所有内容优先使用数据表格展示」）：
 * 每条记录本来就是可比的一行数据（判定 / 结论 / ASIN / 站点 / 区间 / 时间），
 * 而卡片形式把它压进 20rem（320px）宽的侧栏 —— 结论摘要只够显示一行半，
 * 想按时间或按 ASIN 扫一眼"上周那两个 ASIN 分析过没有"都做不到。
 * 表格同时让这一页从"主栏 + 侧栏"变成单栏：主任务（做分析、看结论）因此拿回全部宽度。
 */
export function HistoryPanel({
  items,
  loading,
  refreshing,
  activeId,
  onSelect,
  onRefresh,
}: HistoryPanelProps) {
  return (
    <Card>
      <CardHeader className='gap-1'>
        <div className='flex items-center justify-between gap-2'>
          <CardTitle className='flex items-center gap-2 text-base'>
            <History className='size-4' aria-hidden='true' />
            历史分析
          </CardTitle>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={onRefresh}
            disabled={refreshing}
            aria-label='刷新历史分析列表'
          >
            <RefreshCw
              className={refreshing ? 'animate-spin' : undefined}
              aria-hidden='true'
            />
          </Button>
        </div>
        <CardDescription>
          最近 10 条；点「回看」打开那次分析的数据明细（读当时的快照，不用今天的数据重算）
        </CardDescription>
      </CardHeader>

      <CardContent>
        <DataTable
          columns={HISTORY_COLUMNS}
          density='compact'
          emptyText='还没有分析记录。完成一次分析后会自动保存，方便下次直接回看。'
          isEmpty={items.length === 0}
          isLoading={loading}
          skeletonRows={3}
          header={
            <TableRow>
              <TableHead>判定</TableHead>
              <TableHead>结论</TableHead>
              <TableHead>ASIN</TableHead>
              <TableHead>站点</TableHead>
              <TableHead>区间</TableHead>
              <TableHead>时间</TableHead>
              <TableHead className={TABLE_HEAD_ACTIONS}>操作</TableHead>
            </TableRow>
          }
        >
          {items.map((item) => {
            const isActive = activeId === item.id
            return (
              <TableRow
                key={item.id}
                data-history-row={item.id}
                data-state={isActive ? 'selected' : undefined}
              >
                <TableCell>
                  <HistoryLevelBadge item={item} />
                </TableCell>
                <TableCell className='max-w-96'>
                  <span
                    className='block truncate'
                    title={item.headline ?? item.inputValue}
                  >
                    {item.headline ?? item.inputValue}
                  </span>
                </TableCell>
                <TableCell className={cn(TABLE_CELL_META, 'max-w-72')}>
                  <span
                    className='block truncate'
                    title={item.asins.join('、')}
                  >
                    {item.asins.join('、')}
                  </span>
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {item.marketplace ? `${item.marketplace} 站` : '—'}
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {item.windowDays ? `${item.windowDays} 天` : '—'}
                  {item.compareWith
                    ? ` · ${compareLabelOf(item.compareWith)}`
                    : ''}
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {formatDateTime(item.createdAt)}
                </TableCell>
                <TableCell className={TABLE_CELL_ACTIONS}>
                  <div className='flex items-center justify-end gap-2'>
                    {/* 没有快照的记录只能看到参数：如实标出来，别让「回看」看起来一样 */}
                    {!item.hasSnapshot && (
                      <span className='text-xs text-muted-foreground'>
                        无快照
                      </span>
                    )}
                    <Button
                      type='button'
                      variant={isActive ? 'secondary' : 'outline'}
                      size='sm'
                      /* 端到端脚本按这个属性定位历史条目（不依赖文案与顺序） */
                      data-history-item={item.id}
                      aria-current={isActive ? 'true' : undefined}
                      onClick={() => onSelect(item.id)}
                    >
                      回看
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </DataTable>
      </CardContent>
    </Card>
  )
}

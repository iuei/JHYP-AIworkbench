import { RefreshCw, Trash2 } from 'lucide-react'
import {
  TABLE_CELL_ACTIONS,
  TABLE_CELL_META,
  TABLE_CELL_NUMERIC,
  TABLE_HEAD_ACTIONS,
  TABLE_HEAD_NUMERIC,
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
import { formatDateTime } from '../format'
import type { ComparisonHistoryItem } from '../types'

/** 列数：对比 / 站点 / 候选数 / 区间 / 时间 / 操作。 */
const HISTORY_COLUMNS = 6

type ComparisonHistoryProps = {
  items: ComparisonHistoryItem[]
  loading: boolean
  refreshing: boolean
  activeId: number | null
  onSelect: (id: number) => void
  onDelete: (item: ComparisonHistoryItem) => void
  onRefresh: () => void
}

/**
 * 历史对比（数据表格）。
 *
 * 每一条都是**当时的快照**：回看读的是落库的 `result`，不用今天的数据重算。
 * 否则同一份记录在不同日期打开会得到不同数字，而它的创建时间却写着当初 ——
 * 那比"没有历史"更有害。
 *
 * 2026-09-16 由右栏卡片列表改为**整宽表格**（用户口径：「系统内所有内容优先使用数据表格展示」）：
 * 每条记录的 站点 / 候选数 / 区间 / 时间 都是可比字段，卡片把它们摊成四行塞进 20rem 侧栏，
 * 想按时间或按站点扫一眼"上周那批对比过没有"都做不到。表格同时让本页从"主栏 + 侧栏"变单栏，
 * 候选池与对比结果因此拿回全部宽度。
 */
export function ComparisonHistory({
  items,
  loading,
  refreshing,
  activeId,
  onSelect,
  onDelete,
  onRefresh,
}: ComparisonHistoryProps) {
  return (
    <Card>
      <CardHeader className='gap-1'>
        <div className='flex items-center justify-between gap-2'>
          <CardTitle className='text-base'>历史对比</CardTitle>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            aria-label='刷新历史对比'
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw
              aria-hidden='true'
              className={cn(refreshing && 'animate-spin')}
            />
          </Button>
        </div>
        <CardDescription>
          结果以快照保存，点「回看」打开当时的结果，不会用今天的数据重算
        </CardDescription>
      </CardHeader>

      <CardContent>
        <DataTable
          columns={HISTORY_COLUMNS}
          density='compact'
          emptyText='还没有保存过对比。在「候选池」里勾选 2 个以上候选后即可发起对比。'
          isEmpty={items.length === 0}
          isLoading={loading}
          skeletonRows={3}
          header={
            <TableRow>
              <TableHead>对比</TableHead>
              <TableHead>站点</TableHead>
              <TableHead className={TABLE_HEAD_NUMERIC}>候选数</TableHead>
              <TableHead>区间</TableHead>
              <TableHead>时间</TableHead>
              <TableHead className={TABLE_HEAD_ACTIONS}>操作</TableHead>
            </TableRow>
          }
        >
          {items.map((item) => {
            const isActive = activeId === item.id
            const label = item.title || `${item.candidateCount} 个候选对比`
            return (
              <TableRow
                key={item.id}
                data-comparison-history={item.id}
                data-state={isActive ? 'selected' : undefined}
              >
                <TableCell className='max-w-80'>
                  <span className='block truncate font-medium' title={label}>
                    {label}
                  </span>
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {item.marketplace ? `${item.marketplace} 站` : '—'}
                </TableCell>
                <TableCell className={cn(TABLE_CELL_META, TABLE_CELL_NUMERIC)}>
                  {item.candidateCount}
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {item.startDate} ~ {item.endDate}
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {formatDateTime(item.createdAt)}
                </TableCell>
                <TableCell className={TABLE_CELL_ACTIONS}>
                  <div className='flex items-center justify-end gap-1'>
                    <Button
                      type='button'
                      size='sm'
                      variant={isActive ? 'secondary' : 'outline'}
                      aria-current={isActive ? 'true' : undefined}
                      onClick={() => onSelect(item.id)}
                    >
                      回看
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      aria-label={`删除 ${formatDateTime(item.createdAt)} 的对比记录`}
                      onClick={() => onDelete(item)}
                    >
                      <Trash2 aria-hidden='true' />
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

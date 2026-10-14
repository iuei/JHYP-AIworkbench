import { Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTable, type DataTablePagination } from '@/components/data-table'
import { TableCell, TableHead, TableRow } from '@/components/ui/table'
import {
  TABLE_CELL_META,
  TABLE_CELL_MONO,
  TABLE_CELL_NUMERIC,
  TABLE_CELL_TRUNCATE,
  TABLE_EMPTY_VALUE,
  TABLE_HEAD_ACTIONS,
  TABLE_HEAD_NUMERIC,
} from '@/lib/table-styles'
import { STAGE_VARIANTS, formatCurrency } from '../format'
import type { Candidate } from '../types'

/** 列数必须与 header 的行数一致（空态行与骨架行按它跨列）。 */
const COLUMN_COUNT = 9

type CandidateTableProps = {
  items: Candidate[]
  total: number
  loading: boolean
  refreshing: boolean
  error: unknown
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  hasFilters: boolean
  selectedIds: Set<number>
  onToggle: (id: number) => void
  onToggleAll: () => void
  onEdit: (candidate: Candidate) => void
  onDelete: (candidate: Candidate) => void
  toolbar: React.ReactNode
}

export function CandidateTable({
  items,
  total,
  loading,
  refreshing,
  error,
  page,
  pageSize,
  onPageChange,
  hasFilters,
  selectedIds,
  onToggle,
  onToggleAll,
  onEdit,
  onDelete,
  toolbar,
}: CandidateTableProps) {
  const allSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id))

  const pagination: DataTablePagination = {
    page,
    pageSize,
    total,
    onPageChange,
    disabled: refreshing,
  }

  return (
    <DataTable
      columns={COLUMN_COUNT}
      isLoading={loading}
      isError={Boolean(error)}
      errorText='候选池加载失败，请稍后重试。'
      isEmpty={items.length === 0}
      emptyText={
        hasFilters
          ? '没有符合筛选条件的候选产品，试试放宽关键词或清空筛选。'
          : '候选池还是空的。可以手工新增，也可以直接导入表格（支持 CSV / XLSX 与从 Excel 复制粘贴）。'
      }
      toolbar={toolbar}
      pagination={pagination}
      header={
        <TableRow>
          <TableHead className='w-10'>
            <Checkbox
              checked={allSelected}
              onCheckedChange={onToggleAll}
              aria-label={allSelected ? '取消全选本页候选' : '全选本页候选'}
            />
          </TableHead>
          <TableHead>产品名称</TableHead>
          <TableHead>ASIN</TableHead>
          <TableHead>类目</TableHead>
          <TableHead className={TABLE_HEAD_NUMERIC}>目标售价</TableHead>
          <TableHead>站点</TableHead>
          <TableHead>阶段</TableHead>
          <TableHead>来源</TableHead>
          <TableHead className={TABLE_HEAD_ACTIONS}>操作</TableHead>
        </TableRow>
      }
    >
      {items.map((item) => (
        <TableRow key={item.id}>
          <TableCell>
            <Checkbox
              checked={selectedIds.has(item.id)}
              onCheckedChange={() => onToggle(item.id)}
              aria-label={`选择候选 ${item.product_name || item.asin || item.id}`}
            />
          </TableCell>
          <TableCell className={TABLE_CELL_TRUNCATE} title={item.product_name || undefined}>
            {item.product_name || <span className={TABLE_CELL_META}>未填名称</span>}
            {item.note ? (
              <p className={`mt-0.5 truncate ${TABLE_CELL_META}`} title={item.note}>
                {item.note}
              </p>
            ) : null}
          </TableCell>
          <TableCell className={TABLE_CELL_MONO}>
            {item.asin ?? <span className={TABLE_CELL_META}>未填</span>}
          </TableCell>
          <TableCell className={TABLE_CELL_META}>
            {item.category || TABLE_EMPTY_VALUE}
          </TableCell>
          <TableCell className={TABLE_CELL_NUMERIC}>
            {item.target_price === null ? (
              <span className={TABLE_CELL_META}>{TABLE_EMPTY_VALUE}</span>
            ) : (
              formatCurrency(item.target_price)
            )}
          </TableCell>
          <TableCell>{item.marketplace}</TableCell>
          <TableCell>
            <Badge variant={STAGE_VARIANTS[item.stage]}>{item.stageLabel}</Badge>
          </TableCell>
          <TableCell className={TABLE_CELL_META}>
            {item.source === 'import' ? '表格导入' : '手工录入'}
          </TableCell>
          <TableCell className='text-right whitespace-nowrap'>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label={`编辑 ${item.product_name || item.asin || item.id}`}
              onClick={() => onEdit(item)}
            >
              <Pencil aria-hidden='true' />
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              aria-label={`删除 ${item.product_name || item.asin || item.id}`}
              onClick={() => onDelete(item)}
            >
              <Trash2 aria-hidden='true' />
            </Button>
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  )
}

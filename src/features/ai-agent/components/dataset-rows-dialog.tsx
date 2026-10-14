import { useState } from 'react'
import { Download, Search } from 'lucide-react'
import { toast } from 'sonner'
import {
  TABLE_CELL_NUMERIC,
  TABLE_EMPTY_VALUE,
  TABLE_HEAD_NUMERIC,
  TABLE_SEARCH_ICON,
  TABLE_SEARCH_INPUT,
} from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { TableCell, TableHead, TableRow } from '@/components/ui/table'
import { DataTable } from '@/components/data-table'
import { useDatasetRows, useExportDatasetRows } from '../api/queries'
import { formatDate, formatTime } from '../format'
import type { DatasetOverviewItem, DatasetRowColumn } from '../types'

/** 数值列右对齐：对齐后的数字才能一眼比大小。 */
const NUMERIC_TYPES = new Set<DatasetRowColumn['type']>(['integer', 'decimal'])

/**
 * 数据源详情弹窗：查看某个数据集实际写进去的行。
 *
 * 与知识库「切片预览」弹窗同一形态（Dialog），但内容更多，因此多了两件事：
 * 1. 关键词筛选走服务端（数据集上万行，前端过滤等于先拉全量）；
 * 2. 表格限高 + 表头吸顶，翻到第 20 行仍知道每列是什么。
 *
 * 组件由调用方用 `key` 按数据集重挂载，所以页码/关键词直接以初始值声明，不在 effect 里同步。
 */
export function DatasetRowsDialog({
  dataset,
  onOpenChange,
}: {
  dataset: DatasetOverviewItem | null
  onOpenChange: (open: boolean) => void
}) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  // 防抖后才发请求：逐字输入会把每按一个键都变成一次查询
  const debouncedKeyword = useDebouncedValue(keyword, 300)
  const activeKeyword = debouncedKeyword.trim()

  const rows = useDatasetRows({
    dataset: dataset?.key ?? null,
    page,
    pageSize,
    keyword: activeKeyword || undefined,
  })
  const exportRows = useExportDatasetRows()

  const columns = rows.data?.columns ?? []
  const data = rows.data?.rows ?? []
  const total = rows.data?.total ?? 0

  const onExport = () => {
    if (!dataset) return
    exportRows.mutate(
      { dataset: dataset.key, keyword: activeKeyword || undefined },
      {
        onSuccess: ({ text, truncated }) => {
          const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = `${dataset.label}-${new Date().toISOString().slice(0, 10)}.csv`
          document.body.appendChild(anchor)
          anchor.click()
          anchor.remove()
          URL.revokeObjectURL(url)
          // 触顶时服务端带 X-Export-Truncated：静默给半个文件会被当成"就这么多数据"
          toast.success(
            truncated
              ? '导出完成（已达 2 万行上限，仅含部分数据，请缩小筛选范围）'
              : '导出完成（导出动作已写入审计）'
          )
        },
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : '导出失败，请稍后重试'
          ),
      }
    )
  }

  return (
    <Dialog open={Boolean(dataset)} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-5xl'>
        <DialogHeader>
          <DialogTitle>数据详情 · {dataset?.label ?? ''}</DialogTitle>
          <DialogDescription>
            {dataset?.rows ?? 0} 行 · 数据截至 {formatDate(dataset?.importedAt)}
            {dataset?.periodStart && dataset?.periodEnd
              ? ` · 覆盖周期 ${formatDate(dataset.periodStart)} ~ ${formatDate(dataset.periodEnd)}`
              : ''}
            {dataset?.lastImportAt
              ? ` · 最近导入 ${formatTime(dataset.lastImportAt)}`
              : ''}
          </DialogDescription>
        </DialogHeader>

        {/*
          滚动与表头吸顶交给 DataTable：`maxHeightClass` 限高、`stickyHeader` 让 thead 在内部滚动区里吸顶。
          外层再套一层 overflow 会多出一个滚动祖先，表头会随行滚走。
        */}
        <DataTable
          columns={Math.max(1, columns.length)}
          emptyText={
            activeKeyword
              ? `没有匹配「${activeKeyword}」的数据行。`
              : '该数据集还没有数据，先在上方选择数据集并上传报表。'
          }
          errorText='数据加载失败，请稍后重试。'
          header={
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  className={cn(
                    'whitespace-nowrap',
                    NUMERIC_TYPES.has(column.type) && TABLE_HEAD_NUMERIC
                  )}
                  key={column.key}
                >
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          }
          isEmpty={data.length === 0}
          isError={rows.isError}
          isLoading={rows.isLoading}
          maxHeightClass='max-h-[55vh]'
          pagination={
            rows.data
              ? {
                  disabled: rows.isFetching,
                  page: rows.data.page,
                  pageSize: rows.data.pageSize,
                  total,
                  onPageChange: setPage,
                  onPageSizeChange: (size) => {
                    setPageSize(size)
                    setPage(1)
                  },
                }
              : undefined
          }
          stickyHeader
          toolbar={
            <div className='flex flex-wrap items-center gap-2'>
              <div className='relative min-w-56 flex-1'>
                <Search aria-hidden='true' className={TABLE_SEARCH_ICON} />
                <Input
                  aria-label='搜索数据行'
                  className={TABLE_SEARCH_INPUT}
                  placeholder='搜索 ASIN / SKU / 广告活动 / 站点…'
                  value={keyword}
                  onChange={(event) => {
                    setKeyword(event.target.value)
                    // 页码与筛选同时绑定：留在第 3 页会把"筛选后只有 1 页"变成一张空表
                    setPage(1)
                  }}
                />
              </div>
              <Button
                className='gap-2'
                disabled={exportRows.isPending || total === 0}
                variant='outline'
                onClick={onExport}
              >
                <Download aria-hidden='true' />
                {exportRows.isPending ? '导出中…' : '导出 CSV'}
              </Button>
            </div>
          }
        >
          {data.map((row, index) => (
            // 行主键由服务端随行返回；缺失时退回下标，避免整表共用一个 key
            <TableRow key={String(row.id ?? index)}>
              {columns.map((column) => (
                <TableCell
                  className={cn(
                    'whitespace-nowrap',
                    NUMERIC_TYPES.has(column.type) && TABLE_CELL_NUMERIC
                  )}
                  key={column.key}
                >
                  {renderCell(row[column.key])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </DataTable>
      </DialogContent>
    </Dialog>
  )
}

/** 空值统一显示为「—」：留白会让人分不清"字段为空"和"这一列没加载出来"。 */
function renderCell(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return <span className='text-muted-foreground'>{TABLE_EMPTY_VALUE}</span>
  }
  return String(value)
}

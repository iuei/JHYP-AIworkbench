import { useRef, useState } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { rawRequest } from '@/api/client'
import {
  TABLE_CELL_META,
  TABLE_CELL_NUMERIC,
  TABLE_HEAD_NUMERIC,
} from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { TableCell, TableHead, TableRow } from '@/components/ui/table'
import { DataTable } from '@/components/data-table'
import { useDatasets, useImportDataset, useImportHistory } from '../api/queries'
import { DatasetRowsDialog } from '../components/dataset-rows-dialog'
import { PageShell } from '../components/page-shell'
import { formatDate, formatTime } from '../format'
import type { DatasetImportResult, DatasetOverviewItem } from '../types'

const MODE_LABELS: Record<string, string> = {
  overwrite: '覆盖同周期数据',
  append: '追加（跳过重复行）',
}

export function DatasourceManagement() {
  const [dataset, setDataset] = useState('amazon_ads_daily')
  const [mode, setMode] = useState<'overwrite' | 'append'>('overwrite')
  const [lastResult, setLastResult] = useState<DatasetImportResult | null>(null)
  /** 上次导入的数据集 key：导入结果卡片据此提供"查看刚导入的数据"入口。 */
  const [lastImportedKey, setLastImportedKey] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  /** 详情弹窗当前查看的数据集 key（null = 关闭）。 */
  const [detailKey, setDetailKey] = useState<string | null>(null)
  /** 导入规则是"第一次导入才读一遍"的说明，默认折叠，需要时展开。 */
  const [rulesOpen, setRulesOpen] = useState(false)

  const overview = useDatasets()
  const history = useImportHistory({ dataset, page, pageSize })
  const upload = useImportDataset()

  const activeSpec =
    overview.data?.datasets.find((item) => item.key === dataset) ?? null
  const detailDataset =
    overview.data?.datasets.find((item) => item.key === detailKey) ?? null

  /** 上传报表的 file input：由按钮 click() 触发，保证键盘可达且 disabled 真正生效。 */
  const fileInputRef = useRef<HTMLInputElement>(null)

  const onUpload = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setLastResult(null)
    upload.mutate(
      { dataset, mode, file },
      {
        onSuccess: (result) => {
          setLastResult(result)
          setLastImportedKey(dataset)
          if (result.ok) {
            toast.success(
              `导入成功：写入 ${result.inserted} 行${result.failedRows > 0 ? `，跳过 ${result.failedRows} 行` : ''}`
            )
          } else {
            toast.error('导入被拒绝，已整批回退，详见下方失败原因')
          }
        },
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : '导入失败，请稍后重试'
          ),
      }
    )
  }

  /** 模板下载需要带 JWT，直接 fetch 取回后落盘（浏览器原生下载不带 Authorization 头）。 */
  const downloadTemplate = async () => {
    try {
      const response = await rawRequest(
        `/ai/imports/template?dataset=${encodeURIComponent(dataset)}`
      )
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${activeSpec?.label ?? dataset}-导入模板.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '模板下载失败')
    }
  }

  return (
    <PageShell>
      {' '}
      {/*
        工具栏分两组（2026-09-15 简化）：左边是"当前对哪个数据集、按什么模式导入"的选择，
        右边是针对它的动作。原先五个控件挤成一条，看不出哪个属于哪一步，
        而"覆盖同周期数据"是破坏性模式，必须紧贴它作用的数据集。
      */}
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <Select
            value={dataset}
            onValueChange={(value) => {
              setDataset(value)
              setPage(1)
            }}
          >
            <SelectTrigger aria-label='选择数据集' className='w-64'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(overview.data?.datasets ?? []).map((item) => (
                <SelectItem key={item.key} value={item.key}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={mode}
            onValueChange={(value) => setMode(value as 'overwrite' | 'append')}
          >
            <SelectTrigger aria-label='选择导入模式' className='w-48'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='overwrite'>覆盖同周期数据</SelectItem>
              <SelectItem value='append'>追加（跳过重复行）</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            className='gap-2'
            variant='outline'
            onClick={() => void downloadTemplate()}
          >
            <Download />
            下载模板
          </Button>
          <Button
            type='button'
            className='gap-2'
            disabled={upload.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload aria-hidden='true' />
            {upload.isPending ? '导入中…' : '上传报表'}
          </Button>
          {/*
            用 ref 触发上传：原来 `Button asChild` 渲染成 <label>，而 disabled 会落到 label 上——
            label 不匹配 :disabled 伪类，所以"导入中"时按钮仍然可点、还能并发重复导入；
            同时 label 不可聚焦，键盘用户根本无法上传。
          */}
          <input
            ref={fileInputRef}
            accept='.csv'
            className='sr-only'
            type='file'
            aria-label='上传报表文件'
            onChange={(event) => {
              onUpload(event.target.files)
              event.target.value = ''
            }}
          />
          <Button
            aria-label='刷新数据集状态'
            disabled={overview.isFetching}
            size='icon'
            variant='outline'
            onClick={() => overview.refetch()}
          >
            <RefreshCw
              className={overview.isFetching ? 'animate-spin' : undefined}
            />
          </Button>
        </div>
      </div>
      {/*
        导入规则默认折叠：四条规则（口径 / 列校验 / 编码）是"第一次导入才读一遍"的内容，
        常显时占掉 60px 并夹在操作区与数据集卡片之间，把真正的状态信息推下去。
        折叠行保留最关键的一条口径说明，不打开也知道数据是怎么进来的。
      */}
      <Collapsible open={rulesOpen} onOpenChange={setRulesOpen}>
        <div className='flex flex-wrap items-center gap-2'>
          <CollapsibleTrigger asChild>
            <Button
              className='gap-1.5 px-2 text-xs text-muted-foreground'
              size='sm'
              variant='ghost'
            >
              <ChevronDown
                className={cn(
                  'size-3.5 transition-transform',
                  rulesOpen && 'rotate-180'
                )}
              />
              导入规则
            </Button>
          </CollapsibleTrigger>
          <span className='text-xs text-muted-foreground'>
            人工导出报表后导入 · 数据为准实时，回答里会强制声明「数据截至」
          </span>
        </div>
        <CollapsibleContent className='pt-2'>
          <p className='rounded-lg border border-dashed p-3 text-xs text-muted-foreground'>
            列名需与模板一致，缺失必填列会整批拒绝（不做部分导入）。当前支持
            CSV（UTF-8 / GBK 自动识别），<code>.xlsx</code> 需先另存为 CSV。
          </p>
        </CollapsibleContent>
      </Collapsible>
      {lastResult && (
        <ImportResultCard
          result={lastResult}
          onViewRows={
            lastImportedKey ? () => setDetailKey(lastImportedKey) : null
          }
        />
      )}
      {overview.isLoading && <Skeleton className='h-40 w-full' />}
      {overview.isError && (
        <p className='text-sm text-destructive'>
          数据集状态加载失败，请稍后重试。
        </p>
      )}
      {overview.data && (
        <div className='grid gap-3 lg:grid-cols-2'>
          {overview.data.datasets.map((item) => (
            <DatasetCard
              key={item.key}
              dataset={item}
              onOpen={() => setDetailKey(item.key)}
            />
          ))}
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>导入记录</CardTitle>
          <CardDescription>
            每次导入（含失败）都会留痕：文件、模式、覆盖周期、行数、失败原因。导入动作同时写入审计。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={8}
            emptyText='该数据集还没有导入记录。'
            header={
              <TableRow>
                <TableHead className='w-40'>导入时间</TableHead>
                <TableHead>文件</TableHead>
                <TableHead className='w-32'>模式</TableHead>
                <TableHead className='w-40'>覆盖周期</TableHead>
                <TableHead className={cn('w-20', TABLE_HEAD_NUMERIC)}>
                  行数
                </TableHead>
                <TableHead className='w-24'>状态</TableHead>
                <TableHead className='w-24'>导入人</TableHead>
                <TableHead>失败原因</TableHead>
              </TableRow>
            }
            isEmpty={(history.data?.imports ?? []).length === 0}
            isError={history.isError}
            isLoading={history.isLoading}
            pagination={{
              disabled: history.isFetching,
              page: history.data?.page ?? 1,
              pageSize: history.data?.pageSize ?? pageSize,
              total: history.data?.total ?? 0,
              onPageChange: setPage,
              onPageSizeChange: (size) => {
                setPageSize(size)
                setPage(1)
              },
            }}
          >
            {(history.data?.imports ?? []).map((item) => (
              <TableRow key={item.id}>
                <TableCell className={TABLE_CELL_META}>
                  {formatTime(item.importedAt)}
                </TableCell>
                <TableCell className='max-w-56 truncate text-xs'>
                  {item.fileName}
                </TableCell>
                <TableCell className='text-xs'>
                  {MODE_LABELS[item.mode] ?? item.mode}
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {item.periodStart
                    ? `${formatDate(item.periodStart)} ~ ${formatDate(item.periodEnd)}`
                    : '—'}
                </TableCell>
                <TableCell className={TABLE_CELL_NUMERIC}>
                  {item.rowCount}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={item.status === 'ok' ? 'secondary' : 'destructive'}
                  >
                    {item.status === 'ok' ? '成功' : '失败'}
                  </Badge>
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {item.importedByName ?? '—'}
                </TableCell>
                {/* 失败原因保留换行（break-words）：它是"为什么没导进来"的完整解释，
                    截断会让管理员看不到真正需要修的那一句。 */}
                <TableCell className='max-w-72 text-xs break-words text-muted-foreground'>
                  {item.failReason ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        </CardContent>
      </Card>
      {/*
        弹窗按数据集 key 重挂载：切换数据集时页码与关键词必须是干净的初始值，
        否则会在新数据集上带着上一个数据集的筛选条件（表现为"一打开就是空表"）。
      */}
      <DatasetRowsDialog
        key={detailDataset?.key ?? 'none'}
        dataset={detailDataset}
        onOpenChange={(open) => {
          if (!open) setDetailKey(null)
        }}
      />
    </PageShell>
  )
}

/**
 * 数据集卡片：整卡可点开查看数据详情。
 *
 * 为什么不用原生 `button` 包卡片：卡片内含标题、说明、徽章等块级内容，
 * 放进 button 会破坏标题层级与文本选择；因此用 `role="button"` + 显式键盘处理补齐可访问性。
 */
function DatasetCard({
  dataset,
  onOpen,
}: {
  dataset: DatasetOverviewItem
  onOpen: () => void
}) {
  return (
    <Card
      aria-label={`查看${dataset.label}数据详情`}
      className='cursor-pointer gap-3 transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
      role='button'
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <CardHeader className='pb-0'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Database className='size-4 text-muted-foreground' />
          {dataset.label}
          {dataset.rows === 0 && (
            <Badge className='font-normal' variant='destructive'>
              暂无数据
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{dataset.description}</CardDescription>
        <CardAction>
          <span className='inline-flex items-center gap-1 text-xs text-muted-foreground'>
            查看数据
            <ChevronRight aria-hidden='true' className='size-3.5' />
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className='space-y-2 text-sm'>
        <div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground'>
          <span className='inline-flex items-center gap-1'>
            <FileSpreadsheet className='size-3.5' />
            {dataset.rows} 行
          </span>
          <span className='inline-flex items-center gap-1'>
            <CalendarClock className='size-3.5' />
            数据截至 {formatDate(dataset.importedAt)}
          </span>
          {dataset.periodStart && dataset.periodEnd && (
            <span>
              覆盖周期 {formatDate(dataset.periodStart)} ~{' '}
              {formatDate(dataset.periodEnd)}
            </span>
          )}
        </div>
        {dataset.lastImportStatus === 'failed' && dataset.lastImportError && (
          <p className='flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive'>
            <AlertTriangle className='mt-0.5 size-3.5 shrink-0' />
            最近一次导入失败：{dataset.lastImportError}
          </p>
        )}
        {/*
          字段清单从"徽章墙"改为一行文本：字段是参考信息，而徽章每个都带边框与内边距，
          在卡片里的视觉权重比"数据截至"等真正要看的状态还高，也让卡片高度翻倍。
          完整清单仍在 title 里，悬停即可看全。
        */}
        <p
          className='truncate text-xs text-muted-foreground'
          title={`字段 ${dataset.columns.length} 个（* 为必填）：${dataset.columns
            .map((column) => `${column.label}${column.required ? ' *' : ''}`)
            .join(' · ')}`}
        >
          字段 {dataset.columns.length} 个（* 为必填）：
          {dataset.columns
            .map((column) => `${column.label}${column.required ? ' *' : ''}`)
            .join(' · ')}
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * 导入结果卡片：成功给出写入与周期；失败给出原因与失败行明细。
 *
 * `onViewRows` 是"导入完立刻核对"的入口：没有它，管理员导完只能靠行数猜有没有写对。
 */
function ImportResultCard({
  result,
  onViewRows,
}: {
  result: DatasetImportResult
  onViewRows: (() => void) | null
}) {
  return (
    <Card className={result.ok ? 'border-primary/40' : 'border-destructive/40'}>
      <CardHeader className='pb-2'>
        <CardTitle className='text-base'>
          {result.ok ? '导入完成' : '导入被拒绝（整批回退）'}
        </CardTitle>
        <CardDescription>
          {result.ok
            ? `写入 ${result.inserted} 行；跳过重复 ${result.skipped} 行；文件编码 ${result.encoding ?? 'utf8'}`
            : result.error}
        </CardDescription>
        {result.ok && onViewRows && (
          <CardAction>
            <Button
              className='gap-2'
              size='sm'
              variant='outline'
              onClick={onViewRows}
            >
              <Database aria-hidden='true' />
              查看导入的数据
            </Button>
          </CardAction>
        )}
      </CardHeader>
      {!result.ok && result.rowErrors.length > 0 && (
        <CardContent className='space-y-2'>
          <Label className='text-xs text-muted-foreground'>
            失败行明细（最多显示前 20 行）
          </Label>
          <ul className='space-y-1 text-xs'>
            {result.rowErrors.map((error) => (
              <li
                className='rounded bg-muted/40 px-2 py-1'
                key={`${error.line}-${error.column}`}
              >
                第 {error.line} 行 · {error.column}：{error.reason}
              </li>
            ))}
          </ul>
        </CardContent>
      )}
      {result.ok && result.ignoredColumns.length > 0 && (
        <CardContent>
          <p className='text-xs text-muted-foreground'>
            已忽略的列（不影响导入，但不会入库）：
            {result.ignoredColumns.join('、')}
          </p>
        </CardContent>
      )}
    </Card>
  )
}

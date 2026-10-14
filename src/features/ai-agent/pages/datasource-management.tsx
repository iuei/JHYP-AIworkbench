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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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

/**
 * 页内两个子视图：**一次只渲染一个**（与「经验审核」「审计台」同一骨架）。
 *
 * 改前「导入记录」表纵向叠在数据集列表下方：记录表有 8 列且自带分页器，
 * 数据集一多就要先滚过整张表才能看到它，两个职责的入口形态也不一致。
 * 现在同一排选项卡切换，默认落在「数据源状态」—— 进页面先看"数据到没到"，
 * 与改前的渲染顺序（数据集列表在导入记录之前）一致，不改变既有进入习惯。
 */
type DatasourceTab = 'status' | 'records'

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
  /** 当前子视图（受控）：默认「数据源状态」。 */
  const [tab, setTab] = useState<DatasourceTab>('status')

  const overview = useDatasets()
  const history = useImportHistory({ dataset, page, pageSize })
  const upload = useImportDataset()

  const datasets = overview.data?.datasets ?? []
  /**
   * 有数据集"最近一次导入失败"时在选项卡上警示。
   *
   * 失败原因住在「数据源状态」子视图的行内提示里，切到「导入记录」后整行都看不见了；
   * 而失败意味着这批数据根本没进来，是会直接影响问答取数的状态，不能藏起来。
   * 判据直接读取 `overview` 已有的数据，**不为此新增请求**。
   */
  const hasFailedImport = datasets.some(
    (item) => item.lastImportStatus === 'failed'
  )
  /** 导入记录条数：`total` 由已有查询返回，同样不新增请求。 */
  const importTotal = history.data?.total ?? 0

  const activeSpec = datasets.find((item) => item.key === dataset) ?? null
  const detailDataset = datasets.find((item) => item.key === detailKey) ?? null

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
      {/*
        工具栏分两组（2026-09-15 简化）：左边是"当前对哪个数据集、按什么模式导入"的选择，
        右边是针对它的动作。原先五个控件挤成一条，看不出哪个属于哪一步，
        而"覆盖同周期数据"是破坏性模式，必须紧贴它作用的数据集。

        2026-10-14：工具栏**常驻在选项卡上方**（与「经验审核」「审计台」同一骨架）。
        "选哪个数据集"是整页的全局上下文 —— 导入记录表也跟随它，
        放进任一子视图里都会变成"切到另一个视图就看不到自己在操作哪个数据集"。
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
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as DatasourceTab)}
      >
        <TabsList>
          <TabsTrigger className='gap-1.5' value='status'>
            数据源状态
            {/* 失败数据集在选项卡上警示：失败原因住在子视图的行内提示里，切走就看不见了 */}
            {hasFailedImport && (
              <Badge className='font-normal' variant='destructive'>
                导入异常
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger className='gap-1.5' value='records'>
            导入记录
            {/* 记录条数常显：切到「数据源状态」后，"导过几次"同样不该消失 */}
            {importTotal > 0 && (
              <Badge className='font-normal' variant='secondary'>
                {importTotal}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent className='space-y-3' value='status'>
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
          {/*
            数据集状态改为紧凑行式列表（原为 2 列大卡片网格）：5 张卡片连同各自的说明、
            字段清单把首屏占满，「导入记录」被推到页底。行式列表把同一批字段横向对齐，
            一屏即可扫完所有数据集，把页面重心还给高频的导入操作与导入记录。
          */}
          <section className='space-y-2'>
            <div className='flex flex-wrap items-baseline justify-between gap-2'>
              <h2 className='text-sm font-semibold'>数据集状态</h2>
              <span className='text-xs text-muted-foreground'>
                点击任意一行可查看该数据集的行数据
              </span>
            </div>
            {overview.isLoading && <Skeleton className='h-32 w-full' />}
            {overview.isError && (
              <p className='text-sm text-destructive'>
                数据集状态加载失败，请稍后重试。
              </p>
            )}
            {overview.data && datasets.length === 0 && (
              <p className='rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground'>
                暂无数据集。
              </p>
            )}
            {datasets.length > 0 && (
              <div className='divide-y rounded-md border'>
                {datasets.map((item) => (
                  <DatasetRow
                    key={item.key}
                    dataset={item}
                    onOpen={() => setDetailKey(item.key)}
                  />
                ))}
              </div>
            )}
          </section>
        </TabsContent>

        <TabsContent value='records'>
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
                  total: importTotal,
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
                        variant={
                          item.status === 'ok' ? 'secondary' : 'destructive'
                        }
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
        </TabsContent>
      </Tabs>
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
 * 数据集行：一行一个数据集，横向读「行数 → 数据截至 → 覆盖周期 → 字段数 → 查看数据」。
 *
 * 为什么仍用 `role="button"` 而不是原生 button：行内要容纳徽章与多段说明，
 * 塞进 button 会破坏文本选择与语义；因此显式补齐 `tabIndex` 与 Enter/Space 键盘处理。
 */
function DatasetRow({
  dataset,
  onOpen,
}: {
  dataset: DatasetOverviewItem
  onOpen: () => void
}) {
  const requiredCount = dataset.columns.filter(
    (column) => column.required
  ).length
  const columnList = dataset.columns
    .map((column) => `${column.label}${column.required ? ' *' : ''}`)
    .join(' · ')

  return (
    <div
      aria-label={`查看${dataset.label}数据详情`}
      className='cursor-pointer px-3 py-2.5 transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset'
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
      <div className='flex flex-wrap items-center gap-x-4 gap-y-1'>
        <span className='flex min-w-40 flex-1 items-center gap-2 text-sm font-medium'>
          <Database
            aria-hidden='true'
            className='size-4 shrink-0 text-muted-foreground'
          />
          {/* 说明不再常显占行（它是"这个数据集是什么"的一次性信息），悬停名称即可读到。 */}
          <span className='truncate' title={dataset.description}>
            {dataset.label}
          </span>
          {dataset.rows === 0 && (
            <Badge className='font-normal' variant='destructive'>
              暂无数据
            </Badge>
          )}
        </span>
        <span className='inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums'>
          <FileSpreadsheet aria-hidden='true' className='size-3.5' />
          {dataset.rows} 行
        </span>
        <span className='inline-flex items-center gap-1 text-xs text-muted-foreground'>
          <CalendarClock aria-hidden='true' className='size-3.5' />
          数据截至 {formatDate(dataset.importedAt)}
        </span>
        {dataset.periodStart && dataset.periodEnd && (
          <span className='text-xs text-muted-foreground'>
            覆盖周期 {formatDate(dataset.periodStart)} ~{' '}
            {formatDate(dataset.periodEnd)}
          </span>
        )}
        {/*
          字段清单只在"导入失败要核对列名"时才需要，常显全量列名是纯噪音：
          行内只留计数，完整清单进 title 悬停查看。
        */}
        <span
          className='text-xs text-muted-foreground'
          title={`字段 ${dataset.columns.length} 个（必填 ${requiredCount}）：${columnList}`}
        >
          字段 {dataset.columns.length} 个（必填 {requiredCount}）
        </span>
        <span className='inline-flex items-center gap-1 text-xs text-muted-foreground'>
          查看数据
          <ChevronRight aria-hidden='true' className='size-3.5' />
        </span>
      </div>
      {/*
        失败提示行内化：原文案带边框与底色，在一行里会撑成大块并与行高不匹配；
        压缩成一行红字，仍然保留完整的失败原因。
      */}
      {dataset.lastImportStatus === 'failed' && dataset.lastImportError && (
        <p className='mt-1 flex items-start gap-1.5 text-xs text-destructive'>
          <AlertTriangle
            aria-hidden='true'
            className='mt-0.5 size-3.5 shrink-0'
          />
          最近一次导入失败：{dataset.lastImportError}
        </p>
      )}
    </div>
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

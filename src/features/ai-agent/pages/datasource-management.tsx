import { useState } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  Database,
  Download,
  FileSpreadsheet,
  RefreshCw,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useDatasets, useImportDataset, useImportHistory } from '../api/queries'
import { PageShell } from '../components/page-shell'
import { formatDate, formatTime } from '../format'
import type { DatasetImportResult } from '../types'

const MODE_LABELS: Record<string, string> = {
  overwrite: '覆盖同周期数据',
  append: '追加（跳过重复行）',
}

export function DatasourceManagement() {
  const [dataset, setDataset] = useState('amazon_ads_daily')
  const [mode, setMode] = useState<'overwrite' | 'append'>('overwrite')
  const [lastResult, setLastResult] = useState<DatasetImportResult | null>(null)

  const overview = useDatasets()
  const history = useImportHistory(dataset)
  const upload = useImportDataset()

  const activeSpec =
    overview.data?.datasets.find((item) => item.key === dataset) ?? null

  const onUpload = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setLastResult(null)
    upload.mutate(
      { dataset, mode, file },
      {
        onSuccess: (result) => {
          setLastResult(result)
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
      const accessToken = useAuthStore.getState().auth.accessToken
      const baseUrl =
        import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787/api'
      const response = await fetch(
        `${baseUrl}/ai/imports/template?dataset=${encodeURIComponent(dataset)}`,
        {
          headers: accessToken
            ? { authorization: `Bearer ${accessToken}` }
            : {},
        }
      )
      if (!response.ok) throw new Error('模板下载失败，请稍后重试')
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
    <PageShell
    >
      {' '}
      <div className='flex flex-wrap items-center gap-2'>
        <Select value={dataset} onValueChange={setDataset}>
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
        <Button
          className='gap-2'
          variant='outline'
          onClick={() => void downloadTemplate()}
        >
          <Download />
          下载模板
        </Button>
        <Button asChild className='gap-2' disabled={upload.isPending}>
          <label>
            <Upload />
            {upload.isPending ? '导入中…' : '上传报表'}
            <input
              accept='.csv'
              className='hidden'
              type='file'
              onChange={(event) => {
                onUpload(event.target.files)
                event.target.value = ''
              }}
            />
          </label>
        </Button>
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
      <p className='rounded-lg border border-dashed p-3 text-xs text-muted-foreground'>
        一期通过
        <strong className='font-medium text-foreground'>
          人工导出报表后导入
        </strong>
        的方式接入业务数据：
        数据为准实时，回答里会强制声明「数据截至」时间。列名需与模板一致，缺失必填列会整批拒绝（不做部分导入）。
        当前支持 CSV（UTF-8 / GBK 自动识别），<code>.xlsx</code> 需先另存为
        CSV。
      </p>
      {lastResult && <ImportResultCard result={lastResult} />}
      {overview.isLoading && <Skeleton className='h-40 w-full' />}
      {overview.isError && (
        <p className='text-sm text-destructive'>
          数据集状态加载失败，请稍后重试。
        </p>
      )}
      {overview.data && (
        <div className='grid gap-3 lg:grid-cols-2'>
          {overview.data.datasets.map((item) => (
            <Card key={item.key}>
              <CardHeader className='pb-3'>
                <CardTitle className='flex items-center gap-2 text-base'>
                  <Database className='size-4 text-muted-foreground' />
                  {item.label}
                  {item.rows === 0 && (
                    <Badge className='font-normal' variant='destructive'>
                      暂无数据
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent className='space-y-2 text-sm'>
                <div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground'>
                  <span className='inline-flex items-center gap-1'>
                    <FileSpreadsheet className='size-3.5' />
                    {item.rows} 行
                  </span>
                  <span className='inline-flex items-center gap-1'>
                    <CalendarClock className='size-3.5' />
                    数据截至 {formatDate(item.importedAt)}
                  </span>
                  {item.periodStart && item.periodEnd && (
                    <span>
                      覆盖周期 {formatDate(item.periodStart)} ~{' '}
                      {formatDate(item.periodEnd)}
                    </span>
                  )}
                </div>
                {item.lastImportStatus === 'failed' && item.lastImportError && (
                  <p className='flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive'>
                    <AlertTriangle className='mt-0.5 size-3.5 shrink-0' />
                    最近一次导入失败：{item.lastImportError}
                  </p>
                )}
                <div className='flex flex-wrap gap-1 pt-1'>
                  {item.columns.map((column) => (
                    <Badge
                      className='font-normal'
                      key={column.key}
                      variant={column.required ? 'secondary' : 'outline'}
                    >
                      {column.label}
                      {column.required ? ' *' : ''}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
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
          {history.isLoading && <Skeleton className='h-32 w-full' />}
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-40'>导入时间</TableHead>
                  <TableHead>文件</TableHead>
                  <TableHead className='w-32'>模式</TableHead>
                  <TableHead className='w-40'>覆盖周期</TableHead>
                  <TableHead className='w-20 text-right'>行数</TableHead>
                  <TableHead className='w-24'>状态</TableHead>
                  <TableHead className='w-24'>导入人</TableHead>
                  <TableHead>失败原因</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(history.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell className='text-muted-foreground' colSpan={8}>
                      该数据集还没有导入记录。
                    </TableCell>
                  </TableRow>
                )}
                {(history.data ?? []).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className='text-xs'>
                      {formatTime(item.importedAt)}
                    </TableCell>
                    <TableCell className='max-w-56 truncate text-xs'>
                      {item.fileName}
                    </TableCell>
                    <TableCell className='text-xs'>
                      {MODE_LABELS[item.mode] ?? item.mode}
                    </TableCell>
                    <TableCell className='text-xs text-muted-foreground'>
                      {item.periodStart
                        ? `${formatDate(item.periodStart)} ~ ${formatDate(item.periodEnd)}`
                        : '—'}
                    </TableCell>
                    <TableCell className='text-right text-xs tabular-nums'>
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
                    <TableCell className='text-xs'>
                      {item.importedByName ?? '—'}
                    </TableCell>
                    <TableCell className='max-w-72 text-xs break-words text-muted-foreground'>
                      {item.failReason ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  )
}

/** 导入结果卡片：成功给出写入与周期；失败给出原因与失败行明细。 */
function ImportResultCard({ result }: { result: DatasetImportResult }) {
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

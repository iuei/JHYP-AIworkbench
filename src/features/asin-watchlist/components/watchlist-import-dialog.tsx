import { useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  TABLE_CELL_META,
  TABLE_CELL_MONO,
  TABLE_EMPTY_VALUE,
} from '@/lib/table-styles'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TableCell, TableHead, TableRow } from '@/components/ui/table'
import { DataTable } from '@/components/data-table'
import { MARKETPLACE_OPTIONS, errorMessage } from '../format'
import { useImportMyAsinTable, useMyAsinTemplate } from '../hooks'
import type {
  MyAsinTableImportResult,
  MyAsinTableImportSummary,
} from '../types'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * 从表格文件批量导入 ASIN（CSV / XLSX）。
 *
 * 为什么是"先预览、再确认"两步：用户的表里往往混着别列，甚至第一列不是 ASIN。
 * 直接导入会让人先落库再看结果，多出来的脏条目得手工删；预览把
 * **识别到哪一列、会新增多少、哪些行读不出来** 摆在确认之前，
 * 代价只是多一次请求（文件由前端持有，服务端不需要临时状态）。
 *
 * 模板（`下载模板`）的作用是**格式统一**：表头固定为 ASIN / 站点 / 别名 / 备注，
 * 用户照模板填出来的表格一定能被解析 —— 这是"批量导入"里唯一不需要试错的路径。
 * 站点列缺失或留空时，按上面选的「默认站点」落库。
 */
export function WatchlistImportDialog({ open, onOpenChange }: Props) {
  const importTable = useImportMyAsinTable()
  const template = useMyAsinTemplate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [defaultMarketplace, setDefaultMarketplace] = useState('US')
  const [preview, setPreview] = useState<MyAsinTableImportSummary | null>(null)
  const [result, setResult] = useState<MyAsinTableImportResult | null>(null)

  const reset = () => {
    setFile(null)
    setPreview(null)
    setResult(null)
  }

  const handleOpenChange = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const requestPreview = (target: File, site: string) => {
    importTable.mutate(
      { file: target, dryRun: true, defaultMarketplace: site },
      {
        onSuccess: (data) => setPreview(data.summary),
        onError: (error) => {
          // 预览失败就把文件清掉：留在界面上会让人以为"再点一次确认就能过"
          setFile(null)
          setPreview(null)
          toast.error(errorMessage(error, '表格解析失败，请检查文件后重试。'))
        },
      }
    )
  }

  const pickFile = (files: FileList | null) => {
    const picked = files?.[0]
    if (!picked) return
    setResult(null)
    setPreview(null)
    setFile(picked)
    requestPreview(picked, defaultMarketplace)
  }

  /** 改默认站点后重新预览：预览里的站点与"会新增多少"都会跟着变，必须让用户看到新的那份。 */
  const changeDefaultMarketplace = (site: string) => {
    setDefaultMarketplace(site)
    if (file) requestPreview(file, site)
  }

  const confirmImport = () => {
    if (!file) return
    importTable.mutate(
      { file, dryRun: false, defaultMarketplace },
      {
        onSuccess: (data) => {
          setResult(data)
          toast.success(`已导入 ${data.added.length} 条`)
        },
        onError: (error) =>
          toast.error(errorMessage(error, '导入失败，请稍后重试。')),
      }
    )
  }

  const downloadTemplate = () => {
    template.mutate(undefined, {
      onSuccess: (blob) => {
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = '我的 ASIN 导入模板.xlsx'
        anchor.click()
        URL.revokeObjectURL(url)
      },
      onError: (error) => toast.error(errorMessage(error, '模板下载失败')),
    })
  }

  const mappingText = (summary: MyAsinTableImportSummary) => {
    const parts: string[] = []
    const label = (index: number | null) =>
      index === null
        ? '未识别'
        : summary.columns[index]
          ? `第 ${index + 1} 列「${summary.columns[index]}」`
          : `第 ${index + 1} 列`
    parts.push(`ASIN → ${label(summary.mapping.asin)}`)
    parts.push(`站点 → ${label(summary.mapping.marketplace)}`)
    parts.push(`别名 → ${label(summary.mapping.alias)}`)
    parts.push(`备注 → ${label(summary.mapping.note)}`)
    return parts.join(' · ')
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>从表格导入 ASIN</DialogTitle>
          <DialogDescription>
            支持 CSV 与 Excel（.xlsx）：自动识别 ASIN / 站点 / 别名 / 备注列。
            建议先下载模板，按模板表头填好再上传 —— 格式统一，解析最稳。老的 .xls
            请先另存为 .xlsx。
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className='space-y-3'>
            <div className='flex items-start gap-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm'>
              <CheckCircle2 className='mt-0.5 size-4 shrink-0 text-primary' />
              <div>
                <p>
                  已导入 <strong>{result.added.length}</strong> 条，列表现有{' '}
                  <strong>
                    {result.itemCount ?? result.summary.itemCount}
                  </strong>{' '}
                  条。
                </p>
                {result.summary.duplicated.length > 0 && (
                  <p className='text-muted-foreground'>
                    列表里已有 {result.summary.duplicated.length} 条（同一 ASIN +
                    站点），未重复写入。
                  </p>
                )}
                {result.summary.repeated.length > 0 && (
                  <p className='text-muted-foreground'>
                    表格内重复 {result.summary.repeated.length} 行，已自动合并。
                  </p>
                )}
              </div>
            </div>
            <InvalidRows rows={result.summary.invalid} />
          </div>
        ) : preview ? (
          <div className='space-y-3'>
            <div className='rounded-md border p-3 text-sm'>
              <div className='flex flex-wrap items-center gap-2'>
                <Badge className='font-normal' variant='secondary'>
                  {preview.format === 'xlsx' ? 'Excel' : 'CSV'}
                  {preview.encoding && preview.encoding !== 'utf8'
                    ? ` · ${preview.encoding}`
                    : ''}
                </Badge>
                <span className='text-muted-foreground'>
                  识别到 {preview.entries} 条
                </span>
                <span className='text-muted-foreground'>
                  · 列表已有 {preview.duplicated.length} 条
                </span>
                <span className='text-muted-foreground'>
                  · 表内重复 {preview.repeated.length} 条
                </span>
                {preview.invalid.length > 0 && (
                  <span className='text-destructive'>
                    · 无法识别 {preview.invalid.length} 行
                  </span>
                )}
              </div>
              <p className='mt-2 text-xs text-muted-foreground'>
                列识别：{mappingText(preview)}
                {preview.headerRow
                  ? '（第 1 行按表头处理）'
                  : '（未识别到表头，第一列按 ASIN 处理）'}
              </p>
            </div>

            <div className='flex flex-wrap items-center gap-2 rounded-md border p-3'>
              <span className='text-xs text-muted-foreground'>
                表格里没写站点的行按此站点落库：
              </span>
              <Select
                value={defaultMarketplace}
                onValueChange={changeDefaultMarketplace}
              >
                <SelectTrigger
                  aria-label='默认站点'
                  className='h-8 w-40'
                  size='sm'
                >
                  <SelectValue placeholder='选择站点' />
                </SelectTrigger>
                <SelectContent>
                  {MARKETPLACE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {preview.overflow && (
              <p className='flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'>
                <AlertTriangle className='mt-0.5 size-4 shrink-0' />
                导入后会有 {preview.itemCount + preview.addCount} 条 ASIN，超出上限{' '}
                {preview.capacity} 条（多出 {preview.overflowBy} 条）。请先精简表格，
                或删掉一些不再跟踪的 ASIN。
              </p>
            )}

            {/*
              预览表常驻：没有新增行时由 DataTable 的空态说明"这次不会新增什么"，
              比整块消失更好 —— 表格全是重复项时用户正需要这句话。
            */}
            <div className='space-y-1'>
              <p className='text-xs text-muted-foreground'>
                将要新增（最多显示 5 条）
              </p>
              <DataTable
                columns={4}
                emptyText='没有可预览的新增行。'
                isEmpty={preview.willAdd.length === 0}
                header={
                  <TableRow>
                    <TableHead>ASIN</TableHead>
                    <TableHead className='w-16'>站点</TableHead>
                    <TableHead>别名</TableHead>
                    <TableHead>备注</TableHead>
                  </TableRow>
                }
              >
                {preview.willAdd.map((row) => (
                  <TableRow key={`${row.asin}-${row.marketplace}`}>
                    <TableCell className={TABLE_CELL_MONO}>
                      {row.asin}
                    </TableCell>
                    <TableCell className={TABLE_CELL_META}>
                      {row.marketplace}
                    </TableCell>
                    <TableCell className={TABLE_CELL_META}>
                      {row.alias ?? TABLE_EMPTY_VALUE}
                    </TableCell>
                    <TableCell className={TABLE_CELL_META}>
                      {row.note ?? TABLE_EMPTY_VALUE}
                    </TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </div>

            <InvalidRows rows={preview.invalid} />
          </div>
        ) : (
          <div className='space-y-3'>
            <div className='rounded-md border border-dashed p-6 text-center'>
              <FileSpreadsheet className='mx-auto size-6 text-muted-foreground' />
              <p className='mt-2 text-sm text-muted-foreground'>
                选择要导入的表格文件（.csv 或 .xlsx）
              </p>
              {file && (
                <p className='mt-1 text-xs text-muted-foreground'>
                  {file.name} · {(file.size / 1024).toFixed(0)} KB
                </p>
              )}
              <Button
                className='mt-3 gap-2'
                disabled={importTable.isPending}
                type='button'
                variant='outline'
                onClick={() => fileInputRef.current?.click()}
              >
                {importTable.isPending ? (
                  <Loader2 className='animate-spin' aria-hidden='true' />
                ) : (
                  <Upload aria-hidden='true' />
                )}
                {importTable.isPending ? '正在解析…' : '选择文件'}
              </Button>
              {/* 用按钮 click() 触发隐藏 input：label 不可聚焦，键盘用户点不到 */}
              <input
                ref={fileInputRef}
                accept='.csv,.txt,.xlsx'
                aria-label='选择 ASIN 表格文件'
                className='sr-only'
                type='file'
                onChange={(event) => {
                  pickFile(event.target.files)
                  event.target.value = ''
                }}
              />
            </div>

            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='text-xs text-muted-foreground'>
                  表格里没写站点的行按此站点落库：
                </span>
                <Select
                  value={defaultMarketplace}
                  onValueChange={setDefaultMarketplace}
                >
                  <SelectTrigger
                    aria-label='默认站点'
                    className='h-8 w-36'
                    size='sm'
                  >
                    <SelectValue placeholder='选择站点' />
                  </SelectTrigger>
                  <SelectContent>
                    {MARKETPLACE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                className='gap-2'
                disabled={template.isPending}
                size='sm'
                type='button'
                variant='ghost'
                onClick={downloadTemplate}
              >
                <Download aria-hidden='true' />
                下载模板
              </Button>
            </div>
            <p className='text-xs text-muted-foreground'>
              模板表头为 ASIN / 站点 / 别名 / 备注；站点留空时按上面选中的默认站点落库。
            </p>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button type='button' onClick={() => handleOpenChange(false)}>
              完成
            </Button>
          ) : (
            <>
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  reset()
                  onOpenChange(false)
                }}
              >
                取消
              </Button>
              {preview && (
                <Button
                  disabled={importTable.isPending || preview.overflow}
                  type='button'
                  onClick={confirmImport}
                >
                  {importTable.isPending && (
                    <Loader2 className='animate-spin' aria-hidden='true' />
                  )}
                  确认导入 {preview.addCount} 条
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 无法识别的行：给行号 + 原值，用户可以直接回表里改（不猜、不静默丢弃）。 */
function InvalidRows({
  rows,
}: {
  rows: Array<{ line: number; value: string }>
}) {
  if (rows.length === 0) return null
  return (
    <div className='rounded-md border border-destructive/40 p-3 text-xs'>
      <p className='font-medium text-destructive'>
        {rows.length} 行没有识别到 ASIN，这些行不会被导入
      </p>
      <ul className='mt-1 space-y-0.5 text-muted-foreground'>
        {rows.slice(0, 10).map((row) => (
          <li key={`${row.line}-${row.value}`}>
            第 {row.line} 行：{row.value || '（空）'}
          </li>
        ))}
      </ul>
      {rows.length > 10 && (
        <p className='mt-1 text-muted-foreground'>其余 {rows.length - 10} 行略。</p>
      )}
    </div>
  )
}

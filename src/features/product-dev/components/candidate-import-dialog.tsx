import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { AlertCircle, Download, Upload } from 'lucide-react'
import { toast } from 'sonner'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  downloadCandidateTemplate,
  importCandidateFile,
  importCandidateText,
} from '../api'
import type { ImportPreview, ImportResult } from '../types'

function apiErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? fallback
  }
  if (error instanceof Error && error.message) return error.message
  return fallback
}

/** 四分类统计的一行。数字为 0 时仍然显示 —— "本次没有重复"也是有信息量的结论。 */
function CountItem({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className='rounded-md border border-border px-3 py-2'>
      <p className='text-xs text-muted-foreground'>{label}</p>
      <p className='text-lg font-semibold tabular-nums'>{value}</p>
      {hint ? <p className='mt-0.5 text-xs text-muted-foreground'>{hint}</p> : null}
    </div>
  )
}

type CandidateImportDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  maxImportRows: number
  onImported: () => void
}

/**
 * 候选产品导入弹窗：**先预览后确认**。
 *
 * 预览这一步不是可选装饰：列识别（哪个表头对应哪个字段）无法保证一次猜对，
 * 而猜错的后果是把"评分"写进"目标售价"这类静默脏数据。因此预览里必须如实显示
 * "识别到了哪些列、会新增多少、哪些行读不出来（带行号与原因）"，
 * 用户确认后才真正写库。
 *
 * 文件与粘贴文本走同一个端点，区别只在请求体形态（见 `server/product-dev-routes.mjs`）。
 */
export function CandidateImportDialog({
  open,
  onOpenChange,
  maxImportRows,
  onImported,
}: CandidateImportDialogProps) {
  const [mode, setMode] = useState<'file' | 'text'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  function reset() {
    setFile(null)
    setText('')
    setPreview(null)
    setResult(null)
    setMode('file')
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset()
    onOpenChange(next)
  }

  const request = (dryRun: boolean) =>
    mode === 'file' && file
      ? importCandidateFile({ file, dryRun })
      : importCandidateText({ text, dryRun })

  const previewMutation = useMutation({
    mutationFn: () => request(true),
    onSuccess: (data) => {
      setPreview(data as ImportPreview)
      setResult(null)
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error, '预览失败，请检查文件或粘贴内容。'))
    },
  })

  const importMutation = useMutation({
    mutationFn: () => request(false),
    onSuccess: (data) => {
      const imported = data as ImportResult
      setResult(imported)
      setPreview(null)
      if (imported.added > 0) {
        toast.success(`已导入 ${imported.added} 条候选。`)
        onImported()
      } else {
        toast.info('本次没有新增候选（全部已在池里或无法识别）。')
      }
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error, '导入失败，本次未写入任何数据。'))
    },
  })

  const canPreview =
    !previewMutation.isPending && ((mode === 'file' && Boolean(file)) || (mode === 'text' && text.trim().length > 0))

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>导入候选产品</DialogTitle>
          <DialogDescription>
            支持 CSV / XLSX 文件，或直接从 Excel 复制一大片区域粘贴。单次最多 {maxImportRows} 行。
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <Tabs
            value={mode}
            onValueChange={(value) => {
              setMode(value as 'file' | 'text')
              setPreview(null)
            }}
          >
            <TabsList>
              <TabsTrigger value='file'>上传文件</TabsTrigger>
              <TabsTrigger value='text'>粘贴内容</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {!result && mode === 'file' && (
          <div className='space-y-2'>
            <Label htmlFor='candidate-import-file'>CSV 或 XLSX 文件</Label>
            <Input
              id='candidate-import-file'
              type='file'
              accept='.csv,.txt,.xlsx'
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null)
                setPreview(null)
              }}
            />
            <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
              <span>表头建议使用：产品名称 / ASIN / 类目 / 目标售价 / 站点 / 阶段 / 备注；其余列会作为附加维度保存。</span>
              <Button
                type='button'
                variant='link'
                size='sm'
                className='h-auto p-0'
                onClick={() =>
                  void downloadCandidateTemplate().catch(() =>
                    toast.error('模板下载失败，请稍后重试。')
                  )
                }
              >
                <Download aria-hidden='true' />
                下载模板
              </Button>
            </div>
          </div>
        )}

        {!result && mode === 'text' && (
          <div className='space-y-2'>
            <Label htmlFor='candidate-import-text'>粘贴内容</Label>
            <Textarea
              id='candidate-import-text'
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                setPreview(null)
              }}
              placeholder={'可以直接从 Excel 复制整片区域粘进来（含表头）\n也可以一行一个产品名称或 ASIN'}
              rows={8}
              spellCheck={false}
            />
          </div>
        )}

        {preview && (
          <div className='space-y-4'>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5'>
              <CountItem label='会新增' value={preview.counts.added} />
              <CountItem label='池里已有' value={preview.counts.duplicated} hint='跳过，不重复写入' />
              <CountItem label='本次重复' value={preview.counts.repeated} hint='同一份内容里重复出现' />
              <CountItem label='无法识别' value={preview.counts.invalid} hint='带行号，可在原表里核对' />
              <CountItem label='空行' value={preview.counts.emptyRows} />
            </div>

            <div className='rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground'>
              {preview.headerRecognized ? (
                <>
                  识别到表头：{preview.columns.filter(Boolean).join(' / ') || '（无）'}
                  {preview.extraColumns.length > 0
                    ? `；其中「${preview.extraColumns.join('、')}」会作为附加维度保存。`
                    : '；没有额外的附加维度列。'}
                </>
              ) : (
                <>
                  未识别到表头，因此
                  <span className='font-medium text-foreground'>只读取了第 1 列</span>
                  （是 ASIN 就当 ASIN，否则当产品名称），
                  其余列一律不导入 —— 猜错列会把无关数据写进价格等字段。如果第 1 列不是产品名称或 ASIN，
                  请补一行表头后重新粘贴。
                </>
              )}
            </div>

            {preview.preview.length > 0 && (
              <div className='space-y-2'>
                <p className='text-sm font-medium'>前 {preview.preview.length} 条样例</p>
                <div className='overflow-x-auto rounded-md border border-border'>
                  <table className='w-full text-xs'>
                    <thead className='bg-muted/50 text-muted-foreground'>
                      <tr>
                        <th className='px-2 py-1.5 text-left'>行号</th>
                        <th className='px-2 py-1.5 text-left'>产品名称</th>
                        <th className='px-2 py-1.5 text-left'>ASIN</th>
                        <th className='px-2 py-1.5 text-left'>类目</th>
                        <th className='px-2 py-1.5 text-left'>目标售价</th>
                        <th className='px-2 py-1.5 text-left'>站点</th>
                        <th className='px-2 py-1.5 text-left'>阶段</th>
                        <th className='px-2 py-1.5 text-left'>附加维度</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.preview.map((row) => (
                        <tr key={row.line} className='border-t border-border'>
                          <td className='px-2 py-1.5 tabular-nums text-muted-foreground'>
                            {row.line}
                          </td>
                          <td className='px-2 py-1.5'>{row.product_name || '—'}</td>
                          <td className='px-2 py-1.5 font-mono'>{row.asin ?? '—'}</td>
                          <td className='px-2 py-1.5'>{row.category || '—'}</td>
                          <td className='px-2 py-1.5 tabular-nums'>
                            {row.target_price === null ? '—' : row.target_price}
                          </td>
                          <td className='px-2 py-1.5'>{row.marketplace}</td>
                          <td className='px-2 py-1.5'>{row.stageLabel}</td>
                          <td className='px-2 py-1.5'>
                            {Object.entries(row.attributes).length === 0
                              ? '—'
                              : Object.entries(row.attributes)
                                  .map(([key, value]) => `${key}: ${value}`)
                                  .join('，')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {preview.invalid.length > 0 && (
              <div className='space-y-2'>
                <p className='flex items-center gap-1.5 text-sm font-medium'>
                  <AlertCircle aria-hidden='true' className='size-4' />
                  读不出来的行（{preview.invalid.length}）
                </p>
                <ul className='space-y-1 text-xs text-muted-foreground'>
                  {preview.invalid.slice(0, 20).map((item) => (
                    <li key={`${item.line}-${item.value}`}>
                      第 {item.line} 行：{item.reason}
                      {item.value ? `（原值：${item.value}）` : ''}
                    </li>
                  ))}
                  {preview.invalid.length > 20 && (
                    <li>另有 {preview.invalid.length - 20} 行未列出。</li>
                  )}
                </ul>
              </div>
            )}

            {preview.priceUnparsed.length > 0 && (
              <div className='space-y-2'>
                <p className='text-sm font-medium'>
                  目标售价没能读出数字（{preview.priceUnparsed.length}）
                </p>
                <p className='text-xs text-muted-foreground'>
                  价格区间（如 12.99-15.99）与文字描述无法在不猜测的前提下变成数字，
                  因此这些行的目标售价会留空，其余字段照常导入。
                </p>
                <ul className='space-y-1 text-xs text-muted-foreground'>
                  {preview.priceUnparsed.slice(0, 10).map((item) => (
                    <li key={`${item.line}-${item.value}`}>
                      第 {item.line} 行：{item.value}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {result && (
          <div className='space-y-4'>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
              <CountItem label='已新增' value={result.added} />
              <CountItem label='池里已有' value={result.counts.duplicated} />
              <CountItem label='本次重复' value={result.counts.repeated} />
              <CountItem label='无法识别' value={result.counts.invalid} />
            </div>
            <p className='text-sm text-muted-foreground'>
              导入已完成。上方数字是本次的实际结果，未列出的行均未写入候选池。
            </p>
            {result.invalid.length > 0 && (
              <ul className='space-y-1 text-xs text-muted-foreground'>
                {result.invalid.slice(0, 20).map((item) => (
                  <li key={`${item.line}-${item.value}`}>
                    第 {item.line} 行：{item.reason}
                    {item.value ? `（原值：${item.value}）` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button type='button' onClick={() => handleOpenChange(false)}>
              完成
            </Button>
          ) : (
            <>
              <Button type='button' variant='outline' onClick={() => handleOpenChange(false)}>
                取消
              </Button>
              {preview ? (
                <Button
                  type='button'
                  disabled={importMutation.isPending || preview.counts.added === 0}
                  onClick={() => importMutation.mutate()}
                >
                  <Upload aria-hidden='true' />
                  {importMutation.isPending
                    ? '导入中…'
                    : `确认导入 ${preview.counts.added} 条`}
                </Button>
              ) : (
                <Button
                  type='button'
                  disabled={!canPreview}
                  onClick={() => previewMutation.mutate()}
                >
                  {previewMutation.isPending ? '解析中…' : '预览识别结果'}
                </Button>
              )}
            </>
          )}
        </DialogFooter>

        {preview && preview.counts.added === 0 && (
          <p className='text-xs text-muted-foreground'>
            <Badge variant='outline'>提示</Badge> 本次没有可新增的行，确认按钮已禁用。
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

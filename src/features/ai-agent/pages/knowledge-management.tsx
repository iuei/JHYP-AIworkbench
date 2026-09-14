import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  FileText,
  RefreshCw,
  Trash2,
  Upload,
  CalendarClock,
  PowerOff,
  RotateCcw,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  useCorrectionFeedback,
  useCreateDocumentFromText,
  useDatasetFreshness,
  useDeleteDocument,
  useKnowledgeDocuments,
  useMarkFeedbackHandled,
  useReindexKnowledge,
  useUpdateDocument,
  useUploadDocumentFile,
} from '../api/queries'
import {
  DocumentChunksDialog,
  DocumentExpiryDialog,
} from '../components/document-dialogs'
import { PageShell } from '../components/page-shell'
import { formatDate, SOURCE_LABELS } from '../format'
import type { KnowledgeDocument } from '../types'

export function KnowledgeManagement() {
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('all')
  const [sourceType, setSourceType] = useState('all')
  const [page, setPage] = useState(1)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [chunkDocId, setChunkDocId] = useState<KnowledgeDocument | null>(null)
  const [expiryDoc, setExpiryDoc] = useState<KnowledgeDocument | null>(null)
  const [pendingDelete, setPendingDelete] = useState<KnowledgeDocument | null>(
    null
  )

  const documents = useKnowledgeDocuments({
    page,
    pageSize: 20,
    keyword: keyword.trim() || undefined,
    status: status === 'all' ? undefined : status,
    sourceType: sourceType === 'all' ? undefined : sourceType,
  })
  const freshness = useDatasetFreshness()
  const feedback = useCorrectionFeedback()
  const createText = useCreateDocumentFromText()
  const uploadFile = useUploadDocumentFile()
  const updateDocument = useUpdateDocument()
  const deleteDocument = useDeleteDocument()
  const reindex = useReindexKnowledge()
  const markHandled = useMarkFeedbackHandled()

  const total = documents.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / 20))
  const activeCount = useMemo(
    () =>
      (documents.data?.documents ?? []).filter(
        (item) => item.status === 'active'
      ).length,
    [documents.data]
  )

  const submitPaste = () => {
    if (!title.trim() || !content.trim()) {
      toast.error('请填写文档标题与内容')
      return
    }
    createText.mutate(
      {
        title: title.trim(),
        content,
        expiresAt: expiresAt || null,
      },
      {
        onSuccess: (document) => {
          toast.success(`已入库（${document.chunkCount} 个切片），上传即生效`)
          setPasteOpen(false)
          setTitle('')
          setContent('')
          setExpiresAt('')
        },
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : '入库失败，请稍后重试'
          ),
      }
    )
  }

  const onUpload = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    uploadFile.mutate(
      { file, expiresAt: expiresAt || null },
      {
        onSuccess: (document) => {
          toast.success(`《${document.title}》已入库并立即生效`)
          setExpiresAt('')
        },
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : '上传失败，请稍后重试'
          ),
      }
    )
  }

  return (
    <PageShell
    >
      {' '}
      <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex flex-wrap items-center gap-2'>
          <Input
            aria-label='搜索文档标题'
            className='w-full sm:w-64'
            placeholder='搜索文档标题'
            value={keyword}
            onChange={(event) => {
              setKeyword(event.target.value)
              setPage(1)
            }}
          />
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value)
              setPage(1)
            }}
          >
            <SelectTrigger aria-label='按状态筛选' className='w-32'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>全部状态</SelectItem>
              <SelectItem value='active'>生效中</SelectItem>
              <SelectItem value='inactive'>已下线</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={sourceType}
            onValueChange={(value) => {
              setSourceType(value)
              setPage(1)
            }}
          >
            <SelectTrigger aria-label='按来源筛选' className='w-32'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>全部来源</SelectItem>
              <SelectItem value='upload'>人工上传</SelectItem>
              <SelectItem value='feishu'>飞书同步</SelectItem>
              <SelectItem value='experience'>员工经验</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            className='gap-2'
            disabled={reindex.isPending}
            variant='outline'
            onClick={() =>
              reindex.mutate(undefined, {
                onSuccess: (result) =>
                  toast.success(
                    `索引重建完成：生效文档 ${result.documents} 篇，切片 ${result.chunks} 个`
                  ),
                onError: () => toast.error('重建索引失败'),
              })
            }
          >
            <RefreshCw
              className={reindex.isPending ? 'animate-spin' : undefined}
            />
            重建索引
          </Button>
          <Button
            className='gap-2'
            variant='outline'
            onClick={() => setPasteOpen((prev) => !prev)}
          >
            <FileText />
            粘贴文本入库
          </Button>
          <Button asChild className='gap-2'>
            <label>
              <Upload />
              上传文件
              <input
                accept='.txt,.md,.markdown,.csv,.json'
                className='hidden'
                type='file'
                onChange={(event) => {
                  onUpload(event.target.files)
                  event.target.value = ''
                }}
              />
            </label>
          </Button>
        </div>
      </div>
      {pasteOpen && (
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>粘贴文本入库</CardTitle>
            <CardDescription>
              支持 TXT / Markdown
              文本。上传即生效，不设审核流程；建议为制度类文档设置有效期。
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='doc-title'>文档标题</Label>
                <Input
                  id='doc-title'
                  placeholder='例如：亚马逊断货补货流程'
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='doc-expires'>有效期（可选）</Label>
                <Input
                  id='doc-expires'
                  type='date'
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
              </div>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='doc-content'>文档内容</Label>
              <Textarea
                id='doc-content'
                className='min-h-40'
                placeholder='粘贴文档正文，段落之间空一行效果更好。'
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
            </div>
            <div className='flex justify-end gap-2'>
              <Button variant='outline' onClick={() => setPasteOpen(false)}>
                取消
              </Button>
              <Button disabled={createText.isPending} onClick={submitPaste}>
                入库并生效
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        <StatCard label='文档总数' value={String(total)} />
        <StatCard label='本页生效中文档' value={String(activeCount)} />
        <StatCard
          label='知识库数据截至'
          value={formatDate(freshness.data?.knowledge.importedAt ?? null)}
        />
        <StatCard
          label='待处理纠错反馈'
          value={String(feedback.data?.length ?? 0)}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>知识文档</CardTitle>
          <CardDescription>
            有效期已过的文档会自动失效并停止被引用；下线后切片保留以便恢复。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {documents.isLoading && <Skeleton className='h-40 w-full' />}
          {documents.isError && (
            <p className='text-sm text-destructive'>
              文档列表加载失败，请稍后重试。
            </p>
          )}
          {documents.data && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead className='w-28'>来源</TableHead>
                    <TableHead className='w-24'>状态</TableHead>
                    <TableHead className='w-32'>有效期</TableHead>
                    <TableHead className='w-24'>切片数</TableHead>
                    <TableHead className='w-32'>更新时间</TableHead>
                    <TableHead className='w-60'>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.data.documents.length === 0 && (
                    <TableRow>
                      <TableCell className='text-muted-foreground' colSpan={7}>
                        还没有知识文档，先上传一份制度或 SOP 文档试试。
                      </TableCell>
                    </TableRow>
                  )}
                  {documents.data.documents.map((document) => (
                    <TableRow key={document.id}>
                      <TableCell>
                        <div className='flex flex-col'>
                          <span className='font-medium'>{document.title}</span>
                          <span className='text-xs text-muted-foreground'>
                            v{document.docVersion}
                            {document.category ? ` · ${document.category}` : ''}
                            {document.createdByName
                              ? ` · ${document.createdByName}`
                              : ''}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className='font-normal' variant='outline'>
                          {SOURCE_LABELS[document.sourceType] ??
                            document.sourceType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className='font-normal'
                          variant={
                            document.status === 'active'
                              ? 'secondary'
                              : 'outline'
                          }
                        >
                          {document.status === 'active' ? '生效中' : '已下线'}
                        </Badge>
                      </TableCell>
                      <TableCell className='text-xs text-muted-foreground'>
                        {document.expiresAt
                          ? formatDate(document.expiresAt)
                          : '长期有效'}
                      </TableCell>
                      <TableCell>{document.chunkCount}</TableCell>
                      <TableCell className='text-xs text-muted-foreground'>
                        {formatDate(document.updatedAt)}
                      </TableCell>
                      <TableCell>
                        <div className='flex flex-wrap gap-1'>
                          <Button
                            className='h-7 px-2 text-xs'
                            size='sm'
                            variant='ghost'
                            onClick={() => setChunkDocId(document)}
                          >
                            查看片段
                          </Button>
                          <Button
                            className='h-7 gap-1 px-2 text-xs'
                            size='sm'
                            variant='ghost'
                            onClick={() => setExpiryDoc(document)}
                          >
                            <CalendarClock className='size-3.5' />
                            有效期
                          </Button>
                          {document.status === 'active' ? (
                            <Button
                              className='h-7 gap-1 px-2 text-xs'
                              size='sm'
                              variant='ghost'
                              onClick={() =>
                                updateDocument.mutate(
                                  { id: document.id, status: 'inactive' },
                                  {
                                    onSuccess: () =>
                                      toast.success('文档已下线，不再被引用'),
                                    onError: () => toast.error('下线失败'),
                                  }
                                )
                              }
                            >
                              <PowerOff className='size-3.5' />
                              下线
                            </Button>
                          ) : (
                            <Button
                              className='h-7 gap-1 px-2 text-xs'
                              size='sm'
                              variant='ghost'
                              onClick={() =>
                                updateDocument.mutate(
                                  { id: document.id, status: 'active' },
                                  {
                                    onSuccess: () =>
                                      toast.success('文档已重新启用'),
                                    onError: () => toast.error('启用失败'),
                                  }
                                )
                              }
                            >
                              <RotateCcw className='size-3.5' />
                              启用
                            </Button>
                          )}
                          <Button
                            className='h-7 gap-1 px-2 text-xs text-destructive'
                            size='sm'
                            variant='ghost'
                            onClick={() => setPendingDelete(document)}
                          >
                            <Trash2 className='size-3.5' />
                            删除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className='mt-3 flex items-center justify-between text-sm text-muted-foreground'>
                <span>
                  第 {documents.data.page} / {totalPages} 页，共 {total} 篇
                </span>
                <div className='flex gap-2'>
                  <Button
                    disabled={page <= 1}
                    size='sm'
                    variant='outline'
                    onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  >
                    上一页
                  </Button>
                  <Button
                    disabled={page >= totalPages}
                    size='sm'
                    variant='outline'
                    onClick={() => setPage((prev) => prev + 1)}
                  >
                    下一页
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            <AlertTriangle className='size-4 text-amber-500' />
            待处理纠错反馈
          </CardTitle>
          <CardDescription>
            来自对话页「有问题」的反馈，处理后可回到对话验证效果（上传即生效的补偿控制之一）。
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          {(feedback.data ?? []).length === 0 && (
            <p className='text-sm text-muted-foreground'>
              当前没有待处理反馈。
            </p>
          )}
          {(feedback.data ?? []).map((item) => (
            <div className='rounded-lg border p-3' key={item.id}>
              <div className='flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'>
                <span>
                  {item.reporterName ?? item.reporterLogin} ·{' '}
                  {formatDate(item.createdAt)}
                </span>
                <Button
                  className='h-7 px-2 text-xs'
                  size='sm'
                  variant='outline'
                  onClick={() =>
                    markHandled.mutate(item.id, {
                      onSuccess: () => toast.success('已标记为处理完成'),
                    })
                  }
                >
                  标记已处理
                </Button>
              </div>
              {item.comment && <p className='mt-2 text-sm'>{item.comment}</p>}
              <p className='mt-2 line-clamp-3 text-xs whitespace-pre-wrap text-muted-foreground'>
                {item.answerExcerpt}
              </p>
              <p className='mt-1 text-xs text-muted-foreground'>
                引用 {item.citations.length} 条
                {item.citations[0]?.title
                  ? ` · 首个引用：${item.citations[0].title}`
                  : ''}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
      <DocumentChunksDialog
        documentId={chunkDocId?.id ?? null}
        title={chunkDocId?.title ?? ''}
        onOpenChange={(open) => {
          if (!open) setChunkDocId(null)
        }}
      />
      <DocumentExpiryDialog
        document={expiryDoc}
        isPending={updateDocument.isPending}
        key={expiryDoc?.id ?? 'none'}
        onOpenChange={(open) => {
          if (!open) setExpiryDoc(null)
        }}
        onSubmit={(expiresAt) => {
          if (!expiryDoc) return
          updateDocument.mutate(
            { id: expiryDoc.id, expiresAt },
            {
              onSuccess: () => {
                toast.success('有效期已更新')
                setExpiryDoc(null)
              },
              onError: () => toast.error('更新失败'),
            }
          )
        }}
      />
      <ConfirmDialog
        destructive
        confirmText='删除'
        desc={`删除后该文档及其全部切片将立即不可恢复，审计记录仍会保留。确定删除「${pendingDelete?.title ?? ''}」吗？`}
        isLoading={deleteDocument.isPending}
        open={Boolean(pendingDelete)}
        title='删除文档'
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        handleConfirm={() => {
          if (!pendingDelete) return
          deleteDocument.mutate(pendingDelete.id, {
            onSuccess: () => toast.success('文档已删除'),
            onError: () => toast.error('删除失败'),
            onSettled: () => setPendingDelete(null),
          })
        }}
      />
    </PageShell>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className='p-4'>
        <p className='text-xs text-muted-foreground'>{label}</p>
        <p className='mt-1 text-xl font-semibold'>{value}</p>
      </CardContent>
    </Card>
  )
}

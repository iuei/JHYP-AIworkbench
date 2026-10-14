import { useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  FileText,
  ListTree,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  Upload,
  CalendarClock,
  PowerOff,
  RotateCcw,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  TABLE_CELL_ACTIONS,
  TABLE_CELL_META,
  TABLE_CELL_NUMERIC,
  TABLE_HEAD_ACTIONS,
  TABLE_HEAD_NUMERIC,
} from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TableCell, TableHead, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTable } from '@/components/data-table'
import {
  useBatchDocuments,
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
import { MetricStrip } from '../components/metric-strip'
import { PageShell } from '../components/page-shell'
import { RowAction } from '../components/row-action'
import { LayoutToggle } from '../components/layout-toggle'
import { CARD_GRID, useListLayout } from '../components/list-layout'
import { TablePagination } from '@/components/table-pagination'
import { formatDate, SOURCE_LABELS } from '../format'
import type { KnowledgeDocument } from '../types'

/**
 * 展示方式偏好：与**员工侧团队知识库共用同一个键**（`team-knowledge.tsx`）——
 * 它们说的是同一个列表，用户在任一侧选了卡片，另一侧也该是卡片。
 */
const LAYOUT_STORAGE_KEY = 'knowledge-team-layout:v1'

/**
 * 知识库治理：**团队知识库的管理员视图**（原「系统管理 → AI 治理 → 知识库」整页）。
 *
 * 2026-09-18 用户口径「知识库已经迁移到 AI 工作台下，AI 治理子页面不应该保留知识库」：
 * 本组件不再由 `/admin/ai/knowledge` 渲染（那条路由只剩指向 `/knowledge?view=team` 的跳转），
 * 改由 `pages/knowledge-base.tsx` 在团队知识库子页里**按角色**渲染 —— 管理员看到本组件
 * （全量文档含已下线、上传 / 有效期 / 重建索引 / 下线启用删除 / 纠错反馈），员工看到只读的
 * `TeamKnowledge`。
 *
 * **2026-09-18 第二轮（用户反馈「团队知识库修改并没有生效」）**：此前新排版只做在员工只读视图上，
 * 管理员看到的仍是老表格 —— 现在管理员视图的**文档列表也是「卡片（默认）/ 表格」两种读法 +
 * 顶部搜索**，与员工侧同构；治理动作收进工具栏与卡片：工具栏 = 搜索 / 状态 / 来源 / 上传 /
 * 粘贴入库 /（更多）重建索引 / 展示方式，卡片与表格行上挂 查看片段 · 设置有效期 · 下线启用 · 删除。
 * **批量操作仍只在表格视图提供**（卡片不适合多选），指标条与纠错反馈区保持原样。
 */
export function KnowledgeManagement() {
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('all')
  const [sourceType, setSourceType] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [layout, setLayout] = useListLayout(LAYOUT_STORAGE_KEY)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [chunkDocId, setChunkDocId] = useState<KnowledgeDocument | null>(null)
  const [expiryDoc, setExpiryDoc] = useState<KnowledgeDocument | null>(null)
  const [pendingDelete, setPendingDelete] = useState<KnowledgeDocument | null>(
    null
  )
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)

  const documents = useKnowledgeDocuments({
    page,
    pageSize,
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
  const batchDocuments = useBatchDocuments()
  const reindex = useReindexKnowledge()
  const markHandled = useMarkFeedbackHandled()

  const rows = useMemo(() => documents.data?.documents ?? [], [documents.data])
  const total = documents.data?.total ?? 0
  const activeCount = useMemo(
    () => rows.filter((item) => item.status === 'active').length,
    [rows]
  )

  /**
   * 多选状态绑定在"当前筛选 + 页码"这个键上：键一变，选择自动视为空。
   *
   * 为什么不用 useEffect 清空：在 effect 里 setState 会多一次级联渲染，而且中间
   * 存在一帧"选中项还属于上一页"的窗口 —— 那一帧正好可能被批量按钮读到。
   * 更关键的是：翻页后如果保留选择，批量删除会删掉当前已看不见的文档，
   * 界面上没有任何线索能让人提前发现。
   */
  const selectionKey = `${page}|${pageSize}|${keyword}|${status}|${sourceType}`
  const [selection, setSelection] = useState<{
    key: string
    ids: ReadonlySet<number>
  }>(() => ({ key: selectionKey, ids: EMPTY_SELECTION }))
  const selectedIds =
    selection.key === selectionKey ? selection.ids : EMPTY_SELECTION

  const updateSelection = (
    updater: (previous: ReadonlySet<number>) => Set<number>
  ) => {
    setSelection((current) => ({
      key: selectionKey,
      ids: updater(
        current.key === selectionKey ? current.ids : EMPTY_SELECTION
      ),
    }))
  }

  const allSelected =
    rows.length > 0 && rows.every((row) => selectedIds.has(row.id))
  const partiallySelected = rows.some((row) => selectedIds.has(row.id))

  const toggleAllOnPage = (checked: boolean) => {
    updateSelection((previous) => {
      const next = new Set(previous)
      for (const row of rows) {
        if (checked) next.add(row.id)
        else next.delete(row.id)
      }
      return next
    })
  }

  const toggleOne = (id: number, checked: boolean) => {
    updateSelection((previous) => {
      const next = new Set(previous)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const clearSelection = () =>
    setSelection({ key: selectionKey, ids: EMPTY_SELECTION })

  /** 批量结果必须逐条解释：部分失败时只报"失败"等于让管理员自己去猜哪几条没生效。 */
  const runBatch = (action: 'offline' | 'online' | 'delete') => {
    if (selectedIds.size === 0) return
    batchDocuments.mutate(
      { action, ids: [...selectedIds] },
      {
        onSuccess: (result) => {
          const label =
            action === 'offline'
              ? '下线'
              : action === 'online'
                ? '启用'
                : '删除'
          const firstFailure = result.results.find((item) => !item.ok)
          if (result.failed === 0) {
            toast.success(`已${label} ${result.succeeded} 篇文档`)
          } else {
            toast.warning(
              action === 'delete'
                ? `已删除 ${result.succeeded} 篇，${result.failed} 篇未删除`
                : `已${label} ${result.succeeded} 篇，${result.failed} 篇未生效：${
                    firstFailure?.message ?? '原因未知'
                  }`
            )
          }
          setSelection({ key: selectionKey, ids: EMPTY_SELECTION })
        },
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : '批量操作失败，请稍后重试'
          ),
      }
    )
  }

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

  /**
   * 上传 input 用 ref 触发。
   *
   * 原来是 `Button asChild` 包一个 `<label>` 套 `className='hidden'` 的 file input：
   * label 不可聚焦、input 又是 display:none 也不可聚焦，Tab 键到不了、Enter/Space 点不动，
   * 键盘用户完全无法上传（这是全站唯一的上传入口）；改用按钮 click() 触发即可兼顾两种输入方式。
   */
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  /**
   * 下线 / 启用：表格与卡片**共用同一份回调**（内联两处必然漂移：
   * "卡片里下线成功了、表格里漏了 toast"这种）。
   */
  const toggleStatus = (document: KnowledgeDocument) => {
    const next = document.status === 'active' ? 'inactive' : 'active'
    updateDocument.mutate(
      { id: document.id, status: next },
      {
        onSuccess: () =>
          toast.success(
            next === 'inactive' ? '文档已下线，不再被引用' : '文档已重新启用'
          ),
        onError: () => toast.error(next === 'inactive' ? '下线失败' : '启用失败'),
      }
    )
  }

  /** 分页参数：表格视图由 `DataTable` 渲染，卡片视图自己补一个 `TablePagination`。 */
  const pagination = {
    disabled: documents.isFetching,
    page: documents.data?.page ?? 1,
    pageSize: documents.data?.pageSize ?? pageSize,
    total,
    onPageChange: setPage,
    onPageSizeChange: (size: number) => {
      setPageSize(size)
      setPage(1)
    },
  }

  return (
    <PageShell>
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
          {/* 展示方式与员工侧同构（同一个偏好键）：卡片逐篇读、表格便于横向比对与批量勾选 */}
          <LayoutToggle layout={layout} onLayoutChange={setLayout} />
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            className='gap-2'
            variant='outline'
            onClick={() => setPasteOpen((prev) => !prev)}
          >
            <FileText />
            粘贴文本入库
          </Button>
          <Button
            type='button'
            className='gap-2'
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload aria-hidden='true' />
            上传文件
          </Button>
          {/*
            低频且最重的动作（全库重建索引）收进「更多」：它原先和两个导入入口并排，
            三个按钮视觉权重相同，而"重建索引"是排障动作、一次点击影响全库，
            不该长在首屏一级位置。功能与接口未变，只是换了入口层级。
          */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label='更多知识库操作'
                size='icon'
                title='更多知识库操作（重建索引）'
                variant='outline'
              >
                <MoreHorizontal className='size-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem
                disabled={reindex.isPending}
                onSelect={() =>
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
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={fileInputRef}
            accept='.txt,.md,.markdown,.csv,.json'
            className='sr-only'
            type='file'
            aria-label='上传知识文档'
            onChange={(event) => {
              onUpload(event.target.files)
              event.target.value = ''
            }}
          />
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
      <MetricStrip
        items={[
          {
            label: '文档总数',
            value: documents.isLoading ? null : total,
          },
          {
            // 口径写在标签里：它只统计**当前页**的生效文档，和左边的总数不是比例关系，
            // 原来叫「本页生效中文档」放在"文档总数"旁边，很容易被读成占比。
            label: '本页生效中',
            value: documents.isLoading ? null : activeCount,
          },
          {
            label: '数据截至',
            value: freshness.isLoading
              ? null
              : formatDate(freshness.data?.knowledge.importedAt ?? null),
          },
          {
            label: '待处理纠错反馈',
            value: feedback.isLoading ? null : (feedback.data?.length ?? 0),
          },
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>团队知识库</CardTitle>
          <CardDescription>
            有效期已过的文档会自动失效并停止被引用；下线后切片保留以便恢复。
            卡片视图用于逐篇读，批量下线 / 启用 / 删除请切到表格视图勾选。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {layout === 'card' ? (
            documents.isLoading ? (
              <div className={CARD_GRID}>
                <Skeleton className='h-36 w-full' />
                <Skeleton className='h-36 w-full' />
                <Skeleton className='h-36 w-full' />
              </div>
            ) : documents.isError ? (
              <p className='rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground'>
                文档列表加载失败，请稍后重试。
              </p>
            ) : rows.length === 0 ? (
              <p className='rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground'>
                还没有知识文档，先上传一份制度或 SOP 文档试试。
              </p>
            ) : (
              <>
                <div className={CARD_GRID}>
                  {rows.map((document) => (
                    <ManagedDocumentCard
                      document={document}
                      key={document.id}
                      onDelete={() => setPendingDelete(document)}
                      onExpiry={() => setExpiryDoc(document)}
                      onOpenChunks={() => setChunkDocId(document)}
                      onToggleStatus={() => toggleStatus(document)}
                    />
                  ))}
                </div>
                <div className='mt-3'>
                  <TablePagination {...pagination} />
                </div>
              </>
            )
          ) : (
          <DataTable
            columns={8}
            emptyText='还没有知识文档，先上传一份制度或 SOP 文档试试。'
            errorText='文档列表加载失败，请稍后重试。'
            isEmpty={rows.length === 0}
            isError={documents.isError}
            isLoading={documents.isLoading}
            pagination={pagination}
            toolbar={
              /*
                批量操作条只在有选中项时出现：常驻会让表格上方多一行无用控件，
                而"选中后能做什么"恰恰是选中时才需要回答的问题。
              */
              selectedIds.size > 0 ? (
                <div className='flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2'>
                  <span className='text-sm'>
                    已选 <strong>{selectedIds.size}</strong> 篇文档
                  </span>
                  <div className='flex flex-wrap items-center gap-2'>
                    <Button
                      className='gap-1.5'
                      disabled={batchDocuments.isPending}
                      size='sm'
                      variant='outline'
                      onClick={() => runBatch('offline')}
                    >
                      <PowerOff className='size-3.5' />
                      批量下线
                    </Button>
                    <Button
                      className='gap-1.5'
                      disabled={batchDocuments.isPending}
                      size='sm'
                      variant='outline'
                      onClick={() => runBatch('online')}
                    >
                      <RotateCcw className='size-3.5' />
                      批量启用
                    </Button>
                    <Button
                      className='gap-1.5 text-destructive'
                      disabled={batchDocuments.isPending}
                      size='sm'
                      variant='outline'
                      onClick={() => setBatchDeleteOpen(true)}
                    >
                      <Trash2 className='size-3.5' />
                      批量删除
                    </Button>
                    <Button size='sm' variant='ghost' onClick={clearSelection}>
                      取消选择
                    </Button>
                  </div>
                </div>
              ) : undefined
            }
            header={
              <TableRow>
                <TableHead className='w-10'>
                  <Checkbox
                    aria-label='全选本页文档'
                    checked={
                      allSelected
                        ? true
                        : partiallySelected
                          ? 'indeterminate'
                          : false
                    }
                    onCheckedChange={(checked) =>
                      toggleAllOnPage(checked === true)
                    }
                  />
                </TableHead>
                <TableHead>名称</TableHead>
                <TableHead className='w-28'>来源</TableHead>
                <TableHead className='w-24'>状态</TableHead>
                <TableHead className='w-32'>有效期</TableHead>
                <TableHead className={cn('w-24', TABLE_HEAD_NUMERIC)}>
                  切片数
                </TableHead>
                <TableHead className='w-32'>更新时间</TableHead>
                <TableHead className={cn('w-44', TABLE_HEAD_ACTIONS)}>
                  操作
                </TableHead>
              </TableRow>
            }
          >
            {rows.map((document) => (
              <TableRow
                data-state={
                  selectedIds.has(document.id) ? 'selected' : undefined
                }
                key={document.id}
              >
                <TableCell>
                  <Checkbox
                    aria-label={`选择文档 ${document.title}`}
                    checked={selectedIds.has(document.id)}
                    onCheckedChange={(checked) =>
                      toggleOne(document.id, checked === true)
                    }
                  />
                </TableCell>
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
                    {SOURCE_LABELS[document.sourceType] ?? document.sourceType}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    className='font-normal'
                    variant={
                      document.status === 'active' ? 'secondary' : 'outline'
                    }
                  >
                    {document.status === 'active' ? '生效中' : '已下线'}
                  </Badge>
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {document.expiresAt
                    ? formatDate(document.expiresAt)
                    : '长期有效'}
                </TableCell>
                <TableCell className={TABLE_CELL_NUMERIC}>
                  {document.chunkCount}
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {formatDate(document.updatedAt)}
                </TableCell>
                <TableCell className={TABLE_CELL_ACTIONS}>
                  {/*
                          操作列此前是 4 个文字按钮，在 w-60 的窄列里折成两行、行高被撑到 80px 以上。
                          现在：低频的「查看片段 / 有效期 / 删除」用图标 + Tooltip（可访问名不变），
                          只有"下线 / 启用"保留文字 —— 它是唯一改变文档生效状态的按钮，
                          图标表达不了"当前会往哪个方向变"。
                        */}
                  <div className='flex items-center justify-end gap-0.5'>
                    <RowAction
                      icon={ListTree}
                      label='查看片段'
                      onClick={() => setChunkDocId(document)}
                    />
                    <RowAction
                      icon={CalendarClock}
                      label='设置有效期'
                      onClick={() => setExpiryDoc(document)}
                    />
                    {document.status === 'active' ? (
                      <Button
                        className='h-8 gap-1 px-2 text-xs'
                        size='sm'
                        variant='ghost'
                        onClick={() => toggleStatus(document)}
                      >
                        <PowerOff className='size-3.5' />
                        下线
                      </Button>
                    ) : (
                      <Button
                        className='h-8 gap-1 px-2 text-xs'
                        size='sm'
                        variant='ghost'
                        onClick={() => toggleStatus(document)}
                      >
                        <RotateCcw className='size-3.5' />
                        启用
                      </Button>
                    )}
                    <RowAction
                      destructive
                      icon={Trash2}
                      label='删除文档'
                      onClick={() => setPendingDelete(document)}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
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
        desc={`删除后这 ${selectedIds.size} 篇文档及其全部切片将立即不可恢复（审计记录仍会保留）。确定批量删除吗？`}
        isLoading={batchDocuments.isPending}
        open={batchDeleteOpen}
        title='批量删除文档'
        onOpenChange={setBatchDeleteOpen}
        handleConfirm={() => {
          runBatch('delete')
          setBatchDeleteOpen(false)
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

/** 空选择集常量：派生时复用同一引用，避免每次渲染都新建 Set 造成无谓的重渲染。 */
const EMPTY_SELECTION: ReadonlySet<number> = new Set<number>()

/**
 * 治理卡片（管理员视图的卡片读法，2026-09-18）：与员工侧 `DocumentCard` 同一形态
 * （整卡可点开正文切片、元信息两行、卡片恒等高），差别只在**多挂了治理动作**。
 *
 * 操作区 `stopPropagation()`：整卡可点，点「删除」时若让事件冒上去会先弹切片再弹确认框；
 * 键盘侧由 `event.target !== event.currentTarget` 区分。
 *
 * 批量下线 / 启用 / 删除**不在卡片上**：多选是表格的强项，卡片视图只提供逐篇动作
 * （说明文案已在列表上方写明）。
 */
function ManagedDocumentCard({
  document,
  onOpenChunks,
  onExpiry,
  onToggleStatus,
  onDelete,
}: {
  document: KnowledgeDocument
  onOpenChunks: () => void
  onExpiry: () => void
  onToggleStatus: () => void
  onDelete: () => void
}) {
  const active = document.status === 'active'

  return (
    <article
      aria-label={`查看《${document.title}》的正文切片`}
      className='flex h-full cursor-pointer flex-col rounded-xl border p-4 transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
      role='button'
      tabIndex={0}
      onClick={onOpenChunks}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpenChunks()
        }
      }}
    >
      <div className='flex flex-wrap items-start gap-x-3 gap-y-2'>
        <h3 className='text-sm font-medium'>{document.title}</h3>
        <Badge className='mt-0.5 font-normal' variant='outline'>
          {SOURCE_LABELS[document.sourceType] ?? document.sourceType}
        </Badge>
        <Badge
          className='mt-0.5 font-normal'
          variant={active ? 'secondary' : 'outline'}
        >
          {active ? '生效中' : '已下线'}
        </Badge>

        <div
          className='ms-auto flex flex-wrap items-center gap-0.5'
          onClick={(event) => event.stopPropagation()}
        >
          <RowAction icon={ListTree} label='查看片段' onClick={onOpenChunks} />
          <RowAction
            icon={CalendarClock}
            label='设置有效期'
            onClick={onExpiry}
          />
          <Button
            className='h-7 gap-1 px-2 text-xs'
            size='sm'
            variant='ghost'
            onClick={onToggleStatus}
          >
            {active ? (
              <>
                <PowerOff className='size-3.5' />
                下线
              </>
            ) : (
              <>
                <RotateCcw className='size-3.5' />
                启用
              </>
            )}
          </Button>
          <RowAction
            destructive
            icon={Trash2}
            label='删除文档'
            onClick={onDelete}
          />
        </div>
      </div>

      <div className='mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground'>
        <span>v{document.docVersion}</span>
        {document.category && (
          <>
            <span aria-hidden>·</span>
            <span>{document.category}</span>
          </>
        )}
        {document.createdByName && (
          <>
            <span aria-hidden>·</span>
            <span>{document.createdByName}</span>
          </>
        )}
        {/* 「查看正文」是视觉提示而不是第二个按钮（整卡已经是按钮） */}
        <span className='ms-auto text-primary'>查看正文</span>
      </div>

      <div className='mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground'>
        <span>
          有效期 {document.expiresAt ? formatDate(document.expiresAt) : '长期有效'}
        </span>
        <span aria-hidden>·</span>
        <span>切片 {document.chunkCount}</span>
        <span aria-hidden>·</span>
        <span>更新于 {formatDate(document.updatedAt)}</span>
      </div>
    </article>
  )
}

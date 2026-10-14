import { useState } from 'react'
import { FileText, Search } from 'lucide-react'
import {
  TABLE_CELL_ACTIONS,
  TABLE_CELL_META,
  TABLE_CELL_NUMERIC,
  TABLE_HEAD_ACTIONS,
  TABLE_HEAD_NUMERIC,
  TABLE_SEARCH_ICON,
  TABLE_SEARCH_INPUT,
} from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { TablePagination } from '@/components/table-pagination'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { usePublicKnowledgeDocuments } from '../api/queries'
import { SOURCE_LABELS, formatDate } from '../format'
import type { KnowledgeDocument } from '../types'
import { DocumentChunksDialog } from './document-dialogs'
import { LayoutToggle } from './layout-toggle'
import { CARD_GRID, useListLayout } from './list-layout'
import { PageShell } from './page-shell'

/** 与治理页同一档：20 条/页在这张表的字段宽度下刚好不挤压标题列。 */
const DEFAULT_PAGE_SIZE = 20

const SOURCE_OPTIONS = [
  { value: 'all', label: '全部来源' },
  { value: 'upload', label: '人工上传' },
  { value: 'feishu', label: '飞书同步' },
  { value: 'experience', label: '员工经验' },
]

/**
 * 展示方式偏好键（2026-09-18）：**每个列表一个键** —— 与提示词广场、个人知识库
 * 互不覆盖（在那里选了表格，不该顺手把团队库也切成表格）。
 */
const LAYOUT_STORAGE_KEY = 'knowledge-team-layout:v1'

/**
 * 团队知识库 —— **员工只读视图**（2026-09-18）。
 *
 * 它是「知识库」的第二个子页（`?view=team`），回答的问题是
 * "公司现在有哪些已经生效的知识文档、它们从哪来、AI 回答时引用的到底是什么"。
 *
 * **只读，与管理员视图分开**：上传 / 有效期 / 下线 / 删除 / 纠错反馈全部留在
 * **同一子页的管理员视图**（原 `/admin/ai/knowledge` 治理页组件 `KnowledgeManagement`，
 * 2026-09-18 并入这里，见 `pages/knowledge-base.tsx` 的角色分发）——
 * 给它开写权限等于把治理动作暴露给全员，而知识文档会直接进入 RAG 检索。
 *
 * 两个刻意的口径：
 * ① **只列生效中的文档**（服务端强制，见 `knowledge-routes.mjs` 的 `/knowledge/public/*`）：
 *    已下线的文档语义是"不再被引用"，列出来只会让"知识库现在有什么"变得含糊；
 * ② **正文可以看**：切片正文本来就会被 AI 引用并展示在回答里，不给看反而会让人
 *    无法核对"AI 引用的到底是不是这份文档"。
 *
 * **2026-09-18 排版改为提示词广场同构**（用户口径「知识库参考提示词广场排版布局使用卡片
 * 和表格展示，同时也支持搜索」）：工具栏（搜索 + 来源筛选 + 卡片/表格切换）→ 卡片网格
 * （默认，整卡可点开正文切片弹窗）/ 表格可切换 → 分页。卡片与表格**能力等价**：
 * 两条路径打开的是同一个 `DocumentChunksDialog`；卡片不展开正文，因此卡片高度恒定。
 */
export function TeamKnowledge() {
  const [keyword, setKeyword] = useState('')
  const debouncedKeyword = useDebouncedValue(keyword)
  const [sourceType, setSourceType] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [layout, setLayout] = useListLayout(LAYOUT_STORAGE_KEY)
  const [chunksDocument, setChunksDocument] = useState<KnowledgeDocument | null>(
    null
  )

  const documents = usePublicKnowledgeDocuments({
    page,
    pageSize,
    sourceType: sourceType === 'all' ? undefined : sourceType,
    keyword: debouncedKeyword.trim() || undefined,
  })

  const rows = documents.data?.documents ?? []
  const total = documents.data?.total ?? 0
  const filtering = Boolean(debouncedKeyword.trim()) || sourceType !== 'all'

  /** 切布局顺手关掉弹窗：它是模态浮层，留着会挡住刚切过去的列表。 */
  const handleLayoutChange = (next: typeof layout) => {
    setLayout(next)
    setChunksDocument(null)
  }

  const openChunks = (document: KnowledgeDocument) =>
    setChunksDocument(document)

  const pagination = {
    disabled: documents.isFetching,
    page: documents.data?.page ?? page,
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
      <div className='space-y-3'>
        <div className='space-y-1'>
          <h2 className='text-base font-semibold'>团队知识库</h2>
          <p className='text-sm text-muted-foreground'>
            公司已经生效的知识文档，AI 回答时会引用它们；这里是只读视图 ——
            上传、下线与纠错反馈由管理员在团队知识库的管理视图中维护。
          </p>
        </div>

        {/* 工具栏：与提示词广场同构（搜索吃满剩余宽度、筛选与展示方式靠右） */}
        <div className='flex flex-wrap items-center gap-2'>
          <div className='relative min-w-[220px] flex-1 sm:max-w-xs'>
            <Search className={TABLE_SEARCH_ICON} aria-hidden='true' />
            <Input
              aria-label='搜索团队知识文档标题'
              autoComplete='off'
              className={TABLE_SEARCH_INPUT}
              placeholder='搜索文档标题'
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value)
                setPage(1)
              }}
            />
          </div>
          <Select
            value={sourceType}
            onValueChange={(value) => {
              setSourceType(value)
              setPage(1)
            }}
          >
            <SelectTrigger
              aria-label='按来源筛选团队知识文档'
              className='w-32'
              size='sm'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <LayoutToggle layout={layout} onLayoutChange={handleLayoutChange} />
        </div>

        <p className='text-xs text-muted-foreground'>
          {filtering ? `找到 ${total} 篇生效中的文档。` : `共 ${total} 篇生效中的文档。`}
          过期文档会自动失效并停止被引用，因此不会出现在这里。
        </p>

        {layout === 'card' ? (
          <>
            {documents.isLoading ? (
              <div className={CARD_GRID}>
                <Skeleton className='h-36 w-full' />
                <Skeleton className='h-36 w-full' />
                <Skeleton className='h-36 w-full' />
              </div>
            ) : rows.length === 0 ? (
              <p className='rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground'>
                {filtering
                  ? '没有符合条件的文档，换个关键词或把来源切回「全部」。'
                  : '知识库里还没有生效中的文档。管理员上传并生效后，这里就能看到。'}
              </p>
            ) : (
              <div className={CARD_GRID}>
                {rows.map((document) => (
                  <DocumentCard
                    document={document}
                    key={document.id}
                    onOpen={() => openChunks(document)}
                  />
                ))}
              </div>
            )}

            {/* 表格视图的分页器由 `DataTable` 内部渲染，这里只在卡片视图补一个 */}
            {rows.length > 0 && <TablePagination {...pagination} />}
          </>
        ) : (
          <DataTable
            columns={6}
            emptyText={
              filtering
                ? '没有符合条件的文档，换个关键词或把来源切回「全部」。'
                : '知识库里还没有生效中的文档。管理员上传并生效后，这里就能看到。'
            }
            errorText='团队知识库加载失败，请稍后重试。'
            isEmpty={rows.length === 0}
            isError={documents.isError}
            isLoading={documents.isLoading}
            pagination={pagination}
            header={
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead className='w-28'>来源</TableHead>
                <TableHead className='w-32'>有效期</TableHead>
                <TableHead className={cn('w-24', TABLE_HEAD_NUMERIC)}>
                  切片数
                </TableHead>
                <TableHead className='w-32'>更新时间</TableHead>
                <TableHead className={cn('w-32', TABLE_HEAD_ACTIONS)}>
                  操作
                </TableHead>
              </TableRow>
            }
          >
            {rows.map((document) => (
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
                    {SOURCE_LABELS[document.sourceType] ?? document.sourceType}
                  </Badge>
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {document.expiresAt ? formatDate(document.expiresAt) : '长期有效'}
                </TableCell>
                <TableCell className={TABLE_CELL_NUMERIC}>
                  {document.chunkCount}
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {formatDate(document.updatedAt)}
                </TableCell>
                <TableCell className={TABLE_CELL_ACTIONS}>
                  <Button
                    aria-label={`查看《${document.title}》的正文切片`}
                    className='gap-1.5'
                    size='sm'
                    type='button'
                    variant='ghost'
                    onClick={() => openChunks(document)}
                  >
                    <FileText aria-hidden='true' />
                    查看正文
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        )}
      </div>

      <DocumentChunksDialog
        documentId={chunksDocument?.id ?? null}
        onOpenChange={(open) => {
          if (!open) setChunksDocument(null)
        }}
        scope='public'
        title={chunksDocument?.title ?? ''}
      />
    </PageShell>
  )
}

/**
 * 文档卡片：**整卡可点**（`role='button'` + `tabIndex` + Enter/Space），
 * 与提示词广场的卡片同一形态 —— 一个可点区域，不再嵌第二个按钮
 * （嵌了会让读屏遇到两个重叠的可点区域，提示词广场踩过这条）。
 *
 * 卡片恒等高（网格 `auto-rows-fr`）：正文不进卡片，完整切片在弹窗里读。
 */
function DocumentCard({
  document,
  onOpen,
}: {
  document: KnowledgeDocument
  onOpen: () => void
}) {
  return (
    <article
      aria-label={`查看《${document.title}》的正文切片`}
      className='flex h-full cursor-pointer flex-col rounded-xl border p-4 transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
      role='button'
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <div className='flex flex-wrap items-start gap-x-3 gap-y-2'>
        <h3 className='text-sm font-medium'>{document.title}</h3>
        <Badge className='mt-0.5 font-normal' variant='outline'>
          {SOURCE_LABELS[document.sourceType] ?? document.sourceType}
        </Badge>
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

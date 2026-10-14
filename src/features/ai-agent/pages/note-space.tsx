import { useState } from 'react'
import {
  Archive,
  BookmarkPlus,
  Download,
  Eye,
  Pencil,
  Send,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  TABLE_CELL_ACTIONS,
  TABLE_CELL_META,
  TABLE_HEAD_ACTIONS,
} from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTable } from '@/components/data-table'
import { TablePagination } from '@/components/table-pagination'
import {
  useArchiveNote,
  useDeleteNote,
  useExportNotes,
  useMyNotes,
  useMySkill,
  useSubmitNote,
} from '../api/queries'
import { LayoutToggle } from '../components/layout-toggle'
import { CARD_GRID, useListLayout } from '../components/list-layout'
import { NoteDetailDialog, NoteEditorDialog } from '../components/note-dialogs'
import { PageShell } from '../components/page-shell'
import { SkillConfigCard } from '../components/skill-config-card'
import {
  NOTE_ARCHIVE_HINTS,
  NOTE_DELETE_HINT,
  NOTE_LOCKED_HINTS,
  NOTE_PROVENANCE_LABELS,
  NOTE_SOURCE_LABELS,
  NOTE_STATUS_LABELS,
  NOTE_STATUS_VARIANTS,
  canArchiveNote,
  canDeleteNote,
  canEditNote,
  formatTime,
} from '../format'
import type { KnowledgeNote } from '../types'

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'private', label: '私有草稿' },
  { value: 'pending', label: '待审核' },
  { value: 'published', label: '已发布' },
  { value: 'rejected', label: '已驳回' },
  { value: 'archived', label: '已归档' },
]

/**
 * 个人沉淀固定每页 20 条。
 *
 * 服务端不支持切换每页条数（因此不传 `onPageSizeChange`，分页器不渲染条数选择器），
 * 提成常量只为让查询参数与分页器显示共用同一个值，避免两处各写一个 20。
 */
const NOTE_PAGE_SIZE = 20

/**
 * 展示方式偏好键（2026-09-18）：与提示词广场、团队知识库**各用一个键**，
 * 三处的选择互不覆盖。
 */
const LAYOUT_STORAGE_KEY = 'knowledge-notes-layout:v1'

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/**
 * 「我的知识沉淀」：账号级个人知识空间。
 *
 * 三条边界在界面上必须说清：
 *   1. 私有沉淀只有自己可见（管理员也只在管理页看到，不会出现在问答检索里）；
 *   2. 提交审核通过后才会进入公司知识库并标注提报人；
 *   3. 手工新建不受技能开关与每日配额限制。
 *
 * **2026-09-18 排版改为提示词广场同构**（用户口径「知识库参考提示词广场排版布局使用卡片
 * 和表格展示，同时也支持搜索」）：去掉原来那层 `Card` 外壳，改成
 * 「标题 + 一行说明 + 工具栏（搜索 / 状态 / 卡片表格切换 / 新建 / 导出）+ 卡片网格或表格」，
 * 与提示词广场、团队知识库三处一致。**卡片默认**、整卡可点开详情弹窗（详情弹窗里能转编辑），
 * 卡片上的编辑 / 归档 / 删除与表格里的同名操作用同一份回调与同一套禁用条件。
 */
export function NoteSpace() {
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<KnowledgeNote | null>(null)
  const [detail, setDetail] = useState<KnowledgeNote | null>(null)
  const [pendingDelete, setPendingDelete] = useState<KnowledgeNote | null>(null)
  const [layout, setLayout] = useListLayout(LAYOUT_STORAGE_KEY)

  const notes = useMyNotes({
    page,
    pageSize: NOTE_PAGE_SIZE,
    keyword: keyword.trim() || undefined,
    status: status === 'all' ? undefined : status,
  })
  const skill = useMySkill()
  const submit = useSubmitNote()
  const archive = useArchiveNote()
  const remove = useDeleteNote()
  const exportNotes = useExportNotes()

  const rows = notes.data?.rows ?? []
  // 字段定义以技能契约为唯一来源（服务端下发），避免前端再维护一份重复定义
  const fields = skill.data?.skill.fieldSchema ?? []

  /** 切布局顺手关掉详情弹窗：模态浮层留着会挡住刚切过去的列表。 */
  const handleLayoutChange = (next: typeof layout) => {
    setLayout(next)
    setDetail(null)
  }

  /** 提交审核：卡片与表格共用（内联两处必然漂移）。 */
  const submitNote = (note: KnowledgeNote) =>
    submit.mutate(note.id, {
      onSuccess: () => toast.success('已提交审核'),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : '提交失败'),
    })

  /** 归档：同上，两处共用。 */
  const archiveNote = (note: KnowledgeNote) =>
    archive.mutate(note.id, {
      onSuccess: () => toast.success('已归档'),
      onError: (error) =>
        toast.error(error instanceof Error ? error.message : '归档失败'),
    })

  const openEditor = (note: KnowledgeNote | null) => {
    setEditing(note)
    setEditorOpen(true)
  }

  const runExport = (format: 'csv' | 'md' | 'json') => {
    exportNotes.mutate(
      {
        format,
        // 列表与导出必须共用同一组筛选：只带 status 会让导出的范围超出屏幕上看到的内容
        // （用户搜完再导出，拿到的是包含已被筛掉的条目，且 toast 不会提示范围）。
        params: {
          status: status === 'all' ? undefined : status,
          keyword: keyword.trim() || undefined,
        },
      },
      {
        onSuccess: ({ text, truncated }) => {
          const mime =
            format === 'csv'
              ? 'text/csv'
              : format === 'md'
                ? 'text/markdown'
                : 'application/json'
          downloadText(`我的知识沉淀-${Date.now()}.${format}`, text, mime)
          toast.success(
            truncated
              ? '导出完成，但条数已达上限（2000 条），请缩小筛选范围后重新导出（导出动作已写入审计）'
              : '导出完成（导出动作已写入审计）'
          )
        },
        onError: () => toast.error('导出失败，请稍后重试'),
      }
    )
  }

  const pagination = notes.data
    ? {
        disabled: notes.isFetching,
        page: notes.data.page,
        pageSize: NOTE_PAGE_SIZE,
        total: notes.data.total,
        onPageChange: setPage,
      }
    : null

  return (
    <PageShell>
      <SkillConfigCard />

      <div className='space-y-3'>
        <div className='space-y-1'>
          <h2 className='text-base font-semibold'>沉淀条目</h2>
          <p className='text-sm text-muted-foreground'>
            共 {notes.data?.total ?? 0} 条 ·
            同标题的沉淀会自动合并为新版本，不会堆重复条目
          </p>
        </div>

        {/* 工具栏：与提示词广场同构（搜索吃满剩余宽度、筛选与展示方式靠右） */}
        <div className='flex flex-wrap items-center gap-2'>
          <div className='relative min-w-[220px] flex-1 sm:max-w-xs'>
            <Input
              aria-label='搜索个人知识库条目'
              autoComplete='off'
              placeholder='搜索标题、概述、原文依据或字段内容'
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value)
                setPage(1)
              }}
            />
          </div>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value)
              setPage(1)
            }}
          >
            <SelectTrigger aria-label='按状态筛选' className='w-36' size='sm'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <LayoutToggle layout={layout} onLayoutChange={handleLayoutChange} />

          <Button className='gap-2' onClick={() => openEditor(null)}>
            <BookmarkPlus className='size-4' />
            手工新建
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className='gap-2'
                disabled={exportNotes.isPending}
                variant='outline'
              >
                <Download className='size-4' />
                导出个人知识库
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem onClick={() => runExport('md')}>
                导出 Markdown（带 frontmatter，可再入库）
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => runExport('csv')}>
                导出 CSV（Excel 可直接打开）
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => runExport('json')}>
                导出 JSON（结构化备份）
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {layout === 'card' ? (
          <>
            {notes.isLoading ? (
              <div className={CARD_GRID}>
                <Skeleton className='h-36 w-full' />
                <Skeleton className='h-36 w-full' />
                <Skeleton className='h-36 w-full' />
              </div>
            ) : notes.isError ? (
              <p className='rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground'>
                沉淀列表加载失败，请稍后重试。
              </p>
            ) : rows.length === 0 ? (
              <p className='rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground'>
                还没有沉淀。可以手工新建，或在对话里点「沉淀为知识」让 AI
                帮忙整理。
              </p>
            ) : (
              <div className={CARD_GRID}>
                {rows.map((note) => (
                  <NoteCard
                    canArchive={canArchiveNote(note)}
                    canDelete={canDeleteNote(note)}
                    canEdit={canEditNote(note)}
                    key={note.id}
                    note={note}
                    onArchive={() => archiveNote(note)}
                    onDelete={() => setPendingDelete(note)}
                    onEdit={() => openEditor(note)}
                    onOpenDetail={() => setDetail(note)}
                    onSubmit={() => submitNote(note)}
                  />
                ))}
              </div>
            )}

            {/* 表格视图的分页器由 `DataTable` 内部渲染，这里只在卡片视图补一个 */}
            {rows.length > 0 && pagination && (
              <TablePagination {...pagination} />
            )}
          </>
        ) : (
          <DataTable
            columns={5}
            emptyText='还没有沉淀。可以手工新建，或在对话里点「沉淀为知识」让 AI 帮忙整理。'
            header={
              <TableRow>
                <TableHead>标题</TableHead>
                <TableHead className='w-28'>状态</TableHead>
                <TableHead className='w-32'>来源</TableHead>
                <TableHead className='w-32'>更新时间</TableHead>
                <TableHead className={cn('w-56', TABLE_HEAD_ACTIONS)}>
                  操作
                </TableHead>
              </TableRow>
            }
            isEmpty={rows.length === 0}
            isError={notes.isError}
            isLoading={notes.isLoading}
            pagination={pagination ?? undefined}
          >
            {rows.map((note) => (
              <TableRow key={note.id}>
                <TableCell>
                  <div className='space-y-1'>
                    <p className='font-medium'>{note.title}</p>
                    <div className='flex flex-wrap items-center gap-1'>
                      {note.tags.map((tag) => (
                        <Badge key={tag} variant='outline'>
                          {tag}
                        </Badge>
                      ))}
                      {note.noteVersion > 1 && (
                        <span className='text-xs text-muted-foreground'>
                          第 {note.noteVersion} 版
                        </span>
                      )}
                      {note.revisionOfNoteId && (
                        <Badge
                          variant='secondary'
                          title={`替代已归档的旧版本 #${note.revisionOfNoteId}，旧版本的公共文档不会被改动`}
                        >
                          新修订 · 需重新审核
                        </Badge>
                      )}
                      {note.degraded && (
                        <span className='text-xs text-muted-foreground'>
                          待补充字段
                        </span>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={NOTE_STATUS_VARIANTS[note.status] ?? 'outline'}
                  >
                    {NOTE_STATUS_LABELS[note.status] ?? note.status}
                  </Badge>
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {NOTE_SOURCE_LABELS[note.sourceKind] ?? note.sourceKind}
                  <span className='block text-xs'>
                    {NOTE_PROVENANCE_LABELS[note.provenance] ?? note.provenance}
                  </span>
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {formatTime(note.updatedAt)}
                </TableCell>
                <TableCell className={TABLE_CELL_ACTIONS}>
                  <div className='flex flex-wrap justify-end gap-1'>
                    <Button
                      aria-label='查看沉淀详情'
                      size='sm'
                      variant='ghost'
                      onClick={() => setDetail(note)}
                    >
                      <Eye className='size-4' />
                    </Button>
                    <Button
                      aria-label='编辑沉淀'
                      disabled={!canEditNote(note)}
                      size='sm'
                      title={NOTE_LOCKED_HINTS[note.status]}
                      variant='ghost'
                      onClick={() => openEditor(note)}
                    >
                      <Pencil className='size-4' />
                    </Button>
                    <Button
                      className='gap-1'
                      disabled={
                        note.status !== 'private' && note.status !== 'rejected'
                      }
                      size='sm'
                      title='提交管理员审核，通过后进入公司知识库'
                      variant='ghost'
                      onClick={() => submitNote(note)}
                    >
                      <Send className='size-4' />
                      提交审核
                    </Button>
                    <Button
                      aria-label='归档沉淀'
                      disabled={!canArchiveNote(note)}
                      size='sm'
                      title={NOTE_ARCHIVE_HINTS[note.status]}
                      variant='ghost'
                      onClick={() => archiveNote(note)}
                    >
                      <Archive className='size-4' />
                    </Button>
                    <Button
                      aria-label='删除沉淀'
                      title={canDeleteNote(note) ? undefined : NOTE_DELETE_HINT}
                      disabled={!canDeleteNote(note)}
                      size='sm'
                      variant='ghost'
                      onClick={() => setPendingDelete(note)}
                    >
                      <Trash2 className='size-4' />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        )}
      </div>

      <NoteEditorDialog
        fields={fields}
        note={editing}
        open={editorOpen}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) setEditing(null)
        }}
      />

      <NoteDetailDialog
        fields={fields}
        note={detail}
        open={Boolean(detail)}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
        onEdit={(note) => {
          setDetail(null)
          setEditing(note)
          setEditorOpen(true)
        }}
      />

      <ConfirmDialog
        desc={`删除后这条沉淀不再出现在你的列表里（保留审计记录）：${pendingDelete?.title ?? ''}`}
        destructive
        open={Boolean(pendingDelete)}
        title='删除沉淀'
        confirmText='删除'
        handleConfirm={() => {
          if (!pendingDelete) return
          remove.mutate(
            { id: pendingDelete.id, scope: 'self' },
            {
              onSuccess: () => toast.success('已删除'),
              onError: () => toast.error('删除失败，请稍后重试'),
            }
          )
          setPendingDelete(null)
        }}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      />
    </PageShell>
  )
}

/**
 * 沉淀卡片：**整卡可点**（打开详情弹窗，弹窗里可转编辑），
 * 与提示词广场、团队知识库的卡片同一形态。
 *
 * 操作区 `stopPropagation()` 是必需的：整卡可点，点「删除」时若让事件冒上去，
 * 会先弹详情再弹确认框（两个浮层打架）；键盘侧由 `event.target !== event.currentTarget`
 * 区分（焦点在内部按钮上按 Enter 时 keydown 仍会冒泡到卡片）。
 *
 * 卡片上的操作按钮与表格里的**同名同禁用条件**（`aria-label` 逐字一致），
 * 只是收成图标尺寸：卡片宽约 400px，四个文字按钮会折行、把卡片撑高。
 */
function NoteCard({
  note,
  canEdit,
  canArchive,
  canDelete,
  onOpenDetail,
  onEdit,
  onSubmit,
  onArchive,
  onDelete,
}: {
  note: KnowledgeNote
  canEdit: boolean
  canArchive: boolean
  canDelete: boolean
  onOpenDetail: () => void
  onEdit: () => void
  onSubmit: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  const submittable = note.status === 'private' || note.status === 'rejected'

  return (
    <article
      aria-label={`查看沉淀「${note.title}」详情`}
      className='flex h-full cursor-pointer flex-col rounded-xl border p-4 transition-colors hover:border-primary/40 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
      role='button'
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpenDetail()
        }
      }}
    >
      <div className='flex flex-wrap items-start gap-x-3 gap-y-2'>
        <h3 className='text-sm font-medium'>{note.title}</h3>
        <Badge
          className='mt-0.5 font-normal'
          variant={NOTE_STATUS_VARIANTS[note.status] ?? 'outline'}
        >
          {NOTE_STATUS_LABELS[note.status] ?? note.status}
        </Badge>

        <div
          className='ms-auto flex flex-wrap items-center gap-0.5'
          onClick={(event) => event.stopPropagation()}
        >
          {submittable && (
            <Button
              className='h-7 gap-1.5 px-2'
              size='sm'
              title='提交管理员审核，通过后进入公司知识库'
              variant='ghost'
              onClick={onSubmit}
            >
              <Send className='size-3.5' />
              提交审核
            </Button>
          )}
          <Button
            aria-label='编辑沉淀'
            className='size-7'
            disabled={!canEdit}
            size='icon'
            title={NOTE_LOCKED_HINTS[note.status]}
            variant='ghost'
            onClick={onEdit}
          >
            <Pencil className='size-3.5' />
          </Button>
          <Button
            aria-label='归档沉淀'
            className='size-7'
            disabled={!canArchive}
            size='icon'
            title={NOTE_ARCHIVE_HINTS[note.status]}
            variant='ghost'
            onClick={onArchive}
          >
            <Archive className='size-3.5' />
          </Button>
          <Button
            aria-label='删除沉淀'
            className='size-7 text-destructive hover:text-destructive'
            disabled={!canDelete}
            size='icon'
            title={canDelete ? undefined : NOTE_DELETE_HINT}
            variant='ghost'
            onClick={onDelete}
          >
            <Trash2 className='size-3.5' />
          </Button>
        </div>
      </div>

      <div className='mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground'>
        <span>
          {NOTE_SOURCE_LABELS[note.sourceKind] ?? note.sourceKind}
          {' · '}
          {NOTE_PROVENANCE_LABELS[note.provenance] ?? note.provenance}
        </span>
        <span aria-hidden>·</span>
        <span>更新于 {formatTime(note.updatedAt)}</span>
        {note.noteVersion > 1 && (
          <>
            <span aria-hidden>·</span>
            <span>第 {note.noteVersion} 版</span>
          </>
        )}
        {/* 「查看详情」是视觉提示而不是第二个按钮（整卡已经是按钮） */}
        <span className='ms-auto text-primary'>查看详情</span>
      </div>

      {(note.tags.length > 0 || note.revisionOfNoteId || note.degraded) && (
        <div className='mt-2 flex flex-wrap items-center gap-1.5'>
          {note.tags.map((tag) => (
            <Badge className='font-normal' key={tag} variant='outline'>
              {tag}
            </Badge>
          ))}
          {note.revisionOfNoteId && (
            <Badge
              variant='secondary'
              title={`替代已归档的旧版本 #${note.revisionOfNoteId}，旧版本的公共文档不会被改动`}
            >
              新修订 · 需重新审核
            </Badge>
          )}
          {note.degraded && (
            <span className='text-xs text-muted-foreground'>待补充字段</span>
          )}
        </div>
      )}

      {note.summary && (
        <p className='mt-2 line-clamp-2 text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap'>
          {note.summary}
        </p>
      )}
    </article>
  )
}

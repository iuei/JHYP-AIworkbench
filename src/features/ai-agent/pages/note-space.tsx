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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  useArchiveNote,
  useDeleteNote,
  useExportNotes,
  useMyNotes,
  useMySkill,
  useSubmitNote,
} from '../api/queries'
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
 */
export function NoteSpace() {
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<KnowledgeNote | null>(null)
  const [detail, setDetail] = useState<KnowledgeNote | null>(null)
  const [pendingDelete, setPendingDelete] = useState<KnowledgeNote | null>(null)

  const notes = useMyNotes({
    page,
    pageSize: 20,
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
        onSuccess: (text) => {
          const mime =
            format === 'csv'
              ? 'text/csv'
              : format === 'md'
                ? 'text/markdown'
                : 'application/json'
          downloadText(`我的知识沉淀-${Date.now()}.${format}`, text, mime)
          toast.success('导出完成（导出动作已写入审计）')
        },
        onError: () => toast.error('导出失败，请稍后重试'),
      }
    )
  }

  return (
    <PageShell
    >
      <SkillConfigCard />

      <Card>
        <CardHeader className='gap-1'>
          <CardTitle className='text-base'>沉淀条目</CardTitle>
          <CardDescription>
            共 {notes.data?.total ?? 0} 条 ·
            同标题的沉淀会自动合并为新版本，不会堆重复条目
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <Input
              aria-label='搜索我的沉淀'
              className='w-full sm:w-64'
              placeholder='搜索标题、概述、原文依据或字段内容'
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
              <SelectTrigger aria-label='按状态筛选' className='w-36'>
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

            <Button
              className='gap-2'
              onClick={() => {
                setEditing(null)
                setEditorOpen(true)
              }}
            >
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
                  导出我的沉淀
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

          {notes.isLoading ? (
            <Skeleton className='h-40 w-full' />
          ) : rows.length === 0 ? (
            <p className='rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground'>
              还没有沉淀。可以手工新建，或在对话里点「沉淀为知识」让 AI
              帮忙整理。
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>标题</TableHead>
                  <TableHead className='w-28'>状态</TableHead>
                  <TableHead className='w-32'>来源</TableHead>
                  <TableHead className='w-32'>更新时间</TableHead>
                  <TableHead className='w-56'>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
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
                    <TableCell className='text-sm text-muted-foreground'>
                      {NOTE_SOURCE_LABELS[note.sourceKind] ?? note.sourceKind}
                      <span className='block text-xs'>
                        {NOTE_PROVENANCE_LABELS[note.provenance] ??
                          note.provenance}
                      </span>
                    </TableCell>
                    <TableCell className='text-sm text-muted-foreground'>
                      {formatTime(note.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <div className='flex flex-wrap gap-1'>
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
                          onClick={() => {
                            setEditing(note)
                            setEditorOpen(true)
                          }}
                        >
                          <Pencil className='size-4' />
                        </Button>
                        <Button
                          className='gap-1'
                          disabled={
                            note.status !== 'private' &&
                            note.status !== 'rejected'
                          }
                          size='sm'
                          title='提交管理员审核，通过后进入公司知识库'
                          variant='ghost'
                          onClick={() =>
                            submit.mutate(note.id, {
                              onSuccess: () => toast.success('已提交审核'),
                              onError: (error) =>
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : '提交失败'
                                ),
                            })
                          }
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
                          onClick={() =>
                            archive.mutate(note.id, {
                              onSuccess: () => toast.success('已归档'),
                              onError: (error) =>
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : '归档失败'
                                ),
                            })
                          }
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
              </TableBody>
            </Table>
          )}

          {(notes.data?.total ?? 0) > 20 && (
            <div className='flex items-center justify-between'>
              <span className='text-xs text-muted-foreground'>
                第 {notes.data?.page ?? 1} 页 · 共 {notes.data?.total ?? 0} 条
              </span>
              <div className='flex gap-2'>
                <Button
                  disabled={(notes.data?.page ?? 1) <= 1}
                  size='sm'
                  variant='outline'
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  上一页
                </Button>
                <Button
                  disabled={rows.length < (notes.data?.pageSize ?? 20)}
                  size='sm'
                  variant='outline'
                  onClick={() => setPage((current) => current + 1)}
                >
                  下一页
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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

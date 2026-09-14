import { useState } from 'react'
import {
  Archive,
  CheckCircle2,
  Download,
  Eye,
  Loader2,
  Pencil,
  ShieldAlert,
  Trash2,
  XCircle,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { DatePicker } from '@/components/date-picker'
import {
  useArchiveDistillNote,
  useDeleteNote,
  useDistillNotes,
  useDistillSkills,
  useDistillStats,
  useExportDistill,
  useReviewNote,
} from '../api/queries'
import { NoteDetailDialog, NoteEditorDialog } from '../components/note-dialogs'
import { PageShell } from '../components/page-shell'
import { SkillPolicyCard } from '../components/skill-policy-card'
import {
  NOTE_DELETE_HINT,
  NOTE_PROVENANCE_LABELS,
  NOTE_SOURCE_LABELS,
  NOTE_STATUS_LABELS,
  NOTE_STATUS_VARIANTS,
  canDeleteNote,
  formatTime,
} from '../format'
import type { KnowledgeNote } from '../types'

const STATUS_FILTERS = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待审核' },
  { value: 'published', label: '已发布' },
  { value: 'rejected', label: '已驳回' },
  { value: 'private', label: '私有草稿' },
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

/** 起止日期按"整段自然日"提交：结束日要含当天 23:59，否则当天创建的条目会被漏掉。 */
function dayBoundary(date: Date, edge: 'start' | 'end'): string {
  const copy = new Date(date)
  if (edge === 'start') copy.setHours(0, 0, 0, 0)
  else copy.setHours(23, 59, 59, 999)
  return copy.toISOString()
}

/**
 * 「沉淀管理」（管理员）：查看 / 审核 / 编辑 / 导出全部账号的沉淀。
 *
 * 审核口径（与需求方确认）：
 *   - 通过 → 生成 source_type='experience' 的知识库文档并标注提报人（幂等，重复通过不重复建文档）；
 *   - 驳回 → 必须填原因，原因会展示给提报人；
 *   - 审核不替代员工：管理员不能把员工的私有草稿直接改成已发布，必须先由员工提交审核。
 *
 * 注意：本页可见员工的私有沉淀，但**问答检索不会**用到它们（检索只走公共知识库）。
 */
export function DistillManagement() {
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState(STATUS_FILTERS[1].value)
  const [account, setAccount] = useState('all')
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined)
  const [toDate, setToDate] = useState<Date | undefined>(undefined)
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<KnowledgeNote | null>(null)
  const [editing, setEditing] = useState<KnowledgeNote | null>(null)
  const [reviewing, setReviewing] = useState<{
    note: KnowledgeNote
    decision: 'approve' | 'reject'
  } | null>(null)
  const [comment, setComment] = useState('')
  const [pendingDelete, setPendingDelete] = useState<KnowledgeNote | null>(null)

  /**
   * 列表与导出**共用**这一组筛选参数（服务端也用同一个解析函数）。
   * 分成两套写法迟早会出现"看到的和导出的不一致"，而那种问题最难被发现。
   */
  const filters = {
    userId: account === 'all' ? undefined : Number(account),
    status: status === 'all' ? undefined : status,
    keyword: keyword.trim() || undefined,
    from: fromDate ? dayBoundary(fromDate, 'start') : undefined,
    to: toDate ? dayBoundary(toDate, 'end') : undefined,
  }

  const stats = useDistillStats()
  const skills = useDistillSkills()
  const notes = useDistillNotes({ page, pageSize: 20, ...filters })
  const review = useReviewNote()
  const archive = useArchiveDistillNote()
  const remove = useDeleteNote()
  const exportNotes = useExportDistill()

  const rows = notes.data?.rows ?? []
  const fields = skills.data?.skill.fieldSchema ?? []
  const hasDateFilter = Boolean(fromDate || toDate)

  const runExport = (format: 'csv' | 'md' | 'json') => {
    exportNotes.mutate(
      { format, params: filters },
      {
        onSuccess: ({ text, truncated }) => {
          const mime =
            format === 'csv'
              ? 'text/csv'
              : format === 'md'
                ? 'text/markdown'
                : 'application/json'
          downloadText(`全站知识沉淀-${Date.now()}.${format}`, text, mime)
          toast.success(
            truncated
              ? '导出完成，但条数已达上限（2000 条），请缩小筛选范围后重新导出（导出动作已写入审计）'
              : '导出完成（与当前列表筛选一致，导出动作已写入审计）'
          )
        },
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : '导出失败，请稍后重试'
          ),
      }
    )
  }

  const submitReview = () => {
    if (!reviewing) return
    if (reviewing.decision === 'reject' && !comment.trim()) {
      toast.error('驳回必须填写原因')
      return
    }
    review.mutate(
      {
        id: reviewing.note.id,
        decision: reviewing.decision,
        comment: comment.trim() || undefined,
      },
      {
        onSuccess: (result) => {
          toast.success(
            reviewing.decision === 'approve'
              ? `已通过，已生成知识库文档 #${result.documentId ?? '—'} 并标注提报人`
              : '已驳回，原因已记录给提报人'
          )
          setReviewing(null)
          setComment('')
        },
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : '审核失败，请稍后重试'
          ),
      }
    )
  }

  return (
    <PageShell
    >
      <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
        {[
          {
            label: '沉淀总数',
            value: stats.data?.total ?? 0,
            hint: '全部账号',
          },
          {
            label: '待审核',
            value: stats.data?.pending ?? 0,
            hint: '需要管理员处理',
          },
          {
            label: '已发布',
            value: stats.data?.published ?? 0,
            hint: '已进入公司知识库',
          },
          {
            label: '参与账号',
            value: stats.data?.accounts ?? 0,
            hint: '有沉淀的账号数',
          },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className='pt-4'>
              <p className='text-sm text-muted-foreground'>{item.label}</p>
              <p className='text-2xl font-bold'>{item.value}</p>
              <p className='text-xs text-muted-foreground'>{item.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {skills.data && (
        <SkillPolicyCard
          accounts={skills.data.accounts}
          byAccount={stats.data?.byAccount ?? []}
          key={
            String(skills.data.skill.version) +
            String(skills.data.accounts.length)
          }
          skill={skills.data.skill}
          onFilterAccount={(userId) => {
            setAccount(String(userId))
            setPage(1)
          }}
        />
      )}

      <Card>
        <CardHeader className='gap-1'>
          <CardTitle className='text-base'>沉淀条目</CardTitle>
          <CardDescription>
            共 {notes.data?.total ?? 0} 条 ·
            审核通过会生成带提报人的「员工经验」文档
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <Input
              aria-label='搜索全部沉淀'
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
            <Select
              value={account}
              onValueChange={(value) => {
                setAccount(value)
                setPage(1)
              }}
            >
              <SelectTrigger aria-label='按账号筛选' className='w-44'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部账号</SelectItem>
                {(stats.data?.byAccount ?? []).map((item) => (
                  <SelectItem key={item.userId} value={String(item.userId)}>
                    {item.name || item.login}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className='gap-2'
                  disabled={exportNotes.isPending}
                  variant='outline'
                >
                  {exportNotes.isPending ? (
                    <Loader2 className='size-4 animate-spin' />
                  ) : (
                    <Download className='size-4' />
                  )}
                  导出（按当前筛选）
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem onClick={() => runExport('csv')}>
                  导出 CSV（含账号、字段、原文依据、来源可信度）
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => runExport('md')}>
                  导出合并 Markdown（带 frontmatter，可再入库）
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => runExport('json')}>
                  导出 JSON（完整结构化备份）
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            <span className='text-sm text-muted-foreground'>创建时间</span>
            <DatePicker
              selected={fromDate}
              onSelect={(date) => {
                setFromDate(date)
                setPage(1)
              }}
              placeholder='开始日期'
            />
            <span className='text-sm text-muted-foreground'>至</span>
            <DatePicker
              selected={toDate}
              onSelect={(date) => {
                setToDate(date)
                setPage(1)
              }}
              placeholder='结束日期'
            />
            {hasDateFilter && (
              <Button
                size='sm'
                variant='ghost'
                onClick={() => {
                  setFromDate(undefined)
                  setToDate(undefined)
                  setPage(1)
                }}
              >
                清空时间
              </Button>
            )}
            <span className='text-xs text-muted-foreground'>
              含起止当天，最长可查 366 天；列表与导出使用同一组筛选条件
            </span>
          </div>

          {notes.isLoading ? (
            <Skeleton className='h-40 w-full' />
          ) : rows.length === 0 ? (
            <p className='rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground'>
              当前筛选条件下没有沉淀条目。
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>标题</TableHead>
                  <TableHead className='w-36'>账号</TableHead>
                  <TableHead className='w-28'>状态</TableHead>
                  <TableHead className='w-32'>来源</TableHead>
                  <TableHead className='w-32'>更新时间</TableHead>
                  <TableHead className='w-64'>操作</TableHead>
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
                          {note.publishedDocumentId && (
                            <span className='text-xs text-muted-foreground'>
                              文档 #{note.publishedDocumentId}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className='text-sm'>
                      {note.ownerName || note.ownerLogin}
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
                          className='gap-1'
                          disabled={
                            note.status !== 'pending' || review.isPending
                          }
                          size='sm'
                          variant='ghost'
                          onClick={() => {
                            setReviewing({ note, decision: 'approve' })
                            setComment('')
                          }}
                        >
                          <CheckCircle2 className='size-4' />
                          通过
                        </Button>
                        <Button
                          className='gap-1'
                          disabled={
                            note.status !== 'pending' || review.isPending
                          }
                          size='sm'
                          variant='ghost'
                          onClick={() => {
                            setReviewing({ note, decision: 'reject' })
                            setComment('')
                          }}
                        >
                          <XCircle className='size-4' />
                          驳回
                        </Button>
                        <Button
                          aria-label='编辑沉淀'
                          disabled={note.status === 'published'}
                          size='sm'
                          variant='ghost'
                          onClick={() => setEditing(note)}
                        >
                          <Pencil className='size-4' />
                        </Button>
                        <Button
                          aria-label='归档沉淀'
                          disabled={note.status === 'archived'}
                          size='sm'
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

      <NoteDetailDialog
        fields={fields}
        note={detail}
        open={Boolean(detail)}
        scope='admin'
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
        onEdit={(note) => {
          setDetail(null)
          setEditing(note)
        }}
      />

      <NoteEditorDialog
        fields={fields}
        note={editing}
        open={Boolean(editing)}
        scope='admin'
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />

      <Dialog
        open={Boolean(reviewing)}
        onOpenChange={(open) => {
          if (!open) {
            setReviewing(null)
            setComment('')
          }
        }}
      >
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <ShieldAlert className='size-4' />
              {reviewing?.decision === 'approve' ? '审核通过' : '驳回沉淀'}
            </DialogTitle>
            <DialogDescription>
              {reviewing?.decision === 'approve'
                ? '通过后这条经验会进入公司知识库，检索命中时标注为「员工经验」并显示提报人。'
                : '驳回必须填写原因，原因会展示给提报人，便于其修改后重新提交。'}
            </DialogDescription>
          </DialogHeader>

          <div className='space-y-3 text-sm'>
            <div className='rounded-md border px-3 py-2'>
              <p className='font-medium'>{reviewing?.note.title}</p>
              <p className='text-xs text-muted-foreground'>
                提报人 {reviewing?.note.ownerName || reviewing?.note.ownerLogin}{' '}
                ·
                {reviewing?.note.provenance === 'inferred'
                  ? ' AI 推断内容'
                  : ' 本人所写'}
              </p>
              {reviewing?.note.evidence && (
                <p className='mt-2 text-xs whitespace-pre-wrap text-muted-foreground'>
                  原文依据：{reviewing.note.evidence}
                </p>
              )}
            </div>
            <div className='space-y-1.5'>
              <Label htmlFor='review-comment'>
                {reviewing?.decision === 'reject'
                  ? '驳回原因（必填）'
                  : '审核备注（选填）'}
              </Label>
              <Textarea
                id='review-comment'
                maxLength={500}
                rows={3}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant='outline' onClick={() => setReviewing(null)}>
              取消
            </Button>
            <Button
              className='gap-2'
              disabled={review.isPending}
              variant={
                reviewing?.decision === 'reject' ? 'destructive' : 'default'
              }
              onClick={submitReview}
            >
              {review.isPending && <Loader2 className='size-4 animate-spin' />}
              {reviewing?.decision === 'approve' ? '确认通过' : '确认驳回'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        desc={`删除后该沉淀不再出现在列表与导出中（保留审计记录）。已发布条目不能删除，需先归档以下线对应的公共文档：${pendingDelete?.title ?? ''}`}
        destructive
        open={Boolean(pendingDelete)}
        title='删除沉淀'
        confirmText='删除'
        handleConfirm={() => {
          if (!pendingDelete) return
          remove.mutate(
            { id: pendingDelete.id, scope: 'admin' },
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

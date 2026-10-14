import { useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  Loader2,
  MoreHorizontal,
  Pencil,
  ShieldAlert,
  Trash2,
  XCircle,
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
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
import { TableCell, TableHead, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTable } from '@/components/data-table'
import { DatePicker } from '@/components/date-picker'
import {
  useArchiveDistillNote,
  useBatchDistillNotes,
  useDeleteNote,
  useDistillNotes,
  useDistillPrompts,
  useDistillSkills,
  useDistillStats,
  useExportDistill,
  useReviewNote,
} from '../api/queries'
import { MetricStrip } from '../components/metric-strip'
import { NoteDetailDialog, NoteEditorDialog } from '../components/note-dialogs'
import { PageShell } from '../components/page-shell'
import {
  PromptReviewCard,
  REVIEW_PAGE_SIZE,
} from '../components/prompt-review-card'
import { SkillPolicyCard } from '../components/skill-policy-card'
import {
  NOTE_DELETE_HINT,
  NOTE_PROVENANCE_LABELS,
  NOTE_SOURCE_LABELS,
  NOTE_STATUS_LABELS,
  NOTE_STATUS_VARIANTS,
  canArchiveNote,
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

/** 空选择集常量：派生时复用同一引用，避免每次渲染都新建 Set。 */
const EMPTY_SELECTION: ReadonlySet<number> = new Set<number>()

/**
 * 页内三个子视图：**一次只渲染一个**。
 *
 * 改前「提示词审核」与「沉淀条目」是纵向叠加的两张 20 行表格（各有表头、分页器与筛选控件），
 * 而两侧的筛选控件语义几乎相同（都叫「按状态筛选」），管理员很容易在错误的队列里
 * 输入关键词、得出"没有结果"的错误结论；「技能治理」则游离在两者之外、只能靠滚动发现。
 * 现在三个职责的入口形态统一：同一排选项卡，切换即达，同一时刻只有一个在场。
 *
 * 默认落在「提示词审核」：它改动的是"全员对话里能 @ 到什么"，误通过一次就推给所有人，
 * 紧迫性最高；且与改前的渲染顺序（提示词卡片在沉淀卡片之前）一致，不改变既有的进入习惯。
 */
const QUEUES = {
  prompts: { label: '提示词审核' },
  notes: { label: '沉淀条目' },
  skill: { label: '技能治理' },
} as const

type QueueKey = keyof typeof QUEUES

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
 * 界面上展示的日期用本地短格式（如 `2026-01-01`）。
 *
 * 不要再退回 `dayBoundary()` 的 `toISOString()`：那串 `2026-01-01T00:00:00.000Z`
 * 既长又含 UTC 偏移（东八区的 `00:00` 本地时间在串上显示成前一天），
 * 折叠行里的"已生效范围"反而比不写更难读。取本地年月日，与用户选择的日期逐字一致。
 */
function formatDay(date: Date | undefined): string | null {
  if (!date) return null
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 「经验审核」（管理员）：查看 / 审核 / 编辑 / 导出全部账号的沉淀与提示词。
 *
 * 审核口径（与需求方确认）：
 *   - 通过 → 生成 source_type='experience' 的知识库文档并标注提报人（幂等，重复通过不重复建文档）；
 *   - 驳回 → 必须填原因，原因会展示给提报人；
 *   - 审核不替代员工：管理员不能把员工的私有草稿直接改成已发布，必须先由员工提交审核。
 *
 * 注意：本页可见员工的私有沉淀，但**问答检索不会**用到它们（检索只走公共知识库）。
 */
export function DistillManagement() {
  /*
   * 子视图由 URL 的 `?queue=` 驱动，不再用局部 state：顶栏待办按钮要能"跳到沉淀待审核"
   * 并直达「沉淀条目」，而组件内的 useState 无法被外部跳转设置。改成 URL 唯一真相源后，
   * 跳转、刷新、分享链接三者一致；切换子视图用 `replace`，避免每切一次就往历史里塞一条
   * （否则返回键要按很多次才回得来）。
   */
  const { queue: queueParam } = useSearch({
    from: '/_authenticated/admin/ai/distill',
  })
  const navigate = useNavigate()
  const queue: QueueKey = queueParam ?? 'prompts'
  const setQueue = (next: QueueKey) => {
    void navigate({
      to: '/admin/ai/distill',
      search: next === 'prompts' ? {} : { queue: next },
      replace: true,
    })
  }
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
  const [pageSize, setPageSize] = useState(20)
  const [batchAction, setBatchAction] = useState<'archive' | 'delete' | null>(
    null
  )
  /**
   * 日期范围默认折叠：审核队列的日常动作是"看待审核"，按时间圈定是低频筛选，
   * 常显时它单独占一行（两个日期框 + 说明文案），把表格又往下推了 40px。
   */
  const [dateFilterOpen, setDateFilterOpen] = useState(false)

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
  const notes = useDistillNotes({ page, pageSize, ...filters })
  const review = useReviewNote()
  const archive = useArchiveDistillNote()
  const remove = useDeleteNote()
  const batch = useBatchDistillNotes()
  const exportNotes = useExportDistill()

  /**
   * 提示词队列的**待审计数**在这里取一次。
   *
   * 它与 `PromptReviewCard` 的列表查询参数逐字一致（同一 query key），
   * 因此 React Query 只会真正发一次请求，两边共享同一份数据 —— 选项卡角标、
   * 指标条与卡片标题上的角标不可能出现三个不同的数字。
   */
  const promptPending = useDistillPrompts({
    status: 'pending',
    keyword: undefined,
    page: 1,
    pageSize: REVIEW_PAGE_SIZE,
  })

  const rows = notes.data?.rows ?? []
  const fields = skills.data?.skill.fieldSchema ?? []
  const hasDateFilter = Boolean(fromDate || toDate)

  /**
   * 多选状态绑定在"当前筛选 + 页码"这个键上：键一变，选择自动视为空。
   * 与知识库页同一套做法 —— 翻页后保留选择，批量操作会作用到已看不见的行。
   */
  const selectionKey = [
    page,
    pageSize,
    keyword,
    status,
    account,
    fromDate?.toISOString() ?? '',
    toDate?.toISOString() ?? '',
  ].join('|')
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

  const selectedNotes = rows.filter((note) => selectedIds.has(note.id))
  const allSelected =
    rows.length > 0 && rows.every((note) => selectedIds.has(note.id))
  const partiallySelected = rows.some((note) => selectedIds.has(note.id))
  const canArchiveSelected = selectedNotes.some((note) =>
    canArchiveNote(note, 'admin')
  )
  const canDeleteSelected = selectedNotes.some((note) => canDeleteNote(note))

  const toggleAllOnPage = (checked: boolean) => {
    updateSelection((previous) => {
      const next = new Set(previous)
      for (const note of rows) {
        if (checked) next.add(note.id)
        else next.delete(note.id)
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

  /**
   * 批量归档 / 批量删除。
   *
   * 部分失败必须逐条解释：已发布条目不能删除、已归档条目不能再归档，
   * 只回一句"批量失败"等于让管理员自己去猜哪几条没生效。
   */
  const runBatch = (action: 'archive' | 'delete') => {
    if (selectedIds.size === 0) return
    batch.mutate(
      { action, ids: [...selectedIds] },
      {
        onSuccess: (result) => {
          const label = action === 'archive' ? '归档' : '删除'
          const firstFailure = result.results.find((item) => !item.ok)
          if (result.failed === 0) {
            toast.success(`已${label} ${result.succeeded} 条沉淀`)
          } else {
            toast.warning(
              `已${label} ${result.succeeded} 条，${result.failed} 条未处理：${
                firstFailure?.message ?? '原因未知'
              }`
            )
          }
          clearSelection()
        },
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : '批量操作失败，请稍后重试'
          ),
      }
    )
  }

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
          /**
           * 只有一处说"同一口径"（见筛选区的时间提示），这里只交代导出结果本身。
           * 导出动作本身必须写审计，这一点要在提示里如实说明。
           */
          toast.success(
            truncated
              ? '导出完成，但条数已达上限（2000 条），请缩小筛选范围后重新导出（导出动作已写入审计）'
              : '导出完成（导出动作已写入审计）'
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
    <PageShell>
      {/*
        三个子视图用选项卡切换，**一次只渲染一个**（2026-10-14）：
        改前提示词队列（有待审即默认展开）与沉淀表同屏叠加，最坏情况是两套表头、
        两套分页器、两套语义几乎相同的筛选控件同时在场 —— 在错误的队列里输入关键词，
        用户会得到"没有结果"的错误结论；技能治理则游离在选项卡之外，只能靠滚动发现。
        指标条放在 Tabs **内部**（与审计台同一结构）：改前它只统计沉淀，却渲染在整页最上方，
        看起来像全页概览；现在每个子视图各带自己的口径，切换选项卡时指标一起换
        （技能治理视图不摆指标条 —— 卡片自身已经给出全局开关与账号启用情况）。

        选项卡顺序即默认顺序：默认落在「提示词审核」（见 QUEUES 的注释）。
      */}
      <Tabs
        value={queue}
        onValueChange={(value) => setQueue(value as QueueKey)}
      >
        <TabsList>
          {(Object.keys(QUEUES) as QueueKey[]).map((key) => (
            <TabsTrigger className='gap-1.5' key={key} value={key}>
              {QUEUES[key].label}
              {/*
                待审计数常显在选项卡上：子视图切换后，"还有多少条待办"不能
                因为另一个队列被隐藏而跟着消失（改前它是折叠行右侧的角标）。
              */}
              {key === 'prompts' &&
                (promptPending.data?.pendingTotal ?? 0) > 0 && (
                  <Badge className='font-normal' variant='default'>
                    {promptPending.data?.pendingTotal}
                  </Badge>
                )}
              {/*
                技能被全局停用时在选项卡上标出来：它现在住在子视图里，
                而"技能停用"是会直接影响全站问答的状态，不能藏到点进去才知道。
              */}
              {key === 'skill' && skills.data && !skills.data.skill.enabled && (
                <Badge className='font-normal' variant='destructive'>
                  已停用
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent className='space-y-3' value='prompts'>
          <MetricStrip
            items={[
              {
                label: '待审核',
                value: promptPending.isLoading
                  ? null
                  : (promptPending.data?.pendingTotal ?? 0),
                hint: '提示词 · 通过后全员可在对话中 @ 引用',
              },
            ]}
          />
          <PromptReviewCard
            pendingTotal={promptPending.data?.pendingTotal ?? 0}
          />
        </TabsContent>

        <TabsContent className='space-y-3' value='notes'>
          <MetricStrip
            items={[
              {
                label: '沉淀总数',
                value: stats.isLoading ? null : (stats.data?.total ?? 0),
                hint: '全部账号',
              },
              {
                label: '待审核',
                value: stats.isLoading ? null : (stats.data?.pending ?? 0),
                hint: '需要管理员处理',
              },
              {
                label: '已发布',
                value: stats.isLoading ? null : (stats.data?.published ?? 0),
                hint: '已进入公司知识库',
              },
              {
                label: '参与账号',
                value: stats.isLoading ? null : (stats.data?.accounts ?? 0),
                hint: '有沉淀的账号数',
              },
            ]}
          />
          <Card>
            <CardHeader className='gap-1'>
              {/* 口径说明并到标题行：卡片头因此少一行，表格再往上提约 20px */}
              <CardTitle className='flex flex-wrap items-center gap-2 text-base'>
                沉淀条目
                <span className='text-xs font-normal text-muted-foreground'>
                  共 {notes.data?.total ?? 0} 条 ·
                  通过后生成带提报人的「员工经验」文档
                </span>
              </CardTitle>
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
                  {/* 与提示词队列的筛选区分开：两处同叫「按状态筛选」正是误操作的来源 */}
                  <SelectTrigger aria-label='按状态筛选沉淀' className='w-36'>
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
                      导出
                    </Button>
                  </DropdownMenuTrigger>
                  {/* 菜单只给格式名，格式差异放 title：原来三行长句合计 74 字，读起来比选项本身还费劲 */}
                  <DropdownMenuContent align='end'>
                    <DropdownMenuItem
                      onClick={() => runExport('csv')}
                      title='含账号、字段、原文依据与来源可信度，便于在表格软件里核对'
                    >
                      导出 CSV
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => runExport('md')}
                      title='带 frontmatter 的合并 Markdown，可再入库'
                    >
                      导出 Markdown
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => runExport('json')}
                      title='完整结构化备份，适合程序处理'
                    >
                      导出 JSON
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <Collapsible
                open={dateFilterOpen}
                onOpenChange={setDateFilterOpen}
              >
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
                          dateFilterOpen && 'rotate-180'
                        )}
                      />
                      按创建时间筛选
                    </Button>
                  </CollapsibleTrigger>
                  {/* 折叠不隐藏状态：已生效的时间范围在折叠行里如实说明（本地短日期，不是 ISO 串） */}
                  <span className='text-xs text-muted-foreground'>
                    {hasDateFilter
                      ? `已筛选 ${formatDay(fromDate) ?? '不限'} ~ ${formatDay(toDate) ?? '不限'}`
                      : '未按时间筛选'}
                  </span>
                </div>
                <CollapsibleContent className='pt-2'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='text-sm text-muted-foreground'>
                      创建时间
                    </span>
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
                </CollapsibleContent>
              </Collapsible>

              <DataTable
                columns={7}
                density='compact'
                emptyText='当前筛选条件下没有沉淀条目。'
                header={
                  <TableRow>
                    <TableHead className='w-10'>
                      <Checkbox
                        aria-label='全选本页沉淀'
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
                    <TableHead>标题</TableHead>
                    <TableHead className='w-36'>账号</TableHead>
                    <TableHead className='w-28'>状态</TableHead>
                    <TableHead className='w-32'>来源</TableHead>
                    <TableHead className='w-32'>更新时间</TableHead>
                    <TableHead className={cn('w-48', TABLE_HEAD_ACTIONS)}>
                      操作
                    </TableHead>
                  </TableRow>
                }
                isEmpty={rows.length === 0}
                isError={notes.isError}
                isLoading={notes.isLoading}
                pagination={
                  notes.data
                    ? {
                        disabled: notes.isFetching,
                        page: notes.data.page,
                        pageSize: notes.data.pageSize,
                        total: notes.data.total,
                        onPageChange: setPage,
                        onPageSizeChange: (size) => {
                          setPageSize(size)
                          setPage(1)
                        },
                      }
                    : undefined
                }
              >
                {rows.map((note) => (
                  <TableRow
                    data-state={
                      selectedIds.has(note.id) ? 'selected' : undefined
                    }
                    key={note.id}
                  >
                    <TableCell>
                      <Checkbox
                        aria-label={`选择沉淀 ${note.title}`}
                        checked={selectedIds.has(note.id)}
                        onCheckedChange={(checked) =>
                          toggleOne(note.id, checked === true)
                        }
                      />
                    </TableCell>
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
                    <TableCell className={TABLE_CELL_META}>
                      {NOTE_SOURCE_LABELS[note.sourceKind] ?? note.sourceKind}
                      <span className='block text-xs'>
                        {NOTE_PROVENANCE_LABELS[note.provenance] ??
                          note.provenance}
                      </span>
                    </TableCell>
                    <TableCell className={TABLE_CELL_META}>
                      {formatTime(note.updatedAt)}
                    </TableCell>
                    <TableCell className={TABLE_CELL_ACTIONS}>
                      {/*
                        操作列此前 6 个按钮（查看/通过/驳回/编辑/归档/删除）在 w-64 里折成两行。
                        现在只把"审核结论"留在明面 —— 通过 / 驳回是本页唯一的高频动作，
                        且它们的可用性取决于当前状态；其余四个动作收进「更多」菜单，
                        权限与服务端校验完全不变（禁用条件逐项保留）。
                      */}
                      <div className='flex items-center justify-end gap-0.5'>
                        <Button
                          className='h-8 gap-1 px-2 text-xs'
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
                          <CheckCircle2 className='size-3.5' />
                          通过
                        </Button>
                        <Button
                          className='h-8 gap-1 px-2 text-xs'
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
                          <XCircle className='size-3.5' />
                          驳回
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              aria-label='更多沉淀操作'
                              className='size-8'
                              size='icon'
                              title='更多操作（查看 / 编辑 / 归档 / 删除）'
                              variant='ghost'
                            >
                              <MoreHorizontal className='size-4' />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end'>
                            <DropdownMenuItem onSelect={() => setDetail(note)}>
                              <Eye />
                              查看详情
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={note.status === 'published'}
                              onSelect={() => setEditing(note)}
                            >
                              <Pencil />
                              编辑
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={note.status === 'archived'}
                              onSelect={() =>
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
                              <Archive />
                              归档
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className='text-destructive'
                              disabled={!canDeleteNote(note)}
                              title={
                                canDeleteNote(note)
                                  ? undefined
                                  : NOTE_DELETE_HINT
                              }
                              onSelect={() => setPendingDelete(note)}
                            >
                              <Trash2 />
                              删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </CardContent>
          </Card>
        </TabsContent>

        {/*
          技能治理也作为**同级子视图**（2026-10-14，按用户口径：「技能治理也像提示词审核、
          沉淀条目一样可切换，而不是单独把技能治理给它拆出来」）。
          改前它是 `</Tabs>` 之外的一张独立卡片，只能靠滚动发现，与另外两个职责的入口形态
          不一致；现在三个入口统一在同一排选项卡上。卡片自身的折叠形态与"折叠行常显参数摘要"
          完全保留（`skill-policy-card.tsx` 一行未改）。
        */}
        <TabsContent value='skill'>
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
                /*
                 * 点击"按账号统计"要落到沉淀列表：它住在另一个子视图里，
                 * 不切过去的话，筛选生效了却看不到任何变化。
                 */
                setQueue('notes')
                setAccount(String(userId))
                setPage(1)
              }}
            />
          )}
        </TabsContent>
      </Tabs>

      {/*
        批量工具条：**不再放进 `DataTable` 的 toolbar 插槽**。
        那个插槽在表格上方占真实文档流，勾选第一行时整张表（表头 + 20 行）会向下跳 40px；
        取消选择又跳回去，连续勾选时页面一直在抖。现在它固定悬浮在视口底部：
        既不占用文档流（表格位置恒定），也不会随着长列表滚动跑出视野
        （`sticky bottom-0` 在这里做不到 —— 滚动容器在 `PageShell` 上而不是表格附近）。
      */}
      {selectedIds.size > 0 && (
        <div className='fixed right-6 bottom-4 z-40 flex max-w-[calc(100vw-3rem)] flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-card px-3 py-2 shadow-lg'>
          <span className='text-sm'>
            已选 <strong>{selectedIds.size}</strong> 条沉淀
          </span>
          <Button
            className='gap-1.5'
            disabled={batch.isPending || !canArchiveSelected}
            size='sm'
            variant='outline'
            onClick={() => setBatchAction('archive')}
          >
            <Archive className='size-3.5' />
            批量归档
          </Button>
          <Button
            className='gap-1.5 text-destructive'
            disabled={batch.isPending || !canDeleteSelected}
            size='sm'
            variant='outline'
            onClick={() => setBatchAction('delete')}
          >
            <Trash2 className='size-3.5' />
            批量删除
          </Button>
          <Button size='sm' variant='ghost' onClick={clearSelection}>
            取消选择
          </Button>
        </div>
      )}

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
        {/*
          `max-h-[90vh] overflow-y-auto` 是必须的兜底（与 note-dialogs 同一口径）：
          `evidence` 最长 500 字，长文条目的弹窗会把「驳回原因」与「确认」按钮推出视口，
          审核人只能靠键盘 Tab 盲找按钮。
        */}
        <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-lg'>
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

      {/*
        批量确认：归档已发布条目会同时下线它生成的公共知识库文档，
        删除则是软删且不可恢复，两者都需要在动手前把影响说清楚。
      */}
      <ConfirmDialog
        confirmText={batchAction === 'delete' ? '删除' : '归档'}
        desc={
          batchAction === 'delete'
            ? `删除后这 ${selectedIds.size} 条沉淀不再出现在列表与导出中（保留审计记录）。已发布条目不能删除，会逐条提示原因。`
            : `归档后这 ${selectedIds.size} 条沉淀退出审核队列；其中已发布条目会同时下线它生成的公共知识库文档，不再被问答引用。`
        }
        destructive={batchAction === 'delete'}
        isLoading={batch.isPending}
        open={batchAction !== null}
        title={batchAction === 'delete' ? '批量删除沉淀' : '批量归档沉淀'}
        onOpenChange={(open) => {
          if (!open) setBatchAction(null)
        }}
        handleConfirm={() => {
          if (batchAction) runBatch(batchAction)
          setBatchAction(null)
        }}
      />
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

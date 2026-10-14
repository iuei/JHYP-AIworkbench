import { useState, type ReactNode } from 'react'
import { useSearch } from '@tanstack/react-router'
import {
  type LucideIcon,
  Globe2,
  Pencil,
  Plus,
  Search,
  Send,
  SquareLibrary,
  Trash2,
  Undo2,
  X,
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
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { TableCell, TableHead, TableRow } from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTable, type DataTablePagination } from '@/components/data-table'
import { TablePagination } from '@/components/table-pagination'
import {
  useDeletePrompt,
  usePrompts,
  useSubmitPrompt,
  useWithdrawPrompt,
} from '../api/queries'
import { LayoutToggle } from '../components/layout-toggle'
import {
  CARD_GRID,
  useListLayout,
  type ListLayout,
} from '../components/list-layout'
import { PageShell } from '../components/page-shell'
import {
  PromptDetailDialog,
  PromptEditorDialog,
} from '../components/prompt-dialogs'
import { RowAction } from '../components/row-action'
import {
  PROMPT_STATUS_LABELS,
  PROMPT_STATUS_VARIANTS,
  apiErrorMessage,
  canSubmitPrompt,
  canWithdrawPrompt,
  formatTime,
} from '../format'
import type { AiPrompt } from '../types'

/** 提示词卡片较高（一张卡 36 高度单位），每页 20 张已能铺满两屏以上。 */
const DEFAULT_PAGE_SIZE = 20

/**
 * 展示方式：卡片网格（默认）或数据表格。
 *
 * 2026-09-17 按用户口径「提示词广场使用卡片展示」把默认改回卡片：
 * 一条提示词要读的就是 名称 / 创建人 / 使用次数 / 正文 这四件事，
 * 卡片能在同一屏里把它们一起摆开，表格则把每条压成一行、正文必须再点一次「展开全文」。
 * 表格**保留为可切换视图**（2026-09-16 的"内容优先用数据表格"并未作废：
 * 需要按 状态 / 更新于 / 使用次数 横向比对时，表格一眼扫完），不是要删掉的实现。
 *
 * 2026-09-18：`ListLayout` / `CARD_GRID` / `LayoutToggle` / 偏好读写抽到
 * `components/list-layout.tsx`（知识库的两个子页也要同一套读法），本文件只留自己的偏好键。
 *
 * 键名**带版本号**：默认读法由表格改为卡片后，旧键 `prompt-square-layout` 里可能存着
 * "上一版默认（表格）之下的选择"，继续读旧键会让用户的浏览器停在已废弃的默认上，
 * 看起来像那轮改动没生效。新键让新默认对所有人生效，用户重新选择后同样会被记住。
 */
const LAYOUT_STORAGE_KEY = 'prompt-square-layout:v2'

/** 表格列数：名称 / 说明 / 标签 / 状态 / 作者 / 更新于 / 使用 / 操作。 */
const PROMPT_TABLE_COLUMNS = 8

/**
 * 提示词广场：把反复输入的提问沉淀成可复用模板。
 *
 * **两个子页**（「共享提示词」｜「我的提示词」）由顶栏的 `PromptSquareNav` 承载，
 * 本页按 search 参数 `view` 只渲染当前那一个 —— 两块的取数范围完全不同，
 * 纵向堆叠会让用户一路下滚才看到"同事共享的那块"，而它才是本页的公共资产。
 * 分工必须说清楚，否则用户会以为"我共享的那条怎么没出现在共享区"：
 * - 「共享提示词」= **其他同事**共享出来的，自己的另一个子页里，不重复展示；
 * - 「我的提示词」= 自己的全部条目（含待审、已驳回、已共享，用徽标区分状态）。
 *
 * **默认子页 = 共享提示词（2026-10-14）**：按用户口径"点击提示词广场时默认页面从我的提示词
 * 改为共享提示词页面"，`view` 缺省即共享池（对应路由 `prompts/index.tsx` 只认 `view=mine`）。
 *
 * 搜索走服务端（与 /ai/conversations 同一考虑）：本地过滤在条目变多后会
 * 出现"明明有却搜不到"。搜索词只对当前子页生效（切子页时保留，便于对比着找）。
 */
export function PromptSquare() {
  // 页面已迁到 /prompts（2026-09-16 阶段 C：一级类目不再住在二级路径里）
  const { view } = useSearch({ from: '/_authenticated/prompts/' })
  const current = view ?? 'shared'
  const [keyword, setKeyword] = useState('')
  const debouncedKeyword = useDebouncedValue(keyword)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AiPrompt | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AiPrompt | null>(null)
  /**
   * 正在看详情的条目（null = 弹窗关着）。
   *
   * 2026-09-17 起"展开全文"不再是**把卡片拉长**（`expandedId` 那个概念已删除），
   * 而是打开只读的 `PromptDetailDialog`；卡片视图与表格视图共用这一个状态。
   */
  const [detailPrompt, setDetailPrompt] = useState<AiPrompt | null>(null)
  // 两个子页各自记页码：切到另一个子页再切回来时，用户应该回到原来的位置
  const [minePage, setMinePage] = useState(1)
  const [sharedPage, setSharedPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  // 展示方式与偏好持久化由 `useListLayout` 统一负责（知识库两个子页用的是同一套）
  const [layout, setLayout] = useListLayout(LAYOUT_STORAGE_KEY)

  /**
   * 切换展示方式。
   *
   * 顺手关掉详情弹窗：它是模态浮层，留在屏幕上会挡住刚切过去的那份列表，
   * 用户还得先关它才能继续看。
   */
  function handleLayoutChange(next: ListLayout) {
    setLayout(next)
    setDetailPrompt(null)
  }

  const search = debouncedKeyword.trim() || undefined

  /**
   * 搜索词与页码必须一起改：只改关键词不回到第 1 页，会停在"第 5 页 + 3 条结果"上，
   * 看起来像搜索没生效。
   */
  function handleKeywordChange(value: string) {
    setKeyword(value)
    setMinePage(1)
    setSharedPage(1)
  }

  /** 切换每页条数同样要回到第 1 页（否则可能落在空页上）。 */
  function handlePageSizeChange(size: number) {
    setPageSize(size)
    setMinePage(1)
    setSharedPage(1)
  }
  // 只拉当前子页的数据：另一个子页的列表在这里用不到，白拉一次是纯浪费
  const mine = usePrompts({
    scope: 'mine',
    keyword: search,
    page: minePage,
    pageSize,
    enabled: current === 'mine',
  })
  // 共享池是全公司累积的、没有总量上限（个人库才有 200 条上限），因此必须服务端分页
  const shared = usePrompts({
    scope: 'published',
    keyword: search,
    page: sharedPage,
    pageSize,
    enabled: current === 'shared',
  })
  const submit = useSubmitPrompt()
  const withdraw = useWithdrawPrompt()
  const remove = useDeletePrompt()

  const sharedByOthers = (shared.data?.prompts ?? []).filter(
    (prompt) => !prompt.isOwner
  )
  const mineCount = mine.data?.total ?? 0
  // 共享池的 total 含"你自己共享的"，与卡片上的"同事共享"口径略有出入，
  // 但它是唯一能反映"还有多少条没翻到"的数字（用当前页过滤后的长度会随页码跳动）
  const sharedCount = shared.data?.total ?? 0
  const searching = Boolean(search)

  const openCreate = () => {
    setEditing(null)
    setEditorOpen(true)
  }

  const openEdit = (prompt: AiPrompt) => {
    setEditing(prompt)
    setEditorOpen(true)
  }

  /*
   * 三个共用动作抽成函数：表格视图与卡片视图都要用同一套回调 ——
   * 内联在两处写法必然会漂移（"卡片里提报成功了、表格里漏了 toast"这种）。
   */
  const submitPrompt = (prompt: AiPrompt) =>
    submit.mutate(prompt.id, {
      onSuccess: () => toast.success('已提报，等待管理员审核'),
      onError: (error) => toast.error(apiErrorMessage(error, '提报失败')),
    })

  const withdrawPrompt = (prompt: AiPrompt) =>
    withdraw.mutate(prompt.id, {
      onSuccess: () => toast.success('已撤回，可修改后重新提报'),
      onError: (error) => toast.error(apiErrorMessage(error, '撤回失败')),
    })

  /**
   * 打开详情弹窗。卡片整卡点击、卡片上的「查看全文」、表格操作列的「查看全文」
   * 三条路径共用它，行为不可能漂移。
   */
  const openDetail = (prompt: AiPrompt) => setDetailPrompt(prompt)

  return (
    <PageShell>
      {/* 工具栏在两个子页间共用：搜索与新建与"看哪一份"无关 */}
      <div className='flex flex-wrap items-center gap-2'>
        <div className='relative min-w-[220px] flex-1'>
          <Search
            aria-hidden
            className='pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
          />
          <Input
            aria-label='搜索提示词'
            className='ps-9'
            placeholder='搜索名称、说明或正文'
            value={keyword}
            onChange={(event) => handleKeywordChange(event.target.value)}
          />
        </div>
        <LayoutToggle layout={layout} onLayoutChange={handleLayoutChange} />
        <Button className='gap-2' onClick={openCreate}>
          <Plus className='size-4' />
          新建提示词
        </Button>
      </div>

      {current === 'mine' ? (
        <section className='space-y-3'>
          <p className='text-xs text-muted-foreground'>
            只有你自己可以用，对话里输入 @
            可调出；提报共享后由管理员审核，通过后全员可用。
            {mineCount > 0 && (
              <span className='ms-1'>
                {searching ? `找到 ${mineCount} 条。` : `共 ${mineCount} 条。`}
              </span>
            )}
          </p>

          {mine.isLoading ? (
            // 骨架屏与真实布局同构：加载完成时不会因为列数/行数变化而跳动
            layout === 'table' ? (
              <PromptTableSkeleton />
            ) : (
              <div className={CARD_GRID}>
                <Skeleton className='h-36 w-full' />
                <Skeleton className='h-36 w-full' />
                <Skeleton className='h-36 w-full' />
              </div>
            )
          ) : mineCount === 0 ? (
            // 空态给三件套（图标 + 一句话 + 出口）：原来只有一行灰字，用户不知道该干什么
            <EmptyState
              description={
                searching
                  ? '换个关键词试试，或清空搜索看全部。'
                  : '把反复要输入的那段提问存下来，对话里输入 @ 就能调出。'
              }
              icon={SquareLibrary}
              title={searching ? '没有匹配的提示词' : '还没有提示词'}
              action={
                searching ? (
                  <Button
                    className='gap-2'
                    size='sm'
                    variant='outline'
                    onClick={() => handleKeywordChange('')}
                  >
                    <X className='size-4' />
                    清空搜索
                  </Button>
                ) : (
                  <Button className='gap-2' size='sm' onClick={openCreate}>
                    <Plus className='size-4' />
                    新建第一条
                  </Button>
                )
              }
            />
          ) : layout === 'table' ? (
            <PromptTable
              editable
              emptyText='没有匹配的提示词。'
              pagination={{
                disabled: mine.isFetching,
                page: mine.data?.page ?? minePage,
                pageSize: mine.data?.pageSize ?? pageSize,
                total: mineCount,
                onPageChange: setMinePage,
                onPageSizeChange: handlePageSizeChange,
              }}
              prompts={mine.data?.prompts ?? []}
              onDelete={setPendingDelete}
              onEdit={openEdit}
              onOpenDetail={openDetail}
              onSubmit={submitPrompt}
              onWithdraw={withdrawPrompt}
            />
          ) : (
            <div className={CARD_GRID}>
              {(mine.data?.prompts ?? []).map((prompt) => (
                <PromptItem
                  key={prompt.id}
                  prompt={prompt}
                  onDelete={() => setPendingDelete(prompt)}
                  onEdit={() => openEdit(prompt)}
                  onOpenDetail={() => openDetail(prompt)}
                  onSubmit={() => submitPrompt(prompt)}
                  onWithdraw={() => withdrawPrompt(prompt)}
                />
              ))}
            </div>
          )}

          {/* 表格视图的分页器由 `DataTable` 内部渲染，这里只在卡片视图补一个 */}
          {layout === 'card' && (
            <TablePagination
              page={mine.data?.page ?? minePage}
              pageSize={mine.data?.pageSize ?? pageSize}
              total={mineCount}
              disabled={mine.isFetching}
              onPageChange={setMinePage}
              onPageSizeChange={handlePageSizeChange}
            />
          )}
        </section>
      ) : (
        <section className='space-y-3'>
          <p className='text-xs text-muted-foreground'>
            同事共享出来的提示词（你自己共享的在「我的提示词」里）。对话里输入 @
            即可调出，或在输入框旁点「提示词」。
            {sharedCount > 0 && (
              <span className='ms-1'>
                {searching
                  ? `找到 ${sharedCount} 条。`
                  : `共 ${sharedCount} 条。`}
              </span>
            )}
          </p>

          {shared.isLoading ? (
            layout === 'table' ? (
              <PromptTableSkeleton />
            ) : (
              <div className={CARD_GRID}>
                <Skeleton className='h-36 w-full' />
                <Skeleton className='h-36 w-full' />
              </div>
            )
          ) : sharedCount === 0 ? (
            <EmptyState
              description={
                searching
                  ? '换个关键词试试，或清空搜索看全部。'
                  : '同事提报的提示词经管理员审核通过后会出现在这里，全员可用。'
              }
              icon={Globe2}
              title={
                searching ? '没有匹配的共享提示词' : '暂时还没有同事共享提示词'
              }
              action={
                searching ? (
                  <Button
                    className='gap-2'
                    size='sm'
                    variant='outline'
                    onClick={() => handleKeywordChange('')}
                  >
                    <X className='size-4' />
                    清空搜索
                  </Button>
                ) : undefined
              }
            />
          ) : layout === 'table' ? (
            <PromptTable
              emptyText='没有匹配的提示词。'
              pagination={{
                disabled: shared.isFetching,
                page: shared.data?.page ?? sharedPage,
                pageSize: shared.data?.pageSize ?? pageSize,
                total: sharedCount,
                onPageChange: setSharedPage,
                onPageSizeChange: handlePageSizeChange,
              }}
              prompts={sharedByOthers}
              showOwner
              onOpenDetail={openDetail}
            />
          ) : (
            <div className={CARD_GRID}>
              {sharedByOthers.map((prompt) => (
                <PromptItem
                  key={prompt.id}
                  prompt={prompt}
                  onOpenDetail={() => openDetail(prompt)}
                />
              ))}
            </div>
          )}

          {layout === 'card' && (
            <TablePagination
              page={shared.data?.page ?? sharedPage}
              pageSize={shared.data?.pageSize ?? pageSize}
              total={sharedCount}
              disabled={shared.isFetching}
              onPageChange={setSharedPage}
              onPageSizeChange={handlePageSizeChange}
            />
          )}
        </section>
      )}

      <PromptEditorDialog
        open={editorOpen}
        prompt={editing}
        onOpenChange={(open) => {
          setEditorOpen(open)
          if (!open) setEditing(null)
        }}
      />

      {/* 完整正文的承载者：卡片与表格共用同一个弹窗（不再有"展开态"要在两处同步） */}
      <PromptDetailDialog
        prompt={detailPrompt}
        onOpenChange={(open) => {
          if (!open) setDetailPrompt(null)
        }}
      />

      <ConfirmDialog
        confirmText='删除'
        desc={`删除后这条提示词不再出现在你的列表里（保留审计记录）：${pendingDelete?.name ?? ''}`}
        destructive
        open={Boolean(pendingDelete)}
        title='删除提示词'
        handleConfirm={() => {
          if (!pendingDelete) return
          remove.mutate(pendingDelete.id, {
            onSuccess: () => {
              toast.success('已删除')
              // 删掉本页最后一条时回退一页：留在空页上会看到一片空白网格
              const isMineTab = current === 'mine'
              const rowsOnPage = isMineTab
                ? (mine.data?.prompts.length ?? 0)
                : 0
              if (isMineTab && rowsOnPage <= 1 && minePage > 1) {
                setMinePage(minePage - 1)
              }
            },
            onError: (error) => toast.error(apiErrorMessage(error, '删除失败')),
          })
          setPendingDelete(null)
        }}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      />
    </PageShell>
  )
}

type EmptyStateProps = {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}

/**
 * 列表空态：图标 + 一句结论 + 一行"接下来怎么办" + 可选出口按钮。
 *
 * 两个子页各有一套空态，但**结构必须一致** —— 原来只有一行灰字居中，
 * 用户既不知道"是没数据还是没搜到"，也不知道下一步该点哪里。
 */
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className='flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center'>
      <Icon aria-hidden className='size-6 text-muted-foreground' />
      <p className='text-sm font-medium'>{title}</p>
      <p className='max-w-md text-xs text-muted-foreground'>{description}</p>
      {action && <div className='mt-1'>{action}</div>}
    </div>
  )
}

type ItemProps = {
  prompt: AiPrompt
  /** 打开完整正文弹窗（整卡点击与「查看全文」都走它） */
  onOpenDetail: () => void
  /** 以下只在本人条目上提供 */
  onEdit?: () => void
  onDelete?: () => void
  onSubmit?: () => void
  onWithdraw?: () => void
}

/**
 * 单条提示词。
 *
 * 正文只留两行预览，**完整正文点开弹窗读**（2026-09-17，按用户要求
 * "点击卡片后以弹窗的方式呈现而不是拉长"）：卡片尺寸因此恒定，
 * 长正文不再把本卡跨列拉高、也不再把同页其余卡片一起顶高。
 * 名称与使用方式仍与 @ 调用口径一起展示，用户不必猜怎么调。
 */
function PromptItem({
  prompt,
  onOpenDetail,
  onEdit,
  onDelete,
  onSubmit,
  onWithdraw,
}: ItemProps) {
  const isMine = Boolean(onEdit)
  return (
    // 排版按"三行可扫读"收敛（2026-09-15）：标题行（名称 + 状态 + 操作）、
    // 元信息行（创建人 · 更新时间 · 使用次数 · 查看全文）、正文预览。
    // 卡片必须 `h-full` + flex 列：网格用 `auto-rows-fr` 把所有轨道拉成同一高度，
    // 卡片不填满轨道的话高度仍等于内容高度，"等高"就落不了地。
    //
    // 整卡可点（打开详情弹窗）：与数据源卡片同一形态 —— `role='button'` + `tabIndex`
    // + `Enter/Space`，鼠标与键盘两条路都在。
    // **内部按钮必须拦住冒泡**（下面操作区那层 `stopPropagation`）；
    // 键盘侧则靠 `event.target !== event.currentTarget` 区分 —— 焦点在「删除」上按 Enter 时
    // keydown 仍会冒泡到这里，不判断就会"一边删一边弹详情"。
    <article
      aria-label={`查看「${prompt.name}」全文`}
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
        <h3 className='text-sm font-medium'>{prompt.name}</h3>
        <Badge
          className='mt-0.5 font-normal'
          variant={PROMPT_STATUS_VARIANTS[prompt.status] ?? 'outline'}
        >
          {PROMPT_STATUS_LABELS[prompt.status] ?? prompt.status}
        </Badge>

        {/* 操作与标题同行：原来它们独占一行，每张卡片白多出约 44px。
            多列网格下卡片只有 400px 上下，除「提报共享」这个核心动作保留文字外，
            其余收成图标按钮（`RowAction` 强制 Tooltip 与 aria-label 同源）。
            这一层 `stopPropagation` 是必需的：卡片整卡可点，点「删除」时若让事件冒上去，
            会先弹详情再弹确认框（或反过来），两个浮层打架。 */}
        {isMine && (
          <div
            className='ms-auto flex flex-wrap items-center gap-0.5'
            onClick={(event) => event.stopPropagation()}
          >
            {onSubmit && canSubmitPrompt(prompt.status) && (
              <Button
                className='h-7 gap-1.5 px-2'
                size='sm'
                variant='ghost'
                onClick={onSubmit}
              >
                <Send className='size-3.5' />
                {prompt.status === 'rejected' ? '重新提报' : '提报共享'}
              </Button>
            )}
            <RowAction icon={Pencil} label='编辑' onClick={onEdit!} />
            {onWithdraw && canWithdrawPrompt(prompt.status) && (
              <RowAction icon={Undo2} label='撤回提报' onClick={onWithdraw} />
            )}
            <RowAction
              destructive
              icon={Trash2}
              label={`删除「${prompt.name}」`}
              onClick={onDelete!}
            />
          </div>
        )}
      </div>

      {/* 元信息一行到底：创建人 · 更新时间 · 使用次数，分隔符统一为 `·`。
          这三项**始终出现**（2026-09-17 按用户要求「显示使用次数以及创建人」）：
          使用 0 次、创建人取不到都如实写出来 —— 字段时有时无会让人以为页面坏了，
          也让人没法一眼分辨"这条没人用过"和"这个数字没渲染出来"。
          本人列表里创建人恒为自己，写「我」而不是渲染一长串账号登录名 ——
          与表格「归属 / 共享人」列**同一口径**（2026-09-16 表格就是这么定的，
          卡片不该再把那一长串账号 ID 请回来）。
          这里**不再重复名称**（原来前面还挂一个 `@名称`，与标题那行说的是同一件事）。 */}
      <div className='mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground'>
        <span>创建人 {isMine ? '我' : (prompt.ownerLogin ?? '—')}</span>
        <span aria-hidden>·</span>
        <span>更新于 {formatTime(prompt.updatedAt)}</span>
        <span aria-hidden>·</span>
        <span>使用 {prompt.usageCount} 次</span>
        {/* 「查看全文」是**视觉提示**而不是第二个按钮：整卡已经是按钮（`role='button'`），
            里面再嵌一个同名按钮会让读屏遇到两个重叠的可点区域。
            用主题色而不是灰色：整卡可点这件事必须让人看出来（否则用户只会以为正文就两行）。
            键盘用户按 Tab 落在卡片上、Enter / Space 打开。 */}
        <span className='ms-auto text-primary'>查看全文</span>
      </div>

      {/* 「标题」字段已下线（2026-09-15）：它与名称在列表里是上下两行、说的是同一件事，只留名称 */}
      {prompt.summary && (
        <p className='mt-2 text-xs text-muted-foreground'>{prompt.summary}</p>
      )}

      {/* 正文恒为两行预览：完整正文在详情弹窗里读，卡片高度不再随内容变化 */}
      <p className='mt-2 line-clamp-2 text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap'>
        {prompt.body}
      </p>

      {prompt.tags.length > 0 && (
        <div className='mt-2 flex flex-wrap gap-1.5'>
          {prompt.tags.map((tag) => (
            <Badge className='font-normal' key={tag} variant='outline'>
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {prompt.status === 'rejected' && prompt.reviewComment && (
        <p className='mt-2 rounded-lg border border-dashed p-2 text-xs text-muted-foreground'>
          驳回原因：{prompt.reviewComment}
        </p>
      )}
    </article>
  )
}

type PromptTableProps = {
  prompts: AiPrompt[]
  /** 打开完整正文弹窗（与卡片视图共用同一个弹窗） */
  onOpenDetail: (prompt: AiPrompt) => void
  pagination: DataTablePagination & { total: number }
  emptyText: string
  /** 共享视图显示「共享人」；本人列表里作者恒为自己，显示一个"我"更省事 */
  showOwner?: boolean
  /** 本人条目才有的操作（提报 / 编辑 / 撤回 / 删除） */
  editable?: boolean
  onEdit?: (prompt: AiPrompt) => void
  onDelete?: (prompt: AiPrompt) => void
  onSubmit?: (prompt: AiPrompt) => void
  onWithdraw?: (prompt: AiPrompt) => void
}

/**
 * 提示词表格（可切换视图）。
 *
 * 七个字段本来就可比：名称 / 说明 / 标签 / 状态 / 共享人 / 更新于 / 使用次数 ——
 * 卡片把它们摊成三行，表格能一眼按列扫完。
 *
 * 正文不铺在表格里（提问模板可能很长，塞进单元格会把行高撑成几百像素），
 * 用操作列的「查看全文」打开**同一个详情弹窗** —— 与卡片视图等价，能力不因换布局而丢。
 * 2026-09-17 前这里是"在该行下方插一行"，会把行高撑起来、也让表格行序不再整齐；
 * 现在两种读法都不再改变容器尺寸。列宽靠 `max-w-* + truncate` 约束，截断的列一律给 `title` 兜底。
 */
function PromptTable({
  prompts,
  onOpenDetail,
  pagination,
  emptyText,
  showOwner,
  editable,
  onEdit,
  onDelete,
  onSubmit,
  onWithdraw,
}: PromptTableProps) {
  return (
    <DataTable
      columns={PROMPT_TABLE_COLUMNS}
      density='compact'
      emptyText={emptyText}
      isEmpty={prompts.length === 0}
      maxHeightClass='max-h-[70vh]'
      pagination={pagination}
      stickyHeader
      header={
        <TableRow>
          <TableHead>名称</TableHead>
          <TableHead>说明</TableHead>
          <TableHead>标签</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>{showOwner ? '共享人' : '归属'}</TableHead>
          <TableHead>更新于</TableHead>
          <TableHead className={TABLE_HEAD_NUMERIC}>使用</TableHead>
          <TableHead className={TABLE_HEAD_ACTIONS}>操作</TableHead>
        </TableRow>
      }
    >
      {prompts.map((prompt) => (
        <TableRow key={prompt.id}>
          <TableCell className='max-w-56'>
            <span className='block truncate font-medium' title={prompt.name}>
              {prompt.name}
            </span>
          </TableCell>
          <TableCell className={cn(TABLE_CELL_META, 'max-w-72')}>
            {prompt.summary ? (
              <span className='block truncate' title={prompt.summary}>
                {prompt.summary}
              </span>
            ) : (
              '—'
            )}
          </TableCell>
          <TableCell>
            <PromptTags tags={prompt.tags} />
          </TableCell>
          <TableCell>
            <Badge
              className='font-normal'
              variant={PROMPT_STATUS_VARIANTS[prompt.status] ?? 'outline'}
            >
              {PROMPT_STATUS_LABELS[prompt.status] ?? prompt.status}
            </Badge>
          </TableCell>
          <TableCell className={TABLE_CELL_META}>
            {/* 本人列表里作者恒为自己：显示一长串账号 ID 既占宽又没信息量，直接写"我" */}
            {showOwner ? (prompt.ownerLogin ?? '—') : '我'}
          </TableCell>
          <TableCell className={TABLE_CELL_META}>
            {formatTime(prompt.updatedAt)}
          </TableCell>
          <TableCell className={cn(TABLE_CELL_META, TABLE_CELL_NUMERIC)}>
            {prompt.usageCount}
          </TableCell>
          <TableCell className={TABLE_CELL_ACTIONS}>
            <div className='flex items-center justify-end gap-0.5'>
              <Button
                className='h-7 px-2 text-xs'
                size='sm'
                variant='ghost'
                onClick={() => onOpenDetail(prompt)}
              >
                查看全文
              </Button>
              {editable && (
                <>
                  {onSubmit && canSubmitPrompt(prompt.status) && (
                    <Button
                      className='h-7 gap-1.5 px-2'
                      size='sm'
                      variant='ghost'
                      onClick={() => onSubmit(prompt)}
                    >
                      <Send className='size-3.5' aria-hidden='true' />
                      {prompt.status === 'rejected' ? '重新提报' : '提报共享'}
                    </Button>
                  )}
                  {onEdit && (
                    <RowAction
                      icon={Pencil}
                      label={`编辑「${prompt.name}」`}
                      onClick={() => onEdit(prompt)}
                    />
                  )}
                  {onWithdraw && canWithdrawPrompt(prompt.status) && (
                    <RowAction
                      icon={Undo2}
                      label={`撤回「${prompt.name}」的提报`}
                      onClick={() => onWithdraw(prompt)}
                    />
                  )}
                  {onDelete && (
                    <RowAction
                      destructive
                      icon={Trash2}
                      label={`删除「${prompt.name}」`}
                      onClick={() => onDelete(prompt)}
                    />
                  )}
                </>
              )}
            </div>
          </TableCell>
        </TableRow>
      ))}
    </DataTable>
  )
}

/**
 * 标签列：只铺前 2 个，其余折成 `+N`（`title` 给全量）。
 * 理由：标签是自由文本，某些条目会挂五六个，全铺会把表格推宽、把行高拉起来。
 */
function PromptTags({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return <span className='text-xs text-muted-foreground'>—</span>
  }
  const visible = tags.slice(0, 2)
  return (
    <div className='flex items-center gap-1'>
      {visible.map((tag) => (
        <Badge className='font-normal' key={tag} variant='outline'>
          {tag}
        </Badge>
      ))}
      {tags.length > visible.length && (
        <span className='text-xs text-muted-foreground' title={tags.join('、')}>
          +{tags.length - visible.length}
        </span>
      )}
    </div>
  )
}

/** 表格视图的骨架：与真实表格同构（左列窄、中列宽），加载完成时不跳动。 */
function PromptTableSkeleton() {
  return (
    <div className='space-y-2 rounded-lg border p-3'>
      {[0, 1, 2, 3, 4].map((index) => (
        <Skeleton className='h-8 w-full' key={index} />
      ))}
    </div>
  )
}

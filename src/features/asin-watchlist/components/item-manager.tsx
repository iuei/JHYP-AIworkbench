import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Copy,
  FileSpreadsheet,
  Info,
  Loader2,
  Pencil,
  Plus,
  Save,
  Tags,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  TABLE_CELL_ACTIONS,
  TABLE_CELL_META,
  TABLE_CELL_MONO,
  TABLE_CELL_NUMERIC,
  TABLE_HEAD_ACTIONS,
  TABLE_HEAD_NUMERIC,
  type SortDirection,
} from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { useRowSelection } from '@/hooks/use-row-selection'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { TableCell, TableHead, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTable } from '@/components/data-table'
import { SortableHead } from '@/components/sortable-head'
import { TablePagination } from '@/components/table-pagination'
import { useListLayout } from '@/features/ai-agent/components/list-layout'
import {
  ACOS_ALERT_THRESHOLD,
  MARKETPLACE_OPTIONS,
  copyToClipboard,
  coverageTone,
  downloadCsv,
  errorMessage,
  filterMyAsinRows,
  formatMoney,
  formatNumber,
  formatPercent,
  joinMyAsinRows,
  myAsinRowsToCsv,
  sortMyAsinRows,
  toDateInputValue,
  type ItemSortKey,
} from '../format'
import {
  useMyAsinMetrics,
  useMyAsins,
  useRemoveMyAsinItem,
  useRemoveMyAsinItems,
  useUpdateMyAsinItem,
} from '../hooks'
import type { MetricsQuery, MyAsinItem, MyAsinTableRow } from '../types'
import { AddItemDialog } from './add-item-dialog'
import { EditableCell } from './editable-cell'
import { EditableSelectCell } from './editable-select-cell'
import { ItemCards } from './item-cards'
import { MetricOverrideDialog } from './metric-override-dialog'
import { ItemToolbar } from './item-toolbar'
import { WatchlistImportDialog } from './watchlist-import-dialog'

/** 默认每页条数。 */
const DEFAULT_PAGE_SIZE = 50

/** 展示方式偏好的存储键（与提示词广场、知识库各用各的键，互不影响）。 */
const LAYOUT_STORAGE_KEY = 'asin-watchlist-layout'

/**
 * 统计区间也记忆在本机。
 *
 * 人工指标按**具体起止日期**存，所以"上次在近 7 天录的数"刷新后回到默认近 30 天就看不见了 ——
 * 那会被误读成"数据没保存成功"。把区间一起记住，界面上下文才和用户上一次看到的一致。
 */
const WINDOW_STORAGE_KEY = 'asin-watchlist-window'

const WINDOW_KEYS = ['7', '30', '90', 'custom']

function readStoredWindowKey(): string {
  try {
    const stored = localStorage.getItem(WINDOW_STORAGE_KEY)
    return stored && WINDOW_KEYS.includes(stored) ? stored : '30'
  } catch {
    return '30'
  }
}

/**
 * 数值指标列：第一次点按按"降序"打开（先看花得最多 / ACoS 最高），文本列按升序。
 */
const NUMERIC_SORT_KEYS: readonly ItemSortKey[] = [
  'spend',
  'adSales',
  'orders',
  'acos',
  'units',
  'businessSales',
]

/** 引用恒定的空数组：`data?.items ?? []` 每次渲染都是新引用，当依赖会让下游每帧重算。 */
const NO_ITEMS: MyAsinItem[] = []

/** 表格列数（勾选 / 序号 / ASIN / 站点 / 别名 / 备注 / 覆盖 / 6 个指标 / 操作）。 */
const TABLE_COLUMNS = 14

/**
 * 「我的 ASIN」主体：一张可筛选、可排序、可分页的数据，两种读法（表格 / 卡片）。
 *
 * 三条口径值得记住：
 * ① **指标是区间相关的**：区间选择器在工具条第二行，`useMyAsinMetrics` 按区间缓存，
 *    来回切 7 天 / 30 天不会重复请求（`placeholderData` 避免整表闪回空态）；
 * ② **`null` ≠ `0`**：没有报表记录的 ASIN 显示「—」，排序时这些行恒排最后 ——
 *    排在前面会被误读成"花得最少，可以不管"；
 * ③ **先筛后排再分页** 的顺序不变，导出跟随筛选（导出的行 = 屏幕上的行）。
 *
 * 站点只用于筛选与展示，**不参与任何金额合计**：不同站点货币不同，
 * 页面上给出的每个数字都属于一个明确的站点（"全部站点"只是把两组行并排显示）。
 */
export function ItemManager() {
  const watchlists = useMyAsins()
  const removeItem = useRemoveMyAsinItem()
  const removeItems = useRemoveMyAsinItems()
  const updateItem = useUpdateMyAsinItem()
  /*
   * 默认读法是**表格**：这一页的核心用途是横向比数字（列对齐、可排序、可多选），
   * 卡片是"一条一条看"的补充读法。偏好仍然记忆在本机（与提示词广场同一套 hook）。
   */
  const [layout, onLayoutChange] = useListLayout(LAYOUT_STORAGE_KEY, 'table')

  const [keyword, setKeyword] = useState('')
  const [marketplace, setMarketplace] = useState('all')
  const [windowKey, setWindowKey] = useState(readStoredWindowKey)
  const [startDate, setStartDate] = useState<Date | undefined>(undefined)
  const [endDate, setEndDate] = useState<Date | undefined>(undefined)
  const [sort, setSort] = useState<{ key: ItemSortKey; direction: SortDirection }>({
    key: 'createdAt',
    direction: 'desc',
  })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  /** 行选择：只在当前页内有效（共享 hook，语义见 `use-row-selection`） */
  const selection = useRowSelection<number>()
  const [editing, setEditing] = useState<MyAsinItem | null>(null)
  /** 正在录入指标的条目（含它在当前区间的指标，用于预填已有人工值） */
  const [metricItem, setMetricItem] = useState<MyAsinTableRow | null>(null)
  const [pendingDelete, setPendingDelete] = useState<MyAsinTableRow | null>(null)
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const items = watchlists.data?.items ?? NO_ITEMS
  const maxItems = watchlists.data?.maxItems ?? 0

  const isCustom = windowKey === 'custom'
  const customReady = Boolean(startDate && endDate)

  /*
   * 自定义区间只选了一半时**不发请求**（`enabled: false`）：
   * 拿默认 30 天去查会让界面显示"自定义区间"、数字却是 30 天的 —— 这是最难被发现的误读。
   * 此时列表仍在，指标列一律显示「—」，区间位置给出"需要同时选择开始与结束日期"。
   */
  const metricsQuery: MetricsQuery = isCustom
    ? {
        startDate: toDateInputValue(startDate) ?? '',
        endDate: toDateInputValue(endDate) ?? '',
      }
    : { windowDays: Number(windowKey) }

  const metrics = useMyAsinMetrics(metricsQuery, {
    enabled: !isCustom || customReady,
  })

  /*
   * 条目与指标是两个请求，在客户端按 `(ASIN, 站点)` 连接。
   * 好处是"只切区间"不会重拉条目，"只改别名"也不会重算指标。
   */
  const rows = useMemo(
    () => joinMyAsinRows(items, metrics.data?.rows),
    [items, metrics.data]
  )

  /** 列表里实际出现的站点（只列有数据的，不把 10 个站点全摆出来）。 */
  const marketplaces = useMemo(
    () => [...new Set(items.map((item) => item.marketplace))].sort(),
    [items]
  )

  /*
   * 先筛后排再分页（顺序不能换）：
   * 反过来会出现"排序结果只有当前页那几条"，与统一规范里"先筛后排再分页"的语义相违。
   */
  const filtered = useMemo(
    () =>
      sortMyAsinRows(
        filterMyAsinRows(rows, keyword, marketplace),
        sort.key,
        sort.direction
      ),
    [rows, keyword, marketplace, sort.key, sort.direction]
  )

  // 筛选会改变总页数，所以当前页要夹回有效范围（否则筛完停在空页上）
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageItems = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  )

  const pageIds = pageItems.map((item) => item.id)
  const allPageSelected = selection.isAllSelected(pageIds)
  const somePageSelected = selection.isSomeSelected(pageIds)

  /** 区间与覆盖情况：指标是区间相关的，看不到区间就没法判断眼前的数字是什么。 */
  const periodText = (() => {
    if (isCustom && !customReady) return '自定义区间需要同时选择开始与结束日期'
    const period = metrics.data?.period
    if (!period) return null
    const summary = metrics.data?.summary
    const covered =
      summary === undefined
        ? ''
        : ` · 有数据 ${summary.covered} / ${summary.asinCount}`
    return `${period.startDate} ~ ${period.endDate}（${period.days} 天）${covered}`
  })()

  /** 页面当前区间（服务端实际采用的起止日期）：人工指标按具体日期存，录入时用它回填。 */
  const period = metrics.data?.period
    ? {
        startDate: metrics.data.period.startDate,
        endDate: metrics.data.period.endDate,
      }
    : null

  /** 改变"看哪几条"的动作一律回到第 1 页并清空选择：留在第 7 页看 3 条结果会让人以为筛选没生效。 */
  function resetView() {
    setPage(1)
    selection.clear()
  }

  function handleDelete() {
    if (!pendingDelete) return
    const removedId = pendingDelete.id
    removeItem.mutate(removedId, {
      onSuccess: () => {
        toast.success(`已移除 ${pendingDelete.asin}`)
        setPendingDelete(null)
        selection.removeMany([removedId])
      },
      onError: (error) =>
        toast.error(errorMessage(error, '移除失败，请稍后重试。')),
    })
  }

  function handleBulkRemove() {
    const itemIds = [...selection.selectedIds]
    if (itemIds.length === 0) return
    removeItems.mutate(itemIds, {
      onSuccess: (result) => {
        setBulkRemoveOpen(false)
        selection.clear()
        setPage(1)
        if (result.failedIds.length > 0) {
          toast.error(
            `已移除 ${result.removed} 条，${result.failedIds.length} 条失败，请刷新后重试。`
          )
        } else {
          toast.success(`已移除 ${result.removed} 条`)
        }
      },
      onError: (error) =>
        toast.error(errorMessage(error, '批量移除失败，请稍后重试。')),
    })
  }

  /**
   * 就地编辑：只提交被改的那一列（服务端按"字段是否传入"决定是否更新）。
   *
   * 四列都可改：**ASIN 与站点是身份的一部分**（改到已存在的 `(ASIN, 站点)` 组合会被服务端
   * 拒绝，中文原因原样展示），别名与备注的空串按"清空"处理。
   * 改 ASIN / 站点不会动报表数据 —— 指标会按新身份重新取数。
   */
  function saveField(
    item: MyAsinTableRow,
    field: 'asin' | 'marketplace' | 'alias' | 'note',
    next: string
  ) {
    const patch =
      field === 'asin'
        ? { asin: next }
        : field === 'marketplace'
          ? { marketplace: next }
          : field === 'alias'
            ? { alias: next || null }
            : { note: next || null }
    const savedLabel = {
      asin: '已保存 ASIN',
      marketplace: '已保存站点',
      alias: '已保存别名',
      note: '已保存备注',
    } as const

    updateItem.mutate(
      { itemId: item.id, ...patch },
      {
        onSuccess: () => toast.success(savedLabel[field]),
        onError: (error) =>
          toast.error(errorMessage(error, '保存失败，请稍后重试。')),
      }
    )
  }

  async function handleCopy(asin: string) {
    const ok = await copyToClipboard(asin)
    if (ok) toast.success(`已复制 ${asin}`)
    else toast.error('复制失败，请手动选中文本复制。')
  }

  /** 导出跟随当前筛选结果：导出的行必须与屏幕上看到的一致。 */
  function handleExport() {
    if (filtered.length === 0) return
    downloadCsv(
      `我的ASIN-${new Date().toISOString().slice(0, 10)}.csv`,
      myAsinRowsToCsv(filtered)
    )
    toast.success(`已导出 ${filtered.length} 条`)
  }

  function toggleSort(key: ItemSortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : {
            key,
            direction: NUMERIC_SORT_KEYS.includes(key) ? 'desc' : 'asc',
          }
    )
    resetView()
  }

  if (watchlists.isLoading) {
    return (
      <div className='space-y-4'>
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-72 w-full' />
      </div>
    )
  }

  if (watchlists.isError) {
    return (
      <Card className='border-destructive/40'>
        <CardContent className='flex items-start gap-3 py-6'>
          <AlertTriangle
            className='mt-0.5 size-4 text-destructive'
            aria-hidden='true'
          />
          <p className='text-sm text-destructive'>
            {errorMessage(
              watchlists.error,
              '读不到你的 ASIN 列表，请刷新后重试。'
            )}
          </p>
        </CardContent>
      </Card>
    )
  }

  const toolbar = (
    <ItemToolbar
      filteredCount={filtered.length}
      keyword={keyword}
      layout={layout}
      marketplaces={marketplaces}
      marketplace={marketplace}
      metricsLoading={metrics.isFetching}
      periodText={periodText}
      selectedCount={selection.count}
      startDate={startDate}
      endDate={endDate}
      totalCount={items.length}
      windowKey={windowKey}
      onAdd={() => setAddOpen(true)}
      onBulkRemove={() => setBulkRemoveOpen(true)}
      onClearSelection={selection.clear}
      onEndDateChange={(value) => {
        setEndDate(value)
        resetView()
      }}
      onExport={handleExport}
      onImport={() => setImportOpen(true)}
      onKeywordChange={(value) => {
        setKeyword(value)
        resetView()
      }}
      onLayoutChange={onLayoutChange}
      onMarketplaceChange={(value) => {
        setMarketplace(value)
        resetView()
      }}
      onStartDateChange={(value) => {
        setStartDate(value)
        resetView()
      }}
      onWindowKeyChange={(value) => {
        setWindowKey(value)
        try {
          localStorage.setItem(WINDOW_STORAGE_KEY, value)
        } catch {
          // 存不下就不存：区间偏好不属于关键路径，不打扰用户
        }
        resetView()
      }}
    />
  )

  const dialogs = (
    <>
      <AddItemDialog open={addOpen} onOpenChange={setAddOpen} period={period} />

      <MetricOverrideDialog
        item={metricItem}
        period={period}
        onOpenChange={(open) => {
          if (!open) setMetricItem(null)
        }}
      />

      <ItemEditDialog
        item={editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={`从列表移除 ${pendingDelete?.asin ?? ''}${
          pendingDelete ? `（${pendingDelete.marketplace} 站）` : ''
        }？`}
        desc='只影响你的 ASIN 列表，报表数据不会被改动；需要时可以再添加回来。'
        confirmText='移除'
        destructive
        isLoading={removeItem.isPending}
        handleConfirm={handleDelete}
      />

      <ConfirmDialog
        open={bulkRemoveOpen}
        onOpenChange={setBulkRemoveOpen}
        title={`移除选中的 ${selection.count} 条？`}
        desc='只影响你的 ASIN 列表，报表数据不会被改动。移除后需要重新添加或导入才能恢复。'
        confirmText={`移除 ${selection.count} 条`}
        destructive
        isLoading={removeItems.isPending}
        handleConfirm={handleBulkRemove}
      />

      <WatchlistImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </>
  )

  /*
   * 空态与列表态**共用同一个 return**（2026-09-18 修）：此前两者各自 `return`，
   * 结果"添加第一条 ASIN"时组件从一个分支切到另一个分支，`dialogs` 里的弹窗被
   * **卸载又重挂载** —— 而 React Query 的 mutation 回调在组件卸载后不再执行，
   * 于是"添加成功 → 关闭弹窗"这一步失效，用户看到的是"又弹出一个录入窗口"，
   * 在里面二次提交（ASIN 已存在）就把刚填的指标丢掉了。
   */
  return (
    <section className='space-y-3'>
      {items.length === 0 ? (
        <ItemsEmptyGuide
          maxItems={maxItems}
          onAdd={() => setAddOpen(true)}
          onImport={() => setImportOpen(true)}
        />
      ) : (
        <>
          <div className='flex flex-wrap items-end justify-between gap-3'>
            <div className='min-w-0 space-y-0.5'>
              <h2 className='text-base font-semibold'>ASIN 列表</h2>
              <p className='text-xs text-muted-foreground'>
                共 {items.length} / {maxItems} 条；每个 ASIN 在所选区间内的广告与销售表现，
                可筛选、排序、就地改别名与备注，也能用模板批量导入。
              </p>
            </div>
          </div>

      {/*
        工具条渲染在视图分支**之外**：它是"看哪几条 / 看哪段时间 / 怎么导入导出"的唯一入口，
        两种读法都必须有 —— 放在 DataTable 的 toolbar 里会让卡片视图整条消失。
        DataTable 的 toolbar 本来就是渲染在表格外框之外的上方，视觉位置不变。
      */}
      {toolbar}

      {layout === 'table' ? (
        <DataTable
          columns={TABLE_COLUMNS}
          /*
            空态分两种：列表本身为空时讲"怎么开始"，筛选没命中时讲"没匹配到"。
            混成一句会让筛完的用户以为列表被清空了。
          */
          emptyText={
            keyword.trim() || marketplace !== 'all'
              ? '没有符合当前筛选条件的 ASIN，换个关键词或把站点切回「全部站点」。'
              : '列表还没有 ASIN，点「添加 ASIN」或「从表格导入」开始。'
          }
          isEmpty={filtered.length === 0}
          maxHeightClass='max-h-[70vh]'
          pagination={{
            // 前端切片：分页后渲染量与列表大小（上限 5000）无关。
            page: currentPage,
            pageSize,
            total: filtered.length,
            // 5000 条 / 每页 50 = 100 页，没有跳页就只能一页页点
            jumpTo: true,
            onPageChange: (next) => {
              setPage(next)
              // 只允许"当前页内选择"：跨页累积选择会把"移除所选"变成一次不可预期的批量删除
              selection.clear()
            },
            onPageSizeChange: (size) => {
              setPageSize(size)
              resetView()
            },
          }}
          stickyHeader
          header={
            <TableRow>
              <TableHead className='w-10'>
                <Checkbox
                  aria-label='选择本页全部 ASIN'
                  checked={
                    allPageSelected
                      ? true
                      : somePageSelected
                        ? 'indeterminate'
                        : false
                  }
                  onCheckedChange={() => selection.toggleAll(pageIds)}
                />
              </TableHead>
              <TableHead className='w-12 text-right'>#</TableHead>
              <SortableHead
                activeKey={sort.key}
                className='w-44'
                direction={sort.direction}
                label='ASIN'
                sortKey='asin'
                onToggle={toggleSort}
              />
              <SortableHead
                activeKey={sort.key}
                className='w-20'
                direction={sort.direction}
                label='站点'
                sortKey='marketplace'
                onToggle={toggleSort}
              />
              <SortableHead
                activeKey={sort.key}
                className='w-36'
                direction={sort.direction}
                label='别名'
                sortKey='alias'
                onToggle={toggleSort}
              />
              <TableHead className='w-48'>备注</TableHead>
              <TableHead className='w-24'>数据覆盖</TableHead>
              <SortableHead
                activeKey={sort.key}
                className={cn(TABLE_HEAD_NUMERIC, 'w-24')}
                direction={sort.direction}
                label='花费'
                sortKey='spend'
                onToggle={toggleSort}
              />
              <SortableHead
                activeKey={sort.key}
                className={cn(TABLE_HEAD_NUMERIC, 'w-28')}
                direction={sort.direction}
                label='广告销售额'
                sortKey='adSales'
                onToggle={toggleSort}
              />
              <SortableHead
                activeKey={sort.key}
                className={cn(TABLE_HEAD_NUMERIC, 'w-20')}
                direction={sort.direction}
                label='广告订单'
                sortKey='orders'
                onToggle={toggleSort}
              />
              <SortableHead
                activeKey={sort.key}
                className={cn(TABLE_HEAD_NUMERIC, 'w-20')}
                direction={sort.direction}
                label='ACoS'
                sortKey='acos'
                onToggle={toggleSort}
              />
              <SortableHead
                activeKey={sort.key}
                className={cn(TABLE_HEAD_NUMERIC, 'w-20')}
                direction={sort.direction}
                label='销量'
                sortKey='units'
                onToggle={toggleSort}
              />
              <SortableHead
                activeKey={sort.key}
                className={cn(TABLE_HEAD_NUMERIC, 'w-28')}
                direction={sort.direction}
                label='销售额'
                sortKey='businessSales'
                onToggle={toggleSort}
              />
              <TableHead className={TABLE_HEAD_ACTIONS}>操作</TableHead>
            </TableRow>
          }
        >
          {pageItems.map((item, index) => {
            const rowMetrics = item.metrics
            const acosAlert =
              rowMetrics?.acos !== null &&
              rowMetrics?.acos !== undefined &&
              rowMetrics.acos > ACOS_ALERT_THRESHOLD
            return (
              <TableRow
                key={item.id}
                className='group'
                data-state={selection.has(item.id) ? 'selected' : undefined}
              >
                <TableCell>
                  <Checkbox
                    aria-label={`选择 ${item.asin}（${item.marketplace} 站）`}
                    checked={selection.has(item.id)}
                    onCheckedChange={(checked) =>
                      selection.toggleOne(item.id, checked === true)
                    }
                  />
                </TableCell>
                <TableCell
                  className={cn(TABLE_CELL_META, 'text-right tabular-nums')}
                >
                  {(currentPage - 1) * pageSize + index + 1}
                </TableCell>
                <TableCell className='w-44 max-w-44'>
                  <span className='flex items-center gap-1'>
                    <EditableCell
                      ariaLabel={`${item.asin} 的 ASIN`}
                      className={cn(TABLE_CELL_MONO, 'font-mono')}
                      placeholder='商品编码'
                      value={item.asin}
                      onSave={(next) => saveField(item, 'asin', next)}
                    />
                    <Button
                      aria-label={`复制 ${item.asin}`}
                      className='size-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100'
                      size='icon'
                      type='button'
                      variant='ghost'
                      onClick={() => void handleCopy(item.asin)}
                    >
                      <Copy className='size-3.5' aria-hidden='true' />
                    </Button>
                  </span>
                </TableCell>
                <TableCell className='w-32 max-w-32'>
                  <EditableSelectCell
                    ariaLabel={`${item.asin} 的站点`}
                    options={MARKETPLACE_OPTIONS}
                    value={item.marketplace}
                    onSave={(next) => saveField(item, 'marketplace', next)}
                  />
                </TableCell>
                <TableCell className='w-36 max-w-36'>
                  <EditableCell
                    ariaLabel={`${item.asin} 的别名`}
                    className={TABLE_CELL_META}
                    placeholder='例如：主力款 / 新品 A'
                    value={item.alias}
                    onSave={(next) => saveField(item, 'alias', next)}
                  />
                </TableCell>
                <TableCell className='w-48 max-w-48'>
                  <EditableCell
                    ariaLabel={`${item.asin} 的备注`}
                    className={TABLE_CELL_META}
                    placeholder='仅自己可见的说明'
                    value={item.note}
                    onSave={(next) => saveField(item, 'note', next)}
                  />
                </TableCell>
                <TableCell>
                  <span className='flex flex-wrap items-center gap-1'>
                    <CoverageBadge coverage={rowMetrics?.coverage} />
                    {rowMetrics?.manual && (
                      <Badge variant='secondary' className='font-normal'>
                        手工
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <MetricCell value={rowMetrics?.spend} format={formatMoney} />
                <MetricCell value={rowMetrics?.adSales} format={formatMoney} />
                <MetricCell value={rowMetrics?.orders} format={formatNumber} />
                <MetricCell
                  alert={acosAlert}
                  value={rowMetrics?.acos}
                  format={formatPercent}
                />
                <MetricCell value={rowMetrics?.units} format={formatNumber} />
                <MetricCell
                  value={rowMetrics?.businessSales}
                  format={formatMoney}
                />
                <TableCell className={TABLE_CELL_ACTIONS}>
                  <div className='flex items-center justify-end gap-1'>
                    <Button
                      aria-label={`录入 ${item.asin} 的指标`}
                      size='sm'
                      type='button'
                      variant='ghost'
                      onClick={() => setMetricItem(item)}
                    >
                      <BarChart3 aria-hidden='true' />
                    </Button>
                    <Button
                      aria-label={`编辑 ${item.asin} 的别名与备注`}
                      size='sm'
                      type='button'
                      variant='ghost'
                      onClick={() => setEditing(item)}
                    >
                      <Pencil aria-hidden='true' />
                    </Button>
                    <Button
                      aria-label={`从列表移除 ${item.asin}`}
                      size='sm'
                      type='button'
                      variant='ghost'
                      onClick={() => setPendingDelete(item)}
                    >
                      <Trash2 aria-hidden='true' />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </DataTable>
      ) : (
        <div className='space-y-3'>
          {filtered.length === 0 ? (
            <div className='rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground'>
              {keyword.trim() || marketplace !== 'all'
                ? '没有符合当前筛选条件的 ASIN，换个关键词或把站点切回「全部站点」。'
                : '列表还没有 ASIN，点「添加 ASIN」或「从表格导入」开始。'}
            </div>
          ) : (
            <ItemCards
              rows={pageItems}
              selectedIds={selection.selectedIds}
              onCopy={(asin) => void handleCopy(asin)}
              onEdit={setEditing}
              onMetrics={setMetricItem}
              onRemove={setPendingDelete}
              onToggleSelect={(id, checked) => selection.toggleOne(id, checked)}
            />
          )}
          {/* 表格视图的分页器由 `DataTable` 内部渲染，卡片视图在这里补一个 */}
          <TablePagination
            jumpTo
            onPageChange={(next) => {
              setPage(next)
              selection.clear()
            }}
            onPageSizeChange={(size) => {
              setPageSize(size)
              resetView()
            }}
            page={currentPage}
            pageSize={pageSize}
            total={filtered.length}
          />
        </div>
      )}

      <p className='flex items-start gap-1.5 text-xs text-muted-foreground'>
        <Info className='mt-0.5 size-3.5 shrink-0' aria-hidden='true' />
        ASIN / 站点 / 别名 / 备注 四列点单元格就能改（回车保存、Esc 取消）—— 改 ASIN 或站点
        只会换个取数口径，报表数据本身不动。花费 / 广告销售额 / 广告订单 / ACoS 来自广告日报，
        销量 / 销售额来自业务报告，都是所选区间内**该站点**的合计（不同站点货币不同，不做跨站点
        相加）；「—」表示该区间没有这条记录，不代表 0。标「手工」的行：你在行内「录入指标」里
        为这个区间填过数字，填了的项以你填的为准、留空的仍用报表，AI 助手读到的也是这些数字。
        想看趋势与对比，去 AI 助手直接问「我的 ASIN 最近 30 天怎么样」。
      </p>
        </>
      )}

      {dialogs}
    </section>
  )
}

/**
 * 指标单元格。
 *
 * `null` → 「—」由格式化函数统一处理；`alert` 用于 ACoS 超过预警线的标色
 * —— 颜色只是提示，判定等级仍以服务端返回的 `risk` 为准（页面不自己下结论）。
 */
function MetricCell({
  value,
  format,
  alert,
}: {
  value: number | null | undefined
  format: (value: number | null | undefined) => string
  alert?: boolean
}) {
  const empty = value === null || value === undefined
  return (
    <TableCell
      className={cn(
        TABLE_CELL_NUMERIC,
        empty && 'text-muted-foreground',
        alert && 'font-medium text-destructive'
      )}
    >
      {format(value)}
    </TableCell>
  )
}

/**
 * 数据覆盖。
 *
 * 「无数据」用 destructive 变体而不是一把灰字：它意味着这个 ASIN
 * 在所选区间**完全没有报表记录**，需要用户去确认站点或报表导入，是一个待办项。
 */
function CoverageBadge({ coverage }: { coverage: string | undefined }) {
  const tone = coverageTone(coverage)
  return (
    <Badge
      className='font-normal whitespace-nowrap'
      variant={
        tone === 'empty'
          ? 'destructive'
          : tone === 'warning'
            ? 'secondary'
            : 'outline'
      }
    >
      {coverage ?? '无数据'}
    </Badge>
  )
}

/** 空列表的引导：把两个真实入口摆出来，并说清站点与数据来源。 */
function ItemsEmptyGuide({
  maxItems,
  onAdd,
  onImport,
}: {
  maxItems: number
  onAdd: () => void
  onImport: () => void
}) {
  return (
    <Card>
      <CardContent className='space-y-4 py-6'>
        <div className='flex items-start gap-3'>
          <Tags className='mt-0.5 size-4 shrink-0 text-muted-foreground' aria-hidden='true' />
          <div className='space-y-1'>
            <p className='text-sm font-medium'>还没有 ASIN</p>
            <p className='text-sm text-muted-foreground'>
              单个填一个商品编码，或用 Excel 模板批量导入。加进来之后这里会显示每个 ASIN
              在所选区间的花费、广告销售额、ACoS、销量与销售额（最多 {maxItems} 条）。
            </p>
          </div>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button size='sm' type='button' onClick={onAdd}>
            <Plus aria-hidden='true' />
            添加 ASIN
          </Button>
          <Button size='sm' type='button' variant='outline' onClick={onImport}>
            <FileSpreadsheet aria-hidden='true' />
            从表格导入
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

type ItemEditDialogProps = {
  item: MyAsinItem | null
  onOpenChange: (open: boolean) => void
}

/**
 * 单条 ASIN 的别名 / 备注 / 站点编辑。
 *
 * 关闭时不渲染（卸载后重开即用最新数据初始化），与沉淀编辑器同一模式。
 */
function ItemEditDialog({ item, onOpenChange }: ItemEditDialogProps) {
  if (!item) return null
  return <ItemEditForm key={item.id} item={item} onOpenChange={onOpenChange} />
}

function ItemEditForm({
  item,
  onOpenChange,
}: ItemEditDialogProps & { item: MyAsinItem }) {
  const update = useUpdateMyAsinItem()
  const [asin, setAsin] = useState(item.asin)
  const [alias, setAlias] = useState(item.alias ?? '')
  const [note, setNote] = useState(item.note ?? '')
  const [marketplace, setMarketplace] = useState(item.marketplace)

  function handleSave() {
    update.mutate(
      {
        itemId: item.id,
        asin: asin.trim(),
        alias: alias.trim() || null,
        note: note.trim() || null,
        marketplace,
      },
      {
        onSuccess: () => {
          toast.success('已保存')
          onOpenChange(false)
        },
        onError: (error) =>
          toast.error(errorMessage(error, '保存失败，请稍后重试。')),
      }
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>编辑 {item.asin}</DialogTitle>
          <DialogDescription>
            身份四列都可以改：ASIN、站点、别名、备注。指标列由报表算出，不在这里修改。
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='item-asin'>ASIN</Label>
            <Input
              id='item-asin'
              value={asin}
              onChange={(event) => setAsin(event.target.value)}
              placeholder='例如 B0C1D2E3F4'
              maxLength={40}
              autoComplete='off'
              className='font-mono'
              spellCheck={false}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='item-marketplace'>站点</Label>
            <Select value={marketplace} onValueChange={setMarketplace}>
              <SelectTrigger
                id='item-marketplace'
                className='w-full'
                aria-label='站点'
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
            <p className='text-xs text-muted-foreground'>
              同一个 ASIN 在另一个站点是独立的一条记录；改成已存在的组合会被拒绝。
            </p>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='item-alias'>别名</Label>
            <Input
              id='item-alias'
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              placeholder='例如：主力款 / 新品 A'
              maxLength={120}
              autoComplete='off'
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='item-note'>备注</Label>
            <Textarea
              id='item-note'
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder='仅自己可见的说明，例如负责人、上架时间、观察重点'
              rows={3}
              maxLength={300}
              autoComplete='off'
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={update.isPending}
          >
            取消
          </Button>
          <Button type='button' onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? (
              <Loader2 className='animate-spin' aria-hidden='true' />
            ) : (
              <Save aria-hidden='true' />
            )}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

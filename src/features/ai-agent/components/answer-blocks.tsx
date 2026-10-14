import { useMemo, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, BarChart3, Minus } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { TABLE_CELL_NUMERIC, TABLE_HEAD_NUMERIC } from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { useTheme } from '@/context/theme-provider'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TableCell, TableHead, TableRow } from '@/components/ui/table'
import { DataTable } from '@/components/data-table'
import type { AnswerBlock, AnswerMetricItem } from '../types'
import { dedupeAnswerBlocks } from './answer-block-utils'

/**
 * 回答卡片的结构化数据块渲染。
 *
 * 为什么用结构化块而不是让模型排版 Markdown 表格：
 * 流式输出下模型排的表格会抖动、列容易错位，且无法画图；结构化块由服务端生成、这里稳定渲染。
 *
 * 图表颜色取自项目主题变量（--chart-1..5），通过 getComputedStyle 解析成具体色值：
 * 直接把 `var(--chart-1)` 传给 recharts 会落到 SVG 属性上，而 SVG 表现属性不支持 var()，线条会画不出来。
 */
const chartColorCache = new Map<string, string[]>()

/** 读取主题里的图表色板；按主题缓存，避免每次渲染都触发样式重算。 */
function readChartColors(count: number, theme: string): string[] {
  const cacheKey = `${theme}:${count}`
  const cached = chartColorCache.get(cacheKey)
  if (cached) return cached
  if (typeof window === 'undefined') return []
  const styles = getComputedStyle(document.documentElement)
  const colors = Array.from({ length: count }, (_, index) => {
    const value = styles.getPropertyValue(`--chart-${index + 1}`).trim()
    return value || 'currentColor'
  })
  chartColorCache.set(cacheKey, colors)
  return colors
}

function useChartColors(count: number): string[] {
  // 依赖 resolvedTheme：深色主题下的 --chart-* 与浅色不同，切换后必须重新解析
  const { resolvedTheme } = useTheme()
  return readChartColors(count, resolvedTheme)
}

/**
 * 列底色档位 → 类名。
 *
 * 取主题的**分类色**（`--chart-1..5`，深浅两套主题各自有值），透明度压得很低：
 * 数据行 10%、字段名表头 20%、分组表头 25% —— 目的是"分得出这几列是一家的"，
 * 而不是抢数字的注意力（用户口径：「颜色不要太鲜艳，能看出来就行，淡一点」）。
 * 必须写成静态类名：Tailwind 不会为拼接出来的类名生成样式。
 */
const TONE_CELL_CLASS: Record<number, string> = {
  1: 'bg-chart-1/10',
  2: 'bg-chart-2/10',
  3: 'bg-chart-3/10',
  4: 'bg-chart-4/10',
  5: 'bg-chart-5/10',
}

const TONE_FIELD_HEAD_CLASS: Record<number, string> = {
  1: 'bg-chart-1/20',
  2: 'bg-chart-2/20',
  3: 'bg-chart-3/20',
  4: 'bg-chart-4/20',
  5: 'bg-chart-5/20',
}

const TONE_GROUP_HEAD_CLASS: Record<number, string> = {
  1: 'bg-chart-1/25',
  2: 'bg-chart-2/25',
  3: 'bg-chart-3/25',
  4: 'bg-chart-4/25',
  5: 'bg-chart-5/25',
}

function toneClass(
  map: Record<number, string>,
  tone: number | undefined
): string | undefined {
  if (typeof tone !== 'number') return undefined
  // 越界（0、负数、>5）一律不加底色，宁可无色也不要用错色
  if (tone < 1 || tone > 5) return undefined
  return map[tone]
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? String(value)
      : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  }
  return String(value)
}

/** 指标卡：数值 + 环比变化徽标。 */
function MetricsBlock({ block }: { block: AnswerBlock }) {
  return (
    <section className='space-y-2'>
      {block.title && (
        <h3 className='text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
          {block.title}
        </h3>
      )}
      <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-4'>
        {(block.items ?? []).map((item) => (
          <MetricCell item={item} key={item.key} />
        ))}
      </div>
      {block.note && (
        <p className='text-xs text-muted-foreground'>{block.note}</p>
      )}
    </section>
  )
}

function MetricCell({ item }: { item: AnswerMetricItem }) {
  const delta = item.delta
  const deltaPct = item.deltaPct
  const direction =
    delta === null || delta === undefined
      ? null
      : delta > 0
        ? 'up'
        : delta < 0
          ? 'down'
          : 'flat'
  return (
    <div className='rounded-lg border bg-muted/20 p-3'>
      <p className='text-xs text-muted-foreground'>{item.label}</p>
      <p className='mt-1 text-lg font-semibold tabular-nums'>
        {formatValue(item.current ?? item.value)}
        {item.unit === '%' &&
        item.current !== null &&
        item.current !== undefined
          ? '%'
          : ''}
      </p>
      {direction && (
        <p className='mt-1 flex items-center gap-1 text-xs text-muted-foreground'>
          {direction === 'up' && (
            <ArrowUp className='size-3 text-destructive' />
          )}
          {direction === 'down' && (
            <ArrowDown className='size-3 text-primary' />
          )}
          {direction === 'flat' && <Minus className='size-3' />}
          <span className='tabular-nums'>
            {delta! > 0 ? '+' : ''}
            {delta}
            {deltaPct === null || deltaPct === undefined
              ? ''
              : `（${deltaPct > 0 ? '+' : ''}${deltaPct}%）`}
          </span>
          <span>对比上期 {formatValue(item.previous)}</span>
        </p>
      )}
    </div>
  )
}

/** 明细表：用 @tanstack/react-table 支撑列排序（PRD §5.1 要求）。 */
function TableBlock({ block }: { block: AnswerBlock }) {
  const [sorting, setSorting] = useState<SortingState>([])
  const columns = useMemo(
    () =>
      (block.columns ?? []).map((column) => ({
        id: column.key,
        accessorFn: (row: Record<string, unknown>) => row[column.key],
        header: column.label,
        cell: (info: { getValue: () => unknown }) =>
          formatValue(info.getValue()),
        meta: { align: column.align, tone: column.tone },
      })),
    [block.columns]
  )

  // React Compiler 会跳过使用该 API 的组件（其返回值无法安全 memo），这是已知限制：
  // 表格仅做展示与排序，跳过 memo 不影响正确性
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: block.rows ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  /*
   * 分组表头只在服务端给了 `groups` 且数量与列数对得上时才渲染（`span` 之和 = 列数 - 1）：
   * 结构不对就退回单行表头，宁可少一层分组，也不要渲染出错位的表头。
   */
  const groups = block.groups ?? []
  const primaryColumnLabel = (block.columns ?? [])[0]?.label ?? ''
  const hasGroups =
    groups.length > 0 &&
    groups.reduce((sum, group) => sum + (group.span || 0), 0) ===
      (block.columns ?? []).length - 1

  return (
    <section className='space-y-2'>
      <div className='flex flex-wrap items-center gap-2'>
        {block.title && (
          <h3 className='text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
            {block.title}
          </h3>
        )}
        {block.truncated && (
          <Badge className='font-normal' variant='outline'>
            共 {block.totalRows} 行，仅展示前 {(block.rows ?? []).length} 行
          </Badge>
        )}
      </div>
      {/*
        外壳走 DataTable，但排序仍由本组件的 TanStack Table 驱动：列定义、`getSortedRowModel`
        与表头的 `getToggleSortingHandler()` 都不经 DataTable —— 它只负责外框、表头容器与空态。
        明细默认只回 30 行、上限由服务端控制，因此这里刻意不加分页。
      */}
      <DataTable
        columns={(block.columns ?? []).length}
        emptyText='没有数据行。'
        header={
          <>
            {/*
              分组表头（可选）：第一行是归属（例如「本品（B0SAMPLE01）」「竞品1（B0SAMPLE02）」），
              第二行才是各自字段名。首列自动 `rowSpan=2` —— 日期/名称那类列跨越两行更符合读表直觉，
              因此服务端的 `groups` 只描述除首列以外的列（约定见 `AnswerTableGroup`）。
            */}
            {hasGroups && (
              <TableRow>
                <TableHead
                  className='align-bottom whitespace-nowrap'
                  rowSpan={2}
                >
                  {primaryColumnLabel}
                </TableHead>
                {block.groups?.map((group) => (
                  <TableHead
                    className={cn(
                      TABLE_HEAD_NUMERIC,
                      'border-s text-center whitespace-nowrap',
                      toneClass(TONE_GROUP_HEAD_CLASS, group.tone)
                    )}
                    colSpan={group.span}
                    key={group.label}
                  >
                    {group.label}
                  </TableHead>
                ))}
              </TableRow>
            )}
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header, headerIndex) => {
                  // 有分组表头时，首列已由上一行的 rowSpan 占住，这一行不能再渲染它
                  if (hasGroups && headerIndex === 0) return null
                  const headerMeta = header.column.columnDef.meta as
                    | { align?: string; tone?: number }
                    | undefined
                  const align = headerMeta?.align
                  return (
                    <TableHead
                      className={cn(
                        'whitespace-nowrap',
                        align === 'right' && TABLE_HEAD_NUMERIC,
                        hasGroups && headerIndex > 0 && 'border-s',
                        toneClass(TONE_FIELD_HEAD_CLASS, headerMeta?.tone)
                      )}
                      key={header.id}
                    >
                      {header.column.getCanSort() ? (
                        <button
                          className='inline-flex items-center gap-1 hover:text-foreground'
                          type='button'
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          {header.column.getIsSorted() === 'asc' && (
                            <ArrowUp className='size-3' />
                          )}
                          {header.column.getIsSorted() === 'desc' && (
                            <ArrowDown className='size-3' />
                          )}
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </>
        }
        isEmpty={table.getRowModel().rows.length === 0}
      >
        {table.getRowModel().rows.map((row) => {
          /*
           * 行级归属色（可选）：`row.original.__tone` —— 一张表里"一行属于本品、另一行属于竞品"时
           * （竞品分析的 TOP 流量词 / 差评高频词），归属写在角色列里，只能整行铺色。
           * 读 `row.original` 而不是索引：排序后行序会变，颜色必须跟着行走。
           * 列自身的 `tone` 优先（列归属比行归属更具体）。
           */
          const rowTone = (row.original as { __tone?: number } | undefined)
            ?.__tone
          return (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => {
                const cellMeta = cell.column.columnDef.meta as
                  | { align?: string; tone?: number }
                  | undefined
                const align = cellMeta?.align
                return (
                  <TableCell
                    className={cn(
                      'whitespace-nowrap',
                      align === 'right' && TABLE_CELL_NUMERIC,
                      toneClass(TONE_CELL_CLASS, cellMeta?.tone ?? rowTone)
                    )}
                    key={cell.id}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                )
              })}
            </TableRow>
          )
        })}
      </DataTable>
      {block.note && (
        <p className='text-xs text-muted-foreground'>{block.note}</p>
      )}
    </section>
  )
}

/** 趋势图 / 柱状图：用项目已有的 recharts。 */
function ChartBlock({ block }: { block: AnswerBlock }) {
  const series = block.series ?? []
  const colors = useChartColors(series.length)
  const data = block.data ?? []
  const isBar = block.chartType === 'bar'
  const xKey = block.xKey ?? (isBar ? 'asin' : 'date')

  const axis = (
    <>
      <CartesianGrid strokeDasharray='3 3' vertical={false} />
      <XAxis dataKey={xKey} fontSize={11} tickLine={false} />
      <YAxis fontSize={11} tickLine={false} width={52} />
      <Tooltip
        contentStyle={{ fontSize: 12, borderRadius: 8 }}
        formatter={(value) => formatValue(value)}
      />
      <Legend wrapperStyle={{ fontSize: 12 }} />
    </>
  )

  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='flex items-center gap-2 text-sm'>
          <BarChart3 className='size-4 text-muted-foreground' />
          {block.title ?? (isBar ? '对比图' : '趋势图')}
        </CardTitle>
      </CardHeader>
      <CardContent className='pt-0'>
        {data.length === 0 ? (
          <p className='text-sm text-muted-foreground'>
            区间内没有可用于绘图的数据。
          </p>
        ) : (
          <div className='h-64 w-full'>
            <ResponsiveContainer height='100%' width='100%'>
              {isBar ? (
                <BarChart
                  data={data}
                  margin={{ top: 8, right: 12, bottom: 0, left: -12 }}
                >
                  {axis}
                  {series.map((item, index) => (
                    <Bar
                      dataKey={item.key}
                      fill={colors[index] ?? 'currentColor'}
                      key={item.key}
                      name={item.label}
                      radius={[3, 3, 0, 0]}
                    />
                  ))}
                </BarChart>
              ) : (
                <LineChart
                  data={data}
                  margin={{ top: 8, right: 12, bottom: 0, left: -12 }}
                >
                  {axis}
                  {series.map((item, index) => (
                    <Line
                      connectNulls={false}
                      dataKey={item.key}
                      dot={false}
                      key={item.key}
                      name={item.label}
                      stroke={colors[index] ?? 'currentColor'}
                      strokeWidth={2}
                      type='monotone'
                    />
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
        {block.note && (
          <p className='mt-2 text-xs text-muted-foreground'>{block.note}</p>
        )}
      </CardContent>
    </Card>
  )
}

export function AnswerBlocks({ blocks }: { blocks: AnswerBlock[] }) {
  if (!blocks || blocks.length === 0) return null
  const uniqueBlocks = dedupeAnswerBlocks(blocks)
  return (
    <div className='mt-4 space-y-4'>
      {uniqueBlocks.map((block, index) => {
        const key = `${block.kind}-${block.title ?? index}`
        if (block.kind === 'metrics')
          return <MetricsBlock block={block} key={key} />
        if (block.kind === 'table')
          return <TableBlock block={block} key={key} />
        if (block.kind === 'chart')
          return <ChartBlock block={block} key={key} />
        return null
      })}
    </div>
  )
}

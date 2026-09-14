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
import { cn } from '@/lib/utils'
import { useTheme } from '@/context/theme-provider'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { AnswerBlock, AnswerMetricItem } from '../types'

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
        meta: { align: column.align },
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
      <div className='overflow-x-auto rounded-lg border'>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const align = (
                    header.column.columnDef.meta as
                      | { align?: string }
                      | undefined
                  )?.align
                  return (
                    <TableHead
                      className={cn(
                        'whitespace-nowrap',
                        align === 'right' && 'text-right'
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
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 && (
              <TableRow>
                <TableCell
                  className='text-muted-foreground'
                  colSpan={(block.columns ?? []).length}
                >
                  没有数据行。
                </TableCell>
              </TableRow>
            )}
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => {
                  const align = (
                    cell.column.columnDef.meta as { align?: string } | undefined
                  )?.align
                  return (
                    <TableCell
                      className={cn(
                        'whitespace-nowrap tabular-nums',
                        align === 'right' && 'text-right'
                      )}
                      key={cell.id}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
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

/** 按块类型渲染；未知类型忽略而不报错（服务端新增块类型时前端不至于白屏）。 */
export function AnswerBlocks({ blocks }: { blocks: AnswerBlock[] }) {
  if (!blocks || blocks.length === 0) return null
  return (
    <div className='mt-4 space-y-4'>
      {blocks.map((block, index) => {
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

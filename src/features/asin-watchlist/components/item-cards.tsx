import { BarChart3, Copy, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { CARD_GRID } from '@/features/ai-agent/components/list-layout'
import {
  ACOS_ALERT_THRESHOLD,
  coverageTone,
  formatMoney,
  formatNumber,
  formatPercent,
} from '../format'
import type { MyAsinTableRow } from '../types'

type MetricField = {
  key: 'spend' | 'adSales' | 'orders' | 'acos' | 'units' | 'businessSales'
  label: string
  format: (value: number | null | undefined) => string
  /** 超过预警线时标色（只有 ACoS 有） */
  alertable?: boolean
}

const METRIC_FIELDS: MetricField[] = [
  { key: 'spend', label: '花费', format: formatMoney },
  { key: 'adSales', label: '广告销售额', format: formatMoney },
  { key: 'orders', label: '广告订单', format: formatNumber },
  { key: 'acos', label: 'ACoS', format: formatPercent, alertable: true },
  { key: 'units', label: '销量', format: formatNumber },
  { key: 'businessSales', label: '销售额', format: formatMoney },
]

type ItemCardsProps = {
  rows: MyAsinTableRow[]
  selectedIds: Set<number>
  onToggleSelect: (id: number, checked: boolean) => void
  onEdit: (row: MyAsinTableRow) => void
  /** 录入该条在这个区间的人工指标 */
  onMetrics: (row: MyAsinTableRow) => void
  onRemove: (row: MyAsinTableRow) => void
  onCopy: (asin: string) => void
}

/**
 * 「我的 ASIN」卡片视图（参考提示词广场的卡片列表）。
 *
 * 与表格视图是**同一批数据的两种读法**：表格适合横向比数字（列对齐、可排序、可多选），
 * 卡片适合"一条一条看"（每张卡自带指标与操作，不用横向滚动）。
 *
 * 三条约束：
 * ① 网格用共享的 `CARD_GRID`（`auto-rows-fr`，所有卡片严格等高）——
 *    高度由内容最多的那张决定，因此备注只留两行，完整内容在编辑弹窗里；
 * ② 指标格固定 3 列 × 2 行，`null` 显示「—」而不是 0（与表格同一口径）；
 * ③ 勾选框与表格视图共用同一份"当前页选中"状态，切视图不会丢选择。
 */
export function ItemCards({
  rows,
  selectedIds,
  onToggleSelect,
  onEdit,
  onMetrics,
  onRemove,
  onCopy,
}: ItemCardsProps) {
  return (
    <div className={CARD_GRID}>
      {rows.map((row) => {
        const metrics = row.metrics
        return (
          <div
            key={row.id}
            className='flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground'
            data-state={selectedIds.has(row.id) ? 'selected' : undefined}
          >
            <div className='flex items-start gap-2'>
              <Checkbox
                aria-label={`选择 ${row.asin}（${row.marketplace} 站）`}
                checked={selectedIds.has(row.id)}
                className='mt-0.5'
                onCheckedChange={(checked) =>
                  onToggleSelect(row.id, checked === true)
                }
              />
              <div className='min-w-0 flex-1 space-y-1'>
                <div className='flex flex-wrap items-center gap-1.5'>
                  <span className='font-mono text-sm font-medium'>
                    {row.asin}
                  </span>
                  <Button
                    aria-label={`复制 ${row.asin}`}
                    className='size-6'
                    size='icon'
                    type='button'
                    variant='ghost'
                    onClick={() => onCopy(row.asin)}
                  >
                    <Copy className='size-3.5' aria-hidden='true' />
                  </Button>
                </div>
                <div className='flex flex-wrap items-center gap-1.5'>
                  <Badge variant='outline' className='font-normal'>
                    {row.marketplace}
                  </Badge>
                  <CoverageBadge coverage={metrics?.coverage} />
                  {metrics?.manual && (
                    <Badge variant='secondary' className='font-normal'>
                      手工
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            <div className='space-y-0.5 text-xs'>
              <p className='truncate text-sm' title={row.alias ?? undefined}>
                {row.alias ?? (
                  <span className='text-muted-foreground/70'>未设别名</span>
                )}
              </p>
              <p
                className='line-clamp-2 text-muted-foreground'
                title={row.note ?? undefined}
              >
                {row.note ?? '（无备注）'}
              </p>
            </div>

            <dl className='grid grid-cols-3 gap-x-2 gap-y-2 border-t pt-3'>
              {METRIC_FIELDS.map((field) => {
                const value = metrics?.[field.key] ?? null
                const alert =
                  field.alertable &&
                  value !== null &&
                  value > ACOS_ALERT_THRESHOLD
                return (
                  <div key={field.key} className='min-w-0'>
                    <dt className='truncate text-[11px] text-muted-foreground'>
                      {field.label}
                    </dt>
                    <dd
                      className={cn(
                        'truncate text-sm tabular-nums',
                        value === null && 'text-muted-foreground',
                        alert && 'font-medium text-destructive'
                      )}
                      title={field.format(value)}
                    >
                      {field.format(value)}
                    </dd>
                  </div>
                )
              })}
            </dl>

            <div className='mt-auto flex items-center justify-end gap-1 border-t pt-2'>
              <Button
                aria-label={`录入 ${row.asin} 的指标`}
                className='gap-1.5'
                size='sm'
                type='button'
                variant='ghost'
                onClick={() => onMetrics(row)}
              >
                <BarChart3 aria-hidden='true' />
                录入指标
              </Button>
              <Button
                className='gap-1.5'
                size='sm'
                type='button'
                variant='ghost'
                onClick={() => onEdit(row)}
              >
                <Pencil aria-hidden='true' />
                编辑
              </Button>
              <Button
                aria-label={`从列表移除 ${row.asin}`}
                className='gap-1.5'
                size='sm'
                type='button'
                variant='ghost'
                onClick={() => onRemove(row)}
              >
                <Trash2 aria-hidden='true' />
                移除
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * 数据覆盖。
 *
 * 「无数据」用 destructive 变体而不是一把灰字：它意味着这个 ASIN 在所选区间
 * **完全没有报表记录**，需要用户去确认站点或报表导入，是一个待办项。
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

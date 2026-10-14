import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 一项指标：`value` 传 `null` 表示加载中，由组件统一渲染占位。 */
type MetricItem = {
  label: string
  /** 加载中传 `null`，由本组件统一渲染占位，避免各页各写一份骨架屏。 */
  value: ReactNode
  /** 补充口径的短文案（如"全部账号"），跟在同一行后面，不单独占一行。 */
  hint?: string
}

/**
 * 治理页统一「指标条」（2026-09-15 简化）。
 *
 * 为什么不是统计卡网格：四张卡每张 80~100px（`pt-4` + 三行文本 + 卡片内边距），
 * 加间距就把首屏切掉近一半，而表格才是这些页面的主体。这些数字只是"进页面先扫一眼"
 * 的定位信息，一行足够；口径说明跟在数字后面而不是另起一行。
 *
 * 折行策略：`flex-wrap` 按整项折行（不是把一项拆成两行），窄屏下自然变成两行指标，
 * 不需要额外的栅格断点，也不会出现"数字和它的标签各在一行"的错位。
 */
export function MetricStrip({
  items,
  className,
}: {
  items: MetricItem[]
  className?: string
}) {
  return (
    <dl
      className={cn(
        'flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-md border bg-muted/30 px-3 py-2',
        className
      )}
    >
      {items.map((item) => (
        <div className='flex items-baseline gap-1.5' key={item.label}>
          <dt className='text-xs text-muted-foreground'>{item.label}</dt>
          <dd className='text-base leading-none font-semibold tabular-nums'>
            {item.value === null || item.value === undefined ? (
              <span className='text-muted-foreground'>—</span>
            ) : (
              item.value
            )}
            {item.hint && (
              <span className='ms-1.5 text-xs font-normal text-muted-foreground'>
                {item.hint}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

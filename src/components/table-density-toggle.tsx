import type { TableDensity } from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type TableDensityToggleProps = {
  density: TableDensity
  onDensityChange: (density: TableDensity) => void
  className?: string
}

/**
 * 表格密度切换（舒适 / 紧凑）。
 *
 * 放在工具条里、与搜索筛选同一行：密度是"我怎么看这张表"，与"看哪几条"属于同一层动作。
 * 两档按钮用 `aria-pressed` 表达选中态（分段控件的语义），而不是当作选项卡 ——
 * 它与"视图切换"不是一回事，用 `role="tab"` 会污染页面上真正的选项卡。
 */
export function TableDensityToggle({
  density,
  onDensityChange,
  className,
}: TableDensityToggleProps) {
  return (
    <div
      aria-label='表格密度'
      className={cn('flex items-center rounded-lg border p-0.5', className)}
      role='group'
    >
      <Button
        aria-pressed={density === 'comfortable'}
        className='h-7 px-2.5'
        size='sm'
        type='button'
        variant={density === 'comfortable' ? 'secondary' : 'ghost'}
        onClick={() => onDensityChange('comfortable')}
      >
        舒适
      </Button>
      <Button
        aria-pressed={density === 'compact'}
        className='h-7 px-2.5'
        size='sm'
        type='button'
        variant={density === 'compact' ? 'secondary' : 'ghost'}
        onClick={() => onDensityChange('compact')}
      >
        紧凑
      </Button>
    </div>
  )
}

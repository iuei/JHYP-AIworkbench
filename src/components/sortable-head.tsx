import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { SortDirection } from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { TableHead } from '@/components/ui/table'

type SortableHeadProps<K extends string> = {
  label: ReactNode
  /** 本列绑定的排序键 */
  sortKey: K
  /** 当前生效的排序键 */
  activeKey: K
  direction: SortDirection
  className?: string
  /** 点这一列时调用方决定"换成这一列的默认方向"，还是"同一列翻转方向" */
  onToggle: (key: K) => void
}

/**
 * 可排序表头（全站共享）。
 *
 * 为什么值得抽出来：可排序表头的 `aria-sort`、图标三态（未排序 / 升 / 降）、键盘可达性
 * 三件事每页都要写一遍，而其中**只有 `aria-sort` 会被读屏和端到端脚本依赖** ——
 * 各页各写必然漂移。2026-09-16 从 ASIN 清单条目表抽出，供列表页复用。
 *
 * 可访问名称用「按 X 排序」而不是光一个列名：列名会与页面上的其它按钮撞名
 * （表头「ASIN」与工具栏「添加 ASIN」），读屏与自动化都分不清哪个是哪个 —— 同名冲突
 * 在 ASIN 页面真实踩过（`getByLabel` 解析到两个元素导致验收失败）。
 */
export function SortableHead<K extends string>({
  label,
  sortKey,
  activeKey,
  direction,
  className,
  onToggle,
}: SortableHeadProps<K>) {
  const active = activeKey === sortKey
  return (
    <TableHead
      aria-sort={
        active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
      }
      className={className}
    >
      <button
        type='button'
        aria-label={`按 ${typeof label === 'string' ? label : ''} 排序`}
        className={cn(
          'inline-flex items-center gap-1 rounded-md transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          active ? 'text-foreground' : 'text-muted-foreground'
        )}
        onClick={() => onToggle(sortKey)}
      >
        {label}
        {active ? (
          direction === 'asc' ? (
            <ArrowUp className='size-3.5' aria-hidden='true' />
          ) : (
            <ArrowDown className='size-3.5' aria-hidden='true' />
          )
        ) : (
          <ArrowUpDown className='size-3.5 opacity-50' aria-hidden='true' />
        )}
      </button>
    </TableHead>
  )
}

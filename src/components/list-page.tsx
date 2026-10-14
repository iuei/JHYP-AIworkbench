import type { ReactNode } from 'react'
import { SearchIcon } from 'lucide-react'
import { TABLE_SEARCH_ICON, TABLE_SEARCH_INPUT } from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

/**
 * 列表页壳：把"列表页都该长一样"的那几层固定下来。
 *
 * ### 它管什么、不管什么
 *
 * 管：**工具区的位置与两行结构**（上排检索、下排动作）、表格与工具区的间距。
 * 不管：**外框**。`DataTable` 自己就带一层 `rounded-lg border`，
 * 壳再包一层卡片就是项目里反复批评过的"Card 套 DataTable 双层描边"
 * （ASIN 明细页为此专门去掉过一层）。所以这里刻意**没有**卡片容器。
 *
 * ### 为什么用插槽而不是配置数组
 *
 * 与 `DataTable` 同一条理由：各列表页的工具区差异很大（日期范围、分段控件、
 * 权限相关的按钮、导出菜单），写成配置数组只会把复杂度搬个地方。
 * 槽位保证的是**顺序与对齐一致**，内容仍由各页自己写。
 *
 * 参考形态（2026-09-17 按需求截图定的）：
 *
 * ```
 * [搜索框 ............]  [筛选一] [筛选二]
 * [主按钮] [按钮] [置灰按钮]              [右侧图标组]
 * ────────────────────────────────────────────────
 * 表格
 * ```
 */
export function ListPageShell({
  search,
  filters,
  actions,
  tools,
  children,
  className,
}: {
  /** 第一排左侧：检索输入 */
  search?: ReactNode
  /** 第一排右侧：筛选控件（下拉、日期范围、分段控件） */
  filters?: ReactNode
  /** 第二排左侧：动作按钮组（含禁用态） */
  actions?: ReactNode
  /** 第二排右侧：辅助图标组（刷新、密度、列设置） */
  tools?: ReactNode
  /** 表格区（通常是一个 `DataTable`） */
  children: ReactNode
  className?: string
}) {
  const hasToolbarRow = Boolean(search || filters)
  const hasActionRow = Boolean(actions || tools)

  return (
    <div className={cn('space-y-4', className)}>
      {hasToolbarRow && (
        <div className='flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center'>
          {search}
          {filters && (
            <div className='flex flex-wrap items-center gap-2'>{filters}</div>
          )}
        </div>
      )}
      {hasActionRow && (
        <div className='flex flex-wrap items-center gap-2'>
          {actions}
          {tools && (
            <div className='ms-auto flex items-center gap-1'>{tools}</div>
          )}
        </div>
      )}
      {children}
    </div>
  )
}

/**
 * 工具区的检索输入。
 *
 * 抽它是因为"搜索图标 + 逻辑内边距"这段写法在 6 个列表页里各写了一遍
 * （`TABLE_SEARCH_ICON` / `TABLE_SEARCH_INPUT` 两个常量早就抽出来了，
 * 但把它们拼进 `Input` 的这段 JSX 没有）—— 漏一个 `relative` 图标就会跳到框外。
 *
 * **实时筛选用 `onChange`，回车提交用 `onSearch`**：两种模式都合法，
 * 前者适合前端已持有全量数据的列表（用户管理），后者适合检索要走服务端的列表。
 * `hint`（如「回车搜索」）只在后者才该传 —— 实时过滤的框上写"回车搜索"是误导。
 */
export function ListSearchInput({
  value,
  onChange,
  onSearch,
  placeholder,
  label,
  hint,
  className,
}: {
  value: string
  onChange: (value: string) => void
  onSearch?: (value: string) => void
  placeholder?: string
  /** 可访问名称。图标搜索框没有可见 Label，必须给一个（否则读屏只念"编辑框"） */
  label: string
  /** 输入框右侧的提示文字，如「回车搜索」 */
  hint?: string
  className?: string
}) {
  return (
    <form
      role='search'
      data-list-search
      className={cn('relative min-w-0 flex-1 lg:max-w-sm', className)}
      onSubmit={(event) => {
        // 不 preventDefault 会在回车时把整页提交掉（表单默认行为）
        event.preventDefault()
        onSearch?.(value)
      }}
    >
      <SearchIcon aria-hidden='true' className={TABLE_SEARCH_ICON} />
      <Input
        aria-label={label}
        className={cn(TABLE_SEARCH_INPUT, hint && 'pe-20')}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && (
        <span
          aria-hidden='true'
          className='pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground'
        >
          {hint}
        </span>
      )}
    </form>
  )
}

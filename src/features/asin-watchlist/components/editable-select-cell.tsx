import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type EditableSelectCellProps = {
  value: string
  options: Array<{ label: string; value: string }>
  /** 无障碍名称：读屏与 Playwright 都靠它定位"这是哪一行的哪一列" */
  ariaLabel: string
  className?: string
  disabled?: boolean
  onSave: (next: string) => void
}

/**
 * 可下拉选择的单元格（点击 → 选择 → 立即保存，Esc / 点外部取消）。
 *
 * 与 `EditableCell`（文本输入）成对存在：站点这类**取值来自固定枚举**的字段用文本框改
 * 只会让人手打错（`us` / `美国` / `USA`），而它是取数口径的一部分，写错就等于取错站点。
 *
 * 值没变时不发请求 —— 与就地编辑同一口径：点一下就 PATCH 会把 `updated_at` 冲掉。
 *
 * 交互上刻意"一次点击就展开"：先点开按钮再点下拉是两次交互，而这一列的修改频率很低、
 * 每次只改一个值，多一次点击没有任何收益。
 */
export function EditableSelectCell({
  value,
  options,
  ariaLabel,
  className,
  disabled,
  onSave,
}: EditableSelectCellProps) {
  const [editing, setEditing] = useState(false)
  const current = options.find((option) => option.value === value)

  if (editing) {
    return (
      <Select
        open
        value={value}
        onValueChange={(next) => {
          setEditing(false)
          if (next !== value) onSave(next)
        }}
        onOpenChange={(open) => {
          if (!open) setEditing(false)
        }}
      >
        <SelectTrigger
          aria-label={ariaLabel}
          className='h-7 w-full min-w-24'
          size='sm'
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return (
    <button
      type='button'
      aria-label={`${ariaLabel}（点击修改）`}
      className={cn(
        'group/edit flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-start transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className
      )}
      disabled={disabled}
      onClick={() => setEditing(true)}
    >
      <Badge variant='outline' className='font-normal'>
        {current?.label ?? value}
      </Badge>
      <ChevronDown
        aria-hidden='true'
        className='size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/edit:opacity-100 group-focus-visible/edit:opacity-100'
      />
    </button>
  )
}

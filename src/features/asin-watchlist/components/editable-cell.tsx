import { useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { TABLE_EMPTY_VALUE } from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

type EditableCellProps = {
  value: string | null
  /** 空值时的占位提示（仅在输入态显示） */
  placeholder: string
  /** 无障碍名称：读屏与 Playwright 都靠它定位"这是哪一行的哪一列" */
  ariaLabel: string
  className?: string
  disabled?: boolean
  onSave: (next: string) => void
}

/**
 * 可就地编辑的单元格（点击 → 输入 → Enter 保存 / Esc 取消 / 失焦保存）。
 *
 * 为什么值得单做一层：清单上千条时，最高频的维护动作是"给某几条补别名"。
 * 走弹窗要经历"点铅笔 → 弹窗 → 填 → 保存 → 关闭"五次交互，就地编辑只要两次；
 * 弹窗仍保留（操作列的铅笔按钮），因为它能同时改别名与备注、且备注是长文本。
 *
 * 保存语义：只有真的改了才发请求（把"点一下就走"变成一次无意义的 PATCH
 * 会污染 `updated_at`，清单排序也跟着乱跳）。
 */
export function EditableCell({
  value,
  placeholder,
  ariaLabel,
  className,
  disabled,
  onSave,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // 提交后再卸载输入框时，onBlur 会二次触发保存 —— 用它把"一次编辑"锁成只提交一次
  const committedRef = useRef(false)

  function startEditing() {
    committedRef.current = false
    setDraft(value ?? '')
    setEditing(true)
  }

  function commit() {
    if (committedRef.current) return
    committedRef.current = true
    setEditing(false)
    const next = draft.trim()
    if (next === (value ?? '')) return
    onSave(next)
  }

  if (editing) {
    return (
      <Input
        autoFocus
        aria-label={ariaLabel}
        className='h-7 w-full min-w-28'
        disabled={disabled}
        placeholder={placeholder}
        value={draft}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            committedRef.current = true
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <button
      type='button'
      aria-label={`${ariaLabel}（点击编辑）`}
      className={cn(
        'group/edit flex w-full min-w-28 items-center gap-1.5 rounded-md px-1.5 py-1 text-start transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className
      )}
      disabled={disabled}
      title={value ?? undefined}
      onClick={startEditing}
    >
      <span className={cn('truncate', !value && 'text-muted-foreground/70')}>
        {value ?? TABLE_EMPTY_VALUE}
      </span>
      <Pencil
        aria-hidden='true'
        className='size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/edit:opacity-100 group-focus-visible/edit:opacity-100'
      />
    </button>
  )
}

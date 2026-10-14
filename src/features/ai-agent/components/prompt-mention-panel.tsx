import { useEffect, useMemo, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { PromptMentionGroup } from '../prompt-mention'

type Props = {
  groups: PromptMentionGroup[]
  activeIndex: number
  loading: boolean
  error: boolean
  truncated: boolean
  keyword: string
  onSelect: (index: number) => void
  onHover: (index: number) => void
}

/**
 * `@提示词` 选择面板。
 *
 * 定位交给父容器（`relative` + 本组件的 `absolute bottom-full`）：面板浮在**输入框上方**，
 * 这样不会挡住用户正在写的文字，也不会把输入区往下推。
 *
 * 无障碍：整体 `role="listbox"`，每项 `role="option"` 并带 `aria-selected`，
 * 高亮项用 `aria-activedescendant` 之外的方式表达（键盘操作由输入框统一转发，
 * 不把 textarea 改成 combobox，避免改变其原有表单语义）。
 */
export function PromptMentionPanel({
  groups,
  activeIndex,
  loading,
  error,
  truncated,
  keyword,
  onSelect,
  onHover,
}: Props) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  /**
   * 给每个条目算好**扁平下标**（分组渲染但键盘是线性移动的）。
   * 用 useMemo 里的局部游标，而不是在 `map` 回调里自增外部变量——
   * 后者会被 `react-hooks/immutability` 判为"渲染结束后仍在改值"。
   */
  const indexedGroups = useMemo(() => {
    let cursor = 0
    return groups.map((group) => ({
      label: group.label,
      items: group.items.map((prompt) => ({ prompt, index: cursor++ })),
    }))
  }, [groups])

  // 键盘上下移动时把高亮项滚进可视区，否则第 5 条之后看不见选了哪个
  useEffect(() => {
    itemRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return (
    <div
      aria-label='提示词选择'
      className='absolute start-0 bottom-full z-50 mb-2 max-h-72 w-full overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-md'
      role='listbox'
    >
      <p className='px-2 py-1.5 text-xs text-muted-foreground'>
        {keyword ? `匹配「${keyword}」的提示词` : '选择要插入的提示词'}
        <span className='ms-2 opacity-70'>↑↓ 选择 · Enter 插入 · Esc 关闭</span>
      </p>

      {loading && (
        <p className='flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground'>
          <Loader2 className='size-3.5 animate-spin' />
          正在加载…
        </p>
      )}

      {!loading && error && (
        <p className='px-2 py-2 text-sm text-muted-foreground'>
          提示词加载失败，可直接继续输入你的问题。
        </p>
      )}

      {!loading && !error && groups.length === 0 && (
        <p className='px-2 py-2 text-sm text-muted-foreground'>
          没有匹配的提示词，可直接继续输入你的问题。
        </p>
      )}

      {indexedGroups.map((group) => (
        <div key={group.label}>
          <p className='px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground'>
            {group.label}
          </p>
          {group.items.map(({ prompt, index: current }) => {
            const active = current === activeIndex
            return (
              <button
                aria-selected={active}
                className={cn(
                  'block w-full rounded-lg px-2 py-2 text-left transition-colors',
                  active ? 'bg-muted' : 'hover:bg-muted/60'
                )}
                key={prompt.id}
                ref={(element) => {
                  itemRefs.current[current] = element
                }}
                role='option'
                type='button'
                // mousedown 会先于 blur 触发，用 mousedown 选中可避免点不到（输入框失焦导致面板卸载）
                onMouseDown={(event) => {
                  event.preventDefault()
                  onSelect(current)
                }}
                onMouseEnter={() => onHover(current)}
              >
                <span className='flex items-center gap-2'>
                  <span className='text-sm font-medium'>{prompt.name}</span>
                  {prompt.status !== 'published' && (
                    <span className='text-xs text-muted-foreground'>
                      仅自己可用
                    </span>
                  )}
                </span>
                {/* 副行显示「说明」而不是已下线的「标题」：说明写的是"什么时候用"，信息量更大 */}
                {prompt.summary && (
                  <span className='mt-0.5 block truncate text-xs text-muted-foreground'>
                    {prompt.summary}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ))}

      {truncated && (
        <p className='px-2 py-1.5 text-xs text-muted-foreground'>
          结果较多，已显示前 20 条，继续输入可缩小范围。
        </p>
      )}
    </div>
  )
}

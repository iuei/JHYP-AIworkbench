import { useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * 每页条数选项：与各接口的 pageSize 上限（100）对齐。
 * 不导出 —— 本文件只导出组件，混出常量会让 fast refresh 失效（见 eslint 规则）。
 */
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const

type TablePaginationProps = {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  /** 传了才渲染「每页条数」选择器 */
  onPageSizeChange?: (pageSize: number) => void
  /** 加载中禁用翻页：连点会产生交错请求，最后到哪一页取决于响应顺序 */
  disabled?: boolean
  /**
   * 显示「跳至第 N 页」输入框。默认关闭 —— 总页数只有几页的列表加它只是噪音，
   * 而几百页的清单（5000 条 / 每页 50）没有它就只能一页页点。
   */
  jumpTo?: boolean
  className?: string
}

/**
 * 全站统一分页器。
 *
 * 为什么要有它：知识库、经验审核、导入记录、审计台的列表此前各写一份"上一页/下一页"，
 * 文案、禁用条件、是否显示总数都不一致，而且**分页器只在 total > pageSize 时出现** ——
 * 恰好只有一页时看不到"共 N 条"，最容易让人以为数据被截断。
 * 统一走这里：总数、当前页、每页条数、首/末页都在同一处定义。
 *
 * 服务端分页优先（而非前端切片）：会长期累积的列表用前端切片仍要把全量数据拉下来。
 * 例外是"有明确小上限、且筛选逻辑已在前端"的列表（如用户管理：账号数有自然量级、
 * `filterUsers` 已有单测），那种情况下前端切片能保证"先筛后排再分页"的语义正确。
 *
 * 2026-09-15 从 `features/ai-agent/components/` 移到 `components/`：它早就被 ASIN 清单
 * 跨模块引用，放在 ai-agent 目录里等于让别的模块依赖它的内部结构。
 */
export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  disabled,
  jumpTo,
  className,
}: TablePaginationProps) {
  // 跳页输入是非受控草稿：页码的真相只属于调用方，这里只负责"把用户敲的页码夹紧后交出去"
  const [jumpDraft, setJumpDraft] = useState('')

  if (total === 0) return null
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  /*
   * 显示用页码夹紧。
   *
   * 数据变少（审核通过、删除、筛选后结果变短）时，调用方的页码 state 可能还停在
   * 更大的值上，出现「第 3 / 2 页」这种自相矛盾的文案。这里只修正**显示**与
   * 翻页按钮的可用性，不去回写调用方的 state —— 在 effect 里同步 setState 会多一次
   * 级联渲染（本仓库 eslint 的 `react-hooks/set-state-in-effect` 也会直接报错）。
   */
  const currentPage = Math.min(page, totalPages)
  const canPrev = currentPage > 1
  const canNext = currentPage < totalPages

  /*
   * 跳页：只夹紧到 [1, totalPages] 后交给调用方。
   * 输入非法（空、非数字、0、超出总页数）时一律丢弃草稿并回到占位提示，
   * 不做"猜你想要第几页"的处理 —— 猜错会把人送到一个与预期无关的页。
   */
  function commitJump() {
    const parsed = Number(jumpDraft.trim())
    setJumpDraft('')
    if (!jumpDraft.trim() || !Number.isFinite(parsed)) return
    const target = Math.min(Math.max(1, Math.trunc(parsed)), totalPages)
    if (target !== currentPage) onPageChange(target)
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground',
        className
      )}
    >
      <div className='flex flex-wrap items-center gap-3'>
        <span>
          共 {total} 条 · 第 {currentPage} / {totalPages} 页
        </span>
        {jumpTo && totalPages > 1 && (
          <div className='flex items-center gap-1.5'>
            <label className='text-xs' htmlFor='table-pagination-jump'>
              跳至
            </label>
            <Input
              id='table-pagination-jump'
              aria-label='跳至页码'
              className='h-8 w-16 text-center tabular-nums'
              disabled={disabled}
              inputMode='numeric'
              placeholder={String(currentPage)}
              value={jumpDraft}
              onChange={(event) => setJumpDraft(event.target.value)}
              onBlur={commitJump}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  commitJump()
                } else if (event.key === 'Escape') {
                  setJumpDraft('')
                }
              }}
            />
            <span className='text-xs'>页</span>
          </div>
        )}
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        {onPageSizeChange && (
          <div className='flex items-center gap-1.5'>
            <span className='text-xs'>每页</span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => onPageSizeChange(Number(value))}
            >
              <SelectTrigger aria-label='每页条数' className='h-8 w-20'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className='flex items-center gap-1'>
          <Button
            aria-label='第一页'
            className='size-8'
            disabled={disabled || !canPrev}
            size='icon'
            variant='outline'
            onClick={() => onPageChange(1)}
          >
            <ChevronsLeft className='size-4' />
          </Button>
          <Button
            aria-label='上一页'
            className='size-8'
            disabled={disabled || !canPrev}
            size='icon'
            variant='outline'
            onClick={() => onPageChange(currentPage - 1)}
          >
            <ChevronLeft className='size-4' />
          </Button>
          <Button
            aria-label='下一页'
            className='size-8'
            disabled={disabled || !canNext}
            size='icon'
            variant='outline'
            onClick={() => onPageChange(currentPage + 1)}
          >
            <ChevronRight className='size-4' />
          </Button>
          <Button
            aria-label='最后一页'
            className='size-8'
            disabled={disabled || !canNext}
            size='icon'
            variant='outline'
            onClick={() => onPageChange(totalPages)}
          >
            <ChevronsRight className='size-4' />
          </Button>
        </div>
      </div>
    </div>
  )
}

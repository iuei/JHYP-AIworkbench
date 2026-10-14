import { LayoutGrid, Table2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ListLayout } from './list-layout'

type LayoutToggleProps = {
  layout: ListLayout
  onLayoutChange: (layout: ListLayout) => void
}

/**
 * 展示方式切换（表格 / 卡片）。
 *
 * DOM 与提示词广场原实现（2026-09-17）**逐字一致** —— `role=group` + `aria-pressed`
 * 分段按钮、「表格」「卡片」两个按钮 —— 既有的 `verify-prompt-optimize-ui.mjs`
 * 因此不需要改一行。
 */
export function LayoutToggle({ layout, onLayoutChange }: LayoutToggleProps) {
  return (
    <div
      aria-label='展示方式'
      className='flex items-center rounded-lg border p-0.5'
      role='group'
    >
      <Button
        aria-pressed={layout === 'table'}
        className='h-8 gap-1.5 px-3'
        size='sm'
        variant={layout === 'table' ? 'secondary' : 'ghost'}
        onClick={() => onLayoutChange('table')}
      >
        <Table2 className='size-3.5' aria-hidden='true' />
        表格
      </Button>
      <Button
        aria-pressed={layout === 'card'}
        className='h-8 gap-1.5 px-3'
        size='sm'
        variant={layout === 'card' ? 'secondary' : 'ghost'}
        onClick={() => onLayoutChange('card')}
      >
        <LayoutGrid className='size-3.5' aria-hidden='true' />
        卡片
      </Button>
    </div>
  )
}

import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/**
 * 治理页统一「行内图标操作按钮」（2026-09-15 简化）。
 *
 * 为什么统一成一个组件：列表操作列原本每个动作一个文字按钮（知识库 4 个、经验审核 6 个），
 * 窄列下折成两三行，把行高撑到 80px 以上。改成图标后，唯一能表达含义的就是按钮的可访问名，
 * 因此 Tooltip 文案与 `aria-label` **必须是同一个值**（本组件强制两者同源）：
 * Tooltip 服务鼠标用户、`aria-label` 服务读屏与端到端断言，少一处就会出现
 * "一排小图标没人知道是什么"或"自动化脚本再也点不到这个按钮"。
 */
export function RowAction({
  label,
  icon: Icon,
  onClick,
  destructive = false,
  className,
}: {
  label: string
  icon: LucideIcon
  onClick: () => void
  /** 破坏性动作（删除等）用红色图标提示后果。 */
  destructive?: boolean
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={cn(
            'size-8',
            destructive && 'text-destructive hover:text-destructive',
            className
          )}
          size='icon'
          variant='ghost'
          onClick={onClick}
        >
          <Icon className='size-4' />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

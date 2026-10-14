import { Link } from '@tanstack/react-router'
import { History, Plus, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

type ActionBarProps = {
  /** 最近一条分析记录的 id；为空表示没有可继续的记录，此时不渲染「继续上次分析」。 */
  lastAnalysisId: number | null
  className?: string
}

/**
 * 首页主操作条。
 *
 * 三个动作都必须比常用入口卡「少一步」才有存在价值，因此都带上下文：
 * 继续上次分析直接打开快照；另两个在目标页聚焦对应输入框。
 *
 * 刻意不做「分析我的 ASIN」：ASIN 清单页本来就默认选中第一个清单
 * （`useActiveWatchlist` 的 `selectedId ?? list[0]?.id`，见 `src/features/asin-watchlist/hooks.ts`），
 * 纯跳转与常用入口卡重复，属于看起来有用的假动作。
 *
 * 2026-09-20：放入「开始工作」卡片，按钮按操作优先级排列。
 */
export function ActionBar({ lastAnalysisId, className }: ActionBarProps) {
  return (
    <section aria-label='主要操作' className={cn(className)}>
      <div
        className={cn(
          'grid grid-cols-2 gap-2',
          lastAnalysisId === null
            ? 'sm:grid-cols-2'
            : 'sm:grid-cols-[1.4fr_1fr_0.8fr]'
        )}
      >
        {lastAnalysisId !== null && (
          <Button asChild className='col-span-2 w-full min-w-0 sm:col-span-1'>
            <Link
              to='/competitor-analysis'
              search={{ analysisId: lastAnalysisId }}
            >
              <History aria-hidden='true' />
              继续上次分析
            </Link>
          </Button>
        )}
        <Button
          asChild
          className='w-full'
          variant={lastAnalysisId === null ? 'default' : 'outline'}
        >
          <Link to='/competitor-analysis' search={{ focus: 'asin' }}>
            <Plus aria-hidden='true' />
            新建分析
          </Link>
        </Button>
        <Button asChild className='w-full' variant='outline'>
          <Link to='/ai-agent' search={{ focus: 'composer' }}>
            <Sparkles aria-hidden='true' />问 AI
          </Link>
        </Button>
      </div>
    </section>
  )
}

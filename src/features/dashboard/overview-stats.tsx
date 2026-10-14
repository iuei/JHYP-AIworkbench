import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ATTENTION_SCAN_LIMIT } from './analyses'

type OverviewStatsProps = {
  /**
   * 需立即处理的分析条数。
   *
   * 口径是**未销账**问题的最高级别为 `high`（`analyses.ts` 的 `pickAttentionAnalyses`）——
   * 用户在结论卡片上标记「我已处理」或「不处理」之后，这个数字要跟着降下去。
   */
  attentionCount: number
  /** 扫描范围内的分析记录条数 */
  analysisCount: number
  conversationCount: number
  notesTotal: number
  pendingTotal: number
  analysisLoading: boolean
  analysisError: boolean
  aiLoading: boolean
  aiError: boolean
}

/**
 * 工作概览统计行。
 *
 * **它不是新指标**：四个数字全部来自首页本来就要拉的两份数据 ——
 * `GET /api/competitor-analyses?limit=20` 的分析记录，以及「我的 AI」的三个接口
 * （`/ai/conversations`、`/ai/notes` 的 `total`）。没有新接口、没有新算法、不引入
 * 任何"看起来专业"的经营指标（经营数据只从报表来，首页不造）。
 *
 * 2026-09-20 起放在仪表盘最上方，四项数据等宽排列。
 *
 * **刻意不做成可点击入口**：点"需立即处理 3"跳到竞品分析、点"最近对话"跳到 AI 助手
 * 都是纯跳转 —— 上方主操作条与下方常用入口已经各有一套真实的带上下文入口，
 * 这里再加一层只是重复（同类判断见 `action-bar.tsx` 的注释）。
 *
 * 两个口径必须写在标签里，否则会被读成全库统计：
 * 分析记录与需处理都只覆盖「最近 20 次」的扫描范围。
 */
export function OverviewStats({
  attentionCount,
  analysisCount,
  conversationCount,
  notesTotal,
  pendingTotal,
  analysisLoading,
  analysisError,
  aiLoading,
  aiError,
}: OverviewStatsProps) {
  return (
    <Card
      role='region'
      aria-labelledby='overview-heading'
      className='min-w-0 gap-4 py-5'
    >
      <CardHeader>
        <CardTitle className='text-base'>
          <h2 id='overview-heading'>工作概览</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className='grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-4'>
          <Stat
            alert={attentionCount > 0}
            hint={`最近 ${ATTENTION_SCAN_LIMIT} 次内`}
            isLoading={analysisLoading}
            isError={analysisError}
            label='需立即处理'
            value={attentionCount}
          />
          <Stat
            hint={`最近 ${ATTENTION_SCAN_LIMIT} 次内`}
            isLoading={analysisLoading}
            isError={analysisError}
            label='分析记录'
            value={analysisCount}
          />
          <Stat
            isLoading={aiLoading}
            isError={aiError}
            label='最近对话'
            value={conversationCount}
          />
          <Stat
            /*
             * 文案刻意与「我的 AI」卡片里的徽标（「N 条待审核」）不同词序：
             * 同一句话在首屏出现两遍既啰嗦、又会让"按文本定位"的断言命中两个元素
             * （`index.test.tsx` 就撞过一次）。这里是"标签 + 数字"，卡片里是徽标句。
             */
            hint={pendingTotal > 0 ? `待审 ${pendingTotal} 条` : undefined}
            isLoading={aiLoading}
            isError={aiError}
            label='知识沉淀'
            value={notesTotal}
          />
        </dl>
      </CardContent>
    </Card>
  )
}

type StatProps = {
  label: string
  value: number
  /** 补充口径（如"最近 20 次内"），跟在标签后面 */
  hint?: string
  /** 需要被立刻看见的异常值（需立即处理 > 0） */
  alert?: boolean
  isLoading: boolean
  isError: boolean
}

function Stat({ label, value, hint, alert, isLoading, isError }: StatProps) {
  return (
    <div className='min-w-0 space-y-1 border-l-2 border-border/70 pl-3'>
      <dt className='text-xs text-muted-foreground'>
        {label}
        {hint && (
          <span className='block text-muted-foreground/70 sm:inline'>
            <span className='hidden sm:inline'> · </span>
            {hint}
          </span>
        )}
      </dt>
      <dd>
        {isLoading ? (
          <Skeleton className='h-7 w-10' />
        ) : isError ? (
          <span className='text-sm text-muted-foreground'>暂不可用</span>
        ) : (
          <span
            className={cn(
              'text-xl font-semibold tabular-nums',
              alert && 'text-destructive'
            )}
          >
            {value}
          </span>
        )}
      </dd>
    </div>
  )
}

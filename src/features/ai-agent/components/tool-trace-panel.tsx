import { CheckCircle2, Loader2, ShieldAlert, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { blockedNoticeText } from '../blocked-notice'
import type { StreamStep, ToolRun } from '../types'

const STATUS_META: Record<
  string,
  {
    label: string
    variant: 'default' | 'secondary' | 'destructive' | 'outline'
    className: string
  }
> = {
  ok: { label: '成功', variant: 'outline', className: 'text-primary' },
  blocked: { label: '被拦截', variant: 'destructive', className: '' },
  error: { label: '失败', variant: 'destructive', className: '' },
  pending: { label: '进行中', variant: 'secondary', className: '' },
}

/** 工具调用摘要（右栏「本次回答的依据」与消息内联展示共用）。 */
export function ToolRunList({ runs }: { runs: ToolRun[] }) {
  if (runs.length === 0) {
    return (
      <p className='text-sm text-muted-foreground'>本次回答没有工具调用。</p>
    )
  }
  return (
    <ul className='space-y-2'>
      {runs.map((run) => {
        const meta = STATUS_META[run.status] ?? STATUS_META.pending
        return (
          <li className='rounded-lg border p-3' key={run.id}>
            <div className='flex items-center justify-between gap-2'>
              <code className='truncate text-xs font-medium'>
                {run.toolName}
              </code>
              <Badge className={meta.className} variant={meta.variant}>
                {meta.label}
              </Badge>
            </div>
            <dl className='mt-2 space-y-1 text-xs text-muted-foreground'>
              <div className='flex gap-1'>
                <dt className='shrink-0'>参数：</dt>
                <dd className='min-w-0 break-all'>
                  {JSON.stringify(run.params)}
                </dd>
              </div>
              {run.summary && (
                <div className='flex gap-1'>
                  <dt className='shrink-0'>返回：</dt>
                  <dd className='min-w-0 break-words'>{run.summary}</dd>
                </div>
              )}
              {run.error && (
                <div className='flex gap-1 text-destructive'>
                  <dt className='shrink-0'>错误：</dt>
                  <dd className='min-w-0 break-words'>{run.error}</dd>
                </div>
              )}
              <div className='flex flex-wrap gap-x-3'>
                <span>返回行数 {run.rowCount ?? 0}</span>
                <span>耗时 {run.latencyMs ?? 0}ms</span>
              </div>
            </dl>
          </li>
        )
      })}
    </ul>
  )
}

/** 流式阶段的编排进展：让用户知道 Agent 实际做了什么（需求文档 §5.1 过程可见）。 */
export function StreamSteps({ steps }: { steps: StreamStep[] }) {
  if (steps.length === 0) return null
  return (
    <ul aria-live='polite' className='space-y-1.5'>
      {steps.map((step) => (
        <li
          className='flex items-center gap-2 text-xs text-muted-foreground'
          key={step.key}
        >
          {step.state === 'running' && (
            <Loader2 className='size-3.5 animate-spin' />
          )}
          {step.state === 'done' && (
            <CheckCircle2 className='size-3.5 text-primary' />
          )}
          {step.state === 'failed' && (
            <XCircle className='size-3.5 text-destructive' />
          )}
          <span className={cn(step.state === 'failed' && 'text-destructive')}>
            {step.label}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * 「本次回答被拦截」的提示条。
 *
 * **文案按真实原因分开**（2026-09-17 修）：此前无论什么原因都写"当前账号无权查询该数据，
 * 请联系管理员。"，而 `status='blocked'` 至少有三类完全不同的来源 ——
 * 工具没上线（后端没重启）、确实没权限、模型措辞违规被护栏替换。
 * 实测把用户带向"我是不是没权限"的错误排查方向，必须能分辨。
 * 映射表在 `../blocked-notice.ts`（纯函数模块，实时流与历史消息共用同一份）。
 */
export function BlockedNotice({
  className,
  reason = null,
}: {
  className?: string
  /** 拦截的细分原因（`tool_unavailable` / `forbidden` / `wording:*`）；不传时退回通用文案。 */
  reason?: string | null
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive',
        className
      )}
      role='alert'
    >
      <ShieldAlert className='size-4 shrink-0' />
      {blockedNoticeText(reason)}
    </div>
  )
}

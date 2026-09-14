import { useState } from 'react'
import { RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useMessageFeedback } from '../api/queries'
import type { AiMessage } from '../types'
import { AnswerBlocks } from './answer-blocks'
import { CitationList, FreshnessBar } from './citation-panel'
import { BlockedNotice, StreamSteps, ToolRunList } from './tool-trace-panel'

type AnswerCardProps = {
  message: AiMessage
  onRegenerate?: () => void
  canRegenerate?: boolean
}

/** AI 回答卡片：结论 → 支撑信息 → 引用来源 → 声明条 → 反馈（固定顺序）。 */
export function AnswerCard({
  message,
  onRegenerate,
  canRegenerate,
}: AnswerCardProps) {
  const feedback = useMessageFeedback()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [submitted, setSubmitted] = useState<'helpful' | 'unhelpful' | null>(
    null
  )

  const blocked = message.status === 'blocked'
  const failed = message.status === 'error'

  const submit = (type: 'helpful' | 'unhelpful', text?: string) => {
    feedback.mutate(
      { messageId: message.id, type, comment: text },
      {
        onSuccess: () => {
          setSubmitted(type)
          setDialogOpen(false)
          setComment('')
          toast.success(
            type === 'helpful' ? '感谢反馈' : '已记录问题，管理员会跟进处理'
          )
        },
        onError: () => toast.error('反馈提交失败，请稍后重试'),
      }
    )
  }

  return (
    <article
      className='rounded-xl border bg-card p-4'
      data-status={message.status}
      aria-label='AI 回答'
    >
      <header className='mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
        <span className='font-medium text-foreground'>AI 回答</span>
        {message.provider === 'demo' && (
          <span className='rounded-full bg-muted px-2 py-0.5'>演示模式</span>
        )}
        {message.latencyMs !== null && <span>耗时 {message.latencyMs}ms</span>}
        {message.tokensOut ? <span>{message.tokensOut} tokens</span> : null}
      </header>

      {message.runs.length > 0 && (
        <div className='mb-3 rounded-lg bg-muted/40 p-3'>
          <StreamSteps
            steps={message.runs.map((run) => ({
              key: `run-${run.id}`,
              label:
                run.status === 'ok'
                  ? `✓ 已${run.toolName}`
                  : `✕ ${run.toolName}（${run.error ?? '失败'}）`,
              state: run.status === 'ok' ? 'done' : 'failed',
              toolName: run.toolName,
            }))}
          />
        </div>
      )}

      {blocked && <BlockedNotice className='mb-3' />}

      {message.content && (
        <p className='text-sm leading-relaxed whitespace-pre-wrap'>
          {message.content}
        </p>
      )}

      {failed && !message.content && (
        <p className='text-sm text-destructive'>
          本次回答生成失败，未产生可用结论。
        </p>
      )}

      {/* 支撑数据（表格 / 趋势图 / 指标卡）：服务端算好的结构化块 */}
      <AnswerBlocks blocks={message.blocks ?? []} />

      {message.citations.length > 0 && (
        <section className='mt-4 space-y-2'>
          <h3 className='text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
            引用来源
          </h3>
          <CitationList citations={message.citations} />
        </section>
      )}

      <FreshnessBar citations={message.citations} className='mt-4' />

      <footer className='mt-3 flex flex-wrap items-center gap-2'>
        <Button
          className='h-8 gap-1.5 text-xs'
          disabled={feedback.isPending || submitted === 'helpful'}
          size='sm'
          variant='outline'
          onClick={() => submit('helpful')}
        >
          <ThumbsUp className='size-3.5' />
          {submitted === 'helpful' ? '已反馈有用' : '有用'}
        </Button>
        <Button
          className='h-8 gap-1.5 text-xs'
          disabled={feedback.isPending || submitted === 'unhelpful'}
          size='sm'
          variant='outline'
          onClick={() => setDialogOpen(true)}
        >
          <ThumbsDown className='size-3.5' />
          {submitted === 'unhelpful' ? '已反馈问题' : '有问题'}
        </Button>
        {onRegenerate && (
          <Button
            className='h-8 gap-1.5 text-xs'
            disabled={!canRegenerate}
            size='sm'
            variant='ghost'
            onClick={onRegenerate}
          >
            <RotateCcw className='size-3.5' />
            重新生成
          </Button>
        )}
      </footer>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>反馈问题</DialogTitle>
            <DialogDescription>
              反馈会记录到审计与知识库管理页，由管理员跟进处理（纠错反馈闭环）。
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-2'>
            <Label htmlFor='feedback-comment'>问题说明</Label>
            <Textarea
              id='feedback-comment'
              placeholder='例如：引用的制度文档已过期 / 结论与文档不一致'
              rows={4}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button
              disabled={feedback.isPending}
              onClick={() => submit('unhelpful', comment.trim() || undefined)}
            >
              提交反馈
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  )
}

/** 右侧「本次回答的依据」面板。 */
export function EvidencePanel({
  citations,
  runs,
  scopeLabel,
}: {
  citations: AiMessage['citations']
  runs: AiMessage['runs']
  scopeLabel: string
}) {
  return (
    <div className='space-y-5'>
      <section>
        <h3 className='mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
          引用文档
        </h3>
        <CitationList citations={citations} />
      </section>
      <section>
        <h3 className='mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
          工具调用与参数
        </h3>
        <ToolRunList runs={runs} />
      </section>
      <section>
        <h3 className='mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
          数据时效与权限范围
        </h3>
        <FreshnessBar citations={citations} scopeLabel={scopeLabel} />
      </section>
    </div>
  )
}

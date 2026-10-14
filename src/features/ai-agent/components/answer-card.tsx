import { useState } from 'react'
import {
  ChevronDown,
  FileSearch,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
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
import { AnswerMarkdown } from './answer-markdown'
import { CitationList, FreshnessBar } from './citation-panel'
import { BlockedNotice, StreamSteps, ToolRunList } from './tool-trace-panel'

type AnswerCardProps = {
  message: AiMessage
  /** 声明条里「依据权限范围」的口径：管理员与普通账号的可见范围不同 */
  scopeLabel?: string
  onRegenerate?: () => void
  canRegenerate?: boolean
}

/**
 * AI 回答卡片：结论 → 支撑信息 → 声明条 → 反馈（固定顺序）。
 *
 * **依据改为卡片内就地展开（2026-09-15）**：此前依据统一由右栏「本次回答的依据」承载
 * （窄屏是抽屉），右栏已按用户要求取消，改为卡片内「查看依据」按钮按需展开。
 * 这样每张回答卡片各自持有自己的依据 —— 比"整个会话只有最后一条能看依据"更准确。
 *
 * 展开区只放**引用文档**与**工具调用与参数**：数据来源 / 数据截至 / 权限范围已由卡片底部
 * 的声明条（`FreshnessBar`）承担，再列一遍就是同一份信息出现两次。
 */
export function AnswerCard({
  message,
  scopeLabel,
  onRegenerate,
  canRegenerate,
}: AnswerCardProps) {
  const feedback = useMessageFeedback()
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [submitted, setSubmitted] = useState<'helpful' | 'unhelpful' | null>(
    null
  )

  const blocked = message.status === 'blocked'
  const failed = message.status === 'error'
  // 没有引用文档也没有工具调用时不给「查看依据」入口：点开一个空面板比没有入口更糟
  const hasEvidence = message.citations.length > 0 || message.runs.length > 0

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

      {blocked && (
        <BlockedNotice className='mb-3' reason={message.blockReason ?? null} />
      )}

      {message.content && (
        /*
         * 正文走统一渲染层（Markdown）。此前的 `<p whitespace-pre-wrap>` 会把模型输出的
         * `## 结论`、`**加粗**`、`| 表格 |` 原样显示成源码符号。
         * `wrap-anywhere`（overflow-wrap: anywhere）仍是硬约束、已由 `AnswerMarkdown`
         * 的容器承载，它必须保留的原因见该文件头部说明。
         */
        <AnswerMarkdown content={message.content} />
      )}

      {failed && !message.content && (
        <p className='text-sm text-destructive'>
          本次回答生成失败，未产生可用结论。
        </p>
      )}

      {/* 支撑数据（表格 / 趋势图 / 指标卡）：服务端算好的结构化块 */}
      <AnswerBlocks blocks={message.blocks ?? []} />

      {/* 声明条（固定展示）：数据来源 / 数据截至 / 依据权限范围 */}
      <FreshnessBar
        citations={message.citations}
        className='mt-4'
        scopeLabel={scopeLabel}
      />

      <footer className='mt-3 flex flex-wrap items-center gap-2'>
        {hasEvidence && (
          /*
           * 文案固定为「查看依据」、只用箭头旋转表达开合：改文案会改变按钮宽度，
           * 点开时整排按钮跟着位移（同一行还有「有用 / 有问题 / 重新生成」）。
           */
          <Button
            aria-expanded={evidenceOpen}
            className='h-8 gap-1.5 text-xs'
            size='sm'
            variant={evidenceOpen ? 'secondary' : 'outline'}
            onClick={() => setEvidenceOpen((prev) => !prev)}
          >
            <FileSearch className='size-3.5' />
            查看依据
            <ChevronDown
              className={cn(
                'size-3.5 transition-transform',
                evidenceOpen && 'rotate-180'
              )}
            />
          </Button>
        )}
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

      {/* 依据：默认收起，点「查看依据」才展开（2026-09-15 从右栏移入卡片内） */}
      {hasEvidence && evidenceOpen && (
        <div className='mt-3 space-y-4 rounded-lg border border-dashed p-3'>
          <section>
            <h3 className='mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
              引用文档
            </h3>
            <CitationList citations={message.citations} />
          </section>
          <section>
            <h3 className='mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase'>
              工具调用与参数
            </h3>
            <ToolRunList runs={message.runs} />
          </section>
        </div>
      )}

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

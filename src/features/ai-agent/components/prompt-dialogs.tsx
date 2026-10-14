import { useState } from 'react'
import { Check, Loader2, Save, Sparkles, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  useAiTools,
  useCreatePrompt,
  useOptimizePrompt,
  useReviewPrompt,
  useUpdatePrompt,
} from '../api/queries'
import {
  PROMPT_STATUS_LABELS,
  PROMPT_STATUS_VARIANTS,
  apiErrorMessage,
  formatTime,
  validatePromptName,
} from '../format'
import type { AiPrompt, PromptOptimizeResult } from '../types'

/** 正文长度上限，与 server/ai-agent/prompt-library.mjs 的 MAX_BODY_LENGTH 一致。 */
const MAX_BODY_LENGTH = 4000
const MAX_SUMMARY_LENGTH = 300
/** 太短的草稿没有优化空间，与 server/ai-agent/prompt-optimize.mjs 的 MIN_DRAFT_LENGTH 一致。 */
const MIN_DRAFT_LENGTH = 4

type EditorProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 有 prompt 表示编辑，否则为新建 */
  prompt?: AiPrompt | null
}

/**
 * 提示词编辑器：新建与编辑两用。
 *
 * 关闭时整体卸载表单，重新打开即以最新数据初始化 state，
 * 因此不需要用 effect 同步 props（沿用 `note-dialogs.tsx` 的既有做法）。
 *
 * 名称唯一性**不在前端判定**：是否与"共享池里别人的提示词"撞名只有服务端知道，
 * 前端只做格式校验（非空、长度、不含 `@`），冲突由服务端 409 回来提示。
 *
 * **「标题」字段已下线（2026-09-15，按用户要求）**：一条提示词只有「名称」——
 * 名称与标题在列表里是上下两行、说的却是同一件事，用户填两遍、还得自己造差别。
 * 服务端仍保留 title 列（历史数据不删），但接口不再返回、前端不再读写。
 *
 * 「优化提示词」走 AI（`POST /ai/prompts/optimize`）：**只优化正文**，
 * 名称牵扯两层唯一性、说明与标签是给人看的元信息，都留给人写。
 * 结果先摆成"原文 / 优化后"对比，用户点「采用」才替换正文（AI 改写有不确定性，
 * 直接覆盖用户刚写完的内容是不可接受的事故）。
 */
export function PromptEditorDialog(props: EditorProps) {
  if (!props.open) return null
  return <PromptEditorForm {...props} />
}

/** 一次优化的结果 + 发起优化时的原文（对比区两栏都靠它，采用后原文也不能变）。 */
type OptimizeReview = {
  source: string
  result: PromptOptimizeResult
}

function PromptEditorForm({ onOpenChange, prompt = null }: EditorProps) {
  const create = useCreatePrompt()
  const update = useUpdatePrompt()
  const optimize = useOptimizePrompt()
  const isEdit = Boolean(prompt)
  const [name, setName] = useState(prompt?.name ?? '')
  const [body, setBody] = useState(prompt?.body ?? '')
  const [summary, setSummary] = useState(prompt?.summary ?? '')
  const [tags, setTags] = useState((prompt?.tags ?? []).join(', '))
  const [review, setReview] = useState<OptimizeReview | null>(null)
  /** 是否已经点过「采用」（采用后正文被替换，仍允许一键撤销） */
  const [applied, setApplied] = useState(false)

  // 演示模式（未接入云模型）下优化接口只会 400，这里提前禁用按钮并说明原因，
  // 免得用户点了才发现"这个功能怎么是坏的"
  const { data: tools } = useAiTools()
  const demoMode = tools?.provider.demo ?? false

  const pending = create.isPending || update.isPending
  // 已共享条目修改后会回到待审，必须提前告知，否则用户以为改完还是共享状态
  const willReReview = prompt?.status === 'published'

  const draftReady = body.trim().length >= MIN_DRAFT_LENGTH
  const optimizeDisabled = optimize.isPending || demoMode || !draftReady

  const optimizeHint = demoMode
    ? '当前是演示模式（未接入云模型），无法优化提示词。请先在「系统管理 → AI 治理 → 模型与配置」配置 API Key。'
    : draftReady
      ? '让 AI 把这段草稿改写成结构更清晰的提问模板。只优化正文，采用前不会改动你的内容。'
      : `先写点内容再优化（至少 ${MIN_DRAFT_LENGTH} 个字符）`

  const runOptimize = () => {
    if (optimizeDisabled) return
    optimize.mutate(
      { body: body.trim(), name: name.trim() },
      {
        onSuccess: (result) => {
          setReview({ source: body, result })
          setApplied(false)
        },
        onError: (error) =>
          toast.error(apiErrorMessage(error, '优化失败，请稍后重试')),
      }
    )
  }

  const applyOptimized = () => {
    if (!review) return
    setBody(review.result.body)
    setApplied(true)
  }

  const undoApplied = () => {
    if (!review) return
    setBody(review.source)
    setApplied(false)
  }

  const dismissReview = () => {
    setReview(null)
    setApplied(false)
  }

  const submit = () => {
    const nameError = validatePromptName(name)
    if (nameError) {
      toast.error(nameError)
      return
    }
    if (!body.trim()) {
      toast.error('请填写提示词正文')
      return
    }

    const payload = {
      name: name.trim(),
      body: body.trim(),
      summary: summary.trim(),
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    }

    if (isEdit && prompt) {
      update.mutate(
        { id: prompt.id, patch: payload },
        {
          onSuccess: (saved) => {
            toast.success(
              saved.status === 'pending' && willReReview
                ? '已保存，内容已变更，需重新提交审核'
                : '提示词已更新'
            )
            onOpenChange(false)
          },
          onError: (error) =>
            toast.error(apiErrorMessage(error, '更新失败，请稍后重试')),
        }
      )
      return
    }

    create.mutate(payload, {
      onSuccess: () => {
        toast.success('提示词已保存到提示词广场')
        onOpenChange(false)
      },
      onError: (error) =>
        toast.error(apiErrorMessage(error, '保存失败，请稍后重试')),
    })
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑提示词' : '新建提示词'}</DialogTitle>
          <DialogDescription>
            提示词是纯文本提问模板，保存后只在「提示词广场」与对话里的 @
            调出使用， 不会改变 AI 的回答口径。
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='prompt-name'>名称</Label>
            <Input
              id='prompt-name'
              maxLength={60}
              placeholder='例如：ACoS 归因分析'
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p className='text-xs text-muted-foreground'>
              对话中通过 @ 名称 调出。名称不能重复，也不能包含 @ 符号。
            </p>
          </div>

          <div className='space-y-2'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <Label htmlFor='prompt-body'>提示词正文</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* disabled 的按钮不触发事件，套一层 span 才能让 Tooltip 说明"为什么不能用" */}
                  <span>
                    <Button
                      className='gap-1.5'
                      disabled={optimizeDisabled}
                      size='sm'
                      type='button'
                      variant='outline'
                      onClick={runOptimize}
                    >
                      {optimize.isPending ? (
                        <Loader2 className='size-3.5 animate-spin' />
                      ) : (
                        <Sparkles className='size-3.5' />
                      )}
                      {optimize.isPending ? '优化中…' : '优化提示词'}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent className='max-w-72'>
                  {optimizeHint}
                </TooltipContent>
              </Tooltip>
            </div>
            <Textarea
              className='min-h-[160px]'
              id='prompt-body'
              maxLength={MAX_BODY_LENGTH}
              placeholder='把你要反复输入的提问写在这里，越具体越好'
              value={body}
              onChange={(event) => {
                setBody(event.target.value)
                // 采用后又手动改了正文，就撤掉"撤销采用"——否则一键撤销会把新改动一起吞掉
                if (applied) setApplied(false)
              }}
            />
            <p className='text-xs text-muted-foreground'>
              {body.length} / {MAX_BODY_LENGTH}
            </p>

            {review && (
              <div
                aria-live='polite'
                className='space-y-3 rounded-lg border p-3'
              >
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <p className='text-xs font-medium'>
                    {applied ? '优化结果（已采用）' : '优化结果（尚未采用）'}
                  </p>
                  {review.result.truncated && (
                    <span className='text-xs text-muted-foreground'>
                      结果过长，已截断到 {MAX_BODY_LENGTH} 字
                    </span>
                  )}
                </div>

                <div className='grid gap-3 sm:grid-cols-2'>
                  <div className='space-y-1'>
                    <p className='text-xs text-muted-foreground'>原文</p>
                    <p className='max-h-40 overflow-y-auto rounded-md bg-muted/40 p-2 text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap'>
                      {review.source}
                    </p>
                  </div>
                  <div className='space-y-1'>
                    <p className='text-xs text-muted-foreground'>优化后</p>
                    <p className='max-h-40 overflow-y-auto rounded-md bg-muted/40 p-2 text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap'>
                      {review.result.body}
                    </p>
                  </div>
                </div>

                <div className='flex flex-wrap items-center gap-2'>
                  {applied ? (
                    <>
                      <Button
                        className='gap-1.5'
                        size='sm'
                        type='button'
                        variant='outline'
                        onClick={undoApplied}
                      >
                        <Undo2 className='size-3.5' />
                        撤销采用
                      </Button>
                      <Button
                        size='sm'
                        type='button'
                        variant='ghost'
                        onClick={dismissReview}
                      >
                        关闭对比
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        className='gap-1.5'
                        size='sm'
                        type='button'
                        onClick={applyOptimized}
                      >
                        <Check className='size-3.5' />
                        采用优化结果
                      </Button>
                      <Button
                        size='sm'
                        type='button'
                        variant='ghost'
                        onClick={dismissReview}
                      >
                        放弃
                      </Button>
                    </>
                  )}
                  <span className='text-xs text-muted-foreground'>
                    采用后仍需点下方「{isEdit ? '保存' : '创建'}
                    」才会写入提示词广场。
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className='space-y-2'>
            <Label htmlFor='prompt-summary'>说明（可选）</Label>
            <Input
              id='prompt-summary'
              maxLength={MAX_SUMMARY_LENGTH}
              placeholder='一句话说明这条提示词什么时候用'
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='prompt-tags'>标签（可选，逗号分隔）</Label>
            <Input
              id='prompt-tags'
              placeholder='广告, 库存, 复盘'
              value={tags}
              onChange={(event) => setTags(event.target.value)}
            />
          </div>

          {willReReview && (
            <p className='rounded-lg border border-dashed p-3 text-xs text-muted-foreground'>
              这条提示词当前已共享。修改后会自动回到「待审核」，
              审核通过前不再出现在其他人的 @ 列表里。
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            disabled={pending}
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button className='gap-2' disabled={pending} onClick={submit}>
            {pending ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <Save className='size-4' />
            )}
            {isEdit ? '保存' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type RejectProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  prompt: AiPrompt | null
  /**
   * 驳回成功后的通知。
   *
   * 对话框不持有列表的页码 state（也不该持有）：它只负责"这一次审核成功了"，
   * 由调用方决定要不要把页码拉回第 1 页 —— 队列变短后留在原页码会看到空列表。
   */
  onReviewed?: () => void
}

/** 驳回提示词：原因必填（服务端同样强制），否则提报人不知道该改什么。 */
export function PromptRejectDialog({
  open,
  onOpenChange,
  prompt,
  onReviewed,
}: RejectProps) {
  if (!open || !prompt) return null
  return (
    <PromptRejectForm
      onOpenChange={onOpenChange}
      onReviewed={onReviewed}
      prompt={prompt}
    />
  )
}

function PromptRejectForm({
  onOpenChange,
  prompt,
  onReviewed,
}: {
  onOpenChange: (open: boolean) => void
  prompt: AiPrompt
  onReviewed?: () => void
}) {
  const review = useReviewPrompt()
  const [comment, setComment] = useState('')

  const submit = () => {
    if (!comment.trim()) {
      toast.error('请填写驳回原因')
      return
    }
    review.mutate(
      { id: prompt.id, decision: 'reject', comment: comment.trim() },
      {
        onSuccess: () => {
          toast.success('已驳回，提报人可修改后重新提报')
          onOpenChange(false)
          onReviewed?.()
        },
        onError: (error) =>
          toast.error(apiErrorMessage(error, '驳回失败，请稍后重试')),
      }
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>驳回提示词</DialogTitle>
          <DialogDescription>
            「{prompt.name}
            」将退回给作者，原因会一并展示，便于其修改后重新提报。
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-2'>
          <Label htmlFor='prompt-reject-comment'>驳回原因</Label>
          <Textarea
            id='prompt-reject-comment'
            className='min-h-[100px]'
            maxLength={300}
            placeholder='例如：正文里包含具体的客户名称，请脱敏后再提报'
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button
            disabled={review.isPending}
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            disabled={review.isPending}
            variant='destructive'
            onClick={submit}
          >
            {review.isPending && <Loader2 className='size-4 animate-spin' />}
            确认驳回
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type DetailProps = {
  prompt: AiPrompt | null
  onOpenChange: (open: boolean) => void
}

/**
 * 提示词详情弹窗（**只读**）。
 *
 * 2026-09-17 替代原来的「展开全文」：原先展开是把**卡片本身拉长**（该卡 `sm:col-span-2 2xl:col-span-3`
 * 跨满整行），而卡片等高靠 `auto-rows-fr` 保证 —— 一张卡变高会把同页其余卡片一起拉高，
 * 点开一次整页跳动；表格视图则是"在行下方插一行"，行高被撑成几百像素。
 * 现在两种读法都改为**点开同一个弹窗**：卡片与行尺寸恒定，长正文在固定高度、可滚动的区域里读，
 * 标签与驳回原因也不会被正文推到视口外。
 *
 * **只读**：提报 / 编辑 / 撤回 / 删除仍然只在卡片与表格行上 —— 弹窗里再放一套会让"读"与"改"
 * 挤在同一个浮层里，而这些动作都有各自的确认与状态流转（提报后条目会变 `pending`），
 * 顺手点在详情里最不合适。
 */
export function PromptDetailDialog({ prompt, onOpenChange }: DetailProps) {
  if (!prompt) return null
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle className='flex flex-wrap items-center gap-2 pe-6'>
            {prompt.name}
            <Badge
              className='font-normal'
              variant={PROMPT_STATUS_VARIANTS[prompt.status] ?? 'outline'}
            >
              {PROMPT_STATUS_LABELS[prompt.status] ?? prompt.status}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {prompt.summary || '完整正文与使用情况。'}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          {/* 与列表卡片同一组元信息、同一口径（本人条目写「我」，不渲染长串账号登录名） */}
          <p className='text-xs text-muted-foreground'>
            创建人 {prompt.isOwner ? '我' : (prompt.ownerLogin ?? '—')} · 更新于{' '}
            {formatTime(prompt.updatedAt)} · 使用 {prompt.usageCount} 次
          </p>

          <div className='rounded-lg border bg-muted/30 p-3'>
            <p className='text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap'>
              {prompt.body}
            </p>
          </div>

          {prompt.tags.length > 0 && (
            <div className='flex flex-wrap gap-1.5'>
              {prompt.tags.map((tag) => (
                <Badge className='font-normal' key={tag} variant='outline'>
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {prompt.status === 'rejected' && prompt.reviewComment && (
            <p className='rounded-lg border border-dashed p-2 text-xs text-muted-foreground'>
              驳回原因：{prompt.reviewComment}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

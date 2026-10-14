import { useState } from 'react'
import { BookmarkPlus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useDistillPreview } from '../api/queries'
import type { DistillPreview } from '../types'
import { NoteEditorDialog } from './note-dialogs'

type Props = {
  conversationId: number | null
  disabled?: boolean
}

/**
 * 会话内「沉淀为知识」入口。
 *
 * 交互路径：抽取草稿（不落库）→ 用户在对话框里确认/补充 → 保存为私有沉淀。
 * 技能未开启、无实质回答、超过每日配额都会给出明确提示（服务端文案）。
 */
export function DistillButton({ conversationId, disabled = false }: Props) {
  const preview = useDistillPreview()
  const [result, setResult] = useState<DistillPreview | null>(null)
  const [open, setOpen] = useState(false)

  const run = () => {
    if (!conversationId) return
    preview.mutate(
      { conversationId },
      {
        onSuccess: (data) => {
          setResult(data)
          setOpen(true)
        },
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : '沉淀失败，请稍后重试'
          ),
      }
    )
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button
              aria-label='把这次问答沉淀为知识'
              /* size-11：与聊天输入行的其它控件（文本域 min-h-[44px]、发送按钮 h-11）等高 */
              className='size-11 gap-2'
              disabled={disabled || !conversationId || preview.isPending}
              size='icon'
              variant='outline'
              onClick={run}
            >
              {preview.isPending ? (
                <Loader2 className='animate-spin' />
              ) : (
                <BookmarkPlus />
              )}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          沉淀为知识：把这次问答整理成经验条目，存进你的个人沉淀（不进入公司知识库）
        </TooltipContent>
      </Tooltip>

      <NoteEditorDialog
        draft={result?.draft ?? null}
        fields={result?.fields ?? []}
        open={open}
        parseError={result?.parseError ?? null}
        conversationId={result?.conversation.id ?? null}
        skillName='knowledge-distill'
        onOpenChange={setOpen}
      />
    </>
  )
}

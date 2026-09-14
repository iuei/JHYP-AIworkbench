import { useState } from 'react'
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
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { useDocumentChunks } from '../api/queries'
import type { KnowledgeDocument } from '../types'

/**
 * 设置文档有效期。用原生 date 输入而不复用 DatePicker——后者禁用未来日期，不适合有效期场景。
 * 组件由调用方用 key 按文档重挂载，因此这里直接以 props 作为初始值，不需要在 effect 里同步状态。
 */
export function DocumentExpiryDialog({
  document,
  onOpenChange,
  onSubmit,
  isPending,
}: {
  document: KnowledgeDocument | null
  onOpenChange: (open: boolean) => void
  onSubmit: (expiresAt: string | null) => void
  isPending: boolean
}) {
  const [value, setValue] = useState(() =>
    document?.expiresAt
      ? new Date(document.expiresAt).toISOString().slice(0, 10)
      : ''
  )

  return (
    <Dialog open={Boolean(document)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>设置有效期</DialogTitle>
          <DialogDescription>
            制度类文档建议必填。到期后文档自动失效并停止被引用，重新启用时会清掉已过期的有效期。
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-2'>
          <Label htmlFor='document-expires'>失效日期</Label>
          <Input
            id='document-expires'
            type='date'
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <p className='text-xs text-muted-foreground'>留空表示长期有效。</p>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={isPending}
            onClick={() => onSubmit(value.trim() || null)}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 文档切片预览（管理员核对引用来源）。 */
export function DocumentChunksDialog({
  documentId,
  title,
  onOpenChange,
}: {
  documentId: number | null
  title: string
  onOpenChange: (open: boolean) => void
}) {
  const chunks = useDocumentChunks(documentId)

  return (
    <Dialog open={documentId !== null} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>切片预览</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <ScrollArea className='max-h-[60vh]'>
          <div className='space-y-2 pe-3'>
            {chunks.isLoading && <Skeleton className='h-20 w-full' />}
            {(chunks.data ?? []).length === 0 && !chunks.isLoading && (
              <p className='text-sm text-muted-foreground'>该文档没有切片。</p>
            )}
            {(chunks.data ?? []).map((chunk) => (
              <div className='rounded-md bg-muted/40 p-2' key={chunk.id}>
                <p className='mb-1 text-xs text-muted-foreground'>
                  片段 #{chunk.chunkIndex} · {chunk.tokenCount ?? 0} tokens
                </p>
                <p className='text-xs whitespace-pre-wrap'>{chunk.content}</p>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

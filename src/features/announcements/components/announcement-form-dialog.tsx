import { useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownContent } from '@/components/markdown-content'
import {
  announcementErrorMessage,
  useCreateAnnouncement,
  useUpdateAnnouncement,
} from '../api'
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '../format'
import type {
  Announcement,
  AnnouncementDisplayMode,
  AnnouncementInput,
} from '../types'

type AnnouncementFormDialogProps = {
  /** null 表示新建；有值时编辑该条。 */
  announcement: Announcement | null
  onClose: () => void
}

type FormState = {
  title: string
  body: string
  displayMode: AnnouncementDisplayMode
  priority: string
  publishAt: string
  expireAt: string
}

function initialForm(announcement: Announcement | null): FormState {
  return {
    title: announcement?.title ?? '',
    body: announcement?.body ?? '',
    displayMode: announcement?.displayMode ?? 'once',
    priority: String(announcement?.priority ?? 0),
    publishAt: toDateTimeLocalValue(announcement?.publishAt ?? null),
    expireAt: toDateTimeLocalValue(announcement?.expireAt ?? null),
  }
}

/**
 * 公告编辑弹窗（新建 / 编辑共用）。
 *
 * 由父组件在打开时挂载、关闭时卸载（不在组件内部用 effect 同步 props）：
 * 这样"每次打开都是一张干净的表单"是结构保证的，而不是靠一个依赖数组刚好写对 ——
 * 编辑 A 后直接打开 B 时，残留的旧值是最典型的那类脏表单缺陷。
 *
 * 校验分两处，且**不是重复**：这里做的是即时反馈（按钮能不能点、提示写哪儿），
 * 服务端 `parseAnnouncementInput` 是权威判定（直接调接口绕不过去）。
 */
export function AnnouncementFormDialog({
  announcement,
  onClose,
}: AnnouncementFormDialogProps) {
  const isEdit = announcement !== null
  const [form, setForm] = useState<FormState>(() => initialForm(announcement))
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const create = useCreateAnnouncement()
  const update = useUpdateAnnouncement()
  const isPending = create.isPending || update.isPending

  const title = form.title.trim()
  const body = form.body.trim()
  const priority = Number(form.priority)
  const publishAt = fromDateTimeLocalValue(form.publishAt)
  const expireAt = fromDateTimeLocalValue(form.expireAt)
  const scheduleInverted =
    publishAt !== null &&
    expireAt !== null &&
    new Date(expireAt).getTime() <= new Date(publishAt).getTime()

  const canSubmit =
    title.length > 0 &&
    title.length <= 120 &&
    body.length > 0 &&
    !scheduleInverted &&
    !isPending

  function submit() {
    const input: AnnouncementInput = {
      title,
      body,
      displayMode: form.displayMode,
      priority: Number.isInteger(priority) ? priority : 0,
      publishAt,
      expireAt,
    }
    const onSuccess = () => {
      toast.success(isEdit ? '公告已更新' : '公告已创建（草稿）')
      onClose()
    }
    const onError = (error: unknown) =>
      toast.error(
        announcementErrorMessage(
          error,
          isEdit ? '公告更新失败，请重试' : '公告创建失败，请重试'
        )
      )

    if (isEdit) {
      update.mutate({ id: announcement.id, input }, { onSuccess, onError })
    } else {
      create.mutate(input, { onSuccess, onError })
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑公告' : '新建公告'}</DialogTitle>
          <DialogDescription>
            内容支持 Markdown。保存为草稿后，在列表里点「发布」才会弹给员工。
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='announcement-title'>标题</Label>
            <Input
              id='announcement-title'
              maxLength={120}
              placeholder='例如：本周六 22:00 系统维护'
              value={form.title}
              onChange={(event) =>
                setForm({ ...form, title: event.target.value })
              }
            />
          </div>

          <div className='space-y-2'>
            <div className='flex items-center justify-between gap-3'>
              <Label htmlFor='announcement-body'>公告内容</Label>
              <Tabs
                value={tab}
                onValueChange={(value) => setTab(value as 'write' | 'preview')}
              >
                <TabsList>
                  <TabsTrigger value='write'>编辑</TabsTrigger>
                  <TabsTrigger value='preview'>预览</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            {tab === 'write' ? (
              <Textarea
                id='announcement-body'
                className='min-h-40'
                placeholder={
                  '支持 Markdown：**加粗**、- 列表、[链接](https://…)'
                }
                value={form.body}
                onChange={(event) =>
                  setForm({ ...form, body: event.target.value })
                }
              />
            ) : (
              <div className='max-h-64 min-h-40 overflow-y-auto rounded-md border p-3'>
                {body ? (
                  <MarkdownContent content={form.body} />
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    还没有内容，切回「编辑」写点什么。
                  </p>
                )}
              </div>
            )}
          </div>

          <div className='space-y-2'>
            <Label>弹出方式</Label>
            <RadioGroup
              className='gap-2'
              value={form.displayMode}
              onValueChange={(value) =>
                setForm({
                  ...form,
                  displayMode: value as AnnouncementDisplayMode,
                })
              }
            >
              <div className='flex items-start gap-2'>
                <RadioGroupItem id='display-once' value='once' />
                <div className='space-y-0.5'>
                  <Label htmlFor='display-once'>只弹一次</Label>
                  <p className='text-xs text-muted-foreground'>
                    员工点「我知道了」后不再弹出。已读按账号记录，换电脑、清缓存也不会重复弹。
                  </p>
                </div>
              </div>
              <div className='flex items-start gap-2'>
                <RadioGroupItem id='display-every-login' value='every_login' />
                <div className='space-y-0.5'>
                  <Label htmlFor='display-every-login'>每次登录都弹</Label>
                  <p className='text-xs text-muted-foreground'>
                    员工每次登录进入系统都会看到它，适合必须反复强调的事项。
                  </p>
                </div>
              </div>
            </RadioGroup>
          </div>

          <div className='grid gap-3 sm:grid-cols-3'>
            <div className='space-y-2'>
              <Label htmlFor='announcement-priority'>优先级</Label>
              <Input
                id='announcement-priority'
                max={100}
                min={-100}
                type='number'
                value={form.priority}
                onChange={(event) =>
                  setForm({ ...form, priority: event.target.value })
                }
              />
              <p className='text-xs text-muted-foreground'>
                数值越大越先弹，默认 0。
              </p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='announcement-publish-at'>生效时间</Label>
              <Input
                id='announcement-publish-at'
                type='datetime-local'
                value={form.publishAt}
                onChange={(event) =>
                  setForm({ ...form, publishAt: event.target.value })
                }
              />
              <p className='text-xs text-muted-foreground'>
                留空表示立即生效。
              </p>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='announcement-expire-at'>失效时间</Label>
              <Input
                id='announcement-expire-at'
                type='datetime-local'
                value={form.expireAt}
                onChange={(event) =>
                  setForm({ ...form, expireAt: event.target.value })
                }
              />
              <p className='text-xs text-muted-foreground'>
                留空表示长期有效。
              </p>
            </div>
          </div>
          {scheduleInverted && (
            <p className='text-sm text-destructive'>
              失效时间必须晚于生效时间。
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            取消
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {isEdit ? '保存修改' : '创建草稿'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

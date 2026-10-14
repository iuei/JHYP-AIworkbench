import { useState } from 'react'
import { AlertTriangle, Loader2, Save } from 'lucide-react'
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
import { useCreateNote, useUpdateNote } from '../api/queries'
import {
  NOTE_LOCKED_HINTS,
  NOTE_PROVENANCE_LABELS,
  canEditNote,
} from '../format'
import type { DistillDraft, KnowledgeNote, NoteFieldDef } from '../types'

type EditorProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  fields: NoteFieldDef[]
  /** 有 note 表示编辑既有条目，否则是新建 */
  note?: KnowledgeNote | null
  /** 会话沉淀：草稿由 AI 整理或降级为原文 */
  draft?: DistillDraft | null
  parseError?: string | null
  conversationId?: number | null
  skillName?: string | null
  scope?: 'self' | 'admin'
}

/**
 * 沉淀条目编辑器：新建、AI 草稿确认、编辑三合一。
 *
 * 降级草稿（degraded）必须显式提示：字段是空的、内容只是原文搬运，
 * 不能让用户以为"AI 已经整理好了"直接提交审核。
 *
 * 关闭时不渲染表单（内部组件随之卸载），重新打开即以最新数据初始化 state，
 * 因此不需要用 effect 同步 props（也避免级联渲染的 lint 报错）。
 */
export function NoteEditorDialog(props: EditorProps) {
  if (!props.open) return null
  return <NoteEditorForm {...props} />
}

function NoteEditorForm({
  onOpenChange,
  fields,
  note = null,
  draft = null,
  parseError = null,
  conversationId = null,
  skillName = null,
  scope = 'self',
}: EditorProps) {
  const create = useCreateNote()
  const update = useUpdateNote()
  const [title, setTitle] = useState(note?.title ?? draft?.title ?? '')
  const [summary, setSummary] = useState(note?.summary ?? draft?.summary ?? '')
  const [evidence, setEvidence] = useState(
    note?.evidence ?? draft?.evidence ?? ''
  )
  const [tags, setTags] = useState((note?.tags ?? []).join(', '))
  const [values, setValues] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {}
    for (const field of fields) {
      next[field.key] =
        note?.fields?.[field.key] ?? draft?.fields?.[field.key] ?? ''
    }
    return next
  })

  const degraded = Boolean(draft?.degraded)
  const evidenceRejected = Boolean(draft?.evidenceRejected)
  const isEdit = Boolean(note)
  // 来源可信度由服务端推导（会话整理 = 模型推断，手工新建 = 本人所写），
  // 这里只负责如实展示，不参与提交——客户端传 provenance 不会生效。
  const provenanceLabel =
    NOTE_PROVENANCE_LABELS[
      note?.provenance ?? (draft ? 'inferred' : 'user_stated')
    ] ?? NOTE_PROVENANCE_LABELS.user_stated

  const submit = () => {
    if (!title.trim()) {
      toast.error('请填写标题')
      return
    }
    const payloadFields: Record<string, string> = {}
    for (const [key, value] of Object.entries(values)) {
      if (value.trim()) payloadFields[key] = value.trim()
    }
    const patch = {
      title: title.trim(),
      summary: summary.trim(),
      evidence: evidence.trim(),
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      fields: payloadFields,
    }

    if (isEdit && note) {
      update.mutate(
        { id: note.id, patch, scope },
        {
          onSuccess: () => {
            toast.success('沉淀已更新')
            onOpenChange(false)
          },
          onError: (error) =>
            toast.error(
              error instanceof Error ? error.message : '更新失败，请稍后重试'
            ),
        }
      )
      return
    }

    create.mutate(
      { ...patch, conversationId, skillName },
      {
        onSuccess: (result) => {
          toast.success(
            result.newRevision
              ? '同标题旧版本已发布，已存为新修订（旧版本转历史归档），需重新提交审核'
              : result.merged
                ? `已合并到同标题的既有沉淀（第 ${result.note.noteVersion} 版）`
                : '沉淀已保存到「个人知识库」'
          )
          onOpenChange(false)
        },
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : '保存失败，请稍后重试'
          ),
      }
    )
  }

  const pending = create.isPending || update.isPending

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑沉淀' : '沉淀为知识'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? '待审核与已发布的沉淀不能直接修改：审核人看到的必须是你提交的那一版。如需改内容，请先归档再重新提交。'
              : '保存后进入你的个人知识空间，只有你能看到；提交审核通过后才会进入公司知识库。'}
          </DialogDescription>
        </DialogHeader>

        {degraded && (
          <div className='flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm'>
            <AlertTriangle className='mt-0.5 size-4 shrink-0 text-amber-600' />
            <span>
              AI 自动整理 {parseError ? `失败（${parseError}）` : '未完成'}
              ，已把会话原文放入「原文依据」，
              字段需要你手动补充。系统不会编造未出现过的内容。
            </span>
          </div>
        )}

        {evidenceRejected && (
          <div className='flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm'>
            <AlertTriangle className='mt-0.5 size-4 shrink-0 text-amber-600' />
            <span>
              模型给出的「原文依据」没有在这次会话里找到（服务端逐字核对未通过），已置空。
              请从会话中复制原文补上，或留空提交。
            </span>
          </div>
        )}

        <div className='space-y-1.5'>
          <Label htmlFor='note-title'>标题</Label>
          <Input
            id='note-title'
            maxLength={200}
            placeholder='一句话概括这条经验'
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='space-y-1.5 sm:col-span-2'>
            <Label htmlFor='note-summary'>概述</Label>
            <Textarea
              id='note-summary'
              maxLength={500}
              placeholder='两句话说明这条经验的要点'
              rows={2}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
            />
          </div>
          {fields.map((field) => (
            <div className='space-y-1.5' key={field.key}>
              <Label htmlFor={`note-field-${field.key}`}>{field.label}</Label>
              <Textarea
                id={`note-field-${field.key}`}
                placeholder={field.hint}
                rows={2}
                value={values[field.key] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }))
                }
              />
            </div>
          ))}
          <div className='space-y-1.5 sm:col-span-2'>
            <Label htmlFor='note-evidence'>原文依据</Label>
            <Textarea
              id='note-evidence'
              maxLength={500}
              placeholder='留一句话原文，审核人一眼就能判断这条经验是否可信'
              rows={2}
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='note-tags'>标签</Label>
            <Input
              id='note-tags'
              placeholder='用逗号分隔，例如：补货, 库存'
              value={tags}
              onChange={(event) => setTags(event.target.value)}
            />
          </div>
          <div className='space-y-1.5'>
            <Label>来源可信度</Label>
            <div className='flex h-9 items-center gap-2'>
              <Badge
                variant={
                  provenanceLabel === NOTE_PROVENANCE_LABELS.inferred
                    ? 'secondary'
                    : 'outline'
                }
              >
                {provenanceLabel}
              </Badge>
              <span className='text-xs text-muted-foreground'>
                由服务端按来源判定，模型推断的内容审核会更严格
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button className='gap-2' disabled={pending} onClick={submit}>
            {pending ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <Save className='size-4' />
            )}
            {isEdit ? '保存修改' : '保存到个人知识库'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type DetailProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  note: KnowledgeNote | null
  fields: NoteFieldDef[]
  onEdit?: (note: KnowledgeNote) => void
  /** 管理视图允许改待审条目（服务端会写审计）；员工视图不允许 */
  scope?: 'self' | 'admin'
}

/** 沉淀详情：只读展示，包含审核意见与溯源信息。 */
export function NoteDetailDialog({
  open,
  onOpenChange,
  note,
  fields,
  onEdit,
  scope = 'self',
}: DetailProps) {
  if (!note) return null
  const editable = canEditNote(note, scope)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{note.title}</DialogTitle>
          <DialogDescription>
            {note.ownerName ?? note.ownerLogin ?? '未知账号'} · 第{' '}
            {note.noteVersion} 版 ·
            {note.status === 'published'
              ? ' 已进入公司知识库'
              : ' 未进入公司知识库'}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3 text-sm'>
          {note.summary && (
            <p className='whitespace-pre-wrap'>{note.summary}</p>
          )}
          {note.evidence && (
            <div className='rounded-md border bg-muted/40 px-3 py-2'>
              <p className='mb-1 text-xs font-medium text-muted-foreground'>
                原文依据
              </p>
              <p className='whitespace-pre-wrap'>{note.evidence}</p>
            </div>
          )}
          {fields.map((field) => {
            const value = note.fields?.[field.key]
            if (!value) return null
            return (
              <div key={field.key}>
                <p className='text-xs font-medium text-muted-foreground'>
                  {field.label}
                </p>
                <p className='whitespace-pre-wrap'>{value}</p>
              </div>
            )
          })}
          {note.reviewComment && (
            <div className='rounded-md border px-3 py-2'>
              <p className='mb-1 text-xs font-medium text-muted-foreground'>
                审核意见（{note.reviewerName ?? '管理员'}）
              </p>
              <p className='whitespace-pre-wrap'>{note.reviewComment}</p>
            </div>
          )}
          {note.conversationId && (
            <p className='text-xs text-muted-foreground'>
              来源会话 #{note.conversationId}
              {note.degraded ? ' · AI 整理失败，内容为原文搬运' : ''}
            </p>
          )}
        </div>

        <DialogFooter>
          {onEdit && editable && (
            <Button
              className='gap-2'
              variant='outline'
              onClick={() => onEdit(note)}
            >
              编辑
            </Button>
          )}
          {onEdit && !editable && (
            <span className='me-auto text-xs text-muted-foreground'>
              {NOTE_LOCKED_HINTS[note.status]}
            </span>
          )}
          <Button onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

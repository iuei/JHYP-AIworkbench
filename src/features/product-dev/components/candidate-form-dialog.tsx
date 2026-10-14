import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CANDIDATE_MARKETPLACE_OPTIONS } from '../format'
import type { AttributeRow, Candidate, CandidateFormValues, CandidateStage } from '../types'

const STAGE_OPTIONS: { value: CandidateStage; label: string }[] = [
  { value: 'candidate', label: '候选' },
  { value: 'researching', label: '调研中' },
  { value: 'approved', label: '已立项' },
  { value: 'rejected', label: '已放弃' },
]

const EMPTY_VALUES: CandidateFormValues = {
  productName: '',
  asin: '',
  category: '',
  targetPrice: '',
  marketplace: 'US',
  stage: 'candidate',
  note: '',
  attributes: [],
}

function toFormValues(candidate: Candidate | null): CandidateFormValues {
  if (!candidate) return { ...EMPTY_VALUES }
  return {
    productName: candidate.product_name,
    asin: candidate.asin ?? '',
    category: candidate.category,
    targetPrice: candidate.target_price === null ? '' : String(candidate.target_price),
    marketplace: candidate.marketplace,
    stage: candidate.stage,
    note: candidate.note ?? '',
    attributes: Object.entries(candidate.attributes).map(([key, value]) => ({ key, value })),
  }
}

type CandidateFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null 表示新建 */
  candidate: Candidate | null
  pending: boolean
  onSubmit: (values: CandidateFormValues) => void
}

/**
 * 候选产品的新建 / 编辑弹窗。
 *
 * 表单用受控 state 而不是 react-hook-form：本页的 Select 走基础受控组件（见
 * `competitor-analysis/components/analysis-form.tsx` 里记录的同类理由），
 * 且**字段校验的中文原因统一由服务端给出**（`server/product-dev.mjs`），
 * 前端再写一套 zod 规则只会出现两套说法不一致的情况。
 * 附加维度是动态键值行，也无法用静态 schema 描述。
 */
export function CandidateFormDialog({
  open,
  onOpenChange,
  candidate,
  pending,
  onSubmit,
}: CandidateFormDialogProps) {
  const [values, setValues] = useState<CandidateFormValues>(() => toFormValues(candidate))

  /*
   * 表单初值只在**挂载时**取一次，靠调用方给的 `key` 保证"每次打开都是新实例"
   * （见 `index.tsx` 里 `<CandidateFormDialog key={...} />`）。
   *
   * 不用 `useEffect(() => { if (open) setValues(...) })` 同步：那属于"渲染后再改一次 state"，
   * 会多一轮渲染，正是 `react-hooks/set-state-in-effect` 规则要拦的写法；
   * 而且它需要自己维护 open 的前后关系，比 key 更容易写错。
   */

  function patch(part: Partial<CandidateFormValues>) {
    setValues((prev) => ({ ...prev, ...part }))
  }

  function updateAttribute(index: number, part: Partial<AttributeRow>) {
    setValues((prev) => ({
      ...prev,
      attributes: prev.attributes.map((row, i) => (i === index ? { ...row, ...part } : row)),
    }))
  }

  const canSubmit =
    (values.productName.trim().length > 0 || values.asin.trim().length > 0) && !pending

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    onSubmit(values)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{candidate ? '编辑候选产品' : '新增候选产品'}</DialogTitle>
          <DialogDescription>
            产品名称与 ASIN 至少填一个；未上架的候选可以只填名称。
          </DialogDescription>
        </DialogHeader>

        <form id='candidate-form' className='space-y-4' onSubmit={handleSubmit}>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='candidate-name'>产品名称</Label>
              <Input
                id='candidate-name'
                value={values.productName}
                onChange={(event) => patch({ productName: event.target.value })}
                placeholder='例如：便携榨汁杯'
                autoComplete='off'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='candidate-asin'>ASIN</Label>
              <Input
                id='candidate-asin'
                value={values.asin}
                onChange={(event) => patch({ asin: event.target.value })}
                placeholder='10 位 ASIN 或商品链接'
                autoComplete='off'
                spellCheck={false}
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='candidate-category'>类目</Label>
              <Input
                id='candidate-category'
                value={values.category}
                onChange={(event) => patch({ category: event.target.value })}
                placeholder='例如：厨房小家电'
                autoComplete='off'
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='candidate-price'>目标售价</Label>
              <Input
                id='candidate-price'
                value={values.targetPrice}
                onChange={(event) => patch({ targetPrice: event.target.value })}
                placeholder='例如：19.99'
                inputMode='decimal'
                autoComplete='off'
              />
            </div>

            {/*
              用基础受控 Select：早期封装的 SelectDropdown 把 SelectTrigger 包在 FormControl 里，
              依赖 react-hook-form 的 FormField 上下文，脱离 <Form> 使用会抛
              「useFormContext(...) is null」并让整页白屏（竞品分析 UI 验证实测过），该组件已删除。
            */}
            <div className='space-y-2'>
              <Label>站点</Label>
              <Select
                value={values.marketplace}
                onValueChange={(value) => patch({ marketplace: value })}
              >
                <SelectTrigger className='w-full' aria-label='站点'>
                  <SelectValue placeholder='选择站点' />
                </SelectTrigger>
                <SelectContent>
                  {CANDIDATE_MARKETPLACE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label>阶段</Label>
              <Select
                value={values.stage}
                onValueChange={(value) => patch({ stage: value as CandidateStage })}
              >
                <SelectTrigger className='w-full' aria-label='阶段'>
                  <SelectValue placeholder='选择阶段' />
                </SelectTrigger>
                <SelectContent>
                  {STAGE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='candidate-note'>备注</Label>
            <Textarea
              id='candidate-note'
              value={values.note}
              onChange={(event) => patch({ note: event.target.value })}
              placeholder='例如：评论区主要反馈电池续航不足'
              rows={2}
            />
          </div>

          <div className='space-y-3'>
            <div className='flex items-center justify-between gap-3'>
              <div>
                <Label>附加维度</Label>
                <p className='mt-1 text-xs text-muted-foreground'>
                  评分、评论数、月销量这类字段当前没有数据源，由你手工填写；平台不对其做校验。
                </p>
              </div>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() =>
                  patch({ attributes: [...values.attributes, { key: '', value: '' }] })
                }
              >
                <Plus aria-hidden='true' />
                添加维度
              </Button>
            </div>

            {values.attributes.length === 0 ? (
              <p className='text-xs text-muted-foreground'>暂无附加维度。</p>
            ) : (
              <div className='space-y-2'>
                {values.attributes.map((row, index) => (
                  <div key={index} className='flex items-center gap-2'>
                    <Input
                      value={row.key}
                      onChange={(event) => updateAttribute(index, { key: event.target.value })}
                      placeholder='维度名，例如：评分'
                      aria-label={`附加维度 ${index + 1} 的名称`}
                      className='flex-1'
                    />
                    <Input
                      value={row.value}
                      onChange={(event) => updateAttribute(index, { value: event.target.value })}
                      placeholder='值，例如：4.3'
                      aria-label={`附加维度 ${index + 1} 的值`}
                      className='flex-1'
                    />
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      aria-label={`删除附加维度 ${index + 1}`}
                      onClick={() =>
                        patch({
                          attributes: values.attributes.filter((_, i) => i !== index),
                        })
                      }
                    >
                      <Trash2 aria-hidden='true' />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </form>

        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type='submit' form='candidate-form' disabled={!canSubmit}>
            {pending ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

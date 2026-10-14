import { useState } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  MARKETPLACE_OPTIONS,
  addOutcomeSentence,
  errorMessage,
} from '../format'
import { useAddMyAsins } from '../hooks'
import { MARKETPLACES } from '../types'
import { MetricOverrideFields } from './metric-override-fields'
import {
  EMPTY_MANUAL_METRICS,
  hasAnyManualValue,
  toManualPayload,
  type ManualMetricsDraft,
} from './metric-override-model'

const schema = z.object({
  asin: z
    .string()
    .trim()
    .min(1, '请填写 ASIN')
    .max(40, 'ASIN 不能超过 40 个字符'),
  marketplace: z.enum(MARKETPLACES),
  alias: z.string().trim().max(120, '别名不能超过 120 个字符'),
  note: z.string().trim().max(300, '备注不能超过 300 个字符'),
})

type FormValues = z.infer<typeof schema>

type AddItemDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 页面当前区间（服务端实际采用的起止日期）；`null` 表示区间还没确定 */
  period: { startDate: string; endDate: string } | null
}

/**
 * 单个 ASIN 的添加表单（弹窗）。
 *
 * 字段与表格的**身份列一一对应**：ASIN / 站点 / 别名 / 备注。
 * 表格里的另外几列（数据覆盖、花费、广告销售额、广告订单、ACoS、销量、销售额）也可以在这里一起填 ——
 * 它们收在「同时录入这个区间的指标」里，属于**可选**：不填就用报表数字。
 *
 * 站点是必填的（默认 US）：它决定指标从哪个站点的报表取数。
 * 关闭时不渲染表单（内部组件随之卸载），重新打开即以空值初始化。
 *
 * 条目与人工指标**在同一次请求里写入**（2026-09-18 修）：分两步时，第一步会让列表刷新、
 * 弹窗卸载重挂载，第二步的回调就再也回不到界面 —— 表现为"又弹出一个录入窗口"且指标丢失。
 */
export function AddItemDialog({
  open,
  onOpenChange,
  period,
}: AddItemDialogProps) {
  if (!open) return null
  return <AddItemForm period={period} onOpenChange={onOpenChange} />
}

function AddItemForm({
  period,
  onOpenChange,
}: {
  period: AddItemDialogProps['period']
  onOpenChange: (open: boolean) => void
}) {
  const add = useAddMyAsins()
  const [metricsOpen, setMetricsOpen] = useState(false)
  const [draft, setDraft] = useState<ManualMetricsDraft>({
    ...EMPTY_MANUAL_METRICS,
  })

  const pending = add.isPending
  const wantMetrics = metricsOpen && hasAnyManualValue(draft)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { asin: '', marketplace: 'US', alias: '', note: '' },
  })

  function onSubmit(values: FormValues) {
    const withMetrics = wantMetrics && Boolean(period)
    add.mutate(
      {
        items: [
          {
            asin: values.asin,
            marketplace: values.marketplace,
            alias: values.alias || null,
            note: values.note || null,
          },
        ],
        metrics: withMetrics ? toManualPayload(draft) : undefined,
        period: withMetrics && period ? period : undefined,
      },
      {
        onSuccess: (result) => {
          toast.success(addOutcomeSentence(result))
          if (withMetrics) {
            if (result.manualError) {
              toast.error(
                `ASIN 已添加，但指标没保存成功：${result.manualError}`
              )
            } else if (result.override) {
              toast.success('已保存人工指标')
            } else if (result.added.length === 0) {
              toast.error(
                '这个 ASIN（含站点）已经在列表里，请用行内的「录入指标」录入。'
              )
            }
          }
          onOpenChange(false)
        },
        onError: (error) =>
          toast.error(errorMessage(error, '添加失败，请稍后重试。')),
      }
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>添加 ASIN</DialogTitle>
          <DialogDescription>
            填一个商品编码即可；同一个 ASIN 在不同站点是两条独立记录。
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form className='space-y-4' onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name='asin'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>ASIN</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoComplete='off'
                      className='font-mono'
                      maxLength={40}
                      placeholder='例如 B0C1D2E3F4'
                      spellCheck={false}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='marketplace'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>站点</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className='w-full' aria-label='站点'>
                        <SelectValue placeholder='选择站点' />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {MARKETPLACE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    报表按站点分开统计；换站点后取数口径会随之变化。
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='alias'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>别名（可选）</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoComplete='off'
                      maxLength={120}
                      placeholder='例如：主力款 / 新品 A'
                    />
                  </FormControl>
                  <FormDescription>
                    别名会显示在 AI 回答里，几千条里没有别名就认不出是哪款。
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='note'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>备注（可选）</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      autoComplete='off'
                      className='max-h-32 overflow-y-auto'
                      maxLength={300}
                      placeholder='仅自己可见的说明，例如负责人、上架时间、观察重点'
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='space-y-3 rounded-lg border p-3'>
              <label className='flex items-center gap-2 text-sm font-medium'>
                <Checkbox
                  aria-label='同时录入这个区间的指标'
                  checked={metricsOpen}
                  onCheckedChange={(checked) =>
                    setMetricsOpen(checked === true)
                  }
                />
                同时录入这个区间的指标（可选）
              </label>
              <p className='text-xs text-muted-foreground'>
                {period
                  ? `区间取页面当前正在看的：${period.startDate} ~ ${period.endDate}`
                  : '当前统计区间还没确定，请先在页面上选好区间（或先只添加 ASIN，之后再录入）。'}
              </p>
              {metricsOpen &&
                (period ? (
                  <MetricOverrideFields
                    disabled={pending}
                    draft={draft}
                    onChange={setDraft}
                  />
                ) : (
                  <p className='text-xs text-destructive'>
                    区间未确定，无法录入指标；先添加
                    ASIN，再在页面上选好区间后用行内的「录入指标」补录。
                  </p>
                ))}
            </div>

            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button type='submit' disabled={pending}>
                {pending ? (
                  <Loader2 className='animate-spin' aria-hidden='true' />
                ) : (
                  <Plus aria-hidden='true' />
                )}
                添加到列表
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

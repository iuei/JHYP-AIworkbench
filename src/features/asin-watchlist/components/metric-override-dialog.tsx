import { useState } from 'react'
import { Loader2, Save, Trash2 } from 'lucide-react'
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
import { errorMessage } from '../format'
import {
  useRemoveMyAsinMetricOverride,
  useSaveMyAsinMetricOverride,
} from '../hooks'
import type { MyAsinTableRow } from '../types'
import { MetricOverrideFields } from './metric-override-fields'
import {
  EMPTY_MANUAL_METRICS,
  hasAnyManualValue,
  toManualDraft,
  toManualPayload,
  type ManualMetricsDraft,
} from './metric-override-model'

type MetricOverrideDialogProps = {
  /** 要录入指标的条目（含它在当前区间的指标，用于预填已有人工值） */
  item: MyAsinTableRow | null
  /** 页面当前区间（服务端实际采用的起止日期）；为空表示区间还没定 */
  period: { startDate: string; endDate: string } | null
  onOpenChange: (open: boolean) => void
}

/**
 * 录入 / 修改某条 ASIN 的人工指标（弹窗）。
 *
 * 两条硬规则：
 * ① **区间取页面当前正在看的那个**（服务端返回的实际起止日期）——
 *    人工值按具体日期存，弹窗里再放一套相对区间选择器（近 7 天…）只会让两边对不上；
 * ② **逐字段覆盖**：填了的项以人工值为准，留空的继续用报表 —— 用户常常只想补一个销量，
 *    没必要把报表的花费也抄一遍。
 */
export function MetricOverrideDialog({
  item,
  period,
  onOpenChange,
}: MetricOverrideDialogProps) {
  if (!item) return null
  return (
    <MetricOverrideForm
      key={item.id}
      item={item}
      period={period}
      onOpenChange={onOpenChange}
    />
  )
}

function MetricOverrideForm({
  item,
  period,
  onOpenChange,
}: MetricOverrideDialogProps & { item: MyAsinTableRow }) {
  const save = useSaveMyAsinMetricOverride()
  const remove = useRemoveMyAsinMetricOverride()
  const [draft, setDraft] = useState<ManualMetricsDraft>(() =>
    item.metrics?.manual
      ? toManualDraft({
          spend: item.metrics.spend,
          adSales: item.metrics.adSales,
          orders: item.metrics.orders,
          acos: item.metrics.acos,
          units: item.metrics.units,
          businessSales: item.metrics.businessSales,
        })
      : { ...EMPTY_MANUAL_METRICS }
  )

  const pending = save.isPending || remove.isPending
  const canSubmit = Boolean(period) && hasAnyManualValue(draft)

  function handleSave() {
    if (!period) return
    save.mutate(
      {
        itemId: item.id,
        startDate: period.startDate,
        endDate: period.endDate,
        ...toManualPayload(draft),
      },
      {
        onSuccess: () => {
          toast.success('已保存人工指标')
          onOpenChange(false)
        },
        onError: (error) =>
          toast.error(errorMessage(error, '保存失败，请稍后重试。')),
      }
    )
  }

  function handleClear() {
    if (!period) return
    remove.mutate(
      { itemId: item.id, startDate: period.startDate, endDate: period.endDate },
      {
        onSuccess: () => {
          toast.success('已清除人工值，这一行改回报表数字')
          onOpenChange(false)
        },
        onError: (error) =>
          toast.error(errorMessage(error, '清除失败，请稍后重试。')),
      }
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            录入指标 · {item.asin}（{item.marketplace} 站）
          </DialogTitle>
          <DialogDescription>
            {period
              ? `统计区间：${period.startDate} ~ ${period.endDate}（页面当前正在看的区间）`
              : '当前统计区间还没确定，请先在页面上选好区间。'}
            。填了的项以人工值为准，留空的继续用报表；页面与 AI
            助手都会采用这里填的数字。
          </DialogDescription>
        </DialogHeader>

        <MetricOverrideFields
          draft={draft}
          disabled={pending}
          onChange={setDraft}
        />

        <DialogFooter>
          {item.metrics?.manual && (
            <Button
              className='gap-1.5 text-destructive hover:text-destructive'
              disabled={pending}
              type='button'
              variant='ghost'
              onClick={handleClear}
            >
              <Trash2 aria-hidden='true' />
              清除人工值
            </Button>
          )}
          <Button
            type='button'
            variant='outline'
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type='button'
            disabled={pending || !canSubmit}
            onClick={handleSave}
          >
            {save.isPending ? (
              <Loader2 className='animate-spin' aria-hidden='true' />
            ) : (
              <Save aria-hidden='true' />
            )}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

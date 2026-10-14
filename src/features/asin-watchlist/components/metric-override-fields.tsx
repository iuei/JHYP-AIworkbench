import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  describeCoverage,
  type ManualMetricsDraft,
} from './metric-override-model'

const FIELD_META: Array<{
  key: keyof ManualMetricsDraft
  label: string
  step: string
}> = [
  { key: 'spend', label: '花费', step: '0.01' },
  { key: 'adSales', label: '广告销售额', step: '0.01' },
  { key: 'orders', label: '广告订单', step: '1' },
  { key: 'acos', label: 'ACoS（%）', step: '0.01' },
  { key: 'units', label: '销量', step: '1' },
  { key: 'businessSales', label: '销售额', step: '0.01' },
]

type MetricOverrideFieldsProps = {
  draft: ManualMetricsDraft
  disabled?: boolean
  onChange: (next: ManualMetricsDraft) => void
}

/**
 * 6 个可人工录入的指标（花费 / 广告销售额 / 广告订单 / ACoS / 销量 / 销售额）。
 *
 * 空着 = 用报表的数；填了 = 这一项以人工值为准（**逐字段覆盖**，不是整行替换）——
 * 这样"报表有花费、我只是想补一个销量"也能用。
 *
 * 类型与纯函数在 `metric-override-model.ts`（本文件只导出组件，保证 fast refresh 有效）。
 */
export function MetricOverrideFields({
  draft,
  disabled,
  onChange,
}: MetricOverrideFieldsProps) {
  return (
    <div className='space-y-3'>
      <div className='grid gap-3 sm:grid-cols-2'>
        {FIELD_META.map((field) => (
          <div key={field.key} className='space-y-1.5'>
            <Label className='text-xs' htmlFor={`manual-${field.key}`}>
              {field.label}
            </Label>
            <Input
              aria-label={field.label}
              disabled={disabled}
              id={`manual-${field.key}`}
              inputMode='decimal'
              min='0'
              placeholder='留空则用报表'
              step={field.step}
              type='number'
              value={draft[field.key]}
              onChange={(event) =>
                onChange({ ...draft, [field.key]: event.target.value })
              }
            />
          </div>
        ))}
      </div>
      <p className='text-xs text-muted-foreground'>
        「数据覆盖」按填写内容自动判定为：
        <span className='font-medium'> {describeCoverage(draft)}</span>
        。留空的项目继续用报表数字；填了 0 代表确实是 0（与留空不同）。
      </p>
    </div>
  )
}

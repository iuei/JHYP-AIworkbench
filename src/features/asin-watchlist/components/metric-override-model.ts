import type { ManualMetricInput } from '../types'

/**
 * 人工指标的表单模型（纯函数与常量）。
 *
 * 与组件分开放（`metric-override-fields.tsx` 只导出组件）：同一个文件既导出组件又导出
 * 常量/函数会让 react-refresh 失效 —— 与 `list-layout.ts` / `layout-toggle.tsx` 同一拆法。
 */

/**
 * 人工指标的草稿（表单态）。
 *
 * 表单里一律用字符串：`''` 表示"这一项没有人工值"，与 `0` 严格区分 ——
 * `0` 是"确实是 0"，`''` 是"用报表的"。用 number 表达不了这个区别（`Number('') === 0`）。
 */
export type ManualMetricsDraft = {
  spend: string
  adSales: string
  orders: string
  acos: string
  units: string
  businessSales: string
}

export const EMPTY_MANUAL_METRICS: ManualMetricsDraft = {
  spend: '',
  adSales: '',
  orders: '',
  acos: '',
  units: '',
  businessSales: '',
}

/** 草稿 → 提交体：空串转 `null`（= 用报表值），其余转数字。 */
export function toManualPayload(draft: ManualMetricsDraft): ManualMetricInput {
  const pick = (raw: string) => {
    const text = raw.trim()
    return text === '' ? null : Number(text)
  }
  return {
    spend: pick(draft.spend),
    adSales: pick(draft.adSales),
    orders: pick(draft.orders),
    acos: pick(draft.acos),
    units: pick(draft.units),
    businessSales: pick(draft.businessSales),
  }
}

/** 已有人工值 → 草稿（用于弹窗预填）。 */
export function toManualDraft(
  metrics: Partial<ManualMetricInput> | null
): ManualMetricsDraft {
  if (!metrics) return { ...EMPTY_MANUAL_METRICS }
  const text = (value: number | null | undefined) =>
    value === null || value === undefined ? '' : String(value)
  return {
    spend: text(metrics.spend),
    adSales: text(metrics.adSales),
    orders: text(metrics.orders),
    acos: text(metrics.acos),
    units: text(metrics.units),
    businessSales: text(metrics.businessSales),
  }
}

export function hasAnyManualValue(draft: ManualMetricsDraft): boolean {
  return Object.values(draft).some((value) => value.trim() !== '')
}

/**
 * 覆盖情况的**自动推导**（与「数据覆盖」列同一口径）。
 *
 * 让用户自己选"广告+销售 / 仅广告 / …"没有意义：他填了哪几项，事实就是哪几项。
 * 服务端在 `deriveCoverageFromRow` 里做同一件事（那里是权威口径，这里只是给人看的预览）。
 */
export function describeCoverage(draft: ManualMetricsDraft): string {
  const hasAds =
    draft.spend.trim() !== '' ||
    draft.adSales.trim() !== '' ||
    draft.orders.trim() !== ''
  const hasSales = draft.units.trim() !== '' || draft.businessSales.trim() !== ''
  if (hasAds && hasSales) return '广告+销售'
  if (hasAds) return '仅广告'
  if (hasSales) return '仅销售'
  return '未填任何项'
}

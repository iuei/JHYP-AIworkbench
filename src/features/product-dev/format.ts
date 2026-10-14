import { isAxiosError } from 'axios'
import { MARKETPLACE_OPTIONS } from '@/features/competitor-analysis/format'
import { TABLE_EMPTY_VALUE } from '@/lib/table-styles'
import type { CandidateStage, DimensionFormat } from './types'

export {
  formatDateTime,
  toDateInputValue,
} from '@/features/competitor-analysis/format'

/**
 * 候选站点选项。
 *
 * 复用竞品分析的站点清单（站点枚举必须单一来源），但**去掉它的「自动（按数据推导）」项**：
 * 对比要求所有候选同站点，站点必须是一个明确值，"自动推导"在候选池里没有意义。
 */
export const CANDIDATE_MARKETPLACE_OPTIONS = MARKETPLACE_OPTIONS.filter(
  (item) => item.value !== 'auto'
)

/** 阶段徽章样式：已放弃用次要样式、已立项用实心，避免"放弃了"看起来像重点。 */
export const STAGE_VARIANTS: Record<
  CandidateStage,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  candidate: 'outline',
  researching: 'default',
  approved: 'secondary',
  rejected: 'outline',
}

export const WINDOW_OPTIONS = [
  { label: '近 7 天', value: '7' },
  { label: '近 30 天', value: '30' },
  { label: '近 90 天', value: '90' },
  { label: '自定义区间', value: 'custom' },
]

/**
 * 金额格式化。
 *
 * **刻意不带货币符号**：候选可以属于任意站点，写死 `$` 在日本站、欧洲站上都是错的，
 * 而正确符号需要服务端下发站点货币（当前没有）。维度名（「目标售价」「广告花费」）
 * 已经说明了这一列是什么，宁可不写符号，也不写一个可能错的符号。
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return TABLE_EMPTY_VALUE
  }
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return TABLE_EMPTY_VALUE
  }
  return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return TABLE_EMPTY_VALUE
  }
  return `${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%`
}

/**
 * 按维度定义渲染单元格值。
 *
 * 空值一律渲染为「—」（`TABLE_EMPTY_VALUE`），**不渲染成 0 或空字符串**：
 * 服务端刻意把"无数据"返回为 `null`，前端如果把它显示成 0，就把"报表没覆盖"
 * 变成了"表现是零"，那是本项目明令禁止的一类误导。
 */
export function formatDimensionValue(
  value: string | number | null | undefined,
  format: DimensionFormat
): string {
  if (value === null || value === undefined || value === '') return TABLE_EMPTY_VALUE
  switch (format) {
    case 'currency':
      return formatCurrency(Number(value))
    case 'number':
      return formatNumber(Number(value))
    case 'percent':
      return formatPercent(Number(value))
    default:
      return String(value)
  }
}

/** 覆盖率标签的徽章样式：只有"有我方数据"才是正面的。 */
export const COVERAGE_VARIANTS: Record<
  'ok' | 'no_asin' | 'no_report_data',
  'default' | 'secondary' | 'outline'
> = {
  ok: 'secondary',
  no_asin: 'outline',
  no_report_data: 'outline',
}

/**
 * 从接口错误里取服务端给的提示，取不到时用兜底文案。
 *
 * 2026-09-16 阶段 B：页面拆成三个子路由后，候选池与对比页都要用它 ——
 * 放在这里与 ASIN 清单的 `format.ts` 同一做法（模块内的纯函数集中一处，不各写一份）。
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? fallback
  }
  return fallback
}

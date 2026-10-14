import { createContext, useContext } from 'react'
import type { Candidate, ComparisonResult } from './types'

/**
 * 产品开发模块的**跨子页状态**（2026-09-16 阶段 B）。
 *
 * 为什么需要它：候选池 / 对比与历史 / 市场调研 原本是**同一个组件里的三个页签**，
 * 选中候选、对比参数、对比结果都是那个组件的 `useState`；改成三个独立路由之后，
 * 组件会随路由切换而卸载 —— 状态若留在子页里，"在候选池勾两个候选 → 切到对比页"就会
 * 变成空选择（"已选 N"徽标与对比按钮同时失效）。因此这三类状态上提到 `ProductDevLayout`，
 * 经本 context 注入。
 *
 * **刻意不上提**：候选列表与对比历史两个查询 —— React Query 缓存本来就跨组件共享，
 * 子页各自 `useQuery` 不会重复请求，也就不必把 loading / error 状态跨页传递。
 *
 * 生命周期与 `/product-dev` 一致：离开模块即随 layout 卸载释放，不会像全局 store 那样
 * 残留上一次的脏选择。
 */
export type ProductDevContextValue = {
  /** 已选候选（按 id 索引，存对象而非 id：跨页选择时徽标仍要显示候选名称）。 */
  selected: Map<number, Candidate>
  selectedList: Candidate[]
  /** 勾选 / 取消勾选单个候选。 */
  toggleSelect: (candidate: Candidate) => void
  /** 一次 setState 的批量勾选（候选池表头"全选"）：超上限只提示一次。 */
  toggleSelectMany: (items: Candidate[]) => void
  /** 编辑候选后同步已选中的那条（**只更新对象，不改选中状态**）。 */
  replaceSelected: (candidate: Candidate) => void
  /** 把某个候选从选择里摘掉（候选被删除时用，避免对比页留着一条已不存在的候选）。 */
  removeSelected: (id: number) => void
  clearSelection: () => void
  /** 对比统计区间。 */
  windowKey: string
  setWindowKey: (value: string) => void
  startDate: Date | undefined
  setStartDate: (value: Date | undefined) => void
  endDate: Date | undefined
  setEndDate: (value: Date | undefined) => void
  /** 对比结果（新对比与历史回看共用同一个展示位）。 */
  result: ComparisonResult | null
  setResult: (value: ComparisonResult | null) => void
  /** 当前结果是"历史回看"还是"刚跑的对比"，由结果面板据此显示来源。 */
  fromHistory: boolean
  setFromHistory: (value: boolean) => void
  activeComparisonId: number | null
  setActiveComparisonId: (value: number | null) => void
}

/** 与 `header-slot-context.ts` 同一做法：context 与 hook 放在无组件的文件里，满足 Fast Refresh 约束。 */
export const ProductDevContext = createContext<ProductDevContextValue | null>(
  null
)

export function useProductDev(): ProductDevContextValue {
  const value = useContext(ProductDevContext)
  if (!value) {
    throw new Error('useProductDev 必须在 ProductDevLayout 内使用。')
  }
  return value
}

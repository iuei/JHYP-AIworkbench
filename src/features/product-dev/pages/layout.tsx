import { useMemo, useState } from 'react'
import { Outlet } from '@tanstack/react-router'
import { toast } from 'sonner'
import { HeaderSlot } from '@/components/layout/header-slot'
import { Main } from '@/components/layout/main'
import { ProductDevNav } from '../components/product-dev-nav'
import { MAX_COMPARE_ITEMS } from '../constants'
import { ProductDevContext, type ProductDevContextValue } from '../dev-context'
import type { Candidate, ComparisonResult } from '../types'

/**
 * 产品开发模块布局（2026-09-16 阶段 B）。
 *
 * 候选池 / 对比与历史 / 市场调研 原先是一个组件里的三个页签（页内 Tabs + `view` search 参数），
 * 现在是三个独立路由；本布局接管两件原先由那个组件独揽的事：
 *
 * 1. **跨子页状态**（选中候选、对比参数、对比结果）—— 原先都在同一组件的 `useState` 里，
 *    拆路由后组件随路由卸载，状态留在子页里就会"切一下子页就丢"（"已选 N"与对比结果最明显）。
 *    上提到这里后经 `ProductDevContext` 注入子页，生命周期与 `/product-dev` 一致。
 * 2. **顶栏中段导航**（`ProductDevNav`）—— 与侧边栏「产品开发」子项同源派生。
 *
 * **查询刻意不上提**：候选列表与对比历史由子页各自 `useQuery` —— React Query 缓存跨组件共享，
 * 切子页不会重复请求，也就不必把 loading / error 跨页搬运。
 *
 * 页面标题（「产品开发」）由模块级路由的 `staticData.title` 提供，子页由顶栏导航高亮表达位置。
 */
export function ProductDevLayout() {
  // 选中项存的是对象而不只是 id：跨页选择时顶栏徽标与对比卡片仍要显示候选名称
  const [selected, setSelected] = useState<Map<number, Candidate>>(new Map())
  const [windowKey, setWindowKey] = useState('30')
  const [startDate, setStartDate] = useState<Date | undefined>(undefined)
  const [endDate, setEndDate] = useState<Date | undefined>(undefined)
  const [result, setResult] = useState<ComparisonResult | null>(null)
  const [fromHistory, setFromHistory] = useState(false)
  const [activeComparisonId, setActiveComparisonId] = useState<number | null>(null)

  const selectedList = useMemo(() => [...selected.values()], [selected])

  function toggleSelect(candidate: Candidate) {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(candidate.id)) {
        next.delete(candidate.id)
      } else {
        if (next.size >= MAX_COMPARE_ITEMS) {
          toast.info(`一次最多对比 ${MAX_COMPARE_ITEMS} 个候选。`)
          return prev
        }
        next.set(candidate.id, candidate)
      }
      return next
    })
  }

  /** 一次 setState 的批量勾选：表头"全选"用它，逐条调用 toggleSelect 会在超上限时连弹多次提示。 */
  function toggleSelectMany(items: Candidate[]) {
    setSelected((prev) => {
      const allSelected =
        items.length > 0 && items.every((item) => prev.has(item.id))
      const next = new Map(prev)
      if (allSelected) {
        for (const item of items) next.delete(item.id)
        return next
      }
      for (const item of items) {
        if (next.size >= MAX_COMPARE_ITEMS) {
          toast.info(`一次最多对比 ${MAX_COMPARE_ITEMS} 个候选。`)
          break
        }
        next.set(item.id, item)
      }
      return next
    })
  }

  /**
   * 编辑候选后同步已选中的那条。
   * **不能用 toggleSelect 调两次**（翻转两次看似等价于替换，但达到上限时第二次会被拦下，
   * 结果是把已选中的候选误删）；同理删除候选用 removeSelected，不要借道翻转。
   */
  function replaceSelected(candidate: Candidate) {
    setSelected((prev) => {
      if (!prev.has(candidate.id)) return prev
      const next = new Map(prev)
      next.set(candidate.id, candidate)
      return next
    })
  }

  function removeSelected(id: number) {
    setSelected((prev) => {
      if (!prev.has(id)) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  }

  /** 清空选择（批量删除未做：候选池上限 2000，逐条删除的入口已在行内，避免引入部分失败的批量语义）。 */
  function clearSelection() {
    setSelected(new Map())
  }

  const value: ProductDevContextValue = {
    selected,
    selectedList,
    toggleSelect,
    toggleSelectMany,
    replaceSelected,
    removeSelected,
    clearSelection,
    windowKey,
    setWindowKey,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    result,
    setResult,
    fromHistory,
    setFromHistory,
    activeComparisonId,
    setActiveComparisonId,
  }

  return (
    <ProductDevContext.Provider value={value}>
      <HeaderSlot>
        <ProductDevNav selectedCount={selectedList.length} />
      </HeaderSlot>
      <Main className='space-y-6'>
        <Outlet />
      </Main>
    </ProductDevContext.Provider>
  )
}

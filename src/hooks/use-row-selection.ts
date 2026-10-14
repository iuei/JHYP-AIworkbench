import { useCallback, useState } from 'react'

/**
 * 表格行选择（全站共享）。
 *
 * 语义刻意收窄成**「只在当前可见的这一页内选择」**：
 * 清单上限 5000 条、每页 50 条，跨页累积选择会让「移除所选」变成一次无法预期的批量删除
 * —— 用户点第 3 页的全选时，第 1 页的选中还在，最后删掉的东西比屏幕上看到的多。
 * 因此调用方在翻页 / 改筛选时应当 `clear()`（见 `DataTable` 使用方的做法）。
 *
 * 2026-09-16 从 ASIN 清单条目表抽出，供列表页复用。
 */
export function useRowSelection<TId extends number | string>() {
  const [selectedIds, setSelectedIds] = useState<Set<TId>>(() => new Set())

  const clear = useCallback(() => setSelectedIds(new Set()), [])

  const has = useCallback((id: TId) => selectedIds.has(id), [selectedIds])

  const toggleOne = useCallback((id: TId, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  /** 全选 / 取消全选给定的一批 id（调用方传"当前页的 id"）。 */
  const toggleAll = useCallback((ids: TId[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id))
      ids.forEach((id) => (allSelected ? next.delete(id) : next.add(id)))
      return next
    })
  }, [])

  /** 移除动作成功后把已消失的行从选中集合里摘掉（避免"已选 N 条"里含已删除的行）。 */
  const removeMany = useCallback((ids: TId[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })
  }, [])

  const isAllSelected = useCallback(
    (ids: TId[]) => ids.length > 0 && ids.every((id) => selectedIds.has(id)),
    [selectedIds]
  )

  const isSomeSelected = useCallback(
    (ids: TId[]) =>
      !ids.every((id) => selectedIds.has(id)) &&
      ids.some((id) => selectedIds.has(id)),
    [selectedIds]
  )

  return {
    selectedIds,
    count: selectedIds.size,
    has,
    toggleOne,
    toggleAll,
    removeMany,
    clear,
    isAllSelected,
    isSomeSelected,
  }
}

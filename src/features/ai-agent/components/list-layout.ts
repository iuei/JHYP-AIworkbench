import { useCallback, useState } from 'react'

/**
 * 列表的两种读法 + 展示方式偏好（2026-09-18 由「提示词广场」抽成共享件）。
 *
 * **为什么抽出来**：提示词广场、个人知识库、团队知识库现在都要"卡片 / 表格两种读法 +
 * 记住用户选择"，各写一份必然漂移（`competitor-analysis` 已经复制过一份 `LayoutToggle`）。
 * 组件部分在 `layout-toggle.tsx`，本文件只放类型、常量与 hook ——
 * 混在一个文件里会让 fast refresh 失效（`react-refresh/only-export-components`）。
 *
 * 与页面级选项卡的区别：这是"同一批数据的两种读法"，切换控件用 `aria-pressed` 分段按钮
 * 而不是 `role=tab` —— 混用会让读屏把两者读成同级（原提示词广场注释里的口径）。
 */
export type ListLayout = 'card' | 'table'

/**
 * 卡片网格：一行放 2–3 张，且**所有卡片尺寸一致**。
 *
 * - `auto-rows-fr`：所有行同一高度，卡片因此严格等高；
 * - 不写 `items-start`：卡片要填满自己的轨道，否则高度仍等于内容高度、`auto-rows-fr` 白设；
 * - 断点取 `sm:grid-cols-2 2xl:grid-cols-3`：`xl`（1280px）内容区只剩约 1000px，
 *   三列会把卡片压到 320px、标题行必然折行。
 *
 * 代价（有意接受）：内容最多的那张决定整页行高 —— 因此各列表的卡片都**不展开正文**，
 * 完整内容交给详情弹窗。
 */
export const CARD_GRID =
  'grid auto-rows-fr gap-3 sm:grid-cols-2 2xl:grid-cols-3'

/**
 * 读取上次选择的展示方式，默认卡片。
 *
 * 读失败一律回落默认值：隐私模式禁用 storage、值被改坏都不该让页面挂掉 ——
 * 展示偏好不值得为此报错。
 */
export function readStoredLayout(
  storageKey: string,
  fallback: ListLayout = 'card'
): ListLayout {
  try {
    const stored = localStorage.getItem(storageKey)
    return stored === 'card' || stored === 'table' ? stored : fallback
  } catch {
    return fallback
  }
}

/**
 * 展示方式的受控状态 + 持久化。
 *
 * **每个列表用自己的 `storageKey`**：知识库与提示词广场是两个独立的列表，
 * 共用键会让"在提示词广场选了表格"顺手也把知识库切成表格。
 */
export function useListLayout(
  storageKey: string,
  fallback: ListLayout = 'card'
): readonly [ListLayout, (next: ListLayout) => void] {
  const [layout, setLayout] = useState<ListLayout>(() =>
    readStoredLayout(storageKey, fallback)
  )

  const changeLayout = useCallback(
    (next: ListLayout) => {
      setLayout(next)
      try {
        localStorage.setItem(storageKey, next)
      } catch {
        // 存不下就不存：偏好不属于关键路径，不打扰用户
      }
    },
    [storageKey]
  )

  return [layout, changeLayout] as const
}

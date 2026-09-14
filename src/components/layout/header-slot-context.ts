import { createContext, useContext } from 'react'

export type HeaderSlotValue = {
  node: HTMLElement | null
  setNode: (node: HTMLElement | null) => void
}

/**
 * Header 中段的挂载点上下文。
 *
 * 与 `header-slot.tsx` 分开：React Fast Refresh 要求"只导出组件"的文件，
 * Provider/组件留在那个文件，context 与 hook 放这里。
 */
export const HeaderSlotContext = createContext<HeaderSlotValue | null>(null)

/** Header 用它把中段容器注册进 Provider；没有 Provider 时返回 undefined，ref 会被忽略。 */
export function useHeaderSlotRef() {
  return useContext(HeaderSlotContext)?.setNode
}

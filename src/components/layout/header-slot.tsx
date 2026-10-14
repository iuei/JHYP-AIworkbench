import { useContext, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { HeaderSlotContext } from './header-slot-context'

/**
 * Header 中段槽位。
 *
 * 为什么需要它：页面名统一进 Header 之后，模块内的二级导航（AI 助手的「对话 / 我的沉淀」、
 * AI 治理的五个治理页）如果继续留在内容区顶部，就仍然压在内容之上占一整行，
 * 而 Header 中段本来是空的。槽位把导航「搬进」Header，一次解决三件事：
 * 内容区少一行、Header 空白被填上、导航不再压在内容之上。
 *
 * 用 Portal 而不是把导航写死在 Header 里：全局 Header 不应该知道各模块有哪些子页，
 * 模块自己决定往槽位里放什么，槽位为空时 Header 布局不受影响。
 */
export function HeaderSlotProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLElement | null>(null)
  const value = useMemo(() => ({ node, setNode }), [node])

  return (
    <HeaderSlotContext.Provider value={value}>
      {children}
    </HeaderSlotContext.Provider>
  )
}

/** 模块/页面用它把内容注入 Header 中段；槽位尚未挂载时渲染为空。 */
export function HeaderSlot({ children }: { children: ReactNode }) {
  const node = useContext(HeaderSlotContext)?.node
  if (!node) return null

  return createPortal(children, node)
}

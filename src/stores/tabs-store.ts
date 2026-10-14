import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

/**
 * 已打开页面（多页签工作台）。
 *
 * ### 为什么要有它
 *
 * 参考截图里那条"物料管理 ｜ 公司账户 ｜ 库存余额 ｜ 需求计划 ×"不是页内 Tabs，
 * 而是**"我打开过哪些页面"**。项目原有两种导航都表达不了它：
 * 侧边栏答"这个功能在哪"，顶栏中段 `HeaderSlot` 答"同级页面切换"。
 * 三者语义不同，因此**并存**：页签管"已打开"，HeaderSlot 管"同级切换"。
 *
 * ### 三条口径
 *
 * 1. **key = pathname，不含 search**：同一个路径只占一个标签。带 `?view=` / `?analysisId=`
 *    的页面切换筛选条件时不该多开一个标签（那会让标签栏被同一页面的多个状态塞满）。
 *    代价：标签只记住路径、不记住查询串 —— 点回标签会回到该页的默认视图。
 * 2. **刷新保持**（`sessionStorage`）：关掉浏览器标签页即清空，符合"这一次工作里开过什么"的语义。
 * 3. **换账号即清空**：标签里可能留着 `/admin/users` 这类治理页，
 *    留给下一个登录的人会点出 403。因此 store 记 `owner`，账号不符时整份重置。
 */
export const MAX_PAGE_TABS = 20

export type PageTab = {
  /** 稳定标识 = 路由 pathname */
  key: string
  title: string
  /** 点击标签时导航到的地址 */
  href: string
}

/**
 * 打开/更新一个标签（纯函数，便于单测）。
 *
 * 已存在时只更新标题与地址：页面名可能随数据变化（但 href 不变），
 * 而更常见的是**同名重复打开** —— 那必须原地更新，不能再插一条。
 */
export function upsertPageTab(
  tabs: PageTab[],
  tab: PageTab,
  limit = MAX_PAGE_TABS
): PageTab[] {
  const existing = tabs.find((entry) => entry.key === tab.key)
  if (existing) {
    if (existing.title === tab.title && existing.href === tab.href) return tabs
    return tabs.map((entry) =>
      entry.key === tab.key
        ? { ...entry, title: tab.title, href: tab.href }
        : entry
    )
  }
  const next = [...tabs, tab]
  // 超上限时丢最早打开的（新开的这条必然留在末尾，不会被丢）
  return next.length > limit ? next.slice(next.length - limit) : next
}

/** 关闭标签（纯函数）。 */
export function closePageTab(tabs: PageTab[], key: string): PageTab[] {
  return tabs.filter((entry) => entry.key !== key)
}

/**
 * 关掉 `closedKey` 之后应该停在哪一个标签上（纯函数）。
 *
 * 优先右边那个（浏览器的既有习惯），没有右边就用左边；一个都不剩返回 `null`，
 * 由调用方决定回哪 —— 但**不能停在一个已经关掉的页面上**（地址栏还是旧路径、标签却没了）。
 */
export function neighborPageTab(
  tabs: PageTab[],
  closedKey: string
): PageTab | null {
  const index = tabs.findIndex((entry) => entry.key === closedKey)
  if (index < 0) return null
  const rest = tabs.filter((entry) => entry.key !== closedKey)
  if (rest.length === 0) return null
  return rest[Math.min(index, rest.length - 1)]
}

type PageTabsState = {
  tabs: PageTab[]
  activeKey: string | null
  /** 当前标签集合属于哪个账号：账号变了就整份重置（见上面的口径 3） */
  owner: string | null
  open: (tab: PageTab, owner: string) => void
  activate: (key: string) => void
  /** 关闭标签；关的若是当前激活项，返回"该跳去哪"，否则返回 `null` */
  close: (key: string) => string | null
  closeAll: () => void
}

export const usePageTabsStore = create<PageTabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeKey: null,
      owner: null,
      open: (tab, owner) =>
        set((state) => {
          if (state.owner !== owner) {
            return { owner, tabs: [tab], activeKey: tab.key }
          }
          return { tabs: upsertPageTab(state.tabs, tab), activeKey: tab.key }
        }),
      activate: (key) => set({ activeKey: key }),
      close: (key) => {
        const { tabs, activeKey } = get()
        const next = closePageTab(tabs, key)
        if (activeKey !== key) {
          set({ tabs: next })
          return null
        }
        const neighbor = neighborPageTab(tabs, key)
        set({ tabs: next, activeKey: neighbor?.key ?? null })
        return neighbor?.href ?? '/'
      },
      closeAll: () => set({ tabs: [], activeKey: null }),
    }),
    {
      name: 'page_tabs',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        tabs: state.tabs,
        activeKey: state.activeKey,
        owner: state.owner,
      }),
    }
  )
)

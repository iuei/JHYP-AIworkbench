import { useEffect } from 'react'
import {
  Link,
  useNavigate,
  useRouterState,
  type LinkProps,
} from '@tanstack/react-router'
import { X } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { usePageTabsStore } from '@/stores/tabs-store'
import { cn } from '@/lib/utils'
import { useBreadcrumb } from './breadcrumb'

/**
 * 已打开页面的页签栏（多页签工作台）。
 *
 * 位置：顶栏（`Header`）之下、内容区之上，**整条通栏**（不跟着 `Main` 的
 * `max-w-[1280px]` 居中 —— 它是"工作区"的一部分，不是某页的正文）。
 *
 * ### 语义选择：`nav` 而不是 `tabs`
 *
 * 它长得像 `role=tablist`，但语义不是：没有一个"面板"跟着切换，切标签就是**导航到另一个路由**。
 * 所以用 `nav[aria-label]` + `<a>`，读屏听到的是"链接"而不是"选项卡"，
 * 与"切了它页面会整个换掉"的事实一致。
 *
 * ### 激活态以 URL 为准，不看 store 的 `activeKey`
 *
 * 地址栏是唯一事实源：用户直接敲一个尚未打开过的路径时，同步 effect 还没跑，
 * `activeKey` 仍是上一页 —— 拿它高亮会出现"标签栏说在 A、页面显示 B"。
 */
export function PageTabs() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const navigate = useNavigate()
  const accountNo = useAuthStore((state) => state.auth.user?.accountNo ?? '')
  const tabs = usePageTabsStore((state) => state.tabs)
  const open = usePageTabsStore((state) => state.open)
  const close = usePageTabsStore((state) => state.close)
  const trail = useBreadcrumb()

  // 标签名用面包屑末级：它与顶栏显示的是同一个词，不会出现"顶栏写用户管理、标签写系统管理"。
  const title = trail[trail.length - 1]?.title

  useEffect(() => {
    if (!pathname || !title) return
    open({ key: pathname, title, href: pathname }, accountNo)
  }, [accountNo, open, pathname, title])

  if (tabs.length === 0) return null

  function handleClose(key: string) {
    const target = close(key)
    // 关掉的是当前页时必须离开它：否则地址栏还停在一个已经不存在标签的页面上
    if (target) void navigate({ to: target as LinkProps['to'] })
  }

  return (
    <nav
      aria-label='已打开的页面'
      data-page-tabs
      className='no-scrollbar flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/60 bg-muted/30 px-3'
    >
      {tabs.map((tab) => {
        const isActive = tab.key === pathname
        return (
          <div
            key={tab.key}
            data-page-tab
            data-active={isActive ? 'true' : undefined}
            className={cn(
              'group flex h-7 shrink-0 items-center rounded-md border text-sm transition-colors',
              isActive
                ? 'border-border bg-background text-foreground shadow-sm'
                : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            <Link
              to={tab.href as LinkProps['to']}
              aria-current={isActive ? 'page' : undefined}
              className='flex h-full max-w-40 items-center truncate ps-2.5 pe-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
            >
              {tab.title}
            </Link>
            <button
              type='button'
              aria-label={`关闭标签 ${tab.title}`}
              onClick={() => handleClose(tab.key)}
              className='me-1 grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none'
            >
              <X aria-hidden='true' className='size-3' />
            </button>
          </div>
        )
      })}
    </nav>
  )
}

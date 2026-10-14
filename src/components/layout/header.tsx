import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { AppBreadcrumb } from './app-breadcrumb'
import { useHeaderSlotRef } from './header-slot-context'

/**
 * 全局顶栏。
 *
 * 这里是**全应用唯一**渲染页面位置的地方。左侧是面包屑（`仪表盘 / 系统管理 / 用户管理`），
 * 它的层级名与末级页名都取自侧边栏数据与路由 `staticData.title`（见 `breadcrumb.ts`），
 * 页面组件不再自己写标题横幅 —— 历史上每个页面各写一份 `<Header>`，结果页面名
 * 有的出现在 Header、有的出现在内容区 24px 的 h1 里，竞品分析甚至两处都有。
 *
 * 面包屑末级仍用 `text-sm font-medium` 而不是 `text-2xl font-bold`：它不是内容重点，
 * 只是"我在哪"的位置指示，让首屏把纵向空间留给真实内容。
 *
 * 中段是 `HeaderSlot` 的挂载点，供模块注入二级导航（AI 助手、AI 治理）。
 */
type HeaderProps = Omit<React.HTMLAttributes<HTMLElement>, 'children'> & {
  fixed?: boolean
  ref?: React.Ref<HTMLElement>
}

export function Header({ className, fixed, ...props }: HeaderProps) {
  const [offset, setOffset] = useState(0)
  const setSlotNode = useHeaderSlotRef()

  useEffect(() => {
    const onScroll = () => {
      setOffset(document.body.scrollTop || document.documentElement.scrollTop)
    }

    // Add scroll listener to the body
    document.addEventListener('scroll', onScroll, { passive: true })

    // Clean up the event listener on unmount
    return () => document.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        // 常驻背景 + 底边框：此前顶栏是透明无边框的，页面顶部看起来"悬空"，
        // 滚动后内容还会从顶栏底下透出来。
        // shrink-0 必需：SidebarInset 是 flex 纵向容器，h-16 只提供 flex-basis，
        // 内容区（AI 治理等长页面）一高就会把顶栏挤扁到 37px（实测）。
        'z-50 h-16 shrink-0 border-b border-border/60 bg-background',
        fixed && 'header-fixed peer/header sticky top-0 w-[inherit]',
        offset > 10 && fixed ? 'shadow-sm' : 'shadow-none',
        className
      )}
      {...props}
    >
      <div className='flex h-full items-center gap-3 px-3'>
        <SidebarTrigger variant='outline' className='max-md:scale-125' />
        <Separator orientation='vertical' className='h-6' />
        <AppBreadcrumb />
        <div
          ref={setSlotNode}
          className='no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto'
        />
        <Search />
        <ThemeSwitch />
        <ProfileDropdown />
      </div>
    </header>
  )
}

import { Outlet } from '@tanstack/react-router'
import { getCookie } from '@/lib/cookies'
import { cn } from '@/lib/utils'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { Header } from '@/components/layout/header'
import { HeaderSlotProvider } from '@/components/layout/header-slot'
import { PageTabs } from '@/components/layout/page-tabs'
import { SkipToMain } from '@/components/skip-to-main'
import { AnnouncementGate } from '@/features/announcements/components/announcement-gate'

type AuthenticatedLayoutProps = {
  children?: React.ReactNode
}

export function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  const defaultOpen = getCookie('sidebar_state') !== 'false'
  return (
    <SearchProvider>
      <LayoutProvider>
        {/* 顶栏槽位需要同时包住 Header 与页面内容：Header 注册挂载点，页面往里注入二级导航。 */}
        <HeaderSlotProvider>
          <SidebarProvider defaultOpen={defaultOpen}>
            <SkipToMain />
            <AppSidebar />
            <SidebarInset
              className={cn(
                // Set content container, so we can use container queries
                '@container/content',

                // If layout is fixed, set the height
                // to 100svh to prevent overflow
                'has-data-[layout=fixed]:h-svh',

                // If layout is fixed and sidebar is inset,
                // set the height to 100svh - spacing (total margins) to prevent overflow
                'peer-data-[variant=inset]:has-data-[layout=fixed]:h-[calc(100svh-(var(--spacing)*4))]'
              )}
            >
              {/*
                顶栏只在这里渲染一次。以前每个页面各写一份 `<Header>`，
                「页面名有没有出现在顶栏」全靠开发者记性，仪表盘就漏了，
                而竞品分析又在内容区重复写了一遍。
              */}
              <Header fixed />
              {/*
                页签栏在顶栏之下、内容之上，整条通栏（不跟 `Main` 的居中宽度）。
                它是"工作区"级别的信息（这次开了哪几个页面），不属于任何单个页面，
                因此和 `Header` 一样挂在布局里而不是各页自己渲染。
              */}
              <PageTabs />
              {children ?? <Outlet />}
              {/*
                公告弹窗挂在全站布局里（不是各页面）：公告是全局行为，
                挂到页面上要么漏挂、要么重复弹。触发的时机由它自己判断 ——
                只有"本次确实登录过"才弹一次，刷新与站内跳转都不弹。
              */}
              <AnnouncementGate />
            </SidebarInset>
          </SidebarProvider>
        </HeaderSlotProvider>
      </LayoutProvider>
    </SearchProvider>
  )
}

import { Outlet } from '@tanstack/react-router'
import { getCookie } from '@/lib/cookies'
import { cn } from '@/lib/utils'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { Header } from '@/components/layout/header'
import { HeaderSlotProvider } from '@/components/layout/header-slot'
import { SkipToMain } from '@/components/skip-to-main'

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
              {children ?? <Outlet />}
            </SidebarInset>
          </SidebarProvider>
        </HeaderSlotProvider>
      </LayoutProvider>
    </SearchProvider>
  )
}

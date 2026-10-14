import { Outlet } from '@tanstack/react-router'
import { HeaderSlot } from '@/components/layout/header-slot'
import { Main } from '@/components/layout/main'
import { MarketInsightsNav } from '../components/market-insights-nav'

/** 市场洞察模块布局：侧边栏只保留一个入口，模块内用同级顶栏切换真实页面。 */
export function MarketInsightsLayout() {
  return (
    <>
      <HeaderSlot>
        <MarketInsightsNav />
      </HeaderSlot>
      <Main className='flex min-h-0 flex-col gap-6' fixed>
        <div className='flex min-h-0 flex-1 flex-col overflow-y-auto'>
          <Outlet />
        </div>
      </Main>
    </>
  )
}

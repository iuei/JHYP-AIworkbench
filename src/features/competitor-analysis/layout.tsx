import { Outlet } from '@tanstack/react-router'
import { HeaderSlot } from '@/components/layout/header-slot'
import { CompetitorAnalysisNav } from './components/analysis-nav'

/**
 * 竞品分析模块布局（2026-09-16）。
 *
 * 三个子页（分析 / 数据明细 / 竞品详情）都是本目录下的独立路由，本布局只做一件事：
 * **把顶栏中段导航挂进全局 Header 的槽位**（`CompetitorAnalysisNav`，与侧边栏子项同源）。
 *
 * 刻意**不在这里包 `Main`**：三个页面各自已经渲染 `<Main>`（含自己的标题区与间距），
 * 布局再包一层会出现 `<main>` 嵌套。顶栏导航是唯一的共享部分。
 *
 * 页面标题仍由各子路由的 `staticData.title` 提供（竞品分析 / 数据明细 / 竞品详情），
 * 比模块级统一标题更能说明"当前在哪一页"；本路由上的 `staticData.title` 只作兜底。
 */
export function CompetitorAnalysisLayout() {
  return (
    <>
      <HeaderSlot>
        <CompetitorAnalysisNav />
      </HeaderSlot>
      <Outlet />
    </>
  )
}

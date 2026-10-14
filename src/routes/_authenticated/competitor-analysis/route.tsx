import { createFileRoute } from '@tanstack/react-router'
import { CompetitorAnalysisLayout } from '@/features/competitor-analysis/layout'

/**
 * 竞品分析模块路由（2026-09-16）。
 *
 * 三个子页各有真实路径，本文件是它们的**布局**（`route.tsx`）：
 * - `/competitor-analysis`：分析主页（结论 + 竞品卡片 + 历史）
 * - `/competitor-analysis/details`：数据明细（全部数据块 + 口径声明）
 * - `/competitor-analysis/$asin`：竞品详情（单个 ASIN）
 *
 * 布局只负责把顶栏中段导航（分析 ｜ 数据明细）注入 Header 槽位，
 * 页面标题由各子路由的 `staticData.title` 提供。
 */
export const Route = createFileRoute('/_authenticated/competitor-analysis')({
  staticData: { title: '竞品分析' },
  component: CompetitorAnalysisLayout,
})

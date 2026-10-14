import { createFileRoute } from '@tanstack/react-router'
import { ProductDevLayout } from '@/features/product-dev/pages/layout'

/**
 * 产品开发模块路由（2026-09-16 阶段 B）。
 *
 * 三个子页（候选池 / 对比与历史 / 市场调研）从「一个页面的三个页签」改为**三个独立路由**：
 * 页签没有 URL，侧边栏、顶栏与命令菜单都无法表达"市场调研在哪"，也无法把某个子页发给同事；
 * 而它们本就是三件不同的事（维护候选 / 横向对比 / 类目市场研究）。
 *
 * 布局承担顶栏中段导航与跨子页状态（见 `product-dev/pages/layout.tsx`）。
 * 页面标题「产品开发」在模块级声明，子页由顶栏导航高亮表达位置（同 AI 治理的口径）。
 */
export const Route = createFileRoute('/_authenticated/product-dev')({
  staticData: { title: '产品开发' },
  component: ProductDevLayout,
})

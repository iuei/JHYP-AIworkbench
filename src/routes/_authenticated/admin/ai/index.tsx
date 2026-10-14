import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * 治理入口落地：/admin/ai 直接进「数据源与导入」。
 *
 * 为什么是重定向而不是删掉索引路由：侧边栏「系统管理 → AI 治理」的 url 就是 `/admin/ai`，
 * 删掉索引路由会让这个入口落到 notFoundComponent（点进去是 Not Found），
 * 所以保留索引路由、只把它的内容换成跳转。
 *
 * **落点 2026-09-18 由「知识库」改为「数据源与导入」**：知识库治理已并入
 * 「AI 工作台 → 知识库 → 团队知识库」，`/admin/ai/knowledge` 只剩一个重定向，
 * 不能再作为落点（否则点「AI 治理」会被转出治理区）；「数据源与导入」现在是四项里的第一项。
 * 「AI 治理」概览页已于 2026-09-15 按需求移除（总览 + 横向入口的实用性不大：
 * 各子页在顶栏导航里本来就一键可达，概览页只是一层中转）。
 * 模块名仍由父路由 `admin/ai/route.tsx` 的 `staticData.title` 提供，顶栏标题不受影响。
 */
export const Route = createFileRoute('/_authenticated/admin/ai/')({
  beforeLoad: () => {
    throw redirect({ to: '/admin/ai/datasources' })
  },
})

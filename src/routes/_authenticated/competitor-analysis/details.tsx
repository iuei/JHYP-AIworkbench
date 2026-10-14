import { createFileRoute, redirect } from '@tanstack/react-router'
import { parseSnapshotSearch } from '@/features/competitor-analysis/search-params'

/**
 * 旧路径 `/competitor-analysis/details` —— **重定向到「分析结果」**。
 *
 * 2026-09-16 该子页由「数据明细」改名为「分析结果」（用户口径：「数据明细应该修改为分析结果…
 * 分析结果页面内包含数据明细」），路径随之改为 `/competitor-analysis/results`。
 * 按「允许 URL 变更、旧链接加 redirect」的既有口径保留这条转发，`analysisId` 原样带过去，
 * 因此收藏夹、聊天记录里贴过的旧链接仍然可用。
 */
export const Route = createFileRoute(
  '/_authenticated/competitor-analysis/details'
)({
  staticData: { title: '分析结果' },
  validateSearch: parseSnapshotSearch,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/competitor-analysis/results',
      search,
      replace: true,
    })
  },
})

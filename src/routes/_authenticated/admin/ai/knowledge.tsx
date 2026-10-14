import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * 旧链接兼容：`/admin/ai/knowledge` → 知识库 → 团队知识库。
 *
 * **2026-09-18 起这个治理子页不再存在**（用户口径：「知识库已经迁移到 AI 工作台下，
 * AI 治理子页面不应该保留知识库」）：知识库治理动作并入「AI 工作台 → 知识库 →
 * 团队知识库」（管理员在该页看到管理视图，员工只读），顶栏「AI 治理」导航也不再列它。
 *
 * 路由**保留为纯跳转**而不是删掉：这个地址此前同时是「AI 治理」入口的落点，
 * 用户的书签、历史记录与部分验收脚本都指向它 —— 保留后它们全部落到真实页面上，
 * 不会掉进 `notFoundComponent`（与 `/admin/ai` 索引路由同一条口径）。
 *
 * **2026-10-14**：知识库的默认子页改为「团队知识库」，本跳转不再需要显式 `?view=team`，
 * 直接落到 `/knowledge`（默认页）即可。
 *
 * 旧的 `staticData.title`（「知识库」）随之移除：本路由不再渲染页面，
 * 页签名与面包屑末级由目标路由（`/knowledge` 的「知识库」）提供。
 */
export const Route = createFileRoute('/_authenticated/admin/ai/knowledge')({
  beforeLoad: () => {
    throw redirect({ to: '/knowledge' })
  },
})

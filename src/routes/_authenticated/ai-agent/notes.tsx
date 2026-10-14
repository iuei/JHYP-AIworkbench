import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * 旧入口兼容（2026-09-18）：「我的沉淀」迁进「知识库 → 个人知识库」。
 *
 * 迁移动因：知识沉淀是**知识资产**，与"对话"不是一类东西；而知识库此前只有管理员治理页，
 * 员工面根本没有入口。现在两者合成一个员工面一级类目「知识库」
 * （侧边栏「AI 工作台」分区下）：个人知识库就是原来的沉淀页，团队知识库是新增的视图
 * （员工只读，管理员在该页的管理视图里做治理）。
 *
 * 老书签、聊天里粘过的链接都还指向这里，沿用项目既有的 `beforeLoad` + `redirect` 模式。
 * **2026-10-14 起必须显式带 `?view=mine`**：知识库的默认子页已改为「团队知识库」，
 * 而这里的语义是**个人知识库**（原「我的沉淀」），不带参数会被落到团队库上。
 */
export const Route = createFileRoute('/_authenticated/ai-agent/notes')({
  beforeLoad: () => {
    throw redirect({ to: '/knowledge', search: { view: 'mine' } })
  },
})

import { createFileRoute } from '@tanstack/react-router'
import { KnowledgeBase } from '@/features/ai-agent/pages/knowledge-base'

/**
 * 「知识库」：全员可用。
 *
 * 两个子页（团队知识库 ｜ 个人知识库）共用本路由，用 search 参数 `view` 区分 ——
 * 与「提示词广场」的 `?view=mine` 同一做法：它们是同一入口下的两种取数范围，
 * 拆成两个路由会让路由树与侧边栏高亮都复杂化，而 `?view=mine` 已经足够可分享、可刷新。
 *
 * **默认子页 = 团队知识库**（2026-10-14 按用户口径「点击知识库默认打开团队知识库」）：
 * 无参数进页面看到的是公司已生效的知识文档；个人沉淀走 `?view=mine`。
 * 参数因此表达的是**非默认页**，默认页 URL 保持干净。
 *
 * 页面名必须自己声明（父级是认证布局，没有模块标题可继承）：顶栏标题与它自己的
 * 子页导航必须逐字一致。
 */
export type KnowledgeSearch = { view?: 'mine' }

export const Route = createFileRoute('/_authenticated/knowledge/')({
  staticData: { title: '知识库' },
  // 只认 `view=mine`；其余值（含手改的乱值）一律回落到默认页「团队知识库」
  validateSearch: (search: Record<string, unknown>): KnowledgeSearch =>
    search.view === 'mine' ? { view: 'mine' } : {},
  component: KnowledgeBase,
})

import { useSearch } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { TeamKnowledge } from '../components/team-knowledge'
import { KnowledgeManagement } from './knowledge-management'
import { NoteSpace } from './note-space'

/**
 * 「知识库」页面（2026-09-18）：两个子页共用同一路由，用 `?view=` 区分。
 *
 * - `?view` 缺省 = **团队知识库**（公司已生效的知识文档）；
 * - `?view=mine` = **个人知识库**（原「我的沉淀」，`NoteSpace` 原样复用）。
 *
 * **默认子页 2026-10-14 由「个人知识库」改为「团队知识库」**：按用户口径"点击知识库时
 * 默认页面…知识库也是（改为团队知识库）"。判定随之从"白名单 team"翻转为"只认 mine"：
 * `if (view === 'mine') return <NoteSpace />`，缺省走团队分支。
 *
 * 两个子页刻意**不合并成一个组件**：它们的权限模型、数据来源与交互完全不同
 * （一个可写、一个只读），硬塞进一个组件只会让"哪些操作对哪一边可见"变成一堆条件分支。
 *
 * 与提示词广场同一做法（那里也是 `PromptSquare` 一个组件内按 `view` 分两支取数）：
 * 子页的真相在 URL，刷新与分享都能落在同一个子页。
 *
 * **团队知识库按角色分两个视图（2026-09-18）**：知识库的**治理动作**（上传 / 有效期 /
 * 重建索引 / 下线启用删除 / 纠错反馈）原先住在「系统管理 → AI 治理 → 知识库」
 * （`/admin/ai/knowledge`）。用户口径「知识库已经迁移到 AI 工作台下，AI 治理子页面不应该
 * 保留知识库」—— 现在治理面并入本页：**管理员看到管理视图**（原治理页组件，能看已下线
 * 文档与纠错反馈），**员工只读**。两条边界的理由：① 写动作会直接改变 RAG 检索结果，不能给全员；
 * ② 两个视图打不同接口（`useKnowledgeDocuments` 管理员专属 / `usePublicKnowledgeDocuments`
 * 只回生效中文档），按角色分开渲染正好与"两份缓存互不污染"的口径一致。
 * 旧链接 `/admin/ai/knowledge` 与更早的 `/ai-agent/knowledge` 都重定向到这里。
 */
export function KnowledgeBase() {
  const { view } = useSearch({ from: '/_authenticated/knowledge/' })
  const isAdmin = useAuthStore(
    (state) => state.auth.user?.role.includes('admin') ?? false
  )

  if (view === 'mine') return <NoteSpace />
  return isAdmin ? <KnowledgeManagement /> : <TeamKnowledge />
}

import { createFileRoute } from '@tanstack/react-router'
import { PromptSquare } from '@/features/ai-agent/pages/prompt-square'

/**
 * 「提示词广场」：全员可用；私有提示词的账号级隔离由服务端接口保证。
 *
 * 两个子页（我的提示词 ｜ 共享提示词）共用本路由，用 search 参数 `view` 区分：
 * 它们只是同一份列表的两种取数范围，拆成两个路由会让路由树与侧边栏高亮都复杂化，
 * 而 `?view=shared` 已经足够可分享、可刷新。
 *
 * 页面名必须自己声明（不能继承模块标题 —— 这里的父级是认证布局，没有模块名）：
 * 顶栏标题与它自己的子页导航必须一致。
 */
export type PromptSquareSearch = { view?: 'shared' }

export const Route = createFileRoute('/_authenticated/prompts/')({
  staticData: { title: '提示词广场' },
  // 只认 `view=shared`；其余值（含手改的乱值）一律回落到默认页「我的提示词」
  validateSearch: (search: Record<string, unknown>): PromptSquareSearch =>
    search.view === 'shared' ? { view: 'shared' } : {},
  component: PromptSquare,
})

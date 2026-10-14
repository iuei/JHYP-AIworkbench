import { createFileRoute } from '@tanstack/react-router'
import { CompetitorAnalysis } from '@/features/competitor-analysis'
import { parseCompetitorAnalysisSearch } from '@/features/competitor-analysis/search-params'

/**
 * 竞品分析主页。
 *
 * 2026-09-16 由单文件 `competitor-analysis.tsx` 改为目录（本文件 + `$asin.tsx`）：
 * 商品公开数据改为卡片后，点卡片进的是 `/competitor-analysis/$asin`
 * —— 详情页是这一页的子页面（侧边栏高亮、返回路径都按父子关系成立），
 * 用目录承载比"靠非嵌套命名把两个页面摆成平级"更好读。
 *
 * **路由文件只做装配**：页面组件不依赖路由，参数在这里读出来当 props 传进去
 * （与 ASIN 清单、提示词广场同一做法，页面组件可独立渲染与测试）。
 */
export const Route = createFileRoute('/_authenticated/competitor-analysis/')({
  staticData: { title: '竞品分析' },
  // 首页深链靠这两个可选参数：analysisId 打开那条历史快照，focus=asin 聚焦输入框。
  // 脏值由解析器忽略，旧链接（无参数）行为完全不变。
  validateSearch: parseCompetitorAnalysisSearch,
  component: CompetitorAnalysisRoute,
})

/*
 * 本文件除了 `Route` 还定义了一个小组件（URL ↔ props 的桥接），因此 react-refresh
 * 会提示"文件只导出组件才能热更"。与 `ai-agent/asin-watchlists.tsx` 同一处理：
 * 桥接必须持有本文件的 `Route` 才能拿到正确的 search 类型；页面本身
 * （`features/competitor-analysis`）保持不依赖路由，可独立渲染与测试。
 */
// eslint-disable-next-line react-refresh/only-export-components
function CompetitorAnalysisRoute() {
  const { analysisId, focus } = Route.useSearch()
  return (
    <CompetitorAnalysis
      analysisId={analysisId}
      autoFocusAsin={focus === 'asin'}
    />
  )
}

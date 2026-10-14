import { Outlet } from '@tanstack/react-router'
import { HeaderSlot } from '@/components/layout/header-slot'
import { Main } from '@/components/layout/main'
import { KnowledgeNav } from '../components/knowledge-nav'

/**
 * 「知识库」模块布局（2026-09-18）。
 *
 * 与「提示词广场」（`prompts-layout.tsx`）同一形态：侧边栏一级类目 +
 * 自己的顶栏两个子页。此前知识库只有一个**管理员治理页**（`/admin/ai/knowledge`），
 * 员工面根本没有入口 —— 2026-09-18 先分出一个员工面一级类目，随后把治理面也并了进来
 * （团队知识库对管理员渲染管理视图，员工只读），`/admin/ai/knowledge` 现在只是历史跳转。
 *
 * 容器结构与 `PromptsLayout` 保持一致（`Main fixed` + flex 列 + `overflow-hidden`）：
 * 页面自身（`PageShell`）靠 `flex-1 + overflow-y-auto` 滚动，换成普通 block 容器
 * 会让长页面滚不动（2026-09-14 踩过的坑）。
 */
export function KnowledgeLayout() {
  return (
    <>
      <HeaderSlot>
        <KnowledgeNav />
      </HeaderSlot>
      <Main className='flex min-h-0 flex-col' fixed>
        <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          <Outlet />
        </div>
      </Main>
    </>
  )
}

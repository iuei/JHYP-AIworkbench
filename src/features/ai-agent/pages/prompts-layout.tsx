import { Outlet } from '@tanstack/react-router'
import { HeaderSlot } from '@/components/layout/header-slot'
import { Main } from '@/components/layout/main'
import { PromptSquareNav } from '../components/prompt-square-nav'

/**
 * 「提示词广场」模块布局（2026-09-16 阶段 C）。
 *
 * 它此前挂在 `AiAgentLayout` 下、靠那里的"按路径分流"临时换掉顶栏导航 —— 但它早已是
 * **侧边栏一级类目**（2026-09-15 升格），却仍住在 `/ai-agent/*` 路径里，
 * 形成"一级类目 + 二级路径"的错位。本轮把它迁到自己的路径 `/prompts`，
 * 顶栏导航（我的提示词 ｜ 共享提示词）改由本布局注入，`AiAgentLayout` 里的分流分支随之删除。
 *
 * 放在 feature 目录而不是路由文件里（与 `AiAgentLayout` 同一做法）：
 * 路由文件只负责路由定义与页面装配，组件写在里面会触发
 * react-refresh 的"只导出组件"告警。
 *
 * 容器结构与 `AiAgentLayout` 保持一致（`Main fixed` + flex 列 + `overflow-hidden`）：
 * 页面自身（`PageShell`）靠 `flex-1 + overflow-y-auto` 滚动，
 * 换成普通 block 容器会让长页面滚不动（2026-09-14 已踩过的坑）。
 */
export function PromptsLayout() {
  return (
    <>
      <HeaderSlot>
        <PromptSquareNav />
      </HeaderSlot>
      <Main className='flex min-h-0 flex-col' fixed>
        <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
          <Outlet />
        </div>
      </Main>
    </>
  )
}

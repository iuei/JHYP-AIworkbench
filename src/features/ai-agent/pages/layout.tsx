import { Outlet } from '@tanstack/react-router'
import { useAuthStore } from '@/stores/auth-store'
import { HeaderSlot } from '@/components/layout/header-slot'
import { Main } from '@/components/layout/main'
import { usePageWide } from '@/components/layout/use-page-wide'
import { useAiTools } from '../api/queries'
import { AgentNav } from '../components/agent-nav'

/**
 * AI 助手模块布局：沿用既有 Header / Main 体系，不引入新的布局框架。
 *
 * 内导航注入全局 Header 的中段（`HeaderSlot`）而不是留在内容区顶部：
 * 原来它占内容区一整行，还压在页面标题之上，而 Header 中段本来是空的。
 * 页面标题（「AI 助手」）由路由 `staticData` 提供，子页由导航高亮表达位置。
 *
 * 内容宽度按路由声明：对话页是三栏工作台，`staticData.wide` 让它铺满可用宽度
 * （默认的 `max-w-[1280px]` 居中会把它压到中栏只剩约 550px）；其余子页仍保持居中。
 */
export function AiAgentLayout() {
  const { auth } = useAuthStore()
  const isAdmin = auth.user?.role.includes('admin') ?? false
  const tools = useAiTools()
  const wide = usePageWide()

  return (
    <>
      <HeaderSlot>
        <AgentNav
          demoMode={tools.data?.provider.demo ?? false}
          isAdmin={isAdmin}
          toolCount={tools.data?.tools.length ?? 0}
        />
      </HeaderSlot>
      <Main className='flex min-h-0 flex-col' fixed fluid={wide}>
        <div className='min-h-0 flex-1 overflow-hidden'>
          <Outlet />
        </div>
      </Main>
    </>
  )
}

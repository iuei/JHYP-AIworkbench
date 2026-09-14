import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type PageShellProps = {
  children: ReactNode
  className?: string
}

/**
 * AI 助手/治理页统一外壳：只负责滚动容器与块间距。
 *
 * 页面标题**不在这里渲染** —— 它统一由全局 `Header` 从路由 `staticData.title` 读取。
 * 以前这里会画一个 `text-2xl` 的 h1 加一段说明文案，占掉首屏一整行，
 * 而标题本来就只是"我在哪"的位置指示，不该比内容更显眼。
 *
 * 为什么要有它：此前每个页面各自写 `h-full space-y-4 overflow-y-auto pe-2 pb-10`，
 * 四份重复的滚动容器；统一走这里，滚动与间距只有一处定义。
 */
export function PageShell({ children, className }: PageShellProps) {
  return (
    <div className={cn('h-full space-y-4 overflow-y-auto pe-2 pb-8', className)}>
      {children}
    </div>
  )
}

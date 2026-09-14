import { cn } from '@/lib/utils'

type ContentSectionProps = {
  children: React.ReactNode
  contentClassName?: string
}

/**
 * 设置中心页的统一外壳：只负责滚动容器与内容宽度。
 *
 * 页面标题**不在这里渲染** —— 它统一由全局 `Header` 从路由 `staticData.title` 读取。
 * 以前这里画的是 `text-lg` 的 h3 加一段说明再跟一条分隔线，占掉内容区顶部约 80px；
 * 页面名既然已经在顶栏，这里再写一遍只是重复占位。
 */
export function ContentSection({
  children,
  contentClassName,
}: ContentSectionProps) {
  return (
    <div className='faded-bottom h-full w-full overflow-y-auto scroll-smooth pe-4 pb-8'>
      <div className={cn('-mx-1 px-1.5 lg:max-w-none', contentClassName)}>
        {children}
      </div>
    </div>
  )
}

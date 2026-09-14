import { cn } from '@/lib/utils'

type MainProps = React.HTMLAttributes<HTMLElement> & {
  fixed?: boolean
  fluid?: boolean
  ref?: React.Ref<HTMLElement>
}

export function Main({ fixed, className, fluid, ...props }: MainProps) {
  return (
    <main
      data-layout={fixed ? 'fixed' : 'auto'}
      className={cn(
        'px-3 py-4',

        // If layout is fixed, make the main container flex and grow
        fixed && 'flex grow flex-col overflow-hidden',

        // 宽屏下正文铺满会失去排版边界感（1680 视口实测铺到 1392px）。
        // 统一收一个最大宽度并居中，页面不再各自写 max-w 覆盖。
        !fluid && 'mx-auto w-full max-w-[1280px]',
        className
      )}
      {...props}
    />
  )
}

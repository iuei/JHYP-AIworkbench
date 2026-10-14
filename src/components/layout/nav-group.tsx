import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { Badge } from '../ui/badge'
import { Separator } from '../ui/separator'
import { findActiveNavChild, isNavUrlActive } from './nav-match'
import { type NavCollapsible, type NavItem, type NavLink } from './types'

/** 悬停后打开浮窗前的等待：过滤"鼠标扫过侧边栏"造成的误弹，短到人眼不可感知。 */
const HOVER_OPEN_DELAY = 120
/** 移出后延迟关闭：给"从一级类目移到浮窗里"留出移动时间，否则子项永远点不到。 */
const HOVER_CLOSE_DELAY = 200
/** 点击一级类目后，这段时间内的关闭请求一律忽略（Radix 的一次点击会连发两次关闭）。 */
const CLOSE_GUARD = 300

/**
 * 侧边栏导航列表：一级类目平铺，不再有分组标题。
 *
 * **二级类目的呈现（2026-09-16 改）**：桌面端一级类目**不再内联手风琴展开**，
 * 改为悬停或点击时在右侧弹出**浮窗**（用户需求："取消点击一级类目展开为二级类目…
 * 修改为悬停或点击一级类目时出现二级类目浮窗"）。理由：内联展开会把下面的类目整体推下去，
 * 展开一个就会挤压其余入口，而二级项本身只是"进哪个页面"的快捷方式。
 *
 * 移动端（`isMobile`，抽屉式侧边栏）**保留点击内联展开**：触屏没有悬停，
 * 浮窗还会盖在抽屉之上、定位与滚动都不如内联自然。
 */
export function NavGroup({ items }: { items: NavItem[] }) {
  const { isMobile } = useSidebar()
  const href = useLocation({ select: (location) => location.href })

  /**
   * 先按业务域把项合起来（`section` 在数据里是逐项重复写的）。
   *
   * 需要它来判断"这个域里一共几项、域标题是不是就是项名" —— 2026-09-18
   * 「任务中心」独立成域后，域里只有一项且项名与域名相同，此时再渲染一行分组小字
   * 就会连着出现两个「任务中心」（正是「系统管理」那轮去掉的重复），
   * 那种情况改用一条分隔线表达"换了一个域"。
   */
  const domains = new Map<string, NavItem[]>()
  for (const item of items) {
    if (!item.section) continue
    const bucket = domains.get(item.section)
    if (bucket) bucket.push(item)
    else domains.set(item.section, [item])
  }

  return (
    <SidebarGroup>
      <SidebarMenu>
        {items.map((item, index) => {
          const key = `${item.title}-${item.url}`
          const showSection = Boolean(
            item.section &&
            (index === 0 || items[index - 1]?.section !== item.section)
          )
          const domain = item.section ? domains.get(item.section) : undefined
          /** 域名 = 域里唯一的项名：省略分组小字，只留分隔线。 */
          const selfNamedDomain =
            showSection &&
            domain?.length === 1 &&
            domain[0].title === item.section

          return (
            <Fragment key={key}>
              {showSection && !selfNamedDomain && (
                /*
                 * 分组小字（2026-09-20 压紧）：`mt-3 h-7` → `mt-2 h-6`。
                 * 一行分组标题原本连上间距占 40px（≈ 一个一级项的高度），四个域就是 160px；
                 * 压到 32px 后既保留了"换了一个业务域"的视觉停顿，又不再比它统辖的入口还占地方。
                 * 字号/字距不动 —— 它是 11px 的小字，再小就只剩色块感了。
                 */
                <SidebarGroupLabel className='mt-2 h-6 px-2 text-[11px] tracking-wide text-sidebar-foreground/50 uppercase first:mt-0'>
                  {item.section}
                </SidebarGroupLabel>
              )}
              {selfNamedDomain && (
                <li aria-hidden='true' className='py-1'>
                  <Separator className='bg-sidebar-border' />
                </li>
              )}
              {!item.items ? (
                <SidebarMenuLink item={item} href={href} />
              ) : isMobile ? (
                <SidebarMenuCollapsible item={item} href={href} />
              ) : (
                <SidebarMenuPopover item={item} href={href} />
              )}
            </Fragment>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}

function NavBadge({ children }: { children: ReactNode }) {
  return <Badge className='rounded-full px-1 py-0 text-xs'>{children}</Badge>
}

function SidebarMenuLink({ item, href }: { item: NavLink; href: string }) {
  const { setOpenMobile } = useSidebar()
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={checkIsActive(href, item)}
        tooltip={item.title}
      >
        <Link to={item.url} onClick={() => setOpenMobile(false)}>
          {item.icon && <item.icon />}
          <span>{item.title}</span>
          {item.badge && <NavBadge>{item.badge}</NavBadge>}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

/**
 * 桌面端一级类目：悬停或点击弹出二级类目浮窗。
 *
 * 三个容易踩的点（都在代码里守住了）：
 *   1. **不传 `tooltip`**：折叠成图标时 `SidebarMenuButton` 自带 tooltip，
 *      而它和浮窗都会在悬停时出现，两者会叠在一起。浮窗给出的是"这个类目下有哪些子页"，
 *      类目名由触发按钮的 `aria-label` 保证可访问名，无需 tooltip 再报一遍。
 *   2. **点击一级类目不把浮窗关掉**：Radix 的 trigger 是 toggle 语义，而且一次点击还会
 *      经过 DismissableLayer 再发一次关闭请求（实测连发两次），而用户的意图是"打开"。
 *      做法是在 `onPointerDown` 后开一个短时间窗（`CLOSE_GUARD`），窗内的关闭请求全部忽略
 *      （**不能**改用 `onPointerDown` + `preventDefault()`：非模态菜单下那样做，
 *      Radix 会把这次指针事件当成"点了菜单外部"而立刻关闭，实测踩到过）。
 *   3. **关闭要延迟**：指针从一级类目移到浮窗里会经过两个元素之间的空隙，
 *      立即关闭会让子项永远点不到；进入浮窗时取消定时器，移出时重新计时。
 *   4. **必须 `modal={false}`**：模态菜单打开时 Radix 会把 `body` 设为
 *      `pointer-events: none`、并给侧边栏其余内容加 `aria-hidden` —— 对点击式下拉没问题，
 *      对"悬停展开的导航"却是致命伤：菜单一开，其它一级类目既点不到、也读不到
 *      （实测：在浮窗打开状态下连「设置」按钮都无法被可访问性查询命中），
 *      而且 pointer-events 的来回切换会额外触发出入事件，Esc 关闭后还可能被重新弹开。
 *   5. **浮窗里不放一级类目标题**（2026-09-18 用户口径）：第一行直接是子项。
 *      标题与徽标在触发按钮上已经显示过，浮窗只回答"这个类目下有哪些子页"。
 */
function SidebarMenuPopover({
  item,
  href,
}: {
  item: NavCollapsible
  href: string
}) {
  const { setOpenMobile } = useSidebar()
  const [open, setOpen] = useState(false)
  const openTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)
  /**
   * 忽略关闭请求的截止时间戳（`onPointerDown` 时置位）。
   *
   * 为什么需要它：点击一级类目时 Radix 会**连发两次** `onOpenChange(false)` ——
   * trigger 自身的 toggle 一次、DismissableLayer 把这次点击当成"点了菜单外部"再一次
   * （实机抓到的事件序列），而用户这一下的意图是"打开"。用时间窗口兜住整串请求，
   * 就与"来了几次关闭请求"无关了。
   *
   * 代价（有意接受）：一级类目**不靠再次点击收起** —— 移开鼠标、Esc、点击别处
   * 都会关，而"点开"才是这一项的主用途。
   */
  const ignoreCloseUntil = useRef(0)

  // 卸载时清定时器：否则离开页面后仍会触发 setOpen
  useEffect(
    () => () => {
      if (openTimer.current !== null) window.clearTimeout(openTimer.current)
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    },
    []
  )

  const clearTimers = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current)
      openTimer.current = null
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const scheduleOpen = () => {
    clearTimers()
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null
      setOpen(true)
    }, HOVER_OPEN_DELAY)
  }

  const scheduleClose = () => {
    clearTimers()
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setOpen(false)
    }, HOVER_CLOSE_DELAY)
  }

  const handleOpenChange = (next: boolean) => {
    // 关闭中的点击允许收起；打开中的点击只忽略 Radix 为 toggle 产生的关闭事件。
    if (!next && !open && Date.now() < ignoreCloseUntil.current) return
    setOpen(next)
  }

  return (
    <SidebarMenuItem onMouseEnter={scheduleOpen} onMouseLeave={scheduleClose}>
      <DropdownMenu modal={false} open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            aria-label={item.title}
            isActive={checkIsActive(href, item)}
            onPointerDown={() => {
              ignoreCloseUntil.current = Date.now() + CLOSE_GUARD
            }}
          >
            {item.icon && <item.icon />}
            <span>{item.title}</span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
            {/*
              折叠成图标（`collapsible=icon`）时整行只剩 32px，箭头会被 `overflow-hidden`
              裁在按钮外（实测：箭头右缘 86px、按钮右缘 48px）—— 视觉上看不见，
              但让它留在 DOM 里会污染"折叠态里有什么"的度量与自动化选择器，直接隐藏。
            */}
            <ChevronRight
              className='ms-auto size-4 text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden'
              aria-hidden='true'
            />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='start'
          className='min-w-48'
          side='right'
          sideOffset={6}
          onMouseEnter={clearTimers}
          onMouseLeave={scheduleClose}
        >
          {/*
            **浮窗里不重复一级类目标题**（2026-09-18 用户口径：「悬停在一级类目下展示二级类目时
            不需要展示一级类目的标题」）。此前第一行是 `DropdownMenuLabel`（标题 + 徽标）加一条
            分隔线，但它重复了触发按钮上已经显示的信息（标题在按钮文本里、`item.badge` 也挂在
            按钮上，见 `SidebarMenuButton` 那段），而浮窗的全部价值就是回答
            "这个类目下有哪些子页" —— 去掉这层标题后，子项直接顶到浮窗第一行。
            可访问名不受影响：`DropdownMenuContent` 由触发按钮关联（按钮带 `aria-label={item.title}`）。
          */}
          {item.items.map((subItem) => (
            <DropdownMenuItem key={`${subItem.title}-${subItem.url}`} asChild>
              <Link
                className={cn(
                  // 浮窗内统一行高（36px）与内边距：2026-09-20 起与一级项同高，
                  // 父子层级改由浮窗自身承担（独立面板 + 右侧 6px 偏移 + 一级项才有的箭头），
                  // 不再靠"子项比父项矮一档"表达
                  'h-9 gap-2 px-2',
                  checkIsActive(href, subItem) &&
                    'bg-accent font-medium text-sidebar-primary'
                )}
                to={subItem.url}
                onClick={() => {
                  setOpen(false)
                  setOpenMobile(false)
                }}
              >
                {subItem.icon && <subItem.icon />}
                <span>{subItem.title}</span>
                {subItem.badge && (
                  <span className='ms-auto text-xs text-muted-foreground'>
                    {subItem.badge}
                  </span>
                )}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

/** 移动端一级类目：点击内联展开（触屏没有悬停，见 `NavGroup` 注释）。 */
function SidebarMenuCollapsible({
  item,
  href,
}: {
  item: NavCollapsible
  href: string
}) {
  const { setOpenMobile } = useSidebar()
  return (
    <Collapsible
      asChild
      defaultOpen={checkIsActive(href, item, true)}
      className='group/collapsible'
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={item.title}>
            {item.icon && <item.icon />}
            <span>{item.title}</span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
            <ChevronRight
              className='ms-auto size-4 text-sidebar-foreground/50 transition-transform group-data-[state=open]/collapsible:rotate-90'
              aria-hidden='true'
            />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent className='CollapsibleContent'>
          <SidebarMenuSub>
            {item.items.map((subItem) => (
              <SidebarMenuSubItem key={subItem.title}>
                <SidebarMenuSubButton
                  asChild
                  isActive={checkIsActive(href, subItem)}
                >
                  <Link to={subItem.url} onClick={() => setOpenMobile(false)}>
                    {subItem.icon && <subItem.icon />}
                    <span>{subItem.title}</span>
                    {subItem.badge && <NavBadge>{subItem.badge}</NavBadge>}
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

/**
 * 导航项是否激活。
 *
 * 路径命中判定（剥离 `?search`、`matchPrefix` 前缀）已搬到 `nav-match.ts` 的
 * `isNavUrlActive()` —— 面包屑要用**完全相同**的口径回答"当前路径属于哪个类目"，
 * 两份实现各写一遍必然出现"侧边栏点亮 A、面包屑却说是 B"。这里只保留侧边栏特有的两条：
 * `mainNav` 的按首段比对，以及"子项命中则父类目也算激活"。
 */
function checkIsActive(href: string, item: NavItem, mainNav = false) {
  const path = href.split('?')[0]
  const url = typeof item.url === 'string' ? item.url : undefined
  return (
    isNavUrlActive(path, url, item.matchPrefix) ||
    (!!item.items && !!findActiveNavChild(path, item.items)) ||
    (mainNav &&
      path.split('/')[1] !== '' &&
      path.split('/')[1] === url?.split('/')[1])
  )
}

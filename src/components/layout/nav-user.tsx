import { Link } from '@tanstack/react-router'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'

type NavUserProps = {
  /** 当前登录用户的姓名；取不到时由调用方退化成账号，绝不显示占位假名。 */
  name: string
  /** 登录账号（`users.login`），与「用户信息」页展示的是同一个字段。 */
  accountNo: string
}

/**
 * 侧边栏底部的当前用户。
 *
 * 只负责展示，数据由 `AppSidebar` 注入（`/auth/me` 为准、登录态兜底）。
 * 此前它的入参来自 `sidebarData.user` 这份**硬编码假数据**，于是无论谁登录，
 * 左下角永远写着「内部用户 / user@company.local」—— 那不是"默认值"，是错的。
 *
 * 头像刻意不挂 `AvatarImage`：模板里的 `/avatars/01.png` 在本项目 `public/` 下并不存在
 * （一直是 404 后回退到 fallback），留着只会让人以为"图挂了"，所以直接用姓名首字。
 */
export function NavUser({ name, accountNo }: NavUserProps) {
  /*
   * 移动端抽屉里点这个入口后**必须自己关掉抽屉**（2026-09-18）：
   * 其它导航项都走 `NavGroup` 里的 `setOpenMobile(false)`，只有这一项此前没有，
   * 于是点了「用户信息」抽屉还盖在新页面上（实测：URL 已到 `/settings`，抽屉仍打开）。
   * 桌面端 `setOpenMobile` 是空操作，无需分支。
   */
  const { setOpenMobile } = useSidebar()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size='lg' tooltip='用户信息' asChild>
          <Link to='/settings' onClick={() => setOpenMobile(false)}>
            <Avatar className='h-8 w-8 rounded-lg'>
              <AvatarFallback className='rounded-lg'>
                {name.trim().slice(0, 1) || '用'}
              </AvatarFallback>
            </Avatar>
            <div className='grid flex-1 text-start text-sm leading-tight'>
              <span className='truncate font-semibold'>{name}</span>
              <span className='truncate text-xs'>{accountNo}</span>
            </div>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

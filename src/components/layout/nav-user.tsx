import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { UserInfoMenu } from '@/components/user-info-menu'

type NavUserProps = {
  /** 当前登录用户的姓名；取不到时由调用方退化成账号，绝不显示占位假名。 */
  name: string
  /** 登录账号（`users.login`），与「用户信息」页展示的是同一个字段。 */
  accountNo: string
  /** 部门（`users.department`）；未配置时卡片里显示「未设置」。 */
  department?: string | null
  /** 角色（`/auth/me` 的 `role`：admin / operator），卡片里经 `roleLabel` 转中文。 */
  role?: string | null
}

/**
 * 侧边栏底部的当前用户。
 *
 * 只负责展示与挂触发器，数据由 `AppSidebar` 注入（`/auth/me` 为准、登录态兜底）。
 * 此前它的入参来自 `sidebarData.user` 这份**硬编码假数据**，于是无论谁登录，
 * 左下角永远写着「内部用户 / user@company.local」—— 那不是"默认值"，是错的。
 *
 * 头像刻意不挂 `AvatarImage`：模板里的 `/avatars/01.png` 在本项目 `public/` 下并不存在
 * （一直是 404 后回退到 fallback），留着只会让人以为"图挂了"，所以直接用姓名首字。
 *
 * 2026-10-14（用户口径）：点击后**不再跳转 `/settings`**，改为就地弹出用户信息卡 ——
 * 登录账号 / 姓名 / 部门 / 角色四项加上底部「退出登录」。卡片本体与顶部头像共用
 * `UserInfoMenu`（见该文件注释），这里只保留"侧边栏触发器长什么样"和"往右弹"。
 * 这推翻了 2026-08-28「左下角与顶部头像统一改为直接进入用户信息页」的旧口径
 * （`/settings` 用户信息页本身仍在，只是两个头像都不再跳它）。
 */
export function NavUser({ name, accountNo, department, role }: NavUserProps) {
  // 姓名缺失时退化成账号：宁可重复展示账号，也不出现空白或占位假名
  const displayName = name.trim() || accountNo

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <UserInfoMenu
          name={displayName}
          accountNo={accountNo}
          department={department}
          role={role}
          side='right'
          align='end'
        >
          <SidebarMenuButton
            size='lg'
            tooltip='用户信息'
            className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
          >
            <Avatar className='h-8 w-8 rounded-lg'>
              <AvatarFallback className='rounded-lg'>
                {displayName.slice(0, 1) || '用'}
              </AvatarFallback>
            </Avatar>
            <div className='grid flex-1 text-start text-sm leading-tight'>
              <span className='truncate font-semibold'>{displayName}</span>
              <span className='truncate text-xs'>{accountNo}</span>
            </div>
          </SidebarMenuButton>
        </UserInfoMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

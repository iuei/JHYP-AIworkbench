import { useCurrentUser } from '@/hooks/use-current-user'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { UserInfoMenu } from '@/components/user-info-menu'

/**
 * 顶部栏右侧的当前用户头像。
 *
 * 2026-10-14（用户口径，与侧边栏底部同轮）：点击后**不再跳转 `/settings`**，
 * 改为就地弹出与侧边栏完全同一张用户信息卡（`UserInfoMenu`：登录账号 / 姓名 / 部门 / 角色
 * + 底部「退出登录」）—— 两处头像现在是同一个交互，只有弹出方向不同（这里朝下）。
 *
 * 顺带修掉两处模板遗留：此前头像写死 `SN` 占位、引用并不存在的 `/avatars/01.png`
 * （一直 404 后回退），且这个会话头部右侧从来没有接入过真实账号。
 * 现在数据统一走 `useCurrentUser()`（`/auth/me`，与侧边栏、用户信息页同一个 query key）。
 */
export function ProfileDropdown() {
  const { name, accountNo, department, role } = useCurrentUser()
  const displayName = name.trim() || accountNo

  return (
    <UserInfoMenu
      name={displayName}
      accountNo={accountNo}
      department={department}
      role={role}
      side='bottom'
      align='end'
    >
      <Button
        variant='ghost'
        size='icon'
        className='relative size-8 rounded-full'
        aria-label='用户信息'
      >
        <Avatar className='h-8 w-8'>
          <AvatarFallback>{displayName.slice(0, 1) || '用'}</AvatarFallback>
        </Avatar>
      </Button>
    </UserInfoMenu>
  )
}

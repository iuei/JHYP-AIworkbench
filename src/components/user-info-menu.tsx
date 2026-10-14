import { LogOut } from 'lucide-react'
import useDialogState from '@/hooks/use-dialog-state'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { SignOutDialog } from '@/components/sign-out-dialog'
import { roleLabel } from '@/features/settings/user-labels'

const NOT_SET = '未设置'

export type UserInfoMenuProps = {
  /** 姓名；为空时由调用方先退化成账号（`useCurrentUser` 已做）。 */
  name: string
  /** 登录账号（`users.login`）。 */
  accountNo: string
  /** 部门（`users.department`）；空值显示「未设置」。 */
  department?: string | null
  /** 角色标识（admin / operator），经 `roleLabel()` 转中文。 */
  role?: string | null
  /** 浮层相对触发器的方向：侧边栏朝右、顶栏朝下。 */
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  /** 触发器：各调用方自己决定长什么样（侧边栏是大块用户区、顶栏是圆形头像）。 */
  children: React.ReactNode
}

/**
 * 「点一下就地看我是谁」的用户信息卡（2026-10-14）。
 *
 * 用户口径（两处头像都适用）：「点击时不弹出新界面，直接列出用户信息即可，
 * 最下面再添加一个退出登录按钮」——因此这里**只放信息 + 退出登录**，不放任何跳转入口。
 *
 * 为什么抽成组件：这是本会话第二次出现同一诉求（先侧边栏底部、再顶部头像），
 * 两处要展示的字段、文案、退出流程与「未设置」兜底完全一致，各写一份必然漂移
 * （例如一边把 `admin` 摊给用户、另一边翻译成「管理员」）。
 * 差异只有两处，作为 props 暴露：**触发器长什么样**（children）与**浮层往哪弹**（side / align）。
 */
export function UserInfoMenu({
  name,
  accountNo,
  department,
  role,
  side = 'bottom',
  align = 'end',
  children,
}: UserInfoMenuProps) {
  const [signOutOpen, setSignOutOpen] = useDialogState()
  const fields = [
    { label: '登录账号', value: accountNo || NOT_SET },
    { label: '姓名', value: name.trim() || accountNo || NOT_SET },
    { label: '部门', value: department?.trim() || NOT_SET },
    // 角色必须转成中文：`admin` 是接口枚举值，不是给用户看的词
    { label: '角色', value: role ? roleLabel(role) : NOT_SET },
  ]

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      {/*
        `avoidCollisions`（Radix 默认开启）负责在窄屏 / 移动端抽屉里自动翻转位置，
        所以两个调用方只需给"默认方向"，不必按设备写分支。
      */}
      <PopoverContent
        side={side}
        align={align}
        sideOffset={8}
        aria-label='用户信息'
        className='w-72 p-0'
      >
        <dl className='space-y-3 p-4'>
          {fields.map((field) => (
            <div
              key={field.label}
              className='flex items-start justify-between gap-4'
            >
              <dt className='shrink-0 text-xs text-muted-foreground'>
                {field.label}
              </dt>
              <dd className='min-w-0 flex-1 text-end text-sm font-medium break-words'>
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
        <div className='border-t p-2'>
          <Button
            variant='destructive'
            className='w-full justify-start'
            onClick={() => setSignOutOpen(true)}
          >
            <LogOut />
            退出登录
          </Button>
        </div>
      </PopoverContent>
      {/*
        退出确认框挂在 Popover 里（而不是各调用方）：点「退出登录」后卡片可能仍开着，
        确认框是 Portal 到 body 的模态层，层级不受影响；挂在外面则每个调用方都得自己管这个状态。
      */}
      <SignOutDialog open={!!signOutOpen} onOpenChange={setSignOutOpen} />
    </Popover>
  )
}

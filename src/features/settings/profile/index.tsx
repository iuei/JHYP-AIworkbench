import { useQuery } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import { api } from '@/api/client'
import useDialogState from '@/hooks/use-dialog-state'
import { SignOutDialog } from '@/components/sign-out-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ContentSection } from '../components/content-section'
import { roleLabel } from '../user-labels'
import type { CurrentUserProfile } from './types'

function InfoField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className='min-w-0 space-y-1'>
      <dt className='text-sm text-muted-foreground'>{label}</dt>
      <dd className='text-sm font-medium break-words'>{children}</dd>
    </div>
  )
}

/**
 * 用户信息页是只读的。
 *
 * 此前这里放了「个人资料」和「账户信息」两个可编辑表单，但提交只调用
 * `showSubmittedData`（弹一个 JSON toast），既没有接口也不落库 —— 用户改完刷新即丢，
 * 却会以为自己改掉了工号或角色（角色是权限依据、工号是账号主键），属于职责错位
 * 加权限误导。这些字段的配置权在管理员侧「设置 → 用户管理」（`PATCH /api/users/:id`），
 * 因此这里只读展示，并提供用户真正自己的两个动作：查看账号信息、退出登录。
 */
export function SettingsProfile() {
  const [signOutOpen, setSignOutOpen] = useDialogState()
  const profile = useQuery<CurrentUserProfile>({
    queryKey: ['current-user'],
    queryFn: async () => (await api.get('/auth/me')).data,
  })

  return (
    <ContentSection contentClassName='lg:max-w-2xl'>
      <div className='space-y-10'>
        <section className='space-y-5' aria-labelledby='profile-heading'>
          <div>
            <h4 id='profile-heading' className='font-medium'>
              基本信息
            </h4>
            <p className='text-sm text-muted-foreground'>
              姓名、部门和角色由管理员在「设置 → 用户管理」中统一配置，如需修改请联系管理员。
            </p>
          </div>

          {profile.isLoading && <Skeleton className='h-28 w-full' />}

          {profile.isError && (
            <p className='text-sm text-muted-foreground'>
              用户信息加载失败，请刷新页面重试。
            </p>
          )}

          {profile.data && (
            <dl className='grid gap-x-8 gap-y-5 sm:grid-cols-2'>
              <InfoField label='登录账号'>{profile.data.login}</InfoField>
              <InfoField label='姓名'>{profile.data.name}</InfoField>
              <InfoField label='部门'>
                {profile.data.department || (
                  <span className='font-normal text-muted-foreground'>
                    未设置
                  </span>
                )}
              </InfoField>
              <InfoField label='角色'>{roleLabel(profile.data.role)}</InfoField>
            </dl>
          )}
        </section>

        <section
          className='space-y-4 border-t pt-8'
          aria-labelledby='security-heading'
        >
          <div>
            <h4 id='security-heading' className='font-medium'>
              登录与安全
            </h4>
            <p className='text-sm text-muted-foreground'>
              退出后需要重新登录才能继续访问工作台。忘记密码请联系管理员重置。
            </p>
          </div>
          <Button variant='destructive' onClick={() => setSignOutOpen(true)}>
            <LogOut />
            退出登录
          </Button>
        </section>
      </div>

      <SignOutDialog open={!!signOutOpen} onOpenChange={setSignOutOpen} />
    </ContentSection>
  )
}

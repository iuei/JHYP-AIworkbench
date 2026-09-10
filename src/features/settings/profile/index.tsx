import { LogOut } from 'lucide-react'
import useDialogState from '@/hooks/use-dialog-state'
import { SignOutDialog } from '@/components/sign-out-dialog'
import { Button } from '@/components/ui/button'
import { ContentSection } from '../components/content-section'
import { AccountForm } from '../account/account-form'
import { ProfileForm } from './profile-form'

export function SettingsProfile() {
  const [signOutOpen, setSignOutOpen] = useDialogState()

  return (
    <ContentSection
      title='用户信息'
      desc='统一管理个人资料、账户信息和登录状态。'
      contentClassName='lg:max-w-none'
    >
      <div className='grid gap-10 lg:grid-cols-2 lg:gap-x-0'>
        <section
          className='space-y-5 lg:pe-8'
          aria-labelledby='profile-heading'
        >
          <div>
            <h4 id='profile-heading' className='font-medium'>
              个人资料
            </h4>
            <p className='text-sm text-muted-foreground'>
              维护工作台内展示的基础个人信息。
            </p>
          </div>
          <ProfileForm />
        </section>

        <section
          className='space-y-5 border-t pt-10 lg:border-s lg:border-t-0 lg:ps-8 lg:pt-0'
          aria-labelledby='account-heading'
        >
          <div>
            <h4 id='account-heading' className='font-medium'>
              账户信息
            </h4>
            <p className='text-sm text-muted-foreground'>
              查看和维护内部账户基础信息。
            </p>
          </div>
          <AccountForm />
        </section>

        <section
          className='space-y-4 border-t pt-8 lg:col-span-2'
          aria-labelledby='security-heading'
        >
          <div>
            <h4 id='security-heading' className='font-medium'>
              登录与安全
            </h4>
            <p className='text-sm text-muted-foreground'>
              退出后需要重新登录才能继续访问工作台。
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

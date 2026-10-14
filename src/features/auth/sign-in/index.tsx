import { Link, useSearch } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'
import { AuthLayout } from '../auth-layout'
import { SignInBrandPanel } from './components/sign-in-brand-panel'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })

  return (
    <AuthLayout variant='split' aside={<SignInBrandPanel />}>
      <div className='space-y-8'>
        <header className='space-y-2'>
          <h1 className='text-3xl font-bold tracking-tight'>欢迎回来</h1>
          <p className='text-sm leading-6 text-muted-foreground'>
            使用账号登录 JHYP 智能工作台
          </p>
        </header>
        <UserAuthForm redirectTo={redirect} />
        <p className='flex items-center gap-2 text-sm text-muted-foreground'>
          <ShieldCheck className='size-4' aria-hidden='true' />
          内部工作台 · 仅限授权用户
        </p>
        {/* 自助注册入口：提交后账号处于待审核，需管理员在「用户管理」放行 */}
        <p className='text-sm text-muted-foreground'>
          还没有账号？{' '}
          <Link
            to='/sign-up'
            className='font-medium text-primary underline-offset-4 hover:underline'
          >
            注册新账号
          </Link>
          （提交后需管理员审核）
        </p>
      </div>
    </AuthLayout>
  )
}

import { Link } from '@tanstack/react-router'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AuthLayout } from '../auth-layout'
import { SignUpForm } from './components/sign-up-form'

export function SignUp() {
  return (
    <AuthLayout>
      <Card className='max-w-sm gap-4 sm:min-w-sm'>
        <CardHeader>
          <CardTitle className='text-lg tracking-tight'>注册账号</CardTitle>
          <CardDescription>
            提交后需管理员审核通过，才能登录使用。
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <SignUpForm />
          <p className='text-center text-sm text-muted-foreground'>
            已有账号？{' '}
            <Link
              to='/sign-in'
              className='font-medium text-primary underline-offset-4 hover:underline'
            >
              返回登录
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthLayout>
  )
}

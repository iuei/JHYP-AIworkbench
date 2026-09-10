import { useState } from 'react'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, LogIn } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { type AuthUser, useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'
import { PasswordInput } from '@/components/password-input'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

const formSchema = z.object({
  login: z.string().min(1, '请输入账号或邮箱。'),
  password: z
    .string()
    .min(1, '请输入密码。')
    .min(6, '密码至少需要 6 个字符。'),
})

const authUserSchema: z.ZodType<AuthUser> = z
  .object({
    accountNo: z.string(),
    email: z.string(),
    role: z.array(z.string()),
    exp: z.number(),
  })
  .passthrough()

const loginResponseSchema = z.object({
  token: z.string().min(1),
  user: authUserSchema,
})

type UserAuthFormProps = Omit<React.ComponentProps<'form'>, 'onSubmit'> & {
  redirectTo?: string
}

export function UserAuthForm({
  className,
  redirectTo,
  ...props
}: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const { auth } = useAuthStore()
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { login: '', password: '' },
  })

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true)
    try {
      let loginData: z.infer<typeof loginResponseSchema>

      try {
        const response = await api.post<unknown>('/auth/login', values)
        loginData = loginResponseSchema.parse(response.data)
      } catch {
        toast.error('账号或密码错误，或后端服务未启动。')
        return
      }

      try {
        auth.setUser(loginData.user)
        auth.setAccessToken(loginData.token)
        await navigate({ to: redirectTo || '/', replace: true })
      } catch {
        auth.reset()
        toast.error('登录状态初始化失败，请重试。')
        return
      }

      toast.success('登录成功')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form
        {...props}
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-5', className)}
      >
        <FormField
          control={form.control}
          name='login'
          render={({ field }) => (
            <FormItem>
              <FormLabel>账号 / 邮箱</FormLabel>
              <FormControl>
                <Input
                  className='h-11'
                  placeholder='请输入账号或邮箱'
                  autoComplete='username'
                  {...field}
                />
              </FormControl>
              <div className='min-h-5'>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='password'
          render={({ field }) => (
            <FormItem>
              <FormLabel>密码</FormLabel>
              <FormControl>
                <PasswordInput
                  className='[&_input]:h-11 [&_input]:focus-visible:border-ring [&_input]:focus-visible:ring-[3px] [&_input]:focus-visible:ring-ring/50 [&_input]:aria-invalid:border-destructive [&_input]:aria-invalid:ring-[3px] [&_input]:aria-invalid:ring-destructive/20 dark:[&_input]:bg-input/30 dark:[&_input]:aria-invalid:ring-destructive/40'
                  placeholder='请输入密码'
                  autoComplete='current-password'
                  {...field}
                />
              </FormControl>
              <div className='min-h-5'>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />
        <Button className='h-11' disabled={isLoading}>
          {isLoading ? (
            <Loader2 className='animate-spin motion-reduce:animate-none' />
          ) : (
            <LogIn />
          )}
          登录
        </Button>
      </form>
    </Form>
  )
}

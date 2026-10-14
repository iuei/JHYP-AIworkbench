import { useState } from 'react'
import { isAxiosError } from 'axios'
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
      } catch (error) {
        if (error instanceof z.ZodError) {
          toast.error('登录响应格式异常，请联系管理员。')
        } else if (isAxiosError(error) && error.response?.status === 401) {
          /*
           * 401 的原因不止「密码错误」：密码正确但账号**待审核**或**已停用**时，
           * 服务端会给出具体原因（见 server/index.mjs 登录接口）。原样透出，
           * 否则用户只会看到"账号或密码错误"，不知道该等审核还是找管理员。
           * 服务端没带 message 时仍回退到原来的统一文案。
           */
          const message = (
            error.response.data as { message?: string } | undefined
          )?.message
          toast.error(message ?? '账号或密码错误。')
        } else if (isAxiosError(error) && !error.response) {
          toast.error('无法连接服务，请检查网络或后端服务。')
        } else {
          toast.error('登录失败，请稍后重试。')
        }
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

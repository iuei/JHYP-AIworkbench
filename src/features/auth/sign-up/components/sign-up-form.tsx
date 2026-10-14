import { useState } from 'react'
import { z } from 'zod'
import { isAxiosError } from 'axios'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { cn } from '@/lib/utils'
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
import { PasswordInput } from '@/components/password-input'

/**
 * 密码长度口径与 `server/user-management.mjs` 的 `parseUserRegister` 保持一致。
 *
 * 前端校验只为即时反馈，**真正的闸门在服务端** —— 客户端校验随时可被绕过，
 * 所以两边都要有，且数字要一致（不一致时用户会看到"前端过了、提交被拒"的困惑）。
 */
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 128

const formSchema = z
  .object({
    login: z
      .string()
      .trim()
      .min(1, '请输入账号或邮箱。')
      .max(120, '登录账号不能超过 120 个字符。'),
    name: z
      .string()
      .trim()
      .min(1, '请输入姓名。')
      .max(80, '姓名不能超过 80 个字符。'),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符。`)
      .max(MAX_PASSWORD_LENGTH, `密码不能超过 ${MAX_PASSWORD_LENGTH} 个字符。`),
    confirmPassword: z.string().min(1, '请再次输入密码。'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: '两次输入的密码不一致。',
  })

/**
 * 注册失败原因原样取服务端文案。
 *
 * 服务端 400 / 409 / 429 都返回 `{ message: '中文原因' }`（校验失败、账号已存在、提交过于频繁），
 * 前端不复述规则：文案改一处即可，避免"前端说密码太短、后端说账号非法"这种自相矛盾。
 */
function registerErrorMessage(error: unknown) {
  if (isAxiosError(error)) {
    const message = (error.response?.data as { message?: string } | undefined)
      ?.message
    if (message) return message
    if (!error.response) return '无法连接服务，请检查网络或后端服务。'
  }
  return '注册失败，请稍后重试。'
}

export function SignUpForm({
  className,
  ...props
}: React.ComponentProps<'form'>) {
  const [isLoading, setIsLoading] = useState(false)
  const navigate = useNavigate()
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { login: '', name: '', password: '', confirmPassword: '' },
  })

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true)
    try {
      /*
       * 只提交服务端需要的三个字段。
       * role / department 由服务端写死（operator / 空），前端"顺手"带上也没用 ——
       * 服务端会丢弃它们，因为注册者能自选角色就等于自助提权。
       */
      await api.post('/auth/register', {
        login: values.login,
        name: values.name,
        password: values.password,
      })
      toast.success('注册申请已提交，请等待管理员审核。')
      await navigate({ to: '/sign-in' })
    } catch (error) {
      toast.error(registerErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form
        {...props}
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-4', className)}
      >
        <FormField
          control={form.control}
          name='login'
          render={({ field }) => (
            <FormItem>
              <FormLabel>账号 / 邮箱</FormLabel>
              <FormControl>
                <Input
                  placeholder='请输入手机号或邮箱'
                  autoComplete='username'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='name'
          render={({ field }) => (
            <FormItem>
              <FormLabel>姓名</FormLabel>
              <FormControl>
                <Input
                  placeholder='请输入真实姓名'
                  autoComplete='name'
                  {...field}
                />
              </FormControl>
              <FormMessage />
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
                  placeholder={`至少 ${MIN_PASSWORD_LENGTH} 位`}
                  autoComplete='new-password'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='confirmPassword'
          render={({ field }) => (
            <FormItem>
              <FormLabel>确认密码</FormLabel>
              <FormControl>
                <PasswordInput
                  placeholder='请再次输入密码'
                  autoComplete='new-password'
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button className='mt-2' disabled={isLoading}>
          {isLoading ? (
            <Loader2 className='animate-spin motion-reduce:animate-none' />
          ) : (
            <UserPlus />
          )}
          提交注册申请
        </Button>
      </form>
    </Form>
  )
}

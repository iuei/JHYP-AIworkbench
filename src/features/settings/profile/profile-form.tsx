import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { showSubmittedData } from '@/lib/show-submitted-data'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

const profileFormSchema = z.object({
  name: z
    .string()
    .min(1, '请输入姓名。')
    .min(2, '姓名至少需要 2 个字符。')
    .max(30, '姓名不能超过 30 个字符。'),
  email: z.email({
    error: (iss) => (iss.input === '' ? '请输入邮箱。' : undefined),
  }),
  department: z.string().max(40, '部门名称不能超过 40 个字符。').optional(),
})

type ProfileFormValues = z.infer<typeof profileFormSchema>

const defaultValues: Partial<ProfileFormValues> = {
  name: '内部用户',
  email: 'user@company.local',
  department: '',
}

export function ProfileForm() {
  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues,
    mode: 'onChange',
  })

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((data) => showSubmittedData(data))}
        className='space-y-8'
      >
        <FormField
          control={form.control}
          name='name'
          render={({ field }) => (
            <FormItem>
              <FormLabel>姓名</FormLabel>
              <FormControl>
                <Input placeholder='请输入姓名' {...field} />
              </FormControl>
              <FormDescription>
                用于工作台内的用户识别和协作展示。
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='email'
          render={({ field }) => (
            <FormItem>
              <FormLabel>邮箱</FormLabel>
              <FormControl>
                <Input placeholder='name@company.com' {...field} />
              </FormControl>
              <FormDescription>
                当前仍为前端演示提交，真实修改需接入公司账户接口。
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='department'
          render={({ field }) => (
            <FormItem>
              <FormLabel>部门</FormLabel>
              <FormControl>
                <Input placeholder='请输入部门' {...field} />
              </FormControl>
              <FormDescription>
                可用于后续按组织架构展示或筛选。
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type='submit'>更新个人资料</Button>
      </form>
    </Form>
  )
}

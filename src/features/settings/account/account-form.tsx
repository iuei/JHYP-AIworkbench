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

const accountFormSchema = z.object({
  accountNo: z
    .string()
    .min(1, '请输入工号。')
    .max(30, '工号不能超过 30 个字符。'),
  role: z.string().max(30, '角色名称不能超过 30 个字符。').optional(),
})

type AccountFormValues = z.infer<typeof accountFormSchema>

const defaultValues: Partial<AccountFormValues> = {
  accountNo: 'ACC001',
  role: '普通用户',
}

export function AccountForm() {
  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues,
  })

  function onSubmit(data: AccountFormValues) {
    showSubmittedData(data)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-8'>
        <FormField
          control={form.control}
          name='accountNo'
          render={({ field }) => (
            <FormItem>
              <FormLabel>工号</FormLabel>
              <FormControl>
                <Input placeholder='请输入工号' {...field} />
              </FormControl>
              <FormDescription>
                用于关联公司内部账户和后续权限体系。
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='role'
          render={({ field }) => (
            <FormItem>
              <FormLabel>角色</FormLabel>
              <FormControl>
                <Input placeholder='请输入角色' {...field} />
              </FormControl>
              <FormDescription>
                当前角色仍为前端展示字段，真实权限以服务端配置为准。
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type='submit'>更新账户</Button>
      </form>
    </Form>
  )
}

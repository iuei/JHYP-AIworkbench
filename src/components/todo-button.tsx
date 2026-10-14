import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronRight, ListTodo } from 'lucide-react'
import { useAuthStore } from '@/stores/auth-store'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useTodos } from '@/features/ai-agent/api/queries'

/**
 * 待办按钮（全局顶栏，仅管理员）。
 *
 * **数据来自哪里**：服务端 `GET /api/ai/todos` 一次聚合五类"需要管理员动手"的事项
 * （注册申请 / 待审沉淀 / 待审提示词 / 文档即将过期 / 纠错反馈），只返回计数大于 0 的类型。
 *
 * **为什么非管理员直接不渲染**：这些都是治理面事项，员工看到既处理不了、又会把
 * "注册申请、沉淀审核"这类治理词汇带进员工面 —— 而员工面与治理面分离是本项目的
 * 既定信息架构（`src/features/dashboard/index.test.tsx` 有守护断言）。
 * 因此这里连请求都不发（`enabled: false`），而不是"请求了再隐藏"。
 */
export function TodoButton() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { auth } = useAuthStore()
  const isAdmin = auth.user?.role.includes('admin') ?? false
  const { data, isLoading, isError, refetch } = useTodos({ enabled: isAdmin })

  if (!isAdmin) return null

  const todos = data?.todos ?? []
  const total = data?.total ?? 0

  /*
   * key → 路由。刻意写成 switch 而不是查表：`to` 必须是字面量，TanStack Router
   * 才能在编译期校验"跳到一个不存在的路由"，查表会把 `to` 退化成 string 而失去保护。
   *
   * 「沉淀待审核」带上 `?queue=notes` 让页面直达对应子视图，否则点过去会停在默认的
   * 「提示词审核」；而「提示词审核」本身就是默认子视图，**不写 search** ——
   * 与项目"参数只表达非默认页"的口径一致（`DistillSearch` 也只认 notes / skill）。
   */
  const go = (key: string) => {
    switch (key) {
      case 'user_register':
        void navigate({ to: '/admin/users' })
        break
      case 'note_review':
        void navigate({ to: '/admin/ai/distill', search: { queue: 'notes' } })
        break
      case 'prompt_review':
        void navigate({ to: '/admin/ai/distill' })
        break
      case 'document_expiring':
      case 'feedback_pending':
        void navigate({ to: '/admin/ai/knowledge' })
        break
      default:
        break
    }
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        /*
         * 打开即取最新：刚处理完的事项不该还挂在列表里。
         * 处理动作散在各模块（审核沉淀 / 审核提示词 / 开通账号 / 标记反馈处理），
         * 让每一处都记得"顺手让待办失效"不现实 —— 在入口这一侧收口更可靠。
         */
        if (next) void refetch()
      }}
    >
      <PopoverTrigger asChild>
        <Button
          aria-label={total > 0 ? `待办事项，${total} 条待处理` : '待办事项'}
          className='relative'
          size='icon'
          variant='ghost'
        >
          <ListTodo className='size-5' />
          {total > 0 && (
            <Badge
              className='absolute -end-1 -top-1 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] tabular-nums'
              variant='destructive'
            >
              {total > 99 ? '99+' : total}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align='end' className='w-80 p-0'>
        <div className='border-b px-3 py-2'>
          <p className='text-sm font-medium'>待办事项</p>
          <p className='text-xs text-muted-foreground'>
            {isError
              ? '加载失败'
              : total > 0
                ? `共 ${total} 条待处理`
                : '当前没有需要处理的事项'}
          </p>
        </div>

        {isLoading && (
          <p className='px-3 py-6 text-center text-sm text-muted-foreground'>
            加载中…
          </p>
        )}

        {/*
          失败必须与"没有待办"区分开：两者在按钮上都表现为"没有徽章"，
          若不显式提示，用户只会以为待办功能没生效。真实踩到过这个歧义。
        */}
        {isError && !isLoading && (
          <div className='space-y-2 px-3 py-6 text-center'>
            <p className='text-sm text-destructive'>待办加载失败。</p>
            <Button onClick={() => void refetch()} size='sm' variant='outline'>
              重试
            </Button>
          </div>
        )}

        {!isLoading && !isError && todos.length === 0 && (
          <p className='px-3 py-6 text-center text-sm text-muted-foreground'>
            没有待处理的事项，都清空啦。
          </p>
        )}

        {todos.length > 0 && (
          <ul className='max-h-80 overflow-y-auto py-1'>
            {todos.map((todo) => (
              <li key={todo.key}>
                {/* 整行可点：待办是"点一下就去处理"，不该只让文字可点 */}
                <button
                  className='flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted'
                  type='button'
                  onClick={() => go(todo.key)}
                >
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate text-sm'>{todo.label}</span>
                    <span className='block truncate text-xs text-muted-foreground'>
                      {todo.hint}
                    </span>
                  </span>
                  <Badge className='tabular-nums' variant='secondary'>
                    {todo.count}
                  </Badge>
                  <ChevronRight
                    aria-hidden='true'
                    className='size-4 shrink-0 text-muted-foreground'
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

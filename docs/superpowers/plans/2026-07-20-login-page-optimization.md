# 登录页视觉优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将登录页实现为选定方案 1 的专业双栏界面，同时保持认证接口、路由跳转、权限和其他认证页面行为不变。

**Architecture:** `AuthLayout` 增加默认值为 `centered` 的兼容布局变体，并通过 `split` 变体承载登录页双栏结构。登录模块新增独立品牌面板，使用明暗两张装饰图片；`SignIn` 负责页面装配，`UserAuthForm` 仅负责表单校验、提交和控件样式。忘记密码与 OTP 继续使用默认布局，不修改调用代码。

**Tech Stack:** React 19、TypeScript、TanStack Router、react-hook-form、Zod、shadcn/ui、Tailwind CSS v4、lucide-react、Vitest Browser、Playwright。

## Global Constraints

- 包管理器统一使用 `pnpm`；Windows 命令使用 `pnpm.cmd`。
- 不新增依赖，不修改全局主题 token，不新增基础 UI 控件。
- 颜色只使用现有 `background`、`foreground`、`primary`、`muted`、`muted-foreground`、`border`、`input`、`ring` 语义变量。
- 登录 API、JWT、权限、路由守卫、数据库和提交字段保持不变。
- 不增加注册、社交登录、忘记密码入口或额外认证方式。
- `AuthLayout` 默认仍为 `centered`，忘记密码与 OTP 页面无需修改。
- 桌面基准为 `1440 × 1024`，表单宽度保持 `400–440px`，输入框和按钮高度约 `44px`。
- 小于 `md` 时使用单列并隐藏装饰图；页面允许自然滚动，避免移动端键盘遮挡。
- 浅色和暗色模式使用独立图片资产，不对图片强制反色。
- 所有图片都是装饰性内容，使用空 `alt` 并设置 `aria-hidden='true'`。
- 主要文字、边框、控件和焦点状态满足 WCAG AA 对比度目标。
- 禁止自动提交 Git；每个提交步骤执行前必须取得用户确认，提交说明使用中文。
- 设计说明：`docs/superpowers/specs/2026-07-17-login-page-design.md`。
- 视觉目标：`docs/superpowers/specs/assets/2026-07-17-login-page-option-1.png`。

## File Structure

- Create `src/assets/auth-workbench-light.png`：浅色品牌区背景图。
- Create `src/assets/auth-workbench-dark.png`：暗色品牌区背景图。
- Modify `src/features/auth/auth-layout.tsx`：提供 `centered` 与 `split` 两种布局。
- Create `src/features/auth/auth-layout.test.tsx`：验证默认布局兼容性和 split 插槽。
- Create `src/features/auth/sign-in/components/sign-in-brand-panel.tsx`：品牌文案、Logo 和主题图片装配。
- Modify `src/features/auth/sign-in/index.tsx`：移除登录卡片并装配选定方案。
- Create `src/features/auth/sign-in/index.test.tsx`：验证标题、说明、安全提示和重定向参数装配。
- Modify `src/features/auth/sign-in/components/user-auth-form.tsx`：整理校验、控件高度、间距和加载状态。
- Modify `src/features/auth/sign-in/components/user-auth-form.test.tsx`：稳定 mock API，并覆盖空值、短密码和成功跳转。
- Modify `docs/modules/认证模块.md`：更新责任田的影响范围、注意事项和历史变更。

---

### Task 1: 生成并验证明暗主题品牌插画

**Files:**
- Create: `src/assets/auth-workbench-light.png`
- Create: `src/assets/auth-workbench-dark.png`

**Interfaces:**
- Consumes: `docs/superpowers/specs/assets/2026-07-17-login-page-option-1.png` 作为布局与氛围参考。
- Produces: `authWorkbenchLight` 和 `authWorkbenchDark` 的静态图片导入源，供 `SignInBrandPanel` 使用。

- [ ] **Step 1: 生成浅色背景图**

使用内置 ImageGen，附加选定视觉稿，使用以下完整提示：

```text
Use case: ui-mockup
Asset type: decorative login brand-panel background
Primary request: Create only the decorative operational illustration for the left panel of the selected JHYP 智能工作台 login design. Do not draw any interface, form, logo, headline, labels, or readable text.
Target composition: 4:3 landscape, large clean negative space across the upper 45%, illustration concentrated in the lower-left and lower-center. Show a refined monochrome isometric workstation with a global commerce map, a gentle analytics trend line, a small bar chart, and four sparse line icons suggesting globe, shopping cart, package, and data.
Style: premium enterprise SaaS line illustration, white background matching oklch(1 0 0), deep-slate and cool-gray 1px lines, very low contrast, subtle dimensional surfaces, restrained and calm.
Constraints: no text, no letters, no logos, no UI form, no cards, no gradient, no neon, no watermark, no browser chrome, no people. Keep all important marks away from the outer 8% safe area.
```

将最终文件复制到：

```text
src/assets/auth-workbench-light.png
```

- [ ] **Step 2: 生成暗色背景图**

使用内置 ImageGen，附加选定视觉稿和浅色背景图，使用以下完整提示：

```text
Use case: ui-mockup
Asset type: dark-theme decorative login brand-panel background
Primary request: Create the dark-theme counterpart of the supplied light JHYP operational illustration. Preserve the exact composition, scale, negative space, and subject placement. Do not add or remove objects.
Target composition: 4:3 landscape, large clean negative space across the upper 45%, illustration concentrated in the lower-left and lower-center.
Style: premium enterprise SaaS line illustration on a deep slate background matching oklch(0.129 0.042 264.695), soft cool-gray and off-white lines at low contrast, restrained and calm.
Constraints: no text, no letters, no logos, no UI form, no cards, no gradient, no neon, no watermark, no browser chrome, no people. Keep all important marks away from the outer 8% safe area.
```

将最终文件复制到：

```text
src/assets/auth-workbench-dark.png
```

- [ ] **Step 3: 视觉检查图片资产**

分别打开两张图片，确认：

```text
浅色：白色背景、上半部留白、下半部单色运营插画、无文字。
暗色：构图与浅色一致、深色背景、无强制反色产生的脏边、无文字。
```

- [ ] **Step 4: 验证文件存在且非空**

Run:

```powershell
Get-Item `
  "src/assets/auth-workbench-light.png", `
  "src/assets/auth-workbench-dark.png" |
  Select-Object FullName, Length
```

Expected: 两个文件均存在，`Length` 均大于 `100000`。

- [ ] **Step 5: 提交检查点（需用户确认）**

```powershell
git add src/assets/auth-workbench-light.png src/assets/auth-workbench-dark.png
git commit -m "资源: 新增登录页明暗主题品牌插画"
```

Expected: 仅在用户明确确认提交后执行；当前目录不是有效 Git 工作树时跳过并记录原因。

---

### Task 2: 为 AuthLayout 增加向下兼容的 split 变体

**Files:**
- Modify: `src/features/auth/auth-layout.tsx:1-19`
- Create: `src/features/auth/auth-layout.test.tsx`

**Interfaces:**
- Consumes: 项目现有 `Logo` 组件和 `React.ReactNode`。
- Produces:
  - `type AuthLayoutVariant = 'centered' | 'split'`
  - `AuthLayout({ children, variant = 'centered', aside })`
  - `split` 变体在桌面显示 `aside`，移动端显示项目品牌锁定。

- [ ] **Step 1: 写入失败测试**

Create `src/features/auth/auth-layout.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { AuthLayout } from './auth-layout'

describe('AuthLayout', () => {
  it('keeps the centered layout as the default', async () => {
    const screen = await render(
      <AuthLayout>
        <p>默认认证内容</p>
      </AuthLayout>
    )

    await expect
      .element(screen.getByText('智能工作台'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('默认认证内容'))
      .toBeInTheDocument()
  })

  it('renders the split aside and form content', async () => {
    const screen = await render(
      <AuthLayout variant='split' aside={<p>登录品牌区域</p>}>
        <p>登录表单区域</p>
      </AuthLayout>
    )

    await expect
      .element(screen.getByText('登录品牌区域'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('登录表单区域'))
      .toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
pnpm.cmd exec vitest run --browser.headless src/features/auth/auth-layout.test.tsx
```

Expected: FAIL，TypeScript 或运行时报告 `variant` / `aside` 尚未定义。

- [ ] **Step 3: 实现最小兼容布局**

Replace `src/features/auth/auth-layout.tsx` with:

```tsx
import { Logo } from '@/assets/logo'

type AuthLayoutVariant = 'centered' | 'split'

type AuthLayoutProps = {
  children: React.ReactNode
  variant?: AuthLayoutVariant
  aside?: React.ReactNode
}

function BrandLockup({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Logo className='size-7' />
      <span className='text-lg font-semibold tracking-tight'>
        JHYP 智能工作台
      </span>
    </div>
  )
}

export function AuthLayout({
  children,
  variant = 'centered',
  aside,
}: AuthLayoutProps) {
  if (variant === 'split') {
    return (
      <div className='grid min-h-svh bg-background lg:grid-cols-[minmax(0,56fr)_minmax(26rem,44fr)]'>
        <aside className='hidden min-h-svh border-e lg:block'>{aside}</aside>
        <main className='flex min-h-svh items-center px-6 py-10 sm:px-10 lg:px-14 xl:px-20'>
          <div className='mx-auto w-full max-w-md'>
            <BrandLockup className='mb-10 lg:hidden' />
            {children}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className='container grid h-svh max-w-none items-center justify-center'>
      <div className='mx-auto flex w-full flex-col justify-center space-y-2 py-8 sm:p-8'>
        <div className='mb-4 flex items-center justify-center'>
          <Logo className='me-2' />
          <h1 className='text-xl font-medium'>智能工作台</h1>
        </div>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 运行布局测试**

Run:

```powershell
pnpm.cmd exec vitest run --browser.headless src/features/auth/auth-layout.test.tsx
```

Expected: 2 tests PASS。

- [ ] **Step 5: 验证其他认证页面兼容**

Run:

```powershell
pnpm.cmd exec vitest run --browser.headless `
  src/features/auth/forgot-password/components/forgot-password-form.test.tsx `
  src/features/auth/otp/components/otp-form.test.tsx
```

Expected: 现有忘记密码和 OTP 测试全部 PASS；两个页面无需代码修改。

- [ ] **Step 6: 提交检查点（需用户确认）**

```powershell
git add src/features/auth/auth-layout.tsx src/features/auth/auth-layout.test.tsx
git commit -m "功能: 增加认证页双栏布局变体"
```

Expected: 仅在用户明确确认提交后执行。

---

### Task 3: 实现品牌面板并装配登录页

**Files:**
- Create: `src/features/auth/sign-in/components/sign-in-brand-panel.tsx`
- Modify: `src/features/auth/sign-in/index.tsx:1-29`
- Create: `src/features/auth/sign-in/index.test.tsx`

**Interfaces:**
- Consumes:
  - `AuthLayout variant='split'`
  - `src/assets/auth-workbench-light.png`
  - `src/assets/auth-workbench-dark.png`
  - `UserAuthForm({ redirectTo?: string })`
- Produces:
  - `SignInBrandPanel()`
  - 语义主标题“欢迎回来”
  - 安全提示“内部系统 · 仅限授权用户”

- [ ] **Step 1: 写入失败测试**

Create `src/features/auth/sign-in/index.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { SignIn } from '.'

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({ redirect: '/settings' }),
}))

vi.mock('./components/user-auth-form', () => ({
  UserAuthForm: ({ redirectTo }: { redirectTo?: string }) => (
    <div data-testid='user-auth-form' data-redirect-to={redirectTo}>
      登录表单
    </div>
  ),
}))

describe('SignIn', () => {
  it('renders the selected split-login content', async () => {
    const screen = await render(<SignIn />)

    await expect
      .element(screen.getByRole('heading', { name: '欢迎回来' }))
      .toBeInTheDocument()
    await expect
      .element(
        screen.getByText('使用公司分配的账号登录智能工作台')
      )
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('内部系统 · 仅限授权用户'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByTestId('user-auth-form'))
      .toHaveAttribute('data-redirect-to', '/settings')
  })
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```powershell
pnpm.cmd exec vitest run --browser.headless src/features/auth/sign-in/index.test.tsx
```

Expected: FAIL，找不到“欢迎回来”或安全提示。

- [ ] **Step 3: 创建品牌面板**

Create `src/features/auth/sign-in/components/sign-in-brand-panel.tsx`:

```tsx
import authWorkbenchDark from '@/assets/auth-workbench-dark.png'
import authWorkbenchLight from '@/assets/auth-workbench-light.png'
import { Logo } from '@/assets/logo'

export function SignInBrandPanel() {
  return (
    <div className='relative min-h-svh overflow-hidden bg-muted/20'>
      <img
        src={authWorkbenchLight}
        alt=''
        aria-hidden='true'
        className='absolute inset-0 size-full object-cover object-center dark:hidden'
      />
      <img
        src={authWorkbenchDark}
        alt=''
        aria-hidden='true'
        className='absolute inset-0 hidden size-full object-cover object-center dark:block'
      />
      <div className='relative z-10 flex min-h-svh flex-col px-12 py-10 xl:px-20 xl:py-14'>
        <div className='flex items-center gap-2'>
          <Logo className='size-7' />
          <span className='text-lg font-semibold tracking-tight'>
            JHYP 智能工作台
          </span>
        </div>
        <div className='flex flex-1 flex-col justify-center pb-48 xl:pb-56'>
          <div className='max-w-xl space-y-4'>
            <h2 className='text-4xl font-bold tracking-tight xl:text-5xl'>
              JHYP 智能工作台
            </h2>
            <p className='text-lg text-muted-foreground xl:text-xl'>
              让跨境运营工作更高效、更清晰
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 装配登录页面**

Replace `src/features/auth/sign-in/index.tsx` with:

```tsx
import { useSearch } from '@tanstack/react-router'
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
            使用公司分配的账号登录智能工作台
          </p>
        </header>
        <UserAuthForm redirectTo={redirect} />
        <p className='flex items-center gap-2 text-sm text-muted-foreground'>
          <ShieldCheck className='size-4' aria-hidden='true' />
          内部系统 · 仅限授权用户
        </p>
      </div>
    </AuthLayout>
  )
}
```

- [ ] **Step 5: 运行登录页装配测试**

Run:

```powershell
pnpm.cmd exec vitest run --browser.headless src/features/auth/sign-in/index.test.tsx
```

Expected: 1 test PASS。

- [ ] **Step 6: 提交检查点（需用户确认）**

```powershell
git add `
  src/features/auth/sign-in/index.tsx `
  src/features/auth/sign-in/index.test.tsx `
  src/features/auth/sign-in/components/sign-in-brand-panel.tsx
git commit -m "功能: 实现登录页双栏品牌布局"
```

Expected: 仅在用户明确确认提交后执行。

---

### Task 4: 优化登录表单样式并稳定行为测试

**Files:**
- Modify: `src/features/auth/sign-in/components/user-auth-form.tsx:1-33`
- Modify: `src/features/auth/sign-in/components/user-auth-form.test.tsx:1-115`

**Interfaces:**
- Consumes: `api.post('/auth/login', { login, password })`、`useAuthStore()`、`useNavigate()`。
- Produces: 44px 控件、稳定校验文案、加载状态和原有成功跳转。

- [ ] **Step 1: 替换为可靠的失败测试**

Replace `src/features/auth/sign-in/components/user-auth-form.test.tsx` with:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, type RenderResult } from 'vitest-browser-react'
import { type Locator, userEvent } from 'vitest/browser'
import { UserAuthForm } from './user-auth-form'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  post: vi.fn(),
  setUser: vi.fn(),
  setAccessToken: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: { post: mocks.post },
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    auth: {
      setUser: mocks.setUser,
      setAccessToken: mocks.setAccessToken,
    },
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))

const user = {
  id: 1,
  email: 'admin@example.com',
  accountNo: 'admin',
  name: '管理员',
  role: ['admin'],
  exp: 1700000000000,
}

describe('UserAuthForm', () => {
  let screen: RenderResult
  let accountInput: Locator
  let passwordInput: Locator
  let loginButton: Locator

  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.post.mockResolvedValue({
      data: { token: 'mock-access-token', user },
    })
    screen = await render(<UserAuthForm />)
    accountInput = screen.getByRole('textbox', { name: '账号 / 邮箱' })
    passwordInput = screen.getByLabelText('密码')
    loginButton = screen.getByRole('button', { name: '登录' })
  })

  it('renders only the internal account controls', async () => {
    await expect.element(accountInput).toBeInTheDocument()
    await expect.element(passwordInput).toBeInTheDocument()
    await expect.element(loginButton).toBeInTheDocument()
    await expect
      .element(screen.getByText('忘记密码？'))
      .not.toBeInTheDocument()
  })

  it('shows required messages for an empty submission', async () => {
    await userEvent.click(loginButton)

    await expect
      .element(screen.getByText('请输入账号或邮箱。'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('请输入密码。'))
      .toBeInTheDocument()
  })

  it('shows the minimum length message for a short password', async () => {
    await userEvent.fill(accountInput, 'admin')
    await userEvent.fill(passwordInput, '12345')
    await userEvent.click(loginButton)

    await expect
      .element(screen.getByText('密码至少需要 6 个字符。'))
      .toBeInTheDocument()
  })

  it('authenticates and navigates to the default route', async () => {
    await userEvent.fill(accountInput, 'admin')
    await userEvent.fill(passwordInput, '123456')
    await userEvent.click(loginButton)

    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledOnce())
    expect(mocks.post).toHaveBeenCalledWith('/auth/login', {
      login: 'admin',
      password: '123456',
    })
    expect(mocks.setUser).toHaveBeenCalledWith(user)
    expect(mocks.setAccessToken).toHaveBeenCalledWith('mock-access-token')
    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/',
        replace: true,
      })
    )
  })

  it('navigates to redirectTo when provided', async () => {
    const redirected = await render(<UserAuthForm redirectTo='/settings' />)
    await userEvent.fill(
      redirected.getByRole('textbox', { name: '账号 / 邮箱' }),
      'admin'
    )
    await userEvent.fill(redirected.getByLabelText('密码'), '123456')
    await userEvent.click(redirected.getByRole('button', { name: '登录' }))

    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/settings',
        replace: true,
      })
    )
  })
})
```

- [ ] **Step 2: 运行测试并确认校验失败**

Run:

```powershell
pnpm.cmd exec vitest run --browser.headless `
  src/features/auth/sign-in/components/user-auth-form.test.tsx
```

Expected: 至少“空密码显示请输入密码”用例 FAIL；现有 schema 对空密码只返回长度错误。

- [ ] **Step 3: 实现表单校验和视觉样式**

Replace `src/features/auth/sign-in/components/user-auth-form.tsx` with:

```tsx
import { useState } from 'react'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, LogIn } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth-store'
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

interface UserAuthFormProps extends React.HTMLAttributes<HTMLFormElement> {
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
      const { data } = await api.post('/auth/login', values)
      auth.setUser(data.user)
      auth.setAccessToken(data.token)
      await navigate({ to: redirectTo || '/', replace: true })
      toast.success('登录成功')
    } catch {
      toast.error('账号或密码错误，或后端服务未启动。')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className={cn('grid gap-5', className)}
        {...props}
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
                  className='[&_input]:h-11 [&_input]:focus-visible:border-ring [&_input]:focus-visible:ring-[3px] [&_input]:focus-visible:ring-ring/50 aria-invalid:[&_input]:border-destructive aria-invalid:[&_input]:ring-[3px] aria-invalid:[&_input]:ring-destructive/20 dark:[&_input]:bg-input/30 dark:aria-invalid:[&_input]:ring-destructive/40'
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
```

- [ ] **Step 4: 运行表单和密码控件测试**

Run:

```powershell
pnpm.cmd exec vitest run --browser.headless `
  src/features/auth/sign-in/components/user-auth-form.test.tsx `
  src/components/password-input.test.tsx
```

Expected: 所有测试 PASS，密码显示按钮仍可切换且禁用状态正确。

- [ ] **Step 5: 提交检查点（需用户确认）**

```powershell
git add `
  src/features/auth/sign-in/components/user-auth-form.tsx `
  src/features/auth/sign-in/components/user-auth-form.test.tsx
git commit -m "优化: 完善登录表单层级与校验状态"
```

Expected: 仅在用户明确确认提交后执行。

---

### Task 5: 更新责任田并完成分层验收

**Files:**
- Modify: `docs/modules/认证模块.md`
- Verify: `docs/superpowers/specs/2026-07-17-login-page-design.md`
- Verify: `docs/superpowers/specs/assets/2026-07-17-login-page-option-1.png`

**Interfaces:**
- Consumes: Tasks 1–4 的最终页面和测试。
- Produces: 责任田记录、自动化验证结果、桌面/响应式/暗色/真实登录视觉证据。

- [ ] **Step 1: 更新认证责任田**

在 `docs/modules/认证模块.md` 的对应章节加入以下准确内容：

```markdown
## 影响范围

登录页使用 `AuthLayout` 的 `split` 变体；忘记密码和 OTP 页面继续使用默认 `centered` 变体。登录页视觉调整不改变 API、JWT、权限、路由守卫或数据库。

## 注意事项

- 登录页品牌区装饰图分别提供浅色与暗色资产。
- 小于 `md` 时隐藏桌面品牌区，只保留移动端品牌锁定和登录表单。
- 内部系统不开放注册、社交登录或忘记密码入口。

## 历史变更

| 日期 | 变更内容 | 修改人 / AI |
| --- | --- | --- |
| 2026-07-20 | 登录页升级为兼容明暗主题和响应式规则的双栏品牌布局，认证逻辑保持不变。 | AI |
```

保留文件中现有其他内容和历史记录，不重复创建同名章节；将新增条目合并到现有章节。

- [ ] **Step 2: 运行认证相关测试**

Run:

```powershell
pnpm.cmd exec vitest run --browser.headless `
  src/features/auth/auth-layout.test.tsx `
  src/features/auth/sign-in/index.test.tsx `
  src/features/auth/sign-in/components/user-auth-form.test.tsx `
  src/features/auth/forgot-password/components/forgot-password-form.test.tsx `
  src/features/auth/otp/components/otp-form.test.tsx `
  src/components/password-input.test.tsx
```

Expected: 所有认证相关测试 PASS。

- [ ] **Step 3: 运行全量质量检查**

Run:

```powershell
pnpm.cmd run test
pnpm.cmd run lint
pnpm.cmd run build
```

Expected:

```text
test: 全部测试通过。
lint: ESLint exit code 0。
build: TypeScript 与 Vite 构建成功。
```

- [ ] **Step 4: 桌面浅色视觉验收**

启动 `pnpm.cmd run dev:all`，使用内置浏览器打开：

```text
http://localhost:5173/sign-in
```

设置视口 `1440 × 1024`，保存截图到：

```text
C:/Users/lingke_sz/.codex/visualizations/2026/07/17/019f6f38-9152-79b2-bfa6-fdd5b3364e73/login-implemented-light-1440x1024.png
```

在同一次视觉比较中同时传入：

```text
参考：docs/superpowers/specs/assets/2026-07-17-login-page-option-1.png
实现：login-implemented-light-1440x1024.png
```

检查顺序：

```text
1. 双栏比例约 56/44，右侧表单宽度 400–440px。
2. Logo、主标题、辅助文案和表单层级与参考图一致。
3. 页面无悬浮大卡片、无卡片嵌套、无文本裁切。
4. 装饰图不压住文字，垂直分隔线清晰但不过重。
5. 控件高度、圆角、边框和焦点环与项目核心页面一致。
6. 主要文字、边框和控件状态满足 WCAG AA 对比度目标。
```

发现差异时只调整直接相关的布局和样式，重新截图并再次比较。

- [ ] **Step 5: 响应式视觉验收**

依次设置视口并截图：

```text
1024 × 768：login-implemented-light-1024x768.png
768 × 1024：login-implemented-light-768x1024.png
390 × 844：login-implemented-light-390x844.png
```

Expected:

```text
1024：双栏仍可用，表单不窄于 400px。
768：单列布局，桌面品牌面板隐藏。
390：无横向滚动，Logo 与表单完整可见，页面可纵向滚动。
```

- [ ] **Step 6: 暗色主题视觉验收**

在 `1440 × 1024` 和 `390 × 844` 下切换暗色主题并截图：

```text
login-implemented-dark-1440x1024.png
login-implemented-dark-390x844.png
```

Expected:

```text
暗色品牌图被正确使用，无白底闪现。
边框、占位文本、说明文字、按钮和焦点环清晰。
页面与仪表盘、设置页的暗色语义变量一致。
```

- [ ] **Step 7: 功能与可访问性验收**

按以下顺序验证：

```text
1. 不输入内容直接提交：显示账号和密码必填信息。
2. 输入 5 位密码：显示“密码至少需要 6 个字符。”。
3. 使用错误账号：显示统一错误提示，不泄露账号是否存在。
4. 从 .env 读取 INITIAL_ADMIN_LOGIN / INITIAL_ADMIN_PASSWORD，在本地登录页完成真实登录。
5. 登录成功后进入原目标路由或首页。
6. 仅用 Tab / Shift+Tab / Enter 完成账号、密码、显示密码和登录操作。
7. 检查浏览器控制台无 React、请求或资源错误。
```

- [ ] **Step 8: 影响检查**

手动打开：

```text
http://localhost:5173/forgot-password
http://localhost:5173/otp
```

Expected: 两个页面保持原居中卡片布局，无双栏品牌面板，无内容溢出。

- [ ] **Step 9: 提交最终检查点（需用户确认）**

```powershell
git add `
  src/assets/auth-workbench-light.png `
  src/assets/auth-workbench-dark.png `
  src/features/auth/auth-layout.tsx `
  src/features/auth/auth-layout.test.tsx `
  src/features/auth/sign-in `
  docs/modules/认证模块.md
git commit -m "功能: 优化智能工作台登录界面"
```

Expected: 仅在用户明确确认提交且 Git 工作树有效时执行；禁止自动 push。

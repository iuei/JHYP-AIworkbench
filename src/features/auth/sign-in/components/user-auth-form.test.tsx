import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { type Locator, userEvent } from 'vitest/browser'
import { UserAuthForm } from './user-auth-form'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  post: vi.fn(),
  setUser: vi.fn(),
  setAccessToken: vi.fn(),
  reset: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: { post: mocks.post },
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: () => ({
    auth: {
      setUser: mocks.setUser,
      setAccessToken: mocks.setAccessToken,
      reset: mocks.reset,
    },
  }),
}))

vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sonner')>()

  return {
    ...actual,
    toast: {
      ...actual.toast,
      success: mocks.toastSuccess,
      error: mocks.toastError,
    },
  }
})

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()

  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  }
})

const user = {
  id: 1,
  email: 'admin@example.com',
  accountNo: 'admin',
  name: '管理员',
  role: ['admin'],
  exp: 1700000000000,
}

const loginResponse = {
  data: { token: 'mock-access-token', user },
}

async function renderForm(redirectTo?: string) {
  const screen = await render(<UserAuthForm redirectTo={redirectTo} />)

  return {
    screen,
    accountInput: screen.getByRole('textbox', { name: '账号 / 邮箱' }),
    passwordInput: screen.getByLabelText('密码'),
    loginButton: screen.getByRole('button', { name: '登录' }),
  }
}

async function submitCredentials(
  accountInput: Locator,
  passwordInput: Locator,
  loginButton: Locator
) {
  await userEvent.fill(accountInput, 'admin')
  await userEvent.fill(passwordInput, '123456')
  await userEvent.click(loginButton)
}

async function expectPasswordErrorState(
  accountInput: Locator,
  passwordInput: Locator
) {
  await expect.element(passwordInput).toHaveAttribute('aria-invalid', 'true')

  const input = passwordInput.element()
  const wrapper = input.parentElement
  expect(wrapper).not.toBeNull()
  expect(wrapper?.classList).toContain(
    '[&_input]:aria-invalid:border-destructive'
  )
  expect(wrapper?.classList).toContain('[&_input]:aria-invalid:ring-[3px]')
  expect(wrapper?.classList).toContain(
    '[&_input]:aria-invalid:ring-destructive/20'
  )
  expect(wrapper?.classList).toContain(
    'dark:[&_input]:aria-invalid:ring-destructive/40'
  )

  expect(getComputedStyle(input).borderColor).toBe(
    getComputedStyle(accountInput.element()).borderColor
  )
}

describe('UserAuthForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.post.mockResolvedValue(loginResponse)
    mocks.navigate.mockResolvedValue(undefined)
  })

  it('renders only the internal account controls', async () => {
    const { screen, accountInput, passwordInput, loginButton } =
      await renderForm()

    await expect.element(accountInput).toBeInTheDocument()
    await expect.element(passwordInput).toBeInTheDocument()
    await expect.element(loginButton).toBeInTheDocument()
    await expect
      .element(screen.getByText('忘记密码？'))
      .not.toBeInTheDocument()
  })

  it('shows required messages for an empty submission', async () => {
    const { screen, accountInput, passwordInput, loginButton } =
      await renderForm()

    await userEvent.click(loginButton)

    await expect
      .element(screen.getByText('请输入账号或邮箱。'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('请输入密码。'))
      .toBeInTheDocument()
    await expectPasswordErrorState(accountInput, passwordInput)
  })

  it('shows the minimum length message for a short password', async () => {
    const { screen, accountInput, passwordInput, loginButton } =
      await renderForm()

    await userEvent.fill(accountInput, 'admin')
    await userEvent.fill(passwordInput, '12345')
    await userEvent.click(loginButton)

    await expect
      .element(screen.getByText('密码至少需要 6 个字符。'))
      .toBeInTheDocument()
    await expect.element(passwordInput).toHaveAttribute('aria-invalid', 'true')
  })

  it('authenticates and navigates to the default route', async () => {
    const { accountInput, passwordInput, loginButton } = await renderForm()

    await submitCredentials(accountInput, passwordInput, loginButton)

    await vi.waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith('/auth/login', {
        login: 'admin',
        password: '123456',
      })
      expect(mocks.setUser).toHaveBeenCalledWith(user)
      expect(mocks.setAccessToken).toHaveBeenCalledWith('mock-access-token')
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/',
        replace: true,
      })
      expect(mocks.toastSuccess).toHaveBeenCalledWith('登录成功')
    })
    expect(mocks.reset).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('navigates to redirectTo when provided', async () => {
    const { accountInput, passwordInput, loginButton } =
      await renderForm('/settings')

    await submitCredentials(accountInput, passwordInput, loginButton)

    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/settings',
        replace: true,
      })
    )
  })

  it('does not allow spread props to replace the internal submit handler', async () => {
    const externalSubmit = vi.fn(
      (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
      }
    )
    const externalProps = {
      id: 'external-submit-regression',
      onSubmit: externalSubmit,
    }
    const screen = await render(<UserAuthForm {...externalProps} />)
    const accountInput = screen.getByRole('textbox', {
      name: '账号 / 邮箱',
    })
    const passwordInput = screen.getByLabelText('密码')
    const loginButton = screen.getByRole('button', { name: '登录' })

    await submitCredentials(accountInput, passwordInput, loginButton)

    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledOnce())
    expect(externalSubmit).not.toHaveBeenCalled()
  })

  it('handles an API rejection without changing the session', async () => {
    mocks.post.mockRejectedValueOnce(new Error('network unavailable'))
    const { accountInput, passwordInput, loginButton } = await renderForm()

    await submitCredentials(accountInput, passwordInput, loginButton)

    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        '登录失败，请稍后重试。'
      )
    )
    expect(mocks.setUser).not.toHaveBeenCalled()
    expect(mocks.setAccessToken).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.reset).not.toHaveBeenCalled()
    await expect.element(loginButton).toBeEnabled()
  })

  it('distinguishes invalid credentials from a connection failure', async () => {
    const unauthorized = Object.assign(new Error('Unauthorized'), {
      isAxiosError: true,
      response: { status: 401 },
    })
    const disconnected = Object.assign(new Error('Network Error'), {
      isAxiosError: true,
    })

    mocks.post.mockRejectedValueOnce(unauthorized)
    const first = await renderForm()
    await submitCredentials(first.accountInput, first.passwordInput, first.loginButton)
    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('账号或密码错误。')
    )

    mocks.post.mockRejectedValueOnce(disconnected)
    await submitCredentials(first.accountInput, first.passwordInput, first.loginButton)
    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        '无法连接服务，请检查网络或后端服务。'
      )
    )
    expect(mocks.setUser).not.toHaveBeenCalled()
  })

  it('disables repeated submissions while authentication is pending', async () => {
    let resolvePost!: (response: typeof loginResponse) => void
    mocks.post.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve
        })
    )
    const { accountInput, passwordInput, loginButton } = await renderForm()

    await submitCredentials(accountInput, passwordInput, loginButton)

    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledOnce())
    await expect.element(loginButton).toBeDisabled()
    const button = loginButton.element()
    if (!(button instanceof HTMLButtonElement)) {
      throw new TypeError('登录控件必须是 button 元素')
    }
    button.click()
    expect(mocks.post).toHaveBeenCalledOnce()

    resolvePost(loginResponse)

    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({
        to: '/',
        replace: true,
      })
    )
    await expect.element(loginButton).toBeEnabled()
  })

  it('rejects a malformed response without changing the session', async () => {
    mocks.post.mockResolvedValueOnce({
      data: {
        token: '',
        user: { accountNo: 'admin', email: 'admin@example.com' },
      },
    })
    const { accountInput, passwordInput, loginButton } = await renderForm()

    await submitCredentials(accountInput, passwordInput, loginButton)

    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        '登录响应格式异常，请联系管理员。'
      )
    )
    expect(mocks.setUser).not.toHaveBeenCalled()
    expect(mocks.setAccessToken).not.toHaveBeenCalled()
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.reset).not.toHaveBeenCalled()
    await expect.element(loginButton).toBeEnabled()
  })

  it('rolls back the session when navigation fails', async () => {
    mocks.navigate.mockRejectedValueOnce(new Error('navigation failed'))
    const { accountInput, passwordInput, loginButton } = await renderForm()

    await submitCredentials(accountInput, passwordInput, loginButton)

    await vi.waitFor(() => {
      expect(mocks.setUser).toHaveBeenCalledWith(user)
      expect(mocks.setAccessToken).toHaveBeenCalledWith('mock-access-token')
      expect(mocks.reset).toHaveBeenCalledOnce()
      expect(mocks.toastError).toHaveBeenCalledWith(
        '登录状态初始化失败，请重试。'
      )
    })
    expect(mocks.toastError).not.toHaveBeenCalledWith(
      '账号或密码错误。'
    )
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    await expect.element(loginButton).toBeEnabled()
  })
})

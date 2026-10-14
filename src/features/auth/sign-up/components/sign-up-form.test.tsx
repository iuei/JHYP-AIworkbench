import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { type Locator, userEvent } from 'vitest/browser'
import { SignUpForm } from './sign-up-form'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  post: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  api: { post: mocks.post },
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
  const actual =
    await importOriginal<typeof import('@tanstack/react-router')>()

  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.post.mockResolvedValue({ data: { message: '注册申请已提交' } })
})

async function renderForm() {
  const screen = await render(<SignUpForm />)

  return {
    screen,
    loginInput: screen.getByRole('textbox', { name: '账号 / 邮箱' }),
    nameInput: screen.getByRole('textbox', { name: '姓名' }),
    /*
     * 必须 exact：本表单同时有「密码」与「确认密码」两个字段，
     * 而 getByLabelText 默认是子串匹配，'密码' 会同时命中这两个输入框（strict mode violation）。
     */
    passwordInput: screen.getByLabelText('密码', { exact: true }),
    confirmInput: screen.getByLabelText('确认密码', { exact: true }),
    submitButton: screen.getByRole('button', { name: '提交注册申请' }),
  }
}

async function fillValid(
  loginInput: Locator,
  nameInput: Locator,
  passwordInput: Locator,
  confirmInput: Locator
) {
  await userEvent.fill(loginInput, '13800000000')
  await userEvent.fill(nameInput, '李四')
  await userEvent.fill(passwordInput, 'secret123')
  await userEvent.fill(confirmInput, 'secret123')
}

describe('SignUpForm', () => {
  it('submits exactly the three fields the server accepts', async () => {
    const { loginInput, nameInput, passwordInput, confirmInput, submitButton } =
      await renderForm()

    await fillValid(loginInput, nameInput, passwordInput, confirmInput)
    await userEvent.click(submitButton)

    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledOnce())
    /*
     * 只允许带这三个字段：role / department 由服务端写死。
     * 前端一旦"顺手"把 role 带上，注册者就能自选管理员 —— 这条断言是那个风险的守门人。
     */
    expect(mocks.post).toHaveBeenCalledWith('/auth/register', {
      login: '13800000000',
      name: '李四',
      password: 'secret123',
    })
    await vi.waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        '注册申请已提交，请等待管理员审核。'
      )
    )
    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/sign-in' })
    )
  })

  it('requires account, name, password and confirmation', async () => {
    const { screen, submitButton } = await renderForm()

    await userEvent.click(submitButton)

    await expect
      .element(screen.getByText('请输入账号或邮箱。'))
      .toBeInTheDocument()
    await expect.element(screen.getByText('请输入姓名。')).toBeInTheDocument()
    await expect
      .element(screen.getByText('密码至少需要 8 个字符。'))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('请再次输入密码。'))
      .toBeInTheDocument()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('rejects a password shorter than 8 characters', async () => {
    const { screen, loginInput, nameInput, passwordInput, confirmInput, submitButton } =
      await renderForm()

    await userEvent.fill(loginInput, '13800000000')
    await userEvent.fill(nameInput, '李四')
    await userEvent.fill(passwordInput, '1234567')
    await userEvent.fill(confirmInput, '1234567')
    await userEvent.click(submitButton)

    await expect
      .element(screen.getByText('密码至少需要 8 个字符。'))
      .toBeInTheDocument()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('rejects mismatched passwords', async () => {
    const { screen, loginInput, nameInput, passwordInput, confirmInput, submitButton } =
      await renderForm()

    await userEvent.fill(loginInput, '13800000000')
    await userEvent.fill(nameInput, '李四')
    await userEvent.fill(passwordInput, 'secret123')
    await userEvent.fill(confirmInput, 'secret124')
    await userEvent.click(submitButton)

    await expect
      .element(screen.getByText('两次输入的密码不一致。'))
      .toBeInTheDocument()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('surfaces the server message when the account already exists', async () => {
    mocks.post.mockRejectedValueOnce(
      Object.assign(new Error('Conflict'), {
        isAxiosError: true,
        response: { status: 409, data: { message: '该账号已存在。' } },
      })
    )
    const { loginInput, nameInput, passwordInput, confirmInput, submitButton } =
      await renderForm()

    await fillValid(loginInput, nameInput, passwordInput, confirmInput)
    await userEvent.click(submitButton)

    // 文案来自服务端，前端不复述规则（改一处即可，不会出现两套说法）
    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith('该账号已存在。')
    )
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('falls back to a generic message for a connection failure', async () => {
    mocks.post.mockRejectedValueOnce(
      Object.assign(new Error('Network Error'), { isAxiosError: true })
    )
    const { loginInput, nameInput, passwordInput, confirmInput, submitButton } =
      await renderForm()

    await fillValid(loginInput, nameInput, passwordInput, confirmInput)
    await userEvent.click(submitButton)

    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        '无法连接服务，请检查网络或后端服务。'
      )
    )
  })
})

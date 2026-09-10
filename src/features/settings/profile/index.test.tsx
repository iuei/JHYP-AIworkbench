import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { SettingsProfile } from '.'

vi.mock('@/components/sign-out-dialog', () => ({
  SignOutDialog: ({ open }: { open: boolean }) =>
    open ? <div role='dialog'>确认退出登录</div> : null,
}))

describe('SettingsProfile', () => {
  it('combines profile, account, and sign-out actions on one page', async () => {
    const { getByRole } = await render(<SettingsProfile />)

    await expect
      .element(getByRole('heading', { name: '个人资料' }))
      .toBeVisible()
    await expect
      .element(getByRole('heading', { name: '账户信息' }))
      .toBeVisible()
    await expect.element(getByRole('button', { name: '退出登录' })).toBeVisible()

    await userEvent.click(getByRole('button', { name: '退出登录' }))
    await expect.element(getByRole('dialog')).toHaveTextContent('确认退出登录')
  })
})

import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import '@/styles/index.css'
import { AuthLayout } from './auth-layout'

function getAuthContentWidth(screen: Awaited<ReturnType<typeof render>>) {
  const content = screen.getByText('登录表单区域').element().parentElement

  expect(content).not.toBeNull()
  return content!.getBoundingClientRect().width
}

describe('AuthLayout', () => {
  it('keeps the centered layout as the default', async () => {
    const screen = await render(
      <AuthLayout>
        <p>默认认证内容</p>
      </AuthLayout>
    )

    await expect
      .element(screen.getByRole('heading', { name: 'JHYP 智能工作台' }))
      .toBeInTheDocument()
    await expect
      .element(screen.getByText('默认认证内容'))
      .toBeInTheDocument()
  })

  it('shows the split aside on desktop', async () => {
    await page.viewport(1440, 900)

    const screen = await render(
      <AuthLayout variant='split' aside={<p>登录品牌区域</p>}>
        <p>登录表单区域</p>
      </AuthLayout>
    )

    await expect
      .element(screen.getByText('登录品牌区域'))
      .toBeVisible()
    await expect
      .element(screen.getByTestId('auth-brand-name'))
      .not.toBeVisible()

    const contentWidth = getAuthContentWidth(screen)
    expect(contentWidth).toBeGreaterThanOrEqual(400)
    expect(contentWidth).toBeLessThanOrEqual(440)
  })

  it('keeps the split form at least 400px wide at the lg breakpoint', async () => {
    await page.viewport(1024, 768)

    const screen = await render(
      <AuthLayout variant='split' aside={<p>登录品牌区域</p>}>
        <p>登录表单区域</p>
      </AuthLayout>
    )

    expect(getAuthContentWidth(screen)).toBeGreaterThanOrEqual(400)
  })

  it('hides the split aside and shows the brand lockup on mobile', async () => {
    await page.viewport(390, 844)

    const screen = await render(
      <AuthLayout variant='split' aside={<p>登录品牌区域</p>}>
        <p>登录表单区域</p>
      </AuthLayout>
    )

    await expect
      .element(screen.getByText('登录品牌区域'))
      .not.toBeVisible()
    await expect
      .element(screen.getByTestId('auth-brand-name'))
      .toBeVisible()
    await expect
      .element(screen.getByText('登录表单区域'))
      .toBeInTheDocument()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth
    )
  })
})

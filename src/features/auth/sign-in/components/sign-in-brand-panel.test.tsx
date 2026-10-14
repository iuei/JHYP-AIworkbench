import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'
import { ThemeProvider, type Theme } from '@/context/theme-provider'
import { SignInBrandPanel } from './sign-in-brand-panel'

async function renderBrandPanel(theme: Theme) {
  const screen = await render(
    <ThemeProvider
      defaultTheme={theme}
      storageKey={`sign-in-brand-panel-${theme}`}
    >
      <SignInBrandPanel />
    </ThemeProvider>
  )
  const heading = screen.getByRole('heading', {
    name: 'JHYP 智能工作台',
  })
  const panel = heading.element().closest('.relative')?.parentElement

  expect(panel).not.toBeNull()
  return panel!
}

describe('SignInBrandPanel', () => {
  it('mounts only the light asset on a light desktop', async () => {
    await page.viewport(1440, 900)

    const panel = await renderBrandPanel('light')
    const images = panel.querySelectorAll('img')

    expect(images).toHaveLength(1)
    expect(images[0].getAttribute('src')).toContain('auth-workbench-light.png')
  })

  it('mounts only the dark asset on a dark desktop', async () => {
    await page.viewport(1440, 900)

    const panel = await renderBrandPanel('dark')
    const images = panel.querySelectorAll('img')

    expect(images).toHaveLength(1)
    expect(images[0].getAttribute('src')).toContain('auth-workbench-dark.png')
  })

  it('does not mount a brand image below the desktop breakpoint', async () => {
    await page.viewport(390, 844)

    const panel = await renderBrandPanel('light')

    expect(panel.querySelector('img')).toBeNull()
  })
})

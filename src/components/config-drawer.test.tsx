import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { ConfigDrawer } from './config-drawer'

describe('ConfigDrawer', () => {
  it('does not render the removed theme settings entry', async () => {
    await render(<ConfigDrawer />)

    expect(document.body.textContent).not.toContain('主题设置')
  })
})

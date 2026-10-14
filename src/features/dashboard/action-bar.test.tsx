import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { ActionBar } from './action-bar'

/** 真实 Link 用 `search` 生成查询串，测试里必须等效拼出来，否则断言不出深链参数。 */
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    ...props
  }: React.PropsWithChildren<{
    to: string
    search?: Record<string, unknown>
  }>) => {
    const query = search
      ? `?${new URLSearchParams(
          Object.entries(search).map(([key, value]) => [key, String(value)])
        ).toString()}`
      : ''
    return (
      <a href={`${to}${query}`} {...props}>
        {children}
      </a>
    )
  },
}))

function hrefs() {
  return Array.from(document.querySelectorAll('a')).map((a) =>
    a.getAttribute('href')
  )
}

describe('ActionBar', () => {
  it('有历史记录时提供「继续上次分析」，并指向那条记录', async () => {
    await render(<ActionBar lastAnalysisId={7} />)

    expect(hrefs()).toContain('/competitor-analysis?analysisId=7')
  })

  it('没有历史记录时不渲染「继续上次分析」', async () => {
    await render(<ActionBar lastAnalysisId={null} />)

    expect(document.body.textContent).not.toContain('继续上次分析')
    expect(hrefs().some((href) => href?.includes('analysisId'))).toBe(false)
  })

  it('「新建分析」聚焦 ASIN 输入框、「问 AI」聚焦输入框', async () => {
    await render(<ActionBar lastAnalysisId={null} />)

    expect(hrefs()).toContain('/competitor-analysis?focus=asin')
    expect(hrefs()).toContain('/ai-agent?focus=composer')
  })
})

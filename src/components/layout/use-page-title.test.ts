import { describe, expect, it } from 'vitest'
import { pickPageTitle } from './use-page-title'

const m = (title?: string) => ({ staticData: title ? { title } : {} })

describe('pickPageTitle', () => {
  it('取最深一层声明的标题', () => {
    expect(
      pickPageTitle([m(), m('设置'), m(), m('用户管理')])
    ).toBe('用户管理')
  })

  it('子页没声明时继承模块级标题', () => {
    // /admin/ai/datasources：只有 /admin/ai 声明了「AI 治理」，子页由导航高亮表达位置
    expect(pickPageTitle([m(), m(), m('AI 治理'), m(), m()])).toBe('AI 治理')
    // /ai-agent/notes：同理继承「AI 助手」
    expect(pickPageTitle([m(), m(), m('AI 助手'), m()])).toBe('AI 助手')
  })

  it('忽略只有路径没有标题的中间层', () => {
    expect(pickPageTitle([m('仪表盘')])).toBe('仪表盘')
    expect(pickPageTitle([m(), m(), m()])).toBeUndefined()
  })

  it('空链或空标题时返回 undefined，交给 Header 退化渲染', () => {
    expect(pickPageTitle([])).toBeUndefined()
    expect(pickPageTitle([m('')])).toBeUndefined()
    expect(pickPageTitle([{ staticData: undefined }])).toBeUndefined()
    expect(pickPageTitle([{}])).toBeUndefined()
  })

  it('不同页面互不串味：兄弟路由各自取自己的标题', () => {
    const root = m()
    const settings = m()
    expect(pickPageTitle([root, settings, m('用户信息')])).toBe('用户信息')
    expect(pickPageTitle([root, settings, m('外观')])).toBe('外观')
  })
})

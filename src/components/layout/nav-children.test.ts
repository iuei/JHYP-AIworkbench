import { describe, expect, it } from 'vitest'
import { adminAiNavItems, sidebarData } from './data/sidebar-data'
import { findNavChildren } from './nav-children'
import { isNavUrlActive } from './nav-match'
import type { NavItem } from './types'

const items: NavItem[] = [
  {
    title: 'AI 助手',
    items: [
      { title: '对话', url: '/ai-agent' },
      { title: '我的沉淀', url: '/ai-agent/notes' },
    ],
  },
  // 叶子类目举例用一个固定入口页（不要拿"竞品分析"举例：它 2026-09-16 起已是折叠类目）
  { title: '仪表盘', url: '/' },
]

describe('findNavChildren', () => {
  it('取出折叠类目的二级子项（标题与 url 原样）', () => {
    expect(findNavChildren(items, 'AI 助手')).toEqual([
      { title: '对话', url: '/ai-agent' },
      { title: '我的沉淀', url: '/ai-agent/notes' },
    ])
  })

  it('叶子类目没有子页，返回空数组', () => {
    expect(findNavChildren(items, '仪表盘')).toEqual([])
  })

  it('类目名不存在时返回空数组（不抛错）', () => {
    expect(findNavChildren(items, '不存在的类目')).toEqual([])
  })

  /*
    2026-09-18：「AI 助手」由折叠类目（对话 / 我的沉淀）改成单页类目 ——
    沉淀迁进「知识库 → 个人知识库」，只剩一个子项的折叠类目在侧边栏只多一层无意义的展开。
    顶栏导航因此不再有可派生的子项（`agent-nav.tsx` 拿到空数组后不渲染）。
  */
  it('真实侧边栏数据里「AI 助手」已是单页类目：没有子项', () => {
    expect(findNavChildren(sidebarData.navItems, 'AI 助手')).toEqual([])
    expect(
      sidebarData.navItems.some(
        (item) => item.title === 'AI 助手' && item.url === '/ai-agent'
      )
    ).toBe(true)
  })

  /*
    2026-09-16 阶段 C 的归类结论也要有护栏：
    「我的 ASIN」不再挂在 AI 助手下（它是独立业务模块，已升一级类目），
    且「提示词广场」的路径要与它的一级类目身份对齐。
  */
  it('「我的 ASIN」已升为一级类目，不再出现在「AI 助手」子项里', () => {
    const childUrls = findNavChildren(sidebarData.navItems, 'AI 助手').map(
      (i) => i.url
    )
    expect(childUrls).not.toContain('/ai-agent/asin-watchlists')
    expect(
      sidebarData.navItems.some(
        (item) => item.title === '我的 ASIN' && item.url === '/asin-watchlists'
      )
    ).toBe(true)
  })

  it('一级类目「提示词广场」的路径与导航层级对齐（/prompts）', () => {
    expect(
      sidebarData.navItems.some(
        (item) => item.title === '提示词广场' && item.url === '/prompts'
      )
    ).toBe(true)
  })

  /*
    2026-09-16：用户反馈「没有直接的子页面入口」—— 数据明细此前只做了"结果卡上的一个按钮"，
    侧边栏与命令菜单都到不了。它现在是导航里的真实子项，这条断言守住这个形态。
  */
  it('「竞品分析」是折叠类目，「分析」与「分析结果」各有真实路径', () => {
    expect(
      findNavChildren(sidebarData.navItems, '竞品分析').map((i) => i.url)
    ).toEqual(['/competitor-analysis', '/competitor-analysis/results'])
  })

  it('「产品开发」是折叠类目，三个子页各有真实路径', () => {
    expect(
      findNavChildren(sidebarData.navItems, '产品开发').map((i) => i.url)
    ).toEqual(['/product-dev', '/product-dev/compare', '/product-dev/market'])
  })

  /*
    2026-09-18：侧边栏上「系统管理」曾连出两次（分组标签 + 同名折叠类目），
    用户口径「现在不需要这个一级类目为系统管理了」。现在分组名只作归类，
    三个治理入口各自平铺为一级项 —— 这条断言守住"不再有同名折叠类目"。
  */
  it('治理入口是「系统管理」分组下平铺的一级项，不再套同名折叠类目', () => {
    const managed = sidebarData.navItems.filter(
      (item) => item.section === '系统管理'
    )
    expect(managed.map((item) => item.title)).toEqual([
      'AI 治理',
      '用户管理',
      '公告管理',
    ])
    expect(managed.every((item) => item.items === undefined && item.url)).toBe(
      true
    )
    expect(findNavChildren(sidebarData.navItems, '系统管理')).toEqual([])
  })

  /*
    2026-09-18：知识库治理并入「AI 工作台 → 知识库 → 团队知识库」（管理员视图），
    「AI 治理」顶栏不再列它 —— 这条断言守住"治理面不重复出现知识库入口"，
    也守住 `/admin/ai` 的落点仍是治理区内的第一项。
  */
  it('「AI 治理」顶栏四项不含知识库，落点是数据源与导入', () => {
    expect(adminAiNavItems.map((item) => item.url)).toEqual([
      '/admin/ai/datasources',
      '/admin/ai/distill',
      '/admin/ai/settings',
      '/admin/ai/audit',
    ])
    expect(
      adminAiNavItems.some((item) => String(item.url).includes('/knowledge'))
    ).toBe(false)
  })

  /*
    2026-09-18：一级入口按**业务域**归类（工作台 / 业务运营 / AI 工作台 / 系统管理）。
    这条守住"同一层只表达同一种概念"——否则后面很容易又退回成一个大平铺列表，
    或者把管理员治理与日常业务混在一起（2026-09-16 之前的形态）。
    2026-09-20 任务中心下线，它那一域随之消失。
  */
  it('一级入口按业务域分组', () => {
    const domainOf = (title: string) =>
      sidebarData.navItems.find((item) => item.title === title)?.section

    expect(domainOf('仪表盘')).toBe('工作台')
    expect(domainOf('我的 ASIN')).toBe('业务运营')
    expect(domainOf('竞品分析')).toBe('业务运营')
    expect(domainOf('产品开发')).toBe('业务运营')
    expect(domainOf('AI 助手')).toBe('AI 工作台')
    expect(domainOf('提示词广场')).toBe('AI 工作台')
    expect(domainOf('知识库')).toBe('AI 工作台')
    expect(domainOf('AI 治理')).toBe('系统管理')

    // 域的先后顺序 = 侧边栏渲染顺序（分组标题按"第一次出现"渲染）
    expect([
      ...new Set(sidebarData.navItems.map((item) => item.section)),
    ]).toEqual(['工作台', '业务运营', 'AI 工作台', '系统管理'])
  })

  /*
    `matchPrefix` 的用途：目标项在导航里没有同名项时（治理子页就是这种形态），
    靠它让父入口在子路径下继续高亮 —— 否则点进子页后侧边栏整块失去位置提示。
    2026-09-20 任务中心下线后，真实数据里带该字段的是「AI 治理」（下辖 `/admin/ai/*` 四个子页）。
  */
  it('带 matchPrefix 的入口在子路径下也保持高亮', () => {
    const adminAi = sidebarData.navItems.find(
      (item) => item.title === 'AI 治理'
    )
    expect(adminAi?.matchPrefix).toBe(true)
    expect(
      isNavUrlActive(
        '/admin/ai/datasources',
        adminAi?.url,
        adminAi?.matchPrefix
      )
    ).toBe(true)
    expect(
      isNavUrlActive('/admin/ai', adminAi?.url, adminAi?.matchPrefix)
    ).toBe(true)
  })
})

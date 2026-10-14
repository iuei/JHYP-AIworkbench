import { describe, expect, it } from 'vitest'
import { buildBreadcrumb } from './breadcrumb'
import { sidebarData } from './data/sidebar-data'

const navItems = sidebarData.navItems

function build(pathname: string, title?: string) {
  return buildBreadcrumb({ pathname, title, navItems }).map(
    (entry) => entry.title
  )
}

describe('buildBreadcrumb', () => {
  it('首页只显示一项，就是侧边栏第一项的名字', () => {
    expect(build('/', '仪表盘')).toEqual(['仪表盘'])
  })

  it('治理入口自身就是一级项：给出「根 / 页面」两级', () => {
    // 2026-09-18 取消「系统管理」同名折叠类目后，/admin/users 不再有中间那一层
    expect(build('/admin/users', '用户管理')).toEqual(['仪表盘', '用户管理'])
  })

  it('子页标题与模块标题同时出现（导航更具体时不再补模块名）', () => {
    // /product-dev/market 的导航项是「市场调研」，而路由标题是模块级「产品开发」
    expect(build('/product-dev/market', '产品开发')).toEqual([
      '仪表盘',
      '产品开发',
      '市场调研',
    ])
  })

  it('导航项与路由标题同名时不重复出现', () => {
    expect(build('/admin/announcements', '公告管理')).toEqual([
      '仪表盘',
      '公告管理',
    ])
  })

  it('一级页面给出两级', () => {
    expect(build('/prompts', '提示词广场')).toEqual(['仪表盘', '提示词广场'])
  })

  it('实体详情页在导航里没有对应项：只保留业务域那一级，末级用路由标题', () => {
    // 回退命中「竞品分析 → 分析」时若把「分析」也拼上，就会得到四级面包屑
    expect(build('/competitor-analysis/B0EXAMPLE', '竞品详情')).toEqual([
      '仪表盘',
      '竞品分析',
      '竞品详情',
    ])
  })

  it('独立子路由回退到它的一级类目，再用自己的标题收尾', () => {
    // /asin-watchlists/items 是「我的 ASIN」下的明细页，它自己声明了「商品明细」
    // （不声明的话它和首页都叫「我的 ASIN」，多页签里就是两个同名标签）
    expect(build('/asin-watchlists/items', '商品明细')).toEqual([
      '仪表盘',
      '我的 ASIN',
      '商品明细',
    ])
  })

  it('由顶栏导航承载的子页带上完整的类目层级（三级）', () => {
    // 侧边栏只到「AI 治理」（它现在是一级入口），四个治理子页由顶栏中段导航承载并各自声明标题
    // （「知识库」2026-09-18 已并入「AI 工作台 → 知识库」，不再出现在这里）
    expect(build('/admin/ai/datasources', '数据源与导入')).toEqual([
      '仪表盘',
      'AI 治理',
      '数据源与导入',
    ])
  })

  it('精确命中的子项优先用导航名（与模块标题不同名时两者都出现）', () => {
    expect(build('/competitor-analysis/results', '分析结果')).toEqual([
      '仪表盘',
      '竞品分析',
      '分析结果',
    ])
  })

  it('导航里完全没有的页面（个人设置）退化成「根 / 路由标题」', () => {
    expect(build('/settings', '用户信息')).toEqual(['仪表盘', '用户信息'])
  })

  it('查询串不影响层级判定', () => {
    expect(build('/prompts?view=shared', '提示词广场')).toEqual([
      '仪表盘',
      '提示词广场',
    ])
  })

  it('末尾斜杠不影响层级判定', () => {
    expect(build('/admin/users/', '用户管理')).toEqual(['仪表盘', '用户管理'])
  })

  it('只有末级没有链接，其余各级可点击回上层', () => {
    const entries = buildBreadcrumb({
      pathname: '/admin/ai/datasources',
      title: '数据源与导入',
      navItems,
    })
    expect(entries[0].href).toBe('/')
    // 「AI 治理」有自己的落地页，作为祖先时可点回
    expect(entries[1].href).toBe('/admin/ai')
    expect(entries[2].href).toBeUndefined()
  })

  it('折叠类目没有落地页，刻意不给点不动的假链接', () => {
    const entries = buildBreadcrumb({
      pathname: '/product-dev/market',
      title: '产品开发',
      navItems,
    })
    expect(entries.map((entry) => entry.title)).toEqual([
      '仪表盘',
      '产品开发',
      '市场调研',
    ])
    expect(entries[1].href).toBeUndefined()
  })

  it('侧边栏里没有根项时回落到「主页」而不是空标题', () => {
    const entries = buildBreadcrumb({
      pathname: '/prompts',
      title: '提示词广场',
      navItems: [],
    })
    expect(entries.map((entry) => entry.title)).toEqual(['主页', '提示词广场'])
  })

  it('普通账号的数据里没有治理入口时不会凭空出现「系统管理」分组名', () => {
    const visible = navItems.filter((item) => !item.adminOnly)
    const titles = buildBreadcrumb({
      pathname: '/admin/users',
      title: '用户管理',
      navItems: visible,
    }).map((entry) => entry.title)
    expect(titles).toEqual(['仪表盘', '用户管理'])
  })
})

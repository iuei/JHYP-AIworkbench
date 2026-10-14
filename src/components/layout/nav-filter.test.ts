import { describe, expect, it } from 'vitest'
import { sidebarData } from './data/sidebar-data'
import { filterNavItemsByRole } from './nav-filter'

/**
 * 侧边栏按角色过滤的护栏（2026-09-16 阶段 D 补）。
 *
 * **为什么用纯函数单测而不是端到端**：端到端要真的有一个普通账号，
 * 而验收库里的 `ai-agent-acceptance` 在换库/重建后并不一定存在 ——
 * 实测已经撞过一次（脚本 `verify-nav-ia.mjs` 里那段因此会跳过）。
 * "治理入口不暴露给普通账号"是权限口径，不能依赖"某个账号恰好存在"来守。
 *
 * 服务端每个治理接口另有 `requireAdmin` 兜底，`/admin/*` 路由还有 `beforeLoad` 守卫；
 * 本文件的过滤只解决"看得见"这一层。
 */
describe('filterNavItemsByRole', () => {
  it('普通账号看不到任何治理入口（改名、扁平化前后都不暴露）', () => {
    const titles = filterNavItemsByRole(sidebarData.navItems, false).map(
      (i) => i.title
    )
    expect(titles).not.toContain('系统管理')
    expect(titles).not.toContain('用户管理')
    expect(titles).not.toContain('公告管理')
    expect(titles).not.toContain('AI 治理')
    expect(titles).not.toContain('设置')
  })

  it('普通账号看不到任何治理子项', () => {
    const visible = filterNavItemsByRole(sidebarData.navItems, false)
    const childTitles = visible
      .flatMap((item) => item.items ?? [])
      .map((sub) => sub.title)
    expect(childTitles).not.toContain('用户管理')
    expect(childTitles).not.toContain('公告管理')
    expect(childTitles).not.toContain('AI 治理')
  })

  it('管理员能看到「系统管理」分组下的三个平铺入口，顺序为 AI 治理 / 用户管理 / 公告管理', () => {
    const admin = filterNavItemsByRole(sidebarData.navItems, true)
    // 2026-09-18：分组标签与同名折叠类目重复（「系统管理 → 系统管理」），
    // 一级类目取消后三个治理入口直接挂在分组下，这条断言守住新形态。
    const managed = admin.filter((item) => item.section === '系统管理')
    expect(managed.map((item) => item.title)).toEqual([
      'AI 治理',
      '用户管理',
      '公告管理',
    ])
    expect(managed.map((item) => item.url)).toEqual([
      '/admin/ai',
      '/admin/users',
      '/admin/announcements',
    ])
    expect(
      managed.every((item) => item.adminOnly && item.items === undefined)
    ).toBe(true)
  })

  it('普通账号仍看得到业务类目与它们的子页（过滤只针对 adminOnly）', () => {
    const visible = filterNavItemsByRole(sidebarData.navItems, false)
    // 2026-09-20：任务中心整体下线，普通账号可见的一级入口到此为止
    expect(visible.map((i) => i.title)).toEqual([
      '仪表盘',
      '我的 ASIN',
      '竞品分析',
      '市场洞察',
      '产品开发',
      'AI 助手',
      '提示词广场',
      '知识库',
    ])
    expect(
      visible.find((i) => i.title === '产品开发')?.items?.map((s) => s.url)
    ).toEqual(['/product-dev', '/product-dev/compare', '/product-dev/market'])
  })

  /*
    2026-09-18 用户口径「任务中心板块和产品开发板块标注为开发中」：
    任务中心已于 2026-09-20 整体下线，现在只剩产品开发要带 `badge: '开发中'`，
    且**角色过滤不能把徽标丢掉**（过滤用的是展开复制，漏带一个字段就会让普通账号看到没有徽标的入口）。
  */
  it('产品开发带「开发中」徽标（两种角色下都不丢）', () => {
    for (const isAdmin of [true, false]) {
      const items = filterNavItemsByRole(sidebarData.navItems, isAdmin)
      expect(items.find((item) => item.title === '产品开发')?.badge).toBe(
        '开发中'
      )
    }
  })
})

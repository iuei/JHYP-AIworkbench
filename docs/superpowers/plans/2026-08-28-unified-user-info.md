# 统一用户信息入口实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户相关入口和个人资料、账户、退出登录功能收敛到 `/settings`。

**Architecture:** 保留现有设置路由壳和认证退出逻辑，仅调整入口组件语义与 `/settings` 内容组合；旧账户路由通过重定向保持兼容。

**Tech Stack:** React 19、TypeScript、TanStack Router、shadcn/ui、Tailwind CSS v4、Vitest Browser。

## Global Constraints

- 使用 pnpm，不新增依赖。
- 复用项目主题变量和现有布局组件。
- 不修改服务端接口、认证模型或基础 UI 组件。
- 采用测试先行并完成 lint、build、相关测试和手动路由验证。

---

### Task 1: 用户入口直接导航

**Files:**
- Modify: `src/components/layout/nav-user.tsx`
- Modify: `src/components/profile-dropdown.tsx`
- Create: `src/components/layout/nav-user.test.tsx`
- Create: `src/components/profile-dropdown.test.tsx`

**Interfaces:**
- Consumes: TanStack Router `Link`、现有 Avatar 与 SidebarMenu 组件。
- Produces: 两个直接指向 `/settings` 且无菜单的用户入口。

- [ ] 编写测试，断言入口链接目标为 `/settings` 且不渲染菜单项。
- [ ] 运行相关测试并确认因现有 DropdownMenu 行为失败。
- [ ] 将两个入口改为直接链接，移除菜单和退出弹窗状态。
- [ ] 重跑测试并确认通过。

### Task 2: 合并用户信息页面

**Files:**
- Modify: `src/features/settings/profile/index.tsx`
- Create: `src/features/settings/profile/index.test.tsx`

**Interfaces:**
- Consumes: `ProfileForm`、`AccountForm`、`SignOutDialog`。
- Produces: 同页展示个人资料、账户信息和退出登录操作的 `SettingsProfile`，桌面双栏、移动端单列。

- [ ] 编写页面测试，断言三个功能区域同时存在且退出登录触发确认框。
- [ ] 运行测试并确认现有页面缺少账户与退出区域。
- [ ] 组合现有表单并增加登录与安全区域。
- [ ] 重跑测试并确认通过。

### Task 3: 清理重复导航并保持路由兼容

**Files:**
- Modify: `src/components/layout/data/sidebar-data.ts`
- Modify: `src/routes/_authenticated/settings/account.tsx`
- Modify: `src/features/settings/index.tsx`

**Interfaces:**
- Consumes: TanStack Router `redirect`。
- Produces: 精简设置菜单和兼容 `/settings/account` 的重定向。

- [ ] 移除侧边栏个人资料、账户入口与无用图标导入。
- [ ] 将账户路由改为跳转 `/settings`。
- [ ] 更新设置页说明文案为统一用户信息语义。

### Task 4: 文档与完整验证

**Files:**
- Modify: `docs/modules/全局布局与导航.md`
- Modify: `docs/modules/设置中心.md`

**Interfaces:**
- Consumes: 已完成的页面与导航行为。
- Produces: 更新后的责任田影响范围和历史记录。

- [ ] 更新两个责任田文档的功能描述、入口和历史变更。
- [ ] 运行 `pnpm.cmd run test`、`pnpm.cmd run lint`、`pnpm.cmd run build`。
- [ ] 在运行页面验证左侧入口、顶部头像、统一页面和兼容路由。

# 快捷导航实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增数据库驱动、登录用户可浏览、仅管理员可维护的快捷导航模块。

**Architecture:** PostgreSQL 使用分类、导航项、标签和关联表规范化存储，Express 提供读取与管理员 CRUD API。React Query 管理服务端状态，TanStack Router 提供浏览和管理路由，UI 复用项目布局、shadcn/ui 与主题变量。

**Tech Stack:** PostgreSQL、Express 5、React 19、TypeScript、TanStack Router、TanStack Query、Zod、shadcn/ui、Tailwind CSS v4、Vitest。

## Global Constraints

- 包管理器固定使用 pnpm，不新增依赖。
- 所有已登录用户可读取，只有实时 `enabled` 管理员可写入。
- UI 必须兼容现有主题、暗色模式与响应式规则，不硬编码主题外颜色。
- 初始数据来自 `E:\codex\index.html`，重复初始化不得产生重复数据。
- 不改变仪表盘现有 `shortcut_preferences` 语义。
- 不自动提交、推送或执行破坏性 Git 操作。

---

### Task 1: 数据模型、责任田与校验器

**Files:**
- Create: `docs/modules/快捷导航.md`
- Create: `server/quick-navigation.mjs`
- Create: `server/quick-navigation.node-test.mjs`
- Modify: `server/setup.mjs`

**Interfaces:**
- Produces: `parseCategoryInput(input)`、`parseTagInput(input)`、`parseNavigationItemInput(input)`、`QuickNavigationValidationError`。
- Produces: 四张数据库表和幂等的参考数据初始化。

- [ ] **Step 1: 写失败的服务端校验测试**

```js
test('parseNavigationItemInput validates category placement and deduplicates tags', () => {
  assert.deepEqual(parseNavigationItemInput({
    name: ' 海关编码 ', url: 'https://example.com', description: '',
    placement: 'category', categoryId: 1, sortOrder: 0, tagIds: [2, 2, 3],
  }).tagIds, [2, 3])
})
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `node --test server/quick-navigation.node-test.mjs`
Expected: FAIL，提示无法导入 `server/quick-navigation.mjs`。

- [ ] **Step 3: 实现校验器与数据库初始化**

```js
export class QuickNavigationValidationError extends Error {}
export function parseNavigationItemInput(input) {
  // 返回 name、url、description、placement、categoryId、sortOrder、去重后的 tagIds
}
```

在 `server/setup.mjs` 创建四表、约束和初始分类/导航/标签，使用参数化 SQL 与幂等查询。

- [ ] **Step 4: 运行服务端单元测试**

Run: `node --test server/quick-navigation.node-test.mjs`
Expected: PASS。

### Task 2: 读取与管理员 CRUD API

**Files:**
- Modify: `server/index.mjs`
- Test: `server/quick-navigation.node-test.mjs`

**Interfaces:**
- Consumes: Task 1 的解析函数和四张表。
- Produces: `GET /api/quick-navigation` 与分类、导航项、标签 CRUD 路由。

- [ ] **Step 1: 扩展校验测试覆盖空名称、非法 URL、非法 placement 和负排序**

```js
assert.throws(
  () => parseNavigationItemInput({ name: '', url: 'javascript:alert(1)', placement: 'featured' }),
  QuickNavigationValidationError
)
```

- [ ] **Step 2: 实现读取聚合查询**

```js
app.get('/api/quick-navigation', requireUser, async (_req, res, next) => {
  // 查询分类、导航项、标签并返回稳定排序的嵌套结构
})
```

- [ ] **Step 3: 实现管理员写接口与事务**

导航项创建/更新在事务中校验分类和标签存在性，并原子替换 `navigation_item_tags`；分类非空删除返回 409。

- [ ] **Step 4: 运行服务端测试**

Run: `node --test server/*.node-test.mjs`
Expected: 所有测试 PASS。

### Task 3: 浏览页、搜索与导航入口

**Files:**
- Create: `src/features/quick-navigation/types.ts`
- Create: `src/features/quick-navigation/navigation-filter.ts`
- Create: `src/features/quick-navigation/navigation-filter.test.ts`
- Create: `src/features/quick-navigation/navigation-tag.tsx`
- Create: `src/features/quick-navigation/index.tsx`
- Create: `src/routes/_authenticated/quick-navigation/index.tsx`
- Modify: `src/components/layout/data/sidebar-data.ts`

**Interfaces:**
- Consumes: `GET /api/quick-navigation`。
- Produces: `filterQuickNavigation(data, keyword)` 和 `/quick-navigation` 页面。

- [ ] **Step 1: 写搜索过滤失败测试**

```ts
expect(filterQuickNavigation(data, '商标')).toMatchObject({
  categories: [{ items: [{ name: '美国商标查询入口' }] }],
})
```

- [ ] **Step 2: 实现类型与纯过滤函数**

搜索同时匹配分类名、导航名称、说明和标签；分类名命中时保留分类全部项目。

- [ ] **Step 3: 实现浏览页和标签组件**

使用 `Header`、`Main`、`Input`、`Button` 和主题 token，置顶链接与分类卡片均安全打开外链，管理员入口链接到管理页。

- [ ] **Step 4: 增加路由与侧边栏入口**

在“常用”分组增加 `Compass` 图标的 `/quick-navigation` 入口。

- [ ] **Step 5: 运行前端定向测试**

Run: `pnpm exec vitest run src/features/quick-navigation/navigation-filter.test.ts --browser.headless`
Expected: PASS。

### Task 4: 管理页面与 CRUD 交互

**Files:**
- Create: `src/features/quick-navigation/manage.tsx`
- Create: `src/features/quick-navigation/navigation-form.tsx`
- Create: `src/routes/_authenticated/quick-navigation/manage.tsx`
- Test: `src/features/quick-navigation/manage.test.tsx`

**Interfaces:**
- Consumes: Task 2 CRUD API、Task 3 类型与标签组件。
- Produces: 管理员分类、导航项和标签管理界面。

- [ ] **Step 1: 写管理员权限与保存请求失败测试**

```tsx
expect(screen.getByText('该功能仅对管理员开放。')).toBeInTheDocument()
await user.click(screen.getByRole('button', { name: '新增分类' }))
```

- [ ] **Step 2: 实现三选项卡管理视图**

分类、导航项和标签分别使用表格；新增/编辑使用 `Dialog`，删除使用 `ConfirmDialog`。

- [ ] **Step 3: 实现导航项表单**

表单字段为名称、URL、说明、展示位置、分类、标签多选和排序；`featured` 禁用分类，`category` 强制选择分类。

- [ ] **Step 4: 接入 React Query mutations**

所有成功写操作关闭弹窗、toast 提示并失效 `['quick-navigation']`；API 错误展示服务端消息。

- [ ] **Step 5: 运行管理页面测试**

Run: `pnpm exec vitest run src/features/quick-navigation/manage.test.tsx --browser.headless`
Expected: PASS。

### Task 5: 文档、全量验证与视觉验收

**Files:**
- Modify: `docs/modules/快捷导航.md`
- Modify: `docs/modules/服务端 API 与开发启动.md`
- Modify: `docs/modules/全局布局与导航.md`
- Modify: `src/routeTree.gen.ts`（由路由插件生成）

**Interfaces:**
- Consumes: 前四项完整功能。
- Produces: 可维护文档和通过验收的模块。

- [ ] **Step 1: 更新责任田历史和影响范围**

记录数据库表、API、路由、权限、初始化数据和侧边栏变更。

- [ ] **Step 2: 执行全量验证**

Run: `pnpm run test`
Expected: PASS。

Run: `pnpm run lint`
Expected: PASS。

Run: `pnpm run build`
Expected: PASS，并生成最新 `routeTree.gen.ts`。

- [ ] **Step 3: 验证数据库和 API**

Run: `pnpm run db:setup`
Expected: 初始化成功，重复运行无重复记录。

验证普通用户写请求返回 403、管理员 CRUD 生效、删除非空分类返回 409。

- [ ] **Step 4: 主题一致性检查**

对比仪表盘和设置页，确认亮/暗主题、卡片边框、圆角、间距、图标、焦点状态及 1/2/4 列响应式布局没有视觉割裂。


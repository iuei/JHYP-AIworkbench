# 开发手册（Development Guide）

本文档是当前项目的统一开发规范。后续新增页面、修改页面、重构代码、增加模块，必须优先遵循本文档；如发现历史实现与本文档不一致，应先记录差异并提出统一方案，经确认后再修改。

## 1. 项目简介

本项目是基于 `Vite + React 19 + TypeScript + TanStack Router + TanStack Query + shadcn/ui + Tailwind CSS v4` 的后台管理界面。

当前项目包含 Dashboard、Tasks、Users、Apps、Chats、Settings、Auth、Errors、Clerk 示例等页面。UI 基础为 shadcn/ui New York 风格，支持深浅色主题、字体切换、RTL、侧边栏布局配置和全局命令搜索。

当前业务数据主要来自本地静态数据和表单演示；项目已预置 React Query、Axios 错误处理和 Zustand 认证状态，但尚未形成真实 API 层和完整权限守卫。

## 2. 项目目录规范

- `src/routes/`：TanStack Router 文件路由，只放路由定义、search schema、路由装配。
- `src/features/`：业务模块主体，每个模块自包含页面、组件、数据、schema。
- `src/components/ui/`：shadcn/ui 基础组件，不承载业务逻辑。
- `src/components/layout/`：全局布局、侧边栏、顶部导航。
- `src/components/data-table/`：通用表格工具栏、分页、筛选、列控制、批量操作基础能力。
- `src/context/`：主题、字体、方向、搜索、布局等全局 React Context。
- `src/hooks/`：跨模块复用 Hook。
- `src/lib/`：通用工具、错误处理、Cookie、演示提交输出。
- `src/stores/`：Zustand 全局状态，目前主要是认证状态。
- `src/assets/`：Logo、自定义图标、品牌图标资源。
- `src/styles/`：全局样式与主题变量。

## 3. UI 设计规范

- 统一使用 shadcn/ui + Radix 组件，不直接重复实现基础交互组件。
- 页面风格定位为管理后台：信息密度适中、标题清晰、操作区靠右、内容区以表格、卡片、表单为主。
- 说明文字统一使用 `text-muted-foreground`。
- 页面主标题常用 `text-2xl font-bold tracking-tight`。
- 控件优先使用现有公共组件：`Button`、`Input`、`Select`、`ConfirmDialog`、`DataTableToolbar`、`DataTablePagination`。
- 不允许为了单个页面重新设计布局、样式或组件体系。

## 4. Layout 规范

- 认证布局统一使用 `AuthenticatedLayout`，内部包含 `SearchProvider`、`LayoutProvider`、`SidebarProvider`、`AppSidebar`、`SidebarInset`。
- 普通后台页面结构应为：
  - `Header fixed?`
  - `Main`
  - 页面标题区
  - 主内容区
  - Dialog/Drawer 组件放在页面末尾。
- `Header` 内右侧常规顺序：`Search`、`ThemeSwitch`、`ConfigDrawer`、`ProfileDropdown`。
- 内容容器统一使用 `Main`。
- 固定高度页面使用 `Main fixed`。
- 需要全宽内容时使用 `Main fluid`。

## 5. 页面开发规范

- 新页面必须先在 `src/routes` 增加文件路由，再在 `src/features/{module}` 实现页面主体。
- 路由文件不写复杂 UI；只负责 `createFileRoute`、`validateSearch`、`component`。
- 页面主体组件命名使用 PascalCase，例如 `Tasks`、`Users`、`Settings`。
- 有弹窗/抽屉状态的模块，应使用模块级 Provider 管理 `open` 与 `currentRow`。
- 新增页面必须复用已有 Layout、组件和设计规范。

## 6. 页面组成规范

典型列表页组成：

```tsx
<ModuleProvider>
  <Header fixed>
    <Search className='me-auto' />
    <ThemeSwitch />
    <ConfigDrawer />
    <ProfileDropdown />
  </Header>

  <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
    <TitleSection />
    <ModulePrimaryButtons />
    <ModuleTable />
  </Main>

  <ModuleDialogs />
</ModuleProvider>
```

设置类页面使用 `Settings + Outlet`，左侧为模块内 `SidebarNav`，右侧为子路由内容。

## 7. 组件开发规范

- 组件使用函数组件。
- 文件名使用 kebab-case，例如 `tasks-table.tsx`。
- 组件名使用 PascalCase，例如 `TasksTable`。
- 类型定义靠近组件，Props 命名为 `{ComponentName}Props`。
- 复用样式合并必须使用 `cn()`。
- 业务组件放在对应 `features/{module}/components`。
- 跨模块复用组件才放到 `src/components`。

## 8. 公共组件使用规范

- 弹窗确认使用 `ConfirmDialog`。
- 表格工具栏使用 `DataTableToolbar`。
- 表格分页使用 `DataTablePagination`。
- 下拉选择使用基础受控 `Select`；不要封装依赖 `FormField` 上下文的下拉组件（脱离 `<Form>` 会抛错白屏）。
- 密码输入使用 `PasswordInput`。
- 日期选择使用 `DatePicker`。
- 空页面可使用 `ComingSoon`。
- 加载占位使用 `Skeleton` 或现有组件里的 `Loader animate-spin` 模式。

## 9. 表格规范

- 表格基于 `@tanstack/react-table`。
- 列定义独立为 `{module}-columns.tsx`。
- 表格组件命名为 `{Module}Table`。
- 列类型使用 `ColumnDef<Model>[]`。
- 筛选、分页、URL 同步优先使用 `useTableUrlState`。
- 表格空状态当前统一文案为 `No results.`。
- 操作列使用行级 `DropdownMenu`。
- 操作触发按钮使用 ghost icon button，并提供 `sr-only` 文案。
- 选择列使用 `Checkbox`。
- 支持批量操作时接入 `DataTableBulkActions`。

## 10. 表单规范

- 表单使用 `react-hook-form + zod + zodResolver`。
- 表单结构使用 shadcn `Form`、`FormField`、`FormItem`、`FormLabel`、`FormControl`、`FormMessage`。
- 校验 schema 放在表单组件内或模块 `data/schema.ts`，按复用程度决定。
- 提交后当前项目演示使用 `showSubmittedData`。
- 真实接口接入前，不得硬编码成功状态来掩盖未实现逻辑。
- Dialog 表单使用固定 `form id`，Footer 按钮通过 `form='xxx'` 提交。
- Drawer 表单内容区应可滚动，Footer 固定在底部。

## 11. 图表规范

- 图表使用 `recharts`。
- 容器使用 `ResponsiveContainer`。
- 颜色优先使用主题类：`text-primary`、`text-muted-foreground`、`fill-primary`。
- 避免在业务图表中散落硬编码颜色。
- 坐标轴字号当前为 `12`，轴线和 tickLine 默认关闭。

## 12. 按钮规范

- 使用 `Button` 组件。
- 主操作使用默认 variant。
- 次操作使用 `outline`。
- 危险操作使用 `destructive`。
- 图标按钮使用 `size='icon'` 并提供 `aria-label` 或 `sr-only`。
- 页面主按钮区域使用 `flex gap-2`。
- 列表主操作常见顺序：导入/次操作在左，创建/主操作在右。

## 13. 图标规范

- 常规图标使用 `lucide-react`。
- Radix icons 保留在基础交互、表格分页等已有场景内。
- 品牌图标放在 `src/assets/brand-icons`。
- 项目自定义布局/主题图标放在 `src/assets/custom`。
- 新增业务图标优先选 lucide，不新增重复 SVG。
- 不在业务页面中新增内联 SVG；确需自定义图标时，应沉淀到 `src/assets`。

## 14. 配色规范

- 使用 CSS 变量主题色，不直接发散色值。
- 主题变量定义在 `src/styles/theme.css`：
  - `background`
  - `foreground`
  - `primary`
  - `secondary`
  - `muted`
  - `accent`
  - `destructive`
  - `border`
  - `input`
  - `ring`
  - `chart-*`
  - `sidebar-*`
- 深色模式通过 `.dark` 覆盖变量。
- 新颜色应优先扩展主题变量，而不是散落在组件中。
- 主题预览、代码块预览等表达具体视觉状态的场景，可保留必要的固定色块。

## 15. 字体规范

- 字体由 `FontProvider` 控制，支持 `inter`、`manrope`、`system`。
- 新增字体需要同步：
  - `src/config/fonts.ts`
  - `index.html` 字体资源
  - `src/styles/theme.css` 的 `@theme inline`
- 不在单个页面私自引入字体。

## 16. 间距规范

- 页面主内容默认由 `Main` 提供 `px-4 py-6`。
- 页面块间距常用 `gap-4 sm:gap-6`、`space-y-4`、`space-y-6`、`space-y-8`。
- Header 高度固定为 `h-16`。
- 表格、Toolbar、分页之间使用 `gap-4`。
- Card 内部优先使用 shadcn `CardHeader`、`CardContent` 自带结构。

## 17. 响应式规范

- 使用 Tailwind 响应式类和容器查询类。
- 移动端表格保持横向可滚动。
- 表格容器使用 `overflow-hidden rounded-md border`，必要时表格设 `min-w-*`。
- 顶部导航在小屏使用 `DropdownMenu`，大屏使用横向 `nav`。
- Toolbar 在小屏使用纵向/反向布局。
- 输入控件在移动端全局强制 `font-size: 16px`，避免 iOS 聚焦缩放。

## 18. 命名规范

- 文件名：kebab-case。
- React 组件：PascalCase。
- Hook：`useXxx`。
- Provider：`{Module}Provider`。
- Dialog/Drawer：`{Module}{Action}Dialog`、`{Module}MutateDrawer`。
- 表格列：`{module}Columns`。
- Zod schema：`{entity}Schema`。
- 类型：`Task`、`User` 等 PascalCase。
- 路由 search 参数使用简短语义名，如 `page`、`pageSize`、`filter`、`status`、`role`。

## 19. 状态管理规范

- 全局认证状态使用 Zustand：`useAuthStore`。
- 主题、字体、方向、布局、搜索使用 Context + Cookie 持久化。
- 模块内 Dialog 状态使用模块 Provider + `useDialogState`。
- 表格 UI 状态分两类：
  - URL 同步：分页、筛选、搜索。
  - 本地状态：排序、列显隐、行选择。
- 不把页面局部状态放进全局 store。

## 20. API 调用规范

当前项目尚无实际 API 层，只有入口处预置了 React Query 和 Axios 错误处理。后续接入 API 时统一遵循：

- API client 放入 `src/api`。
- 服务函数按模块拆分，例如 `src/api/tasks.ts`。
- 查询使用 `useQuery`。
- 变更使用 `useMutation`。
- 错误交给全局 `QueryClient` 和 `handleServerError` 处理。
- 401 清理认证状态并跳转登录页。
- 真实接口接入前，不在组件里直接散落 `axios` 或 `fetch`。

## 21. 数据模型规范

- 模型优先用 Zod schema 定义，再用 `z.infer` 导出类型。
- 模块模型放在 `features/{module}/data/schema.ts`。
- 枚举选项放在 `features/{module}/data/data.ts(x)`。
- 静态演示数据放在 `features/{module}/data/*.ts` 或 `.json`。
- 表格行操作中可用 schema parse 校验 `row.original`。

## 22. 文件组织规范

新增模块推荐结构：

```text
src/features/example/
  index.tsx
  data/
    schema.ts
    data.ts
    examples.ts
  components/
    example-provider.tsx
    example-table.tsx
    example-columns.tsx
    example-dialogs.tsx
    example-primary-buttons.tsx
    example-mutate-drawer.tsx
    data-table-row-actions.tsx
    data-table-bulk-actions.tsx
```

对应路由：

```text
src/routes/_authenticated/example/index.tsx
```

## 23. 新增页面开发流程

1. 确认页面是否属于 `_authenticated`、`(auth)`、`clerk` 或错误页分组。
2. 在 `src/routes` 创建文件路由。
3. 如有 URL 查询参数，使用 Zod 定义 `validateSearch`。
4. 在 `src/features/{module}` 创建页面主体。
5. 复用 `Header`、`Main`、`Search`、`ThemeSwitch`、`ConfigDrawer`、`ProfileDropdown`。
6. 如需导航入口，更新 `src/components/layout/data/sidebar-data.ts`。
7. 如需全局命令搜索，确保侧边栏数据可覆盖该入口。
8. 补充必要测试。
9. 执行 `pnpm run lint`、`pnpm run build`、必要时执行 `pnpm run test`。

## 24. 新增模块开发流程

1. 先定义数据模型和 UI 形态。
2. 建立 `features/{module}` 目录。
3. 列表模块优先套用 Tasks/Users 模式。
4. Dialog/Drawer 状态统一放入模块 Provider。
5. 表格筛选分页优先接入 URL。
6. 操作按钮拆成 `{Module}PrimaryButtons`。
7. 弹窗统一汇总到 `{Module}Dialogs`。
8. 不跨模块引用其他模块内部组件，除非提升为公共组件。

## 25. 修改已有功能原则

- 最小改动，优先沿用当前模块模式。
- 不改 `src/components/ui`，除非确认为基础组件问题。
- 不破坏 URL search 参数兼容。
- 不直接删除已有演示能力、导航入口或主题能力。
- 修改表格时同步检查列定义、筛选项、search schema、URL 状态。
- 修改表单时同步检查 Zod schema、默认值、提交按钮、重置逻辑。

## 26. 禁止事项

- 禁止在组件中散落未封装 API 请求。
- 禁止直接硬编码主题外颜色作为业务规范。
- 禁止绕过 `Form` 体系手写不一致表单校验。
- 禁止新增页面绕开 `Header/Main` 布局。
- 禁止随意覆盖 shadcn 定制组件，README 已注明部分组件包含 RTL/项目定制。
- 禁止使用 `console`，ESLint 当前设置为 error。
- 禁止未确认自动 push / force push。
- 禁止危险操作未经确认，包括删除文件、删除功能、批量覆盖、权限变更、数据库结构修改。

## 27. 推荐实践

- 新业务页面优先复制 Tasks/Users 的结构，而不是从零组织。
- 类型导入必须使用 `import { type X } from ...`。
- Tailwind class 合并使用 `cn()`。
- 交互组件保留 `aria-label`、`sr-only` 等可访问性写法。
- 对列表筛选、分页使用 URL 同步，便于分享和刷新恢复。
- 复杂表单优先拆分 schema、默认值、提交逻辑，避免单组件过长。
- 新增测试优先覆盖 Hook、表单校验、Dialog 行为和关键工具函数。

## 28. 待确认统一项

以下是已发现但尚未确认执行的历史差异。修改前必须再次确认范围和方案：

- API 层缺失：当前只有 React Query/Axios 错误处理，没有 `src/api`。建议后续统一新增 `src/api`，所有接口请求集中管理。
- 权限守卫缺失：`_authenticated` 当前只是布局分组，没有真实鉴权。建议确认认证方案后，在路由层增加登录校验。
- 文案语言不统一：当前 UI 主要英文。建议新功能先统一中文，存量英文分阶段替换。
- Chats 弹窗状态未完全采用模块 Provider 模式。建议后续新增 `ChatsProvider` / `ChatsDialogs`，对齐 Tasks/Users 模式。
- Apps 搜索/分页仍是卡片页内局部实现。建议保留卡片形态，但进一步对齐路由 schema 和 URL 状态模式。
- README 中仍可能存在历史编码异常和英文模板内容。是否中文化或重写需单独确认。


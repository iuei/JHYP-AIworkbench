# 项目 AI 协作规则

## 1. 项目定位

本项目是基于 Vite、React 19、TypeScript、TanStack Router、TanStack Query、shadcn/ui、Tailwind CSS v4 的后台管理界面。

当前代码主要包含认证页、仪表盘、设置中心、错误页、全局布局与导航。后续新增业务模块时，应沿用现有目录、路由、布局、组件和样式体系。

## 2. 技术栈约束

- 包管理器统一使用 pnpm。
- 页面和组件使用 React 函数组件与 TypeScript。
- 路由使用 TanStack Router 文件路由，路由文件只负责路由定义、search schema 和页面装配。
- 基础 UI 使用 shadcn/ui 与 Radix 组件，不重复实现基础交互控件。
- 常规图标优先使用 lucide-react。
- 表单使用 react-hook-form、zod、zodResolver。
- 表格使用 @tanstack/react-table。
- 样式使用 Tailwind CSS 与项目主题变量，不在业务组件中散落硬编码颜色。

## 3. 目录边界

- `src/routes/`：文件路由定义，不承载复杂业务 UI。
- `src/features/`：业务模块主体，每个模块自包含页面、组件、数据和 schema。
- `src/components/ui/`：shadcn/ui 基础组件，不写业务逻辑。
- `src/components/layout/`：全局布局、侧边栏、顶部导航。
- `src/components/`：跨模块复用组件。
- `src/context/`：主题、字体、方向、搜索、布局等全局 Context。
- `src/hooks/`：跨模块复用 Hook。
- `src/lib/`：通用工具、错误处理、Cookie、演示提交输出。
- `src/stores/`：Zustand 全局状态。
- `src/styles/`：全局样式与主题变量。
- `docs/modules/`：模块责任田文档，记录模块职责、边界、影响范围和历史变更。

## 4. 开发流程

- 修改任何模块前，必须先阅读 `docs/modules/` 下对应责任田文档。
- 没有对应责任田时，先按 `docs/modules/责任田模板.md` 新建初稿，再动代码。
- 先阅读和搜索相关实现，沿用仓库既有模式、框架和本地 API，避免凭空引入新抽象。
- 结构化数据优先使用已有的类型、schema、API 或解析器处理，不以字符串拼接替代结构化处理。
- 复杂任务先确认需求理解、实现方案和风险影响；确认后同一任务链路内连续执行。
- 修改完成后，必须更新对应责任田的历史变更和影响范围。
- 每次修改保持最小改动，不做无关重构，不顺手改依赖、路由、权限或数据结构。
- 仅在能消除实际复杂度、减少有意义重复或符合既有模式时新增抽象。
- 遇到非本人产生的工作区改动，默认视为用户或系统保留内容，不得撤销；若其影响当前任务且无法安全兼容，先说明并请求确认。
- 手动编辑优先使用 `apply_patch`；能够通过 shell 或 `apply_patch` 完成的简单文件操作，不使用 Python 脚本读写。
- Git 操作使用非交互式命令；除非用户明确要求，禁止使用 `git reset --hard`、`git checkout --` 等破坏性命令。
- 危险操作必须提前确认，包括删除文件、删除功能、批量覆盖、权限变更、数据库结构修改、第三方服务切换。

## 5. 组件与 UI 规则

- 后台页面优先复用 `Header`、`Main`、`Search`、`ThemeSwitch`、`ConfigDrawer`、`ProfileDropdown`。
- 页面主标题常用 `text-2xl font-bold tracking-tight`。
- 说明文字统一使用 `text-muted-foreground`。
- 按钮使用 `Button`，图标按钮需要 `aria-label` 或 `sr-only` 文案。
- 弹窗确认使用 `ConfirmDialog`。
- 下拉选择使用 `src/components/ui/select.tsx` 的基础受控 `Select`；不要封装依赖 `FormField` 上下文的下拉组件（脱离 `<Form>` 使用会抛 `useFormContext is null` 并白屏）。
- 密码输入使用 `PasswordInput`。
- 日期选择使用 `DatePicker`。
- 业务页面不得绕开现有 Header/Main 布局体系。
- 控件语义应与任务匹配：二元设置使用开关或复选框，模式切换使用分段控件，视图切换使用选项卡，明确操作使用带清晰文案的按钮。
- 图标优先使用 `lucide-react` 或项目既有图标库；不熟悉的图标必须提供 `Tooltip` 或等效提示。
- 避免卡片嵌套卡片；响应式布局须避免文本溢出、内容遮挡和悬停或动态内容引起的布局抖动。

## 6. API 与数据规则

- 当前项目尚无完整真实 API 层；新增 API 时统一放入 `src/api`。
- 组件中不得散落未封装的 `axios` 或 `fetch`。
- 查询使用 React Query 的 `useQuery`，变更使用 `useMutation`。
- 模型优先使用 Zod schema 定义，再导出类型。
- 静态演示数据放在模块 `data/` 目录中。
- 真实接口接入前，不得硬编码成功状态来掩盖未实现逻辑。

## 7. 验证要求

每次代码修改后必须按影响范围验证：

- 构建：`pnpm run build`
- lint：`pnpm run lint`
- 测试：必要时运行 `pnpm run test`
- 功能验证：必要时启动页面手动验证
- 影响检查：确认路由、模块、API、权限、样式没有被无关影响
- 测试范围随风险递增：小改动验证直接影响点；涉及共享行为、跨模块契约或用户流程时，补充相应的集成或端到端验证。

纯文档修改至少需要确认文档路径、链接和责任田覆盖范围，不强制跑前端构建。

## 8. 禁止事项

- 禁止未确认自动 push 或 force push。
- 禁止未确认删除文件、目录、功能或数据。
- 禁止绕过现有组件体系重写基础 UI。
- 禁止在业务组件中直接硬编码主题外颜色。
- 禁止为了单个页面引入新的布局体系。
- 禁止无需求升级依赖或切换第三方服务。
- 禁止使用 `console`，当前 ESLint 配置会报错。

## 9. 代码审查规范

- 用户请求代码审查时，优先输出缺陷、风险、行为回归和缺失测试，按严重度排序。
- 每项问题必须给出文件路径、准确行号和影响说明；无问题时明确说明，并列出仍需关注的残余风险。

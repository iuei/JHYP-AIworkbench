# 设计基线

## Source of truth

- Status: Active
- Date: 2026-09-20
- Product surfaces: 登录后内部工作台、侧边栏与顶部栏、业务页、认证页和错误页。
- Evidence reviewed: `README.md`、`AGENTS.md`、`docs/modules/`、`docs/AI 开发手册.md`、`src/components/layout/`、`src/components/ui/`、`src/styles/theme.css` 以及现有业务页。

## Brand

- Personality: 专业、直接、克制的内部工具，优先帮助用户完成运营工作。
- Trust signals: 清晰的状态、可追溯的数据来源、真实的错误反馈和明确的权限边界。
- Avoid: SaaS 营销化语言、无信息价值的装饰、硬编码品牌色、与任务无关的卡片层级。

## Product goals

- Goals: 使用户快速找到入口、发起任务、查看状态并处理异常。
- Non-goals: 不用介绍性文案或装饰元素填充工作台首屏。
- Success signals: 高频操作在首屏可见，关键路径一次可达，窄屏无溢出或遮挡，主要操作可键盘完成。

## Personas and jobs

- 运营用户：高频查询数据、打开内部系统、进行竞品分析和使用 AI 知识。
- 管理员：在普通使用之外维护用户、导航、知识与模型配置。
- Context: 以桌面办公为主，同时要支持窄屏查看和基本操作。

## Information architecture

- 侧边栏是一级导航：常用业务在前，设置在后。
- `Header` 承载当前位置、全局操作和用户入口；`Main` 承载页面任务。
- 页面内按“主操作 → 核心内容 → 辅助信息”排序；同一标题不在顶部栏和内容区重复解释。
- 仪表盘将四项工作概览置顶；宽屏用两排相同的 8:4 列宽，卡片在各排行内等高，分别展示待处理分析 / 开始工作和最近分析 / 个人 AI；窄屏依次显示概览、开始工作、待处理、最近分析与个人 AI，并让分析记录的操作直接可见。

## Design principles

1. 任务优先：首屏先放搜索、创建、查询等主操作。
2. 渐进展示：说明、标签和技术细节只在完成判断时显示。
3. 高信息密度：使用紧凑间距和扁平层级，但保持可点击区域与可读性。
4. 一致优先：复用现有布局、shadcn/ui、Lucide 和主题 token。

## Visual language

- Color: 只使用 `background`、`foreground`、`card`、`muted`、`primary`、`border` 等主题变量。
- Typography: 页面主标题使用 `text-2xl font-bold tracking-tight`，辅助信息使用 `text-muted-foreground`。
- Spacing: 业务页优先紧凑的 3–6 级间距，只在不同任务区之间使用更大分隔。
- Shape/elevation: 以轻边框和 `rounded-md/lg/xl` 为主，阴影只用于层级或交互反馈。
- Motion and iconography: 短时颜色、边框、阴影过渡；常规图标使用 `lucide-react`。

## Components

- Layout: `AuthenticatedLayout`、`Header`、`Main`、`AppSidebar`。
- Global actions: `Search`、`ThemeSwitch`、`ProfileDropdown`。
- Controls: 优先复用 `src/components/ui/` 的 `Button`、`Input`、`Select`、`Tabs`、`Dialog` 等。
- Ownership: 基础交互归 UI 组件，业务组合归 `src/features/`，颜色与圆角 token 归 `src/styles/theme.css`。

## Accessibility

- Target: WCAG 2.1 AA 实用基线。
- 保留语义标题、表单标签、明确按钮名和可见焦点。
- 图标按钮必须有 `aria-label` 或 `sr-only` 文案，状态变化必须可被辅助技术感知。
- 遵守用户的 reduced-motion 偏好，不以颜色作为唯一状态信号。

## Responsive behavior

- 移动端：单列为主，操作可换行，文本不溢出，重要操作保持可点击。
- 中等宽度：常用双列，数据表格可水平滚动或降级为紧凑展示。
- 桌面端：充分使用可用工作区，不因装饰性最大宽度产生大面积空白。
- Hover 只作增强，触屏和键盘仍能完成全部关键流程。

## Interaction states

- 数据页必须覆盖 loading、empty、error 和 success 反馈。
- 网络失败不伪装成成功；可恢复的失败提供重试入口。
- 破坏性操作使用 `ConfirmDialog`，提交中状态禁用重复操作。

## Content voice

- 使用简洁、具体、可执行的中文，准确说明当前状态与下一步。
- 避免中英文装饰性混排、重复页面介绍和无法指导行动的口号。
- 空状态和错误文案先说结果，再给出可执行建议。

## Implementation constraints

- Vite、React 19、TypeScript、TanStack Router/Query、Tailwind CSS v4、shadcn/ui、Lucide。
- 路由只负责装配，业务 UI 放在 `src/features/`，API 访问通过 `src/api/`。
- 不引入新布局体系、无关依赖或业务组件内硬编码颜色。
- UI 改动至少验证 build、lint 和直接影响流程；共享行为变更补充集成或端到端验证。

## Open questions

- [ ] 是否需要为内部工作台建立正式的 WCAG 符合性验收清单？Owner: 产品 / 前端；影响：可访问性测试范围。
- [ ] 桌面端和移动端的正式浏览器支持矩阵尚未记录。Owner: 产品 / IT；影响：兼容性回归范围。

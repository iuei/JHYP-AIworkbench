# 工作台首页布局优化开发方案

> **给执行 agent：** 本方案针对当前项目的登录后首页 `/`，不是 AI 治理页面重构。执行前阅读 `docs/modules/仪表盘.md`、本文件和 `src/features/dashboard/index.tsx`。按 Task 顺序实施；除非用户另行要求，不修改无关模块、不提交、不 push。

## 1. 目标

将旧版“快捷功能 + 占位业务卡片”首页优化为当前项目真实架构下的个人工作台首页：

- 首页负责快速进入真实业务、继续未完成工作、查看最近活动；
- 员工侧 AI 助手与管理员侧 AI 治理保持分离；
- 首页不展示“即将上线”的伪功能，不展示 AI 治理菜单和治理指标；
- 继续复用现有 `Header`、`Main`、shadcn/ui Card 和 `/api/dashboard`；
- 不引入新的全局布局体系，不改变登录、认证和现有业务路由。

## 2. 当前实现基线

当前首页入口是 `src/routes/_authenticated/index.tsx`，页面实现是 `src/features/dashboard/index.tsx`。

现有首页已经具备：

- JHYP 工作台标题和说明；
- 可拖拽排序的快捷卡片；
- “正在进行的工作”列表；
- “最近竞品分析”列表；
- `/api/dashboard` 查询和 `/api/dashboard/shortcuts` 保存用户快捷入口排序。

当前需要调整的问题：

1. 快捷卡片包含“项目开发、Listing 打造、评论分析 Plus”等无实际路由的占位项；
2. 服务端默认快捷 ID 仍包含 `project/listing/reviews`；
3. 页面没有统一 loading/error 状态；
4. 首页没有明确区分“真实入口”和“工作动态”；
5. 首页不应承载 AI 治理内容，治理入口应保持在「设置 → AI 治理」；
6. 现有页面 JSX 过度压缩，后续改动不易维护。

## 3. 目标信息架构

### 3.1 侧边栏职责

首页只作为「仪表盘」入口。整体导航关系保持：

```text
常用
├── 仪表盘
├── 快捷导航
└── AI 助手
    ├── 对话
    └── 我的沉淀

其他
└── 设置
    ├── 用户管理
    ├── 外观
    └── AI 治理
```

本方案不在首页增加 AI 治理入口，也不把知识库、数据源、经验审核、模型配置、审计台放进首页卡片。

### 3.2 首页内容层级

```text
Header：搜索 / 主题 / 用户

首页欢迎区
  JHYP 智能工作台
  用 AI 与自动化加速跨境电商运营工作。

常用入口
  AI 助手 / 快捷导航 / 竞品分析 / 我的沉淀

工作动态
  正在进行的工作 / 最近活动
```

### 3.3 常用入口

第一期只保留以下四个真实入口：

| ID | 名称 | 路由 | 说明 |
| --- | --- | --- | --- |
| `ai-chat` | AI 助手 | `/ai-agent` | 进入 AI 对话工作台 |
| `quick-navigation` | 快捷导航 | `/quick-navigation` | 搜索和访问外部工具 |
| `competitor` | 竞品分析 | `/competitor-analysis` | 进行 ASIN、品牌或店铺分析 |
| `my-notes` | 我的沉淀 | `/ai-agent/notes` | 查看个人知识沉淀 |

不展示没有路由或没有真实数据支撑的“即将上线”入口。

## 4. 页面视觉和交互要求

### 4.1 欢迎区

- 使用现有页面标题样式：`text-2xl font-bold tracking-tight`；
- 描述文字使用 `text-muted-foreground`；
- 保持紧凑高度，不做旧版大面积空白 Hero；
- 不放经营指标、收入、订阅等伪数据。

### 4.2 常用入口卡片

- 桌面端四列，平板端两列，移动端一列；
- 卡片高度统一、内容紧凑，图标、名称、说明三层结构；
- 卡片整体可点击，图标使用 `lucide-react`；
- 保留拖拽排序，但拖拽只改变四个真实入口的顺序；
- 拖拽排序需要保留键盘/屏幕阅读器可理解的顺序，不把“拖拽”作为唯一操作方式；
- 保存失败时保留本地当前顺序并提示，不静默丢失。

### 4.3 工作动态

建议桌面端采用 7:5 或 3:2 的左右比例，不再使用两个完全等宽的大空卡片：

- 左侧「正在进行的工作」：优先展示未完成工作，包含模块、标题、进度条和进入按钮；
- 右侧「最近活动」：优先展示最近竞品分析，后续可扩展 AI 对话或个人沉淀；
- 移动端自动纵向排列；
- 没有数据时使用明确空态，不隐藏区域，也不生成虚假内容。

### 4.4 状态处理

- 查询中：标题区可保留，卡片和列表使用 `Skeleton`；
- 查询失败：显示可重试提示和“重新加载”按钮；
- 空数据：使用已有项目风格的 `text-muted-foreground` 空态文案；
- 保存快捷入口失败：toast 提示，并允许继续访问页面。

## 5. 数据和兼容策略

### 5.1 服务端默认快捷入口

修改 `server/index.mjs` 中 `/api/dashboard` 的默认 `shortcutIds`：

```js
['ai-chat', 'quick-navigation', 'competitor', 'my-notes']
```

不修改数据库表结构，不删除既有用户偏好。

### 5.2 旧偏好兼容

历史用户可能已经保存了 `project/listing/reviews`。前端或服务端必须做归一化：

1. 丢弃不再支持的 ID；
2. 保留仍然有效的 ID 原有顺序；
3. 将缺失的新入口按默认顺序追加；
4. 保证最终至少返回四个有效入口；
5. 不因为旧偏好导致首页只剩一个竞品分析入口。

推荐新增纯函数：

```text
normalizeShortcutIds(savedIds) -> validShortcutIds
```

该函数放在 `src/features/dashboard/` 内，并单独测试。

### 5.3 API 数据范围

第一期继续复用现有 `/api/dashboard`：

- `workItems`：只返回当前用户未完成工作；
- `shortcutIds`：当前用户快捷入口顺序；
- `analyses`：当前用户最近竞品分析。

第一期不新增首页专用统计 API，不把 AI 治理统计混入 `/api/dashboard`。如果未来增加最近 AI 对话或个人沉淀，应新增明确字段并保持向下兼容。

## 6. 推荐文件改动

### 必改

- `src/features/dashboard/index.tsx`
  - 重写为可维护的分区组件结构；
  - 替换快捷入口定义；
  - 增加 loading/error/empty 状态；
  - 调整工作动态布局；
  - 保留已有 API 和拖拽排序能力。

- `server/index.mjs`
  - 更新首页默认快捷 ID；
  - 只做默认值和兼容处理，不修改其他接口行为。

- `src/features/dashboard/` 下新增测试文件
  - 测试快捷入口归一化和旧偏好兼容。

### 视实现需要修改

- `src/features/dashboard/types.ts`
  - 抽取 `DashboardData`、`DashboardWorkItem`、`DashboardAnalysis`、`DashboardShortcut` 类型；

- `src/features/dashboard/shortcuts.ts`
  - 集中维护四个真实入口和归一化逻辑；

- `docs/modules/仪表盘.md`
  - 实现完成后更新功能清单、影响范围和历史变更。

### 禁止修改

- `src/components/ui/**`；
- 登录和认证流程；
- `src/features/ai-agent/` 的业务逻辑；
- 数据库表结构；
- AI 治理后台页面和服务端接口；
- 与首页无关的快捷导航管理逻辑。

## 7. 实施任务

### Task 1：抽取首页数据类型和快捷入口契约

文件：

- `src/features/dashboard/types.ts`
- `src/features/dashboard/shortcuts.ts`
- `src/features/dashboard/*test*`

内容：

- 定义四个真实快捷入口；
- 实现 `normalizeShortcutIds`；
- 处理空数组、未知 ID、重复 ID、旧 ID 和缺失新 ID；
- 保证归一化结果顺序稳定。

验证：

```bash
pnpm exec vitest run src/features/dashboard
```

### Task 2：更新服务端首页默认值

文件：

- `server/index.mjs`
- 如有服务端测试则同步更新测试

内容：

- 更新 `/api/dashboard` 默认快捷入口；
- 不覆盖用户已经保存的有效排序；
- 旧 ID 由归一化逻辑兼容处理。

验证：

```bash
pnpm run test:server
```

### Task 3：首页组件化重构

文件：

- `src/features/dashboard/index.tsx`

建议拆分为：

- `DashboardHeader`
- `ShortcutSection`
- `ShortcutCard`
- `WorkItemsCard`
- `RecentActivityCard`
- `DashboardEmpty`

要求：

- 不改变 `/api/dashboard` 和 `/api/dashboard/shortcuts` 路径；
- 使用 React 函数组件和 TypeScript；
- API 请求仍通过项目现有 `api` 客户端；
- 不使用 `console`；
- 主题颜色全部使用项目变量；
- 保持 `Header`、`Main`、`Search`、`ThemeSwitch`、`ProfileDropdown`。

验证：

```bash
pnpm run lint
pnpm run build
```

### Task 4：响应式和可访问性验证

检查：

- 1440px 桌面端：四个入口单行展示，工作动态比例合理；
- 1024px 平板端：入口两列，工作动态仍可读；
- 移动端：入口一列，工作动态纵向排列；
- 卡片标题不溢出；
- 图标按钮和拖拽操作有可理解的辅助文案；
- loading/error/empty 状态不导致布局跳动。

## 8. 验收标准

### 信息架构

- 首页只承担工作台职责；
- 首页不出现 AI 治理、知识库、数据源、经验审核、模型配置、审计台内容；
- AI 治理仍通过设置下的管理入口访问；
- 员工和管理员看到的首页结构一致，除非未来明确增加权限相关数据。

### 功能

- 四个常用入口均能正常跳转；
- 用户可调整四个入口顺序；
- 旧用户保存的旧快捷 ID 不会造成空白卡片或入口消失；
- 正在进行的工作仍能继续进入对应页面；
- 最近竞品分析仍能正常展示和跳转；
- 请求失败时可重试；
- 空数据状态清晰，不显示伪数据。

### 视觉

- 首页不再出现“即将上线”卡片；
- 常用入口卡片高度和间距统一；
- 工作动态区域减少无意义留白；
- 主题切换、移动端和侧边栏折叠不回归。

## 9. 最终验证

```bash
pnpm run test:server
pnpm run test
pnpm run lint
pnpm run build
```

实现完成后更新 `docs/modules/仪表盘.md`，记录：首页从占位模块首页调整为真实工作台首页、快捷入口 ID 变化、兼容策略和验证结果。

## 10. 方案边界

本方案不包含：

- 新增首页经营指标；
- 新增 AI 治理统计；
- 新增实时通知中心；
- 新增首页专用后端聚合服务；
- 修改 AI 助手、知识库、经验审核的业务逻辑；
- 删除数据库中的历史快捷入口偏好。

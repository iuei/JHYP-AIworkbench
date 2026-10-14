# 仪表盘内容扩容设计规格

- 日期：2026-09-15
- 责任田：`docs/modules/仪表盘.md`
- 关联模块：竞品分析（`docs/modules/竞品分析.md`）、AI 助手（`docs/modules/AI 助手.md`）

## 背景与问题

用户反馈：**首页内容单薄，首屏没什么可看的**。核实后的根因不是布局问题，而是**数据选择问题**：

1. 首页只有三块内容——常用入口（3 张卡）、我的 AI（最近 3 条对话 + 沉淀计数）、最近活动（最近 5 条竞品分析）。
2. 首页读的 `/api/dashboard` 里，`analyses` 字段只返回 `id`、`input_type`、`input_value`、`created_at`；而同一份数据在竞品分析模块已有富字段摘要（`toHistoryItem`，见 `server/competitor-analysis.mjs:1036-1055`）：`headline`（结论摘要）、`level`（严重度分级）、`findingCount`（问题数）、`marketplace`、`asins`、区间与对比基线。**首页用的是最弱的一套字段。**

   > 说明：`/api/dashboard` 的查询里确实 `SELECT` 了 `created_at`（`server/index.mjs:384`），但它只被透传，首页的 `DashboardAnalysis` 类型（`src/features/dashboard/types.ts:22-26`）未声明该字段，界面也不展示时间。
3. 由此产生两个可观测后果：
   - 「最近活动」看不出时间、看不出严重程度、看不出有几个问题，信息价值接近于零。
   - 用户点任意一条记录都落到 `/competitor-analysis` 通用页，**打不开那一条**，而目标页其实已经有按 id 打开历史快照的能力（`index.tsx:70-85` 的 `snapshot` mutation）。
4. 首页三块内容全部是"看"，没有任何一件可执行的动作，也没有任何"需要注意"的信号。

因此本规格的目标是**把已有但未上首页的真实数据接上来**，并**补上可执行动作**，不引入任何新数据源、不新增服务端接口、不展示任何没有数据支撑的内容。

## 目标

1. 首页首个可见区域提供 3 个**带上下文的动作**（不是纯跳转，每个都真正减少用户操作步骤）。
2. 把「需立即处理」的分析结论提到首屏可见位置，并可一键打开该条快照。
3. 把「最近分析」从弱字段升级为富字段（时间、站点、结论摘要、严重度、问题数），并可打开该条记录。
4. 让「最近对话」可以**直接进入那个会话**，而不是只跳到 AI 助手首页。
5. 全程只消费已有接口。

## 非目标

- 不新增服务端接口或聚合接口（服务端零改动）。
- 不新增 ASIN 清单、产品开发等分区（本轮明确不做）。
- 不做管理员/员工差异化的首页分版。
- 不改常用入口的排序机制、契约与归一化逻辑。
- 不动 `Header` / `Main` / 侧边栏 / 全局布局。

## 变更概览

| # | 变更 | 涉及文件 | 服务端改动 |
| --- | --- | --- | --- |
| 1 | 新增主操作条 | `src/features/dashboard/action-bar.tsx`（新）、`index.tsx` | 无 |
| 2 | 新增「需处理的分析」 | `analyses.ts`（新）、`analyses-cards.tsx`（新）、`index.tsx` | 无 |
| 3 | 「最近活动」升级为「最近分析」 | `analyses-cards.tsx`（新）、`index.tsx` | 无 |
| 4 | 最近对话可续 | `my-ai-card.tsx`、`ai-agent/index.tsx`、`chat-workbench.tsx` | 无 |
| 5 | 分析记录可打开 | `competitor-analysis.tsx`、`competitor-analysis/index.tsx` | 无 |
| 6 | 排序保存失效范围修正 | `index.tsx` | 无 |

## 首页结构

新顺序（自上而下）：

| 顺序 | 分区 | 变化 |
| --- | --- | --- |
| 1 | 主操作条 | 新增 |
| 2 | 常用入口（3 张可排序卡） | 不变 |
| 3 | 需处理的分析 | 新增 |
| 4 | 动态（桌面 7:5 分栏）：最近分析 + 我的 AI | 字段与链接升级 |

顺序理由：先"开始做事"，再"我的入口"，再"需要注意的事"，最后"近期动态"。需处理为空时展示明确空态（不隐藏区域），不影响首屏前两块。

## 主操作条

三个动作，全部为 `Link` + 按钮样式，不自造按钮组件：

| 动作 | 目标 | 增量（相对常用入口卡） |
| --- | --- | --- |
| 继续上次分析 | `/competitor-analysis?analysisId=<最近一条 id>` | 省去"进页面 → 找历史 → 点开"三步 |
| 新建分析 | `/competitor-analysis?focus=asin` | 进场即聚焦 ASIN 输入框，省一次点击 |
| 问 AI | `/ai-agent?focus=composer` | 进场即聚焦输入框，省一次点击 |

规则：

- 「继续上次分析」**仅在有历史记录时渲染**；没有记录时该位置渲染"新建分析"作为唯一主操作（不渲染一个点了没反应的按钮）。
- 主操作条数据源是第 3 节那次分析查询的结果（取第一条），不额外发请求。
- 明确**不做**「分析我的 ASIN」动作：ASIN 清单页本来就默认选中第一个清单（`src/features/asin-watchlist/index.tsx:46` 的 `selectedId ?? list[0]?.id`），纯跳转与常用入口卡重复，属于"看起来有用"的假动作。
- 主操作条不引入新的数据依赖，页面加载中（分析查询 pending）时只渲染"新建分析"与"问 AI"两个不依赖数据的动作，避免骨架抖动。

## 数据契约

### 1. 新增一次查询，供两个分区共用

- 调用现有的 `fetchAnalysisHistory(20)`（`src/features/competitor-analysis/api.ts:37`），服务端 `limit` 上限为 50（`server/competitor-analysis.mjs:1004-1015`），20 合法。
- **query key 必须是 `['dashboard', 'recent-analyses']`。**

  > 关键约束：不能复用竞品分析页的 `['competitor-analyses']`。那边 `queryFn` 是 `fetchAnalysisHistory(10)`（`src/features/competitor-analysis/index.tsx:54-57`），React Query 同 key 共享缓存，两个页面会互相覆盖对方的条数，表现为"首页有时显示 20 条、有时显示 10 条"。
- 返回类型复用竞品分析模块已有的 `HistoryItem`（`src/features/competitor-analysis/types.ts`），不新造类型、不做字段改名。
- 复用查询数据的前端形态：`fetchAnalysisHistory` 是跨模块导入（`@/features/competitor-analysis/api`）。仓库已有同类先例（`my-ai-card.tsx` 导入 `@/features/ai-agent/format`），并在责任田中登记该依赖。

### 2. 「需处理的分析」口径

- 取这次查询结果中 `level === 'high'` 的记录，最多展示 3 条，按 `createdAt` 倒序（服务端已倒序，前端保持顺序）。
- 展示字段：`inputValue`（截断）、`headline`（结论摘要）、`marketplace`、`findingCount`、`createdAt`（相对时间）、严重度徽章。
- 严重度文案与样式复用竞品分析模块的 `FINDING_LEVEL_LABELS` / `FINDING_LEVEL_VARIANTS`（`src/features/competitor-analysis/format.ts`），不另写一套映射：`high` 的文案是「需立即处理」。
- 每条点击进入 `/competitor-analysis?analysisId=<id>`。
- **筛选范围必须对用户可见**：卡片描述写明"来自最近 20 次分析"，避免用户把"范围内没有"误解为"全库没有"。

### 3. 空态口径（两种，不能混用）

| 情况 | 文案 |
| --- | --- |
| 有分析记录，但 20 条内没有 `level='high'` | 「最近 20 次分析里没有需要立即处理的问题」 |
| 一条分析记录都没有 | 「还没有分析记录，从上面的「新建分析」开始」 |

两条都必须是"明确空态且不隐藏区域"，与现有 `DashboardEmpty` 口径一致。

### 4. 不再消费的字段

- `/api/dashboard` 的 `analyses` 首页**不再读取**（由第 1 节的查询取代）。服务端字段保留，理由与 `workItems` 相同：不破坏既有响应契约。
- `src/features/dashboard/types.ts` 的 `DashboardAnalysis` 类型一并删除（无消费者），`DashboardData` 只保留 `shortcutIds`。若服务端响应里仍有 `analyses`，前端类型忽略即可。

### 5. 排序保存的失效范围修正

`src/features/dashboard/index.tsx:46` 现在是 `invalidateQueries({ queryKey: ['dashboard'] })`，前缀匹配会连带刷新 `['dashboard', 'recent-analyses']` 与 `my-ai-card.tsx` 的三个 `['dashboard', ...]` 查询——每拖动一次入口就多发 4 个请求。

修正为 `{ queryKey: ['dashboard'], exact: true }`：排序保存后只刷新入口顺序本身。AI 卡片与分析卡片的数据与入口顺序无关，不需要跟着刷新。

## 深链契约

### 1. `/competitor-analysis?analysisId=<id>`

- 路由文件 `src/routes/_authenticated/competitor-analysis.tsx` 新增 `validateSearch`，类型 `{ analysisId?: number }`。
- 页面 `src/features/competitor-analysis/index.tsx` 用 `useSearch({ from: '/_authenticated/competitor-analysis' })` 读取，按仓库既有写法（`src/features/ai-agent/pages/prompt-square.tsx:76` 的 `useSearch({ from: ... })`）。
- 首屏若带合法 `analysisId`，触发**已有的** `snapshot` mutation（`index.tsx:70-85`）：它已经处理了"记录无快照"的 toast、`setResult`、`setFromHistory(true)`、`setActiveId` 与滚动到结果，不需要新逻辑。
- 只触发一次：用 `useRef` 记录已处理的 id，避免 StrictMode 双调用与重新渲染重复请求。
- 记录不存在或不属于本人：服务端返回 404，沿用现有 `apiErrorMessage` toast（「回看这条分析失败，请稍后重试。」），页面保持空态可正常使用。

### 2. `/ai-agent?conversationId=<id>`

- 路由文件 `src/routes/_authenticated/ai-agent/index.tsx` 新增 `validateSearch`，类型 `{ conversationId?: number }`（只作用于 `/ai-agent` 本身，不影响 `notes`、`asin-watchlists` 等子路由）。
- 工作台 `chat-workbench.tsx`：
  - `activeId` 初始值改为 search 参数（`useState<number | null>(params.conversationId ?? null)`，现为 `:88`）。
  - 初始化时同步 `conversationIdRef.current`（`:107`），语义与现有 `onSelect`（`:389-393`）一致：设置 id、清空 `stream`。消息列表本来由 `activeId` 驱动（`['ai','messages',conversationId]`），无需额外拉取。
- 会话不存在/不属于本人：消息查询失败时沿用现有失败态，不新增白屏路径。

### 3. `focus` 参数

| 目标 | 参数 | 聚焦元素 |
| --- | --- | --- |
| 竞品分析表单 | `?focus=asin` | `<Textarea id='competitor-asin'>`（`components/analysis-form.tsx:68`） |
| AI 助手输入框 | `?focus=composer` | `promptTextareaRef`（`chat-workbench.tsx:109`、`:579`） |

- 聚焦在挂载后执行一次（`useEffect` + `requestAnimationFrame` 或直接 ref），不改变原有 `autoFocus` 行为，不滚动页面。
- 参数为**可选**，缺省时行为与改造前完全一致。

### 4. 参数健壮性（统一要求）

`validateSearch` 必须容忍脏值：`analysisId` / `conversationId` 非正整数、`focus` 非枚举值时一律**忽略该参数**（回落到普通 `/competitor-analysis`、`/ai-agent` 行为），不抛错、不白屏。旧链接（无参数）行为不变。

## 组件拆分

沿用 `my-ai-card.tsx` 的既有先例（自身打接口或自身承载一块内容就独立成文件，避免 `index.tsx` 继续膨胀）：

| 文件 | 职责 |
| --- | --- |
| `src/features/dashboard/action-bar.tsx` | 主操作条；纯展示，接收"是否有历史记录 + 最近一条 id" |
| `src/features/dashboard/analyses.ts` | 纯函数：筛 `high`、截断条数、相对时间格式化；可单测（对齐 `shortcuts.ts` 的做法） |

相对时间格式（在 `analyses.ts` 内实现，**按浏览器本地时区计算**，不得使用 `toISOString().slice(0,10)` 这类 UTC 切片写法——东八区会整体早一天）：

| 距今 | 显示 |
| --- | --- |
| < 1 分钟 | 刚刚 |
| < 1 小时 | N 分钟前 |
| < 24 小时 | N 小时前 |
| < 7 天 | N 天前 |
| ≥ 7 天或时间无法解析 | 本地 `YYYY-MM-DD`（无法解析时显示「未知」） |
| `src/features/dashboard/analyses-cards.tsx` | `AttentionCard`（需处理）与 `RecentAnalysesCard`（最近分析）两个卡片组件 |
| `src/features/dashboard/index.tsx` | 查询编排 + 布局；保留既有 `ShortcutSection` / `ShortcutCard` / `DashboardEmpty` / `DashboardRetry` |

`index.tsx` 只多做两件事：发起第 1 节的查询、把结果分发给两个卡片。

## 状态与降级

- 主操作条：无数据依赖，始终可用（"继续上次分析"仅在数据到位且有记录时出现）。
- 需处理 + 最近分析：**同源一次查询**，因此同一份 loading / error 状态。
  - loading：两块各自渲染骨架，高度与真实行高对齐，避免加载完成时首屏跳动——需处理区 `1 × h-20`，最近分析区 `3 × h-16`（间距 `space-y-2`）。
  - error：两块共用一个卡片级错误提示 + 「重试」按钮（复用 `DashboardRetry` 的按钮样式与文案口径）。这是**设计内的联动降级**，不是两个独立缺陷。
  - 成功后：需处理为空按第 3 节两种空态区分；最近分析为空沿用现有文案。
- 我的 AI：保持现有三查询与降级文案不变，仅改对话链接。

## 测试与验证

前端测试（`src/features/dashboard/index.test.tsx`）：

1. mock 需新增 `/competitor-analyses`（首页现在共打 5 个请求：`/dashboard`、`/competitor-analyses`、`/ai/conversations`、`/ai/notes` ×2），断言更新。
2. 需处理只取 `level === 'high'`：给 `medium` 记录断言其**不出现**在需处理区。
3. 需处理为空（有分析但无 high）→ 展示范围文案「最近 20 次分析里没有需要立即处理的问题」。
4. 无任何分析记录 → 展示「还没有分析记录…」，且主操作条不渲染「继续上次分析」。
5. 点击需处理条目 / 最近分析条目 → 链接指向 `/competitor-analysis?analysisId=<id>`。
6. 点击最近对话条目 → 链接指向 `/ai-agent?conversationId=<id>`。
7. 主操作条「新建分析」→ `/competitor-analysis?focus=asin`；「问 AI」→ `/ai-agent?focus=composer`。
8. 保留既有守护断言：三个入口、无 h1 横幅、无治理面词汇、无横向溢出、响应式列数。

新增/扩展测试：

- `src/features/competitor-analysis/`：`analysisId` 合法时触发快照加载；非法值（`abc`、`-1`、`1.5`）被忽略且页面正常。
- `src/features/ai-agent/`：`conversationId` 合法时选中该会话；`focus=composer` 时输入框获得焦点（或断言 ref 聚焦被调用）。
- `analyses.ts` 纯函数单测：筛选、截断、脏数据（`level` 缺失、`headline` 为 null）。

验证命令：`pnpm run lint`、`pnpm run build`、仪表盘/竞品分析/AI 助手三个模块的测试（`pnpm run test` 缺 Playwright Chromium 时按 `docs/用户信息只读化-交接文档.md` 的环境备忘替代）。服务端未改动，但仍按责任田要求跑 `pnpm run test:server` 确认无回归。

文档：更新 `docs/modules/仪表盘.md`（功能清单、API 明细、依赖关系、修改边界、历史变更）、`docs/modules/竞品分析.md` 与 `docs/modules/AI 助手.md`（新增 search 参数说明）。

## 影响范围与兼容性

| 项 | 结论 |
| --- | --- |
| 服务端 | 零改动；`/api/dashboard` 的 `analyses`、`workItems` 字段保留 |
| 路由 | 新增可选 search 参数，旧链接（无参数）行为完全不变 |
| 跨模块依赖 | 新增 仪表盘 → `competitor-analysis/api`（取历史）与 `competitor-analysis/format`（严重度文案）；已有同类先例 |
| 首页首屏 | 信息结构变化，影响所有角色的登录落地页；需桌面 + 窄屏各验一次 |
| 权限 | 不涉及。所用接口均为员工可读（`/api/competitor-analyses` 为 `requireUser`，越权按 404 处理） |
| 数据一致性 | 首页与竞品分析页读同一份记录，条数/字段口径以服务端 `toHistoryItem` 为唯一来源 |

## 实施顺序

1. `analyses.ts` 纯函数 + 单测（无 UI 依赖，先把口径固定）。
2. `action-bar.tsx` + `analyses-cards.tsx` + `index.tsx` 编排与查询、`types.ts` 清理、失效范围修正。
3. 竞品分析 `analysisId` 深链（含非法值处理）。
4. AI 助手 `conversationId` + `focus` 深链，竞品分析 `focus`。
5. `my-ai-card.tsx` 对话链接改造。
6. 测试补齐、责任田文档更新、`lint` / `build` / 测试全跑。

## 明确不做

- 服务端聚合接口（`/api/dashboard/overview`）、ASIN 清单与产品开发分区、角色分版首页。
- 「分析我的 ASIN」动作（无增量，见主操作条一节）。
- 对 `/api/dashboard` 响应做减字段（保留契约，避免影响未知消费者）。
- 首页时间显示的时区口径在 `analyses.ts` 内按本地时区实现；**不在本规格内修改** `src/features/ai-agent/format.ts` 的 `formatDate`（其 UTC 切片问题影响 AI 助手模块多处展示，属该模块的独立改动，另行处理）。

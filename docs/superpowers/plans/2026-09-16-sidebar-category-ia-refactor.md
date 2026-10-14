# 侧边栏一级 / 二级类目归类重排 实施计划

> **Goal:** 让「一级类目 → 二级子页 → 页内视图」三层归类与 URL 层级一致、承载方式统一（侧边栏浮窗与顶栏同一份数据源）、子页入口穷尽可深链，并把治理面收口到单个 `adminOnly` 一级类目。
>
> **Architecture:** 以 `src/components/layout/data/sidebar-data.ts` 的 `navItems` 作为**唯一入口数据源**：一级类目 = 侧边栏项，二级子页 = `navItems[].items`（侧边栏浮窗与顶栏中段导航同源派生），页内视图 = 页内 Tabs + search 参数。URL 层级与导航层级对齐，旧路径一律用既有 `beforeLoad` redirect 模式兼容，不做 404。
>
> **Tech Stack:** React 19、TypeScript、TanStack Router（文件路由 + `validateSearch` + `staticData.title`）、shadcn/ui、Tailwind CSS v4、lucide-react、Vitest Browser、Playwright（`server/*verify*.mjs`）。
>
> **已确认范围（用户选项）：** A→D 全量重排；允许 URL 变更并加旧链接重定向；「我的 ASIN」升为一级类目；产品开发三个页签升为显式二级子页 + 独立路由。

## Global Constraints

- 包管理器统一 `pnpm`；不新增依赖，不动服务端接口与数据库。
- 不改变 `_authenticated` 路由组结构、主题/字体 Provider 装配顺序、基础 shadcn/ui 组件实现。
- 页面不得自己渲染 `Header`；页面级操作走 `HeaderSlot`。
- 一级类目命名与顺序变更必须同步 `docs/modules/全局布局与导航.md` 的「当前一级类目清单」。
- 新增页面必须声明 `staticData: { title: '页面名' }`；模块布局按路径分流顶栏导航时一并声明，避免顶栏标题与导航自相矛盾。
- 普通账号**不得**看到任何治理入口；`nav-filter.ts` 的 `adminOnly` 语义不变。
- 每阶段结束必须：`pnpm run lint`、`npx tsc -b`、`pnpm run build`、相关 vitest（`--config vitest.chrome.config.ts`）与受影响 verify 脚本全绿。

---

## 一、现状（事实基线，2026-09-16）

### 1.1 一级类目与二级子页

| # | 一级类目 | 形态 | 二级子页 | 子页承载方式 | 隐藏子页 |
| --- | --- | --- | --- | --- | --- |
| 1 | 仪表盘 `/` | 叶子 | — | — | — |
| 2 | AI 助手 | 折叠（不直达） | 对话 `/ai-agent`、我的 ASIN `/ai-agent/asin-watchlists`、我的沉淀 `/ai-agent/notes` | 侧边栏浮窗 **+ 顶栏 `AgentNav`（同一份 3 项重复）** | — |
| 3 | 提示词广场 `/ai-agent/prompts` | 叶子（一级类目 + 二级路径） | 我的提示词 / 共享提示词 | 顶栏 `PromptSquareNav` + `?view=shared` | — |
| 4 | 竞品分析 `/competitor-analysis` | 叶子 | 分析表单 / 结论 / 历史 | 无导航（纵向堆叠） | 「历史」无入口表达 |
| 5 | 产品开发 `/product-dev` | 叶子 | 候选池 / 对比与历史 / 市场调研 | 页内 Tabs + `?view=market` | 3 个子页在侧边栏、顶栏、命令菜单均不可见 |
| 6 | 任务中心 `/task-center` | 占位叶子 | — | — | — |
| 7 | 设置 | 折叠（不直达） | 用户管理 `/settings/users`、公告管理 `/settings/announcements`、AI 治理 `/admin/ai`（`matchPrefix`） | 侧边栏浮窗；AI 治理另有顶栏 `AdminAiNav` 5 项 | 用户信息 `/settings` 无侧边栏归类 |
| 2b | 我的 ASIN 页内 | — | 表现分析 / 清单管理 | 页内 Tabs，**`useState` 未落 URL**（刷新丢失） | 2 个视图不可见 |

### 1.2 问题诊断

| 级别 | 问题 | 证据 |
| --- | --- | --- |
| P0 | 导航层级 ≠ URL 层级 | 提示词广场（一级）在 `/ai-agent/prompts`；「设置 → AI 治理」（二级）在另一一级路径 `/admin/ai/*` |
| P0 | 「设置」名下混装四种性质 | 个人（`/settings` 用户信息）、治理（用户管理）、运营（公告管理）、AI 治理，同处 `sidebar-data.ts:100-125` |
| P0 | 一级类目下混装独立业务模块 | `src/features/asin-watchlist/` 自带 api/hooks/导入/表格，不以 AI 为前提，却挂在「AI 助手」下 |
| P1 | 二级子页存在三种承载方式 | 侧边栏浮窗 / 顶栏中段 / 页内 Tabs，同类页面选法不一 |
| P1 | 同一份二级导航维护两遍 | `sidebar-data.ts:42-60` 与 `agent-nav.tsx:17-31` 字面重复 |
| P1 | 实质二级子页按页内视图承载 → 入口穷尽性缺失 | 市场调研是独立成果（竞品分析页专程跳转），却是第 3 个页签；`command-menu.tsx` 只遍历 `sidebarData`，搜不到 |
| P2 | 「历史」概念重名 | 竞品分析 `history-panel.tsx` vs 产品开发 `comparison-history.tsx` |
| P2 | 状态不落 URL | `asin-watchlist/index.tsx:40` 的 `WorkspaceTab` 用 `useState` 而非 search 参数（刷新丢失） |
| P2 | 入口职责重叠 | 首页 `dashboard/shortcuts.ts` 3 项与侧边栏重复；「AI 助手」需点两次才到对话页 |

---

## 二、归类规则（本次固化为项目口径）

1. **一级类目判据**：「独立受众 / 独立数据对象 / 独立使用时机 / 需深链分享」满足 ≥2 条 → 可做一级类目。
2. **二级子页判据**：与兄弟页是**不同对象或不同任务** → 二级子页，**必须独立路由**（可高亮、可深链、可被命令菜单搜到）。
3. **页内视图判据**：只是**同一页面的取数范围 / 筛选** → 页内 Tabs + search，且**必须落 URL**。
4. **入口唯一**：侧边栏管「功能在哪」，顶栏管「同级切换」；两者**同源**（由 `navItems[].items` 派生），不再各写一份。
5. **URL 层级 = 导航层级**：一级类目 = 一级路径段，二级子页 = 二级路径段。
6. **治理面收口**：管理员治理项统一挂在一个 `adminOnly` 一级类目下，不与业务类目平铺。

---

## 三、目标结构与归类映射

### 3.1 重排后结构

```
仪表盘            /
AI 助手           对话 /ai-agent ｜ 我的沉淀 /ai-agent/notes
我的 ASIN         /asin-watchlists         ← 由「AI 助手」下升级为一级；页内 表现分析 ｜ 清单管理（落 URL）
提示词广场        /prompts                 ← 路径规范化；页内 我的提示词 ｜ 共享提示词
竞品分析          /competitor-analysis
产品开发          候选池 /product-dev ｜ 对比与历史 /product-dev/compare ｜ 市场调研 /product-dev/market
任务中心          /task-center             （占位，badge「开发中」）
系统管理（admin）  用户管理 /admin/users ｜ 公告管理 /admin/announcements ｜ AI 治理 /admin/ai（→ 5 子页）
个人：用户信息 /settings —— 头像菜单 + 侧边栏底部，不进 navItems（边界写明，现状保留）
```

### 3.2 归类映射表（before → after）

| 页面 | 现状归属 | 现状 URL | 目标归属 | 目标 URL | 变更类型 |
| --- | --- | --- | --- | --- | --- |
| 对话工作台 | AI 助手 → 对话 | `/ai-agent` | 不变 | 不变 | 保留 |
| 我的沉淀 | AI 助手 → 我的沉淀 | `/ai-agent/notes` | 不变 | 不变 | 保留 |
| ASIN 清单 | AI 助手 → 我的 ASIN | `/ai-agent/asin-watchlists` | **一级类目「我的 ASIN」** | `/asin-watchlists` | 升级 + 路径迁移 |
| 提示词广场 | 一级类目 | `/ai-agent/prompts` | 不变（一级） | `/prompts` | 路径规范化 |
| 竞品分析 | 一级类目 | `/competitor-analysis` | 不变 | 不变 | 保留 |
| 候选池 | 产品开发页内页签 | `/product-dev?view=pool` | 产品开发 → 子页 | `/product-dev` | 子页显式化 + 独立路由 |
| 对比与历史 | 产品开发页内页签 | `/product-dev?view=compare` | 产品开发 → 子页 | `/product-dev/compare` | 子页显式化 + 独立路由 |
| 市场调研 | 产品开发页内页签 | `/product-dev?view=market` | 产品开发 → 子页 | `/product-dev/market` | 子页显式化 + 独立路由 |
| 任务中心 | 一级类目（占位） | `/task-center` | 不变 | 不变 | 保留 |
| 用户管理 | 设置 → | `/settings/users` | **系统管理 →** | `/admin/users` | 改归属 + 路径 |
| 公告管理 | 设置 → | `/settings/announcements` | **系统管理 →** | `/admin/announcements` | 改归属 + 路径 |
| AI 治理（5 子页） | 设置 →（`matchPrefix`） | `/admin/ai/*` | **系统管理 →** | 不变 | 改归属 |
| 用户信息（个人） | 无侧边栏归类 | `/settings` | 个人入口（头像 / 侧边栏底部） | 不变 | 边界明确 |

### 3.3 承载方式统一

| 层级 | 用途 | 唯一载体 | 数据源 |
| --- | --- | --- | --- |
| L1 一级类目 | 功能地图 | 侧边栏 | `sidebar-data.ts` 的 `navItems` |
| L2 二级子页 | 类目内页面切换 | 侧边栏浮窗 **+** 顶栏中段（同一份） | `navItems[].items` 派生 |
| L3 页内视图 | 同页取数范围 | 页内 Tabs + search（必落 URL） | 页面自身 |

---

## 四、分阶段任务

### 阶段 A：导航数据源统一与状态落地（零路由变更）— **已完成 2026-09-16**

- [x] A1 新增 `src/components/layout/nav-children.ts`：导出纯函数 `findNavChildren(navItems, parentTitle)`，返回该类目的子项（含标题 / url / 图标），便于复用与单测。
- [x] A2 `agent-nav.tsx` 改为从 `sidebarData` 派生「AI 助手」子项（删除 `baseItems` 字面数组），保留 `toolCount` / `demoMode` 徽标与精确路径高亮；`layout.tsx` 调用点不变。
- [x] A3 把 `admin-ai-nav.tsx` 的 `ADMIN_ITEMS` 移到导航数据层（`sidebar-data.ts` 同文件的具名导出 `adminAiNavItems`），`AdminAiNav` 与命令菜单共用，消灭第二份字面数组。
- [x] A4 我的 ASIN 视图落 URL：`src/routes/_authenticated/ai-agent/asin-watchlists.tsx` 加 `validateSearch`（`tab=items`），`asin-watchlist/index.tsx` 的 `useState` 改为读 search；**保留「未指定 = 按清单是否为空自动选择」语义**，脏值回落自动。
- [x] A5 验收：`nav-group.test.tsx`、`asin-watchlist` 相关测试、`server/ai-agent/verify-ui.mjs` 的侧边栏 / 模块导航断言同步并通过。

**阶段 A 实际执行记录（2026-09-16）**

- **A4 的落地形态与计划略有出入（更好）**：search 参数名用 `view`（与提示词广场口径一致），并且**两个值都显式落参数**（不把默认视图留空）—— 组件必须区分"显式选了分析"与"还没选过"，否则空清单下点「一键分析」会被自动视图顶回「商品明细」。页面改为接收 `view` / `onViewChange` **props**（不依赖路由、可独立渲染与测试），URL ↔ props 桥接写在路由文件里（该文件因此除 `Route` 外有一个内部组件，带 `eslint-disable react-refresh/only-export-components` 与理由注释）。
- **验收中抓到一个真实缺陷并修掉**：`?view=bogus` 这类脏值会原样透进受控 Tabs 的 `value`，导致两个选项卡**都没有选中态**（实测 tab 数量 2、`aria-selected` 全 false）。修在组件层（对注入视图再做一次白名单校验），不再只依赖路由的 `validateSearch`。
- **新增验收脚本** `server/verify-nav-ia.mjs`（系统 Chrome，跑在用户的 5173 + 8787 与独立实例 5211 上各一次）：**15/15**。
- **验收结果**：`nav-children.test.ts` 4/4、`nav-group.test.tsx` 3/3、布局 + 仪表盘 68/68、前端全量 **253/255**（2 项为既有 `auth-layout`）、`lint` / `tsc -b` / `build` 全绿。
- **未做（按计划留到后续阶段）**：A6（「AI 助手」类目点击直达对话 + 浮窗仍出子项）保持默认不做。

> **A6（可选，默认不做）** 「AI 助手」类目点击直达 `/ai-agent` 且浮窗仍出子项。需改 `NavCollapsible` 类型（增加可选 `url`）并触碰 `nav-group.tsx` 的 `CLOSE_GUARD` 关闭保护逻辑，会危及已验收的浮窗行为，**单独一轮评估**。

### 阶段 B：产品开发子页显式化（独立路由）

> **执行前技术核查（2026-09-16 完成，只读）** —— 结论：可拆，主要成本在跨页签状态上提，边界已逐项核实。

**B0 现状边界（已核实）**

- 现有单组件 `src/features/product-dev/index.tsx`（642 行）内三个页签：候选池（`CandidateTable`）、对比与历史（选择候选 + 「开始对比」+ `ComparisonPanel` + `ComparisonHistory`）、市场调研（`MarketResearchPanel`）。
- 组件接口已隔离，拆分成本低：`MarketResearchPanel` 只吃 `initialKeyword` / `initialMarketplace`（其余状态自包含，**可直接独立成页**）；`ComparisonPanel` 吃 `result` / `fromHistory`；`ComparisonHistory` 吃列表与回调；`CandidateTable` 吃列表、分页与选择集合。
- `?view=market` 的引用面**只有三处**（比预想小）：竞品分析页跳转（`competitor-analysis/index.tsx:251`）、本页路由 `validateSearch`、端到端断言（`server/verify-market-research-ui.mjs:76` 的 `page.url().includes('view=market')`）。

**B0.1 跨页签状态上提清单（必须上提，否则切页签即丢）**

| 状态 | 用途 | 处置 |
| --- | --- | --- |
| `selected: Map<number, Candidate>` + toggle/clear | 候选选择；「已选 N」徽标当前挂在 TabsTrigger 上，拆路由后要挂到顶栏导航项 | **上提** |
| `result: ComparisonResult \| null`、`fromHistory`、`activeComparisonId` | 对比结果：从候选池发起后要能在对比页看到，切走再回不能丢 | **上提** |
| `windowKey` / `startDate` / `endDate` | 对比参数，候选池侧与对比页共用 | **上提** |
| `candidates` / `history` 两个 `useQuery` | 各自页面自己拉即可 —— **React Query 缓存共享**，切页签不产生重复请求 | 不上提 |
| keyword / queryKeyword / marketplace / stage / page、各弹窗开关、`saveCandidate` / `removeCandidate` / `comparison` / `snapshot` / `removeComparison` 等 mutation | 只在单个页签内使用 | 不上提 |

上提载体二选一（**推荐前者**）：① `ProductDevLayout` 的 React context（`useState` + Outlet 传递，生命周期与路由一致，离开模块即释放，无新依赖）；② `src/stores/` 的 zustand（离开模块再回来仍保留，但要自己处理清理与旧值污染）。

**B0.2 路由与重定向落点**

- 目录：`src/routes/_authenticated/product-dev/route.tsx`（`ProductDevLayout`：`HeaderSlot` 注入 `ProductDevNav` + `Main` + `Outlet`，`staticData.title: '产品开发'`）、`index.tsx`（候选池）、`compare.tsx`、`market.tsx`（保留 `keyword` / `marketplace` 的 `validateSearch`）。
- 旧链接兼容放在**候选池路由（`product-dev/index.tsx`）的 `beforeLoad`**：读 `location.search.view`，`compare` → `/product-dev/compare`、`market` → `/product-dev/market`（透传 `keyword` / `marketplace`），无 view 或 `pool` 照常渲染 —— 只有落到候选池时才需要判断，比在 layout 层读 search 更精准。
- 竞品分析页跳转改为 `to: '/product-dev/market'` + `search: { keyword, marketplace }`；`server/verify-market-research-ui.mjs:76` 断言同步改为路径判断。

- [x] B1 拆路由目录（四个文件），`ProductDevLayout` 承担 Header 槽位与跨页签状态注入。
- [x] B2 按 B0.1 上提状态（推荐 React context），对比结果与已选集合**切页签不丢**。
- [x] B3 新增 `src/features/product-dev/components/product-dev-nav.tsx`（顶栏中段，三项，与侧边栏子项同源），「对比与历史」项承接「已选 N」徽标；按精确路径高亮。
- [x] B4 `sidebar-data.ts` 的「产品开发」由叶子改为折叠项，`items` 指向三个新路径；`matchPrefix` 只用于候选池入口。
- [x] B5 旧链接兼容按 B0.2 落点实现；竞品分析跳转与 `verify-market-research-ui.mjs` 同步。
- [x] B6 验收：`server/verify-market-research-ui.mjs`、`product-dev.node-test.mjs` 全绿；实测三页签切换后选择与对比结果不丢、深链可分享、刷新不回落；新增/扩充 `verify-nav-ia.mjs` 覆盖三条子页路径与侧边栏浮窗一致性；同步 `docs/modules/产品开发.md`（功能清单「出口」段与历史变更）与 `docs/modules/竞品分析.md`（跳转口径）。

**阶段 B 实际执行记录（2026-09-16）**

- **状态载体**：按用户选项用 `ProductDevLayout` + `dev-context.ts`（`useProductDev()`）的 React context，不上 zustand —— 生命周期与 `/product-dev` 一致，离开模块即释放，无旧值污染。
- **落地文件**：路由 `product-dev/{route,index,compare,market}.tsx`（旧 `product-dev.tsx` 已删除）；页面 `features/product-dev/pages/{layout,pool-page,compare-page,market-page}.tsx`；新增 `constants.ts`、`dev-context.ts`、`components/product-dev-nav.tsx`；`format.ts` 收纳模块共用的 `apiErrorMessage`（同 ASIN 清单的做法）。
- **顺手收紧的两处状态语义（原实现的潜在缺陷）**：① 编辑候选后同步已选集合原来打算用 `toggleSelect` 调两次（"翻转两次"看似等价于替换）——**达到 10 个上限时第二次会被拦下，结果是把已选候选误删**，改为 context 提供 `replaceSelected` / `removeSelected`；② 表头全选改为一次 `setState` 的 `toggleSelectMany`，逐条翻转会在超上限时连弹多次提示。
- **`matchPrefix` 未使用**：折叠类目在子页下由 `checkIsActive` 的"子项命中即父项高亮"自然点亮，B4 里那句"`matchPrefix` 只用于候选池入口"实际不需要（写进这里以免后人照做）。
- **验收结果**：`server/verify-nav-ia.mjs` **26/26**（独立实例 5211 与用户自己的 5173 + 8787 各跑一遍），新增断言覆盖：侧边栏浮窗 3 子页、顶栏与侧边栏逐字一致、`/product-dev/compare` 与 `/product-dev/market` 深链与顶栏高亮、两条旧链接重定向、**跨子页状态不丢**（勾选 → 顶栏徽标 → 切对比页仍带同一候选 → 区间切走再回来仍"近 7 天" → 回候选池勾选仍保持）；候选池为空时脚本会临时创建一条 `__DSH 验证__` 候选并在 `finally` 里删除（实测清理成功）。
- **未实跑**：`server/verify-market-research-ui.mjs` —— 断言已按新路径与顶栏高亮更新，但它会发起真实卖家精灵调用（消耗付费额度），留待用户确认。
- **前端全量** 276/278（2 项为既有 `auth-layout`）、`lint`（全量 0 error/warning）/ `tsc -b` / `build` 全绿；截图 `verify-artifacts/stage-b-product-dev-subpages.png`、`stage-b-cross-page-state.png`。

### 阶段 C：我的 ASIN 升一级 + 提示词广场路径规范化

- [x] C1 新增 `src/routes/_authenticated/asin-watchlists.tsx`（`staticData.title: '我的 ASIN'`），渲染 `features/asin-watchlist`；旧 `ai-agent/asin-watchlists.tsx` 改为 `beforeLoad` redirect。
- [x] C2 新增 `src/routes/_authenticated/prompts/route.tsx`（布局：`HeaderSlot` 注入 `PromptSquareNav` + `Main` + `Outlet`）与 `prompts/index.tsx`；`ai-agent/prompts.tsx` 改为 redirect（保留 `?view=shared` 透传）。
- [x] C3 `PromptSquareNav` 的 `useSearch({ from })` 改为新路由 id；`AiAgentLayout` 删除提示词广场分流分支（页面已移出 AI 助手布局）。
- [x] C4 `sidebar-data.ts`：AI 助手子项去掉「我的 ASIN」；新增一级类目「我的 ASIN」（`/asin-watchlists`）；提示词广场 url 改为 `/prompts`。
- [x] C5 全站引用更新：`/ai-agent/prompts`（8 个文件）、`/ai-agent/asin-watchlists`（8 个文件）——含仪表盘快捷入口、任务中心占位页的两个按钮、对话页 `@` 面板 / 提示词按钮、测试与 verify 脚本。
- [x] C6 验收：`server/ai-agent/verify-ui.mjs`、`server/ai-agent/verify-prompt-optimize-ui.mjs`、仪表盘测试同步；旧 URL 实测跳转不 404。

**阶段 C 实际执行记录（2026-09-16）**

- **落地文件**：新增路由 `_authenticated/asin-watchlists.tsx`（一级，`staticData.title: '我的 ASIN'`）与 `_authenticated/prompts/{route,index}.tsx`；旧 `ai-agent/asin-watchlists.tsx`、`ai-agent/prompts.tsx` 改为 `beforeLoad` redirect（`view` 参数透传）；新增 `features/ai-agent/pages/prompts-layout.tsx` 承载提示词广场的顶栏导航（**放在 feature 而不是路由文件里** —— 写在路由文件会触发 react-refresh 的"只导出组件"告警，同 `AiAgentLayout` 的做法）。
- **`AiAgentLayout` 简化**：删掉 `useRouterState` + `isPromptSquare` 分流与 `PromptSquareNav` 导入 —— 一级类目不再靠别人布局里的一条 `if` 活着。
- **引用面实际只有 6 处代码 + 3 个脚本**（比计划里估的 8+8 小）：`sidebar-data.ts`、`task-center/index.tsx`、`nav-group.test.tsx`、`nav-children.test.ts`、`prompt-square-nav.tsx`、`prompt-square.tsx`；脚本 `verify-prompt-optimize-ui.mjs`（3 处）、`verify-watchlist-ui.mjs`（1 处）、`verify-nav-ia.mjs`。`server/*.mjs` 里出现的 `/ai-agent/asin-watchlists` 是**模块文件名**（`./ai-agent/asin-watchlists.mjs`）不是 URL，未改。
- **`matchPrefix` 未使用**：三个新一级/子页都按精确路径高亮即可（同阶段 B 的结论）。
- **验收**：`server/verify-nav-ia.mjs` **34/34**（独立实例 5211 与用户自己的 5173 + 8787 各一遍）。新增断言：AI 助手浮窗由 3 项变 2 项、侧边栏入口可达（浮窗子项 + `/asin-watchlists` + `/prompts` 三个一级项）、两条旧链接重定向、`?view=items` 参数透传、提示词广场顶栏是它自己的两个子页、顶栏标题是「提示词广场」、**提示词广场页不挂 AI 助手模块导航**、切「共享提示词」写入 `?view=shared`、旧链接 `?view=shared` 重定向且参数保留。
- **单测**：`nav-children.test.ts` 扩到 **7/7**（新增三条归类护栏：我的 ASIN 不在 AI 助手子项里且已是一级类目、提示词广场路径 `/prompts`、产品开发三子页路径）。
- **前端全量** 280/282（2 项为既有 `auth-layout`）、`lint`（全量 0 error/0 warning）/ `tsc -b` / `build` 全绿；截图 `verify-artifacts/stage-c-prompts-and-my-asin.png`。

### 阶段 D：设置拆为「系统管理」+ 个人边界

- [x] D1 `sidebar-data.ts`：「设置」改为「系统管理」，`items` = 用户管理 `/admin/users`、公告管理 `/admin/announcements`、AI 治理 `/admin/ai`（`matchPrefix`）；整类目 `adminOnly` 语义保持不变。
- [x] D2 路由迁移：`settings/users.tsx` → `admin/users.tsx`、`settings/announcements.tsx` → `admin/announcements.tsx`（`/admin` 已有管理员守卫，正好覆盖）；旧路径各加 redirect。
- [x] D3 个人 `/settings`（用户信息）保持现状：`nav-user.tsx` / `profile-dropdown.tsx` 仍指向它，不进 `navItems`；在责任田写明「个人入口 / 治理入口」边界。
- [x] D4 验收：管理员侧边栏可见「系统管理」三项；**普通账号整类目不可见**（`verify-ui.mjs` 的普通账号断言同步）；侧边栏 208px 下新增类目名不折行（判据 `span.getClientRects().length > 1`）。

**阶段 D 实际执行记录（2026-09-16）**

- **迁移安全性先核实过**：`/admin/route.tsx` 的 `AdminAreaLayout` 只是一个通用内容容器（`Main fixed` + flex 列 + Outlet），不含 AI 治理专属内容；用户管理 / 公告管理页面组件本身不渲染 `Main`（用 `ContentSection`），因此直接落在 `/admin/*` 下**不会出现双层 Main**，页面组件零改动。附带好处：`/admin` 的 `beforeLoad` 管理员守卫自动覆盖这两页。
- **类目级 `adminOnly` 与三个子项的 `adminOnly` 同时保留**（双保险）：普通账号整类目消失；将来若有人往里加了非 admin 子项，类目本身也不会暴露给全员。
- **权限口径改用单测来守**：端到端的普通账号断言依赖"验收库里恰好有 `ai-agent-acceptance` 这个账号"，实测**已经撞上一次**（脚本里那段 skip 了）。新增 `src/components/layout/nav-filter.test.ts` **4/4**：普通账号看不到「系统管理」与任何治理子项、管理员看到三项且路径正确、普通账号的可见类目清单逐个列出（顺序与内容都可回归）。端到端那段保留（有账号时会验）。
- **折行复验**：208px 侧边栏下「系统管理」（4 字）**不折行**，判据用 `getClientRects().length > 1`（按钮高度固定 32px，折行不会撑高它）。
- **验收**：`server/verify-nav-ia.mjs` **39/39 + 1 跳过**（独立 5211 与用户 5173+8787 各一遍）；`nav-filter.test.ts` 4/4、`nav-children.test.ts` 7/7；前端全量 **284/286**（2 项为既有 `auth-layout`）；`tsc -b` / `build` 全绿，本轮文件 `lint` 0 error/0 warning（全量 lint 当时另有 1 条 warning 来自**并行会话**正在编辑的 `competitor-analysis/components/snapshot-shell.tsx`，非本轮文件）。
- **未实跑**：`server/ai-agent/verify-ui.mjs`（断言已按「系统管理」与新路径同步，但它会发起真实模型问答）。

### 阶段 E（可选）：入口可达性收尾

- [ ] E1 `command-menu.tsx` 覆盖 L2 子页（「市场调研」「知识库」「我的提示词」等可搜到），数据源取 `navItems[].items` 与 `adminAiNavItems`。
- [ ] E2 首页常用入口与侧边栏职责边界写明（首页是"今天要做什么"的快捷方式，侧边栏是功能地图），不追求去重。

---

## 五、验收口径

**每阶段通用：**

- `pnpm run lint`、`npx tsc -b`、`pnpm run build` 全绿。
- 前端 vitest（`--config vitest.chrome.config.ts`）无新增失败。
- 受影响的 `server/*verify*.mjs` 脚本实跑并通过；断言变更必须写进提交说明。
- 真实浏览器实测（用户的 5173 + 8787）：新入口可达、旧 URL 跳转生效、零控制台错误。
- 侧边栏回归三项：一级类目不折行、品牌区与底部用户区不截断、折叠态 / 移动端抽屉不受影响。

**跨阶段功能性判据：**

1. 任一二级子页都能**两步内**到达，且可深链、刷新不丢上下文。
2. 同一入口全站只出现一次语义（侧边栏 / 顶栏同源派生）。
3. 命令面板可搜到全部 L2 子页（阶段 E 后）。
4. 普通账号看不到任何治理入口。

---

## 六、风险与回滚

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| URL 变更引用面广 | `/admin/ai` 23 个文件、`/product-dev` 17 个、`/ai-agent/prompts` 8 个、`/ai-agent/asin-watchlists` 8 个、`/settings/announcements` 4 个 | 逐处替换 + 旧路径 redirect 双保险；每阶段单独提交，可单阶段回滚 |
| 拆路由丢状态 | 产品开发选择与对比结果原为单组件 `useState` | B2 状态上提为 layout context / store；B6 显式验收"切页签不丢" |
| 顶栏分流与标题错配 | 页面移出模块布局后可能继承错标题 | 每个新路由声明 `staticData.title`；顶栏文本实测逐字校验 |
| 侧边栏折行 | 新增「系统管理」「我的 ASIN」更长类目名 | 208px 下用 `span.getClientRects().length > 1` 复验，必要时与用户确认宽度 |
| 权限暴露 | 治理项迁到 `/admin/*` 后普通账号若可见即事故 | 依赖 `/admin` 路由守卫 + `nav-filter` 双保险，D4 实测普通账号 |
| 命令菜单回归 | `command-menu.tsx` 与 `sidebar-data` 强耦合 | 结构变更后逐一实测命令面板条目 |

---

## 七、文档同步清单

- `docs/modules/全局布局与导航.md`（一级类目清单、承载方式口径、历史变更）
- `docs/modules/AI 助手.md`、`docs/modules/ASIN 清单.md`、`docs/modules/产品开发.md`、`docs/modules/竞品分析.md`、`docs/modules/设置中心.md`、`docs/modules/任务中心.md`
- `docs/modules/README.md`（模块索引）
- `CHANGELOG.md` 与工作区 `交接文档.md`

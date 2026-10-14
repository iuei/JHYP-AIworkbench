# 责任田：ASIN 清单（我的 ASIN）

- **首次建立**：2026-09-14
- **2026-09-18 重构**：**取消清单这一层**（用户要求「全账号只有一份 ASIN 列表」），站点从清单下沉到**每条 ASIN**，
  AI 工具由 `query_asin_watchlist` 改为 `query_my_asins`。文档标题沿用旧名以便旧链接可查。
- **归属**：员工侧的独立一级类目（侧边栏「我的 ASIN」），服务端归属 `server/ai-agent/`，前端独立 feature 目录

## 功能描述

让运营把"我负责的这批商品"沉淀成**一份可复用的 ASIN 列表**（账号私有，每条 ASIN 绑定一个站点），
并在一张**数据表**里按统计区间查看每个 ASIN 的广告与销售表现
（花费 / 广告销售额 / 广告订单 / ACoS / 销量 / 销售额 / 数据覆盖）；同一批数据可切**表格 / 卡片**两种读法。
趋势、对比与结论在对话里直接问 AI「我的 ASIN 这 30 天怎么样」（工具 `query_my_asins`，与页面同一套服务端计算）。

解决的是"ASIN 只是报表行里的字段"这一缺口：此前每次分析都要重新粘贴 ASIN，
而全站扫描（`scan_amazon_anomalies`）只会把整个站点的 ASIN 混在一起，问不出"我这批货怎么样"。

## 功能清单

- **单个导入**：弹窗表单，字段与表格的身份列**一一对应**（ASIN 必填 + 站点必填默认 US + 别名 + 备注），一次一条
- **批量导入**：下载 `.xlsx` 模板（表头 **ASIN / 站点 / 别名 / 备注**）→ 上传 CSV / XLSX →
  **先预览后确认**（识别到哪一列、会新增多少、哪些行读不出来、前 5 条样例；站点列缺失或留空时按"默认站点"落库）
- **浏览**：表格 / 卡片两种读法（共享 `LayoutToggle` + `CARD_GRID` + `useListLayout`，偏好记忆在本机，默认表格）
  - 表格：勾选、行号、ASIN（hover 复制）、站点、别名、备注、数据覆盖、6 个指标列、操作；表头点按排序、
    吸顶表头、**身份四列就地编辑**（ASIN / 别名 / 备注是文本单元格，站点是下拉枚举；回车保存、Esc 取消；
    改 ASIN 或站点只换取数口径，不动报表数据）、多选批量移除、分页（每页 50，支持跳页）
  - 卡片：每张卡 = ASIN + 站点 + 覆盖 + 别名/备注 + 6 个指标小格 + 编辑/移除（等高网格，备注只留两行）
- **筛选与区间**：关键词（ASIN / 别名 / 备注）、**站点筛选**（多站点下必需）、统计区间（近 7 / 30 / 90 天或自定义），
  工具条右侧回报服务端实际采用的起止日期与"有数据 x / y"
- **人工录入指标**（2026-09-18）：行内「录入指标」或「添加 ASIN」弹窗里勾选「同时录入这个区间的指标」，
  可手填 **花费 / 广告销售额 / 广告订单 / ACoS / 销量 / 销售额**（区间取页面当前正在看的那个）。
  **手工值优先、留空的字段继续用报表**（逐字段覆盖）；「数据覆盖」按填了哪几项自动推导；
  页面与 AI 工具共用同一处合并（`applyManualOverrides`），标「手工」的行一眼可辨
- **导出**：CSV（跟随当前筛选，导出的行 = 屏幕上的行，含站点列）
- **上限**：单账号 **5000** 条（所有站点合计）；单次粘贴 / 导入上限 **5000** 行；超限**一律 400 报错**，不静默截断
- **导入反馈四分类**：`added` / `duplicated`（同一 ASIN + 站点）/ `repeated`（本次输入内重复）/ `invalid`（带行号 + 原值）
- **无数据如实呈现**：没有报表记录的 ASIN 显示 `coverage='无数据'` 与「—」（**不是 0**），排序时恒排最后
- **AI 工具 `query_my_asins`**：按站点分组取数（**不同站点货币不同，绝不给跨站点合计**），
  可选 `marketplace` 只看某个站点、`asins` 只看指定商品；列表为空 / 未命中时如实引导
- **已删除（2026-09-18）**：清单概念（新建 / 切换 / 编辑 / 删除清单、清单名、清单面板）、
  一键分析页、页头站点 Badge 与条目数上限与别名覆盖率、密度切换、维度筛选（有别名/缺别名/有备注）、
  表现筛选（无数据 / ACoS 偏高 / 有花费无订单）—— 用户要求"只留导入 + 浏览 + 给 AI 用"

## 入口与出口

- 入口：**侧边栏一级类目「我的 ASIN」`/asin-watchlists`**（不再有页面级顶栏导航）
- 旧链接（全部落到这一页）：`/asin-watchlists/items`、`/ai-agent/asin-watchlists`、`?view=items`、`?view=analysis`、`?list=N`
  （后三者**就地忽略**，不做重定向，避免浏览器历史多出无用记录）
- 出口：空态引导卡（两个入口按钮）、行内编辑弹窗、导入弹窗（预览 / 结果）、错误卡（读不到列表）

## API 明细

全部挂在 `/api/ai/my-asins*` 下，走 `router.mjs` 的 `requireUser` + `identityGuard`（**无 adminGuard**：管理员访问他人数据同样 404）。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/ai/my-asins` | 列表（全部条目）+ `maxItems` + 站点白名单 |
| GET | `/api/ai/my-asins/template` | 导入模板下载（真 `.xlsx`，表头 ASIN / 站点 / 别名 / 备注） |
| POST | `/api/ai/my-asins/items` | 新增：`{ items: [...] }`（单条表单）或 `{ asins: '...' }`（批量粘贴 / 表格文本） |
| POST | `/api/ai/my-asins/import` | 表格文件导入（原始 body + `X-File-Name`）；`?dryRun=true` 只预览不写库，`?defaultMarketplace=US` 指定缺站点时的落点 |
| GET | `/api/ai/my-asins/metrics` | 指标：`?windowDays=30` 或 `?startDate=&endDate=`；返回 `period` / `groups`（按站点）/ `rows` / `summary` / `dataFreshness` |
| PATCH | `/api/ai/my-asins/items/:itemId` | 改 ASIN / 站点 / 别名 / 备注（改到已存在的 `(ASIN, 站点)` → 400） |
| PUT | `/api/ai/my-asins/items/:itemId/metrics` | 录入 / 更新人工指标（`startDate` + `endDate` + 6 个数字；全空 = 清除） |
| DELETE | `/api/ai/my-asins/items/:itemId/metrics` | 清除某区间的人工指标（回到报表口径） |
| DELETE | `/api/ai/my-asins/items/:itemId` | 移除一条 |

- 旧的 `/api/ai/asin-watchlists*` 9 个端点**全部删除**（含 `/analyze`）。
- AI 工具：`query_my_asins`（`requiredRole: 'user'`），注册走 `ai_tools` 表，迁移 122 负责重播**并删除**旧工具行
  （`seedAiToolsAndSettings` 只 upsert，不会清理已移除的工具）。

## 依赖关系

- 服务端：`my-asins.mjs`（领域层）、`my-asin-routes.mjs`（路由）、`watchlist-table.mjs`（表格解析：列识别 / 表头判定 / 四分类）、
  `watchlist-template.mjs`（模板生成）、`csv.mjs`、`read-excel-file`、`write-excel-file`
- 复用：`competitor-analysis.mjs` 的 `parseAsinList` / `extractAsin`、`data-queries.mjs` 的
  `asinSetPerformancePayload` / `myAsinMetricsPayload` / `queryLatestAmazonDateAcrossMarketplaces`、`analytics.mjs` 的阈值与算法
- 前端：`@/components/{data-table,table-pagination,confirm-dialog,sortable-head,date-picker}`、
  `@/features/ai-agent/components/{layout-toggle,list-layout}`（提示词广场同款视图切换）
- 被依赖：AI 助手对话链路（工具注册与执行）、`migrations.mjs`（建表与工具重播）、`product-dev*.mjs`（复用站点白名单常量）
- 共享字段：`amazon_ads_daily` / `amazon_sales_daily` 只读；`my_asin_items` 由本模块独占写入

## 影响范围

- **数据库**：迁移 120 新建 `my_asin_items(owner_user_id, asin, marketplace, alias, note, ...)`，
  唯一约束 `(owner_user_id, asin, marketplace)`；迁移 121 把旧清单条目**按站点合并**进来
  （`alias`/`note` 取非空的一份、`created_at` 取更早、`updated_at` 取更晚；只搬未软删清单）；迁移 122 重播工具。
  **旧表 `asin_watchlists` / `asin_watchlist_items` 保留不删**（唯一的回滚路径，新代码不再读写）。
  迁移 123 新建 `my_asin_metric_overrides`（人工录入的区间指标：绑 `item_id` 且 `ON DELETE CASCADE`，
  唯一键 `(item_id, start_date, end_date)`，区间必须是**具体起止日期**、最长 366 天）。
- **降级 / 回滚**：恢复旧代码 + 忽略 `my_asin_items` 即可；旧表数据完整保留（迁移只读旧表）。
- **前端**：`src/features/asin-watchlist/**` 重写（新增 `item-cards.tsx` / `add-item-dialog.tsx`，
  删除 `watchlist-panel` / `watchlist-switcher` / `watchlist-form-dialog` / `workspace-header` / `workspace-body` / `workspace-context` / `layout.tsx`）
- **路由**：`asin-watchlists/route.tsx` 收敛为无 search 参数的纯 Outlet；`items.tsx` 与 `ai-agent/asin-watchlists.tsx` 保留为纯跳转
- **验收脚本**：新增 `verify-my-asins.mjs`（28 项）、`verify-my-asins-bulk.mjs`（5 项）、`verify-artifacts/my-asins-ui.mjs`（15 项）；
  删除 `verify-watchlists.mjs` / `verify-watchlist-bulk.mjs` / `verify-watchlist-ui.mjs` / `asin-data-table.mjs` /
  `asin-ui-preview.mjs` / `asin-redesign-check.mjs` / `asin-ui-diag.mjs` / `asin-add-dialog-diag.mjs` / `check-5173-asin.mjs`
- **不影响**：竞品分析、知识沉淀、产品开发、全站扫描工具（本模块只是复用它们的解析与聚合）

## 修改边界

- 可以改：`server/ai-agent/{my-asins.mjs,my-asin-routes.mjs,watchlist-table.mjs,watchlist-template.mjs}`、
  `src/features/asin-watchlist/**`、`verify-artifacts/my-asins-ui.mjs`、`server/ai-agent/verify-my-asins*.mjs`、本责任田文档
- 跨模块（改前同步对应责任田）：`src/components/table-pagination.tsx` 与 `data-table.tsx` 的可选 props、
  `src/features/ai-agent/components/list-layout.ts`（提示词广场 / 知识库共用，**不要改默认值或键名语义**）
- 谨慎改：
  - `data-queries.mjs` 的 `asinSetPerformancePayload`（**页面与 AI 工具共用**，改一处等于改两处）
  - `asinSetPerformancePayload` 的 `detailLimit` 两条分支（页面 `null` 取全量 / 工具默认预算）
  - `watchlist-table.mjs` 的列识别与"是不是表格"判定（见下方踩坑）
- 绝对不能动：`amazon_*_daily` 的写入逻辑、`ai_tools` 的权限语义（`requiredRole` 不得放宽）、他人数据的可见性

## 注意事项（踩过的坑）

- **`Textarea` 会随内容无限撑高，装 ASIN 的框必须给 `max-h`（2026-09-16，实测）**：
  基线 `src/components/ui/textarea.tsx` 带 `field-sizing: content`，粘贴 302 行时文本框涨到 6058px、
  弹窗 6582px 且不滚动，提交按钮落在视口下方 3730px（点不到也滚不到）。修法是 `max-h-40 overflow-y-auto`。
- **`looksLikeHeaderRow` 先认值、再认字样（2026-09-18，踩过）**：它曾用"单元格文本像不像表头"（模糊匹配 `asin` 字样）
  先判一次，于是 `B0MYASIN01` 这种**本身含 asin 子串**的合法 ASIN 被当成表头，整行数据被吃掉、条目数变成 0。
  现在的判据只有一条：这行有没有合法 ASIN。
- **站点列的值不认识就整行拒绝（2026-09-18）**：`站点` 列写了 `火星` 之类的值时**不静默改默认站点** ——
  站点决定取数口径，悄悄换一个站点会得到一个看起来正常、实际取错站点的数字。
- **多站点不能相加（2026-09-18）**：`myAsinMetricsPayload` 按站点分组复用 `asinSetPerformancePayload`，
  顶层 `summary` 只给条数 / 覆盖数等与货币无关的计数；金额与 ACoS 一律留在 `groups` 里。
  工具输出同样按站点分节，并要求模型分站点陈述。
- **去重键是 `(asin, 站点)`（2026-09-18）**：按 ASIN 去重会把"同款在美国站和德国站"当成重复，等于丢掉一个站点。
- **区间锚点是"所有站点里最新的报表日期"**：报表是人工导出的（可能滞后数天），以今天为终点会得到大半为空的区间；
  各站点分别取锚点又会让每行数字的区间不同、页面没法写日期文案，因此统一用一个锚点。
- **自定义区间只选了一半时不发请求**：`useMyAsinMetrics` 的 `enabled` 会关掉请求；
  拿默认 30 天去查会让界面显示"自定义区间"、数字却是 30 天的。
- **`null` ≠ `0`**：没有报表记录的 ASIN 显示「—」，导出是空单元格，排序恒排最后。
- **模板表头即契约**：`watchlist-template.mjs` 的表头文字必须与 `watchlist-table.mjs` 的 `detectColumnMapping` 认的列名一致；
  ASIN 列必须显式 `type: String`（否则 Excel 会把这串字符改成科学计数法）。
- **`write-excel-file` v4 的 API**：是 `await writeXlsxFile(data, sheetOptions).toBuffer()`，不是 3.x 的 `{ buffer: true }`。
- **`/template` 必须注册在参数路由之前**：Express 按注册顺序匹配，放后面会被 `:itemId` 吃掉。
- **`seedAiToolsAndSettings` 只 upsert**：删掉一个工具契约后必须显式 `DELETE FROM ai_tools`，否则模型仍能看到它。
- **工具名进审计但不做外键**：`ai_runs.tool_name` 是普通列，删除 `ai_tools` 行不影响历史审计。
- **上限一律报错、不截断**：单次导入 > 5000、账号 > 5000 都返回 400 并说明差多少。
- **`?list=`/`?view=` 一律就地忽略**：清单与第二个视图都不存在了，重定向只会让浏览器历史多一条无用记录。
- **内容区不要再写页面级 `h1`**：全站页面标题由 `Header` 用 `staticData.title` 渲染并独占 h1；内容区从 `h2` 起。
- **本机跑前端测试要用系统 Chrome**：`pnpm exec vitest run --config vitest.chrome.config.ts --browser.headless`。

## 约束

- 必须复用：`parseAsinList` / `extractAsin`（ASIN 解析唯一实现）、`decodeCsvBuffer`、`asinSetPerformancePayload`
  （**页面指标与 AI 工具必须是同一套计算**）、`myAsinMetricsPayload`、`ConfirmDialog`、`DataTable`、
  `TablePagination`、`SortableHead`、`src/lib/table-styles.ts` 的列语义常量、`tableBlockToCsv` + `downloadCsv`、
  `layout-toggle.tsx` + `list-layout.ts`（两种读法，不要另写一套）、主题 token
- 两条列表口径：**先筛后排再分页**；**导出的行必须与屏幕上看到的一致**
- 验证要求：
  - `pnpm run build`、`pnpm run lint`、`pnpm run test:server`
  - 接口与工具：`API_PORT=8788 node server/index.mjs` + `node server/ai-agent/verify-my-asins.mjs`（**28 项**）
  - 大清单专项：`node server/ai-agent/verify-my-asins-bulk.mjs`（**5 项**：5000 条导入 / 超限 / 页面全量行 / 工具只回预算内）
  - 页面：`API_PORT=8788 pnpm exec vite --port 5200 --strictPort` + `node verify-artifacts/my-asins-ui.mjs http://localhost:5200`（**15 项**，含截图）
  - 导航与旧链接：`node server/verify-nav-ia.mjs http://localhost:5200`（**37 项**）
  - 列表纯函数：`pnpm exec vitest run --config vitest.chrome.config.ts src/features/asin-watchlist/format.test.ts --browser.headless`（**17 项**）

## 历史变更

| 日期 | 变更内容 | 修改人 / AI |
| --- | --- | --- |
| 2026-09-18 | **修「人工指标没保存成功 + 添加后弹出第二个录入窗口」**（用户反馈）。**先查库后复现**：库里 0 条人工指标；复现脚本抓到 `POST /my-asins/items` 201 与 `PUT .../metrics` 200、数据确实写进去了，但**弹窗没关**。**根因**：`ItemManager` 的空态与列表态各自 `return`，第一条 ASIN 添加成功时组件切分支 → `dialogs` 里的弹窗被卸载重挂载 → React Query 的 mutation 回调随 observer 卸载不再执行 → "保存成功即关窗"失效；用户接着在第二个窗口里二次提交（ASIN 已存在）走 duplicated 分支，指标被丢掉。**修法**：① 两个分支合并为同一个 `return`；② 条目与人工指标**合并成一次请求**（`POST /my-asins/items` 支持 `metrics` + `period`，指标写入失败返回 `manualError`）；③ 统计区间偏好持久化（`asin-watchlist-window`）。**验收**：`my-asins-ui.mjs` **24/24**（新增"添加后弹窗自动关闭""刷新后人工指标仍在"）、`verify-my-asins.mjs` **39/39**。 | AI |
| 2026-09-18 | **人工录入的区间指标（手工值优先于报表）**（用户需求「单个添加时没有 别名 备注 数据覆盖 花费 广告销售额 广告订单 ACoS 销量 销售额」；**经选项确认**：① 带区间录入（数字属于一个明确的统计区间）；② 「数据覆盖」按填了哪几项自动推导；③ 手工值优先、未填的字段用报表）。**数据层**：迁移 123 建 `my_asin_metric_overrides(item_id FK CASCADE, owner_user_id, asin, marketplace, start_date, end_date, spend, ad_sales, orders, acos, units, business_sales)`，唯一键 `(item_id, 起, 止)`。**服务端**：`my-asins.mjs` 新增 `MANUAL_METRIC_FIELDS` / `upsertMyAsinMetricOverride` / `removeMyAsinMetricOverride` / `listMyAsinMetricOverrides`（数值非负、区间必须具体日期且 ≤366 天；**全部留空 = 清除**而不是存空记录）；`data-queries.mjs` 新增 `applyManualOverrides` + `deriveCoverageFromRow` + `totalsFromRows`，在 `asinSetPerformancePayload` 内合并并**重算合计**（否则会出现"明细人工、合计报表"的自相矛盾），`manual` 标记随行回传、摘要里明确"哪些是人工录入"；路由新增 `PUT/DELETE /my-asins/items/:itemId/metrics`，`GET /my-asins/metrics` 带上覆盖值；AI 工具 `query_my_asins` 同样查覆盖表并传入，**页面与工具共用同一处合并**。**前端**：新增 `metric-override-fields.tsx`（6 个字段 + 覆盖情况实时预览）与 `metric-override-dialog.tsx`（行内「录入指标」，可清除）；「添加 ASIN」弹窗新增可选的「同时录入这个区间的指标」（先建条目拿 id、再写指标）；表格与卡片的覆盖列新增「手工」标记；录入弹窗的区间固定为**页面当前正在看的区间**（人工值按具体日期存，另给一套相对区间只会让两边对不上）。**验收**：`verify-my-asins.mjs` **39/39**（新增：部分字段写入、人工值优先且未填字段用报表、无数据 ASIN 填花费后覆盖情况自动变「仅广告」、换区间不生效、负数 400、清除回退报表、**AI 工具同样读到人工值**）、`my-asins-ui.mjs` **22/22**（新增：行内录入并标「手工」、卡片视图标记、清除回退、添加弹窗字段一致）、`verify-my-asins-bulk.mjs` **5/5**、`lint` / `build` / 服务端测试全绿。 | AI |
| 2026-09-18 | **身份字段全部可改：ASIN / 站点 / 别名 / 备注**（用户需求「我的 asin 页面内数据表格内的字段都支持修改，添加 asin（单个内的表单需填写字段应与数据表格内字段一致）」；**经选项确认**：只放开身份字段，6 个指标列仍由报表算出、不参与人工编辑 —— 人工覆盖会让页面与 AI 工具出现两套数字）。**服务端**：`updateMyAsinItem` 新增 `asin` 入参（`normalizeAsin` 大写归一；改成已存在的 `(ASIN, 站点)` 由数据库唯一约束拦下 → 400 并回显中文原因），路由 `PATCH /my-asins/items/:itemId` 透传。**前端**：表格 ASIN 列与站点列改为就地编辑（新增 `editable-select-cell.tsx`：站点用下拉枚举，避免手打出 `usa` / `美国` 这类取数口径错误），行尾编辑弹窗补 ASIN 字段（卡片视图经它修改），弹窗与底部口径文案同步；「添加 ASIN」表单字段保持 ASIN / 站点 / 别名 / 备注，与表格身份列一致。**验收**：`verify-my-asins.mjs` **32/32**（新增：改 ASIN 归一化、改到已存在组合 400 且原值不变、同时改 ASIN + 站点、改回现场）、`verify-artifacts/my-asins-ui.mjs` **18/18**（新增：ASIN 就地编辑、站点下拉改到 DE、改回 US）、`lint` / `build` 全绿。 | AI |
| 2026-09-18 | **单集合重构：取消清单 + 站点下沉到条目 + 表格/卡片双视图 + AI 工具改名**（用户需求「只保留单个导入 / 批量模板导入 / 表格与卡片展示 / AI 可调用分析，其余功能全部删除」）。**决策点经选项确认**：① 真删清单结构、重写服务端与 AI 工具；② 每条 ASIN 自带站点；③ 历史多清单**合并为一份**；④ 保留指标 + 区间选择；⑤ 批量导入保留"先预览后确认"；⑥ 删除密度切换 / 维度筛选 / 表现筛选 / 页头信息块。**服务端**：迁移 120 建 `my_asin_items`（唯一键 `(owner_user_id, asin, marketplace)`）、121 合并旧清单条目（只搬未软删清单；`alias`/`note` 取非空、时间取并集）、122 重播工具并删除旧工具行；新增 `my-asins.mjs` / `my-asin-routes.mjs` / `myAsinMetricsPayload`（按站点分组，**不出跨站合计**）/ `queryLatestAmazonDateAcrossMarketplaces`；`watchlist-table.mjs` 与模板新增**站点列**（认 `站点/国家/marketplace`，中文名归一化，非法值整行拒绝）；删除 `asin-watchlists.mjs` / `watchlist-routes.mjs`（含 `/analyze`）与旧 9 个端点；**旧表保留不删**。**AI 工具**：`query_asin_watchlist` → `query_my_asins`（`marketplace?` / `asins?`，按站点分节输出 + 声明不可相加）。**前端**：新增卡片视图（共享 `LayoutToggle` + `CARD_GRID` + `useListLayout`，默认表格）、单条添加弹窗（RHF + zod）、站点筛选与站点列、导入弹窗支持默认站点；删除 5 个清单相关组件与 `workspace-context` / `layout.tsx`；路由收敛为无 search 参数的纯 Outlet。**顺带修掉一个真实缺陷**：`looksLikeHeaderRow` 曾把"本身含 asin 子串"的合法 ASIN 当表头（`B0MYASIN01` 整行被吃掉）。**验收**：`verify-my-asins.mjs` **28/28**、`verify-my-asins-bulk.mjs` **5/5**（5000 条导入 52ms、页面 5000 行、工具表格 30 行 / rows 120）、`my-asins-ui.mjs` **15/15**、`verify-nav-ia.mjs` **37/37**（跳过 1）、`format.test.ts` **17/17**、服务端 **646/646**、`build` / `lint` 全绿。 | AI |
| 2026-09-18 | **数据表改造：分析移出本模块 + 业务指标进表格 + 真 xlsx 模板**（用户需求「当前我的 asin 板块内容展示不够具体，没有什么太大价值」）。**决策点经选项确认**：① 保留清单结构；② 必要列 = ASIN/别名/备注 + 花费/广告销售额/广告订单/ACoS + 销量/销售额 + 覆盖情况；③ 指标列可排序 + 常用快捷筛选；④ 分析只在 AI 对话里问；⑤ 模板用真 `.xlsx`。**实现**：新增 `GET /:id/metrics` 与 `watchlist-template.mjs`，`/template` 由 CSV 改为 xlsx，`asinSetPerformancePayload` 新增 `detailRows`（只在页面路径回传）；前端 `item-manager.tsx` 改为 13 列数据表、`format.ts` 指标筛选/排序/格式化（**`null` ≠ `0`**）、`useWatchlistMetrics`；路由收敛为单页；删除 7 个分析相关文件。**验收**：`asin-data-table.mjs` **23/23**、`verify-watchlist-ui.mjs` **21/21**、`asin-redesign-check.mjs` **21/21**、`asin-ui-preview.mjs` **11/11**、`verify-nav-ia.mjs` **32/32**、`verify-watchlists.mjs` **29/29**、`verify-watchlist-bulk.mjs` **7/7**、`format.test.ts` **20/20**、服务端 **637/637**、`build` / `lint` 全绿。 | AI |
| 2026-09-17 | **全页 UI 重构：取消常驻左栏 + 两个视图拆成两个页面 + 指标总表合并**（用户需求「我的 asin 页面重新排版布局 彻底重构这个页面的 UI」）。四个决策点经选项确认；修掉一个自己引入的真实缺陷（导航项未加 `activeOptions={{ exact: true }}` 时两个导航项同时带上 `aria-current='page'`）。**验收**：`verify-nav-ia.mjs` **40/40**、`verify-watchlist-ui.mjs` **22/22**、`asin-ui-preview.mjs` **11/11**、`asin-redesign-check.mjs` **22/22**。 | AI |
| 2026-09-16 | **升为侧边栏一级类目，路径规范化为 `/asin-watchlists`**；**「商品明细」重构为数据工作台**（工具条 / 可排序吸顶表头 / 行号 / 多选批量移除 / 就地编辑 / 跳页 / 导出 CSV；同轮修掉 `Textarea` 无限撑高的真实缺陷）。 | AI |
| 2026-09-15 | **表格导入：ASIN 数据本来就是表格**（支持 `.xlsx`、自动识别 ASIN 列并带别名/备注、上限提到 5000、模板下载）；**页面布局：分析与条目分视图**；**表格统一**迁移到共享 `DataTable`。修掉两个真实缺陷（`/template` 被 `:id` 吃掉；"多行逗号分隔但每格都是 ASIN"被误判为表格而**静默丢掉一半商品**）。 | AI |
| 2026-09-14 | 建立模块：迁移 114（`asin_watchlists` / `asin_watchlist_items`）与 115（工具重播）、`asin-watchlists.mjs` 领域层、`watchlist-routes.mjs` 9 个接口、`asinSetPerformancePayload` 清单分析载荷、AI 工具 `query_asin_watchlist`、前端 `src/features/asin-watchlist/**` + 路由 + 导航项「我的 ASIN」；验收：接口/工具 20 项、页面 15 项、服务端全量 396 项。 | AI |

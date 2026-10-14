# 变更日志：JHYP 智能工作台

本项目为公司内部系统，工程标识 `jhyp-ai-workbench`，英文目录名 `JHYP-AIworkbench`。

> **上游基线说明**
> 本项目基于开源项目 [shadcn-admin](https://github.com/satnaing/shadcn-admin)（MIT License，Copyright (c) 2024 Sat Naing）二次开发。
> 以下 v2.2.1 及更早的记录是**上游模板自身的历史**，仅作源码追溯用途，不代表本项目的功能范围与发布节奏。
> 本项目自身的变更记录将追加在本文件顶部（上游历史之上）。
>
> **本项目变更记录**

## AI 助手：修「发送一条消息有时会展示出两条」（2026-09-22）

### Change

- **报障**（用户原话）：「在 ai 助手页面发起会话时发送一条消息 有时会展示出两条」。
- **先分叉再定位（三步取证）**：
  1. **查库**：同一会话、同内容的重复消息 **0 条** → **不是服务端写两条**，是前端渲染重复；
  2. **浏览器逐帧采样**（结构选择器：用户气泡 `main div.justify-end`、AI 卡片 `[aria-label='AI 回答']`
     与 `[aria-label='AI 正在回答']`），并把 `/api/ai/messages` **延迟 1.5s 放大窗口** ——
     峰值 **用户气泡 2、AI 卡片 1**，稳定后都回到 1 → 重复的是**用户提问气泡**；
  3. **直读 SSE**：`meta.userMessageId = undefined`，而库里该 user 消息 id 是 **1327**（真实存在）。
- **根因**：服务端每轮发**两条 `meta`** —— 第一条带 `conversationId` / `messageId` / `provider`，
  第二条只带 `registeredTools`（工具裁剪结果）。前端 `handleEvent` 的 meta 分支是**直接赋值**
  `userMessageId: event.data.messageId`，于是第二条 meta 把它覆盖成 `undefined` →
  `streamOverlapsPersisted()` 再也认不出"用户消息已落库" → **乐观气泡与落库气泡同时渲染**
  （是否看得见取决于那一刻 refetch 有没有回来，所以现象是"有时"）。
- **修法（两道保险）**：
  1. **前端**：新增纯函数 `applyMetaPatch()`（`src/features/ai-agent/stream-merge.ts`）——
     meta 字段**缺失（含显式 null）就不覆盖**，`chat-workbench.tsx` 的 meta 分支改用它；
  2. **服务端**：第二条 meta 补上 `conversationId`，让"每条 meta 都带会话上下文"成为不变量。
- **同一轮先做的加固**：给流式卡片与落库卡片加了 `assistantMessageId`（`done.messageId`）去重 ——
  `send()` 收尾是「先 `await refresh()` 再 `setStream(null)`」，这段窗口里 AI 回答本也可能出现两份
  （实测那条路径没重复，但判据现在完整了，两个 id 任一缺失都不撤卡片）。

### 验证

- `src/features/ai-agent/stream-merge.test.ts` **8/8**（重叠判定 5 项 + `applyMetaPatch` 3 项）；
  `src/features/ai-agent` 目录全绿；服务端全量 **642/642**（0 fail）；`pnpm run lint` / `build` 全绿。
- **端到端红绿对照**（独立实例 5200 + 8788，`/api/ai/messages` 延迟 1.5s 放大窗口、逐帧采样 80 次）：
  - 修复前：用户气泡峰值 **2**（稳定后回 1）；
  - 修复后：用户气泡峰值 **1**、AI 卡片峰值 **1**、稳定后各 **1**。
- **SSE 直读**：每条 meta 都带 `conversationId`（`[635,635]`）、`meta.messageId`（1329）与库里
  user 消息 id 一致、`done.messageId`（1330）与 assistant 一致。
- 验证用的会话已按**精确 id/marker** 清理。

## 竞品分析 / AI 助手：修 `query_competitor_analysis（rows.filter is not a function）`（2026-09-18）

### Change

- **报障**（用户贴的界面实录）：「列出我分析过的竞品」→ 回「当前账号无权查询该数据，请联系管理员。」；
  「我的asin列表」→ 回 `✕ query_competitor_analysis（rows.filter is not a function）`。
- **根因（一行调用写法）**：`competitor-history.mjs` 里写成 `list.map(toHistoryItem)`，
  而 `Array.map` 会把**数组下标**当第二个参数传给回调 —— `toHistoryItem(row, dispositions)` 的
  `dispositions` 于是变成 `0`、`1`…；`dispositions ?? []` 对 `0` **不生效**（0 不是 nullish），
  下游 `clearedDispositionKeys(0)` 里 `0.filter` 抛 `rows.filter is not a function`。
  后果：**竞品分析历史列表接口与 AI 工具一起挂**（`ai_runs` 里 `r691` 记录的就是这条错误）。
- **修法（双重，防同类复发）**：
  1. **调用点**：`competitor-history.mjs` 两处 `map(toHistoryItem)` → `map((row) => toHistoryItem(row))`；
  2. **函数本身**：`toHistoryItem` 用 `Array.isArray(dispositions) ? dispositions : []` 取代
     `dispositions ?? []` —— 这个坑值得在函数里也堵一次。
- **顺带修工具选择**：`query_competitor_analysis` 的描述补一句
  「**本工具给不出"我的 ASIN 清单"**：用户问"我的 ASIN 列表 / 我维护了哪些商品"时必须用
  `query_my_asins`」—— 实测模型在「我的asin列表」时误选了竞品分析工具。

### 验证

- `competitor-analysis.node-test.mjs` 新增用例（把 `0` / `1` / `'x'` 当 dispositions 传入：
  不崩、按"无销账"处理）—— **先红后绿**；该文件 **42/42**、服务端全量 **654/654**。
- 直接调用 `competitorAnalysisPayload({ userId: 2 })`：修复前抛 `rows.filter is not a function`，
  修复后正常返回 5 条记录。
- **真实模型端到端**（独立 8788，新会话两轮）：「列出我分析过的竞品」→ 正常列出 **20 条记录**
  （最新 #89）；「我的asin列表」→ 正常列出 **4 个 ASIN**（US 3 / DE 1）并给出默认统计窗口
  `2026-08-02 ~ 2026-08-31`；两轮都**没有"无权"、没有"失败"**、都未被拦截。
- 验证会话（#598）已按**精确 id** 清理（不再用"最新 N 条"的写法）。

## 「我的 ASIN」人工录入区间指标：手工值优先于报表（2026-09-18）

### Change

- **需求**（用户原话）：「单个添加时没有 别名 备注 数据覆盖 花费 广告销售额 广告订单 ACoS 销量 销售额」。实测确认弹窗本就有 ASIN / 站点 / 别名 / 备注 四项，缺的是**指标那 7 列**（数据覆盖 + 6 个指标）。
- **决策点经选项确认**：① 带区间录入（数字属于一个明确的统计区间）；② 「数据覆盖」按填了哪几项**自动推导**；③ **手工值优先，未填字段用报表**。
- **数据层**：迁移 123 建 `my_asin_metric_overrides`（绑 `item_id` 且 `ON DELETE CASCADE`；唯一键 `(item_id, 起, 止)`；区间必须是**具体起止日期**、最长 366 天）。
- **服务端**：`my-asins.mjs` 新增 `MANUAL_METRIC_FIELDS` 与 `upsert / remove / listMyAsinMetricOverrides`（数值非负；**六个全空 = 清除**而不是存空记录）；`data-queries.mjs` 新增 `applyManualOverrides` + `deriveCoverageFromRow` + `totalsFromRows`，在 `asinSetPerformancePayload` 内合并并**重算合计**（否则会出现"明细人工、合计报表"），行带 `manual` 标记、摘要里说明哪些是人工录入；路由新增 `PUT/DELETE /my-asins/items/:itemId/metrics`；AI 工具 `query_my_asins` 同样读覆盖表 —— **页面与工具共用同一处合并**，两套口径不可能分叉。
- **前端**：新增 `metric-override-fields.tsx` + `metric-override-model.ts`（6 个字段 + 覆盖情况实时预览）与 `metric-override-dialog.tsx`（行内「录入指标」，可清除）；「添加 ASIN」弹窗新增可选区「同时录入这个区间的指标」（先建条目拿 id、再写指标）；表格与卡片在覆盖列标「手工」；录入区间固定为**页面当前正在看的区间**。

### Verify

- `verify-my-asins.mjs` **39/39**（新增 7 项：部分字段写入 / 人工值优先且未填字段用报表 / 报表无数据的 ASIN 填花费后覆盖情况自动变「仅广告」/ 换区间不生效 / 负数 400 / 清除回退 / **AI 工具同样读到人工值**）
- `verify-artifacts/my-asins-ui.mjs` **22/22**（新增 4 项：行内录入并标「手工」/ 卡片视图同样标记 / 清除回退 / 添加弹窗字段与表格一致）
- `verify-my-asins-bulk.mjs` **5/5**、`lint` **0 warning**、`build` ✓、`pnpm run test:server` **653/653**

### Fix（当天用户反馈后修）

用户报「数据没录入成功、刷新后消失」+「添加完成后会继续弹出第二个录入窗口」。**先查库、再复现**：库里人工指标 0 条；复现脚本显示 `POST /my-asins/items` 201 与 `PUT .../metrics` 200 **都成功、数据确实写进去了**，但**弹窗数仍是 1**。

- **根因**：`ItemManager` 的空态与列表态**各自 `return`**，添加第一条 ASIN 时组件从一个分支切到另一个分支，`dialogs` 里的弹窗被**卸载又重挂载**；React Query 的 mutation 回调随 observer 卸载而不再执行 → "保存成功即关闭弹窗"这一步失效 → 用户看到"又一个录入窗口"，在里面二次提交（ASIN 已存在）走 `duplicated` 分支，刚填的指标被丢掉。
- **修法**：① 空态与列表态合并为**同一个 `return`**（弹窗不再被卸载）；② 条目与人工指标**合并成一次请求**（`POST /my-asins/items` 支持 `metrics` + `period`；指标写入失败时返回 `manualError`，既不静默也不整体回滚）；③ 「统计区间」与展示方式一样**记忆在本机**（`asin-watchlist-window`），避免"在近 7 天下录的数据、刷新回近 30 天看不到"被误判成丢数据。
- **回归断言**：`my-asins-ui.mjs` 新增 2 项（**添加后弹窗自动关闭**、**刷新后人工指标仍在**），并把"添加 + 录指标"合并进该脚本第 2 步 —— 正是出问题的那条路径。页面验收因此为 **24/24**。

---

## AI 助手：修「我的 ASIN 列表报权限不足」——参数问题被说成权限问题（2026-09-18）

### Change

- **报障**（用户原话）：「给 ai 助手发送我的 asin 列表时提示权限不足无法调取到 asin 数据 解决这个问题」。
- **根因（两层，都有实测证据）**：
  1. **契约层**：`query_my_asins` 的 `startDate` / `endDate` 在 `tool-contracts.mjs` 里是**必填**，
     而「列出我的 ASIN 列表」这类问题**天然没有日期** —— 模型不带日期调用就得到
     `invalid_params`（`缺少必填参数：startDate`）。实测：同一问题模型有时自己编一个区间（成功）、
     有时不带（失败），因此表现为"时好时坏"。
  2. **文案层**：编排层的 `blockedTool` 分支只区分 `not_implemented` 与"其余"，
     于是**参数问题被归到权限口径**，回「当前账号无权查询该数据，请联系管理员。」——
     用户看到的"权限不足无法调取 ASIN 数据"就是这句话。
- **修法**：
  1. `tool-contracts.mjs`：`query_my_asins` 的 `required` 改为 `[]`（日期可选），描述里写明
     「不传时按默认统计窗口查询；用户只问清单时**不要为了凑参数编造日期**，也不要因此拒绝回答」；
  2. `tools.mjs`：handler 用**与页面同一套** `resolveWindow()` 补默认区间
     （从 `my-asin-routes.mjs` 导出复用：以最新可用报表日期为锚的近 30 天），
     人工指标覆盖的读取也改用解析后的**具体日期**（人工指标要求具体起止，缺省会抛校验错）；
  3. `prompt.mjs`：新增 `INVALID_PARAMS_ANSWER` 与 `toolRejectionOutcome(reason)` ——
     `not_implemented` → `tool_unavailable`、`invalid_params` → `invalid_params`、
     其余（`forbidden` / `not_registered` / 未知）才是 `forbidden`；`orchestrator.mjs` 改用该函数；
  4. `blocked-notice.ts`：补 `invalid_params` 的前端提示条文案（"请求的参数不完整或格式不正确
     （与账号权限无关）…"），用户不再被引向"我是不是没权限"。
- **顺带修一个真实缺陷**：`normalizeAsin` 此前只做去空白 + 大写、**不校验格式**，
  于是库里能写入 `ASIN = 测试`（中文）这种脏数据（指标查询与 AI 工具都拿它没办法）。
  现在复用 `extractAsin` 校验（10 位字母数字，或商品链接），非法值在落库前就报中文原因。

### 验证

- 服务端 **653/653**（新增 `toolRejectionOutcome` 分层用例：参数问题不含"无权"、
  只有 `forbidden`/`not_registered`/未知才走权限口径；新增 `normalizeAsin` 拒绝非法格式用例）；
  前端 `src/features/ai-agent` **79/79**；`pnpm run build` 全绿
  （`pnpm run lint` 0 error，余 5 条 warning 在并行会话的
  `src/features/asin-watchlist/components/metric-override-fields.tsx`，与本轮无关）。
- **工具层实测**：`query_my_asins` 传 `{}` → **status ok**，自动补区间
  `2026-08-02 ~ 2026-08-31（30 天）`（此前是 `invalid_params`）。
- **真实模型端到端**（独立实例 8788，新会话 3 轮不同措辞：「我的asin列表」/「列出我的 ASIN 列表」/
  「我的 ASIN 都有哪些」）：**3 轮都没有被拦、回答都不含"无权"**，且逐条给出清单内容与默认窗口。

### 需要你做的

- **重启后端**：8787 上仍是旧进程，否则你看到的还是"日期必填 + 权限文案"的旧行为。
- **清单里那条 `ASIN = 测试`（UK 站）是非法数据**：新校验已能挡住以后再写入，
  但这条历史数据需要你在「我的 ASIN」页面删除或改成真实 ASIN —— 我没有擅自删你的数据。

## AI 助手：修「中文打字回车即发送」与「列出我的 ASIN 被权限护栏拦下」（2026-09-18）

### Change

- **报障**（用户原话）：①「ai 助手页面输入文本打字时出现错误只要回车就会直接发送内容」；
  ②「让 ai 助手列出我的 asin 列表时报错：本次回答被权限护栏拦下（模型自行描述了工具范围或直接拒绝）…」。
- **① 输入法回车（前端）**：`chat-workbench.tsx` 的 `onKeyDown` 没有判断输入法组合态。
  中文打字时回车的第一职责是**确认候选词**，但浏览器在组合期间仍会把 `keydown` 交给页面
  （`key` 就是 `'Enter'`），于是一按回车就 `preventDefault()` + 发送半截内容（候选词也确认不了）。
  **修法**：新增纯函数 `src/features/ai-agent/keyboard.ts` 的 `isImeComposing()`
  （`nativeEvent.isComposing === true`，或兼容"组合结束那一下"的 `keyCode === 229`），
  在 `onKeyDown` **最前面**判断（早于 `mention.handleKeyDown` 与发送判断）。附 4 项单测。
- **② 护栏误伤（服务端，根因）**：`PERMISSION_LEAK_PATTERNS` 的
  `(工具|能力|权限)(列表|清单|白名单|范围)` 会命中**产品自己的固定声明条**
  「🔒 依据权限范围：全部生效知识文档与业务数据」（由 `ensureFreshnessDeclaration` 追加）。
  同会话的**下一轮**，模型会照抄这条格式（它出现在历史消息里），于是正常业务回答里出现
  「权限范围」四个字 → 整篇被替换成「当前账号无权查询该数据，请联系管理员。」。
  库里 `ai_messages` **1197 / 1201 / 1203 / 1211** 四条 `wording:described_own_tools` 全是这样产生的
  （逐句回放确认：命中句就是那一行声明条）。
  **修法**：`prompt.mjs` 新增 `stripProductWording()`，**判定前只剔除产品固定说法**
  （`依据权限范围：<任意>`、`🔒 检索范围：<任意>`），放行时仍返回**原文**（不吞掉声明条）；
  模型用自己的话描述能力范围（"我的权限范围只包括知识库检索"）照旧被拦 —— 护栏强度不退化。
- **③ 工具答不出清单（同一条链路的诱因）**：`query_my_asins` 的返回里只有
  「共 N 个 ASIN、分布在哪些站点」，**没有任何 ASIN 编码**，所以模型被问"列出我的 ASIN 列表"时
  只能回"工具未返回具体编码，我无法逐个列出" —— 用户拿不到清单，而这种自述措辞又容易撞护栏。
  **修法**：工具 summary 里**逐条列出清单**（按站点分组、带别名；超过 200 条截断并指路页面），
  并新增「我的 ASIN 清单」表格块；`tool-contracts.mjs` 的工具描述补一句
  「用户要清单时必须逐条列出 ASIN 编码，不得只回答数量」。

### 验证

- 服务端单测 **651/651**（新增 3 项护栏用例：产品声明条不再误伤 ×2、自述能力范围仍被拦 ×1）；
  前端 `src/features/ai-agent` **79/79**（新增 `keyboard.test.ts` 4 项）；`pnpm run lint` / `build` 全绿。
- **真实模型端到端**（独立实例 5200 + 8788；临时插入 2 条验证 ASIN，结束即清理）：
  同一会话连问 **6 轮**（我的 ASIN 最近表现怎么样 / 列出我的 ASIN 列表 / 我的 ASIN 都有哪些 /
  把我的 ASIN 全部列出来 / 我的 ASIN 清单里有哪些商品 / 再列一次我的 ASIN 列表）——
  **6 轮全部未被措辞护栏拦截**，且列清单的回答逐条给出了 `B0DSH00001`（验证甲）与
  `B0DSH00002`（验证乙）。
- **IME 端到端**（CDP `Input.imeSetComposition` 造真实组合态）：组合中按回车 →
  **0 次 chat 请求**、组合文本保留在输入框；组合结束后的普通回车 → 照常发送（对照 1 次）。
- 排查期间创建的 7 个验证会话（#590–596）已从库里清理，审计记录保留。

### 遗留（需确认）

- **「我的 ASIN」清单当前是空的**：`my_asin_items` **0 行**；单集合重构保留的旧表
  `asin_watchlist_items` 有 7796 行，但其中未软删清单只剩 2 个且没有条目。
  也就是说现在问"列出我的 ASIN 列表"会如实回答"清单为空，请到「我的 ASIN」页添加"——
  你此前看到的「3 个 ASIN」已不在库里。**是否需要恢复**（从旧表重放合并 / 重新导入）请确认。
- **服务端改动需重启后端**（8787 上跑的还是旧进程）。

## 侧边栏：「任务中心」与「产品开发」标注「开发中」徽标（2026-09-18）

### Change

- **需求**（用户原话）：「任务中心板块和产品开发板块标注为开发中」。
- **改动**：`src/components/layout/data/sidebar-data.ts` 给这两个一级项加 `badge: '开发中'`
  （「产品开发」是折叠类目，徽标渲染在触发器上；桌面浮窗、移动端内联、折叠态三处分支本来都渲染 badge）。
- **口径说明（重要）**：任务中心 2026-09-17 交付真实功能后**曾特意去掉**这个徽标
  （当时徽标语义 = "能力还没上线，点进去是说明页"）。现在按用户口径加回来 ——
  这两个板块的**入口与功能都是可用的**（任务中心：真实提交 / 后台执行 / 报告回看；
  产品开发：候选池 / 对比与历史 / 市场调研三个真实路径），徽标在这里表达的是**对外状态**。
  两处 `sidebar-data.ts` 注释与责任田文档都写明了这条，避免后来者按旧口径又把它删掉。
- **同步**：`server/verify-task-center-ui.mjs` 的断言由「徽标已下线」改为「徽标必须在」；
  `server/verify-nav-ia.mjs` 新增「任务中心与产品开发都带开发中徽标」断言；
  `nav-filter.test.ts` 新增护栏（管理员 / 普通账号两种角色下徽标都不丢）；
  `docs/modules/任务中心.md`、`docs/modules/全局布局与导航.md` 的口径与类目清单同步。

### 验证

- `src/components/layout` 单测 **51/51**。
- `server/verify-nav-ia.mjs`（用户自己的 5173 + 8787）实测徽标断言通过：
  `产品开发开发中 / 任务中心开发中`；208px 侧边栏「一级/二级类目不折行」仍通过
  （208px 这个宽度本来就是按「任务中心 + 开发中」定下的）。
- `pnpm run lint` / `pnpm run build`（含 `tsc -b`）全绿；lint 剩余 2 条 warning 在
  `src/routes/_authenticated/asin-watchlists/route.tsx`（属工作区并行改动，与本次无关）。
- 排查说明：该脚本同时报出的「零产品控制台错误」失败与一条跨子页状态断言失败**与本次无关** ——
  单独只读复现（停在 `/knowledge?view=team` 与 `/task-center` 各 4 秒）**没有任何 4xx**，
  脚本里的报错全部是跳转中 `net::ERR_ABORTED` 的 dev server 模块请求（并行会话正在改文件、
  vite 持续 reload 造成的噪声）。

## 「我的 ASIN」单集合重构：取消清单 + 站点下沉 + 表格/卡片双视图（2026-09-18）

### Change

- **需求**（用户原话）：「只保留单个导入 asin（弹窗表单）、批量导入（表格 + 模板）、asin 数据可以以表格和卡片形式展示、AI 助手可调用我的 asin 数据查询分析，其余多余功能全部删除」。
- **决策点经选项确认**：① 真删清单结构、重写服务端与 AI 工具；② **每条 ASIN 自带站点**；③ 历史多清单**合并为一份**；④ 保留指标 + 区间选择；⑤ 批量导入保留「先预览后确认」；⑥ 删除密度切换 / 维度筛选 / 表现筛选 / 页头信息块。
- **数据层**：迁移 120 新建 `my_asin_items`（唯一键 `(owner_user_id, asin, marketplace)`）；迁移 121 把旧清单条目按站点合并（只搬未软删清单；别名/备注取非空、时间取并集）；迁移 122 重播并**删除**旧工具行。**旧表 `asin_watchlists*` 保留不删**（唯一的回滚路径）。
- **服务端**：新增 `my-asins.mjs` / `my-asin-routes.mjs` / `myAsinMetricsPayload`（按站点分组复用 `asinSetPerformancePayload`，**顶层不出跨站点金额合计**）/ `queryLatestAmazonDateAcrossMarketplaces`；`watchlist-table.mjs` 与 xlsx 模板新增**站点列**（`站点/国家/marketplace` 都认、中文名归一化、非法值整行拒绝）；删除 `asin-watchlists.mjs` / `watchlist-routes.mjs` 与旧 9 个端点（含 `/analyze`）。
- **AI 工具**：`query_asin_watchlist` → **`query_my_asins`**（参数变成可选的 `marketplace` / `asins`，按站点分节输出并要求模型分站点陈述）。
- **前端**：新增卡片视图（共享 `LayoutToggle` + `CARD_GRID` + `useListLayout`，**默认表格**）、单条添加弹窗（RHF + zod）、站点列与站点筛选、导入弹窗支持「默认站点」；删除 5 个清单相关组件与 `workspace-context` / `layout.tsx`；路由收敛为无 search 参数的纯 Outlet（`items` 与 `ai-agent/asin-watchlists` 保留跳转）。
- **顺带修掉一个真实缺陷**：`looksLikeHeaderRow` 曾把「本身含 asin 子串」的合法 ASIN（`B0MYASIN01`）当成表头，导致整行数据被吃掉、条目数变成 0。

### Verify

- 服务端：`node server/ai-agent/verify-my-asins.mjs` **28/28**、`verify-my-asins-bulk.mjs` **5/5**（5000 条导入 **52ms**、超限预览即 overflow、页面指标 5000 行、AI 工具表格 30 行 / rows 120）
- 页面：`node verify-artifacts/my-asins-ui.mjs` **15/15**（含截图 `verify-artifacts/my-asins-01-空态.png`、`my-asins-02-表格.png`、`my-asins-03-卡片.png`）
- 导航与旧链接：`node server/verify-nav-ia.mjs` **37/37**（跳过 1）
- 单测与服务端全量：`format.test.ts` **17/17**、`pnpm run test:server` **646/646**、`pnpm run build` / `pnpm run lint` 全绿
- **旧脚本已删除**（不留假绿）：`verify-watchlists.mjs`、`verify-watchlist-bulk.mjs`、`verify-watchlist-ui.mjs`、`asin-data-table.mjs`、`asin-ui-preview.mjs`、`asin-redesign-check.mjs`、`asin-ui-diag.mjs`、`asin-add-dialog-diag.mjs`、`check-5173-asin.mjs`

---

## 侧边栏：业务域分级 + 交互与排版统一（2026-09-18）

### Change

- **需求**（用户原话）：①「当前项目中的侧边栏使用起来体验不够好，且排版不够规律合理，请你仔细分析后给出优化建议」；②「分级归类是否也需要一起修改」。执行范围经选项确认：**P1 + P2 + P3 全部补齐**；「任务中心」**独立成域**。
- **归类（信息架构）**：`sidebar-data.ts` 的 `navItems` 按业务域标注 `section` —— 工作台（仪表盘）/ 业务运营（我的 ASIN、竞品分析、产品开发）/ AI 工作台（AI 助手、提示词广场、知识库）/ **任务中心（独立成域，位于 AI 工作台之后、系统管理之前）** / 系统管理（AI 治理 / 用户管理 / 公告管理）。**URL 一律未动**，只改归类与顺序，历史链接不受影响。
  - **域标题同名去重**：`nav-group.tsx` 先按域合桶；**域标题与域里唯一一项同名时省略分组小字、改用一条分隔线**（「任务中心」即此形态），避免侧边栏连着出现两个同样的词 —— 与 2026-09-18「系统管理」那轮同一条口径。
- **层级一眼可见**：折叠类目（竞品分析 / 产品开发）加 `ChevronRight` 右箭头；**折叠成图标时隐藏**（32px 方块外会被 `overflow-hidden` 裁掉，留在 DOM 里会污染"折叠态里有什么"的度量与自动化选择器）；移动端保留点击内联展开、箭头随展开旋转。
- **位置反馈（P1）**：「任务中心」补 `matchPrefix` —— `/task-center/<id>` 详情页此前侧边栏整块失去高亮（用一个不存在的 id 深链实测复现）。竞品详情、AI 治理子页、知识库、提示词广场、我的 ASIN 的高亮复验全部命中。
- **浮窗开关（P1）**：`handleOpenChange` 的判据从"按下后时间窗内一律忽略关闭请求"收紧为"只忽略尚未打开时的关闭请求"，**再次点击同一入口即可收起**（桌面连续点击实测通过；Esc / 点击别处 / 选中子项关闭保持不变）。
- **排版与状态（P2）**：一级项 32 → **40px**（`h-10`）、移动端抽屉 **44px**（`max-md:h-11`）、折叠图标态仍 32px 方块、浮窗子项 **36px**（`h-9`）；品牌区与底部用户区保持 48px，三区左内边距统一 16px。**悬停与当前页分层**：悬停 `bg-sidebar-accent/60`，当前页 `bg-sidebar-accent` + `text-sidebar-primary` + `font-semibold`（此前两者同色，只靠字重区分）。**`SidebarRail` 的 `cursor-w-resize / e-resize` 改 `cursor-pointer`** —— 它只做点击折叠，不该暗示可拖拽改宽。
- **移动端（P1/P2）**：`SheetContent` 恢复明确的关闭按钮（此前被 `[&>button]:hidden` 藏掉，只能点遮罩或按 Esc 退出）并给品牌区 `pe-11` 让位；`nav-user.tsx` 点底部「用户信息」补 `setOpenMobile(false)`（此前 URL 已到 `/settings`、抽屉仍打开）。
- **文档与护栏**：`docs/modules/全局布局与导航.md` 更新一级类目清单（业务域版）、浮窗关闭口径，并新增"侧边栏排版与状态口径"六条；布局单测补 5 项护栏。

### 验证

- `src/components/layout` 单测 **50/50**（新增 5 项：业务域归域与顺序、任务中心 `matchPrefix`、同名域只用分隔线、只有折叠项有箭头、移动端点击关抽屉）；`tsc -b` / `eslint` 全绿。
- 新增只读审查脚本 `verify-artifacts/sidebar-audit.mjs`（真实 Chrome，桌面 1440 + 移动端 390；只导航、只读计算样式，不写任何数据）：分组标题、箭头、行高、悬停与当前页**色值**、浮窗点击开关、七条路径的详情页高亮、折叠态箭头几何、移动端关闭按钮与关抽屉 —— 补齐后**未达成项清零**。
- 回归 `server/verify-nav-ia.mjs` **35/35（跳过 2）**、`server/verify-page-shell.mjs` **38/38**（均在你自己的 5173 + 8787 实跑）。

## 知识库改为「提示词广场同构」：卡片 / 表格切换 + 工具栏搜索（2026-09-18）

### Change

- **需求**（用户原话）：「知识库参考提示词广场排版布局使用卡片和表格展示，同时也支持搜索，
  可以直接复用提示词广场界面」。
- **范围经选项确认**：改**个人知识库 + 团队知识库（员工）两个浏览面**，管理员治理视图
  （上传 / 批量下线启用删除 / 重建索引 / 状态筛选）保持表格 —— 那些动作靠表格一眼扫完；
  交互确认：**默认卡片、整卡点击开详情弹窗、搜索在顶部工具栏**。
- **先抽共享件（在出现第三份复制之前收口）**：
  - 新增 `components/list-layout.ts`（`ListLayout` / `CARD_GRID` / `readStoredLayout` / `useListLayout`）
    与 `components/layout-toggle.tsx`（`LayoutToggle`，DOM 与提示词广场原实现**逐字一致**，
    因此 `verify-prompt-optimize-ui.mjs` 一行未改即继续通过）；
  - `pages/prompt-square.tsx` 改为引用共享件、删掉页内那份；
  - 三个列表**各用自己的 localStorage 键**（`prompt-square-layout:v2` /
    `knowledge-notes-layout:v1` / `knowledge-team-layout:v1`）——
    在一个列表里选表格不该顺手把另外两个也切了。
- **个人知识库**（`note-space.tsx`）：去掉原来那层 `Card` 外壳，改成「标题 + 一行说明 +
  工具栏（搜索 / 状态 / 卡片表格切换 / 手工新建 / 导出）+ 卡片网格或表格」；卡片**整卡可点**
  打开 `NoteDetailDialog`（弹窗里可转编辑），卡上的编辑 / 归档 / 删除与表格**同名同禁用条件**
  （只是收成图标尺寸），「提交审核」与表格一样保留文字。
- **团队知识库**（`team-knowledge.tsx`）：工具栏（搜索 + 来源筛选 + 切换）→ 卡片（默认，
  整卡打开 `DocumentChunksDialog` 读正文切片）/ 表格 → 分页；两条路径打开同一个弹窗，**能力等价**。
- **管理员治理视图一行未改**（它才是"必须看状态、必须批量"的那一面）。

### 验证

- `verify-artifacts/knowledge-base.mjs` **28/28**（独立实例 5200 + 8788，真实库真实账号），
  新增断言：个人知识库有卡片 / 表格切换与搜索框、团队库**默认卡片视图 4 张**、
  工具栏搜索命中 1 篇、切表格后 4 行（两种读法等价）、偏好写入
  `knowledge-team-layout:v1`、整卡点开正文切片、员工只读（无上传 / 入库 / 新建）。
- `src/features/ai-agent` + 布局单测 **120/120**；`pnpm run lint` / `tsc -b` / `pnpm run build` 全绿。
- 回归：`server/verify-nav-ia.mjs` **35/35（跳过 2）**、`server/verify-page-shell.mjs` **38/38**
  （都在用户自己的 5173 + 8787 实跑）。

### 补充：管理员视图同样卡片化（同日第二轮）

- **用户反馈**：「修改后只有个人知识库修改生效了团队知识库修改并没有生效」。
- **根因**（先定位再改）：团队知识库自 2026-09-18 起**按角色分视图** —— 员工渲染只读的
  `TeamKnowledge`（新排版做在这里），**管理员渲染原治理页 `KnowledgeManagement`（仍是老表格）**；
  用户当前登录的是管理员账号，所以"没生效"。
- **改法（经选项确认走 A：管理员也走新排版，治理动作收进工具栏与卡片）**：
  1. `knowledge-management.tsx` 的 CardTitle「知识文档」→「团队知识库」，CardDescription 补一句
     "卡片视图用于逐篇读，批量请切表格"；
  2. 工具栏加 `LayoutToggle`（与员工侧**共用偏好键** `knowledge-team-layout:v1`）；
  3. 列表区按 `layout` 分支：**卡片（默认）** = 新 `ManagedDocumentCard`（整卡点开正文切片 +
     查看片段 / 设置有效期 / 下线启用 / 删除），**表格** = 原治理表格（多选批量、行操作一行未减）；
  4. 下线 / 启用的回调抽成 `toggleStatus()` 供表格与卡片共用（内联两处必然漂移）；
  5. 指标条、粘贴文本入库、纠错反馈区保持原样（治理台的其他部分）。
- **验收**：`verify-artifacts/knowledge-base.mjs` **30/30**（新增"管理员视图也有卡片 / 表格切换
  且默认卡片""管理员切到表格后治理动作仍在（查看片段 / 设置有效期 / 下线启用 / 删除）"）；
  `server/ai-agent/verify-admin-simplify.mjs` 的知识库段**在切表格后全过**
  （表格距顶 **334px**、首屏行数一致、重建索引菜单、切片与有效期弹窗、下线 / 启用按钮）；
  截图 `verify-artifacts/kb-04-管理员视图.png`。
- **未变**：员工侧只读视图、两个接口的权限边界、批量操作的入口（仍只在表格）。

## 知识库治理并入「知识库 → 团队知识库」，AI 治理去掉「知识库」子页（2026-09-18）

### Change

- **需求**（用户原话）：「知识库已经迁移到 AI 工作台下，ai 治理子页面不应该保留知识库」。
- **现状核对**：`/knowledge`（AI 工作台 → 知识库）= 个人知识库（可写）+ 团队知识库（只读）；
  `/admin/ai/knowledge`（AI 治理 → 知识库）= 791 行管理员治理页（上传 / 有效期 / 重建索引 /
  批量下线启用删除 / 纠错反馈 / 看已下线文档）。**改法经选项确认走 A**：治理能力并入团队知识库，
  员工仍只读。
- **改动**：
  1. `sidebar-data.ts` 的 `adminAiNavItems` 删掉「知识库」项（`Database` 图标一并移除）→
     AI 治理顶栏由五项变**四项**：数据源与导入 / 经验审核 / 模型与配置 / 审计台；
  2. `/admin/ai/knowledge` 改为**纯跳转** → `/knowledge?view=team`（保留路由，老书签与历史记录
     不会掉 `notFoundComponent`）；`/admin/ai` 索引落点随之改为 `/admin/ai/datasources`
     —— 否则点「AI 治理」会被转出治理区；
  3. `pages/knowledge-base.tsx` 的 `?view=team` 分支**按角色**渲染：管理员渲染原治理页组件
     `KnowledgeManagement`（**组件一行未改**，能力不丢），员工仍渲染只读的 `TeamKnowledge`；
  4. 旧入口 `/ai-agent/knowledge` 由「跳治理页」改为跳 `/knowledge?view=team`。
- **两条边界**：写动作会直接改变 RAG 检索结果 → 不能给全员；两个视图打不同接口
  （`useKnowledgeDocuments` 管理员专属 / `usePublicKnowledgeDocuments` 只回生效中文档），
  按角色分开渲染正好与「两份缓存互不污染」的既有口径一致。

### 验证

- 单测：`src/components/layout` **45/45**（新增「AI 治理四项不含知识库、落点是数据源与导入」
  护栏；面包屑与 `pickPageTitle` 的举例改用 `/admin/ai/datasources`）、
  `src/features/ai-agent` 与布局目录联跑全绿。
- `server/verify-nav-ia.mjs` **36/36（跳过 2）**、`server/verify-page-shell.mjs` **38/38** ——
  均在用户自己的 5173 + 8787 实跑；前者新增「旧链接 `/admin/ai/knowledge` →
  `/knowledge?view=team`」断言，后者面包屑用例改为 `/admin/ai/datasources`。
- `verify-artifacts/knowledge-base.mjs` **24/24**（独立实例 5200 + 8788 实跑）：UI 部分改用
  **员工账号**验只读（原先用管理员，按角色分视图后会读到管理视图），另开一个 context 验
  管理员视图（上传 / 入库 / 状态筛选在位）与旧链接跳转。
- `server/ai-agent/verify-admin-simplify.mjs`：**知识库段全过**（表格距顶 332px、重建索引、
  切片弹窗、有效期弹窗、下线按钮）且治理入口落点正确；该脚本随后在「更多沉淀操作」处
  超时中断、「经验审核：表格距顶距离」620px 未过阈值 —— **两处都在经验审核页，本轮一行未改**，
  属既有回归。
- `pnpm run lint` / `pnpm run build`（含 `tsc -b`）全绿。

## 全局布局：侧边栏浮窗不再重复一级类目标题（2026-09-18）

### Change

- **需求**（用户原话）：「悬停在一级类目下展示二级类目时不需要展示一级类目的标题」。
- **改法**：`src/components/layout/nav-group.tsx` 的 `SidebarMenuPopover` 删掉浮窗第一行的
  `DropdownMenuLabel`（一级类目标题 + 徽标）与紧跟的 `DropdownMenuSeparator`，
  子项直接顶到第一行；两个 import 一并移除。
- **为什么删掉不丢信息**：标题就在触发按钮的可见文本里，`item.badge` 也挂在同一个
  `SidebarMenuButton` 上（浮窗里那份是重复渲染），而浮窗唯一要回答的是"这个类目下有哪些子页"。
  可访问名不受影响：`DropdownMenuContent` 与触发按钮关联，按钮带 `aria-label={item.title}`。
- **只改桌面浮窗**：移动端（`isMobile`）仍是点击内联展开，标题由折叠触发器本身承担，
  不在这次口径内。

### 验证

- 真实 Chrome 实测两个折叠类目的浮窗内容：「竞品分析」2 项 `["分析","分析结果"]`、
  「产品开发」3 项 `["候选池","对比与历史","市场调研"]`，**均不含父标题**；
  截图 `verify-artifacts/sidebar-popover-no-title.png`。
- `src/components/layout` 单测 **44/44**（`nav-group.test.tsx` 3/3，断言按 `role=menuitem`
  定位、不依赖标题行）；`server/verify-nav-ia.mjs` **32/34（跳过 2）**，
  浮窗两处断言全过 —— 失败的两项是产品开发候选池的跨子页状态，与本改动无关（既有）；
  `pnpm run lint` / `pnpm exec tsc -b` / `pnpm run build` 全绿。

## 侧边栏：去掉「系统管理」同名折叠类目，治理入口平铺为一级项（2026-09-18）

### Change

- **需求**（用户原话）：「系统管理的分类下的一级类目也叫系统管理，现在不需要这个一级类目为系统管理了，
  系统管理下一级类目调整为 AI 治理和用户管理，公告管理」。
- **现象**：侧边栏上「系统管理」连着出现两次 —— 一次是 `section` 分组标签（灰色小字），
  一次是它下面**唯一**的折叠类目 `title: '系统管理'`（三个治理子项在浮窗里）。
- **改法（经选项确认走 A）**：`sidebar-data.ts` 删掉那个同名折叠项，三个治理入口直接挂在
  `section: '系统管理'` 下成为一级项，顺序为 **AI 治理 `/admin/ai`（`matchPrefix`）/
  用户管理 `/admin/users` / 公告管理 `/admin/announcements`**，逐个 `adminOnly`；
  分组名保留作归类。`Settings` 图标不再使用；`adminAiNavItems`（AI 治理的五个治理子页）不变，
  仍由顶栏中段导航承载。
- **有意取舍**：面包屑少了原本由折叠类目提供的那一层 —— `/admin/users` 由三级变**两级**，
  `/admin/ai/knowledge` 由四级变**三级**「仪表盘 / AI 治理 / 知识库」。
- **顺带修掉两处既有红测试**：
  1. `nav-match.ts` 的 `findNavTrail()` 把"候选就是路径本身"当作 `exact`，于是
     `/competitor-analysis/<ASIN>` 被前缀回退到「分析」时仍算精确命中，面包屑长出冗余第四级
     「仪表盘 / 竞品分析 / 分析 / 竞品详情」。判据收紧为**子项真的命中了这个候选**。
  2. `nav-children.test.ts` 仍断言「AI 助手」有两个子项（它 2026-09-18 已改单页类目）、
     `nav-filter.test.ts` 的可见类目清单漏了「知识库」。

### 验证

- `src/components/layout` 单测 **44/44**（breadcrumb 16 / nav-filter 4 / nav-children 9 /
  nav-group 3 / 其余 12），改前该目录 **9 项红**（2 项为本次顺带修复的既有失败）。
- `server/verify-nav-ia.mjs`、`server/verify-page-shell.mjs`、`server/ai-agent/verify-ui.mjs`
  的断言已同步（浮窗 → 平铺入口、面包屑层级、普通账号仍看不到整组），并在**用户自己的
  5173 + 8787** 上实跑前两个：
  - `verify-nav-ia.mjs` **34/35（跳过 2）** —— 新增的六条全过（分组下平铺三项 /
    「系统管理」只作为分组标签出现 1 次 / 三个入口都是 `<a>` / 点「AI 治理」直进
    `/admin/ai/knowledge` / 不再有「设置」/ 208px 不折行）。唯一失败项是
    「旧链接 `?view=items` 一路跳到 `/asin-watchlists/items`」：ASIN 模块已收敛为单页、
    该路由已删除，属**既有失败**（与本次无关）。
  - `verify-page-shell.mjs` **35/38** —— 治理面面包屑三级断言全过
    （`/admin/users` 两级、`/admin/ai/knowledge` 与 `/admin/ai/audit` 三级、
    只有根节点是可点链接）；三个失败项分别是 `/asin-watchlists/items`（路由已删）、
    `/ai-agent/notes`（我的沉淀已迁「知识库」）、「多页签不重名」（现在有两个「知识库」标签），
    均为**工作区既有改动留下的失败**，不属本次范围。
- `server/ai-agent/verify-ui.mjs` 的治理面断言同步但**未实跑**（会发起真实模型问答）。
- 顺带把两处用户可见文案里的旧导航名对齐：「设置 → AI 治理 → 模型与配置」→
  「**系统管理** → AI 治理 → 模型与配置」（`prompt-dialogs.tsx` 的禁用提示 +
  `server/ai-agent/prompt-library-routes.mjs` 的 400 原因，两处同源）。
- 前端全量 **374/378**，4 项失败**改前已红且与本次无关**：`auth-layout` 2 项（系统 Chrome 下
  `getByText('JHYP 智能工作台')` 同时命中 `<title>`）、`sign-out-dialog` 2 项
  （组件新增 `useQueryClient()` 而测试未包 `QueryClientProvider`，属工作区并行改动）。

## 竞品分析：标记已处理后，历史分析仍显示「需立即处理」（2026-09-17）

### Change

- **需求**（用户原话）：「在分析结果页标记为已处理后历史分析为什么还是展示需立即处理」。
- **先核实**：`history-panel.tsx` 的判定列读的是快照 `level`，销账后确实仍是红字「需立即处理」；
  首页「最近分析」的严重度列**同源同病**，一并修。
- **上一轮的判断错在哪**：我把列表归进"历史事实"口径（理由是"不篡改历史"）—— 只对了一半。
  快照判定确实是事实，但**列表要回答的是"这条记录现在还要不要我处理"**；
  用户销账后回到列表仍看到红字，唯一合理的解读就是"标记没生效"。
- **改法**：
  1. 服务端 `summarizeOpenFindings` 增加 `actionableCount` / `clearedCount`，`toHistoryItem`
     输出 **`clearedFindingCount`**。**必须由服务端算**：前端拿
     `findingCount - openFindingCount` 自己减会把 `info` 级算进去 ——
     一条都没销账也会显示"已销账 N 条"（本轮实测踩到，已加单测守住）。
  2. 新增共享组件 `src/features/competitor-analysis/components/history-level-badge.tsx`
     （`openLevel` 徽章 + 「已销账 N 条」），**竞品分析的「历史分析」表与首页「最近分析」表共用** ——
     两处各写一套必然分叉，而这正是本 bug 的成因。
- **保留的口径**：快照详情、结果页头卡、AI 对话列表仍用快照判定（它们回答"那次分析算出了什么"）。
  原始判定随时可查，所以这**不是篡改历史**，只是换了列表这一列要回答的问题。

### 验证

- 新增 `history-level-badge.test.tsx` **5/5**：销账后不再显示「需立即处理」/ 显示「已销账 N 条」/
  **部分销账时仍继续报 high**（不许因为销了一条就把级别压下去）/ 一条都没销账时不显示「已销账」/
  缺 `openLevel` 时回退到快照判定。
- 服务端单测 **19/19**（新增"`clearedCount` 只数待办"）；端到端 **33/33**
  （新增"历史分析的判定列显示「已销账 1 条」"断言）。
- 服务端全量 **638/638**、前端 **109/109**、`pnpm exec tsc -b` / `pnpm run lint` / `pnpm run build` 全绿。
- **真实数据实测**（用你在 #79 上的真实标记，全程未改动你的数据）：历史分析表该行由
  「需立即处理」变为「低风险 · 已销账 1 条」；首页「最近分析」同步标注；
  首页「需处理的分析」已把该记录排除。

## 竞品分析：修「需立即处理的结论不能标记」（历史快照没有诊断码）（2026-09-17）

### Change

- **需求**（用户原话）：「需立即处理的结论为什么不能标记」—— 交付后用户在真实页面上遇到的阻塞。
- **先复现再动手**：`analysisId=79`（首页「需处理的分析」里那条 `high` 记录）的
  `[data-finding-disposition]` 与 `[data-finding-claim]` 数量**都是 0**；新分析 `#89` 是 1 / 1。
- **根因**：处置台账的键是 `(code, target)`，而 `code`（诊断码）是 2026-09-17 才随
  `finding-fixes.mjs` 加进快照的 —— 更早落库的记录里 `findings` **没有 `code`**，
  处置块的渲染条件（`analysisId && code && dispositionTarget`）不成立，整块不渲染。
- **为什么是主路径而不是边缘情况**：首页报警指向的**恰恰是这些历史 high 记录**
  （新记录常常只是 medium），且它们会**永久报警**（`openLevel` 回退到快照 `level`），
  用户看到"需立即处理"却什么也做不了、也无处销账。
- **改法**：
  1. `legacyCodeFor(finding, index)` 给没有码的**非 `info`** 结论派生**记录内位置键**
     `legacy:<index>`（快照是冻结的 JSON 数组，同一条记录每次读出来的下标完全一致）；
  2. **回填与读取共用 `collectFindingKeys`**：迁移 **203** 回填历史记录的 `finding_keys`；
     `attachDispositions` 读取时补 `code` / `dispositionTarget` / `legacy`（老 `finding`
     原本连 `code` 都没有，前端拿不到键就没法调接口）；
  3. **`legacy:*` 永不参与自动核验**（`planDispositionUpdates` 显式跳过）—— 新分析里不可能
     出现这个键，硬核验会被判成"不再命中 → 已核验解决"，那是**假销账**；
  4. 界面在这类结论的按钮**上方**如实说明：可手动销账，但系统不会自动核验它，
     想自动核验请用同参数重新分析一次。

### 验证

- 单测 `server/finding-dispositions.node-test.mjs` **18/18**（新增两条：老快照派生位置键
  且跳过 `info` / legacy 行永不参与核验）。
- **真实页面 + 真实库实测**（`analysisId=79`）：处置区 1 块、按钮 1 个、legacy 说明出现 →
  点「标记已处理」变「待核验」→ 台账写入 `legacy:0|B0CTJGJL2T` →
  **首页 `openFindingCount` 2 → 1** → 撤销后台账删行、计数回到 2。**验证后未留任何台账行**。
- 迁移 **203** 已应用并核对回填结果：#86 得到 `legacy:0/1/2`；#87 是**混合**记录
  （自家结论 `legacy:*` + 公开结论保留真实码 `public_not_indexed`），说明派生逻辑对
  "部分有码"的历史快照同样正确。

## 竞品分析：结论处置闭环 —— 销账 + 下次分析自动核验（2026-09-17）

### Change

- **需求**（用户原话）：「这个板块立即处理应该如何处理 如果系统内无法处理是否应该给出按钮
  **用户修改完成后回到系统调整为修改完成**」。经选项确认四项：① 完成方式 = **两段式**
  （用户销账 + 下次分析自动核验）；② 系统外动作给「复制处理步骤 + 去任务中心 + 标记已处理」；
  ③ 首页「需立即处理 N」**联动**处置状态；④ 范围**只做竞品分析**。
- **要解决的根问题**：上一轮给了"处理什么 / 去哪里处理 / 怎么处理"，但**处理完没有任何回执** ——
  结论是每次分析用当期数据重算的（`result` 只是快照），用户无从表达"我改完了"，
  首页也会一直红字报警。
- **数据模型**：迁移 **202** 新增 `competitor_finding_dispositions`（**账号级**处置台账，
  唯一键 `(user_id, code, target)`，`target` 派生于 `targetAsins[0]` 并回落到本品 ASIN ——
  **用 ASIN 不用 SKU**，因为 ASIN 是"本次分析是否评估过该目标"的判据）+ `competitor_analyses.finding_keys`
  （可处置结论的轻量清单，供首页计数而**不读整份 `result`**）。
- **状态机**：`（无行）`待处理 → 点「标记已处理」= `claimed`（**只是销账**）→ 下次分析：
  不再命中 = `verified`（已核验解决）、仍命中 = `open`（**打回**，`reopen_count + 1`，记 `verify_detail`）；
  `verified` 再命中 = **复发**打回；`ignored`（不处理，**必填原因**）是**终局**，系统永不自改。
- **最容易犯的错已上护栏**：**只在本次分析评估过该 target（`result.asins`）时才判定** ——
  否则用户跑一次别的 ASIN 的分析，就会把所有待核验项误判成"已解决"（**虚假销账**）。
- **核验在两处落库路径上都调**：`POST /api/competitor-analyses` 与任务中心执行器
  （`task-center-runner.mjs`）—— 否则"从任务中心跑的分析不理解账"。
- **界面**：每条结论底部一块（`[data-finding-disposition]`）—— 状态徽章 + **四个真按钮**
  （标记已处理 / 不处理（原因内联必填）/ 复制处理步骤 / 提交后台分析任务）+
  `claimed`·`ignored` 时的「撤销标记」。打回时**如实显示**"你标记过已处理，但后续分析仍然命中"
  与本次仍命中的事实。**没有一个按钮是"点了没反应"的。**
- **口径分离（关键，别合并）**：`level`/`findingCount` = 那次分析的**快照判定**（历史事实，
  不被销账改写；历史表与 AI 助手列表用它）；`openLevel`/`openFindingCount` = **当下还要处理什么**
  （扣掉 `claimed`/`verified`/`ignored`；首页两张卡用它）。合并会分别导致"处理完还一直报警"
  与"篡改历史"。老记录缺 `openLevel` 时前端回落到 `level`，行为与改前一致。

### 验证

- 新增 `server/finding-dispositions.node-test.mjs` **18/18**（`LEVEL_RANK` 与 `FINDING_WEIGHTS` 一致性 /
  目标派生与回落 / 同码不同目标保留、同码同目标去重 / **老快照派生位置键且跳过 `info`** /
  报警口径汇总（`info` 级不算待办）/ 核验六种分支 + **"不在评估范围内一律不动"的虚假销账护栏** +
  **legacy 行永不参与核验** / `toHistoryItem` 的新旧两种口径）。
- 新增端到端 `verify-artifacts/check-finding-disposition.mjs` **32/32**（真实 Chrome + 真实登录 +
  真实后端 + 真实库，**零额度**：两次分析都取消全部公开数据维度并断言不出现非零预估）：
  处置块与四个按钮渲染 → 点「标记已处理」变「待核验」→ 台账写入 `claimed` →
  **「待处理」计数 2 → 1（首页联动）** → 再跑一次同参数分析（数据没变，必然仍命中）→
  **自动打回 `open`、`reopen_count=1`、记下本次仍命中的事实** → 界面如实说明 →
  服务端护栏（伪造结论 400 / 「不处理」缺原因 400 / 填原因成功 / 撤销即删行）→
  **老快照也能销账**（历史记录渲染处置区、台账键为 `legacy:<index>`、撤销不留痕 ——
  补的是交付后用户实测报上来的缺口）→ **验证数据自我清理**。
  **说明**：「已核验解决」分支需要"下次分析结论不再命中"，报表数据客观、脚本造不出来，
  该分支由上面的纯函数单测覆盖。
- **修掉既有脚本的一处假红**：`verify-artifacts/check-finding-actions.mjs` 9/9 —— 系统外步骤自
  2026-09-18 起默认折叠，而该脚本直接数 `ol > li`（恒为 0）；断言前先点开「查看处理步骤」即可
  （脚本与交互不同步，非本轮引入）。
- 服务端全量 **637/637**；前端相关测试 **104/104**（用 `vitest.chrome.config.ts` + 系统 Chrome ——
  本机 Playwright chromium 缺失且下载不通；含首页新增的"已销账不再计入「需处理」"断言，
  既有守护断言一条未改）。
- `pnpm exec tsc -b` ✓、`pnpm run lint` ✓、`pnpm run build` ✓。

## 竞品分析：「需立即处理」的结论可处置了（处理什么 / 怎么处理 / 去哪里处理）（2026-09-17）

### Change

- **需求**（用户原话）：「竞品与分析的结论与建议里面的需立即处理没有任何交互，
  继续处理是处理什么、如何处理、去哪里处理都没有」。经选项确认两条：
  **① 可点入口 + 三段式处置说明**；**② 系统外动作标注「系统外」并给出具体步骤**。
- **改前**：每条结论只有一个 `action` 纯文字建议，且三类内容混在一起 —— 系统内能做的
  （"到「数据源与导入」上传报表"）、只能在亚马逊后台做的（"排查 Listing 转化要素"）、
  只是判断的（"价格优势可支撑更高定价"）；徽章「需立即处理」是静态标签，点不动。
- **改法**：① 新增 `server/finding-fixes.mjs`：按**稳定诊断码**（`acos_up` / `stockout_risk` /
  `public_price_below` 等 20+ 个）生成 `fix = { what, links[], offSystem[] }`；
  ② 两处结论生成点为有处置动作的结论补码（自家 13 处、公开 9 处，`info` 认知型不给码）；
  ③ 收口处统一补 `fix`（自家 `finalizeFindings`、公开 `mergeFindings`），处置文案只有一份；
  ④ 前端新增三段式处置块：**处理什么**（🔧）、**怎么处理**（有序步骤 + 「系统外」标注）、
  **去哪里处理**（站内真实入口按钮）；⑤ **路由白名单**：服务端给的路径查不到就不渲染按钮，
  杜绝假链接；管理员专属入口（数据源与导入）对普通员工不渲染；⑥ 老快照无 `fix` 时回退到原有文字建议。
- **入口参数由页面补**：服务端生成结论时分析还没落库（拿不到 `analysisId`）、也拿不到类目关键词，
  因此由结果页 / 详情页 / 任务详情页通过 `linkContext` 传入；补不上的入口不渲染
  （例如没有类目关键词就不给"看这个类目的市场结构"）。

### 验证

- 新增 `server/finding-fixes.node-test.mjs` **7/7**（每个已定义诊断码都出非空方案 / `$asin` 缺参时
  丢弃该链接 / 未定义码返回 null 供回退 / 无空步骤与空按钮文案）。
- 新增 `verify-artifacts/check-finding-actions.mjs` **9/9**：真实登录后提交一次**零额度**分析
  （脚本取消勾选全部公开数据维度，并断言页面上不出现非零额度预估），断言「处理什么：」
  「去哪里处理：」与真实 `href` 入口（含补上的 `analysisId`）、「系统外」步骤 5 条、
  老快照仍回退到文字建议、零 JS 错误。**注意：该脚本每次会真实产生一条分析记录**（自家报表、不消耗额度）。
- 服务端全量 **616/616**；前端竞品分析 + AI 模块 **125/125**；`tsc -b` ✓、`vite build` ✓、`pnpm run lint` ✓。
- 截图 `verify-artifacts/check-finding-actions-new.png`（新形态）与 `check-finding-actions.png`。

## AI 助手：拦截提示按真实原因分层（修「工具没上线却显示"无权查询"」）（2026-09-17）

### Change

- **问题**（用户实测报告：「当前账号无权查询该数据，请联系管理员。」）：调取竞品分析记录时看到这句，
  但账号是管理员、权限判定实测为通过。查审计发现 **`ai_messages.status = 'blocked'` 是一条笼统状态**，
  至少三类完全不同的来源共用同一句文案：

  | 审计里的真实原因 | 实际含义 | 原提示 |
  | --- | --- | --- |
  | `not_implemented`（工具契约已播库但进程没有实现） | 代码合了没重启，**与权限无关** | "当前账号无权查询该数据" ❌ |
  | `forbidden`（账号停用 / 需要管理员） | 确实没权限 | 正确 |
  | `wording:*`（模型自行描述工具范围或直接拒绝，被权限护栏替换） | 与权限无关，换个问法即可 | "当前账号无权查询该数据" ❌ |

  用户那两次的审计 reason 分别是 `described_own_tools` 与 `model_refused_canonical` —— 都不是权限问题。
- **改法**：① `tools.mjs` 给"已注册但本进程没有实现"单独的拒绝码 **`not_implemented`**
  （不再与 `not_registered` 混用）；② 编排层按真实原因选文案：`not_implemented` → 新增的
  `TOOL_UNAVAILABLE_ANSWER`（明说"与账号权限无关"），其余仍是 `BLOCKED_ANSWER`；
  ③ 细分原因 `blockReason` 随 done 事件下发并落库；④ **迁移 119** 给 `ai_messages` 加
  `block_reason` 列，历史回看也能分辨；⑤ 前端 `blockedNoticeText()`（新纯函数模块 `blocked-notice.ts`）
  统一出文案，实时流与回答卡片共用同一处，不再两处各写一遍硬编码。
- **合规不变**：被护栏拦下的回答**正文**仍是统一文案（需求 §5.1 要求统一、避免泄露工具清单），
  "分开"体现在页面的提示条上。

### 验证

- 新增 `src/features/ai-agent/blocked-notice.test.ts` **5/5**：三种原因给出三种不同文案、
  工具不可用文案明说"与账号权限无关"、未知原因退回通用文案不编造；
- `server/ai-agent/tools.node-test.mjs` **16/16**（新增"已注册但未实现 → `not_implemented`，
  且不等于 `not_registered`"）；
- 服务端全量 **608/608**、`tsc -b` ✓、`vite build` ✓、`pnpm run lint` ✓（无警告）；
  `server/verify-competitor-tool.mjs` **18/18** 仍全绿。
- **迁移 119 已应用**（`ai_messages.block_reason` 已存在），后端已重启加载新逻辑。

## AI 助手：竞品分析记录可在对话里调取（2026-09-17）

### Change

- **需求**（用户原话）：「添加功能 竞品分析记录跟 AI 会话时也可以调取」。
  **两个决策点经选项确认**：① 返回**结论 + 关键数据块**（横向对比表、商品公开数据表；图表 / 流量词 /
  评论痛点只给文字要点）；② **只读历史记录，不做"在对话里重新分析"** —— 卖家精灵按调用次数计费，
  对话里顺手触发一次全维度分析（5 个 ASIN ≈ 22 次调用）会真实花钱。
- **新增工具 `query_competitor_analysis`**（`requiredRole: 'user'`，普通员工可用），三种调取方式：
  按记录号 `analysisId` / 按 `asin`（取包含它的最近一次）/ 都不传（列出最近 `limit` 条，默认 5、上限 20）。
- **数据来源是已落库的快照**（`competitor_analyses.result`）—— 与「竞品分析 → 分析结果」页读的同一份，
  因此对话里的数字与页面必然一致；**不重新取数、不调用卖家精灵、零额度消耗**，
  归属过滤沿用现有读取函数的 `user_id` 判据（越权当不存在，与页面 404 同口径）。
- **改法（四处，缺一处都不可用）**：① 新增 `server/ai-agent/competitor-history.mjs` 载荷层；
  ② `tool-contracts.mjs` 加契约（描述里写明只读、不消耗额度，否则模型会答成"我重新拉了一次"）；
  ③ `tools.mjs` 加执行实现（**无任何"重新分析"分支**）；④ `migrations.mjs` **新增迁移 118** 重播契约
  到 `ai_tools`（不重播模型看不见，与迁移 115 同理）。
- **一个必须记住的约束**：`orchestrator.mjs` 交给模型的结果里 `blocks` 只压成标题与行数，
  **模型看不到块里的数据** —— 所以关键指标（每个 ASIN 的花费/销售额/ACoS/转化率、公开属性）
  与逐条结论都拼进了 `summary`。

### 验证

- 新增 `server/verify-competitor-tool.mjs`（真实库、**只读**）**18/18**：工具已注册且对普通员工开放、
  三种调取方式全部命中、`summary` 含"不重新取数 / 不消耗额度"与关键数字、回答里的块只留结论表 +
  横向对比 + 公开数据且行数已截断到 20 行内、越权与不存在的记录号一律查不到、无用户身份明确拒绝、
  **调用前后 `competitor_analyses` 行数不变（64 → 64，未触发任何分析）**。
- 纯函数单测 `server/ai-agent/competitor-history.node-test.mjs` **9/9**；服务端全量 **608/608**
  （含既有的"迁移版本唯一且递增"检查，新增迁移 118 无冲突）。
- 迁移已在本机应用（`ai_tools` 里 `query_competitor_analysis` = 启用 / `user`）。
  ⚠️ **需要重启后端进程**：工具的执行实现来自进程内存里的 `tools.mjs` 模块，
  当前进程没有它（`ai_tools` 里已注册但执行时会找不到实现）。
- `docs/modules/竞品分析.md` 新增「AI 对话里调取分析记录」一节，`docs/modules/AI 助手.md`
  功能清单同步补一条。

## 竞品分析结果页：本品 / 竞品对比表统一归属配色（2026-09-17）

### Change

- **需求**（用户口径）：「竞品和本品的对比都参考按日对比（本品 VS 竞品）排版方式」。
- **改前实测**（1680 视口、记录 #78）：三张对比表里只有「按日对比」带归属色 —— 本品橙 / 竞品绿的
  分组表头 + 整组 10% 底色；**「ASIN 横向对比」是单行灰表头，本品列与竞品列完全同色**，
  「商品公开数据对比」的表格视图同理。
- **① ASIN 横向对比**：转置时为每个 ASIN 列补 `tone`（本品 `chart-1`、竞品依次 `chart-2…`）。
  渲染层本来就支持列 `tone`（表头 20%、数据格 10%），因此**没有改任何共享渲染代码**，
  只是把"这是哪一家的列"交给同一套配色口径。
- **② 商品公开数据对比（表格视图）**：新增纯函数 `transposeProductTable`，把"一行一个 ASIN、属性横铺"
  转置成"行 = 属性、列 = 一个 ASIN"（`属性 | <ASIN>（本品） | <ASIN>（竞品）…`）并同样补 `tone` ——
  与「ASIN 横向对比」的读法、配色完全一致。
- **③ TOP 流量词 / 差评高频词：行级归属色**（用户追问「TOP 流量词为什么没有同步调整」）。
  这一族表是"一行一个关键词 / 一个差评高频词"、归属写在**角色列**里，列上没法着色，
  于是给 `AnswerBlock.rows` 增加可选的 **`__tone`（1~5）行级渲染元数据**，
  由新增纯函数 `applyRowTones`（`role-rows.ts`）按 ASIN 分配档位并**保证本品永远是第一档**
  （差评高频词按词频排序会把竞品排到前面）；渲染层读 `row.original.__tone`，
  **排序后颜色跟着行走**。改前实测：TOP 流量词 30 行全白底；改后本品 15 行橙、竞品 15 行绿。
- **纪律**：三处改色/转置都**只动展示层**（缺失保持 `null`，渲染层显示「—」；前端不折算 0），
  且**对已落库的历史快照立刻生效**；服务端生成逻辑、接口与快照字段零改动。

### 验证

- 单测：`comparison-table.test.ts` **9/9**、`product-view.test.ts` **14/14**、
  `role-rows.test.ts` **8/8**（本品永远第一档 / 多竞品各一色 / 大小写归同色 / 超 5 个循环 /
  不改写原行 / 缺字段原样返回），竞品分析模块 **53/53**。
- **共享组件护栏**（新增）：`src/features/ai-agent/components/answer-blocks.test.tsx` **2/2** ——
  AI 助手回答卡片用的是同一个渲染层，断言"没有 `__tone` 的表单元格**不带任何底色**"
  与"有 `__tone` 时只给该行上色"，补上了这个共享组件此前缺失的测试。
- `verify-artifacts/check-competitor-findings-layout.mjs` **31/31**：在**含公开数据的记录 #79** 上跑
  （脚本新支持第二个参数指定记录 id —— 自动回落到的记录未必勾了公开数据维度）。
  新增断言：列归属色（本品列与竞品列表头都铺色且两色不同、数值列同样带色）、
  行归属色（同一角色的行同色且都铺色、不同角色不同色、无此类表时跳过）。
- `tsc -b` ✓、`vite build` ✓、`pnpm run lint` ✓；截图 `check-findings-layout-role-rows-1680.png`。

## 任务中心：由占位页落地为 Agent 任务（提交 → 服务端后台执行 → 报告回看）（2026-09-17）

用户原话「对任务中心进行开发」。三轮选项确认后定口径：**定位 = Agent 任务**（提交 → 服务端后台执行 → 产出报告，对齐《需求文档.md》§2.2）、**首轮只做「提交 + 立即执行 + 状态/结果」，不做定时**、**任务类型复用已有竞品分析链路**；单任务额度上限 **10 次**；验收允许真实消耗少量额度。

**要解决的根问题**：竞品分析此前必须在页面请求里同步跑完 —— 一次分析要打十几次外部接口（本品 2 次 + 每个竞品 4 次起），用户只能盯着转圈，切走或刷新就什么都不知道，也看不到"跑到哪一步、为什么失败"。

**新增**：迁移 **500** 建 `agent_tasks`（只存编排与状态：`params` / `progress` / `status` / `analysis_id` / `error` / `attempts` / 心跳，**不存结果快照**）；服务端三层 `server/task-center.mjs`（表与状态层：状态机、分页、抢占执行权、协作式取消、心跳与中断清理）、`task-center-runner.mjs`（任务类型注册表 + 进程内队列 + 阶段上报）、`task-center-routes.mjs`（6 个接口 + 审计）；前端 `src/features/task-center/`（列表页 + 新建任务弹窗 + 详情页 + api/format/types），路由由单文件改为目录（`route.tsx` + `index.tsx` + `$taskId.tsx`，**`/task-center` 入口不变**）。

**复用而非重写**（关键取舍）：执行器直接调 `analyzeCompetitor` + `recordCompetitorAnalysis`，因此任务产出的数字与结论与竞品分析页面**必然一致**；参数表单直接用 `AnalysisForm`、结论直接用 `FindingsPanel`、报告入口直接跳已有的结果页 —— 任务中心**不重建一份明细展示、不另存一份快照**（两份快照迟早会说两套数字）。为此给竞品分析侧加了两个**可选**扩展（不传即零行为变化）：`analyzeCompetitor(input, { onProgress })` 阶段钩子、`AnalysisForm` 的 `submitLabel`/`pendingLabel`/`callLimit`/`className`。

**四条口径（都写在界面上）**：① **不显示百分比进度**，只显示真实阶段（「第 4/5 步 · 采集卖家精灵公开数据」）与真实耗时；② **取消是协作式的** —— 排队中立即取消且零消耗，已在执行的只能等下一个阶段边界停，界面如实说明"已消耗的额度不退、本次不产出报告"；③ **进程中断不装死** —— 心跳停止 60 秒的任务由 `sweepStaleTasks()` 置为「已失败（执行进程已中断，可重跑）」，启动时清理遗留的排队任务，**绝不自动重跑**（自动重跑会在反复重启时反复烧额度）；④ **额度由服务端把关** —— 单任务预估超 10 次调用直接 400 并给出具体次数，界面提前禁用只是提示。

**验收**：服务端全量 **599/599**（新增 `server/task-center.node-test.mjs` 12 项：状态机、参数校验、额度上限、序列化、迁移号段）、前端任务中心 **7/7**（列表渲染真实阶段、空态、运行中/排队中取消的文案差异、重跑跳新任务、弹窗复用表单、超限禁用）、新增端到端 `server/verify-task-center-ui.mjs` **28/28**（真实 Chrome + 真实库：401/400/404/409 与超额拦截、心跳过期任务如实变失败、排队任务立即取消、提交接口立即返回 `queued`、真实执行一次并产出报告、跳转已有明细页、删除记录、零页面异常、验证数据全清）；**真实执行零额度消耗**（实际调用 **0** 次 / 命中缓存 **2** 次）。`lint` / `tsc -b` / `vite build` 全绿；截图 `verify-artifacts/task-center-{list,submit-dialog,detail-running,detail-succeeded,report}.png`。

**踩过的坑（已固化到责任田）**：① 迁移版本号最初用了 **400**，与产品开发的 `create_product_dev_tables` 撞号，迁移器以版本号为主键、见号已存在就**静默跳过** —— 服务正常启动但表没建，接口全 500；改用 **500** 号段并加单测断言。② 任务参数就是表单值（不含 `inputType`），而 `parseCompetitorInput` 要求它非空 → 提交一律 400「请选择分析维度。」；改由服务端在 `prepare` 里补全。③ vitest 浏览器模式首次渲染 Radix `Tabs` 时因依赖预打包导致 React 引用为空，组件测试内做了隔离替身。

**未做（下一轮）**：定时执行与周报/巡检报告、更多任务类型、通知渠道（飞书/邮件）、多实例部署下的持久化排队。

## 竞品分析结果页：顶部两张卡合并成一张，并删除口径卡（2026-09-17）

### Change

- **需求（三轮回合的最终口径）**：用户原话「数据口径与未接入维度确实需要删除。我要你优化最上方的几张卡片
  分析结果页面的顶部结论与建议」→ 上一轮我按"两张卡各自优化"改完后用户判定「优化得不够到位」，
  于是**先摆实测数据再问方向**（选项确认），最终口径是：
  **「合并成一张卡：顶部只留一层」** + **「数据来源与时效压成卡片底部一行小字」**。
- **改前实测**（1680 视口、记录 #79）：结果头卡 246px + 结论与建议卡 595px **合计 841px**，
  加页头 176px 已占首屏（1080px）的 94%；**判定徽章在两张卡上各出现一次**（同一判定说两遍）；
  头卡正文限宽 768px 而卡片宽 1256px，右侧约 **488px 常空**。
- **① 合并成一张卡**：结果头卡与结论与建议现在是**同一张 `Card`**，卡内三层 ——
  卡头（`结论与建议` + 判定徽章 + `共 N 条` → ASIN 列表 + 站点徽章 + 自动回落徽章 →
  统计区间 / 环比 / 分析时间）→ 一句话结论（竖条）+ 分组结论列表 → 卡片底部一行
  "数据来源与时效 + 公开数据调用次数 + 未收录 + 去市场调研"。**判定徽章只说一遍**。
- **② 结论列表与外壳解耦**：`findings-panel.tsx` 拆出 `FindingsSections`（结论列表本体，**不含**卡片外壳）
  供结果页嵌入；`FindingsPanel`（带外壳）继续给竞品详情页与任务中心详情页用 —— 两处共用一份内容，不复制。
- **③ 结论条目不做成内层卡片**：由 `rounded-lg border p-4` 改为**左侧 2px 严重度竖条 + `pl-4` 缩进**
  （`high` = `border-l-destructive`，其余 = `border-l-border`），一句话结论带同款竖条
  （`border-l-primary/60`）；层级只剩**卡片 → 分组 → 条目（无边框、无圆角、无背景）**。
- **④ 删除「数据口径与未接入维度」卡**：连同 `comparison.note` 与两组清单一起移除；
  **服务端 / 接口 / 快照字段零改动**，AI 助手链路不受影响。结果页也不再渲染
  "以下结论由服务端按预警线与数据规则算出…"那句说明（与分组 hint 重复）。
- **文案与数据零改动**：结论 `title` / `detail` / `action` / `evidence` 全部来自服务端。

### 验证

- `verify-artifacts/check-competitor-findings-layout.mjs` 重写为"顶部合并卡"口径后 **22/22**
  （1680 / 1280 / 1680-暗色 三视口）：**第一张卡同时装着「结论与建议」+ `统计区间` + ASIN + 分组**
  （改回"两张卡"就会失败）、合并卡正文 ≤ 780px、**结论条目计算样式为"上/右/下边框 0px、圆角 0px、
  左边框 2px"**（读 `getComputedStyle`，不是看类名）、一句话结论 2px 左边框、口径卡不再出现、
  无横向滚动、零 JS 错误；截图 `check-findings-layout-focus-top-1680.png` 等。
- `server/verify-competitor-results.mjs`、`server/verify-competitor-public.mjs` 的断言为**守护删除**
  （这两个脚本会真实消耗卖家精灵额度，**本轮未实跑**）。
- `tsc -b` ✓、`vite build` ✓、`pnpm run lint` ✓。效果（1680 视口）：顶部 841 → **781px**，
  结果页页高 5825 → **5741px**，首屏内可见 3 条结论（改前 2 条）。
- **理解偏差留痕（三次往返的原因）**：① 用户贴出长段卡片 + "删除"→ 我删对了；
  ② "我的意思是优化卡片"→ 我误判为"该卡要保留、只需重排"，把卡片还原了；
  ③ "优化最上方的几张卡片" + "优化得不够到位" → 才对齐到"合并成一张卡"。
  教训：长段引用 + "删除/优化"混在一起、或只给"不够到位"这类评价时，
  **先摆实测问题 + 给选项**，比继续猜快得多（本轮就是这么定下来的）。

## 竞品分析结果页：顶部结论区排版重排（2026-09-17）

### Change

- **需求**（用户口径）：「分析结果页面的顶部结论与分析优化文案的排版布局 当前展示方式不利于阅读」。
- **改前实测**（真实 Chrome、1680 视口、记录 #78）：结果头卡 166px、结论与建议卡 554px，但**正文段落
  横跨 1206~1256px 的卡片全宽**（中文约 100 字符/行），而舒适行宽是 65~75 字符；`统计区间 / 天数 /
  环比基线 / 分析时间` 用 `·` 串成一段小字，`ASIN 列表` 与 `站点` 挤在同一句标题里，数据时效与额度
  消耗又拼在同一段 —— 信息都在，但读起来是一片糊在一起的文字。
- **结果头卡拆成四层**（`analysis-results-page.tsx`）：① 标题行 = ASIN 列表 + 站点徽章 + 判定徽章 +
  「自动打开最近一次 #N」徽章（**徽章一律 `shrink-0 whitespace-nowrap`**，紧凑标签折行后会被读成两段信息）；
  ② meta 行 = 日历 / 环比 / 时钟三个图标各带一组信息，`flex-wrap` 按**整组**折行而不是从中间断开；
  ③ 一句话结论提一档字重与行距，成为这张卡的主视觉；④ 数据可靠性说明分成"时效"与"消耗 / 未收录"两段。
- **结论与建议**（`findings-panel.tsx`）：分组头改成带 `border-b` 的**区带**（标题 + 计数 + hint）——
  此前两组之间没有任何视觉边界；条目内徽章与标题改 `items-start` 对齐；建议动作块加边框（浅色主题下
  纯 `bg-muted` 灰底与卡片背景几乎同色，实测确认）；「依据 N 条」按钮左对齐标题。
- **所有正文段落统一限宽 `max-w-3xl`（768px）+ `leading-relaxed` + `text-pretty`**：结论面板说明、
  每条结论的 `title` / `detail` / `action` / `evidence`、头卡的结论与说明都适用。卡片内右侧留白是刻意的
  —— 阅读体验优先于填满宽度。判定依据取自 `ui-ux-pro-max` 的 UX 规则库（`--domain ux`：
  「Line Length：Limit to 65-75 characters per line / `max-w-prose`」「Line Height：1.5-1.75」
  「Compact Label Overflow：紧凑标签不应折行」）。
- **服务端 / 快照 / 文案来源零改动**：改的全是展示层类名与结构，结论文案仍由服务端规则产出。
  `统计区间`、`结论与建议`（`exact: true` 定位）、`公开数据调用 N 次（缓存命中 M 次，不计费）。`
  三个文本节点**原样留在同一个元素内**，四个端到端脚本的定位未受影响。

### 验证

- 新增只读检查 `verify-artifacts/check-competitor-findings-layout.mjs` **10/10**（真实 Chrome + 真实登录，
  1680 / 1280 / 1680-**暗色** 三轮 + 竞品详情页只读打开）：顶部两卡每个正文段落实测宽度 **全部 ≤ 780px**、
  三视口均无横向滚动、零 JS 错误（外部字体与商品主图噪声已白名单）。截图
  `check-findings-layout-focus-head-1680.png`、`-focus-findings-1680.png`、`-focus-findings-1680-dark.png`。
- `tsc -b` + `vite build` ✓、`pnpm run lint` ✓；前端单测 **332/334**
  （2 项失败在 `src/features/auth/auth-layout.test.tsx` 的品牌 lockup 断言，与本次改动无关）。
- 未跑需要消耗卖家精灵额度的端到端脚本（`verify-competitor-*.mjs`）；本轮改动为纯展示层，
  它们依赖的三个文本节点已逐项核对保留。

## 布局：顶栏面包屑 + 多页签工作台 + 可复用列表页壳（用户管理接入）（2026-09-17）

### Change

- **需求**：用户给出一组参考截图（吉加云 ERP「需求计划」列表页），要求按"左侧侧边栏 + 右侧主内容（面包屑 / Tab 标签栏 / 搜索框 / 操作按钮组 / 数据表格）"的结构落地。**三个决策点经选项确认**：① 页签栏做成**全局多页签 + 刷新保持**（照截图，未选"仅页内面板切换"）；② **面包屑取代现有"页面标题"**；③ 首个接入页为**用户管理** `/admin/users`。
- **改前现状核对**（先查后动）：侧边栏（一级类目 + 悬浮二级浮窗）**已具备**；**面包屑全仓库不存在**（无任何 `breadcrumb` 实现）；**页签栏不存在**；现有 `search.tsx` 是全局命令面板入口，不是列表检索；工具区由各页自己拼 `flex`。
- **面包屑**（`breadcrumb.ts` 纯函数 + `app-breadcrumb.tsx`）：`仪表盘 / 系统管理 / 用户管理`（根 / 类目层级 / 当前页，三到四级）。层级名由 `nav-match.ts` 的 `findNavTrail()` 从 `sidebar-data.ts` 反查，**与侧边栏同源**；根节点名取 `navItems` 里 `url: '/'` 那一项（跟着侧边栏叫「仪表盘」，不冒出第二个"主页"）；折叠类目（无落地页）只作层级标签渲染成 `span`，**不给点不动的假链接**；导航里没有的路径**逐级回退**到所属业务域（`/competitor-analysis/<ASIN>`、`/asin-watchlists/items`）或退化成"根 + 路由标题"（`/settings`）。**回退时只取业务域那一级当祖先**（保留回退层会让竞品详情页长出"仪表盘 / 竞品分析 / 分析 / 竞品详情"这种四级里的冗余第三级 —— 抽查时实测发现并修掉）。
- **修掉一个由多页签暴露出来的真实缺陷：页面标题重名**。`/asin-watchlists` 与 `/asin-watchlists/items` 都继承模块名「我的 ASIN」，`/admin/ai/*` 的五个治理子页都继承「AI 治理」——单页面上看不出问题，但多页签工作台里就会出现**两个「我的 ASIN」、五个「AI 治理」**，用户无法区分（实测截图确认）。修法是让这六个路由声明自己的 `staticData.title`（「商品明细」与五个治理子页名，**与各自顶栏中段导航项逐字一致**）。这也补上了项目"新增页面必须声明 `staticData.title`"这条口径的历史遗漏；面包屑因此在这类页面上是四级（`仪表盘 / 系统管理 / AI 治理 / 知识库`），层级是真实的、不是冗余的。
- **末级仍是全页唯一的 `h1[aria-current=page]`**：`pickPageTitle()` 从"渲染成单个 `h1`"改为"面包屑末级标题（导航里找不到同名项时的兜底）"，**`usePageTitle()` hook 删除**。这是 2026-09-11「顶部栏是唯一的页面标题位」的**加强而非推翻** —— 面包屑末级就是页面名，`asin-redesign-check.mjs` 的「h1 只有一个」断言**一字未改即通过**。
- **`nav-match.ts`：路径命中判定只留一份**：`isNavUrlActive()` 从 `nav-group.tsx` 的 `checkIsActive` 抽出，侧边栏高亮与面包屑共用同一口径。两份实现各写一遍必然出现"侧边栏点亮 A、面包屑却说是 B"，而且要各补一遍测试。
- **多页签工作台**（`src/stores/tabs-store.ts` + `page-tabs.tsx`）：挂在 `AuthenticatedLayout` 里 `Header` 之下、**整条通栏**（不跟 `Main` 的居中宽度 —— 它是工作区级信息，不属于任何单个页面）。语义用 `nav[aria-label='已打开的页面']` 而**不是** `role=tablist`：切标签就是导航到另一个路由，并没有一个跟着切换的面板。三条口径：key = pathname（**不含 search**，同一页换筛选条件不新开标签）、`sessionStorage` 刷新保持、**换账号即整份清空**（否则 `/admin/users` 这类治理标签会留给下一个登录的人点出 403）。**激活态以 URL 为准**、不看 store 的 `activeKey`；**关掉当前标签必须离开那个页面**（跳相邻标签，都没有则回首页）。它与顶栏中段 `HeaderSlot` **并存**：后者答"同级切换"（同模块、常驻），页签答"这次工作打开了哪些页面"（跨模块、可关闭）。
- **可复用列表页壳**（`list-page.tsx` 的 `ListPageShell` + `ListSearchInput`）：工具区两排（上排检索 + 筛选、下排动作按钮 + 右侧辅助项）。**刻意不含外框**（`DataTable` 自带一层 `rounded-lg border`，再包卡片就是本项目反复批评过的双层描边）；**刻意用插槽而不是配置数组**（各页工具区差异太大，配置数组只会把复杂度搬个地方）。
- **用户管理页接入 + 行多选批量启停**：检索框改 `ListSearchInput`（`label` 必填）；两个筛选与「开通账号 / 批量启用 / 批量停用 / 重置筛选」按两排归位；按截图补上多选列与批量启停 —— 复用 `use-row-selection`、**逐条调既有的 `PATCH /users/:id/status`**（不新增批量接口：服务端"必须保留一个启用管理员"是逐条判定的）、`allSettled` 收全部结果并把**服务端原话**透出来、批量停用走 `ConfirmDialog`（批量启用是恢复性操作，不拦）、**自己的那一行复选框禁用**（与行内按钮的既有闸门一致）、翻页 / 改筛选 / 改每页条数都 `clear()`。**未勾选时两个批量按钮置灰并在 `title` 写明原因**（对应参考截图里「生成采购单」的禁用态）。
- **接口、服务端、数据库零改动**；`DataTable` / `TablePagination` / `table-styles` 的既有契约按原样复用。

### 验证

- 新增 `server/verify-page-shell.mjs` **38/38**（真实 Chrome，跑在用户自己的 `localhost:5173` + 8787，**只读**：批量按钮只做 `disabled` 断言、**从不点击**，勾选的行在断言后立即取消）。覆盖：h1 唯一且是面包屑末级、面包屑三级与侧边栏同源、折叠类目不给假链接、页签打开 / 去重 / 激活 / 刷新保持 / 关闭当前标签跳相邻页、工具区两排齐备、批量按钮"未勾选置灰 → 勾选可用 → 取消回置灰"、改筛选清空已选、零控制台错误。另有 **13 个页面的面包屑抽查**（`/`、`/prompts`、`/asin-watchlists`、`/asin-watchlists/items`、`/task-center`、`/ai-agent/notes`、`/product-dev/market`、`/competitor-analysis`、`/competitor-analysis/results`、`/admin/users`、`/admin/ai/knowledge`、`/settings`），覆盖**四种层级推导方式**（精确命中一级叶子 / 精确命中二级子项 / `matchPrefix` 前缀命中 / 逐级回退），每条都同时断言"末级就是该页唯一的 h1"。**期望值在脚本里写死** —— 用 `buildBreadcrumb` 自己算一遍再比对等于没测。抽查中发现并修掉一个真实缺陷：`/competitor-analysis/<ASIN>` 这种"导航里没有的实体页"逐级回退后会产出**四级**面包屑（仪表盘 / 竞品分析 / **分析** / 竞品详情），修法是回退命中时**只取业务域那一级**当祖先（`NavTrail.exact`）。
- 新增单测：`src/components/layout/breadcrumb.test.ts` **15/15**（含"同名不重复""逐级回退""普通账号数据里不凭空出现系统管理"）、`src/stores/tabs-store.test.ts` **15/15**（含上限淘汰、关最后一个回首页、**换账号清空旧标签**）。
- 回归：`verify-artifacts/asin-redesign-check.mjs` **22/22**（含 h1 唯一）、`server/verify-nav-ia.mjs` **40/40**（跳过 1）。**首跑时"回到候选池后勾选仍保持"失败过一次**，复跑通过 —— 原因是首次运行时 dev server 正在按需冷编译（输出里 116 个模块请求被中断），页面在切页时被 reload，与本轮代码无关。
- 前端全量 **329/331**（2 项为**既有**的 `auth-layout` 文案同时命中 `<title>` 与 `<span>`）、`src/features/settings/users/index.test.tsx` **6/6**；`pnpm run lint` / `pnpm exec tsc -b` / `pnpm run build` 全绿。
- 截图：`verify-artifacts/page-shell-breadcrumb-tabs.png`、`verify-artifacts/page-shell-list-toolbar.png`。

## 首页（仪表盘）：概览统计同行 + 两个列表表格化 + 常用入口收紧（2026-09-17）

### Change

- **需求**：用户提出「基于现在的功能重构首页」。**三个决策点经选项确认**：① 加一条概览统计行、主操作与其同行；② 「需处理的分析」与「最近分析」都改数据表格；③ 常用入口改紧凑横排。**不改功能范围**：不新增接口、不新增数据源，页面提供的动作与跳转一个不少。
- **改前实测的首屏结构（1680×1000，真实数据）**：主操作条 **36px**（右侧约 1000px 空白）→ 常用入口 **199px**（3 张 `min-h-40` 大卡 + 每张常驻 32px 排序条；`xl:grid-cols-4` 只放 3 项，桌面端第四格永远是空的）→ **需处理的分析 880px**（3 条几乎相同的红框各占约 170px，**独占首屏 88%**）→ 最近分析与「我的 AI」**全在折线以下**（36+199+880 = 1115 > 1000）。**核心问题是主次倒置**：告警把同一结论重复三遍占满首屏，而"开始工作"的入口与信息主体被挤出视口。
- **新增概览统计行**（`overview-stats.tsx`）：需立即处理 / 分析记录 / 最近对话 / 知识沉淀，两个分析口径都标注「最近 20 次内」。**数据全部来自本页本来就要拉的两份数据**（`/competitor-analyses?limit=20` 与「我的 AI」的三个接口），**没有新接口、没有新算法、不引入任何经营指标**。**刻意不可点击**：点它跳页只是纯跳转，上方主操作与下方常用入口已经各有带上下文的真实入口。
- **「我的 AI」三个查询抽成 `use-my-ai.ts` 的 `useMyAiSummary`**：统计行与右下卡片共用一份 React Query 缓存，**请求数不变**（首页仍是五个请求）。两处各写一遍 `useQuery` 会让 query key 与 `pageSize=1` 这类口径复制两份，改一处漏一处就会出现"统计说 3 条、卡片说 5 条"。
- **主操作条与统计同行**：`action-bar.tsx` 不再硬编码 `mb-6`（在 `items-center` 的 flex 行里会把自己顶偏），间距交给调用方；三个带上下文的动作一个未动。
- **两个列表改数据表格**（`analyses-cards.tsx`，复用全站 `DataTable` + `table-styles` 列语义常量）：「需处理的分析」5 列（结论 / ASIN / 问题数 / 时间 / 操作，**880 → 319px**），「最近分析」6 列（查询 / 站点 / 问题数 / 严重度 / 时间 / 操作）。行首不再重复「需立即处理」徽标（整块标题已经说明）；**「最近分析」刻意不显示结论摘要** —— 这一块回答"做过哪些分析、结果严不严重"，把 `headline` 摆上来会让每行变两行、把列表重新拉高（既有单测有守护断言）。两种空态文案与"扫描范围"说明**逐字保留**。
- **常用入口改紧凑横排**：一行一项（图标 / 名称 / 说明 / 行内排序按钮），整块 **199 → 82px**，宽屏三列不再留空格。**排序能力一行未减**：拖拽（只从链接主体发起）、键盘可达的上移 / 下移按钮（带 `aria-label`、首尾禁用）、`aria-live` 播报、顺序持久化全部保留。
- **效果**：整页 `main` **1195px → 975px**，首屏同时可见概览、主操作、常用入口、全部 3 条告警与最近分析头部。
- **接口、服务端、载荷、数据库零改动**；`src/features/dashboard/index.test.tsx` 的 **17 项守护断言一条未改**。

### 验证

- 新增 `verify-artifacts/dashboard-redesign-check.mjs` **17/17**（真实 Chrome + 真实数据、**只读**：四项统计与口径标注 / 主操作与统计同一行 / 常用入口收缩且排序契约在 / 两个列表的表头 / 概览数字与表格行数一致 / 首屏可见性 / 宽窄屏均无横向滚动 / 零控制台错误）。
- 仪表盘单测 **49/49**（`index.test.tsx` 17 项未改、`analyses` 11、`shortcuts` 18、`action-bar` 3）；前端全量 **302/304**（2 项为既有 `auth-layout` 差异）。
- `pnpm run build`（含 `tsc -b`）与 `pnpm run lint` 全绿。
- 截图：`verify-artifacts/dashboard-before-full.png`（改造前）与 `dashboard-redesign-desktop.png` / `-tablet.png` / `-mobile.png`（改造后三档视口）。
- **修掉一个自己引入的缺陷**：两个表格的截断列最初写 `max-w-0 truncate`（宽屏好看），窄屏 390px 下整列被压成 `B…`、内容完全读不出来 → 改 `min-w-[16rem] max-w-[32rem]`，溢出交给表格自身的横向滚动，页面级仍不横向滚动。

## 竞品分析：站点 / 对比基线 / 统计区间 与 公开数据三选项各自压到同一行（2026-09-16）

### Change

- **需求**：用户口径「站点 对比基线 统计区间 缩减宽度并压缩到同一行」「还有竞品公开数据的三个选项宽度也缩减压缩到同一行」。
- **改前**：参数区是 `grid gap-4 sm:grid-cols-2 lg:grid-cols-3`，而统计区间带 `sm:col-span-2 lg:col-span-3` **独占整行**（上一节为避免 6 个预设溢出采取的写法）—— 结果一行只装得下站点与对比基线两个下拉，各自还撑满 1/3 列（1280 视口约 380px）的空白框，表单凭空高出一整行；公开数据维度是 `grid gap-2 sm:grid-cols-2`，**第三个选项「评论痛点」被挤到第二行**，三张卡各占半行宽、右半边全是空白。
- **改法（只动 `src/features/competitor-analysis/components/analysis-form.tsx` 的布局类；服务端、接口、提交值、表单状态零改动）**：
  - 参数区改 `grid gap-3 lg:grid-cols-[12rem_12rem_minmax(0,1fr)]`：站点与对比基线**按内容给足即止**（各 12rem，`SelectTrigger` 仍是 `w-full` 填满本列），统计区间吃掉剩余宽度，统计区间原有的 `col-span` 撤销。**6 个预设仍排得下一行**（1280 / 1680 实测）。
  - 公开数据维度改 `grid gap-2 sm:grid-cols-3`，卡片内边距 `p-3 → p-2.5`，并加 `min-w-0` + `leading-tight / leading-snug`：卡片变窄后 hint 文案正常换行，不撑破卡片。
  - `lg` 以下仍单列堆叠（窄屏并排必然溢出），`TabsList` 的 `h-auto max-w-full flex-wrap` **保留** —— 窗口更窄时预设折行，而不是把页面撑出横向滚动。
- **列宽为什么给 12rem**：宽度由内容决定 —— 站点最长当前值「自动（按数据推导）」9 个全角字 ≈ 126px，加 `px-3` 与箭头约 174px，12rem（192px）放得下且不留大片空白；对比基线最长项「环比上一等长区间」更短。

### 验证

- 新增只读检查 `verify-artifacts/check-competitor-form-layout.mjs`（真实 Chrome + 真实登录，1680 与 1280 两个视口实跑）：**23/23** —— 三项 `top` 完全一致且从左到右依次排列互不重叠、两个下拉宽度均 < 220px、站点当前值 `scrollWidth ≤ clientWidth`（「自动（按数据推导）」未被截断）、三张维度卡同一行且卡内文案不溢出、页面无横向滚动、零 JS 运行时错误；截图 `verify-artifacts/check-competitor-form-layout-1680.png` 与 `-1280.png`。
- `pnpm exec tsc -b` ✓、改动文件 `pnpm exec eslint` ✓（本页其它功能未触及，端到端脚本无需改断言）。

## 竞品分析：统计区间新增「半年 / 一年」+ 撤回 ASIN 角色化输入（2026-09-16）

### Change

- **需求**：用户提出「① 竞品分析页面的分析。统计区间的日期增加可选项 一年和半年 ② 输入框调整回之前那样 不使用逗号分割 使用换行分割即可」。第 ② 点经选项确认为**完全回到单框**（一行一个 ASIN，第一个仍是本品），且换行与逗号**都照旧可用**（服务端本来就同时认换行 / 逗号 / 顿号 / 分号）。
- **① 统计区间**：`WINDOW_OPTIONS` 增加「半年」（180 天）与「一年」（365 天）。服务端 `MAX_WINDOW_DAYS` 由 **180 放宽到 365** —— 只改前端会变成"页面能选、提交被 400 拒绝"；而 365 天本来就在自定义区间上限 `MAX_RANGE_DAYS`（366 天）之内，预设天数不该比自定义区间允许的范围更小。服务端 `WINDOW_PRESETS` 同步为 `[7, 30, 90, 180, 365]`，并在两侧都注明它们是**同一份口径**。
- **区间选择器的布局**：由 1/3 列改为**占满整行**（`sm:col-span-2 lg:col-span-3`），`TabsList` 改 `h-auto max-w-full flex-wrap` —— 6 个预设塞进 1/3 列必然溢出（1280 视口每格约 300px，6 个中文标签要 400px+），窄屏折行也避免把页面撑出横向滚动。
- **② 输入框撤回**：上一版的「本品一行 + 竞品可增删行」整体撤掉 —— 删除 `components/asin-role-rows.tsx` 及其组件测试，删除 `format.ts` 的 `extractAsin` / `splitAsinTokens` / `buildAsinRoleRows` / `divertAsinInput` / `MAX_ASIN_COUNT` / `MAX_COMPETITOR_COUNT`，恢复 `countAsins`；输入区回到**单框多行 Textarea**（Label 恢复"ASIN（第一个视为本品，其余作为竞品对比）"），提交值仍是 `asin.trim()`。
- **`verify-artifacts/competitor-ui-verify.mjs` 逐字还原**（`git diff` 为空）：输入定位回到 `getByLabel(/ASIN/)`，非法输入的断言回到"服务端中文原因 + toast 文案"—— 前端不再就地拦截格式错误，服务端校验路径与当时完全一致。
- **保留的两项增强**（用户未要求撤销）：额度预估按角色分项（本品 1 个 + 其余算竞品，空输入仍按 1 个 ASIN 预估，与改动前数字一致）、只识别出 1 个 ASIN 时提示"本次只分析本品，结果里不会有对比对象"；「开始分析」被禁用时仍给出原因（`data-form-blocker`）。
- **教训（写进责任田注意事项）**：把 ASIN 输入结构化成"角色槽位"与用户的实际习惯冲突 —— 他要的是**把一列 ASIN 直接贴进来**，而结构化输入把这一步变成了多步操作。**输入方式不要擅自改造**。

### 验证

- `src/features/competitor-analysis/format.test.ts` **2/2**：区间预设顺序与「半年 / 一年」标签、`countAsins` 的换行与逗号口径（含去重、链接、无法识别的片段不计数）。
- `server/competitor-analysis.node-test.mjs` **41/41**：新增断言"180 与 365 必须被接受、366 才越界"（原用例断言 365 越界，随上限放宽同步改写）。
- 竞品分析模块测试 **39/39**（组件测试随组件删除）、`tsc -b`、`pnpm run lint`、`pnpm run build` 全绿。
- **未实跑**：端到端脚本（需真实后端与卖家精灵额度）。

## 【已撤回】竞品分析：ASIN 输入改为「本品一行 + 竞品可增删行」的角色化输入（2026-09-16）

> ⚠️ **本节做法已于同日按用户要求「整体撤回」**（见上一节），代码、组件与脚本改动都已删除或还原。
> 保留这一节只为回溯"为什么当初那样做、为什么撤"。

### Change

- **需求**：用户提出「ASIN（第一个视为本品，其余作为竞品对比）输入框优化一下区分本品竞品输入框。你给出优化方案我来选择」。
- **改前的真实问题**：输入区是**一个 Textarea 承载两种角色**，"谁是本品"只写在 Label 括注里（"第一个视为本品"）—— 删除一行、改一个字符、乱序粘贴都会悄悄换掉本品，而服务端 `parseCompetitorInput` **严格按输入顺序**取 `primaryAsin`，错了要等 400 回包才知道；输入区也看不出谁是本品；「开始分析」被禁用时不说原因。
- **三个方案由用户敲定 → 方案 C（结构化行表）**：A 双输入框（本品单值 + 竞品 chip 输入，含粘贴自动分流）/ B 单框 + 实时角色预览 / C 本品锁定一行 + 竞品可增删行。用户选 **C**，并叠加四项增强：行内即时校验 + 按钮禁用原因提示、额度分项显示、竞品一键「设为本品」、竞品为空时提示"本次无对比对象"。
- **新输入区**（`components/asin-role-rows.tsx`）：本品一行（Badge「本品」、不可删）+ 竞品 0~4 行（添加 / 删除 / 「设为本品」与本品互换；空行的该按钮禁用，否则会把本品清空）。角色由**结构**决定，不再靠输入顺序。
- **解析与校验全部落纯函数**（`format.ts`，均可单测）：`extractAsin`（服务端 `extractAsin` 的**前端镜像**，规则从紧：只认 10 位字母数字本身或 `/dp/`、`/d/`、`/gp/product/` 链接里的那一段）、`splitAsinTokens`（与服务端 `ASIN_TOKEN_SPLIT` 同口径）、`buildAsinRoleRows`（**角色序号 / 行内中文原因 / 提交用 ASIN 列表的单一来源**，避免"界面显示竞品 2、提交时排在第 1 位"这类漂移）、`divertAsinInput`（多值输入按角色落位）、`MAX_ASIN_COUNT = 5`。删掉被取代的 `countAsins`（旧单框模型的配套函数）。
- **服务端、`api.ts`、类型零改动**：提交时照旧拼成一个 `inputValue`（本品在前、竞品按序在后），服务端仍按输入顺序分角色。
- **两处必须保留的兼容契约**：① 本品输入框的 id 仍是 `#competitor-asin`（`?focus=asin` 深链与五个端到端脚本按它定位"表单在不在"并往里填值）；② 往本品框**一次填入多个 ASIN 自动分流**（第 1 个留本品、其余顺次进竞品行）—— 旧习惯"一次粘 5 个"与脚本 `fill('A, B')` 都依赖它。
- **另外三处行为调整**：额度改成**分项**显示（本品 N 次 + 竞品 M 个 × K 次 ＝ 预估合计；未勾维度时写明不消耗额度）；「开始分析」禁用原因写在按钮下方（`data-form-blocker`），并删掉自定义区间原有的重复提示；在 ASIN 输入框按**回车不提交**（提交会真实消耗卖家精灵额度，误触不可逆）。
- **连带改动**：`verify-artifacts/competitor-ui-verify.mjs` 的输入定位由 `getByLabel(/ASIN/)` 改为 `#competitor-asin`（新结构下输入框 aria-label 也含 ASIN，按 label 定位会多匹配），非法输入的断言由"等服务端 400 文案 + toast"改为"就地中文原因 + 按钮禁用（不发请求）"—— 服务端 400 文案仍由 `competitor-analysis.node-test.mjs` 覆盖。

### 验证

- 新增 `src/features/competitor-analysis/format.test.ts` **16/16**：链接识别、分隔符、本品必填/格式错、竞品序号只按有效值排、与本品或前面竞品重复、多值分流（含起点之前不覆盖、超上限丢弃计数）。
- 新增 `src/features/competitor-analysis/components/asin-role-rows.test.tsx` **7/7**：一次填入多个按角色落位、增删竞品行、设为本品互换、空行按钮禁用、行内中文原因、回车不提交。
- 前端全量 **323/325**（2 项失败为**既有** `auth-layout` 的标题/品牌文案重复命中，与本模块无关）；`tsc -b`、`pnpm run lint`、`pnpm run build` 全绿。
- **未实跑**：`verify-artifacts/competitor-ui-verify.mjs` 等端到端脚本（需要真实后端与卖家精灵额度），其定位与断言已按新结构同步。

## 我的 ASIN：全页 UI 重构（取消左栏 + 两个视图拆成两个页面 + 指标总表）（2026-09-17）

### Change

- **需求**：用户提出「我的 asin 页面重新排版布局 彻底重构这个页面的 UI」。**四个决策点经选项确认**：① 只把「一键分析 / 商品明细」拆成两个页面、清单改用**顶部切换器**；② 切换器里是**清单数据表格**；③ 分析结果把「整体汇总」与「环比」**合并为一张指标总表**；④ 允许调整文案并同步更新验收脚本与责任田。
- **改前逐条实测的 7 个问题**：① 页面没有页面级标题，进来直接是左栏卡片；② `Card` 里再放 `DataTable`（自带圆角外框）＝**双层描边**，空态还套第三个虚线框；③ 同一件事说三遍（清单条计数 / 工具条"筛出 N" / 分页器"共 N 条"）；④ 视图页签悬在卡片之外，与上方清单条、下方内容都不成组；⑤ 明细卡头两行长说明常驻首屏，真正的动作（搜索 / 筛选）被压在折线以下；⑥ 别名列 `max-w-44`、备注列 `max-w-64` 与内容错配；⑦ 分析结果里**同一个指标出现两次**（广告花费 / 广告销售额 / ACoS…），且 10 张环比卡每张第三行都重复一句"对比上期 xx"。
- **两个视图拆成两个真实路由**：`/asin-watchlists`（一键分析，默认页）与 `/asin-watchlists/items`（商品明细）。路由由单文件 `routes/_authenticated/asin-watchlists.tsx` 改为目录 `asin-watchlists/{route,index,items}.tsx`（**旧文件已删除，事前获用户确认**）；页面级导航进 Header 中段槽位（`workspace-nav.tsx`），用 `<Link>` + `aria-current` 而不是 Radix `Tabs` —— 这是**页面**跳转，语义就该是链接。
- **当前清单落 URL（`?list=`）**：此前 `selectedId` 是组件内 `useState`，刷新即丢。列表为空或指向已删除清单时回落到第一条，脏值一律丢弃。**`?view=items` 与 `/ai-agent/asin-watchlists` 旧链接全部 `beforeLoad` 重定向到新路径**（旧书签、聊天里粘过的链接、旧脚本都还有效）。
- **跨页状态上提**（`workspace-context.ts` + `layout.tsx`）：分析参数与结果搬到模块布局 —— "跑完分析 → 去明细页补两条别名 → 切回来"不会再得到空白结果页，这正是运营最常用的动作序列。查询刻意不上提（React Query 缓存本就跨页共享）。
- **取消常驻左栏，清单收进「切换清单」面板**（`watchlist-switcher.tsx` + 重写的 `watchlist-panel.tsx`）：面板里是真正的数据表格（清单 / 站点 / 条目 / 更新于 / 行操作 + 搜索 + 排序）。原先 20rem 宽的左栏是从明细表那里借的宽度，而选清单是低频动作（一个会话通常只选一次）—— 首屏因此只剩"当前清单"与内容本身。
- **明细页**（`item-manager.tsx`、`watchlist-detail-table.tsx`、`item-toolbar.tsx`）：去掉外层 `Card`（消掉双层描边，空态也不再叠第三个框）；区块头只留一行说明，两个入口（添加 ASIN / 从表格导入）并排；**批量添加从常驻页尾改为「添加 ASIN」弹窗**（上千条的清单里那一块离表格十几屏远，而它是从任何位置都可能触发的动作），四分类导入结果回到页面上展示；别名 / 备注列加宽，明细表补吸顶与跳页。
- **分析页**（`analysis-panel.tsx` + 新增 `metrics-table.tsx` / `analysis-metrics.ts`）：参数条压成一行（区间分段 + 基线下拉 + 开始分析）；结果头保留「清单名 · 站点」+ 区间 / 基线 /「有数据 x / y」徽标，并**明确提示"这是上一个清单的结果"**（切了清单却看着旧数字是最危险的误读）；两块 metrics 合并为 `指标 / 本期 / 对比上期 / 变化 / 变化率` 一张表（11 行取代 16 张卡）。**变化列刻意不按"涨好还是跌好"着色** —— 花费涨是坏、销售额涨是好，同一方向在不同指标上含义相反，箭头只表达方向。
- **共享组件零改动**：`DataTable`、`TablePagination`、`ConfirmDialog`、`SortableHead`、`useRowSelection`、`AnswerBlocks` 全部按原契约复用（`AnswerBlocks` 仍渲染图表 / 结论 / 明细块，只是 metrics 块改由本模块的 `MetricsTable` 渲染）；接口、服务端、载荷、AI 工具契约、数据库结构**零改动**。
- **修掉一个自己引入的真实缺陷**（由 `verify-nav-ia.mjs` 抓到）：导航项未加 `activeOptions={{ exact: true }}` 时，TanStack `Link` 按前缀判定 active，`/asin-watchlists` 是 `/asin-watchlists/items` 的前缀 → 明细页上**两个导航项同时带上 `aria-current='page'`**（读屏会听到两个"当前页"）。

### 验证

- `server/verify-nav-ia.mjs` **40/40**（跳过 1 项普通账号未创建）：默认落分析页 / 点导航切到 `/asin-watchlists/items` / 刷新保持 / 深链直达 / `?view=bogus` 脏值不崩 / `?view=items` 与 `/ai-agent/asin-watchlists` 全部重定向到位。
- `server/ai-agent/verify-watchlist-ui.mjs` **22/22**（原 20 项随两页拆分适配：导航改链接、批量添加先开弹窗、删除清单走切换器面板，另加"弹窗成功后自动关闭"与"导航切到明细路由"两项）。
- `verify-artifacts/asin-ui-preview.mjs` **11/11**（真实库自检：302 条建单渲染 289ms、就地编辑、维度筛选、排序、跳页 + 行号 101、本页全选、导出 CSV、**指标总表五列齐全**、明细表仍在）。
- `verify-artifacts/asin-redesign-check.mjs` **22/22**（新增：页头层级 h1 唯一、两个页面导航、切换器面板里的清单表格、`?list=` 落 URL 且跨页保持、添加弹窗、三条旧链接重定向、零控制台错误）。
- `verify-artifacts/asin-ui-diag.mjs`（弹窗几何回归，改为覆盖两处 Textarea：新建清单弹窗与添加 ASIN 弹窗）、`asin-add-dialog-diag.mjs`（弹窗可点击性诊断）。
- 单测：新增 `analysis-metrics.test.ts` **7/7**、`format.test.ts` **9/9**；前端全量 **292/294**（2 项为既有 `auth-layout` 差异）；`pnpm run build`（含 `tsc -b`）与 `pnpm run lint` 全绿。
- 截图：`verify-artifacts/asin-v2-01…07-*.png`、`asin-redesign-01…05-*.png`。

## 提示词广场：完整正文改在弹窗里读，不再「展开拉长」（2026-09-17）

### Change

- **需求**：用户提出「优化提示词广场的展开功能 点击卡片后以弹窗的方式呈现而不是拉长」。经选项确认落地为：**卡片与表格视图都改弹窗**、弹窗**只读**。
- **改前的问题**：卡片视图的"展开"是让该卡 `sm:col-span-2 2xl:col-span-3` **跨满整行 + 正文全展开** —— 卡片等高靠 `auto-rows-fr` 保证，**一张卡变高会把同页其余卡片一起顶高**（点开一次整页跳动）；表格视图是"在操作列下方**插一行**"，行高被撑成几百像素、行序也不再整齐。
- **新增只读详情弹窗 `PromptDetailDialog`**（`src/features/ai-agent/components/prompt-dialogs.tsx`）：名称 + 状态徽章 + 创建人 / 更新时间 / 使用次数 + 完整正文（固定高度内滚动）+ 标签 + 驳回原因；元信息与列表卡片同口径（本人条目写「我」）。**提报 / 编辑 / 撤回 / 删除仍只在卡片与表格行上** —— 它们各有确认与状态流转，塞进详情浮层最容易误点。
- **卡片整卡可点**（`src/features/ai-agent/pages/prompt-square.tsx`）：`role='button'` + `tabIndex` + `Enter/Space` + hover 反馈，与数据源卡片同一形态；表格操作列的「展开全文 / 收起」改为常显的「查看全文」按钮；两条路径共用同一个 `openDetail`。卡片上另有一个纯**视觉提示** `span`「查看全文」，不套第三个按钮（避免两个重叠的可点区域）。
- **删掉两种旧展开**：卡片的跨列 class 与表格的"行下插一行"（连 `Fragment` 导入一起清理），`expandedId` / `toggleExpand` 状态整体下线，收敛为单个 `detailPrompt`；切换展示方式时顺手关掉弹窗。
- **两个必须的防御**：操作区容器 `onClick` 里 `stopPropagation()`（否则点「删除」会先弹详情、两个浮层打架）；按键处理里 `event.target !== event.currentTarget` 直接返回（焦点停在内部按钮上按 Enter 时 keydown 照样冒泡到卡片）。
- **接口、服务端、`types.ts`、`queries.ts` 零改动**。

### 验证

- `server/ai-agent/verify-prompt-optimize-ui.mjs` 新增 7 条断言 → **48/48 全绿**，跑在用户自己的 `localhost:5173` + 8787 上（真实 Chrome + 真实模型）。关键证据：点卡片弹出 1 个 dialog、**卡片尺寸 408×140 → 408×140 完全没变**、弹窗里读到「创建人 我 · 更新于 … · 使用 0 次」与 `p.whitespace-pre-wrap` 正文容器、Esc 可关闭；切到表格后「查看全文」打开的是同一个弹窗，且 `tbody tr` 行数 `2 → 2`（不再多插一行）。
- `pnpm run lint`、`pnpm exec tsc -b`、`pnpm run build` 全绿。
- 截图：`verify-artifacts/24c-prompt-detail-dialog.png`（卡片尺寸不变的详情弹窗）、`24b-prompt-square-cards.png`、`24b-prompt-square-table.png`。

## 提示词广场：卡片为默认，卡片上显示创建人与使用次数（2026-09-17）

### Change

- **需求**：用户提出「提示词广场使用卡片展示并显示使用次数以及创建人」。它与 2026-09-16 的「系统内所有内容优先使用数据表格展示」（当时经确认把这一页设为**表格为默认 + 保留切回卡片开关**）直接冲突，因此**先经选项确认**再动手，落地口径为：**默认卡片 + 保留表格切换**、两个字段**始终显示**（0 次也显示）。
- **默认视图改回卡片**（`src/features/ai-agent/pages/prompt-square.tsx`）：`readStoredLayout()` 由"只认 `card`、其余一律表格"改为"只认 `table`、其余一律卡片"。`LayoutToggle`、`CARD_GRID`、`PromptTable`、`DataTable` / `TablePagination` **一行未删** —— 表格仍是可切换视图：一条提示词要读的是 名称 / 创建人 / 使用次数 / 正文 四件事，卡片能一起摆开；需要按状态 / 更新于 / 使用次数横向比对时表格更合适。
- **卡片元信息行由条件渲染改为始终渲染**：此前 `{prompt.ownerLogin && …}` 与 `{prompt.usageCount > 0 && …}` 会让"没有作者"和"没人用过"整段消失，现在恒定输出「创建人 X · 更新于 T · 使用 N 次」；取不到作者写 `—`，**本人列表里创建人写「我」**（与表格「归属 / 共享人」列同一口径，不把上一轮已被否掉的长串账号登录名请回来）。
- **术语统一**：表格那一列表头由「调用」改为「使用」，同一指标不再在同一页面出现两种叫法。
- **偏好键换版本**：`prompt-square-layout` → `prompt-square-layout:v2`。旧键里可能存着"上一版默认（表格）之下的选择"，沿用旧键会让存过偏好的浏览器停在已废弃的默认上、看起来像改动没生效；新键让新默认对所有人生效，用户重新选择后仍被记住。
- **接口、服务端、`types.ts`、`queries.ts` 零改动**：`usageCount` 与 `ownerLogin` 早就在 `GET /api/ai/prompts` 的响应里。

### 验证

- `server/ai-agent/verify-prompt-optimize-ui.mjs` 的展示方式段重排为「默认卡片（含卡片上两个字段的正则断言）→ 切表格（列字段 + `localStorage` 为 v2）→ 切回卡片（网格与等高）」，**41/41 全绿**，且**直接跑在用户自己的 `localhost:5173` + 8787 上**（真实 Chrome + 真实模型）：进页面即命中卡片、卡片上读到「创建人 … · 更新于 … · 使用 0 次」、切表格后表头为「… ｜ 更新于 ｜ 使用 ｜ 操作」、`localStorage` 为 `prompt-square-layout:v2` = `table`、卡片宽 408 / 高 160 同页一致。
- `pnpm run lint`、`pnpm run build`（含 `tsc -b`）全绿；前端全量 **284/286**（2 项为既有的 `auth-layout` 标题与品牌文案重复命中，与本轮无关），`src/features/ai-agent` **65/65**。
- 截图：`verify-artifacts/24b-prompt-square-cards.png`、`24b-prompt-square-table.png`。

## 竞品分析：页面归位 —— 分析页只留参数与历史，「数据明细」改为「分析结果」并承载全部结果（2026-09-16）

### Change

- **需求**：「数据明细应该修改为分析结果，分析页面的分析结果卡片移动到新名称为分析结果页面内，分析结果页面内包含数据明细。**分析页面只保留需要分析数据的填充设置和历史分析，其他内容都放入到分析结果内**」。
- **① 页面职责重新划分**：

  | 页面 | 放什么 |
  | --- | --- |
  | 分析页 `/competitor-analysis` | **只有两件事**：参数设置（完整表单）+ 历史分析表 |
  | 分析结果页 `/competitor-analysis/results` | 结果头卡（判定 + 头条 + 区间 + 口径限制 + 未收录/取数失败 + 去市场调研）+ **结论与建议** + 全部数据块（含商品卡片）+ 数据口径与未接入维度 |
  | 竞品详情页 `/competitor-analysis/$asin` | 单个 ASIN 的详情（不变） |

- **② 改名 + 旧链接兼容**：「数据明细」→「分析结果」，路径 `/competitor-analysis/details` → `/competitor-analysis/results`；`details` 保留 `beforeLoad` 重定向（`analysisId` 原样带过去），收藏夹与聊天记录里的旧链接仍可用。侧边栏子项与顶栏子导航同源更新（`findNavChildren` 派生）。
- **③ 结果头卡与「结论与建议」从分析页搬入结果页** —— 判定与建议属于"分析结果"，与数据明细同页。
- **④ 分析成功后自动跳转结果页**（push 而非 replace：从结果页点「返回竞品分析」能回到分析页再跑下一次）；历史「回看」也进结果页。
- **⑤ 删掉分析页上的死代码**：原先的「参数摘要条」与「本次分析已完成卡」是给"有结果时收起表单"用的，但分析成功就跳转、组件卸载、`result` 状态不保留 —— 它们**永远不会显示**。删除后分析页只剩表单 + 历史（`index.tsx` 386 行 → 143 行）。
- **⑥ 修掉一个自己引入的死循环**：`SnapshotShell` 的「返回竞品分析」原本带 `analysisId`，而分析页收到该参数会**立刻转发回结果页**（那是给首页深链用的）—— 点返回就被弹回来，来回跳。改为返回链接不带参数（`analysisId` 仍用于右侧"当前查看…记录 #N"的显示）。

### 验证

- **效果**：分析页高度 **1750px → 1206px**（这条链路的最初值是 4499px）。
- 新增 `server/verify-competitor-results.mjs`：**25/25**（真实 Chrome + 真实库）—— 分析页无「结论与建议」、**只有历史分析这一张表**（用表格数量判据，避免被表单里的"月销量趋势对比"字样误伤）、无商品卡片；跑一次分析 → **自动进入结果页并带上记录 id**；结果页含结果头卡 / 结论 / 数据明细 / 口径声明 / 商品卡片 / 返回出口；顶栏子导航为「分析 | 分析结果」且只有当前页高亮；返回分析页后是**完整表单**；历史「回看」进结果页；**旧路径 `details` 重定向到 `results`**；结果页不带/脏 `analysisId` 与不存在记录三类异常；打开过程 `POST /api/competitor-analyses` 为 0 次。
- 四个既有脚本的流程随之改为"分析后等自动跳转"：`verify-competitor-daily.mjs` **11/11**、`verify-competitor-public.mjs` **16/16**、`verify-competitor-cards.mjs` **26/26**、`verify-artifacts/competitor-ui-verify.mjs` **22/22**。期间适配了两处**并行会话**改动的文案（表单计费提示由"本组合…预估约 N 次调用"改为"本品 N 次 ＝ 预估 N 次调用"），断言改用更宽松的判据。
- 前端单测 **66/66**（含布局导航）、服务端全量 **587/587**、`pnpm exec tsc -b`、`pnpm exec vite build` ✓。

## 竞品分析：「按日对比」两行分组表头 + 分组淡色底 + 表格块支持 `groups`/`tone`（2026-09-16）

### Change

- **需求（两轮）**：第一轮「数据明细内的本品竞品的数据对比…**按日明细**对比起来不方便，我需要一一对应本品跟竞品」；做完第一版后第二轮：「**这样不够明显** 应该这样：表头 本品 竞品，然后再是本品字段和竞品字段」。
- **最终形态：两行表头**

  ```
                                      本品（B0SAMPLE01）                    竞品1（B0B3JGBH5）
  日期         花费     销售额   ACoS(%)  订单  曝光    点击  销量 | 花费     销售额   ACoS(%)  订单  曝光    点击  销量
  2026-08-02   128.61   383.75   33.51    9     17199   98    10     79.15    211.06   37.5     5     17199   98    4
  ```

- **① 新增「分组表头」这一通用能力**（三处，全部可选、向后兼容）：
  - 类型：`AnswerTableGroup`（`{ label, span }`）+ `AnswerBlock.groups?`；约定 `groups` **只描述除首列以外的列**，`span` 之和 = 列数 − 1，首列由渲染层自动 `rowSpan=2`。
  - 服务端：`buildTableBlock({ groups })` 透传该字段（此前它只挑已知字段、会把 `groups` 静默丢掉 —— 第一版实测踩到）。
  - 前端：`answer-blocks.tsx` 的 `TableBlock` 在 `groups` 存在且 `span` 之和与列数对得上时渲染两行表头；**没有 `groups` 的表仍是单行表头**（AI 助手回答用的就是同一组件，端到端脚本有一条专门的护栏断言）。
- **②「按日明细」→「按日对比（本品 vs 竞品）」**：列按 ASIN 成组（本品 7 列 → 竞品 7 列），第一行是归属分组（`本品（B0SAMPLE01）` / `竞品1（B0B3JGBH5）`），第二行是各组的字段名（花费 / 销售额 / ACoS(%) / 订单 / 曝光 / 点击 / 销量）。**零额外查询** —— 竞品的按日数据来自 `analyzeCompetitor` 本来就取好的 `competitorPayloads`（之前只用了汇总，日粒度被丢掉）。日期取各 ASIN 的**并集**、缺失显示「—」（不折算 0）、全部 ASIN 无日数据时不产出该块；该块**替换**掉本品原来的「按日明细」（同一份数据不铺两遍）。
- **③ 整组列铺一层淡色底**（用户第三轮口径：「再为对应列填充对应颜色 颜色不要太鲜艳能看出来就行颜色淡一点」）：颜色取主题的**分类色** `--chart-1..5`（深浅两套主题各自有值，**不硬编码色值**），透明度压得很低 —— 数据行 **10%**、字段名表头 **20%**、分组表头 **25%**（形成一条色带），首列（日期）保持中性。档位由服务端下发（列上的 `tone` 与分组上的 `tone` 一致），渲染层只做类名映射；`tone` 越界（0/负数/>5）**不加底色**，宁可无色也不要用错色。Tailwind 不会为拼接出来的类名生成样式，因此三组类名是**写全的静态映射**。
- **④ 为什么否掉了第一版**：第一版是单行表头 + `花费 本品` / `花费 竞品1` 这类后缀，同一组字段的归属被重复 7 遍，扫一眼看不出"哪几列属于谁"（用户原话"这样不够明显"）。分组表头把归属提到一整行，一组只写一次。
- **⑤ 生效范围（重要）**：该块由服务端在分析时生成 → **只对新分析生效**。历史快照里没有竞品的日粒度数据，前端无法凭空补出来。所以看它需要：**重启后端** → 在分析页重新跑一次（同一批 ASIN 24h 内走缓存、不消耗额度）。

### 验证

- 服务端单测 `competitor-analysis.node-test.mjs` **41/41**：分组表头 `[{label:'本品（B0PRIMARY1）',span:7},{label:'竞品1（B0COMPETI1）',span:7}]` 且 span 之和 = 列数 − 1、一行一天、日期并集缺失为 `null`、无日数据的 ASIN 不占列、全无数据返回 `null`。
- 新增 `server/verify-competitor-daily.mjs` **11/11**（真实 Chrome + 重启后的新 API + 真实库）：跑一次新分析 → 出现「按日对比（本品 vs 竞品）」→ **`thead` 两行** → 第一行 `日期 | 本品（B0SAMPLE01） | 竞品1（B0SAMPLE02）` → 第二行 14 个字段列（每组 7 个）→ **读计算后的背景色**断言两组底色不同、首列中性、**透明度 ≤ 15%**（`oklab(… / 0.1)`）→ 30 天各一行 → 同一行两组值齐全 → 原「按日明细」已被替换 → 无控制台错误。**期间修掉脚本自身一个假通过**：透明度的解析只认 `rgba()`，而 Chrome 对 Tailwind 的 `color-mix` 返回 `oklab(… / alpha)`，解析成 `null` 后 `[].every()` 恒为 true —— 断言永远"通过"却什么都没验证。
- `server/verify-competitor-details.mjs` 27 → **28/28**（新增"没有 `groups` 的表仍是单行表头"的共享组件护栏）；服务端全量 **587/587**；`pnpm exec tsc -b`、`pnpm exec vite build` ✓。
- 截图：`verify-artifacts/competitor-daily-compare.png`。

## 竞品分析：「ASIN 横向对比」转置，本品与竞品逐指标并排（2026-09-16）

### Change

- **需求**：用户口径「数据明细内的本品竞品的数据对比 曝光 点击 花费 广告订单 广告销售额 ACoS(%) 销量 对比起来不方便 我需要一一对应本品跟竞品」。服务端给的这张表是**一行一个 ASIN、指标横铺**（`COMPARISON_COLUMNS`：ASIN / 角色 / 广告花费 / 广告销售额 / ACoS / 点击 / 转化率 / CPC / 广告订单 / 销量）—— 要比"本品与竞品的花费差多少"，得在两行之间左右来回扫，中间隔着 8 个单元格。
- **改法**：数据明细页渲染前把该表**转置**成"一行一个指标、一列一个 ASIN"，表头为 `指标 | <ASIN>（本品） | <ASIN>（竞品）…`，本品与竞品的值逐指标紧挨着。新增纯函数 `src/features/competitor-analysis/comparison-table.ts`（`isComparisonTableBlock` / `transposeComparisonTable` + 8 项单测）。
- **两个关键取舍**：
  1. **放在前端做，只重排、不算数字**：转置不动任何数值（缺失仍给 `null`，渲染层显示「—」）。好处是**对已落库的历史快照立刻生效** —— 若改服务端生成逻辑，只有新分析是新形态，用户当前正在看的那条记录还是旧样子，两种形态并存反而更难理解。
  2. **识别判据从严**：用"列键与 `COMPARISON_COLUMNS` 逐项一致"（`dataset: 'amazon_ads_daily'` 仅供参考），而不是标题文案 —— 既避免标题被改后静默失效，也不会误伤 AI 助手回答里同样带 `amazon_ads_daily` 的表（期间汇总、明细等）。

### 验证

- 新增单测 `comparison-table.test.ts` **8/8**：列头带角色、指标逐行相邻（`广告花费` 行同时含本品与竞品值）、缺失保持 `null`、认不出的块原样返回（不做半张表转置）、单 ASIN 也照转、`title`/`note` 口径声明不丢。
- `server/verify-competitor-details.mjs` 25 → **27/27**：新增"横向对比表已转置：表头是「指标 + 各 ASIN」"与"每个指标独占一行"两条断言（实测表头 `指标 | B0SAMPLE01（本品） | B0SAMPLE02（竞品）`，首行 `广告花费 3,855.37 2,372.58`）。
- `verify-artifacts/competitor-ui-verify.mjs` 21 → **22/22**（原"对比表含两个 ASIN 行"随形态改为"按指标逐行" + 新增"列头列出每个 ASIN 与角色"）、`server/verify-competitor-cards.mjs` **26/26**、`server/verify-competitor-public.mjs` **16/16**、`pnpm exec tsc -b` 与 `pnpm exec vite build` ✓、`pnpm run lint` 无本次改动引入的问题。
- 截图：`verify-artifacts/competitor-details.png`（转置后的对比表）。

## 竞品分析：主页只放「操作 + 结论 + 历史」，商品卡片移出主页（2026-09-16）

### Change

- **需求（用户提问）**：「竞品分析页面是否应该只显示 分析操作填写内容 和分析历史，其他内容应该展示在数据明细页面或者再加一个新页面展示。如果要加新页面展示，数据明细的哪些内容是否应该也一起迁移过去」。**先量面积再给判断**（不凭感觉重组信息架构）：

  | 主页区块 | 高度 | 占比 | 性质 |
  | --- | --- | --- | --- |
  | 参数摘要条 + 留白 | ~468px | 19% | 操作 |
  | 结果头卡（含一句话结论） | 198px | 8% | 结论 |
  | 结论与建议 | 540px | 22% | **结论（核心价值）** |
  | 明细入口卡 | 106px | 4% | 导航 |
  | 商品公开数据卡片 | **704px** | **29%** | **纯数据** |
  | 历史分析表格 | 448px | 18% | 回看 |

- **给出的判断**：① **不建议**"主页只留表单 + 历史" —— 分析的闭环是"提交 → 立刻读结论"，结论是用户花卖家精灵额度换来的唯一产物，搬走会让刚跑完分析的人再多跳一次；三页（操作 / 结论 / 数据）对"读一次分析"是过度拆分。② 真正该动的是**占 29% 的商品卡片**：它是纯数据展示、且与明细页重复。③ **明细页的内容不需要再迁出去** —— 它已经只有"数据块 + 口径声明 + 卡片"；若将来真要加第三页，正确切法是按【判断 / 数据】切，而不是从明细页搬东西。**经选项确认**：走「主页去掉商品卡片」+「结论的『依据』默认折叠」。
- **① 主页去掉商品卡片**：删除主页的 `ProductView` 卡片区与"无商品数据"说明卡；卡片此后只在 `/competitor-analysis/details`（那里卡片默认、可切表格）。主页计算的 `productSplit` / `productItems` / `hasPublicDimension` 与相关导入一并删除（主页不再渲染任何 `blocks`）。
- **② 明细入口卡文案**：改为"本次分析的 N 个数据块（自家报表横向对比、库存联动、**商品卡片与公开数据**、流量词、评论痛点）与数据口径声明都在明细页"。
- **③ 结论的「依据」默认折叠**（`findings-panel.tsx`）：`evidence` 是可复算的原始数字，属"要核对时再看"的层；此前每条结论都常驻一行"依据：…"，把 3 条结论撑到 540px。现在判定 / 标题 / 事实 / 建议动作留在明面，点「依据 N 条」展开为列表。

### 验证

- **效果**：主页 **4499px（最初）→ 2464px（明细搬走后）→ 1750px（卡片搬走后）**，结论距页顶 465px（首屏内）。
- `server/verify-competitor-details.mjs` **25/25**（新增"主页不再出现商品卡片"；素材判据由"主页有卡片"改为"主页有结果"——卡片已不在主页）。
- `server/verify-competitor-cards.mjs` **26/26**（素材改在数据明细页里找 + 新增主页无卡片断言）。
- `server/verify-competitor-public.mjs` **16/16**（卡片与表格切换断言整体迁到明细页）。`verify-artifacts/competitor-ui-verify.mjs` **21/21**、竞品模块与布局单测 **37/37**、`pnpm exec vite build` ✓。

## 竞品分析：明细页去噪、卡片进明细页、回看跳明细页（2026-09-16）

### Change

- **需求（用户一次提了四件事）**：① 明细页最显眼的位置有四段平级小字（未指定记录的说明、数据块排列顺序与"不可相加"声明、数据时效、额度消耗与维度列举）——「这段无意义的内容为什么要展示在最显眼的地方，分清主次」；② 「商品公开数据（卖家精灵）这个卡片也应该放进数据明细页，且点击回看时自动跳转到数据明细页」；③ 分析页的「还没有分析结果」卡并列 5 条说明要点，同样占位置；④ 「检查其他页面是否也有类似情况，如果有帮我一起优化解决」。
- **① 明细页摘要卡只留三件事**：这次分析是谁（ASIN · 站点 · 区间 · 判定）、服务端的**一句话结论**（`headline`）、**一行**数据可靠性小字（数据时效 + 公开数据调用次数 + 未收录数量；取数失败单独一行红字）。**删掉**数据块排列顺序说明与维度列举 —— 每块自带 `note` 来源标注，"自家与公开数据不可相加"的口径在块的 `note` 与「数据口径与未接入维度」里都写着。自动回落的整段说明压成标题旁 Badge「自动打开最近一次 #N」。
- **② 商品卡片进明细页**：明细页对 `sellersprite_products` 块同样交给 `ProductView`（卡片默认、可切表格）—— 卡片不再只是主页的形态，它是这块数据的默认读法。
- **③ 历史「回看」跳明细页**：由"主页内联加载快照 + 历史快照徽章"改为 `navigate` 到 `/competitor-analysis/details?analysisId=<id>`。主页因此只在"刚跑完一次分析"时持有结果；`?analysisId=` 深链仍会让主页展示那次的结论与建议。明细页标题旁给了「看结论与建议」按钮回分析页。
- **④ 分析页空态压成一句话**：「还没有分析结果」从 5 条要点（覆盖范围、数据来源、结论口径、库存联动、计费规则）压成"输入 ASIN 后开始分析，结果会自动保存到下方「历史分析」"。另把主页结果头卡的公开数据行去掉维度列举（维度与消耗的完整口径在明细页）。
- **⑤ 全站同类问题盘点与清理**：逐页扫描首屏（14 个路由）后，同类"空态堆要点"共 3 处（竞品分析 1 处、产品开发 2 处），全部压成一行口径；其余页面的说明都属必要口径且位置在数据之上，未动。产品开发的「还没有对比结果」「还没有调研结果」改法记录在 `docs/modules/产品开发.md`。

### 验证

- `server/verify-competitor-details.mjs` **25/25**：新增"商品公开数据以卡片形式出现在明细页（含展示方式开关）""明细页不重复渲染结论卡片、但有「看结论与建议」跳转"。
- `server/verify-competitor-cards.mjs` **25/25**、`verify-artifacts/competitor-ui-verify.mjs` **21/21**（新增"点「回看」跳到数据明细页"）、`server/verify-competitor-public.mjs` **16/16**、竞品模块与布局单测 **37/37**、`pnpm exec vite build` ✓、`pnpm run lint` 无本次改动引入的问题（`src/features/asin-watchlist/**` 有并行会话在建代码的 2 条既有报错，非本次改动）。
- 截图：`verify-artifacts/competitor-details.png`（去噪后的数据明细页）。

## 竞品分析：补子页入口 + 子页直接打开即有内容（2026-09-16）

### Change

- **动因（用户口径）**：「为什么没有直接展示在子页面 且没有直接的子页面入口」。这是上一轮「主页减负」的**设计缺口**：数据明细拆成独立路由后只做了"结果卡上的一个按钮"，于是这个子页在导航里根本不存在（侧边栏进不去、命令菜单搜不到、两页之间只能"回主页再点一次"）；而且不带 `analysisId` 打开时只给一句"缺少分析记录 id"，等于打开一个空页。按项目既有规则（「阶段 B」：二级子页必须有真实路径与导航入口、顶栏与侧边栏同源派生）补齐。
- **① 侧边栏「竞品分析」由叶子改折叠类目**：子项「分析」`/competitor-analysis` 与「数据明细」`/competitor-analysis/details`（与「产品开发」同一形态）。**竞品详情页 `/competitor-analysis/<ASIN>` 刻意不进导航** —— 它是"从卡片点进去的单个竞品"，顶栏里算作「分析」。命令菜单遍历 `sidebarData`，因此子页同时可被搜索到。
- **② 顶栏中段子导航**：新增 `features/competitor-analysis/components/analysis-nav.tsx`（子项用 `findNavChildren(sidebarData.navItems, '竞品分析')` 同源派生，不另写一份字面数据），在模块布局 `competitor-analysis/route.tsx` + `features/competitor-analysis/layout.tsx` 里注入 Header 槽位。布局**不包 `Main`**：三个页面各自已渲染 `<Main>`，再包一层会出现 `<main>` 嵌套。
- **③ 子页直接打开即有内容**：明细页缺 `analysisId` 时自动回落**最近一次有快照的分析**；竞品详情页自动回落**最近一次包含该 ASIN 的分析**（拉 20 条摘要里筛 —— 最近一次分析未必包含这个 ASIN）。两者都在页面顶部说明"未指定分析记录，自动打开最近一次（#N）"，真的一条都没有时才给空态并引导去分析页。查询键刻意不复用主页的 `['competitor-analyses']`（那边 `limit=10`，同键会互相覆盖条数）。
- **④ 高亮口径的实证修正**：导航项挂 `data-nav-item` / `data-active`。原因：TanStack `Link` 自己按**前缀**算 `aria-current`，在 `/competitor-analysis/details` 上「分析」也会带上它（实测两个元素都命中），用它判断"当前哪一页"会错。
- **⑤ 单测随形态更新**：`nav-children.test.ts` 把"叶子类目举例"从「竞品分析」换成固定入口页（它已不是叶子），并新增「竞品分析两个子项」的护栏断言。

### 验证

- `server/verify-competitor-details.mjs` 19 → **24/24**：新增顶栏子导航出现 / 两项与侧边栏同源 / 当前页高亮唯一、不带 `analysisId` 直接打开自动展示最近一次分析、脏 `analysisId` 回落、回落时确实渲染数据块。
- `server/verify-competitor-cards.mjs` 24 → **25/25**：新增详情页自动回落断言。**期间修掉脚本自身的素材筛选缺陷**：原先只挑"有卡片的记录"，而演示 ASIN 在卖家精灵未收录、卡片只有"无主图"占位，用它验"卡片包含图片"必然失败 —— 改为要求"卡片带主图"才作为素材（翻查上限 6 → 10 条），并给历史列表加显式等待（它是另一个查询，返回比表单晚）。
- `verify-artifacts/competitor-ui-verify.mjs` **20/20**、`server/verify-competitor-public.mjs` **16/16**、`nav-children.test.ts` **8/8**；lint、`tsc -b`、`pnpm run build` 全绿。
- 截图：`verify-artifacts/competitor-nav-sidebar.png`（侧边栏折叠子项 + 顶栏子导航）。

## 竞品分析主页减负：结论留主页、数据明细拆成子页（2026-09-16）

### Change

- **需求**：用户提出「当前竞品分析页面展示内容过于复杂，不方便用户查看阅读，且主次不明确，有必要的话可以在竞品分析分出一个子页面，你可以提供多个方案让我来敲定」。**先量化诊断再给方案**（不凭感觉说"太乱"）：用真实快照实测主页 **4499px ≈ 4.2 屏**，并逐块量出面积 —— 输入表单 466px、结果头卡 226px、**结论与建议 666px（仅 15%）**、ASIN 横向对比表 504px、商品卡片 724px、公开口径与趋势/流量词/评论 600px+、数据口径与未接入维度 374px、历史 448px；**首屏（1080px）只装得下"表单 + 结果头卡"**，最该先看的结论只能露个开头。三条结构性问题：① 表单（一次性输入）常驻首屏，回看历史时也占 466px；② 结论被 60%+ 面积的明细压在下面；③ 明细有 12+ 个平级区块，中途没有"我在哪"的坐标。据此给出 4 个方案（A 结论留主页 + 明细子页 / B 拆三页 / C 只做折叠与锚点 / D 最小改动），**经用户敲定方案 A + 表单收起**。
- **① 新增「数据明细」子页** `/competitor-analysis/details?analysisId=<id>`（`components/analysis-details-page.tsx`）：承载**全部数据块**（按服务端顺序：本品自家报表 → 横向对比 → 库存联动 → 卖家精灵公开数据）、数据时效与额度消耗、以及「数据口径与未接入维度」。块的顺序**沿用服务端**，不按标题文案重新分组 —— 标题是给人看的文案，按它分类一旦被改动就会静默错位。
- **② 主页只留结论与入口**：参数摘要条 + 结果头卡 + 结论与建议 + 商品卡片 + 明细入口 + 历史分析表格。
- **③ 输入表单有结果后收起**（`showForm = result === null || formOpen || autoFocusAsin`，展开入口 `[data-form-expand]`）：收起时渲染一行**参数摘要**（ASIN 列表 + 站点/区间/对比基线 + 已取维度），读结论时仍知道"这是哪个区间、哪几个 ASIN"；点「修改参数，重新分析」展开完整表单；首页 `?focus=asin` 深链进来始终展开。
- **④ 结论的主次靠排序与折叠表达**：`findings-panel.tsx` 组内按严重度排序（**稳定排序，只影响展示、不改数据**），`info`（提示级）默认收起、显式展开 —— 它与"需立即处理"不该抢同一屏。
- **⑤ 顺带收敛重复**：两个子页共用 `components/snapshot-shell.tsx`（返回条 + 异常/空态卡）与 `api.ts` 的 `apiErrorMessage`（删掉主页里那份同名私有实现）；快照参数解析器 `parseAsinDetailSearch` → `parseSnapshotSearch`（详情页与明细页共用同一语义与同一个 React Query key，三页互跳不重复请求）。

### 验证

- **效果（同一条记录实测）**：主页 **4499px → 2606px**，结论距页顶 **521px**（进入首屏），明细全部可用。
- 新增 `server/verify-competitor-details.mjs`：**19/19**（真实 Chrome + 真实快照、只读）—— 无结果时表单展开、有结果时收起为摘要条、结论进首屏、明细块不在主页、点明细入口跳子页并带 id、明细页承载数据块与口径声明、明细页不重复结论、**打开明细页 `POST /api/competitor-analyses` 为 0 次**、三类异常输入不白屏、无控制台错误。
- `verify-artifacts/competitor-ui-verify.mjs` 扩到 **20/20**（新增"分析后表单收起""明细页渲染期间汇总/库存/横向对比""1280 视口明细页无横向滚动"；取数动作统一先 `openForm()`、查明细统一 `openDetails()`）。**期间修掉脚本自身一个隐患**：等新结果落页原先用"页面出现「结论与建议」"，而上一次分析的结果还在页面上 → 条件立刻通过、后面拿到的是**旧快照**（表现为"明细页没有横向对比表"），改用"表单收起"作为新结果信号。
- `server/verify-competitor-public.mjs` 的明细类断言迁到明细页后 **16/16**（实际调用 0 次 / 缓存命中 4 次）；`server/verify-competitor-cards.mjs` 的就绪信号改为"表单或摘要条"后 **24/24**；竞品模块单测 **29/29**；`pnpm run lint`、`pnpm exec tsc -b`、`pnpm run build` 全绿。
- 截图：`verify-artifacts/competitor-home-slim.png`（减负后的主页）、`competitor-details.png`（数据明细子页）。

## 侧边栏归类重排：阶段 D ——「设置」拆为「系统管理」，治理项迁 `/admin/*`（2026-09-16）

### Change

- **类目改名与重定位**：原「设置」类目下三件事全是**公司级治理**（账号、广播、AI 治理），而 `/settings` 路径段同时装着"我自己的用户信息" —— 个人与治理同处一层，读起来是一类东西；类目名"设置"也不与任何路径对齐。现在类目改名 **「系统管理」**，与 `/admin` 这个一级路径段对齐。
- **路径迁移**：用户管理 `/settings/users` → **`/admin/users`**，公告管理 `/settings/announcements` → **`/admin/announcements`**（AI 治理 `/admin/ai` 不变）。两条旧路径保留 `beforeLoad` + `redirect`。
- **权限双保险**：类目级新增 `adminOnly: true`，与三个子项原有的 `adminOnly` 并存 —— 普通账号整类目消失；将来若有人往里加了非 admin 子项，类目本身也不会暴露给全员（服务端每个接口另有 `requireAdmin`）。
- **个人入口边界**：`/settings`（用户信息）**不动**，仍由右上角头像菜单与侧边栏底部进入、**不进 navItems** —— `/settings` 从此只放个人的东西。
- **迁移前核实过安全性**：`/admin/route.tsx` 的 `AdminAreaLayout` 只是通用内容容器（`Main fixed` + flex 列 + Outlet），两个页面组件本身不渲染 `Main`（用 `ContentSection`）⇒ 不会出现双层 Main，**页面组件零改动**；`/admin` 的管理员守卫自动覆盖这两页。
- **接口、服务端、数据库零改动**。

### Verify

- `server/verify-nav-ia.mjs` **39/39 + 1 跳过**（独立实例 5211 与**用户自己的 5173 + 8787** 各一遍）：新增「系统管理」浮窗含三项、侧边栏不再有名为「设置」的一级类目、**208px 下所有一级/二级类目均不折行**（判据 `getClientRects().length > 1`）、两条旧链接重定向。
- **新增 `src/components/layout/nav-filter.test.ts` 4/4**：把"治理入口不暴露给普通账号"这条权限口径从**端到端改成纯函数护栏** —— 端到端那段依赖验收库里恰好有 `ai-agent-acceptance` 账号，实测已经撞上一次（那次 skip 了）。
- `nav-children.test.ts` 7/7；前端全量 **284/286**（2 项为既有 `auth-layout`）；`tsc -b` / `build` 全绿，本轮文件 `lint` 0 error/0 warning（全量 lint 当时另有 1 条 warning 来自**并行会话**正在编辑的 `competitor-analysis/components/snapshot-shell.tsx`，非本轮文件）。
- **未实跑**：`server/ai-agent/verify-ui.mjs`（类目名与路径断言已同步，但它会发起真实模型问答）。
- **A→D 四个阶段至此全部完成**：一级类目「我的 ASIN」升级、提示词广场与产品开发子页各自拥有真实路径、治理面收口到「系统管理」，全站旧链接均可跳转。

## 侧边栏归类重排：阶段 C ——「我的 ASIN」升一级、「提示词广场」迁 `/prompts`（2026-09-16）

### Change

- **「我的 ASIN」由「AI 助手」的二级子页升为一级类目**：它是自带 api / hooks / 表格导入 / 明细工作台的**独立业务模块**，跟"用 AI 问答"没有前提关系（导入清单、维护条目、看表现都不需要 AI），挂在 AI 助手下会让"它是 AI 功能的子页"这个读法一直存在；而它又是运营每天要进的高频入口。路径随之规范化：`/ai-agent/asin-watchlists` → **`/asin-watchlists`**。
- **「提示词广场」路径规范化**：`/ai-agent/prompts` → **`/prompts`**。它 2026-09-15 就已是侧边栏一级类目，却仍住在二级路径下 —— 这正是本次归类诊断里最显眼的一处"导航层级 ≠ URL 层级"，也让 `/ai-agent` 模块路径里混进一个不属于它的页面。
- **`AiAgentLayout` 简化**：删掉 `isPromptSquare` 按路径分流与 `PromptSquareNav` 导入；提示词广场改为自己的布局（新增 `features/ai-agent/pages/prompts-layout.tsx` + 路由目录 `prompts/{route,index}.tsx`），顶栏导航由它自己注入 —— 一级类目不再靠别人布局里的一条 `if` 活着。
- **旧链接兼容**：`/ai-agent/asin-watchlists` 与 `/ai-agent/prompts`（含 `?view=items` / `?view=shared`）在各自旧路由文件的 `beforeLoad` 里重定向到新路径，**`view` 参数透传**（否则从收藏夹打开会被打回默认视图）。
- **引用更新**：`sidebar-data.ts`（AI 助手子项 3 → 2、新增一级类目「我的 ASIN」、提示词广场 url）、`task-center` 的按钮、两个导航测试、`prompt-square-nav.tsx`、`prompt-square.tsx`，以及三个 verify 脚本。`server/*.mjs` 里出现的 `/ai-agent/asin-watchlists` 是服务端**模块文件名**（`./ai-agent/asin-watchlists.mjs`）而非 URL，未改。
- **接口、服务端、`types.ts`、数据库零改动**。

### Verify

- `server/verify-nav-ia.mjs` **34/34**（独立实例 5211 与**用户自己的 5173 + 8787** 各一遍）：新增 AI 助手浮窗 3 → 2 项、三个一级入口可达、两条旧链接重定向、`?view=items` 透传、提示词广场顶栏是它自己两个子页、顶栏标题为「提示词广场」、**提示词广场页不挂 AI 助手模块导航**、切「共享提示词」写入 `?view=shared`、旧链接 `?view=shared` 重定向并保留参数。
- `nav-children.test.ts` 扩到 **7/7**（新增三条归类护栏：我的 ASIN 不在 AI 助手子项里且已是一级类目、提示词广场路径 `/prompts`、产品开发三子页路径）；布局单测 22/22；前端全量 **280/282**（2 项为既有 `auth-layout`）；`lint`（全量 0 error/0 warning）/ `tsc -b` / `build` 全绿。
- 截图：`verify-artifacts/stage-c-prompts-and-my-asin.png`。
- **阶段 D 待做**：「设置」拆为「系统管理」（用户管理 / 公告管理 / AI 治理迁 `/admin/*`）。

## 竞品分析：商品数据卡片化 + 竞品详情页（2026-09-16）

### Change

- **需求**：用户提出「竞品分析的数据应该使用卡片展示 包含图片 用户点击卡片后跳转到单独页面 页面内是该竞品的详细内容」。**先核实现状再动手**：商品公开数据当时只有一张服务端生成的表（`buildPublicProductBlock`），主图 `imageUrl` 服务端一直在回传（`publicData.rows[].imageUrl`）却**没有任何地方展示**，也不存在任何"单个竞品"的页面。**经选项确认三点**：卡片 = 结果里的每个 ASIN（不是历史记录）、详情页复用本次分析快照（不是实时取数）、卡片为默认视图并保留表格切换（不推翻上一轮「内容优先用数据表格」的口径）。
- **① 服务端**：`server/sellersprite-blocks.mjs` 的 `buildPublicProductBlock` 新增 `dataset: 'sellersprite_products'`（**纯新增字段**，不改数据与列定义）。
- **② 摘块 + 卡片视图**：新增 `src/features/competitor-analysis/product-view.ts`（`isPublicProductTableBlock` / `splitPublicProductBlocks` / `buildProductViewItems`，纯函数 + 单测）。按 `dataset` 摘块，**老快照没有该字段时按 `PUBLIC_COLUMNS` 列键逐项一致兜底**（实测记录 #29/#30 就是这样被正确识别的）。卡片一个 ASIN 一张：主图、角色徽章（本品/竞品）、ASIN、标题、品牌与在售天数、价格/评分（评分数）/BSR/卖家数，以及"自家报表是否有记录"；卡片集合以本次分析的 ASIN **全集**为准 —— 漏收录的 ASIN 仍出卡片（显示"未收录"），不能凭空消失。
- **③ 竞品详情页**：路由文件由单文件改为目录（`competitor-analysis/index.tsx` + `competitor-analysis/$asin.tsx`），新增 `/_authenticated/competitor-analysis/$asin?analysisId=<id>`。页面**只读已落库快照**（`GET /api/competitor-analyses/:id`），新增纯函数 `src/features/competitor-analysis/asin-detail.ts` 的 `selectAsinDetail`，按结构化字段筛选：商品公开属性（`rows[].asin`）、自家报表行、库存与店铺可用性（**只给本品**）、月销量趋势（`series[].key`）、流量结构/评论概况（指标 `key` 后缀）、TOP 流量词与差评高频词（行里的 `asin`）、相关结论（证据文本**词边界**命中该 ASIN，`B0ABCDEFGH` 不会被 `B0ABCDEFGHI` 误命中）。**组级信息不进详情页**（期间汇总、环比、组内对比图、本品 vs 竞品均值）—— 它们不是任何一个 ASIN 的属性。
- **④ 顺带修掉两个由端到端脚本抓到的真实缺陷**：(a) 详情页首版把「商品公开数据对比」表按行过滤成一行后仍然渲染（该块的行里也带 `asin`），与顶部概览卡重复展示同一份属性，已在筛选入口显式排除并补单测；(b) 详情页「同一次分析里的其它 ASIN」链接取的是 `result.analysisId`，而**快照本身没有这个字段**（它由 `GET /api/competitor-analyses/:id` 的读取方拼上），链接因此丢掉记录 id、切过去只看到「缺少分析记录 id」—— 改为用 URL 传入的 `analysisId`。
- **⑤ 额度**：详情页**零卖家精灵调用** —— 端到端脚本断言打开详情页过程中 `POST /api/competitor-analyses` 次数为 0。这正是选"复用快照"而非"实时取数"的理由：卖家精灵按调用次数计费。
- **⑥ 卡片/表格切换**：`aria-pressed` 分段按钮（与提示词广场 `LayoutToggle` 同一形态），偏好存 `localStorage` 的 `competitor-product-layout`、读失败回落卡片。
- **⑦ 既有验收脚本同步**：`server/verify-competitor-public.mjs` 的「出现商品公开数据对比表」断言改为「卡片（含主图）为默认 + 切到表格仍能看到该表」，避免脚本因形态变化误报回归。

### 验证

- 新增 `server/verify-competitor-cards.mjs`：**24/24**（真实 Chrome + 真实库快照，全程只读、不消耗额度）：自动在历史里找素材 → 卡片数量 / 主图**真实渲染成功**（`naturalWidth > 0`）/ 角色徽章 / ASIN → 卡片↔表格切换往返 → 点卡片跳到 `/competitor-analysis/<ASIN>?analysisId=32` → 详情页有主图、返回出口、额度口径、**未重新发起分析** → 同批 ASIN 切换后页面确实换成那个 ASIN → 缺少 `analysisId` / 记录不存在 / 脏 `analysisId` / ASIN 不属于这次分析 四类异常都不白屏 → 无控制台错误。
- 新增与更新单测 **29 项**（`product-view.test.ts` 9、`asin-detail.test.ts` 12、`search-params.test.ts` 8，含详情页参数解析）。
- `server/verify-competitor-public.mjs` 复跑 **13/13**（实际调用 0 次、缓存命中 4 次）；`verify-artifacts/check-competitor-history.mjs` 不回归（7 列表头 / 10 行 / 单栏唯一左边界）；`pnpm run lint`、`pnpm exec tsc -b`、`pnpm run build` 全绿。
- 截图：`verify-artifacts/competitor-cards.png`、`verify-artifacts/competitor-asin-detail.png`。

## 侧边栏归类重排：阶段 B ——「产品开发」三个子页独立路由（2026-09-16）

### Change

- **动因**：候选池 / 对比与历史 / 市场调研 原先是**一个页面里的三个页签**，只有 `?view=market` 能被外部带进来（`?view=compare` 甚至会被 `validateSearch` 静默丢弃）。页签没有 URL ⇒ 侧边栏、顶栏与命令菜单都无法表达"市场调研在哪"，而市场调研是独立成果（竞品分析页会专程跳转过来）。
- **侧边栏**：`sidebar-data.ts` 的「产品开发」由叶子类目改为**折叠类目**，含三个子页：候选池 `/product-dev`、对比与历史 `/product-dev/compare`、市场调研 `/product-dev/market`。
- **路由**：`product-dev.tsx` → `product-dev/{route,index,compare,market}.tsx`（旧文件删除，同名前缀与目录不能共存）；模块级路由声明 `staticData.title: '产品开发'`，子页由顶栏导航高亮表达位置。
- **页面**：拆到 `features/product-dev/pages/`（`layout` + `pool-page` / `compare-page` / `market-page`）。
- **跨子页状态上提**：选中候选、对比区间、对比结果原先都在单组件的 `useState` 里，拆路由后组件随路由卸载 —— "勾了候选切到对比页却提示还没选择"是必然结果。现在由 `ProductDevLayout` 持有并经新增的 `dev-context.ts`（`useProductDev()`）注入（按用户选项用 React context，不上 zustand：生命周期与模块一致、无旧值污染）。**候选列表与对比历史两个查询刻意不上提**（React Query 缓存本就共享，子页各自 `useQuery` 不产生重复请求）。
- **顶栏导航**：新增 `components/product-dev-nav.tsx`，子项由 `findNavChildren(sidebarData.navItems, '产品开发')` 派生（与侧边栏同源）；「已选 N」徽标从页内页签挪到「对比与历史」项上。
- **旧链接兼容**：`?view=market` / `?view=compare` 在候选池路由的 `beforeLoad` 里重定向到新路径，`keyword` / `marketplace` 透传（沿用项目既有 `beforeLoad` + `redirect` 模式）。
- **顺手收紧两处状态更新语义（原实现的潜在缺陷）**：① 编辑候选后同步已选集合**不能靠 `toggleSelect` 调两次**——达到 10 个上限时第二次会被拦下，结果是把已选候选误删；改用 context 的 `replaceSelected` / `removeSelected`。② 表头全选改为一次 `setState` 的 `toggleSelectMany`，逐条翻转会在超上限时连弹多次提示。
- **接口、服务端、`types.ts`、数据库零改动**。

### Verify

- `server/verify-nav-ia.mjs` 扩到 **26/26**（跑在独立实例 5211 与**用户自己的 5173 + 8787** 各一遍）：新增侧边栏浮窗 3 子页、顶栏与侧边栏逐字一致、两个子页深链与顶栏高亮、两条旧链接重定向，以及**跨子页状态不丢**（勾选 → 顶栏徽标 → 切到对比页仍带同一候选 → 区间切走再回来仍是"近 7 天" → 回候选池勾选仍保持）。候选池为空时脚本会临时创建一条 `__DSH 验证__` 候选并在 `finally` 里删除（实测清理成功）。
- 前端全量 **276/278**（2 项为既有 `auth-layout`）；`lint`（全量 0 error/0 warning）/ `tsc -b` / `build` 全绿。
- 截图：`verify-artifacts/stage-b-product-dev-subpages.png`、`verify-artifacts/stage-b-cross-page-state.png`。
- **未实跑**：`server/verify-market-research-ui.mjs` —— 断言已按新路径与顶栏高亮更新，但它会发起真实卖家精灵调用（消耗付费额度），留待用户确认。
- **阶段 C/D 待做**：「我的 ASIN」升一级 + 提示词广场迁 `/prompts`；「设置」拆为「系统管理」。

## 侧边栏一级 / 二级类目归类重排：阶段 A（2026-09-16）

### Change

- **需求**：用户提出「当前系统内的一级类目和二级类目的子页面需要重新调整归类」，要求先给优化方案。**先调研后出方案**：把侧边栏数据源、全部路由、三处顶栏导航（AI 助手 / 提示词广场 / AI 治理）与两处页内 Tabs 逐一核对，输出诊断（P0 三条：导航层级 ≠ URL 层级、「设置」名下混装个人/治理/运营/AI 四种性质、一级类目下混装独立业务模块）、6 条归类规则、before/after 映射表与 A→D 分期计划，落盘 `docs/superpowers/plans/2026-09-16-sidebar-category-ia-refactor.md`。**经选项确认**：走 A→D 全量重排、允许 URL 变更（旧链接加 redirect）、「我的 ASIN」升为一级类目、产品开发三个页签升为显式二级子页。本轮只做**阶段 A（零路由变更）**。
- **A1 新增** `src/components/layout/nav-children.ts`：纯函数 `findNavChildren(navItems, parentTitle)`（类目不存在或是叶子项时返回空数组，由调用方渲染空导航）。
- **A2 顶栏与侧边栏同源**：`features/ai-agent/components/agent-nav.tsx` 删掉自己那份 `baseItems` 字面数组（原本与侧边栏的子项字面重复），改从 `sidebarData.navItems` 的「AI 助手」取子项、角色过滤复用 `filterNavItemsByRole`；**渲染结果与改前逐字相同**。
- **A3 治理五项收进数据层**：`admin-ai-nav.tsx` 的 `ADMIN_ITEMS` 搬到 `sidebar-data.ts` 的具名导出 `adminAiNavItems`，组件改为消费它；`types.ts` 新增并导出 `NavChildItem`（`NavCollapsible.items` 改用它），供顶栏导航与后续命令菜单共用。
- **A4 「我的 ASIN」视图落 URL**（`?view=analysis｜items`）：路由加 `validateSearch`，页面改为接收 `view` / `onViewChange` **props**（组件不依赖路由、可独立渲染与测试），URL ↔ props 桥接写在路由文件内。**两个值都显式落参数**：组件要区分"显式选了分析"与"还没选过"，否则空清单下点「一键分析」会被自动视图顶回「商品明细」。
- **顺带修掉一个真实缺陷**：`?view=bogus` 这类脏值原样透进受控 Tabs 的 `value` → **两个选项卡都没有选中态**（实测 tab 数量 2、`aria-selected` 全 false）；改为在组件层对注入视图再做一次白名单校验，不只依赖路由的 `validateSearch`。

### Verify

- 新增 `server/verify-nav-ia.mjs`（系统 Chrome）：**15/15** —— 侧边栏浮窗 3 项、顶栏与侧边栏子项逐字一致、工具徽标仍在、治理 5 项齐备、视图写参 / 刷新保持 / 深链 / 脏值回落、零产品控制台错误；跑在**用户自己的 5173 + 8787** 与独立实例 5211 上各一次。
- 新增 `src/components/layout/nav-children.test.ts` **4/4**（含"真实 `sidebarData` 的子项就是顶栏那三项"的防退化断言）；前端全量 **253/255**（2 项为既有 `auth-layout`）；`lint` / `tsc -b` / `build` 全绿。
- 截图：`verify-artifacts/stage-a-header-vs-sidebar.png`、`verify-artifacts/stage-a-asin-view-url.png`。
- **阶段 B/C/D 待做**：产品开发子页独立路由（含跨页签状态上提）、「我的 ASIN」升一级 + 提示词广场迁 `/prompts`、「设置」拆为「系统管理」。

## 经验审核的提示词审核队列改为表格（2026-09-16）

### Change

- **需求**：用户提出「经验审核的三个卡片应该合并成一个表格」。**先确认落点再动手**：页面上"三个卡片"有三种可能（页面主体的三张大卡片：技能治理 / 提示词审核 / 沉淀条目；技能治理折叠区里的参数表单 + 两张账号清单；提示词审核队列里每条目一张的 `article` 卡片），经选项确认落在**提示词审核队列的条目卡片 → 表格行**，技能治理与沉淀条目不动。
- **改前**（`src/features/ai-agent/components/prompt-review-card.tsx`）：队列用 `<article>` 卡片承载 —— 名称 + 状态徽章 + 摘要 + 三行正文预览 + 标签 + 通过/驳回按钮，一条约 **100px** 高；而名称 / 说明 / 提报人 / 状态 / 更新于本来就是可比的字段，卡片把它们摊成三行，每页 10 条就要滚很久。这恰好与提示词广场早前"系统内所有内容优先使用数据表格展示"的口径不一致 —— 同一批数据在员工面是表格、在管理面是卡片。
- **改法**：① 改用 `DataTable`，六列 —— 名称（标签徽章挂在名称下方，与「沉淀条目」同一做法）/ 说明 / 提报人 / 状态 / 更新于 / 操作；分页器随之由 `DataTable` 内置，手写的 `TablePagination` 与 `Skeleton` 分支一并删除，空态文案交给 `emptyText`（"加载态与空态互斥"这条硬约定不再由本组件自己维护）。② **正文不铺进单元格**：提问模板可能很长，塞进去会把行高撑成几百像素，改用操作列「展开全文」**在该行下方插入一行**（`colSpan=6`）显示完整正文，已驳回条目在同一处附驳回原因 —— 与 `pages/prompt-square.tsx` 的 `PromptTable` 完全同一形态，**能力不因换形态而丢失**。③ 审核结论（通过并共享 / 驳回）仍是明面按钮，且**只在 `status === 'pending'` 时出现**（已共享 / 已驳回条目只需读正文，不再挂一排禁用按钮）。④ 每页条数 10 → **20**：行高从约 100px 降到约 40px，20 条的纵向占用还不到原来 10 条的一半。
- **刻意不改**：搜索与状态筛选、`pendingTotal > 0` 默认展开（`userOpen ?? pendingTotal > 0` 派生，不用 effect 同步）、通过前的二次确认弹窗、驳回原因必填 —— 这些行为一条未动。**接口、服务端、`types.ts`、`queries.ts` 零改动**（仍走 `GET /api/ai/distill/prompts` 与审核两条接口）。

### Verify

- 真实 Chrome（用户自己的 5173 + 8787）**13/13**：表头六列逐字相符（名称/说明/提报人/状态/更新于/操作）、3 条待审各占一行、`article` 计数为 **0**、行高 **55 / 37 / 55px**（长正文未撑高行）、点「展开全文」后 `tbody` 由 3 行变 4 行且完整正文可见、分页器「共 3 条 · 第 1 / 1 页」且每页条数默认 20、本页仍恰好两张表（沉淀条目未受影响）、全程零控制台错误。
  - **踩到的坑**：`getByRole('button', { name: '驳回' })` 全页计数是 **7** 而不是 3 —— 「沉淀条目」表格每行也有一个同名的「驳回」按钮，按钮断言必须**限定在提示词表格内**。
- `server/ai-agent/verify-admin-simplify.mjs` 补 2 项断言，守住"队列不再退回卡片形态"（提示词表表头六列 + 页面 `article` 计数为 0）。本次数据状态下该脚本由 32 项扩到 **34 项，实跑 34/34 全绿**，且这两项在**无待审数据的空态下同样有效**（展开队列后表头始终在）。
- `eslint .` 全绿、`tsc -b` 零错误、`vite build` 通过。
- **数据清理**：验证用的 3 条 `__DSH 验证__ 提示词审核表格 *` 由管理员账号创建并提报为待审，验证后已**软删**（与界面删除语义一致，审计留痕按项目原则保留）；其它账号数据未触碰。

## 数据表格视觉层次统一（2026-09-16）

### Change

- **需求**：用户提出「系统内多处数据表格过于难看」，并给出一张 ERP 需求计划台账截图作为参照；确认口径为**只升级基座、行高按标准紧凑**。
- **改前**：全站 16 个文件 / 18 处表格实例都走统一 `DataTable` 外壳，但视觉基线 `src/components/ui/table.tsx` 的表头只有 `h-10 px-2 ... text-foreground` —— **表头与数据行同为白底、同为 14px 深色字**，整张表只剩一条几乎看不见的行线，没有任何视觉锚点；单元格统一 `p-2`（8px），首末列内容紧贴外框描边。
- **改法**（`src/components/ui/table.tsx`，**18 处实例一次性生效、业务零改动**）：`TableHead` 改为 `h-9 bg-muted px-3 text-xs font-medium text-muted-foreground`（表头降一级成为坐标，数据行的 14px 深色字成为主体），`TableCell` 改为 `px-3 py-2.5`（单行约 40px），两者统一 `first:ps-4 last:pe-4`（首末列各留 16px）。`TableHead` 的 `text-foreground` 必须去掉，否则可排序表头里的 `<button>` 会继承深色、那一列比其它列重。
- **表头底色用实色 `bg-muted` 而非 `bg-muted/60`**：`DataTable` 的吸顶表头会压在滚动中的数据行之上，半透明底色会让滚过的行透出来（即便当前吸顶尚未生效，也不留这个坑）。
- **实测后刻意不动的两个文件**：`src/components/data-table.tsx`（外框、空态、骨架与新密度仍然协调）与 `src/lib/table-styles.ts`（数字列 `TABLE_HEAD_NUMERIC`/`TABLE_CELL_NUMERIC` 早已成对使用，首末列留白改由基座提供、无需新增常量）—— 按"最小改动"原则不做无收益的顺手改。
- **本轮不做（用户明确选择）**：状态列彩色徽章、操作列图标按钮规格统一（属各页改动，回归面大，留待后续）。

### Verify

- 真实 Chrome（用户自己的 5173 + 8787）**六页 × 深浅两套主题**截图比对：「用户管理 / 公告 / 知识库 / ASIN 清单 / 审计台 / 产品开发」表头底色、行线、列对齐均正确，无内容遮挡与错位；截图 `verify-artifacts/{before,after,dark}-*.png`，脚本 `verify-artifacts/table-ux-shots.mjs <前缀> [--dark]`（主题在 cookie `vite-ui-theme`，脚本已内置切换）。
- `eslint .` 全绿（`src/components/ui/**` 本就在 eslint `ignores` 内，视觉基线无 lint 兜底，故以截图为准）、`pnpm run build`（含 `tsc -b`）通过。
- 前端测试 `pnpm exec vitest run --config vitest.chrome.config.ts --browser.headless`：**41/42 文件、244/246 用例通过**。两处失败均在 `src/features/auth/auth-layout.test.tsx`（`getByText('JHYP 智能工作台')` 同时命中 `<title>` 与 `<span>` 的 strict mode 选择器歧义），该文件不引用任何表格组件，属既有脆弱用例。注意 `pnpm test` 在本机跑不起来（Playwright chromium 未安装、下载超时），需用上面的 chrome 配置入口。
- `pnpm run test:server`：唯一失败项 `server/sellersprite.node-test.mjs` 是 `server/sellersprite-public.mjs` 引用不存在的 `server/competitor-public-config.mjs` 所致，与本次改动无关。
- **附带发现（未修）**：`stickyHeader` 因表格 `border-collapse: collapse` 从未真正生效 —— 实测滚动 240px 后 `thead` 从容器顶 256px 掉到 16px（`stuck: false`），受影响的是 ASIN 清单条目表、弹窗内数据集行表、提示词广场长表。修它要把行线从 `<tr>` 迁到 `<td>`，属全站行线口径变更，已记入 `docs/modules/表格与列表规范.md` 注意事项，复现脚本 `verify-artifacts/table-ux-sticky.mjs`。

## 删除侧边栏一级类目的「展开」箭头（2026-09-16）

### Change

- **需求**：用户提出「删除侧边栏的展开图标」。
- **改前**：「AI 助手」「设置」右侧各有一个 `ChevronRight` 箭头，原本表示"点击可展开二级类目"。二级类目改成悬停/点击浮窗之后，这个箭头已经名不副实 —— 点它是**弹浮窗**，不是就地展开。
- **改法**（`src/components/layout/nav-group.tsx`）：删除 `SidebarMenuPopover`（桌面浮窗触发器）与 `SidebarMenuCollapsible`（移动端内联触发器）两处的 `ChevronRight`，并移除该图标导入。**桌面与移动端一并删除**：移动端的可展开性由"点击有反应"表达，不再依赖箭头。
- **代价（有意接受）**：带子项的类目与叶子类目从此视觉一致（都是「图标 + 标题」，只有徽标类目例外，如「任务中心 开发中」）。以后新增带子项的类目也照此，不要再单独加箭头。

### Verify

- 真实 Chrome（用户自己的 5173 + 8787）**7/7**：侧边栏内 `svg.lucide-chevron-right` 计数为 **0**、整页也无残留；「AI 助手」行只剩 1 个图标（行宽 176px，与叶子项一致）；删箭头后**交互不受影响** —— 悬停仍弹浮窗、Esc 仍可关闭、「任务中心 开发中」仍单行显示、移动端 390 点击类目仍能内联展开；全程零控制台错误。
- 截图：`verify-artifacts/sidebar-no-chevron.png`（收窄 + 无箭头的定稿状态）。
- `src/components/layout/nav-group.test.tsx` 3/3（浮窗交互未受影响）、`eslint .` 全绿、`tsc -b` 零错误、`vite build` 通过。

## 侧边栏收窄：256px → 208px（2026-09-16）

### Change

- **需求**：用户提出「侧边栏收窄 3/1 或 4/1 你来判断收窄多少比例最优」。
- **先实测再定，不拍脑袋选比例**（用 `--sidebar-width` 临时覆盖出 256 / 208 / 192 / 172 四档，逐档测量折行、截断与内容区宽度）：
  - **1/3（≈171px）不可取**：最宽的导航项「任务中心」+「开发中」徽标放不下，文字**折成两行**（`verify-artifacts/sidebar-width-172-收窄三分之一.png`）。
  - **1/4（192px）可行但有代价**：一级类目仍单行，但顶部品牌名被截断成「JHYP 智能工…」（`sidebar-width-192-收窄四分之一.png`）。
  - **208px 是"类目名与品牌名都完整"的最窄值**：最宽那行仍余约 28px，故取 **13rem** —— 相对原宽度收窄 48px（约 19%，约等于 1/5）。
- **改动只有一个常量**：`src/components/ui/sidebar.tsx` 的 `SIDEBAR_WIDTH` 由 `16rem` 改为 `13rem`（并把上面的选型依据写进该常量的注释，避免以后有人"顺手改回去"）。**行为、导航数据、折叠态、移动端全部不动**：`SIDEBAR_WIDTH_ICON` 仍 3rem、`SIDEBAR_WIDTH_MOBILE` 仍 18rem。

### Verify

- 真实 Chrome（用户自己的 5173 + 8787）**20/20**：1680 / 1440 / 1280 / 1024 四个视口下侧边栏均为 **208px**、一级类目**无折行**、顶部品牌区与底部用户区（刘磊 / 16686400050）**均无截断**、页面无横向滚动；折叠态仍 66px（3rem 图标 + 内边距 + 2px，既有 inset 行为）、移动端抽屉仍 288px、收窄后悬停浮窗照常弹出；全程零控制台错误。
  - 折行判据用的是 `span.getClientRects().length > 1`，**不是按钮高度** —— 菜单按钮是 `h-8` 固定高度，文字折行并不会把它撑高，只看高度会漏判（第一版测量就漏了）。
- 内容区实测宽松度：1680 视口由 **1416px → 1464px**（1280 视口 1064px）。
- 截图：`verify-artifacts/sidebar-width-final.png`（定稿）与 `sidebar-width-{256-现状,208,192-收窄四分之一,172-收窄三分之一}.png`（选型对照）。
- `eslint .` 全绿、`tsc -b` 零错误、`vite build` 通过；`nav-group.test.tsx` 3/3（浮窗交互未受影响）。

## 侧边栏二级类目改为悬停/点击浮窗（2026-09-16）

### Change

- **需求**：用户提出「取消点击一级类目展开为二级类目，二级类目触发方式修改为悬停或点击一级类目时出现二级类目浮窗」。经选项确认，**移动端保留内联展开**（触屏没有悬停，浮窗还会盖在抽屉上）。
- **改前**：桌面端一级类目是点击内联手风琴展开（`SidebarMenuCollapsible`）——展开一个就把下面的类目整体推下去，而二级项本身只是"进哪个页面"的快捷方式；侧边栏折叠成图标时反而是点击弹浮窗（`SidebarMenuCollapsedDropdown`），两种形态两套行为。
- **改后**（`src/components/layout/nav-group.tsx`）：
  - 新增 `SidebarMenuPopover`，桌面端（展开态与折叠态统一）改为**悬停或点击**一级类目 → 右侧弹出二级项浮窗。悬停带 `HOVER_OPEN_DELAY=120ms` 打开延时（过滤鼠标扫过侧边栏造成的误弹），移出后 `HOVER_CLOSE_DELAY=200ms` 关闭，**指针移进浮窗即取消关闭计时**（否则子项永远点不到）。
  - 键盘可达：Enter / 空格打开（Radix trigger 原生），Esc 关闭；选中子项后关闭浮窗并收起移动端抽屉。
  - 浮窗第一行显示类目标题（原折叠态浮窗的行为），一级类目在子项处于激活状态时保持高亮。
  - 移动端（`isMobile`）走原来的内联展开，行为不变。
- **三个实测踩到的坑（都写进了代码注释与责任田）**：
  1. 浮窗**不能传 `tooltip`**：折叠成图标时 `SidebarMenuButton` 自带的 tooltip 会和浮窗叠在一起，因此改用 `aria-label` 保证可访问名。
  2. **必须 `modal={false}`**：模态菜单打开时 Radix 会把 `body` 设为 `pointer-events: none`，并给侧边栏其余内容加 `aria-hidden` —— 浮窗一开，其它一级类目既点不到、也无法被可访问性查询命中（实测：连「设置」按钮都定位不到），而且 `pointer-events` 的来回切换会额外触发出入事件，按 Esc 关闭后还会被重新弹开。
  3. **点击一级类目会连发两次 `onOpenChange(false)`**（trigger 自己的 toggle 一次、DismissableLayer 把这次点击当成"点了菜单外部"再一次），只忽略一次挡不住；改为在 `onPointerDown` 后开 `CLOSE_GUARD=300ms` 时间窗，窗内关闭请求全部忽略。**代价（有意接受）**：一级类目不靠再次点击收起 —— 移开鼠标、Esc、点击别处都能关，而"点开"才是这一项的主用途。
- **未动**：`src/components/ui/sidebar.tsx` 等基础组件、移动端内联展开、导航数据与权限过滤（`nav-filter.ts` / `adminOnly` / `matchPrefix`）全部保持原样。

### Verify

- 新增 `src/components/layout/nav-group.test.tsx` **3/3**：点击一级类目弹出二级浮窗（含 `href` 断言）、悬停即可弹出（无需点击）、移动端点击仍内联展开且**不出现浮窗**。（"悬停打开后再点不关闭"这条细节没有放进单测：`userEvent.click` 在 DOM 模拟下会附带指针出入事件，误触发延迟关闭，与真实浏览器不一致，改由下面的实机断言覆盖。）
- 真实 Chrome（用户自己的 5173 + 8787）**15/15**：悬停弹出浮窗且含全部子项、侧边栏内不再内联渲染子项、**悬停打开后点击一级类目不关**、浮窗内点击子项可导航且浮窗自动关闭、点击 / 键盘 Enter 均可打开、Esc 可关闭、折叠成图标后悬停仍弹窗、移动端 390 仍内联展开且不弹窗、全程零控制台错误。截图：`verify-artifacts/sidebar-hover-menu.png`、`sidebar-collapsed-menu.png`、`sidebar-mobile-inline.png`。
- `server/ai-agent/verify-ui.mjs` 两处侧边栏断言同步改为「hover 打开浮窗后断言子项」，整脚本 **68/69**：唯一失败是脚本尾部普通账号 context 首次访问的 `page.goto` 60s 超时（已知偶发冷编译问题，与本轮无关），**侧边栏两段断言均通过**。
- `eslint` 本轮文件 0 error；`tsc -b` / `vite build` 在本轮文件上无错误（全量构建期间 `src/features/asin-watchlist/components/item-manager.tsx` 正被并行会话编辑，报错集合全部落在那一个文件）。

## 竞品分析与市场调研分页：按「分析对象」拆，而不是按功能多少拆（2026-09-16）

### Change

- **需求**：用户提出「竞品分析和市场调研是否应该分开两个页面 如果分开两个页面是否应该把竞品分析的某些功能拆分到市场调研」。**先给判断与证据，再用选项确认**：结论是**应该分**，判据不是"功能多少"，而是**分析对象不同**。
- **四条证据（前两条来自实测）**：
  1. **输入形态根本不同** —— 市场数据的入参是类目（`nodeIdPath`），而竞品分析页的入参是 ASIN 列表；此前只能"从本品详情里蹭一个类目"，等于把类目当成 ASIN 的附属品。
  2. **已经真实失败过** —— 实测本品 `B08N5WRWNW` 在卖家精灵无收录 → 拿不到 `nodeIdPath` → **市场维度被静默跳过**（只记进 `errors`），用户只会以为"这功能没做"。
  3. **口径错配（我在上一轮实现里留下的隐患）** —— 竞品 ASIN 是手输的，**可能属于完全不同的类目**，而集中度/价格带/新品结构只按**本品**的类目取；两段并排展示很容易被读成同一个市场。
  4. **时机与使用者不同** —— 竞品分析属 listing 优化阶段（运营，已有 ASIN）；市场调研属**选品阶段**（往往**还没有 ASIN**），让未选品的人先编一个 ASIN 才能看市场，逻辑是反的。
- **拆分边界**（按"这东西是不是某个 ASIN 的属性"判）：**搬到市场调研** 类目市场概览 / 市场集中度 / 新品结构 / 价格带分布；**留在竞品分析** 商品公开数据对比、公开口径指标、月销量趋势、流量结构与 TOP 流量词、评论概况与差评高频词（流量词与评论是**竞品的**属性）。
- **归属**（用户选定）：并入**「产品开发」模块作为子页**「市场调研」—— 契合该模块已有的"选品调研"定位，且侧边栏不增一级类目（项目一直在做导航收敛）。
- **实现**：
  - 公开数据层由 `competitor-public*.mjs` **重命名为 `sellersprite-*.mjs`**：它服务两个模块，描述的是**数据来源**而不是某个页面的私有实现（共用采集、缓存表与展现能力，因此同一类目在两个页面之间不会重复消耗额度）；
  - 新增 `server/market-research.mjs`（输入校验 + 编排 + 头条结论）、`searchCategories`（`product_node` 按关键词搜类目）、`collectMarketData`（市场规模 + 价格带，固定 2 次调用）；
  - 市场规则从 `buildPublicFindings` 拆成独立的 `buildMarketFindings`（规模 / 集中度 / 新品窗口 / 价格与利润四类，均按阈值命中才产出）；
  - 新接口 `GET /api/product-dev/market/categories` 与 `POST /api/product-dev/market/analyze`（输入问题一律 400，含采集层的配置类错误）；
  - 前端新增 `components/market-research-panel.tsx`（搜类目 → 选类目 → 市场块 + 市场判断 + **该市场 TOP 商品 ASIN 联动**）、`index.tsx` 加第三个页签、路由加 `validateSearch`（`view=market` / `keyword` / `marketplace`）；
  - 竞品分析侧：去掉 `market` 维度与全部市场块、`parseDimensions` 明确拒绝 `market` 并提示去哪看、结果里给一条"去市场调研查看「本品类目」"的跳转（**带类目关键词过去并自动搜一次**，免去重复输入）。
- **额度**：竞品分析全维度 22 → **20 次**（5 个 ASIN）；市场调研固定 **3 次**（类目搜索 1 + 市场结构 2），与 ASIN 数无关；两边共用 24h 缓存。

### Verify

- 新增 `server/verify-market-research-ui.mjs`（真实 Chrome + 真实库 + 真实卖家精灵 MCP）**12/12**：本页不再有「类目市场」勾选项 → 点跳转 → 落到 `/product-dev?view=market&keyword=Toilet+Paper&marketplace=US` → 页签高亮 → 关键词已填入并自动搜出 10 个候选类目 → 选中后产出市场块与「市场判断」→ 显示调用与缓存命中 → 零控制台错误；截图 `verify-artifacts/market-research-categories.png`、`market-research-result.png`。
- `server/sellersprite.node-test.mjs` **18/18**（新增：`market` 必须被拒绝且提示去哪看、`buildMarketFindings` 四类结论与"无数据不编结论"、市场额度预估 2/3 次）。
- 服务端全量 **583/583**；`lint` / `tsc -b` / `build` 全绿；后端已重启加载新接口。

## 用卖家精灵 MCP 让「竞品分析」真正能分析竞品（2026-09-16）

### Change

- **需求**：用户提出「现在接入卖家精灵的mcp开始优化竞品分析页面与功能」。经选项确认：**四个能力维度全做**（竞品公开数据 / 类目市场 / 流量与关键词 / 评论痛点），**放在现有竞品分析页面**里。
- **要解决的根问题**：本页此前名不副实 —— 责任田里明写「广告日报与业务报告只包含本公司导入的报表，第三方竞品 ASIN 不在里面就查不到任何记录」，所以输入别人的 ASIN 只会得到「无数据」，页面底部还固定列着一串「未接入维度」。
- **先实测再写码**：逐个探测 6 个卖家精灵工具的真实入参与返回结构（两套参数风格：`asin_detail`/`asin_sales_trend`/`review` 是扁平式，`traffic_*`/`market_*` 是 `request` 包装式；产品类返回 `{code,message,data}` 单条记录、市场类返回分页对象；`market_price_distribution` 必须带真实 `nodeIdPath`，凭空编类目 ID 只会返回空），完整返回落盘备查。
- **新增三层**：
  - `server/competitor-public-config.mjs` —— **零依赖**的维度白名单、参数校验、额度预估；
  - `server/competitor-public.mjs` —— 采集层：MCP 调用、24h 落库缓存、并发限 4、**逐维度失败隔离**；
  - `server/competitor-public-blocks.mjs` —— 展现层：整形为表格/图表/指标卡 + `buildPublicFindings`（确定性结论）。
- **数据面**：迁移 **201** 建 `competitor_public_cache`（按 `kind + ASIN/nodeIdPath + marketplace` 缓存**原始返回**，过期行在每次分析时顺带清理）。
- **接口**：`POST /api/competitor-analyses` 新增 `dimensions`（四选，默认只 `public`）、`publicTtlHours`、`refreshPublic`；返回新增 `publicData`（含 `calls` / `cacheHits` / `errors` / `rows` / 类目名）。
- **页面**：表单新增四个维度勾选（每个带说明与**预估调用次数**，另有「忽略缓存重新拉取」）；结果卡显示「实际调用 N 次（缓存命中 M 次）」「哪些 ASIN 在卖家精灵未收录」「部分维度取不到时的原因」；结论面板按 `scope` 分成**「自家经营数据」与「卖家精灵公开数据」两组**；「未接入维度」卡片按实际接入情况重写（评论痛点、竞品定价、关键词已接入；Listing 图文、真实投放与库存水位仍未接入）。
- **额度设计（硬约束）**：卖家精灵按 HTTP 请求次数计费，一次全维度分析（5 个 ASIN）≈ 22 次调用。因此默认只开核心维度、缓存 24 小时、并发限 4、界面显示预估与实测消耗。实测同一批 ASIN 二次分析：**14 次调用 → 0 次调用（全部命中缓存）**。
- **口径纪律（写进责任田）**：公开数据是**第三方估算**，与自家报表的真实经营数据**不能混算**；缺失字段一律 `null`（页面显示「—」）**绝不用 0 代替** —— 实测 `B08N5WRWNW` 这类 ASIN 在卖家精灵就是没有价格/BSR/评分数据。
- **顺带修掉一个跨模块缺陷**：`competitor-analysis.mjs` 顶层静态导入采集层后，会把 `ai-agent/mcp.mjs` → `ai-agent/data-queries.mjs` 拉进**所有**导入者的模块图；而 ASIN 清单新加的 `ai-agent/watchlist-table.mjs` 也导入 `competitor-analysis.mjs`，于是 `data-queries.mjs` 里 `MAX_TABLE_ROWS` 的初始化顺序被打乱，实测报 `Cannot access 'MAX_TABLE_ROWS' before initialization`（`watchlist-table.node-test.mjs` 整个文件加载失败）。改为在 `analyzeCompetitor` 内**动态导入**采集/展现层后消除；零依赖的配置层仍静态导入。

### Verify

- 新增 `server/competitor-public.node-test.mjs` **17/17**：缺失不填 0、趋势月份并集（竞品起始月份不同不能缺段）、流量词自然/广告计数、差评词频（停用词与低频词过滤）、结论只在命中时产出并带依据、`scope` 合并与取最高级别、额度预估（22 次那组）。
- 服务端全量 **582/582**（含并行开发的 ASIN 清单测试，TDZ 修复后一并恢复）。
- 新增 `server/verify-competitor-public.mjs`（真实 Chrome + 真实库 + **真实卖家精灵 MCP**）**11/11**：默认勾选核心维度、界面显示预估次数、结果卡显示实际调用与缓存命中、结论分组、商品对比表、月销量趋势图、口径声明、未接入维度已更新、零控制台错误；截图 `verify-artifacts/competitor-public-result.png`。
- 迁移 201 已实际应用；`lint` / `tsc -b` / `build` 全绿。
- **成本提示**：脚本用的固定真实 ASIN 首次运行会消耗约 4 次调用，之后 24 小时内走缓存不再消耗。

## 我的沉淀：技能卡精简为「一句说明 + 开关」（2026-09-16）

### Change

- **需求**：用户提出「知识沉淀…技能 顶部这个板块意义不大直接删除 只保留〈开启后可用 AI 从会话中整理经验条目。手工新建沉淀不受此开关限制（不消耗模型）。〉这条信息以及开关即可」。
- **改前**：`src/features/ai-agent/components/skill-config-card.tsx` 一屏里塞了技能名 + 版本徽章 + 已开启徽章 + 技能描述 + **只读参数区**（触发方式 / 每日 AI 整理上限 / 整理字段 + 配额说明）+ 保存按钮 + 三行解释文案 —— 而员工真正能操作的只有**一个开关**（那些参数由管理员在「经验审核 → 技能治理」统一设置，员工改了也无效）。
- **改法**：
  - 删除卡片头部（技能名 / 版本徽章 / 状态徽章 / 技能描述）、只读参数区与保存按钮；保留用户指定的那句说明，并把它做成开关的 `<Label>`（点文字也能切换，可访问名就是这句说明）。卡片高度由约 **300px 降到 54px**。
  - **开关改为即改即存**（`onCheckedChange` 直接提交）：保存按钮随参数区删掉后，"改了不保存"已没有出口，留着按钮反而多一步操作。提交失败会**把开关回滚**回原状态并提示原因 —— 这类二元设置最怕"界面显示已开启、服务端其实没存下"，下次自动整理不生效时用户无从判断。
  - 保留"管理员全局停用该技能"时的禁用态与原因文案（开关灰着却不说为什么，是可用性缺陷）。
- **接口与服务端零改动**：仍走 `GET/PUT /api/ai/notes/skill`；管理员侧「技能治理」卡（`skill-policy-card.tsx`）不在本次范围。

### Verify

- 真实 Chrome（用户自己的 5173 + 8787）**7/7**：说明文案与开关都存在；技能标题 / 只读参数区 / 版本徽章 / 保存按钮**逐项计数为 0**；开关即改即存（服务端 `config.enabled` 随之翻转）并给出「已开启/已关闭知识沉淀技能」提示；验证后把开关恢复原值（无副作用）；全程零控制台错误。截图：`verify-artifacts/skill-card-simplified.png`（卡片实测高 **54px**）。
- `server/ai-agent/verify-ui.mjs` 的技能卡断言同步改判为「说明在 + 开关在 + 参数回显与保存按钮不再回来」（原先断言的 `知识沉淀 技能` 标题已按需求删除）。
- `eslint .` 0 error（1 个既有 warning 在 `asin-watchlist`，非本轮文件）；`tsc -b` 零错误、`vite build` 通过（首次执行时构建被**并行会话正在编辑**的 `src/features/asin-watchlist/components/watchlist-panel.tsx` 的 `TS6133: 'NO_WATCHLISTS' is declared but its value is never read` 阻断，与本次改动无关；复跑时对方已修好，全绿）。

## 修掉卖家精灵 MCP 的密钥误判（用户报「已开通却报密钥不合法」）（2026-09-16）

### Change

- **现象**（用户反馈）：已开通卖家精灵 MCP 服务，页面点「测试连接」却报「卖家精灵 MCP 拒绝了该密钥（密钥不合法或未开通 MCP 权限）」。
- **排查（按证据逐层收窄，全程不猜）**：
  1. 查库：`mcp_enabled=true`、密钥已加密入库，但 `mcp_endpoint` 是 **`https://mcp.sellersprite.com/mcp?secret-key=da6b…df34`** —— 官方文档的"URL 直连"写法被整条粘进了端点框（端点内密钥与密钥框里那把**是同一把**）。
  2. 用**已保存的真实密钥**直接对 `https://mcp.sellersprite.com/mcp` 发 `tools/list`：**HTTP 200、49 个工具**（header 方式、query 方式、两者都带，三种都通）→ **密钥完全有效，问题在我们的判定逻辑**。
  3. 复用服务端 `testMcpConnection()` 复现：确实失败；再用注入的 `fetchImpl` 拦截**客户端实际发出的请求** —— 请求头、body、响应全部正常（200 + 49 个工具），却仍抛"密钥不合法"。
  4. 列全量工具名：**49 = 45 个真实工具 + `secret_invalid` + `secret_expired` + `secret_unauthorized` + `secret_no_remaining`**。
- **根因**：`mcpListTools` 里写了「清单里出现 `secret_invalid` 就判密钥无效」，而卖家精灵**在密钥有效时也会常驻这 4 个状态占位条目**（无效时才**只**返回 `secret_invalid` 一条）。于是把有效密钥判成了无效 —— 调研阶段的结论（"无效密钥返回 `secret_invalid` 伪工具"）只对了一半：真判据是**真实业务工具数为 0**。
- **修复**：
  1. `mcpListTools` 改为**按 `secret_` 前缀摘掉占位条目、再判剩余数量**；为 0 时用占位条目名给出**具体原因**（密钥不合法 / 已过期 / 未授权 / 次数用完）。
  2. `normalizeMcpTool` 再拦一道：占位条目**不得**注册成工具（它们的描述就是状态文本，模型调它必然失败）。
  3. **顺带修掉两个同源缺陷**（都属于"卖家精灵的实际口径比文档宽松"）：
     - **单条记录被当成空结果**：产品类工具返回 `{code:'OK',message:'成功',data:{…}}`，`data` 是**对象不是数组**，早期实现只认数组 → `empty: true`、无结构化数据。现在单条记录也进 `rows`（字段完整回灌模型），但**不生成表格块**（一条记录几十个字段，横排表格在页面上读不下去）。
     - **业务错误信封**：`{"code":"ERROR_xxx"}` 在 `isError:false` 下会被当成数据，新增 `detectErrorEnvelope()` 升级为工具错误（鉴权类仍由客户端层 `detectAuthFailure()` 拦）。
  4. **端点里带密钥的防错**：保存/测试前把 `?secret-key=` 搬到密钥框（前端提示 + 服务端 `splitEndpointSecret()` 兜底，审计记 `mcpSecretMovedFromEndpoint`）—— 否则密钥明文留在 `mcp_endpoint` 列里，界面却显示"密钥来源：未配置"。
- **数据修正**：把库里那条端点清洗回标准值 `https://mcp.sellersprite.com/mcp`（密钥仍在加密列，已核对两者一致），并**已同步 45 个工具**（`mcpTools: { total: 45, enabled: 45 }`）。

### Verify

- 服务端单测 **556 → 565/565**（新增 9 项：有效密钥下含 `secret_*` 占位**不得**误判、只剩 `secret_expired` 要给出"过期"原因、占位条目不得注册、单条记录整形、错误信封升级、`splitEndpointSecret` 边界），其中"有效密钥 + 占位条目"一条就是本次事故的回归探针。
- 新增前端测试 `mcp-endpoint-secret.test.ts` **4/4**（端点里带密钥时自动搬运）。
- **真实链路实测**（用用户已保存的密钥，非模拟）：`POST /ai/settings/mcp/test` → `ok:true`「连接成功，共发现 45 个卖家精灵工具」（692ms）、返回清单**不含任何 `secret_*`**；`POST /ai/settings/mcp/sync` → 「已同步 45 个卖家精灵工具（新增 0、更新 45、移除 0）」；`GET /ai/settings` → `mcpReady: true`、`mcpTools 45/45`。
- **工具执行链路实测**：以管理员身份走完整 `executeTool`（参数校验 → MCP 转发 → 结果整形）调用 `sellersprite__asin_detail`，返回真实数据（Apple 商品记录）：`status: ok`、`rowCount: 1`、`empty: false`、字段完整（修复前为 `rowCount: 0 / empty: true`）。
- `verify-mcp-ui.mjs` 增补「已保存有效密钥 → 测试连接必须成功 + 工具数 + 工具开关分组」一段（未就绪环境自动跳过），并修掉它自己踩的截图坑（拦 `fonts.gstatic.com`，与 `verify-prompt-optimize-ui.mjs` 同口径）。
- `lint` / `tsc -b` / `build` 全绿。
- **给用户的动作**：**重启后端**（8787 上跑的是修复前启动的进程，页面仍会报旧错误）；卖家精灵按调用次数计费，45 个工具建议只启用常用的。

## 侧边栏左下角显示真实的登录用户（姓名 + 账号）（2026-09-16）

### Change

- **需求**：用户提出「左下角的用户名称应该根据用户名字显示，展示用户名称和帐号」。
- **根因**：`AppSidebar` 把 `sidebar-data.ts` 里写死的 `user: { name: '内部用户', email: 'user@company.local', avatar: '/avatars/01.png' }` 直接当成"当前用户"渲染。这不是"默认值没接上"，而是**显示了一个错的身份** —— 实测登录账号 `16686400050`（刘磊），左下角却永远写着"内部用户 / user@company.local"。
- **改动**：
  - `src/components/layout/app-sidebar.tsx`：用 `useQuery({ queryKey: ['current-user'], queryFn: /auth/me })` 取当前用户 —— 与「用户信息」页**同一个 query key**，缓存共享、不额外发请求；姓名与登录账号都以它为准，接口未回来时用登录态里的值（登录响应本来就带 `name`），旧会话 cookie 没有 `name` 时**退化成账号**，不回退任何占位假名。
  - `src/components/layout/nav-user.tsx`：入参由 `{ name, email, avatar }` 收敛为 `{ name, accountNo }`，保持纯展示；头像不再引用**并不存在**的 `/avatars/01.png`（一直在 404 后回退），改用姓名首字。
  - `src/components/layout/data/sidebar-data.ts` + `types.ts`：删掉 `user` 字段与 `User` 类型 —— 留着这份数据迟早会被再次当成数据源。
  - `src/stores/auth-store.ts`：`AuthUser` 补可选 `name`（登录响应里有，老 cookie 里没有，消费方必须容忍缺失）。
- **已知剩余**：顶部头像 `ProfileDropdown` 仍是写死的 `SN` 与同一张不存在的图（用户点名的是左下角，本轮未动），已在责任田「注意事项」登记，修法照本例。

### Verify

- `src/components/layout/nav-user.test.tsx` **2/2**：显示姓名与账号、且**不再出现 `user@company.local`**；无姓名时退化为账号。
- 真实 Chrome（用户自己的 5173 + 8787）**6/6**：左下角实际渲染 `刘磊 / 16686400050`，与服务端 `/auth/me` 逐字一致；模板假数据与 `@company.local` 均消失；点进去仍落到 `/settings`；全程零控制台错误。截图：`verify-artifacts/sidebar-user-footer.png`。
- 前端全量 **232/234**（2 项为**既有的** `auth-layout` 失败，与本轮无关）；`eslint .` 全绿、`tsc -b` 零错误、`vite build` 通过。

## 用户管理：管理员可删除账号（2026-09-16）

### Change

- **需求**：用户提出「管理员可以删除账号」。**先确认后做**两项：删除语义选**硬删除**（真删账号、连带清业务数据，而非标记删除），确认交互选**普通二次确认弹框**（不要求输入账号名）。
- **数据库结构未改**：建表时就定好的外键口径正好就是删除语义 —— 业务数据（AI 会话与消息、经验沉淀、我的 ASIN、竞品分析、公告已读、快捷偏好、工作任务）是 `ON DELETE CASCADE`，随账号一并清掉；审计与「创建人 / 审核人」字段是 `ON DELETE SET NULL`，**记录保留、操作人置空**。
- **后端**（`server/index.mjs` 新增 `DELETE /api/users/:id`）：事务内先 `SELECT ... FOR UPDATE` 锁住「启用中的管理员」集合 → `hasCurrentAdminAccess` 校验当前仍是管理员 → 三道闸门 → 写审计 → 删除 → `204`。闸门抽成纯函数 `describeUserDeletionBlock()`（`server/user-management.mjs`）：**不能删自己**、**必须至少保留一个已启用管理员**，与改角色 / 停用共用同一套口径。
  - 非法 id 先判 `400`（不能让 PG 抛 `22P02` 变 500）；重复删除返回 `404`。
  - 审计动作新增 `userDelete: 'user_delete'`，`detail` 必落 `login / role / status / department / lastLoginAt`：`ai_audit_logs.actor_id` 对 users 是 SET NULL，事后只留一个指向已不存在行的 `target_id` 是回答不了"删的是谁"的。
- **前端**（`src/features/settings/users/index.tsx`）：行内新增「删除」（`destructive`、`aria-label` 带姓名、**自己的那一行禁用**并给出 title 原因）→ `ConfirmDialog` 二次确认，文案写明"同时清空它名下的 AI 会话、经验沉淀、我的 ASIN、竞品分析等全部业务数据"+「此操作不可恢复」，请求中两个按钮都禁用。**点行内「删除」不发请求**，只选中账号等确认；失败原因（如"必须至少保留一个已启用管理员。"）原样取服务端文案，前端不复述规则。
- **审计台可见性**（`src/features/ai-agent/pages/audit-console.tsx`）：`ACTION_LABELS` 补齐账号类动作中文文案（开通账号 / 修改账号 / 启停账号 / 重置密码 / **删除账号**）。这张表既是显示文案也是**筛选下拉的数据源**，此前五个账号动作只能显示英文原文、且无法按动作筛选。
- **登录名随删除释放**：`users.login` 是唯一约束，删除后可以重新开通同名账号（硬删除的附带效果，选软删除则不会有这一条）。

### Verify

- 服务端单测 `node --test server/user-management.node-test.mjs` **16/16**（新增 3 项：放行删除他人 / 拒绝删自己 / 保护最后一个启用管理员，含"已停用的管理员不占名额""普通账号不触发该闸门"）。
- 前端 `src/features/settings/users/index.test.tsx` **6/6**（新增 2 项：点「删除」只弹确认框、**不发请求**，点「确认删除」才 `DELETE /users/2`；自己的删除按钮 `disabled`）。
- 接口端到端（真实后端 8787，脚本自建 `__dsh-del-*` 测试账号并回收）**16/16**：204 删除成功、重复删除 404、非法 id 400、删自己 409 且账号仍在、删另一个管理员 204、普通账号 403、审计台能按 `action=user_delete` 查到且 `detail` 含 login/role。
- 真实 Chrome（用户自己的 5173 + 8787）**8/8**：搜索到测试账号 → 点「删除」弹确认框（文案含"不可恢复"与"AI 会话"）→ 点「确认删除」→ 该行消失且提示「账号已删除」→ 服务端列表确认已删 → 当前管理员的删除按钮 `disabled=true` → 全程零控制台错误。截图：`verify-artifacts/user-delete-confirm.png`、`user-delete-after.png`。
- `eslint .` 全绿、`tsc -b` 零错误、`vite build` 通过。后端已重启以加载新路由（`node server/dev.mjs`：5173 + 8787）。

## 接入卖家精灵 MCP：外部亚马逊数据成为模型可调用的工具（2026-09-16）

### Change

- **需求**：用户提出「我需要你接入卖家精灵的 MCP，我已经购买好了套餐，你给出配置项我自己配置，放入模型与配置页面即可」。经选项确认，口径为**完整打通**（配置项 + 服务端真实调用 + 工具交给模型），工具对**所有启用账号**可用、由管理员在「模型与配置」页配置。
- **先调研后动手**：一路并行调研（抓取官方文档页 + 对 `https://mcp.sellersprite.com/mcp` 做真实 HTTP 探测），拿到端点、鉴权头、协议版本、三种"假成功"形态与额度口径之后才写代码。
- **新增服务端两层**：
  - `server/ai-agent/mcp-client.mjs` —— 零依赖 JSON-RPC over Streamable HTTP（`initialize` / `tools/list` / `tools/call`），含超时分类、JSON 与 SSE 双解析、4MB 响应体上限、握手缓存；
  - `server/ai-agent/mcp.mjs` —— 配置解析（数据库 > 环境变量）、远端 schema 归一化、工具同步入库、执行转发、结果整形为 `rows` + 表格块。
- **迁移 117 `add_mcp_integration`**：`ai_settings` 增 9 个 MCP 列；`ai_tools` 增 `source` / `remote_name` 并把 `name` 放宽到 120；`ai_runs.tool_name` 与 `ai_audit_logs.target_id` 同步放宽到 120。**只增列、可重复执行**，历史行为不变。
- **接口**：`GET/PATCH /api/ai/settings` 增 MCP 字段（密钥复用模型密钥的 AES-256-GCM 与掩码规则，`buildSecretUpdate` 抽成两者共用）；新增 `POST /api/ai/settings/mcp/test`（先测后存）与 `POST /api/ai/settings/mcp/sync`（同步工具清单并写审计）。
- **执行路径完全复用**：`tools.mjs` 的 `executeTool` 增加 `source='mcp'` 分支 —— 白名单、权限裁剪、参数校验、审计、拒绝原因枚举都走既有那一套，MCP 工具与内置工具**返回结构完全一致**，编排层与前端都不需要知道工具来自哪里。
- **前端**：新增 `components/mcp-credentials-card.tsx`（状态徽章 + 端点 / 密钥 / 高级设置折叠 / 保存 / 测试 / 同步 / 清除 / 启用开关）；`ai-settings.tsx` 挂载卡片并把工具开关按来源分组（MCP 工具默认折叠、折痕处常显「已启用 x/y」）；新增 3 个 hook 与类型。
- **实测踩到并已固化的四个坑**（全部写进责任田）：
  1. **密钥无效时 `tools/list` 返回 200 + 一个 `secret_invalid` 伪工具** —— 当成"连接成功、1 个工具"就会出现"配置都对、模型永远查不到数据"；已在客户端命中即判 `auth` 失败。
  2. **带无效密钥调用工具时错误被包成 `isError:false` 的"正常数据"** —— 不特判的话模型会把 `ERROR_UNAUTHORIZED` 当业务数据继续编；`detectAuthFailure()` 对短文本 + 结构化错误码做判定并升级为错误。
  3. **`Accept` 必须同时含 `application/json` 与 `text/event-stream`**（缺一部分直接 400，而 Node `fetch` 默认 `*/*`）；鉴权头名固定 `secret-key`。
  4. **端点必须无尾斜杠、只接受 POST**；发未实现方法会吐回完整 Java 堆栈（数 MB），已加响应体上限。
- **工具名会一路写进审计**：本地工具名是 `<前缀>__<远端工具名>`，长度上限的放宽必须覆盖 `ai_tools.name`、`ai_runs.tool_name`、`ai_audit_logs.target_id` 与 `PATCH /tools/:name` 四处，漏一处就是"长名字工具一被调用就整轮对话失败"。
- **顺手修掉一个既有缺陷**：`buildTableBlock` 的 `totalRows` 原来恒等于传入行数 —— 调用方若在构造块**之前**已截断行，界面会把总量说小（"共 100 条"实为 500 条）。新增可选 `totalRows` 参数，既有调用方行为不变。
- **提示词**：`prompt.mjs` 增第 10 条 —— 外部数据工具返回的是实时第三方数据，涉及 ASIN / 关键词 / 类目市场 / 商标必须优先调用，且**不要为它编造"数据截至"声明**（本地报表的时效口径不适用于实时查询）。
- **合规提示（需用户知情）**：卖家精灵《密钥使用规范》写明 MCP 授权「个人使用」、限制同一密钥被多主体 / 多客户端共享，超出场景官方指引改用 API 服务。该提示写在配置卡底部；本轮按用户要求开了全员可用，**最终口径需用户与卖家精灵确认**。

### Verify

- 服务端单测 **556/556**（新增 `server/ai-agent/mcp.node-test.mjs` 25 项：三种"假成功"、schema 归一化、命名映射与配置优先级、结果整形与行列裁剪、连接测试与同步的失败路径），全部用注入的假 `fetch`，不打真实网络。
- **迁移 117 已实际应用**并核对：`ai_settings` 9 个 MCP 列就位、三处工具名相关列宽为 120、`schema_migrations` 记录 `117:add_mcp_integration`。
- 新增端到端脚本 `server/ai-agent/verify-mcp-ui.mjs`（真实 Chrome + 真实库 + **真连卖家精灵端点**）**10/10**：卡片渲染、端点默认值、密钥不回显、三个按钮与启用开关、折叠行常显生效值、**用格式合法但无效的密钥测试时被判为「密钥不合法」而不是「连接成功」**、全程零控制台错误；截图 `verify-artifacts/mcp-settings-card.png` 与 `verify-artifacts/mcp-settings-test-failed.png`。
- 前端全量 **225/227**（2 项失败为**既有的** `auth-layout` 在系统 Chrome 下 `getByText('JHYP 智能工作台')` 同时命中 `<title>` 与品牌 `<span>`，与本轮无关）。
- `tsc -b`、`lint`、`build` 全绿。
- **未做**：真实密钥下的完整工具清单（本机无有效密钥，同步结果以实际 `tools/list` 为准）。

## 修掉「公告关掉又弹」：关闭即确认（2026-09-16）

### Change

- **现象**（用户）：「公告弹窗弹出了不止一次」，追问后确认为「**同一条**公告关掉又弹」，该公告设置是**「只弹一次」**。
- **排查**（`systematic-debugging`，先复现再改，全程不靠猜）：脚本在真实 5173 上复现成功 —— **用右上角 ✕ 关闭**「只弹一次」的公告时**不发 ack 请求**，`clearCookies` 后重新登录**同一条又弹**。库内数据也吻合：该公告有 09:42:25 的已读记录（说明用户**某次**点过「我知道了」），而**另一次是关掉的** → 服务端从未把它记成已读。
- **根因**：确认语义只绑在「我知道了」按钮上。✕ / Esc / 点遮罩关闭只推进前端本地队列，**不写服务端已读记录** —— 而服务端已读才是「只弹一次」的唯一依据。
- **改法**：
  1. `gate.ts` 的 `ackIdForDismiss(announcement)` 去掉 `confirmed` 分支：**任何关闭方式都上报已读**（判据是"弹窗模态阻塞，用户必须先处理掉它才能继续用系统，关掉这个动作本身就是已处理"）；
  2. `AnnouncementGate` 的 `dismiss()` 不再区分关闭方式（「我知道了」与 ✕ / Esc / 遮罩等价）；
  3. `useAcknowledgeAnnouncement` 加 `retry: 1`：写已读是幂等的，而丢一次的代价是用户下次登录被同一条公告再打扰一次（正是刚被反馈的问题）。
- **明确的取舍**（写进责任田）：`once` 公告关掉后**没有二次入口**（本轮没有公告中心），所以"必须反复看到"的内容请用**「每次登录都弹」**，不要指望用户去点某个按钮。
- **顺带**：`server/announcement-ui-verify.mjs` 新增 `[6]` 段**回归护栏**（✕ 关闭 → 上报已读 → 重新登录不再弹），并修掉两处验收脚本自身的噪声/断言问题（Vite dev 在页面导航时取消源码模块请求产生的 `ERR_ABORTED` 按 URL 精确归因；"关掉一条后弹窗消失"改为"队列前进到下一条"，因为多条公告是排队逐条弹的）。

### Verify

- **先写失败测试再改实现**：`gate.test.ts` + `announcement-gate.test.tsx` 先红（2 项失败）→ 改实现后 **19/19 全绿**。
- **端到端修复验证 7/7**（真实 5173 + 真实库）：✕ 关闭 → ack 请求发出（修复前为 0）→ 重新登录不再弹；Esc 关闭同结论。
- **UI 验收 22 → 26/26**（`announcement-ui-verify.mjs`，独立 API 8790 + 实例；`[6]` 段的三条断言在修复前是红的）。
- 前端全量 **225/227**（2 项失败为**既有的** `auth-layout.test.tsx`）、`pnpm run lint` 全绿。
- **注**：`npm run build` 的 `tsc` 阶段被**外部正在编辑**的 `src/features/ai-agent/api/queries.ts`（未使用导入 `McpConnectionTestResult` / `McpSyncResult`）阻断（非本次改动，报错集合不含本轮文件）；产物用 `npx vite build` 验证可正常构建。

## 删除「AI 治理」概览页，入口直接落到知识库（2026-09-16）

### Change

- **需求**：用户提出「设置里面的AI治理的子页面AI治理不需要了 实用性不大」。**同名有两层，先确认后做**：侧边栏入口叫「AI 治理」，进去后顶栏第一个子页也叫「AI 治理」（`/admin/ai` 概览页，`ai-admin-overview.tsx`）。经选项确认，删除的是**概览子页**，五个治理子页（知识库 / 数据源与导入 / 经验审核 / 模型与配置 / 审计台）与全部接口保留。**动因**：概览页只是"总览 + 横向入口"的一层中转，而五个子页在顶栏导航本来就一键可达。
- **改动**：删除 `src/features/ai-agent/pages/ai-admin-overview.tsx`；`src/routes/_authenticated/admin/ai/index.tsx` 由"渲染概览页"改为 `beforeLoad` 里 `redirect({ to: '/admin/ai/knowledge' })`；`src/features/ai-agent/components/admin-ai-nav.tsx` 移除「AI 治理」导航项与 `LayoutDashboard` 图标导入，顶栏治理导航由六个入口收敛为**五个**。
- **为什么保留索引路由而不是删掉它**：侧边栏「设置 → AI 治理」的 url 就是 `/admin/ai`，删掉索引路由会让这个入口落到 `notFoundComponent`（点进去是 Not Found）。重定向后顶栏标题仍取自父路由 `admin/ai/route.tsx` 的 `staticData.title`（「AI 治理」），模块名不受影响。
- **接口与服务端零改动**：被删页面用到的 `MetricStrip`、`useUsageStats`、`formatDate` / `formatTime` 在其他治理页与对话页仍在使用，`knip` 未新增任何未使用条目。
- **验证脚本同步**：`server/ai-agent/verify-ui.mjs`（断言改为"落在知识库 + 导航五项"）、`server/ai-agent/verify-admin-simplify.mjs`（概览段改为重定向断言，并移除已无对象的概览度量变量）。

### Verify

- 真实 Chrome（用户自己的 5173 + 8787，**只读**）**12/12**：`/admin/ai` 重定向到 `/admin/ai/knowledge`；顶栏导航恰好五项且不含「AI 治理」、导航项唯一高亮；顶栏标题仍是「AI 治理」；侧边栏「设置 → AI 治理」进入后落在知识库且无 Not Found；其余四个子页（datasources / distill / settings / audit）仍可达；全程零控制台错误。截图：`verify-artifacts/verify-ai-landing.png`。
- `eslint .` 全绿；`tsc -b` 零错误；`vite build` 通过；前端单测 **225/227**（2 项为**既有的** `auth-layout` 在系统 Chrome 下 `getByText('JHYP 智能工作台')` 同时命中 `<title>` 与品牌 `<span>` 的失败，与本轮无关）。

## 对话输入行控件高度统一为 44px（2026-09-15）

### Change

- **需求**：用户反馈「AI对话页面插入提示词与发送按钮和沉淀知识按钮高度不一致」。
- **实测先定位（关键）**：这三个按钮**本身都是 36px**（`size='icon'` 与 `default` 变体都是 `h-9`），彼此是等高的。真正不齐的是它们与**文本域 44px**（`min-h-[44px]`）之间的落差 —— 整行是 `items-end` 底对齐，控件比文本域矮就"陷进去一截"，观感上像是三个按钮各不成一体。所以修的是"控件与文本域不等高"，而不是"按钮之间不等高"（结论：先量再改，别照着描述直接调数值）。
- **改动**：对话输入行**所有**控件统一 44px —— 图标按钮 `size-11`（插入提示词 / 沉淀为知识 / 窄屏「打开会话列表」）、文字按钮 `h-11`（发送 / 停止生成）；`src/features/ai-agent/components/distill-button.tsx` 的按钮同步 `size-11`（该组件只在对话页使用）。44px 同时是 WCAG 2.5.8 触控目标尺寸的下限。

### Verify

- 真实 Chrome 实测（用户自己的 5173，**只读**）：宽屏 1680 与窄屏 900 下四个控件**全部 44px**；输入行子元素高度 `[0(hidden), 44, 44, 44, 44]`。截图：`verify-artifacts/input-bar-before.png`（改前：按钮 36px + 文本域 44px）/ `input-bar-after.png`（改后齐平）。
- `npx tsc -b` 零错误；`eslint` 全绿；`vite build` 通过；`prettier --check` 通过；相关单测 18/18（`answer-card.test.tsx` + `pane-width.test.ts`）。

## 公告功能：管理员发布、员工登录弹窗（2026-09-15）

### Change

- **需求**：用户要求「再添加一个公告功能 管理员可以编辑或发布公告，可设置每次用户登录时弹出 或只弹出一次确定后就不再弹出」。
- **先问后做的四个选择**（都用选项确认，不自行假设）：管理入口放**「设置 → 公告管理」（仅管理员）**；「只弹一次」的已读**按账号落库**（不用 localStorage —— 换电脑 / 清缓存不该重复弹，且管理员要能看触达情况）；正文支持 **Markdown**；本轮**只做登录弹窗**、不做「公告中心 / 历史公告」。
- **数据层**：新增 `server/announcement-migrations.mjs`（**300 号段**，避开 1 快捷导航 / 2–3 用户 / 100+ AI 助手 / 200 竞品分析；复用会被 `schema_migrations` 静默跳过）建 `announcements`（状态 draft·published·archived、`display_mode`(once·every_login)、优先级、可选生效 / 失效时间、软删）与 `announcement_reads`（`(announcement_id, user_id)` 主键 + `read_at`）。
- **服务端**：`server/announcements.mjs`（纯函数校验 `parseAnnouncementInput` / `parseAnnouncementStatus`、弹出判定 `isPendingForUser`、列表 / 增删改 / 状态流转 / 待弹查询 / 已读写入）+ `server/announcement-routes.mjs`（员工侧只有 `GET /pending`、`POST /:id/ack`；其余逐个 `requireAdmin`），挂载 `/api/announcements`。**已读记录是「只弹一次」的唯一依据**，且在服务端过滤 —— 前端拿不到"已经确认过"的公告，也就无从绕过。
- **前端**：`src/features/announcements/` —— 管理页（列表 / 搜索 / 状态筛选 / 服务端分页 / 已读人数 / 编辑弹窗含 Markdown 预览 / 发布·下线 / 删除二次确认）、登录弹窗 `AnnouncementGate`（挂 `AuthenticatedLayout`，多条**排队逐条**展示）、纯函数 `gate.ts`（队列推进与"关闭是否算已读"）。侧边栏「设置」下加「公告管理」（`adminOnly`），路由 `/settings/announcements`。
- **"每次登录"的判定**：`auth-store` 新增内存态 `loginAt`（`setAccessToken` 时写入，登出 / 刷新归零，**不写 cookie**）。刷新页面不弹、站内跳转不弹、重新登录才弹 —— 这一点看 token 是分不出来的（cookie 里的 token 刷新后照样有效）。待弹查询的 `queryKey` 带上 `loginAt`，否则同一次页面会话内登出再登录会命中上一次的缓存（新公告看不到、已确认的旧公告又弹一遍）。
- **只有点「我知道了」才算已读**：按 Esc / 叉号 / 遮罩关闭只推进队列，服务端那边不算数 —— 否则用户误触一次就再也看不到这条公告。
- **顺带消除重复**：AI 回答正文的 Markdown 渲染（元素映射 + 三条硬约束）抽到共享组件 `src/components/markdown-content.tsx`，`answer-markdown.tsx` 变成一层转发；公告正文与 AI 回答自此共用同一套排版，不再各写一份必然分叉的映射。
- **审计**：`announcement_create` / `announcement_update` / `announcement_publish` / `announcement_delete` 四个动作全部落 `ai_audit_logs`（公告是面向全公司的广播，改文案与上下线必须可追溯）。
- **修掉一个在验收中暴露的真实缺陷**：`POST /:id/status` 的 SQL 里同一个参数 `$2` 既比较 varchar 列又参与 `CASE WHEN`，PostgreSQL 报 `inconsistent types deduced for parameter $2` → 发布接口 500。已用 `$2::text` 显式转型修复，并在代码注释里写明不能删。

### Verify

- 服务端单测 `npm run test:server` → **531/531**（新增 `server/announcements.node-test.mjs` 10 项：号段、校验边界、时间往返、`isPendingForUser` 两种策略）。
- 前端：`npx vitest run --config vitest.chrome.config.ts --browser.headless` → **199/201**（新增 `src/features/announcements/` 20 项：纯函数 + 真实 Chrome 下的弹窗集成 —— 未登录不请求、点确定才 ack、Esc 不算已读、多条排队、`every_login` 也记已读；2 项失败为**既有的** `auth-layout.test.tsx`）；`pnpm run lint`、`pnpm run build` 全绿。
- 接口端到端 `node server/announcement-verify.mjs`（独立实例 8790 + 真实库）→ **52/52**，含：未登录 401 / 普通账号 403、六类入参 400、草稿不弹、发布后弹、「只弹一次」**按账号**（A 确认后不弹、B 照样弹）、重复 ack 幂等、草稿 ack 404、`every_login` 确认后仍弹、未生效 / 已过期不弹、优先级排序、下线再上线"确认过的人不再被弹"、删除后不再弹、列表筛选 / 分页 / 已读人数、四个审计动作落库、验收数据软删。
- 浏览器端到端 `node server/announcement-ui-verify.mjs`（独立 Vite 5176 + API 8790，系统 Chrome）→ **22/22**：登录后弹窗、优先级顺序、多条排队与剩余条数提示、**刷新页面不再弹**、再次登录时"只弹一次的没了 / 每次登录的还在"、管理页列表与新建草稿 → 发布 → 状态变化、**站内跳转不重复弹**、新发布的公告出现在下一次登录的队列里、控制台无 error、应用自身请求无失败。截图：`verify-artifacts/announcement-login-1.png`、`announcement-login-2.png`、`announcement-admin-list.png`、`announcement-admin-published.png`。

## 对话工作台取消右栏：依据移入回答卡片按钮 + 两侧留白（2026-09-15）

### Change

- **需求**：用户要求「回答依据不需要在右边栏展示了 取消右边栏 回复内容内包含一个按钮 点开按钮回答依据内容才可见，且 ai 对话两遍稍微留空一点」。
- **为什么右栏该删**：右栏（`xl` 起可见，窄屏是「查看本次回答的依据」抽屉）固定占 260–560px，却只展示**整个会话最后一条**回答的依据 —— 长会话里往回翻的任何一句都看不到自己的依据，而那片宽度一直在挤中栏。
- **改动**：
  1. `src/features/ai-agent/pages/chat-workbench.tsx`：删掉右栏 `aside`、依据抽屉 `Sheet`、输入区的 `PanelRightOpen` 按钮，工作台由三栏收敛为**两栏**（会话列表 + 消息流）；消息流与输入区左右留白 `px-4 → px-6`（消息列仍 `max-w-4xl` 居中）；栏宽可见性判断去掉右栏。
  2. `src/features/ai-agent/components/answer-card.tsx`（上一轮已落地，本轮生效）：依据由卡片内「查看依据」按钮就地展开（引用文档 + 工具调用与参数），**默认收起**、再点收起；无引用文档且无工具调用时**不给按钮**。
  3. `src/features/ai-agent/pane-width.ts` + `components/pane-resizer.tsx`：宽度模型收敛为单栏（`PaneKey` / `RIGHT_PANE_QUERY` / `PANE_SPECS.right` 删除，`PaneWidths` → `{ left: number }`，`limitPaneWidths` 的可见性参数改 `leftVisible`）；**键盘 `←/→`、`Home/End`、`Enter` 与双击恢复默认全部保留**（WCAG 2.2 要求拖动操作有单指针替代方案）；**cookie 向下兼容** —— 旧值 `"256,320"` 仍能读出左栏宽度，不丢用户既有选择。
  4. `src/features/ai-agent/types.ts`：`ChatStreamState.citations` 下线（流式期间不再持有依据），依据统一从落库消息 `AiMessage.citations` 读，避免同一份依据两个真相。
  5. `src/features/ai-agent/components/citation-panel.tsx`：原文片段注释更新（依据已不在右栏，不再受"右栏宽度 320px"约束）。
- **顺带修掉的编译阻断**：`chat-workbench.tsx` 此前**无法编译**（右栏只删了一半，残留 `lastAssistant` / `EvidencePanel` / `panelOpen` / `setPanelOpen` / `PanelRightOpen` 五个已不存在的符号，`npx tsc -b` 报 11 处 `TS2304`）—— 即上一条 CHANGELOG 提到的"外部正在编辑"的那个文件，本轮收尾，dev 下页面恢复可用。

### Verify

- 单测：新增 `src/features/ai-agent/answer-card.test.tsx` **4/4**（默认收起依据不可见 / 点开有引用文档与工具调用与参数 / 再点收起 / 无依据不给按钮）；`pane-width.test.ts` 重写为单栏口径 **14/14**（含旧 cookie `"256,320"` 兼容、隐藏栏不占预算、保底下限）。
- 全量：`pnpm exec vitest run --config vitest.chrome.config.ts --browser.headless` → **199/201**（2 项失败为**既有的** `auth-layout.test.tsx` 在系统 Chrome 下 `getByText('JHYP 智能工作台')` 同时命中 `<title>` 与品牌 `<span>`，与本轮无关）；`npx tsc -b` 零错误；`pnpm run lint` 全绿；`pnpm run build` 通过。
- 浏览器实测（用户自己的 5173，**只读**：仅登录并打开既有历史会话，未发送任何提问）**16/16**：分隔条只剩 1 根；页面不再有右栏标题「本次回答的依据」与依据抽屉按钮；带依据的回答卡片有「查看依据」按钮，**未点开时「引用文档」不可见、点开后引用文档与「工具调用与参数」都出现、再点收起**；消息列左右 padding 实测 24px；无横向滚动；窄屏无依据抽屉入口、会话列表入口仍在；控制台无 error。截图：`verify-artifacts/chat-verify-evidence-open.png`、`chat-verify-workbench.png`、`chat-verify-narrow.png`。
- `server/ai-agent/verify-ui.mjs` 断言已同步（分隔条 1 根 / 双击只校验左栏 288 / 依据区块默认不可见→点按钮后可见 / 窄屏不再有依据抽屉入口），但**未实跑**（该脚本会写真实数据且需要真实模型，留给下一次整体验收）。

## 入口盘点：补 4 个缺失入口 + 新增「任务中心」占位（2026-09-15）

### Change

- **需求**：用户提出「当前项目中是不是还有很多功能跟数据接口没有开发前端网页，例如竞品分析，竞品分析目前只有首页有入口 一级类目下并没有入口，是否还有其他功能有类似的情况 如果有的话先不着急开发功能。先为这些功能占位，提示正在开发中，敬请期待」。
- **调研结论（与用户假设有出入，已说明）**：服务端 63 个接口路径与前端页面逐一比对后，**没有发现"有接口但没页面"的功能域**；真正的问题是**入口不齐** ——
  - 竞品分析 `/competitor-analysis`：只有首页「常用入口」卡片，侧边栏无入口；
  - 我的 ASIN `/ai-agent/asin-watchlists`：只有对话页顶栏的模块导航，侧边栏「AI 助手」子项里没有；
  - 设置 →「显示」`/settings/display`、「通知」`/settings/notifications`：**全站没有任何入口**，只能手敲 URL；
  - 真正"尚未开发"的只有《需求文档.md》§2.2 二期清单（Agent 任务中心、飞书集成、物流供应链、SP-API 连接器、写操作、行级权限、私有模型）。
- **三个先问后做的选择**（用户选定）：① 占位范围**只含 Agent 任务中心**；② 已开发缺入口的**本轮直接补入口、可正常使用**（不挂"开发中"）；③ 占位形态为**侧边栏项 + 独立占位页**（不做置灰死链接，也不放首页卡片）。
- **改动**：
  1. `src/components/layout/data/sidebar-data.ts` 的 `navItems` 新增一级类目「竞品分析」与「任务中心」（后者带 `badge: '开发中'`）；「AI 助手」补子项「我的 ASIN」；「设置」补子项「显示」「通知」（排在「用户管理」之前）；
  2. 新增 `src/features/task-center/index.tsx` 与路由 `src/routes/_authenticated/task-center.tsx`（`staticData.title: '任务中心'`）：说明现状 + 给两个真实替代入口（去 AI 助手提问 / 查看我的 ASIN），**不渲染任何假数据**；
  3. 责任田：新增 `docs/modules/任务中心.md`，并同步 `全局布局与导航` / `竞品分析` / `ASIN 清单` / `设置中心` 与 `docs/modules/README.md`。
- **与首页口径的区别（刻意保留）**：首页**不允许**出现「即将上线」类伪功能卡片（有测试断言守着）；侧边栏占位项**可点击进入说明页**并带「开发中」徽标，语义上不误导。
- **连带效果**：普通账号从此能看到「设置」类目（此前该类目下只有 `adminOnly` 子项，被 `nav-filter.ts` 整类目过滤掉）。

### Verify

- `pnpm run lint` 通过；`pnpm exec vite build` 通过（新增路由后 `routeTree.gen.ts` 已重新生成）。
- 浏览器实测（用户自己的 5173，只读）**11/11**：侧边栏 6 个一级类目 + 「开发中」徽标；点「任务中心」落地 `/task-center`、「正在开发中，敬请期待」与顶栏标题均正确、替代入口按钮可见；「竞品分析」「我的 ASIN」「设置 → 显示」「设置 → 通知」四条路径均可进入且页面正常；控制台无 error。
- **未完成项**：本轮 `pnpm run build` 的 `tsc` 阶段被**外部正在编辑**的 `src/features/ai-agent/pages/chat-workbench.tsx` 阻断（`EvidencePanel` / `lastAssistant` / `panelOpen` / `setPanelOpen` / `PanelRightOpen` 未定义，非本轮改动，文件在编辑过程中行号持续变化），报错集合中**不含本轮任何文件**；该文件完成后需补跑一次全量 `pnpm run build`。
- 回归：`pnpm exec vitest run --config vitest.chrome.config.ts --browser.headless src/features/dashboard src/features/settings` → **44/44**（`pnpm test` 默认入口需要下载 Playwright chromium，本机只有系统 Chrome，故走 `vitest.chrome.config.ts`）。
- 响应式抽查：390 视口下占位页文案可见、无横向滚动（溢出 0px）；1280 视口侧边栏折叠态切换正常。

## 侧边栏取消「常用 / 其他」分组，改为一维一级类目（2026-09-15）

### Change

- **需求**：用户提出「侧边栏内不应该分常用和其他 直接展示一级类目即可」。
- **改法（把分组这一层从数据模型里去掉，而不是留一个"只有一个分组的分组"）**：
  1. `components/layout/types.ts`：`SidebarData.navGroups: NavGroup[]` → `navItems: NavItem[]`，`NavGroup` 类型随之删除（它的 `title` 与 `adminOnly` 已无使用者）；
  2. `components/layout/data/sidebar-data.ts`：两组拍平为一个 4 项数组 —— 仪表盘 / AI 助手（对话、我的沉淀）/ 提示词广场 / 设置（用户管理、AI 治理）；
  3. `components/layout/nav-group.tsx`：不再渲染 `SidebarGroupLabel`（`SidebarGroup` 容器保留，负责内边距与项间距）；
  4. `components/layout/nav-filter.ts`：`filterNavGroupsByRole()` → `filterNavItemsByRole()`，去掉分组层，"空分组清理"变为"子项被清空的折叠类目清理"；
  5. `components/command-menu.tsx`：命令面板同步改为一个无标题分组平铺（原先按分组 heading 列出）。
- **行为不变**：折叠类目（AI 助手 / 设置）仍可展开，`checkIsActive` 高亮口径与 `adminOnly` 过滤规则未动；普通账号仍因「设置」子项全为 `adminOnly` 而看不到「设置」。

### Verify

- `pnpm run lint` 与 `pnpm run build`（含 `tsc`）全绿。
- 验收脚本 `verify-ui.mjs`、`verify-prompt-optimize-ui.mjs` 的侧边栏断言按 DOM 定位（`[data-slot="sidebar-content"]` 下的类目文本与 `a[href]`），不依赖分组标题文本，逻辑无需改动；仅同步了断言描述措辞。

## 「提示词广场」从 AI 助手的二级导航移除（2026-09-15）

### Change

- **需求**：用户反馈「ai助手类目下的二级类目的顶部子页面不应该有提示词广场」。
- **动因**：提示词广场当天已在侧边栏「常用」组升为**一级类目**，页面顶栏又是它**自己的**两个子页（我的提示词 ｜ 共享提示词）。再挂在 AI 助手的二级导航下，读起来就是「提示词广场是 AI 助手的子页」—— 一级类目被降格，同一个入口还会在一屏里出现两遍。
- **改法**：
  1. `components/agent-nav.tsx` 的 `baseItems` 去掉 `{ to: '/ai-agent/prompts', label: '提示词广场' }`，模块导航收敛为「对话 / 我的 ASIN / 我的沉淀」三项（连同不再使用的 `SquareLibrary` 图标导入）；
  2. 组件头注释补上"为什么这里没有提示词广场"以及"对话页里仍有哪两条路可用它"；
  3. `pages/layout.tsx` 的**顶栏分流逻辑不变**（提示词广场页仍渲染它自己的 `PromptSquareNav`），只更新注释措辞。
- **功能可达性未受影响**：侧边栏一级项仍在（`sidebar-data.ts` 未动）；对话页输入框旁的「提示词」按钮与 `@` 面板仍走 `usePromptMention`。

### Verify

- `server/ai-agent/verify-ui.mjs` 模块导航区块**新增一条断言**「模块导航不再挂『提示词广场』」，防止后续被重新加回来。同区块既有的「含对话 / 我的沉淀、不含治理项」口径**未变、本次未触动**（它本来就不要求含提示词广场，所以既有断言零回归）。
- 真实浏览器（用户自己的 5173，**只读**）**9/9**：模块导航只剩三项且不含提示词广场 / 提示词广场页顶栏仍是「我的提示词 ｜ 共享提示词」且不挂模块导航 / 侧边栏「常用」一级项仍在 / 对话页「提示词」入口仍在。
- `pnpm run lint` 与 `pnpm run build`（含 `tsc`）全绿。

## AI 回答格式统一（正文按 Markdown 渲染 + 服务端固定骨架，2026-09-15）

### Change

- **需求**：用户反馈「当前 AI 回复的内容不利于阅读。我想要你优化统一一个回复格式。方便用户理解与阅读」。
- **根因（有实证，不是推测）**：
  1. **正文按纯文本渲染** —— `answer-card.tsx` / `chat-workbench.tsx` 用 `<p whitespace-pre-wrap>{message.content}</p>`，而项目**没有任何 Markdown 渲染依赖**；真实模型（`deepseek-chat`）却一直在输出 Markdown，见 `server/ai-agent/eval/reports/`：`## 结论`、`**20.17% 涨到 32.1%**`、表格行。于是用户看到的是 **`##`、`**`、`|` 这些源码符号**。
  2. **结构每次都不一样** —— 系统提示词只写了「先给结论，再给依据」，没有任何排版骨架。同一次评测里 D01 写 `## 结论`、D02 写 `**结论：**`、D03 自造 `## 具体差在哪`。
  3. **同一份数字展示两遍** —— 模型在正文排表格，而同一份数据早已由服务端 `blocks` 单独渲染（D01/D03 都同时带 `结构化块：metrics, table, chart`）。
- **改法（两端同时改 —— 只改一边等于没统一：改了规范而渲染层不认识新语法，用户又看到源码符号；改了渲染层而模型不产出该语法，样式永远用不上）**：
  1. **服务端立规范**：`prompt.mjs` 新增导出 `ANSWER_FORMAT_RULES` 并注入系统提示词 —— 首段固定 `## 结论`（1–3 句直接回答、关键数字加粗）；小标题只能从「关键数据 / 执行步骤 / 说明 / 注意事项」里选；并列内容用 `-` 列表、步骤用 `1.`；**正文禁止 Markdown 表格与代码块**；不复述问题、不罗列引用出处。
  2. **前端建渲染层**：新增 `components/answer-markdown.tsx`（`react-markdown` + `remark-gfm` + `remark-breaks`），元素映射到项目主题 token，替换两处正文渲染点。
  3. **两种模式一起统一**：演示 provider 的全部回答改同一骨架 —— 验收脚本跑的多是演示模式，只改提示词会让演示模式与真实模式长得不一样。演示模式提示由**开头移到末尾**（开头位置让给 `## 结论`；卡片头部本来就有「演示模式」徽章）。
  4. **片段摘录先压平**：新增 `flattenSnippetText`（`prompt.mjs` 单一来源，演示 provider 与 `buildDegradedAnswer` 共用）—— 知识库文档本身就是 Markdown（切片含 `# 亚马逊断货补货流程（SOP）`、表格行），原样拼进正文会让**一段摘录长出比回答本身更深的标题层级**。
- **刻意保留（改这块前必读）**：
  - **`wrap-anywhere` 留在渲染容器上** —— `overflow-wrap` 是**继承**属性，放容器一次即覆盖全部子元素；换成 `break-words` 会让 2026-09-15 修掉的「长回答撑宽中栏、右侧被裁」复发（`break-word` 不参与 min-content 计算）。
  - **不启用 `rehype-raw`** —— 正文里可能混入知识库检索片段原文，允许原始 HTML 等于给不可信内容开一个注入面。
  - **`blocked` 分支不动** —— 它的文案会被 `enforcePermissionWording` 整体替换成统一拦截文案，格式无从谈起。
  - **第 5 条「必须声明数据来源与数据截至时间」不受格式条款影响** —— 那是需求 §5.1 声明率 100% 的合规要求，由 `ensureFreshnessDeclaration` 兜底。
  - 模型违令排的表格由渲染层**兜底**成可读表格（兜底而非鼓励：正文表格会与结构化块重复展示同一份数字，提示词层面仍必须禁止）。

### Verify

- **服务端**：`pnpm run test:server` **471/471**。新增 6 项：格式条款逐条注入 + `## 结论` 与「禁止正文表格」两条支点单独锁死；**格式条款不与「必须声明数据时效」冲突**（防止后续改规范时误伤合规要求）；`flattenSnippetText` 压平行首标记与表格竖线、压成单行且限长；降级回答骨架；空片段不产生空卡片。既有「演示 provider 的回答不会被权限措辞检测误判成越权拦截」继续通过 —— 说明新骨架没有碰权限泄露模式。
- **前端**：新增 `answer-markdown.test.tsx` **10/10**。第一个用例**直接取自 `eval/reports/` 里真实模型的输出形态**（`## 结论` + 加粗 + 正文表格混在一段），断言可见文本里**不再出现 `##`、`**`、`|`** —— 它一旦回归就说明"用户又看到源码符号了"。另覆盖：加粗 / 有序与无序列表 / 软换行保留（中文回答常一句一行）/ 表格兜底 / 外链 `noopener noreferrer` / **原始 HTML 不渲染** / `wrap-anywhere` 仍在容器上 / 空内容不渲染空容器。
- **前端全量**：**174/176**（31 个测试文件，30 通过）。2 项失败是 `auth-layout.test.tsx`，属**既有问题**：它用 `getByText('JHYP 智能工作台')` 会同时命中 `<title>` 与品牌 `<span>`（strict mode violation）—— 责任田历史变更里已多次记录为"与本轮无关"，且这套测试因缺少 Playwright 浏览器长期未被跑过。
- `pnpm run lint` 全绿；`pnpm run build`（含 `tsc`）全绿。
- **依赖**：新增 `react-markdown` ^10.1 / `remark-gfm` ^4.0 / `remark-breaks` ^4.0（项目此前无任何 Markdown 渲染能力）。`ai-agent` chunk 由约 137KB 增至 196KB（gzip 约 42KB → 59.8KB）。
- **环境备注**：本机 `pnpm run test` 因缺 Playwright chromium 无法启动，改用项目自带的 `vitest.chrome.config.ts`（系统 Chrome）跑测：`npx vitest run --config vitest.chrome.config.ts --browser.headless`。
- **未做（本轮范围边界）**：「AI 助手 → 对话」之外的模型输出（沉淀摘要、提示词优化结果对比、审核卡片、审计台明细等 18 处 `whitespace-pre-wrap`）保持原样。

## 提示词广场：卡片等宽等高（2026-09-15）

### Change

- **需求**：用户反馈「卡片的长宽高应该一致」。
- **改前**：网格只做到"不拉伸"（`items-start`），卡片高度仍等于内容高度 —— 6 条数据实测 **170 / 268 / 194 / 226px**，参差不齐。
- **改法**：
  1. 网格由 `items-start` 改成 **`auto-rows-fr`**（所有行同一高度）；
  2. 卡片改 `flex h-full flex-col` **填满轨道** —— 卡片不填满的话 `auto-rows-fr` 白设（高度仍等于内容高度）；
  3. 「展开全文」时该卡片 `sm:col-span-2 2xl:col-span-3` **跨满整行**：长正文在 400px 宽的列里读不下去，跨列后整行宽度都是它的。
- **代价（有意接受，已写进代码注释）**：等高意味着**内容最多的那张决定整行高** —— 展开一张卡会让其余卡片一起变高。一致性优先于"某张卡单独长高"。

### Verify

- 造了 6 条刻意制造差异的数据（短正文 / 多标签 / 长正文 / 无说明 / 带长驳回原因 / 待审）实测：**宽度全部 408px、高度全部 228px**（各自去重后只有一个取值），位置规整为 3 列 × 2 行；**展开一张后依旧宽高一致**（跨列那张 1248px、其余 408px，高度同为 226px）。
- `verify-prompt-optimize-ui.mjs` 32 → **33/33**：新增「同页卡片宽高完全一致」断言（量渲染出来的宽与高、各自去重后只应有一个取值）。
- 前端全量 **164/166**（2 项既有 `auth-layout` 失败）、`pnpm run lint` 与 `tsc -b` 全绿；测试数据已软删。

## 提示词广场：卡片网格（一行 2–3 张，2026-09-15）

### Change

- **需求**：用户反馈「一行应该可以放 2-3 个卡片合理。中间空出那么」—— 单列列表一行只有一张卡、右侧一大片空白。
- **动因**：提示词卡片信息量不大（名称 + 一行元信息 + 两行正文），横跨 1240px 是浪费。
- **改法**：
  1. **列表容器改响应式网格**：`CARD_GRID = 'grid items-start gap-3 sm:grid-cols-2 2xl:grid-cols-3'`（两个子页 + 骨架屏共用）。
     - 断点**刻意不用 `xl`**：1280px 视口下内容区只剩约 1000px，三列会把卡片压到 320px、标题行必然折行；
     - `items-start` 不可省：否则同行卡片被最高的那张拉齐，矮卡下面挂一片空白；
     - 骨架屏与真实网格同构（三块 h-36），加载完成时不会因列数变化而跳动。
  2. **卡片操作按窄列重排**：「提报共享」**保留文字**（它是本页唯一把私有变公司资产的动作，图标表达不了），编辑 / 撤回 / 删除收成 `RowAction` 图标按钮（复用治理页的共享件，Tooltip 与 `aria-label` 同源；删除的 label 带条目名，因为同页会有多个删除按钮）；「修改后重新提报」缩为「重新提报」。

### Verify

- 三档断点实测（6 条数据）：**1680 → 3 列**（卡宽 408px，x = 336/756/1176）、**1440 → 2 列**（x = 268/846）、**390 → 1 列**且**横向溢出 0px**；`main` 的 `scrollHeight === clientHeight`（一屏放下）。
- `verify-prompt-optimize-ui.mjs` 30 → **32/32**，新增：
  - **网格断言**：量「卡宽占内容区比例 < 60%」——量的是渲染结果、不依赖数据条数（只有一张卡时它同样只占一个轨道）；
  - **应用自身资源请求无失败**：按 URL 归因，比只看控制台文案更严谨。
- **同轮修掉验收脚本的两个环境坑**：① 截图卡在 `document.fonts.ready` 等外部字体 CDN（本轮实际撞上 30s 超时，报错只写 "waiting for fonts to load"），改为 `context.route` 拦掉 fonts.gstatic.com/googleapis；② 随之出现的无 URL `net::ERR_FAILED` 控制台噪音，按 `verify-ui.mjs` 既有口径过滤；截图失败也改为只提示、不再让整轮验收变成"未完成"。
- 前端全量 **164/166**（2 项既有 `auth-layout` 失败）、`pnpm run lint` 与 `tsc -b` 全绿；测试数据已软删。

## ASIN 清单：表格导入（CSV / Excel）（2026-09-15）

### Change

- **需求**：用户提出「当前系统内的 ASIN 只能手动填写导入，而用户的 ASIN 数据一般以表格形式存放」。
- **经选项确认的四点口径**：① **支持 `.xlsx` 直接上传**（为此引入 `read-excel-file` 作为新依赖，轻量只读；老的 `.xls` 明确拒绝并提示另存）；② 自动识别 ASIN 列并**顺带导入「别名 / 备注」列**；③ **单清单上限与单次导入上限一并提到 5000**（原 200）；④ 大清单下**明细分页 + 可导出，AI 工具只回聚合与异常**。
- **后端**：
  1. 新增 `server/ai-agent/watchlist-table.mjs`（解析层，纯函数为主）：列识别（精确匹配 > 包含匹配，`ASIN别名` 不会抢占 ASIN 列）、表头判定（看"这一行有没有像 ASIN 的值"，不依赖 `asin` 字样）、CSV/XLSX 统一入口、四分类带**行号 + 原值**；长度与行数上限由调用方注入，不反向依赖清单领域层。
  2. 新增 `POST /api/ai/asin-watchlists/:id/import`（原始 body + `X-File-Name` 头，与数据源导入同一套约定）：`?dryRun=true` **只解析预览、不写库**，前端确认后再发一次 —— 服务端因此无状态。新增 `GET /api/ai/asin-watchlists/template`（表头即约定）。
  3. 粘贴入口升级为表格感知：多列 / 制表符 / 带表头时自动识别列，单列纯文本**行为完全不变**（`parseWatchlistAsins` 契约保留，新增 `parseWatchlistImport`）。
  4. `insertItems` 改用 `unnest` 三数组一次写入（5000 行实测 **45~66ms**；逐条 INSERT 光网络往返就是分钟级）。
  5. 上限与承载配套：`MAX_ITEMS_PER_WATCHLIST` / `MAX_BULK_ASINS` → 5000；`buildTableBlock` 新增 `maxRows`、新增 `MAX_DETAIL_ROWS = 5000`；`asinSetPerformancePayload` 新增 `detailLimit` —— **页面 analyze 传 `null`（全量，供分页与导出），AI 工具沿用默认 30 行**（工具路径零改动即安全），摘要里如实说明"明细只列出前 30 个"并指向页面。
- **前端**：新增 `watchlist-import-dialog.tsx`（选文件 → 预览：识别到哪一列 / 会新增多少 / 哪些行读不出来 / 前 5 条样例 → 确认导入 → 结果含失败行行号）、`watchlist-detail-table.tsx`（明细分页 50/100 + 导出 CSV）；「批量添加 ASIN」的说明改为"从 Excel 复制一整片区域也能直接粘"。
- **修掉两个在验收里暴露的真实缺陷**：① `GET /asin-watchlists/template` 注册在 `/:id` 之后，`template` 被当成了清单 ID（返回"清单 ID 无效"）→ 固定路径必须注册在参数路由之前；② "多行 + 逗号分隔、但每格都是 ASIN"的粘贴被误判为表格，只取第一列会**静默丢掉一半商品** → 表格判定改为"首行像表头且多列"或"每行列数一致且至少一格不是 ASIN"。

### Verify

- 服务端单测 440 → **465/465**（新增 25 项解析层：中英文表头、精确匹配优先、Excel 行号、四分类、GBK 编码 CSV 回退、**真实 xlsx**（自造最小工作簿）、超长截断、行数上限、合并计划）。
- `verify-watchlists.mjs` 20 → **29/29**：新增表格预览不写库、确认后写入、别名/备注落库、`.xlsx` 能读、`.xls` 400、找不到 ASIN 列 400 且回显表头、模板下载、他人导入 404。
- 新增 `verify-watchlist-bulk.mjs`（大清单专项）**7/7**：预览 5000 行 → 一次导入 5000 条（**45~66ms**）→ 别名正确落库 → 超限 400 且说明行数 → **页面分析返回全量 5000 行**（`truncated=false`）→ **AI 工具明细块只回 30 行**（`totalRows=5000`）→ 摘要说明截断并指向页面。
- `verify-watchlist-ui.mjs` 15 → **18/18**（真实 Chrome + 8788 实例）：预览显示列识别与无法识别的行、确认后写入并回报条数、导入的条目带别名出现在清单里。
- `pnpm run lint` / `npx tsc -b` / `pnpm run build` 全绿。
- **前端 vitest 未运行**：环境缺少 Playwright Chromium（`playwright install` 多次尝试无下载进展，判定网络受限），与本轮改动无关；受影响的界面已由上述真实浏览器脚本覆盖。

## 提示词广场：排版布局优化（2026-09-15）

### Change

- **需求**：用户反馈「优化提示词广场的排版布局」。**只动排版与信息层级，不动功能与状态语义。**
- **改前实测问题**（6 条数据、视口 1680）：卡片高度 185–251px（平均 **216px**），**6 条要滚一屏半**；卡片内是"标题行 / 说明 / 正文 / 展开全文 / 标签 / 操作按钮"六段竖排；`展开全文` 与操作按钮**各独占一行**；元信息（作者 · 更新于 · 调用次数）被 `ms-auto` 推到卡片另一端，与名称相隔约 700px；空态只有一行灰字。
- **改法**：
  1. **操作按钮移到标题行右侧**（`ghost` + `h-7`，删除按钮补上含条目名的 `aria-label`）——省掉每张卡片约 44px。
  2. **元信息统一成一行**（作者 · 更新时间 · 调用次数），`展开全文` 挪到该行右端：它是最弱却最占地方的元素。
  3. **去掉重复的名称**：原来元信息行前还挂一个 `@名称`，与标题那行说的是同一件事；`@` 用法改由页面说明行统一讲一次。
  4. **空态升级为三件套**：图标 + 结论标题（"没有匹配的提示词" / "还没有提示词"）+ 一句"接下来怎么办" + 出口按钮（「新建第一条」/「清空搜索」）。两个子页共用同一个 `EmptyState`，结构一致。
  5. **说明行补结果计数**（`共 N 条`，搜索时 `找到 N 条`）——搜索后能立刻确认"是真没有还是没搜到"。

### Verify

- 同一批数据的实测对比：平均卡片高度 **216 → 174px**；`main` 的 `scrollHeight === clientHeight`，**6 条一屏放下**（改前需要滚动）；共享子页卡片 132 / 163px。
- `verify-prompt-optimize-ui.mjs` 27 → **30/30**（新增 3 项：空态结论与说明、空态出口按钮、清空搜索后输入框被清空），**直接跑在用户自己的 5173 + 8787 上**（真实 Chrome + 真实模型）。
- 前端全量 **164/166**（2 项为既有 `auth-layout` 失败）、`pnpm run lint` 与 `tsc -b` 全绿。
- 排版验证用的 7 条 `__DSH` 测试数据（覆盖私有 / 待审 / 已驳回 / 已共享 / 他人共享）**验证后已软删**，未污染真实数据。

## AI 治理子页：信息密度减负（2026-09-15）

### Change

- **需求**：用户提出「当前有多个页面过于复杂我需要你帮我简化它，首先是 AI 治理页面下的子页面」；**经选项确认**：尺度 = 只做视觉与信息层级减负、不动功能与接口；验收 = 真实浏览器截图。
- **先调研后动手**：三路并行只读调研（知识库 / 审计台 / 经验审核 + 数据源）+ 读既有截图基线，逐页列出「区块 / 控件数 / 行内按钮数 / 重叠任务域」后才改代码。
- **新增两个共享件**（消除重复，不是新抽象）：
  1. `src/features/ai-agent/components/metric-strip.tsx`：一行**指标条**取代四张统计卡（`dl/dt/dd` 语义、`flex-wrap` 按整项折行、`value === null` 统一渲染占位，各页不再各写一份骨架屏）。
  2. `src/features/ai-agent/components/row-action.tsx`：行内**图标操作按钮**，Tooltip 文案与 `aria-label` **同源**（图标化后这是唯一的含义来源，读屏与端到端脚本都靠它）。
- **逐页改动**：
  1. **概览**：四张统计卡→指标条；「治理入口」五张卡片→**单列行式链接**（两列会把每条说明截断成"文档治理：上传、有效期、下线…"，而说明正是这一行的价值）；外层 grid 加 `items-start`，免左侧卡被右列拉高留白。
  2. **知识库**：低频高危的「重建索引」（全库重建、排障用）收进「更多」下拉；行内 4 个文字按钮改为「查看片段 / 设置有效期 / 删除」图标 + Tooltip，只留「下线 / 启用」为文字（唯一改变生效状态的按钮，图标表达不了方向）；操作列 `w-60 → w-44`。
  3. **经验审核**：统计卡→指标条；「技能治理」参数表单与两张账号清单折叠（`#global-skill` 常显、折叠行右侧常显当前生效参数摘要）；日期范围折叠（折叠行显示已选区间）；行内 6 按钮收敛为「通过 / 驳回」+「更多」菜单（禁用条件逐项保留）；提示词审核队列**有待审自动展开、无待审默认折叠**（`userOpen ?? pendingTotal > 0` 派生，不用 effect 同步）；卡片改 `gap-4 py-4` 并精简描述。
  4. **审计台**：三张指标卡→指标条；两个导出按钮合并为一个「导出」菜单；JSON 单元格由 `break-all` 改 `truncate + title`（整段 JSON 换行曾让"一页 20 条"变成"一屏只看两条"）；完整轨迹改 `max-h-[32rem]` 内层滚动（长会话不再把左侧会话列表顶出视口）。
  5. **数据源与导入**：工具栏按"选数据集 / 对它做什么"分两组；四条导入规则折叠为一行；字段清单由徽章墙改为单行文本（保留 `* 为必填` 口径）。
  6. **模型与配置**：用量明细折叠；删掉"token 用量由 ai_messages 聚合，不额外建表"这类实现细节文案。
- **明确未做**（对齐确认口径）：不删功能、不改任何接口与服务端代码、不改页面职责与导航结构、未动 `src/components/ui/**`（"把技能治理搬到模型与配置"属于职责调整，本轮不做）。

### Verify

- 新增 `server/ai-agent/verify-admin-simplify.mjs`：真实 Chrome（系统 Chrome + 用户自己的 5173/8787），**33/33**。其中约一半断言专门盯「**收起的功能仍可达**」—— 菜单里的重建索引 / 更多沉淀操作 / 导出两项、折叠区的保存技能参数与账号启用情况、导入规则、用量明细，以及行内图标仍能打开切片与有效期弹窗。
- 度量（1680×1000）：经验审核首屏主体 **685px → 579px**（首屏可见 6 行审核条目）、审计台 373px、知识库 291px；全程零控制台错误；截图证据 `verify-artifacts/gov-01..06*.png`。
- 既有 UI 冒烟 `server/ai-agent/verify-ui.mjs` **66/67**：治理页相关断言（知识库 / 审计台 / 模型与配置 / 数据源 / 沉淀管理 / 概览 / 治理导航）全部通过，**图标按钮的 `aria-label`、折叠区里的 `#global-skill`、保留的"查看片段 / 下载模板 / 上传报表 / 通过 / 驳回 / 待审核"文案都是有意的兼容点**。唯一失败项是普通账号侧边栏截图在 30s 内未完成（发生在 `/ai-agent/notes`，与本次改动页面无关，复跑仍稳定复现于同一处）。
- 顺手修正 `verify-ui.mjs` 两处既有缺陷：① 断言"员工侧模块导航恰好两项"在「我的 ASIN」「提示词广场」先后进入导航后已成为永久假失败，改为断言真正的不变式（**必须含对话与我的沉淀，且不含五个治理项**）；② `catch` 里失败现场截图失败会把真正的失败原因替换成"截图超时"，改为容错并打印提示。
- `pnpm run lint` / `npx tsc -b` / `pnpm run build` 全绿；`npx knip` 未新增未使用告警。
- **前端单测本轮未运行**：`pnpm run test` 依赖 Playwright Chromium headless shell，本机缓存缺失，`playwright install chromium` / `--only-shell` 多次尝试均无下载进展（判定为网络受限）。受影响测试面已用真实浏览器脚本替代覆盖：`datasource-rows.test.tsx` 依赖的卡片可访问名（`查看Amazon 广告日报数据详情`）、弹窗标题、搜索 `aria-label` 全部保留，并在新脚本中实测"点卡片仍能打开数据详情"通过。

## 提示词广场：改为自己的顶部子页（2026-09-15）

### Change

- **需求**：用户反馈「优化提示词广场页面 提示词广场没有顶部子页面」；确认后口径为 —— **把顶部换成提示词广场自己的子页**（我的提示词 ｜ 共享提示词），不再挂 AI 助手模块导航。
- **改前现状**（已实测）：该页顶栏是 `AI 助手 ｜ 对话 ｜ 我的 ASIN ｜ 我的沉淀 ｜ 提示词广场 ｜ 可用工具 8 个`，页面内「我的提示词」「共享提示词」两块**纵向堆叠**（要一路下滚才看到"同事共享"那块）。
- **改法**：
  1. 新增 `src/features/ai-agent/components/prompt-square-nav.tsx`（与 `admin-ai-nav.tsx` 同构：`Link` + 精确高亮），`pages/layout.tsx` 按路径分流 —— `/ai-agent/prompts` 用页面自己的导航，其余子页仍是 `AgentNav`（模块导航不动）。
  2. 两个子页**共用同一路由**，用 search 参数 `view` 表达：路由新增 `validateSearch`，只认 `view=shared`，其余值（含手改的乱值）回落默认页；默认页 URL 不带参数，与侧边栏链接天然一致。
  3. 页面按 `view` **只渲染当前子页**，并按子页 `enabled` 只拉那一份数据（原先两个 `usePrompts` 恒发两次请求）；搜索词在子页间保留；两块各自的 h2 去掉（位置已由顶栏导航表达）、只留一行说明。
  4. 给该路由声明 `staticData: { title: '提示词广场' }`：子页默认继承模块级标题「AI 助手」，而它已是侧边栏一级类目、顶栏又是自己的子页导航，标题再写「AI 助手」就自相矛盾。
- **取舍（明确记录）**：这一页不再有一键跳去「对话 / 我的沉淀」的入口，走侧边栏即可 —— 一级类目本就不该挂在别人的二级导航下。

### Verify

- `verify-prompt-optimize-ui.mjs` 18 → **27/27**，新增 9 项：顶栏出现「我的提示词 ｜ 共享提示词」、不再出现「对话 / 我的沉淀」、页面名不再是「AI 助手」、默认页高亮、点击切到 `?view=shared`、高亮与内容同步、切回默认页 URL 参数被清掉、页面内只剩当前那一块。
- **这轮直接跑在用户自己的实例上**（`http://localhost:5173` + 8787，后端他已重启，优化接口实测 200）：顶栏文本实测 `切换侧边栏 ｜ 提示词广场 ｜ 我的提示词 ｜ 共享提示词 ｜ 搜索 ｜ 切换主题`。
- 前端全量 **164/166**（2 项为既有 `auth-layout` 失败）、`pnpm run lint` 与 `tsc -b` 全绿。

## 提示词「标题」字段下线 + 「优化提示词」报错排查（2026-09-15）

### Change

- **需求**：用户反馈两件事 ——「名称和标题只保留名称即可」、「点击优化提示词时报错优化失败」。
- **标题字段下线**（只保留名称）：
  - **动因**：一条提示词的名称与标题在列表里是上下两行、说的是同一件事，用户要填两遍、还得自己造差别。
  - **不做数据库结构变更**：`ai_prompts.title` **列与历史值保留**，只是不再被接口返回、不再被前端读写。改结构属危险操作，且历史数据没有删除的理由。
  - 服务端：`serializePrompt` 不再返回 `title`；`normalizePromptInput` 的 title 改为**可选**（新增 `optionalTitle`：缺省空串，仍校验长度以兼容仍在传该字段的旧调用方与外部脚本）；**已无生产使用点的 `requiredText` 随之下线**（留着就是死代码）。
  - 前端：删掉标题输入框与「请填写标题」校验；列表页、审核卡片删掉标题展示行；`@` 面板副行改显示**说明**（写的是"什么时候用"，信息量比标题大）；`AiPrompt.title`、`PromptInput.title`、优化入参中的 title 一并移除。
  - 优化接口不再读 `req.body.title`（`buildOptimizeMessages` 仍保留 title 形参，函数能力不变）。
- **「优化失败」的根因不是代码，是后端没重启**：用户当前使用的 8787 仍是改动前启动的进程，上面**没有** `POST /api/ai/prompts/optimize` —— 实测返回 `Cannot POST /api/ai/prompts/optimize`（404 HTML）。前端拿不到服务端的中文原因（响应体是 HTML 而不是 `{ message }`），只能显示兜底文案「优化失败，请稍后重试」。**重启后端即恢复**；已把这条环境提示写进交接文档，避免下次误判成代码缺陷。

### Verify

- 服务端单测 **440/440**（新增 `optionalTitle` 边界 + `serializePrompt` 不再返回 title；删除 `requiredText` 用例）。
- 前端全量 **164/166**（新增"表单只保留名称"1 项；2 项失败为**既有**的 `auth-layout` 在系统 Chrome 下的 locator 冲突，与本轮无关）。
- `verify-prompts.mjs` 47 → **50/50**：新增「不传 title 也能新建（201）」与「接口不再返回 title 字段」两条断言。
- UI 端到端 **18/18**（`verify-prompt-optimize-ui.mjs` 新增"弹窗只剩「名称」"断言；真实 Chrome + 真实模型）。
- `pnpm run lint`、`tsc -b` 全绿。

## 提示词广场：升为一级类目 + AI 优化提示词（2026-09-15）

### Change

- **需求**：提示词广场属于一级类目；用户输入提示词后可选「优化提示词」，点按钮由 AI 优化正文。
- **四点先问后做**（均按用户选择落地）：① 侧边栏**「常用」组新增一级项**「提示词广场」，AI 助手模块内的二级导航**保留**（侧边栏解决"这个功能在哪"，顶栏解决"模块内切换不用回侧边栏"）；② 优化按钮放在**编辑弹窗的正文框旁**；③ 结果以**「原文 / 优化后」对比**呈现，**点「采用」才替换正文**；④ **只优化正文**。
- **为什么只优化正文**：名称牵扯两层唯一性（个人库内 + 共享池全局），让模型取名等于凭空制造 409；标题、说明、标签是给人看的元信息，模型写得不一定比人准。
- **为什么必须"采用"而不是直接覆盖**：AI 改写有不确定性，一次点击就把用户刚写完的内容顶掉，是一句话解释不清的事故。采用后仍可**一键撤销**；若采用后又手动改了正文，撤销入口消失（免得把新改动一并吞掉）。采用只改输入框内容，**仍需点「保存 / 创建」才写库**。
- **接口 `POST /api/ai/prompts/optimize`**（`{ body, name?, title? }` → `{ body, truncated, model }`）：**不落库、不改状态、不写审计** —— 没有公司资产被改变，采用后仍走 `PATCH /ai/prompts/:id` 留痕。400 = 正文空 / 过短（< 4 字）/ **演示模式未接入云模型**；502 = 模型调用失败或输出不可用。
- **演示模式双重把关**：前端按 `useAiTools().provider.demo` 禁用按钮并用 Tooltip 说明原因，服务端同样明确拒绝。演示 provider 遇到这类提问只会回"我没有理解这个问题"，拿它当优化结果等于编造 —— 项目口径仍是**失败不编造**。
- **注入防护**：草稿与名称/标题一律包进不可信数据块 `<prompt-draft>`，块内试图闭合数据块的标签转义。用户完全可以把"忽略以上指令"写进提示词草稿，那是**待改写的模板内容**，不是给模型的指令。
- **输出清洗 `extractOptimizedBody`**：逐层剥掉模型输出的"信封"（代码块围栏 / "优化后："套话 / 整段引号 / 三个以上连续空行），但**不误删"任务："这类真结构行**（前缀行必须提到"优化/改写/正文"才认定）；剥不掉的解释性文字不做猜测性裁剪 —— 宁可让用户看到原样自己删，也不把正文中间一段悄悄切掉。
- **超长如实截断**：结果超 4000 字按上限截断并置 `truncated`，前端在对比区明确提示，不静默丢内容。
- **`sanitizeModelError`**：模型报错回传前端前抹掉 `sk-` 片段并限长（与"模型连通性测试"同一口径：报错要如实，但不能把 Key 带出去）。
- **新增文件**：`server/ai-agent/prompt-optimize.mjs`（领域层，纯函数与模型调用分离）、`prompt-optimize.node-test.mjs`、`src/features/ai-agent/prompt-optimize.test.tsx`。
- **同步改动**：`prompt-library-routes.mjs`（新增路由 + `PromptOptimizeError → 502`）、`api/queries.ts`（`useOptimizePrompt`，**刻意不 invalidate**：库内数据没变）、`types.ts`（`PromptOptimizeResult`）、`components/prompt-dialogs.tsx`（按钮 + 对比区 + 采用/撤销）、`sidebar-data.ts`（一级项）、`verify-prompts.mjs`（新增 [9] 段）。

### Verify

- 服务端单测 432 → **439/439**（新增 16 项）：消息组装与数据块转义、输出清洗五类信封、"任务："不被误删、空/过短草稿在**调用模型之前**就被拒（不白烧调用）、模型报错转 `PromptOptimizeError` 且不泄露密钥、模型返回空内容必须抛错、超长截断并标记。
- 新增前端集成测试 **5/5**（系统 Chrome）：对比展示且**输入框内容不变**、采用后替换正文并可撤销、草稿过短按钮禁用且**不发起请求**、演示模式按钮禁用、优化失败时给出提示且不动输入框。
- `verify-prompts.mjs` 41 → **47/47**（新增 6 项）：未登录 401 / 空正文 400 / 过短草稿 400 / 已接入云模型时返回非空正文 / 接口无 5xx / **条目正文未被改动**。
- **真实云模型实测**（`deepseek-chat`）：输入「帮我看下这个月 ACoS 为啥涨了，是不是广告的问题，我应该怎么调」→ 输出含任务目标、背景与约束、输出形式，并带"信息不足时请直接说明还缺什么，不要自行假设"。
- **首轮实测抓到一个提示词缺陷并修复**：模型会替用户声明"我手头可能有本月与对比期的广告数据、销售数据"（用户从没说过），据此把系统提示词第 3 条改为"不要替用户声明他手里有哪些数据、用过什么方法、做过什么分析"，复测已消除。
- **注入草稿实测**：正文含 `</prompt-draft>` 与"忽略上面的所有要求"时，模型仍只做改写，未出现角色切换、未泄漏系统提示词。
- **UI 端到端验收 17/17**（新增 `server/ai-agent/verify-prompt-optimize-ui.mjs`，系统 Chrome + 真实模型）：侧边栏「常用」**不用展开 AI 助手**就能直接点到「提示词广场」一级项并保持高亮、弹窗中「优化提示词」按钮存在、优化后展示对比区且**采用前输入框内容不变**、点「采用优化结果」才替换正文、「撤销采用」还原、取消后弹窗关闭且**未创建条目**（全程不落库）、控制台无 error。
- 前端全量 **163/165**：2 项失败为**既有**的 `auth-layout` 在系统 Chrome 下 `getByText('JHYP 智能工作台')` 同时命中 `<title>` 与品牌 `<span>` 触发 Playwright strict mode，与本轮无关。
- `pnpm run lint` 全绿、`tsc -b` 零错误、`pnpm run build` 通过。

## 提示词广场：把反复输入的提问变成可复用模板（2026-09-15）

### Change

- **需求**：技能封装 / 聊天时选择提示词进行任务 / 提示词广场（提示词名称唯一不重复、会话窗口都可用、可 `@提示词名称` 快捷调出、支持搜索）。
- **范围界定**：确认**技能与提示词是两个独立实体**，技能继续走 `ai_skills` + SKILL.md 与设置中心，本轮**未改技能任何代码**；提示词只存纯文本模板，不带变量字段、不参与知识抽取、不注入系统提示词。
- **名称唯一分两层**（设计上最关键的一处取舍）：`(owner_user_id, lower(name))` 部分唯一索引保证**个人库内**不重名；`lower(name) WHERE status='published'` 部分唯一索引保证**共享池内全局**唯一。
  - 只做全局唯一：同事 A 私有占用了「ACoS 分析」，同事 B 就再也建不了同名，体验很差；
  - 只做个人唯一：`@名称` 调出时会出现两条同名候选，用户无从选择。
  - 提报时预检共享池同名并返回 409（把"审核时才发现撞名"提前到提报时暴露）；审核通过时**再校验一次** —— 条目待审期间名称已从共享池释放、可能被他人占用，这种情况必须报 409，不能让唯一索引冲突变成 500。
- **状态机与权限**：`private/rejected → pending`（本人提报）、`pending → private`（撤回）、`pending → published/rejected`（**仅管理员**）、`published → pending`（已共享条目被修改后自动回到待审 —— 否则"先提报合规内容、通过后再改成别的"会让审核形同虚设）。非法流转一律 409，不静默忽略。
- **对话内调用**：键入 `@` 或点输入框旁常驻的「提示词」按钮（两条路径走同一检测，避免"按钮打开的面板与 `@` 打开的面板行为不一致"）。面板分组展示「共享 / 我的」、支持关键字搜索、`↑↓` 选择 / `Enter` 插入 / `Esc` 关闭；选中后把正文**填进输入框、光标置末尾、不自动发送**。
- **`@` 检测规则刻意保守**：`@` 之前必须是行首或空白（否则 `a@b.com` 这类邮箱会误触发）；`@` 与光标之间出现换行即视为提及已结束；只认最后一个 `@`。
- **`chat.mjs` 问答链路零改动**：`@名称` 不上送服务端，选中只是把文本填进输入框 —— 这正是选择"填入输入框"而非"服务端解析 @ 标记"的最大好处。
- **新增文件**：`server/ai-agent/prompt-library.mjs`（领域层，纯函数与数据库访问分离）、`prompt-library-routes.mjs`、`prompt-library.node-test.mjs`、`verify-prompts.mjs`（**验收脚本，41 项，自带两个 operator 验收账号**）、`src/features/ai-agent/prompt-mention.ts`（`@` 检测与**按键归属**收成一个 hook）、`prompt-mention-detect.test.ts`、`prompt-mention.test.tsx`、`components/prompt-mention-panel.tsx`、`components/prompt-dialogs.tsx`、`components/prompt-review-card.tsx`、`pages/prompt-square.tsx`、`routes/_authenticated/ai-agent/prompts.tsx`、`docs/superpowers/specs/2026-09-15-prompt-square-design.md`。
- **同步改动**：迁移 **116** `create_prompt_square_schema`、`audit.mjs`（5 个新动作）、`router.mjs`、`api/queries.ts`（9 个 hook）、`types.ts`、`format.ts`、`agent-nav.tsx`（导航第四项）、`chat-workbench.tsx`、`distill-management.tsx`。

### Verify

- 服务端单测 **432/432**（405 → 432，新增 27 项）：名称/标题/正文/标签/关键字校验边界，以及**状态流转全矩阵**（含"作者本人不能直接把自己发布出去"、"private → published 无路可走，管理员也不能跳过待审"）。
- 新增前端测试 **18/18**：13 项 `@` 检测与替换纯函数（含邮箱不误触发、换行终止提及、下标越界收敛），5 项集成测试 —— **面板打开时 `Enter` 只插入不发送**、`Esc` 关闭后 `Enter` 恢复发送、**无候选时不吞回车**、关键字走服务端而非本地过滤、分组展示。
- `tsc -b` 零错误、`pnpm run lint` 全绿、`npx vite build` 通过。
- 前端全量 **165/167**：2 项失败为**既有**的 `auth-layout` 在系统 Chrome 下 `getByText('JHYP 智能工作台')` 同时命中 `<title>` 与品牌 `<span>` 触发 Playwright strict mode（该文件与 `index.html` 均无未提交改动，与本轮无关）。
- **迁移已实际应用**（经用户授权）：`ai_prompts` 表与 6 个索引（含两个部分唯一索引）已在 `jhyp_workbench` 库建好，迁移 116 已记录；测试数据验证后已物理清理，审计留痕按项目原则保留。
- **端到端实机验证 41/41**（新增验收脚本 `server/ai-agent/verify-prompts.mjs`，跑在独立端口 8789 上加载新代码的 API 实例 + 真实库 + 两个真实 operator 账号）：覆盖未登录 401 / 建私有 / 个人库重名 409（含大小写不同）/ 名称含 `@` 400 / 空正文 400 / 他人私有条目 404 且列表不泄露 / `private` 直接审核被拒 409（管理员也不能跳过待审）/ 提报 → 待审 → 通过 → **他人账号在共享池可见** / usable 精确名排第一 / 已共享条目撤回与重复审核均 409 / 修改已共享条目回到待审并**立即从共享池消失**（审核无法被绕过）/ 驳回无原因 400、有原因落 `reviewComment`、可重新提报 / 共享池重名提报 409 / 调用计数累加 / 审计台 `prompt_create`、`prompt_submit`、`prompt_review` 三条动作均以 `targetType=ai_prompt` 留痕。
- **端到端验证抓到一个纯函数单测与前端测试都覆盖不到的缺陷，已修复**：`listPrompts` 原来固定 `const params = [userId]`，而 `scope=published` 分支的 SQL 里没有任何 `$1` 占位符 —— PostgreSQL 直接报 `bind message supplies 1 parameters, but prepared statement requires 0`，**共享池列表接口 500**。修复为「参数按分支按需添加」。它还连带暴露了一个**假通过**的断言：紧随其后的"回到待审后不再出现在共享池"在接口报错返回空结果时同样成立。
- **服务端全量测试的 1 项失败与本轮无关**：`node --test server/*.node-test.mjs` 中 `navigation-migrations.node-test.mjs` 报 `ERR_MODULE_NOT_FOUND`，因为工作区里 `server/navigation-migrations.mjs` 处于 ` D`（已被删除）状态 —— 属**并行会话的中间状态**（同一工作区另有 91 项未提交改动，本轮未触碰任何非本人改动）。只跑本轮相关范围 `server/ai-agent/*.node-test.mjs` 为 **368/368**；删除该文件前全量为 432/432。

## AI 对话页：长回答不再被右侧栏截断（2026-09-15）

### Change

- **问题**：回答稍长（含长 URL、无空格长串、工具返回 JSON 或宽表格）时，正文右侧被中栏边界硬切，看不全也滚不到。
- **根因**：中栏消息流包在 Radix `ScrollArea` 里，其 Viewport 内层**固定插一层** `style="display:table; min-width:100%"` 的包装（内联样式，class 覆盖不掉）。table 布局按内容的 **min-content 宽度**撑开：只要有一段不可断行的长内容，整条消息流就按上千像素布局，右侧被 Viewport 的 `overflow-x: hidden` 裁掉——实测 1440 视口下中栏 544px 内的内容被撑到 **2204px**，正文段落单行宽 1413px。
- **修复**：
  1. 中栏改用**原生滚动容器**（`min-h-0 flex-1 overflow-x-hidden overflow-y-auto`），内容宽度恒等于栏宽；左/右栏内容以短文本为主，仍用 `ScrollArea`。
  2. 正文、流式正文、用户气泡、引用原文片段改用 `wrap-anywhere`（`overflow-wrap: anywhere`）。**必须是 `anywhere` 而不是 `break-words`**：只有前者参与 min-content 计算；`overflow-wrap: break-word` 不会缩小 min-content，撑宽照旧发生。
  3. 宽表格改由自身 `overflow-x-auto` 真正滚动（此前容器被内容撑宽，滚动条从不出现，表格右侧永远看不到）。

### Verify

- 真实 Chrome 实测（自建 `__DSH` 前缀会话，验证后已删除，未触碰既有数据）：
  - 1440 三栏：正文宽 502px（修复前 1413px）、中栏内越界元素 **0**（修复前 26 个）、中栏可竖向滚动
  - 1024（右栏隐藏）：正文宽 422px、越界元素 0
  - 762px 宽表格在 500px 容器内**可横向滚动**（`scrollWidth` 762 > `clientWidth` 500）
- 9 个页面冒烟回归（治理 6 页 + AI 对话 / 我的沉淀 / 我的 ASIN）：滚动正常、控制台错误 0
- `tsc -b`、`pnpm run lint`、`pnpm run build` 全绿；前端单测 147/149（2 项为既有的 `auth-layout` 环境差异失败）

## 数据源与导入：卡片可点开查看数据源详情数据（2026-09-15）

### Change

- **背景**：数据源与导入页此前只给"多少行 / 数据截至哪天 / 覆盖哪段周期 / 有哪些列"，导入完一批报表后**看不到到底写进去了什么**。核对导入结果只能自己连库或重新导出报表比对，等于把"导入成功"变成一句无法验证的话。
- **行详情接口**：新增 `GET /api/ai/datasets/rows?dataset=&page=&pageSize=&keyword=`（管理员），返回 `columns`（列定义：key / 中文表名 / 类型 / 是否必填）+ `rows` + `total / page / pageSize`。与 `/ai/datasets` 清单**刻意分开**：清单是进页面就要的轻量统计，行数据是管理员点开卡片才拉，前端用 `enabled` 保证关闭弹窗时不发请求。
- **列与筛选的安全口径**：列名一律来自数据集规格白名单（`datasetRowColumns`），拼进 SQL 的只有白名单里的标识符；关键词只搜**文本类列**（`asin` / `campaign` / `sku` / `marketplace` / 日期列），数值列不参与 —— `spend::text ILIKE '%1%'` 几乎命中全部行，且必然全表扫描。
- **时间列取文本**：`datasetRowSelectList` 对日期/时间列用 `to_char`（`YYYY-MM-DD` / `YYYY-MM-DD HH24:MI:SS`）。TIMESTAMPTZ 会被 pg 解析成 Date 再按 UTC 序列化，东八区核对时会比库内值差 8 小时（`snapshot_at`）；DATE 列由 `db.mjs` 的 `setTypeParser(1082)` 已按字符串返回，此处统一格式避免两套口径。
- **附加展示列**：库存快照补 `snapshot_at`（「快照时间」）—— 它由数据库默认值填充、不进导入模板，但它是**唯一能区分批次的字段**，看不到就分不清哪些行是刚导入的。
- **排序**：有日期列按日期倒序看最新数据，其余按主键倒序看最近写入；可空时间列（`order_snapshot.ordered_at`）显式加 `NULLS LAST`，否则默认 `DESC` 会把空行排在第一页最前面。
- **导出 CSV**：`GET /api/ai/datasets/rows/export?dataset=&keyword=`，与页面同一筛选条件，中文表头 + BOM；导出是"数据出境"动作，与审计导出/沉淀导出同一口径**写审计**（`action='dataset_export'`，含 dataset / keyword / rows / total / truncated）；超过 2 万行时带 `X-Export-Truncated`，前端提示缩小范围而不是静默给半个文件。
- **前端**：数据集卡片整卡可点击（`role="button"` + `Enter`/空格，因为卡片内含标题与徽章等块级内容，不能直接套原生 `button`），右上角加「查看数据」提示；新增弹窗 `dataset-rows-dialog.tsx`（宽表横向滚动、表头吸顶、关键词搜索防抖 300ms 走服务端、分页器复用 `TablePagination`、导出 CSV）；导入结果卡片在成功时新增「查看导入的数据」入口，导入成功后失效行详情缓存（否则刚上传完点开看到的还是上一批数据）。
- **弹窗状态**：弹窗按数据集 key 重挂载，切换数据集时页码与关键词回到初始值 —— 否则会在新数据集上带着上一个数据集的筛选条件，表现为"一打开就是空表"。

### Verify

- 服务端单测 **405/405**（新增 4 项：`datasetRowColumns` 模板列+附加列且不污染规格、`datasetSearchColumns` 排除数值列、`datasetRowOrder` 的 `NULLS LAST`、`datasetRowSelectList` 的时间列 `to_char`）；`lint`、`tsc -b`、`build` 全绿
- 前端新增 `datasource-rows.test.tsx` **4/4**（真实 Chrome + 真实点击）：未点开卡片不请求行详情、点击卡片打开弹窗并显示数据行、键盘 `Enter` 打开、关键词筛选发出带 `keyword=` 的服务端请求
- 真实接口实测（`API_PORT=8790` + 真实库）：广告日报 215 行分页返回、`stat_date` 输出 `2026-08-31` 无时区偏移、库存快照多出「快照时间」列并按 `id DESC` 排序、关键词 `HM-JH-011` 命中 1 行、日期片段 `2026-08` 命中 62 行、无匹配返回 0 行、未知数据集 400、导出 CSV 中文表头 + `Content-Disposition` 中文文件名、审计落一条 `dataset_export`（targetId=`inventory_snapshot`，detail 含 rows/total/keyword/truncated）
- **未改动**：导入流程、数据集表结构、既有接口契约；验证实例用完即停，未触碰既有开发服务（8787/5173 上运行的是改动前的进程）

## AI 治理板块：修复长页面滚不动 + 长列表服务端分页与多选批量（2026-09-14）

### Change

- **滚动根因修复**：AI 治理面的 `AdminAreaLayout` / `AiAdminLayout` 与员工面 `layout.tsx` 的内容容器此前是普通 block 容器（`min-h-0 flex-1 overflow-hidden`）。`flex-1` 在非 flex 父容器里无效，`PageShell` 的 `h-full`（百分比）也解析不到自动高度的父级 —— 子页高度于是退化成内容高度、被外层 `overflow-hidden` 裁掉，**知识库 / 数据源与导入 / 经验审核 / 模型与配置 / 审计台等长页面全部滚不动**。三处容器改为 `flex min-h-0 flex-1 flex-col`，`PageShell` 改为 `h-full min-h-0 flex-1 overflow-y-auto`。实测（真实 Chrome，1440×900）：修复前 `PageShell.clientHeight === scrollHeight === 2138`、`scrollTop` 恒为 0；修复后 `clientHeight=788 / scrollHeight=2138 / scrollTop=1350`。
- **统一分页器** `src/features/ai-agent/components/table-pagination.tsx`：总数、当前页、每页条数（10/20/50/100）、首/末页；四处列表共用同一套文案与禁用规则。此前的分页器只在 `total > pageSize` 时才出现，恰好只有一页时看不到"共 N 条"，最容易被误认为数据被截断。
- **服务端分页**：`GET /ai/imports`、`/ai/audit/conversations`、`/ai/audit/runs`、`/ai/audit/logs` 支持 `page/pageSize`，并新增与列表**同一组筛选条件**的计数（`countImports` / `countConversationTraces` / `countRuns` / `countAuditLogs`）返回 `total`；审计台指标卡改用服务端 `total` / `blockedTotal`，不再对当前页做 `filter().length`（那会变成"本页被拦截数"，翻页数字还会变）。`/ai/audit/logs` 新增 `actions=a,b` 多动作合并筛选。
- **审计台**：三个视图各自独立页码（共用一套会导致切 tab 时页码串台）；「拦截记录」拆成「被拦截的工具调用」与「越权与拦截事件」两张分页表，并抽成独立子组件以便只在切到该 tab 时才发起请求；去掉内部 `ScrollArea`（改由页面滚动 + 分页承载）。
- **知识库多选批量**：新增 `POST /ai/knowledge/documents/batch`（`offline` / `online` / `delete`，单批 ≤ 200）。支持全选本页 + 批量下线 / 批量启用 / 批量删除（删除走破坏性确认框）。逐条调用既有领域函数（已下线文档不会被重复下线）、**逐条写审计**（`detail.via='batch'`）、单条失败不中断整批并逐条返回原因。
- **经验审核多选批量**：新增 `POST /ai/distill/notes/batch`（`archive` / `delete`，单批 ≤ 100），批量归档会连同公共知识库文档一起下线；**刻意不做批量审核** —— 通过会为每条生成一篇公共文档，误操作代价过大，且驳回必须逐条给出原因。
- **批量校验收敛**：新增共享的 `parseBatchRequest()`（动作白名单 + id 去非法/去重 + 单批上限），两支批量接口用同一套边界口径；重复 id 会剔除，否则"成功 5 条"里可能只有 3 条文档、审计也会多出无意义的重复记录。
- **多选与筛选绑定**：选择集合挂在 `selectionKey`（筛选 + 页码）上，键变化即视为空。不使用 `useEffect` 清空 —— 那会多一次级联渲染并存在"选中项仍属于上一页"的中间帧；而翻页保留选择会让批量删除作用于当前已看不见的行。

### Verify

- 服务端单测 **401/401**（新增 `parseBatchRequest` 5 项边界：白名单、去重与非法 id、空集、单批上限）；`lint`、`tsc -b`、`build` 全绿
- 端到端实测 **28/28**（Playwright + 系统 Chrome，真实接口）：知识库全选 → 批量下线/启用/删除后逐条核对接口状态；批量动作在审计台逐条留痕（`doc_offline` / `doc_online` / `doc_delete` / `note_archive` / `note_delete`）；审计台总数与翻页、拦截记录两张表、会话轨迹分页；导入记录分页器；经验审核批量归档与批量删除；6 个页面滚动全部可滚；测试数据清理干净、无控制台报错
- **数据安全**：实测只操作脚本自建的 `__DSH验证__` 前缀文档与沉淀，结束即清理，未触碰既有知识文档与员工沉淀

## ASIN 清单（我的 ASIN）：让「运营自己管理的一批 ASIN」可沉淀、可复用、可被 AI 直接分析（2026-09-14）

### Change

- **背景**：在这之前，ASIN 只是报表行里的一个字段。运营每次做分析都要重新粘贴 ASIN，而全站扫描（`scan_amazon_anomalies`）会把整个站点的 ASIN 混在一起 —— 用户真正想问的"**我负责的这批货**怎么样"在系统里没有对应的对象，也问不出来。
- **数据层（迁移 114 / 115）**：新增 `asin_watchlists`（owner / 名称 / 说明 / 站点 / 软删）与 `asin_watchlist_items`（asin + 别名 + 备注，`UNIQUE (watchlist_id, asin)`）。同名冲突由**部分唯一索引**（`WHERE deleted_at IS NULL`）兜底并转 409；软删后允许重建同名清单。清单级站点的理由是取数与索引：日报按 `(asin, marketplace)` 存储，混站点会把两个站点的数字相加。迁移 115 重播工具契约（`ai_tools` 7 → 8）。
- **领域层（`server/ai-agent/asin-watchlists.mjs`）**：清单与条目 CRUD、账号隔离（他人含管理员一律 404）、上限（清单 50 / 单品 200 / 单次粘贴 200，**超限报错不截断**）。ASIN 解析复用竞品分析的 `parseAsinList`（新增向后兼容的 `duplicates` 字段），导入结果分四类报告：`added` / `duplicated`（清单已有）/ `repeated`（粘贴内容重复）/ `invalid`（无法识别）—— 对用户来说这四类要做的动作完全不同。
- **接口层（`watchlist-routes.mjs`，9 个端点，挂在 `/api/ai/asin-watchlists*`）**：列表、创建、详情、改名改站点、软删、批量加 ASIN、改条目、删条目、一键分析。错误语义区分 400/404/409，前端据此决定"改输入"还是"刷新列表"。区间解析与竞品分析同一套规则：显式区间优先，否则以**该站点报表数据的最新日期**为锚点向前取（用"今天"会取到大半为空的区间，看起来像清单没数据）。
- **分析载荷（`asinSetPerformancePayload`）**：对用户指定的 ASIN 集合做汇总、环比/同比、清单内排行、异常扫描与图表，复用 `analytics.mjs` 同一套阈值与算法。三条硬规则：① 清单里**每个 ASIN 都必须出现在结果里**（无数据的以「无数据」行呈现，不能因为 join 不上就消失）；② 无数据**不折算成 0**，判定列不参与异常扫描，摘要里明确写"不代表销量为 0"；③ 数字全部服务端算。页面与 AI 工具**共用这一个载荷**，保证两处数字一致。
- **AI 工具 `query_asin_watchlist`（requiredRole: user）**：按清单 ID / 清单名取数；未指明时若账号只有一个清单就直接用它，有多个则返回**候选清单表格**让模型追问。之所以把"没有清单 / 名字对不上 / 多个清单"三种情况连同候选一起返回，是因为 `MAX_TOOL_ROUNDS = 2`：先让模型调一个"列出清单"的工具会把两轮预算用光。
- **前端（`src/features/asin-watchlist/**` + 路由 + 模块导航）**：左栏清单（新建 / 重命名 / 改站点 / 删除 + 条目数）、中栏条目（批量粘贴、关键字筛选、别名与备注、逐条移除）、下方一键分析（区间 7/30/90 或自定义、对比基线、结果复用 `AnswerBlocks` 渲染指标卡/明细表/柱状图）。新建与编辑表单用 react-hook-form + zod；错误一律优先展示服务端返回的中文原因。模块导航在「对话」与「我的沉淀」之间新增「我的 ASIN」。

### Verify

- 服务端单测 **396/396**（新增 `asin-watchlists.node-test.mjs` 14 项：名称/站点校验、粘贴解析与重复报告、落库计划与上限溢出）；`lint`、`build` 全绿
- 接口与工具层验收 `verify-watchlists.mjs` **20/20**：账号隔离（他人与管理员访问一律 404）、汇总数字与库内真值一致（花费 6900 / 广告销售额 21000 / ACoS 32.86%）、无数据 ASIN 单列且不折算成 0、同名 409、非法站点 400、超量粘贴 400、空清单分析 400、软删后不可见、工具按清单名取到同一套数字、多清单时返回候选
- 页面验收 `verify-watchlist-ui.mjs` **15/15**（系统 Chrome）：导航入口、空态引导、创建清单与导入结果提示、条目表、非法输入被明确拒绝、追加 ASIN、分析结果卡片与"有数据 2/3"、无数据提示、明细表 ACoS 列、删除后回到引导态
- 前端测试 **144/146**（2 项为预先存在的 `auth-layout` 视觉断言失败，与本次无关）

## 竞品分析完善：多 ASIN 对比、参数自选、确定性结论、库存联动与历史回看（2026-09-14）

### Change

- **背景**：上一轮把接口里与输入无关的写死结论换成真实链路后，竞品分析实际上还是**单个 ASIN 的自身体检**——没有对比对象、站点与区间由服务端写死推导、`competitor_analyses` 只写不读、没有结论与建议、也没接上已有的库存数据。
- **多 ASIN 横向对比**（`server/competitor-analysis.mjs`）：
  - 输入收敛为「一组 ASIN，**第一个视为本品**，其余为对比对象」，最多 5 个；支持逗号/换行/顿号/分号分隔，也支持混入 `/dp/`、`/d/`、`/gp/product/` 链接；无法识别的片段**报出是哪一段**而不是静默丢弃。
  - **同一站点、同一区间**是硬约束：先统一裁决站点与区间（用户显式指定优先，否则按本品有数据的站点与最新日期推导），再让所有 ASIN 用同一组参数取数——不同窗口/不同站点的数字放在一起比是错的。
  - 输出对比表（花费/销售额/ACoS/点击/转化率/CPC/订单/销量）与两张柱状图（花费与销售额、ACoS 与转化率）。**没有数据的 ASIN 指标为 null 而不是 0**，不计入均值与排名，图表也不把它画成 0。
- **参数自选**：站点（默认自动推导）、统计区间（7/30/90 天预设或自定义起止日期，最长 366 天）、对比基线（环比 / 同比 / 不对比）。校验全部前置：自定义区间与预设天数互斥、区间必须成对出现且 `start ≤ end`、站点为两位代码、基线枚举、天数 7–180。
- **确定性「结论与建议」**：新增 `buildFindings()`（纯函数，可单测），把预警线（ACoS>35%、转化率<7%、点击率<0.25%）、环比/同比恶化、ACoS 驱动分解、组内对比、库存阈值转成带**建议动作**的清单，`action` 是建议、`detail` 是事实、`evidence` 是可复算依据。无任何命中时给 info 级「未触发预警线」，而不是编一段"整体健康"的评语；首期为 0 时不产出「增长 ∞%」类结论。
- **库存联动**：经「产品主数据 → 库存快照」把本品 ASIN 关联到 SKU，复用 AI 助手同一套销量口径（优先销售报告、缺失回退订单快照）算日均销量、可售天数、断货/积压/滞销判定与建议补货量。**只对本品做**（第三方竞品 ASIN 通常不在本公司产品主数据里）；没有映射时如实提示补数据，而不是报风险。
- **历史回看**：新增 `server/competitor-migrations.mjs`（**版本 200 号段**，避开导航 1、用户 2/3、AI 100 起的号段）给 `competitor_analyses` 补分析参数、结论摘要（`headline`/`level`/`finding_count`）与**结果快照**（`result JSONB`），并补 `(user_id, created_at DESC)` 索引。落库写入 + `GET /api/competitor-analyses`（列表，只回摘要）+ `GET /api/competitor-analyses/:id`（单条，含快照）。回看读的是**当时的快照**，不是用今天的数据重算。旧记录（无快照）兼容：列表用 `input_value` 回退解析 ASIN，回看时明确提示没有快照。归属校验写在 SQL 里，越权与不存在一律 **404**。
- **前端重写**（`src/features/competitor-analysis/**`）：拆成 `api.ts` / `types.ts` / `format.ts` + 表单、结论面板、历史面板三个组件；宽屏两列（左结果、右历史 sticky），窄屏历史落到下方。结论与建议只做展示，页面不生成任何自己的判断文案。
- **顺带修一个真实体验缺陷**（`src/lib/handle-server-error.ts`）：全局错误提示只读模板继承的 `data.title`，而本项目服务端统一返回 `{ message: '中文原因' }`，导致所有失败请求都弹英文「Something went wrong!」、服务端写好的原因被丢掉。现在 `message` 优先、`title` 兜底（新增 2 项单测，原 7 项不变）。

### Verify

- 服务端单测 **395/395** 全绿（竞品分析 8 → **37** 项，新增 29 项覆盖多 ASIN 解析、参数校验分支、指标行、组内均值与排名、结论规则、历史条目兼容）；`lint`、`build` 全绿
- **接口验收 23/23**（`server/competitor-verify.mjs`，临时实例 8789）：未登录 401、多 ASIN 分析 200 且块顺序为「汇总 → 对比 → 明细 → 趋势 → 库存」、8 个参数校验分支均 400 且带中文原因、历史列表与快照回看、不存在与非法 id 均 404；脚本自建的记录在结束前按 id 删除
- **页面验收 16/16**（`verify-artifacts/competitor-ui-verify.mjs`，系统 Chrome + 临时 Vite 5175 代理到新 API）：单 ASIN 出结论卡与库存表、多 ASIN 出对比表与柱状图（表内 2 行）、区间切到 90 天生效、历史面板有记录、回看显示「历史快照」徽章、非法输入显示服务端中文原因且全局提示不再是英文通用文案、1280 视口无横向滚动、控制台无应用错误
- 实测数据（US 站，2026-08-02 ~ 2026-08-31）：本品 `B0SAMPLE01` 花费 3855.37 / ACoS 32.1% / 转化率 9.46%，竞品 `B0SAMPLE02` 花费 2372.58 / ACoS 35.91% / 转化率 5.19%；结论为「ACoS 环比上涨 57.05%」「转化率环比下滑 20.57%」「ACoS 在组内最低」，库存关联到 `KT-JH-001-BK`

### 发现（未处理，供后续决策）

- **「竞品」在本数据源下的语义受限**：广告日报与业务报告只包含本公司导入的报表，第三方竞品 ASIN 不在这两份报表里就查不到任何记录，因此实际能力是「同口径组内对比」。服务端已把这条口径写进 `comparison.note`，页面固定展示，避免把结论包装成"竞品策略洞察"。
- **首页「最近活动」卡片**（`src/features/dashboard/index.tsx`）仍按 `input_value` 原样截断展示，多 ASIN 时看不到完整列表，也没有悬浮完整值；属仪表盘责任田，本轮未动。
- **库内样例数据只有 2 个 ASIN**（`B0SAMPLE01`、`B0SAMPLE02`，均 US 站），多 ASIN 对比的分档与排名逻辑在更大样本下的表现仍需真实报表验证。

## 依据只在侧栏展示：正文与卡片不再承载引用（2026-09-14）

### Change

- **背景**：上一条把引用条数收敛到 1 篇后，同一份依据仍在三处出现——模型正文里的「引用来源：1.《…》· 更新于 …」、回答卡片内的「引用来源」列表、右栏「引用文档」面板。
- **口径**：引用只由**右栏「本次回答的依据」**承载（窄屏是「查看本次回答的依据」抽屉）。
  - **回答卡片**（`src/features/ai-agent/components/answer-card.tsx`）：删除「引用来源」区块，消息流只留 结论 → 结构化数据块 → 声明条 → 反馈；**卡片底部声明条保留**（数据来源 / 数据截至 / 依据权限范围，窄屏也需要可见）。`CitationList` 仍由右栏 `EvidencePanel` 使用。
  - **提示词**（`server/ai-agent/prompt.mjs` 第 4 条）：由「引用必须标注出处：文档标题、来源类型、更新时间」改为**禁止**正文罗列引用清单与出处元数据（含提报人姓名）；「员工经验必须与公司制度区分」的要求**保留**（改用「有同事的经验提到…」这类文字表述，不写出处）；第 5 条的「必须声明数据来源与数据截至」不变，声明条仍由 `ensureFreshnessDeclaration` 兜底追加。
  - **演示 provider**（`server/ai-agent/providers/demo.mjs`）：正文去掉「引用来源」块与要点里的「（来源：《…》）」，只留要点 + 声明条，`SOURCE_LABELS` 随之删除。
- **可测性**：`server/ai-agent/tools.mjs` 把 citation 构造抽成导出的纯函数 `buildDocumentCitations()`（行为不变）——提报人（`submitter`）与片段得分（`score`）现在只能经由 citations 到界面，不再有正文兜底，必须有单测守着。

### Verify

- 服务端单测 352 → **353/353**；`lint`、`build` 全绿
- 断言随口径调整：演示 provider 两条测试由「正文带出处」改为「正文不含文档标题 / 来源类型 / 提报人 / 引用清单，且声明条仍在」；新增 `buildDocumentCitations` 的 `score` 透传与 `submitter` 断言；`verify-ui.mjs` 不再等卡片内「引用来源」（改等回答卡片本身），并新增「回答卡片内不再渲染引用清单」「依据只在右栏展示」两条
- **真实模型实测**（标准开发服务 8787，live）：3 个知识类问题全部 `citations = 1 篇文档`；正文均不含「引用来源 / 更新于 / 提报人姓名」等出处元数据；「有同事的经验提到…（属个人经验，非公司制度）」的经验—制度区分仍在正文；数据来源与时效声明仍在
- **UI 验收**（临时实例 API 8788 + Vite 5175，真实模型）：本轮相关三条断言全部通过——「回答卡片内不再渲染引用清单」「依据只在右栏展示（引用文档区块可见）」「回答带声明条（数据来源 / 数据截至）」

### 附：验收脚本同步（这 6 处是既有问题，不是本轮引入）

- `verify-ui.mjs`「模板下载与上传入口存在」仍按 `label:has-text("上传报表")` 断言，而安全加固轮已把上传入口改为按钮触发隐藏 file input（键盘可达）→ 该断言永远失败，改为按按钮文案匹配
- 「我的沉淀」页两处断言（宽屏就绪信号、窄屏渲染）依赖文案「我的知识沉淀」，该文案在「顶部布局统一」轮已移到全局 Header、页面上不存在 → 改为按条目区断言
- `datasource → /ai-agent` 跳转后用空态文案「用自然语言提问」当就绪信号，而空态只在 `activeId === null && !stream` 时渲染（窄屏/恢复会话会假失败）→ 改为等提问输入框
- 点击引导卡偶发被 Vite 依赖预构建重建时的 reload 吞掉（点击成功但 React 事件丢失）→ 未生效时重试一次，并把重试写进日志（区分环境抖动与产品问题）
- 新开浏览器 context 首次访问开发服务器偶发超过默认 30s → 该处 `goto` 超时提到 60s
- **遗留**：验证期间另一个会话在同工作区改动了 `vite.config.ts`（新增 `/api` 代理）并新增 `.env.development`，Vite 被反复重启；最后一次全套 **53/54**，唯一失败项是新 context 首次访问超时（环境问题）

### 发现（未处理，供后续决策）

- **模型偶尔仍会提到文档标题**：3 次提问中有 1 次在解释「知识库没有 X，最接近的是《Y》」时写出书名号标题。这属于解释性提及而非引用清单，强行禁止会损害可用性（用户需要知道命中的是哪篇），且需重跑 A1；本轮只禁止"罗列引用清单与出处元数据"，未再收紧。
- **声明条存在两种口径**：服务端 `ensureFreshnessDeclaration` 以 `/数据截至|数据来源/` 判定"模型是否已声明"，模型改用同义表述（如「最近导入时间为 …」）时不会追加标准声明条 → 同一界面会出现两种声明措辞。要统一应扩大判定词表或改为结构化声明块；本轮未动，以免正文更啰嗦。
- 正文里出现过「提报人」一词（"责任由提报人所在部门承担"），那是文档正文里的业务术语，不是出处元数据，未做拦截。

## 引用收敛：一份回答只保留最准确的一篇文档依据（2026-09-14）

### Change

- **问题**：一次回答的「引用来源」条数 = 检索片段数。`search_knowledge` 默认 `topK = 5`（管理员可配 1–20），`tools.mjs` 把每个命中片段都写成一条引用，同一篇文档的多个切片还会各占一条 → 依据面板常出现 3–5 张卡片，结论只有一句话，依据却铺满一屏。
- **收敛口径（已确认）**：**只收敛依据清单，不收敛模型上下文**。检索片段仍按管理员配置的条数回灌模型（`wrapReferenceData`）——「某流程分几步」这类问题常需多个片段拼合，把上下文砍到 1 篇会直接损害答案完整性。落库 `citations`、SSE 返回、右栏「本次回答的依据」、纠错反馈列表则统一只保留**最准确的一篇**文档。
- **挑选依据**：片段得分由 `tools.mjs` 透传（citation 新增 `score` 字段），构成见 `knowledge.mjs` 的关键词检索排序（覆盖率与命中数主导、trgm 相似度次之）。同一篇文档的多个命中切片只有最高分那条能进依据；多轮工具调用之间同样按得分取最高；得分缺失时回退为「首次出现优先」。
- **新增 `selectTopDocumentCitations()`**（`server/ai-agent/orchestrator.mjs`）：在出口层（步骤 10 落库之前）一次性裁决，保证落库、SSE、面板、反馈列表四处口径一致；保持原引用顺序、被保留项仍在原位，且不修改入参。`dedupeCitations()` 职责不变（仍按「文档-切片」去重），两者串联使用。
- **数据集引用不参与收敛**：它是业务数据的来源与时效声明（需求文档 §5.1，A4 要求声明率 100%），一次问答常同时用到广告、业务报告、库存、订单多张报表，砍掉任一条都会让声明失真。
- **演示 provider 同步**（`providers/demo.mjs`）：回答正文里的「引用来源」清单也只列最准确的一篇，避免"正文列了多条、面板只剩一条"的自相矛盾（要点列表仍覆盖全部片段——那是回答内容，不是依据清单）。

### Verify

- 服务端单测 **348 → 352/352**（新增 4 项：只留最高分文档、同文档多切片取最高分、数据集不收敛且保持原位、得分缺失回退首次出现、与去重串联且不改动入参）；`lint`、`build` 全绿
- 实测（临时实例 8788 + 真实模型 `openai-compatible`）：
  - 知识问答「亚马逊断货了怎么补货？流程是什么？」→ 引用 **1 条**（《亚马逊断货补货流程（SOP）》切片 0，score 90.03）
  - 业务数据问答「最近 30 天广告表现怎么样？」→ 引用 **2 条数据集**（Amazon 广告日报、Amazon 业务报告），未被收敛
  - 落库核对（`GET /api/ai/conversations/:id/messages`）：新产生的回答 citations 与 SSE 返回一致，均为文档 1 篇
- **不追溯历史数据**：改动前落库的回答仍保留当时的全部引用条目（审计事实不篡改），查看历史回答时按原样展示。

## 低优先缺陷清理 + 检索性能实测结论（2026-09-14）

### Fix

- **订单时间按本地时区显示**（`data-queries.mjs` 的 `formatTimestamp`）：原先用 `toISOString()` 输出 TIMESTAMPTZ，东八区用户看到的订单时间**早 8 小时**（实测同一行：旧 07:20 → 新 15:20）。改为本地时区格式化，与界面其它时间口径一致。
- **站点级查询触顶时不再丢掉最新数据**（`queryAdsDailyByMarketplace` / `querySalesDailyByMarketplace` / `querySalesForVelocity`）：`ORDER BY stat_date ASC LIMIT N` 在超过上限时截掉的是**最新**日期，而异常扫描与全站聚合正是靠这批数据下结论。改成 `DESC` 取最近窗口、返回前 `reverse()` 回升序（下游无需感知；实测 215 行仍严格升序）。
- **非法路径参数返回 400 而不是 500**（`PATCH /api/users/:id`、`PATCH /api/users/:id/status`）：`req.params.id` 此前直接进 SQL，传 `abc` 会让 PG 抛 22P02 变成 500。
- **导出截断不再静默**：`listNotesForExport` 的 2000 条上限提取为 `EXPORT_MAX_ROWS`，触顶时写审计（`detail.truncated`）并带 `X-Export-Truncated` 响应头，前端 toast 明确提示"条数已达上限，请缩小筛选范围"（此前用户会以为拿到的是全量）。

### Perf 结论：关键词检索 SQL 的索引化改写——用实测关闭

实测当前检索查询（与 `knowledge.mjs` 同构，含 LATERAL 逐行 `ILIKE`）：

```
数据规模：88 个切片 / 35 篇生效文档
Seq Scan on ai_chunks → 88 行
Execution Time: 0.868 ms（Planning Time: 1.322 ms）
```

结论：**当前规模下不存在可优化的性能瓶颈**（亚毫秒级）。而改写唯一可行的路径是用 trgm 索引预裁剪候选集，这会改变「关键词命中数 / 关键词总数 ≥ 下限」的召回语义 —— 该语义与相关性下限 0.2、A1 召回率 87% 都是标定过的，必须同步重跑 `eval/compare-retrieval.mjs` 重新标定，属于独立的检索优化轮次。

**触发条件**（达到任一条件再做，并带上评测）：切片量到万级、检索 P95 超过 100ms、或引入 embedding 混合检索（需求文档二期）。届时正解是「每个 token 单独走 GIN 索引 + 应用层合并命中集合」，而不是在 SQL 里写 `'%' || token || '%'` 这种规划器无法索引化的动态模式。

### Verify

- 服务端单测 **348/348**；`lint`、`build` 全绿
- 实测：订单时间 07:20 → 15:20（修正 8 小时时差）；站点级与销量窗口查询 215 行仍严格升序；非法 id 返回 400；导出 200 且未触顶时不带截断头；竞品分析与首页接口回归正常

## 剩余问题清零：令牌吊销、批量插入、前端请求收敛（2026-09-14）

### Feat

- **改密码即刻吊销旧 JWT**（迁移 3 + `server/index.mjs` + `server/ai-agent/router.mjs`）：`users` 新增 `token_version`，签发 token 时写入 `ver`，每次请求回源比对，重置密码时 `+1`。此前 JWT 无状态、有效期 8 小时 —— 「发现凭据泄露 → 改密码」这条常规处置在 8 小时内**完全无效**，攻击者仍能以受害者身份访问全部接口。旧 token 没有 `ver` 声明时按 0 处理，与库内初始值一致，因此不会把所有在线用户一次性踢下线。
- **演示模式不再自伤**（`providers/demo.mjs`）：回答模板原本自带「🔒 依据权限范围」，命中自家权限泄露正则 → 编排层把整段回答替换成统一拦截文案**并写一条 `tool_blocked` 审计**。结果是演示模式下正常问答全部变拦截文案、越权指标假阳性。措辞改为「🔒 检索范围：…」并补回归断言（断言 demo 回答不会被措辞检测误判）。
- **补齐账号与凭据类审计**：用户创建 / 改角色 / 启停 / 重置密码、纠错反馈「标记已处理」全部写审计（此前 `AUDIT_ACTIONS.login` 定义了却从未被调用，用户管理动作零留痕）。反馈处理同时改为幂等（`AND handled = false`），重复调用返回 409 而不是假成功。
- **「我的沉淀」导出与列表共用筛选**（`note-space.tsx`）：此前导出只带 `status`，用户搜索后导出的范围会超出屏幕上看到的内容。

### Perf

- **导入与切片改批量 INSERT**：`datasets.mjs` 按 500 行、`knowledge.mjs` 按 200 片分批提交。逐行 `client.query` 是"一行一次往返"，几千行的报表就是几千次序列化→网络→解析→计划→执行，且全程占着同一事务与连接。实测 1200 行 36ms。

### Refactor

- **前端请求层收敛**（`src/api/client.ts`）：统一导出 `API_BASE_URL` / `authHeaders` / `apiUrl` / `rawRequest`，把 6 处裸 `fetch`（文档上传、报表导入、审计导出、沉淀导出、SSE、模板下载）全部改走它。此前它们绕过 axios 实例，导致 401 不触发全局登出跳转、服务端写好的中文错误原因被吞成"上传失败"。
- **会话搜索改走服务端**：`GET /ai/conversations` 只返回最近 100 条，旧实现只在这 100 条里做客户端过滤 —— 第 101 条起既看不着也搜不到。现在搜索词经 300ms 防抖（新增 `src/hooks/use-debounced-value.ts`）后由服务端全库检索，输入框仍用即时值保证手感。

### Fix

- **`test:server` 漏跑子目录测试**：脚本写的是 `server/ai-agent/*.node-test.mjs`，只匹配一层，`providers/index.node-test.mjs` 的 **24 项测试从未被执行过**（provider 相关改动长期无回归保护）。现已纳入，测试总数 324 → 348。
- 用户迁移版本断言不再写死 `[2]`（新增迁移就失败的脆弱断言）。

### Verify

- 服务端单测 **348/348**；前端测试 **123/125**（仅剩预先存在的 `auth-layout.test.tsx` 2 项 locator 失败）；`lint`、`build` 全绿
- 实测令牌吊销：改密码后旧 token 在 `/api/auth/me` 与 `/api/ai/conversations` 均返回 **401「密码已变更，请重新登录。」**；新密码签发的新 token 正常；未改密码的账号不受影响
- 实测批量插入：1200 行数据集（0.03ms/行）与 39 个文档切片全部落库并逐项核对，验证数据已清理

### 未做与原因

- **关键词检索 SQL 的索引化改写**（`knowledge.mjs:363` 的 LATERAL 全表 `ILIKE`）：当前库内只有 88 个切片，规模上没有实际收益；而改写必然调整候选集裁剪方式，会改变既有召回结果（A1 基线召回率 87%、相关性下限 0.2 都是标定过的）。要做必须同步重跑 `eval/compare-retrieval.mjs` 重新标定，属独立的检索优化轮次，不宜与安全修复混在一个提交里。
- 导出 2000 行静默截断、错误响应形状统一、超长单行路由等低优先项未动。

## 安全与稳定性加固：认证、SSRF、连接池、治理链（2026-09-14）

> 来源：两路只读深度代码审查（服务端逐文件 / 前端逐组件）后按严重度修复，详细缺陷描述与验证方式见 `交接文档.md` 与各模块责任田。

### Security

- **修复「未认证者接管任意账号」路径**（`server/index.mjs`）：登录接口原先把缺失的 `password` 当作空串去比对哈希（`bcrypt.compare('', hash)` 对空串哈希返回 `true`），而重置密码接口允许把密码置空（`bcrypt.hash('')`）。两者叠加后，任何持 admin 凭据者（或管理员误操作）把账号密码置空，未认证访问者即可直接登录。现在登录在**查库前**拒绝空/缺失密码，重置密码强制 8–128 位并校验用户 ID。
- **模型 Base URL 加白名单校验，堵住 SSRF 与明文密钥外发**（`http-utils.mjs`、`audit-routes.mjs`）：该地址会被服务端带着解密的 API Key 请求，连通性测试接口还会**立即**出站。原先只校验「像不像 http(s) 地址」，可填内网地址（169.254.169.254 / 127.0.0.1 / 10.x）或攻击者域名。现在必须 https、必须是域名、拒绝本机与内网域名；内网私有模型部署可设 `AI_MODEL_ALLOW_PRIVATE_HOST=true` 放开（默认关闭）。
- **审计 IP 不再采信客户端可伪造的 `X-Forwarded-For`**：该请求头完全由客户端控制，原先直接取第一个值写进审计，等于任何人都能伪造成任意 IP（含栽赃他人）。现在默认只取直连地址，仅在 `TRUST_PROXY=true` 时采信转发头并取链尾一跳。
- **账号与凭据类动作补审计**：登录成功/失败（四个失败原因分类）、重置密码均写审计；此前 `AUDIT_ACTIONS.login` 定义了却从未被调用，用户管理动作零留痕。`detail` 只记账号，绝不记密码。
- **已发布沉淀禁止删除，归档同事务下线公共文档**（`notes.mjs`、`knowledge.mjs`）：`updateNote` 原本有 `published` 守卫而 `deleteNote` 没有，归档也不触碰文档 —— 员工一次删除/归档即让条目消失、而 `experience` 文档继续被检索，留下无主的生效知识且无法从文档回溯来源。前端删除按钮同步禁用并给出提示文案（此前确认框还写着「保留已发布文档」，与实现不符）。

### Fix

- **token 统计重复累加**（`orchestrator.mjs`）：循环内每轮先累加该轮 completion 的 token，若该轮因「工具被拦截 / 执行失败」而 break，收尾逻辑会对同一个 completion 再计一遍，导致 `ai_messages` 与审计台用量偏高。新增 `completionCounted` 标志。
- **SSE 问答加每账号并发闸门**（`chat.mjs`）：超出上限（默认 3）直接 429，而不是让所有请求一起排队 —— 一次问答最坏会跑完多轮模型调用并长期占用连接。

### Perf

- **连接池补上限与超时**（`db.mjs`）：pg 默认 `max=10` 且无任何超时，一次慢查询在上层 `Promise.race` 超时后连接**不会释放**，约 10 个并发问答即可占满连接池，此后所有接口永久排队（整站挂死且无错误日志）。现设 `max=20`、`statement_timeout=15s`、`query_timeout=20s`、连接与空闲超时，均可通过 `PG_*` 环境变量覆盖。
- **迁移 113 补 6 个热路径索引**：`ai_runs(message_id)`（会话轨迹 JOIN 键）、`ai_messages(created_at)`、`ai_audit_logs(created_at)`（用量统计与审计台默认排序）、`amazon_ads_daily/amazon_sales_daily(marketplace, stat_date)`（站点级查询不带 asin，原索引前导列用不上）、`order_snapshot(ordered_at)`。全部 `IF NOT EXISTS`，只加索引不改数据。
- **上传入口键盘可达**（`knowledge-management.tsx`、`datasource-management.tsx`）：原先用 `Button asChild` 包 `<label>` + `hidden` input —— label 不可聚焦、input 为 `display:none` 也不可聚焦，**键盘用户完全无法上传**（全站唯一上传入口）；且 `disabled` 落在 label 上不匹配 `:disabled`，导致"导入中"仍可点、能并发重复导入。改为按钮 `click()` 触发 + `sr-only` input。

### Verify

- 服务端单测 **324/324**（新增 Base URL 白名单 2 项）
- 实测：空密码账号登录 **401**（脚本已先证实 `compare('', hash) === true` 这一旧前提成立）、缺 password 字段 401、重置空/短密码 400、正常流程 204/200；四类登录审计分支均落库
- 实测：内网/明文/回环 Base URL 在设置接口与连通性测试接口均 **400**；迁移 113 与 6 个索引已应用
- 回归：竞品分析真实链路 200、4 个块、30 行数据正常
- `pnpm run lint`、`pnpm run build` 全绿

## 竞品分析接入真实链路 + 首页「我的 AI」+ 修复两处结论级数据缺陷（2026-09-14）

### Fix

- **竞品分析不再返回硬编码假结果**（`server/index.mjs`、`server/competitor-analysis.mjs`）：历史实现对任意输入都返回同一组写死的结论（`portable blender` / `电池续航不足` 等），违反「真实接口接入前不得硬编码成功状态掩盖未实现逻辑」。现在改为复用 AI 助手的 `amazonPerformancePayload` 计算真实广告与销售表现，输出期间汇总、环比、按日明细与趋势图；输入收敛为 ASIN（支持粘贴 `/dp/`、`/gp/product/` 链接），品牌名与店铺链接明确返回 400 并说明需要品牌分析或 SP-API 授权。
- **停止写入 `work_items` 假进度**：每次分析原本会插入一条 `progress=65` 的任务，永不完成、也没有任何清除入口（实测库里 0 行，界面长期空态）。
- **汇总口径修复**（`analytics.mjs`）：`sales` 曾被业务销售额覆盖，而标签写「广告销售额」、ACoS 也按广告口径算，出现「广告销售额 60000 / ACoS 25%」这类自相矛盾的数字；新增 `mergeAdAndBusinessSummary()` 分离 `sales`（广告）与 `businessSales`（业务），对比块同步。
- **区间天数修复**：`period.days` 原本是参与汇总的**行数**（单 ASIN 30 天 × 5 campaign 显示「150 天」），改为真区间天数并把行数移入 `period.rowCount`。
- **DATE 时区偏移修复**（`server/db.mjs`）：pg 默认把 DATE 解析成本地时区午夜的 Date，再经 `toISOString()` 整体前移一天（东八区必现），导致按日期区间取数时**丢掉第一天**（30 天窗口只算 29 天，汇总数字系统性偏小 3.3%）；现在原样返回 `'YYYY-MM-DD'` 字符串，同时修掉「提示词里数据覆盖区间反向」「导入周期差一天」。
- **新增统一错误出口**（`server/index.mjs`）：此前未捕获异常走 Express 默认处理器，返回 HTML 错误页（非 production 下含堆栈），而前端所有接口按 JSON 解析错误体；现在统一回 `{ message: '服务器内部错误，请稍后重试。' }`，堆栈只留在服务端日志。

### Feat

- **首页「正在进行的工作」替换为「我的 AI」**（`src/features/dashboard/my-ai-card.tsx`）：改为展示账号自己的最近 3 条对话与沉淀总数/待审核数，数据来自员工可读的 `/ai/conversations` 与 `/ai/notes`。原卡片读的 `work_items` 只有假进度写入，而首页此前完全不体现项目真实使用重心（AI 会话 506、运行 579、沉淀 63，两张内容卡数据源实测均为 0 行）。
- **竞品分析页面重写**：复用 AI 助手的 `AnswerBlocks` 渲染结构化结果（指标卡 / 对比 / 明细表 / 趋势图），补充「未接入的分析维度」说明、输入校验与失败重试。

### Verify

- 服务端单测 **322/322**（新增竞品分析 8 项、口径与天数回归 2 项）
- 竞品分析卡片数字与数据库真值 **5/5 一致**（修复时区偏移前为 4/5，偏差 3.3%）
- 前端测试 **123/125**（仅剩预先存在的 `auth-layout.test.tsx` 2 项 locator 失败，与本次改动无关）
- `pnpm run lint`、`pnpm run build` 全绿

## AI 助手：治理面层级再收敛（2026-09-11）

### Refactor

- **AI 治理收缩到「设置」下面**：不再是独立主类目，侧边栏路径变为「其他 → 设置 → AI 治理」（`/admin/ai`），二级项不挂三级菜单。
- **五个子页移出侧边栏**：知识库、数据源与导入、经验审核、模型与配置、审计台改由**页内顶部横向导航**承载，与「AI 治理」构成同一层级的六个入口，任意子页可一键横向切换 —— 解决导航层级分散的问题。
- **新增「AI 治理」概览首页**（`/admin/ai`）：知识文档数 / 数据集覆盖 / 待审核经验 / 近 14 天用量四张统计卡，加「治理入口」「模型状态」「合规信号」三块，宽屏多列铺满 —— 解决治理页只有单列表格、右侧空旷的问题。
- 后台区域 Header 文案改为「设置 · AI 治理」，体现归属层级。
- 新增 `NavItem.matchPrefix`：入口页在子页路径下保持高亮（`/admin/ai` 在 `/admin/ai/*` 下仍激活），用显式字段避免 `/ai-agent` 连带点亮 `/ai-agent/notes`。

### 验证

- UI 冒烟 63/63（新增六项断言：AI 治理在设置下、侧边栏不再挂五子页、落点 /admin/ai、顶部六个同级入口、概览卡渲染、子页下入口仍激活；普通账号视角与 A12 回归全过）
- `verify-e2e` 43/43、服务端单测 312 项、`pnpm run build` 与 `lint` 全绿

## AI 助手：信息架构重构（使用面 / 治理面分离）（2026-09-11）

### Refactor

- **AI 助手拆成两层**：员工面 `/ai-agent`（对话、我的沉淀）与治理面 `/admin/ai/*`（知识库、数据源与导入、经验审核、模型与配置、审计台）。模块内导航从「管理员 5 项混排」收敛为固定的 2 项使用面入口。
- **「模型与配置」独立成页**：原先藏在审计台的第 5 个 tab 里（改密钥/护栏/工具开关要找"审计台"），现为 `/admin/ai/settings`；审计台只留 4 个审计视图。
- **侧边栏支持按角色过滤**（新增 `nav-filter.ts` + `adminOnly` 字段）：新增仅管理员可见的「AI 治理」分组；「设置 → 用户管理」标记为管理员专属 —— 此前普通账号能看到它，点进去却因服务端 403 只看到报错。
- **旧入口保留跳转**：`/ai-agent/{knowledge,datasources,distill,audit}` 自动跳到对应的后台页，老书签不失效。
- 统一页面壳 `PageShell`（标题 + 说明 + 滚动容器）：消除 4 处重复的 `h-full overflow-y-auto pe-2 pb-10`，并让治理页标题层级一致；对话页补 `sr-only` 的 `h1`。

### Feat

- **技能成本参数上收给管理员**（迁移 111 增 `ai_skills.policy`）：触发方式、每日 AI 整理上限、整理字段改由管理员在「经验审核 → 技能治理」统一设置，**员工只能开关**；员工带这些字段的请求返回 400（不静默忽略，避免界面显示"保存成功"却没生效）。

### Fix

- **数据源与导入页此前没有任何入口**（`/ai-agent/datasources` 只存在于路由表），管理员只能手输 URL；现从侧边栏「AI 治理」进入。
- **`.env` 的 `CORS_ORIGIN` 未包含验证端口导致登录被浏览器拦掉**：`.env` 会覆盖启动时的 shell 变量，验证实例需使用 `.env` 中已允许的端口（现为 5173/5174）。
- **前后端版本不一致时页面白屏**：`skill-config-card` 读 `state.policy.fieldKeys`，旧服务端不下发该字段即崩；已加兜底。

### 验证

- 单测 309 项、`verify-e2e` 43/43（真实模型，含"员工不能自调上限""员工只读管理员策略"两项回归）、`verify-ui` 59/59（含普通账号视角：无「AI 治理」、访问治理页落 403、仍可用「我的沉淀」；A12 回归全过）、`pnpm run build` / `lint` 全绿。

### 踩过的坑

- **改路由结构后 Vite 开发服务器会漂移**：新增/删除路由文件期间，表现为 SSE 请求 200 后被 abort、答案不渲染，或 `Invalid hook call`（重复 React 实例）。规避：改完路由重启 dev server，必要时清 `node_modules/.vite`。

## AI 助手：账号级知识沉淀（2026-09-11）

### Feat

- **每个账号独立的知识沉淀空间**（迁移 106/107/108）：`ai_knowledge_notes`（`owner_user_id` 做账号隔离，状态机 private → pending → published/rejected/archived，软删不物删）、`ai_skills` + `ai_user_skills`（账号级技能配置，**默认关闭**）、`provenance`/`evidence` 可信度字段；`ai_documents` 增 `owner_user_id` 记提报人。
- **技能契约**（`server/ai-agent/skill-contracts.mjs`）：字段定义沿用 Claude SKILL.md 的 frontmatter 约定（name/description/version/triggers + 正文指令），由迁移种子、抽取提示词、前端表单共用一份，避免多处抄写。
- **员工侧「我的沉淀」**（`/ai-agent/notes`）：手工新建、会话内「沉淀为知识」由 AI 整理成六字段经验条目、编辑、提交审核、归档、删除、导出（CSV / 合并 Markdown / JSON），以及技能配置卡（开关、触发方式、每日 AI 整理上限、字段选择）。
- **管理员侧「沉淀管理」**（`/ai-agent/distill`）：全账号沉淀列表与按账号统计、审核队列、编辑、归档、软删、按筛选导出、技能全局启停与账号启用一览。
- **写权分离**：员工只能提交审核，只有管理员能通过/驳回；管理员也不能把他人私有草稿直接置为已发布。审核通过生成 `source_type='experience'` 文档（`source_ref='note:<id>'` 幂等），检索命中时标注「员工经验 · 提报人」。
- 导出动作本身写审计；新增审计动作 `note_distill`。

### Fix

- **配额口径错误**：原先按「当天新建沉淀条数」计数，把手工新建也算进去，连续跑几轮验收即误报 429、与界面承诺（手工新建不计入）矛盾。改为统计当天真实 AI 整理次数（依据审计记录），`0` 表示不限制。
- **引用重复触发 React 重复 key**：多轮工具调用会重复返回同一批片段，编排层直接累计导致引用面板出现重复条目（实测控制台报 "two children with the same key"）。改为按「文档+切片 / 数据集+周期」去重累计，前端 key 另加下标兜底。
- **提报人显示错误**：检索 SQL 原先关联 `created_by`（experience 文档由审核管理员创建），引用面板会把审核人当成提报人。改为 `COALESCE(d.owner_user_id, d.created_by)`。
- 验收脚本 `A5-3` 断言依赖 `tool_blocked` 最近 20 条窗口，会被编排层「模型自己描述工具」的拦截记录挤出（实测必漏），窗口放大到 300；这是既有测试缺陷，与本次功能无关。

### 说明

- **本轮不做**（已在计划文档中明确）：会话结束自动触发沉淀、SKILL.md 导入、个人沉淀参与问答检索、ZIP 打包导出。
- 与并行轨道（产品主数据）同时开发：本轨道占用迁移 106–108，对方占用 109/110。
- 调研结论：Anthropic 官方 `anthropics/skills` 的 20 个技能里**没有**记忆/沉淀类技能，社区实现（如 `justinabrahms/knowledge-skill`、`basicmachines-co/basic-memory`）只能抄模式（SKILL.md 三段式 + description 写触发条件、写权分离的审核队列、账号即隔离边界、受治理写管道），工程必须自研。

## AI 助手：产品主数据打通库存与销售（2026-09-11）

### Feat

- **新增 `product_master` 数据集**（迁移 109）：SKU ↔ ASIN/站点映射，含商品名称、分类、状态（不含采购成本等敏感字段）。
- **库存风险分析改用完整销售历史**：日均销量优先由「产品主数据 → 销售报告」在指定窗口内计算（`velocityWindowDays`，默认 30 天，范围 7–180），缺少映射时回退订单快照并标注低置信度。
- 风险明细表新增「销量口径」列；摘要句说明用了哪种口径与统计窗口。

### Fix

- **纠正会误导清库存的误判**：`KT-JH-001-BK` 原先用 3 天订单样本算得"可售 133 天 → 积压"，实际日均卖 9.27 件、可售 43 天属健康。改用 30 天销售历史后结论修正。
- **统计窗口锚定数据最后一天**而不是"今天"：报表是滞后数据，用今天做锚点会得到空窗口并误判全部 SKU 无销量。
- **区分"没卖出去"与"报表没覆盖"**：ASIN 在窗口内完全无记录时回退其他口径，不判滞销。
- 未登记产品主数据的 SKU 明确提示补齐映射，而不是给出无依据的判断。

### 说明

- 本轮与另一条并行轨道（知识沉淀）同时开发：迁移号占用 109/110（对方占用 106–108）；新增迁移一律追加更高版本号。

---

## AI 助手：主动分析能力 M-B（2026-09-11）

让 Agent 从"用户问什么答什么"变成"主动指出哪里出了问题"。

### Feat

- **`scan_amazon_anomalies`**：扫描站点周期内全部 ASIN，按严重度排序输出异常清单、每项命中的信号（ACoS 超预警线、转化率低于预警线、ACoS 环比涨幅、转化率环比跌幅、花费上涨但销售额下滑）与 ACoS 对比柱状图。
- **`analyze_inventory_risk`**：按 SKU 计算样本日均销量与可售天数，判定断货风险 / 积压 / 滞销 / 样本不足 / 缺销量数据，并给出建议补货量。
- **`query_amazon_performance` 支持不传 ASIN**：全站聚合 + 各 ASIN 花费与 ACoS 排行，回答"整体怎么样""哪个 ASIN 最差"。
- **柱状图渲染**：回答卡片 chart 块支持 bar 类型，颜色取自主题 `--chart-*`。
- 严重度模型：ACoS/转化率超线各 +2，三类趋势信号各 +1；0=正常、1-3=需关注、≥4=高风险。

### Fix

- **越权时模型会念出可用工具清单**（安全）：实测 4 次有 3 次枚举自己的能力范围，等于权限探测探针。现按真实样本固化模式识别，并统一规整为固定拦截文案、写 `tool_blocked` 审计。
- **模型把"上个月"推成去年同月**：提示词补充算好的日期示例。
- **模型间歇性误拒管理员的合法请求**（约 1/6）：提示词明确"依据只能是工具列表、工具在列表里就必须调用，不得自行预判权限"。
- **快照类数据集"覆盖"导入退化成合并**：库存/订单快照的覆盖模式改为整表替换，避免上一批已失效的行长期留存。
- **样本不足时不再判定积压/滞销**：3 天样本就判"积压 133 天"会误导清库存，现降级为「样本不足」；断货风险仍保守告警。

### 验收

- 单元测试 **214/214**；`verify-e2e --live` **21/21**；`verify-ui` **38/38**
- 数据类问题 **12/12**（M-A 7 题 + M-B 5 题）：关键数字与服务端真值一致率 100%、数据时效声明率 100%、负样本正确率 100%

---

## AI 助手：业务数据接入闭环 M-A（2026-09-11）

补齐产品目标里"集中连接并沉淀业务数据 + 查询与分析"这块此前完全空白的能力：Agent 现在能查 Amazon 广告/销售、库存、订单，并给出**带对比表、趋势图与可复核归因**的结论。

### Feat

- **数据源与导入（管理员）**：新增 `/ai-agent/datasources` 页；CSV 模板下载、上传导入、列名校验（缺必填列整批拒绝）、覆盖/追加两种模式、导入记录与失败行明细、数据集覆盖率与数据时效展示。CSV 编码自动识别 UTF-8 / GBK，日期解析支持 ISO、斜杠、中文日期与 Excel 序列号。
- **四个数据集**：`amazon_ads_daily`、`amazon_sales_daily`、`inventory_snapshot`、`order_snapshot` 真正落库可用。
- **两个数据查询工具**：`query_amazon_performance`（按日明细 + 期间汇总 + 环比/同比 + ACoS 驱动分解 + 异常判定）、`query_inventory_orders`（分仓库存 + 订单明细），均为 `requiredRole: 'user'`。
- **服务端分析引擎 `analytics.mjs`**：ACoS 涨跌用**顺序分解法**拆成花费效应与销售额效应，两部分相加**恰好等于总变化**（残差为 0，有单测锁定）；除零一律返回 null，不产生 NaN/Infinity。
- **回答卡片结构化数据块**：新增 `ai_messages.blocks`（迁移 103），支持指标卡 / 明细表（@tanstack/react-table，可排序）/ 趋势图（recharts，颜色取自主题 `--chart-*`）。
- **运行时上下文注入**：系统提示词带上当前日期与各数据集的覆盖区间、行数、导入时间，使"上个月""去年同期"等相对时间能被正确换算。
- **数据集引用**：引用来源区分文档与数据集，数据集引用显示覆盖周期与导入时间，并注明"准实时、非实时"。
- 新增数据集查询接口：`GET /api/ai/datasets`、`GET /api/ai/imports`、`GET /api/ai/imports/template`、`POST /api/ai/imports`。

### Fix

- **模型不知道"今天"导致相对时间算错**：修复前问"上个月"会查一个空区间并回答"查不到数据"；现在提示词注入当前日期与数据覆盖范围。
- **流式结束后表格与趋势图消失**：`serializeMessage` 漏返回 `blocks`。
- **声明条显示"数据截至 Fri Sep 11"**：时效字段统一 ISO 格式化，并同时声明"导入时间"与"数据覆盖至"。

### 验收

- 单元测试 **199/199**；`verify-e2e --live` **21/21**；`verify-ui` **35/35**（含表格与趋势图渲染断言）
- 场景二/三验收 **7/7**：工具调用正确率 100%、关键数字与服务端真值一致率 100%、数据时效声明率 100%、负样本（不存在的 ASIN/SKU）正确率 100%
- 报告：`server/ai-agent/eval/reports/*-data-baseline-*.md`

### 范围说明

- 本期仍为**只读**：不提供写操作（改价、调库存等）。
- 数据通过**人工导出报表后导入**接入，非实时；ERP 实时连接、物流与产品数据、飞书文档同步、经验提报审核、PDF/Word 解析仍待后续。
- `.xlsx` 需先另存为 CSV（解析库选型待确认，对应需求文档 Q6）。

---

## AI 助手：真实模型上线修复（2026-09-11）

接入 deepseek-chat 后跑通全链路，并修复三个**只在真实模型下才暴露**的缺陷。

### Fix

- **不调工具时回答被误报「AI 服务暂不可用」**（高危）：`answer` 只在工具循环内赋值，模型直接作答（问候语、判断无需检索）时回答被丢弃并替换为错误提示，审计也误记为 error。改为用第一轮返回内容初始化 `answer`。
- **新会话的回答流式显示完就消失**（高危）：`refresh()` 用的是发起请求时闭包里的 `activeId`（新会话时为 `null`），导致真正落库的会话从未被重新拉取。新增 `conversationIdRef` 记录本次请求实际使用的会话，刷新以它为准；同时把副作用移出 `setState` updater。
- **越权拦截未写审计**：模型按提示词直接输出统一文案时行为正确，但编排层只在"主动替换文案"时才记 `blocked`。现在模型级拒绝同样记为拦截并写 `tool_blocked` 审计（A5 要求拦截并记录）。

### Feat

- **降级返回**：模型没产出总结但检索有结果时，按需求文档 §9 返回检索原文并明示降级状态，而不是谎报服务不可用。
- **服务端措辞兜底**：模型用自己的话描述工具/权限范围、点名无权工具或自述式拒绝时，统一替换为固定拦截文案（防止权限探测）。
- **声明条兜底**：模型漏写数据来源与截至时间时，由服务端补一条确定性声明（仅在确有引用文档时补）。

### 验证

- `verify-e2e.mjs --live`：**21/21**（含 token 用量、工具调用、流式分片、无演示标记等真实模型专属断言）
- `verify-ui.mjs`：**29/29**；`pnpm run test:server`：**144/144**；`lint` / `build` 通过
- A1 基线（真实模型）：预期文档召回率 **100%**、越权拦截 **100%**、负样本正确声明 **100%**、首字延迟中位 1.6s / P90 2.0s

---

## AI 助手：模型密钥后台配置（2026-09-10）

### Feat

- **后台配置模型接入**：管理员在「AI 助手 → 审计台 → 模型与配置」填写 Base URL / 模型名 / API Key，保存后**即时生效、无需重启服务**；支持「先测后存」的连通性测试与「强制演示模式」开关。
- **配置优先级**：后台配置（数据库）> 环境变量 > 演示模式。环境变量保留给本地开发与 CI。
- **密钥加密存储**：AES-256-GCM（`server/ai-agent/secrets.mjs`），加密密钥取自 `AI_SETTINGS_SECRET`，未配置时回退 `JWT_SECRET`；两者都没有时拒绝保存并给出可操作提示，不降级成明文存储。
- **密钥脱敏**：接口只回传掩码（`sk-a…b1c2`）与配置状态；审计只记掩码与指纹；输入框永不回填明文。
- 新增迁移 `102 add_model_credentials_to_settings`（新增 `model_base_url`、`model_api_key_cipher`、`model_api_key_hint`、`model_api_key_fingerprint`、`model_api_key_updated_at`、`force_demo` 六列）。
- 新增 `POST /api/ai/settings/test` 连通性测试接口。

### 说明

- 这是对需求文档 §8.3「API Key 通过环境变量注入，不写入代码库」的**受控偏离**：密钥仍然不写入代码库，但会加密落入 `ai_settings`。运维换服务器时需一并带走 `AI_SETTINGS_SECRET`，否则需在后台重填 Key。
- 新增单测：`secrets.node-test.mjs`（13 项）、`audit-routes.node-test.mjs`（14 项），并扩充 provider 测试覆盖"数据库优先"与"密文解不开"分支。

---

## AI 助手 MVP-A（2026-09-10）

按 `需求文档.md` 交付「企业 AI 与 Agent 统一入口」的最小可用切片，跑通
「员工提问 → 权限裁剪 → Agent 调用工具检索 → 模型生成结论 → 回答附出处与时效 → 全过程落审计」。

### Feat

- **对话工作台**：`/ai-agent` 三栏布局（会话列表 / 消息流 / 引用与依据面板），SSE 流式输出、停止生成、重新生成、轮次上限、空状态引导问题、窄屏右栏折叠为抽屉。
- **AI 回答卡片**：固定顺序为结论 → 编排进展 → 引用来源 → 声明条（📊 数据来源 · 🕐 数据截至 · 🔒 权限范围）→ 有用 / 有问题反馈；`mode = demo` 时显著标注「演示模式」。
- **知识库管理**：`/ai-agent/knowledge`（管理员），文本/Markdown 入库、切片预览、有效期、下线、重新启用、删除、手动重建索引、待处理纠错反馈闭环。
- **审计台**：`/ai-agent/audit`（管理员），工具调用明细、拦截记录、会话完整轨迹、管理动作日志、CSV 导出、模型与编排配置、工具开关、近 14 天 token 用量。
- **权限裁剪三层**：工具注册裁剪（层①）、执行前二次校验（层②）、检索范围过滤（层③），统一收敛在 `server/ai-agent/permissions.mjs`。
- **强制审计**：编排层写 `ai_messages` / `ai_runs` / `ai_audit_logs`，被拦截与失败的调用同样留痕；审计无删除入口。
- **双 provider**：OpenAI 兼容协议真实模型 + 无 Key 时可用的演示 provider，两者走完全相同的编排 / 权限 / 审计代码路径。
- **一期工具**：`search_knowledge`（user）、`rebuild_knowledge_index`（admin）、`deactivate_document`（admin）。
- **数据模型**：新增 12 张 `ai_*` 表与 4 张数据集表，启用 `pgvector`（`embedding vector(1024)` 预留）与 `pg_trgm`。

### Fix

- `requireUser` 补下发用户 `status`，修复 AI 权限判定因缺少该字段而全量误拦的问题。
- 知识检索关键词同时匹配文档标题与片段正文，修复按文档名提问检索不到内容的问题。
- 支持中文文件名上传（前端 `encodeURIComponent` + 服务端容错解码）。
- 修正工具参数校验顺序，使枚举与数值范围限制对字符串参数同样生效。

### 说明

- MVP-A **不含**：飞书 SSO 与文档同步、ERP 只读连接、Excel 导入、经验提报审核、Amazon/库存数据集工具、用量统计页之外的数据看板（表结构已预留）。
- PDF / Word / Excel 解析本轮不支持，接口明确报错，不静默失败（解析库选型对应需求文档 Q6）。
- 验收记录：`docs/superpowers/verification/2026-09-10-ai-agent-mvp-acceptance.md`（端到端 16/16，A5 越权拦截与 A6 注入防护两项一票否决全部通过）。

---

## 上游基线历史（shadcn-admin）

## v2.2.1 (2025-11-06)

### Fix

- **style**: update data attribute class in authenticated layout (#249)
- prevent navigation to 500 page during development (#240)
- **style**: apply variant 'destructive' to sign-out buttons (#236)
- add missing space in profile form (#235)

### Refactor

- enhance tables and update table layout (#234)

## v2.2.0 (2025-10-09)

### Feat

- add analytics tab in dashboard page (#220)
- add extra AppTitle component for sidebar header (#216)
- update 2-column sign in page (#213)

### Fix

- update sidebar menu chevron direction in RTL mode (#229)
- pagination button spacing (#215)
- upgrade lucide-react to solve antivirus warning (#211)

### Refactor

- move sidebar related components into app-sidebar
- change SidebarInset component from 'main' to 'div'
- replace extra main container query with content container query
- replace inline svg logo with logo component (#214)

## v2.1.0 (2025-08-23)

### Feat

- enhance data table pagination with page numbers (#207)
- enhance auth flow with sign-out dialogs and redirect functionality (#206)

### Refactor

- reorganize utility files into `lib/` folder (#209)
- extract data-table components and reorganize structure (#208)

## v2.0.0 (2025-08-16)

### BREAKING CHANGE

- CSS file structure has been reorganized

### Feat

- add search param sync in apps route (#200)
- improve tables and sync table states with search param (#199)
- add data table bulk action toolbar (#196)
- add config drawer and update overall layout (#186)
- RTL support (#179)

### Fix

- adjust layout styles in search and top nav in dashboard page
- update spacing and layout styles
- update faceted icon color
- improve user table hover & selected styles (#195)
- add max-width for large screens to improve responsiveness (#194)
- adjust chat border radius for better responsiveness (#193)
- update hard-coded or inconsistent colors (#191)
- use variable for inset layout height calculation
- faded-bottom overflow issue in inset layout
- hide unnecessary configs on mobile (#189)
- adjust file input text vertical alignment (#188)

### Refactor

- enforce consistency and code quality (#198)
- improve code quality and consistency (#197)
- update error routes (#192)
- remove DirSwitch component and its usage in Tasks (#190)
- standardize using cookie as persist state (#187)
- separate CSS into modular theme and base styles (#185)
- replace tabler icons with lucide icons (#183)

## v1.4.2 (2025-07-23)

### Fix

- remove unnecessary transitions in table (#176)
- overflow background in tables (#175)

## v1.4.1 (2025-06-25)

### Fix

- user list overflow in chat (#160)
- prevent showing collapsed menu on mobile (#155)
- white background select dropdown in dark mode (#149)

### Refactor

- update font config guide in fonts.ts (#164)

## v1.4.0 (2025-05-25)

### Feat

- **clerk**: add Clerk for auth and protected route (#146)

### Fix

- add an indicator for nested pages in search (#147)
- update faded-bottom color with css variable (#139)

## v1.3.0 (2025-04-16)

### Fix

- replace custom otp with input-otp component (#131)
- disable layout animation on mobile (#130)
- upgrade react-day-picker and update calendar component (#129)

### Others

- upgrade Tailwind CSS to v4 (#125)
- upgrade dependencies (#128)
- configure automatic code-splitting (#127)

## v1.2.0 (2025-04-12)

### Feat

- add loading indicator during page transitions (#119)
- add light favicons and theme-based switching (#112)
- add new chat dialog in chats page (#90)

### Fix

- add fallback font for fontFamily (#110)
- broken focus behavior in add user dialog (#113)

## v1.1.0 (2025-01-30)

### Feat

- allow changing font family in setting

### Fix

- update sidebar color in dark mode for consistent look (#87)
- use overflow-clip in table paginations (#86)
- **style**: update global scrollbar style (#82)
- toolbar filter placeholder typo in user table (#76)

## v1.0.3 (2024-12-28)

### Fix

- add gap between buttons in import task dialog (#70)
- hide button sort if column cannot be hidden & update filterFn (#69)
- nav links added in profile dropdown (#68)

### Refactor

- optimize states in users/tasks context (#71)

## v1.0.2 (2024-12-25)

### Fix

- update overall layout due to scroll-lock bug (#66)

### Refactor

- analyze and remove unused files/exports with knip (#67)

## v1.0.1 (2024-12-14)

### Fix

- merge two button components into one (#60)
- loading all tabler-icon chunks in dev mode (#59)
- display menu dropdown when sidebar collapsed (#58)
- update spacing & alignment in dialogs/drawers
- update border & transition of sticky columns in user table
- update heading alignment to left in user dialogs
- add height and scroll area in user mutation dialogs
- update `/dashboard` route to just `/`
- **build**: replace require with import in tailwind.config.js

### Refactor

- remove unnecessary layout-backup file

## v1.0.0 (2024-12-09)

### BREAKING CHANGE

- Restructured the entire folder
hierarchy to adopt a feature-based structure. This
change improves code modularity and maintainability
but introduces breaking changes.

### Feat

- implement task dialogs
- implement user invite dialog
- implement users CRUD
- implement global command/search
- implement custom sidebar trigger
- implement coming-soon page

### Fix

- uncontrolled issue in account setting
- card layout issue in app integrations page
- remove form reset logic from useEffect in task import
- update JSX types due to react 19
- prevent card stretch in filtered app layout
- layout wrap issue in tasks page on mobile
- update user column hover and selected colors
- add setTimeout in user dialog closing
- layout shift issue in dropdown modal
- z-axis overflow issue in header
- stretch search bar only in mobile
- language dropdown issue in account setting
- update overflow contents with scroll area

### Refactor

- update layouts and extract common layout
- reorganize project to feature-based structure

## v1.0.0-beta.5 (2024-11-11)

### Feat

- add multiple language support (#37)

### Fix

- ensure site syncs with system theme changes (#49)
- recent sales responsive on ipad view (#40)

## v1.0.0-beta.4 (2024-09-22)

### Feat

- upgrade theme button to theme dropdown (#33)
- **a11y**: add "Skip to Main" button to improve keyboard navigation (#27)

### Fix

- optimize onComplete/onIncomplete invocation (#32)
- solve asChild attribute issue in custom button (#31)
- improve custom Button component (#28)

## v1.0.0-beta.3 (2024-08-25)

### Feat

- implement chat page (#21)
- add 401 error page (#12)
- implement apps page
- add otp page

### Fix

- prevent focus zoom on mobile devices (#20)
- resolve eslint script issue (#18)
- **a11y**: update default aria-label of each pin-input
- resolve OTP paste issue in multi-digit pin-input
- update layouts and solve overflow issues (#11)
- sync pin inputs programmatically

## v1.0.0-beta.2 (2024-03-18)

### Feat

- implement custom pin-input component (#2)

## v1.0.0-beta.1 (2024-02-08)

### Feat

- update theme-color meta tag when theme is updated
- add coming soon page in broken pages
- implement tasks table and page
- add remaining settings pages
- add example error page for settings
- update general error page to be more flexible
- implement settings layout and settings profile page
- add error pages
- add password-input custom component
- add sign-up page
- add forgot-password page
- add box sign in page
- add email + password sign in page
- make sidebar responsive and accessible
- add tailwind prettier plugin
- make sidebar collapsed state in local storage
- add check current active nav hook
- add loader component ui
- update dropdown nav by default if child is active
- add main-panel in dashboard
- **ui**: add dark mode
- **ui**: implement side nav ui

### Fix

- update incorrect overflow side nav height
- exclude shadcn components from linting and remove unused props
- solve text overflow issue when nav text is long
- replace nav with dropdown in mobile topnav
- make sidebar scrollable when overflow
- update nav link keys
- **ui**: update label style

### Refactor

- move password-input component into custom component dir
- add custom button component
- extract redundant codes into layout component
- update react-router to use new api for routing
- update main panel layout
- update major layouts and styling
- update main panel to be responsive
- update sidebar collapsed state to false in mobile
- update sidebar logo and title
- **ui**: remove unnecessary spacing
- remove unused files

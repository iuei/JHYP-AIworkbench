# 变更日志：JHYP 智能工作台

本项目为公司内部系统，工程标识 `jhyp-ai-workbench`，英文目录名 `JHYP-AIworkbench`。

> **上游基线说明**
> 本项目基于开源项目 [shadcn-admin](https://github.com/satnaing/shadcn-admin)（MIT License，Copyright (c) 2024 Sat Naing）二次开发。
> 以下 v2.2.1 及更早的记录是**上游模板自身的历史**，仅作源码追溯用途，不代表本项目的功能范围与发布节奏。
> 本项目自身的变更记录将追加在本文件顶部（上游历史之上）。
>
> **本项目变更记录**

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

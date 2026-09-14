# 责任田：AI 助手

> 需求基准：`需求文档.md`（v1.0）
> 本轮交付：**可信链路纵向切片（MVP-A）**，详见 `docs/superpowers/plans/2026-09-10-ai-agent-mvp.md`

## 功能描述

公司统一的 AI 与 Agent 入口模块，负责"员工提问 → 权限裁剪 → 工具取数/检索 → 模型生成结论 → 回答附出处与时效 → 全过程落审计"这一条可信链路的实现。

```
src/routes/_authenticated/ai-agent/
  route.tsx          # 员工面布局路由（模块内导航 + Outlet）
  index.tsx          # 对话工作台
  notes.tsx          # 我的知识沉淀（全员）
  knowledge.tsx      # 旧入口兼容跳转 → /admin/ai/knowledge
  datasources.tsx    # 旧入口兼容跳转 → /admin/ai/datasources
  distill.tsx        # 旧入口兼容跳转 → /admin/ai/distill
  audit.tsx          # 旧入口兼容跳转 → /admin/ai/audit

src/features/ai-agent/
  types.ts           # 与 server 序列化字段一一对应的类型
  format.ts          # 日期/时间与来源文案格式化
  sse.ts             # SSE 客户端（fetch + ReadableStream，可 abort）
  api/queries.ts     # React Query hooks 与 mutations
  components/        # agent-nav / conversation-list / answer-card
                     # citation-panel / tool-trace-panel / document-dialogs
  pages/             # layout / chat-workbench / note-space / ai-admin-overview / admin-area-layout / ai-admin-layout
                     # knowledge-management / datasource-management / distill-management / ai-settings / audit-console
```

## 功能清单

- 对话工作台：三栏布局（会话列表 / 消息流 / 引用与依据面板），SSE 流式输出、停止生成、重新生成、轮次上限、空状态引导问题。
- **业务数据查询与分析**（M-A）：Amazon 广告/销售表现查询（含环比/同比、ACoS 涨跌驱动因子分解、异常阈值判定）、库存与订单查询；回答卡片渲染结构化表格（react-table）与趋势图/柱状图（recharts）。
- **产品主数据打通**（M-D 准备）：`product_master` 数据集建立 SKU ↔ ASIN/站点映射，使库存（按 SKU）与销售（按 ASIN）可以关联，可售天数与滞销判定改用完整销售历史。
- **主动分析**（M-B）：`scan_amazon_anomalies` 扫描全站 ASIN 输出异常清单与命中信号；`analyze_inventory_risk` 算可售天数并判定断货/积压/滞销与建议补货量；`query_amazon_performance` 不传 ASIN 时做全站聚合与 ASIN 排行。
- **数据源与导入**（管理员）：4 个数据集的 CSV 导入（模板下载、列名校验、整批拒绝、覆盖/追加）、导入记录与失败行明细、数据集覆盖率与数据时效展示。
- AI 回答卡片：固定顺序为结论 → 支撑数据 → 引用来源 → 声明条（数据来源 / 数据截至 / 权限范围）→ 反馈。
- 过程可见：流式期间展示编排进展（`正在检索知识库… ✓ 已检索 xx 篇文档`）。
- 知识库管理（管理员）：文档列表、文本/Markdown 上传、有效期、下线、重新启用、删除、手动重建索引。
- 经验提报与审核：本轮**不做**（下一轮）。
- 审计台（管理员）：会话轨迹、工具调用明细、拦截记录、管理动作日志、CSV 导出。
- 工具调用：本轮实现 `search_knowledge`（user）、`rebuild_knowledge_index`（admin）、`deactivate_document`（admin）。
- **账号级知识沉淀（M-C）**：每个账号有自己的知识空间（`ai_knowledge_notes.owner_user_id` 隔离）。
  - 员工侧「我的沉淀」（`/ai-agent/notes`）：手工新建、会话内「沉淀为知识」由 AI 整理、编辑、提交审核、归档、删除、导出（CSV / 合并 Markdown / JSON），并配置「知识沉淀」技能（**默认关闭**、触发方式、每日 AI 整理次数上限、要整理的字段）。
  - 管理员侧「沉淀管理」（`/ai-agent/distill`）：全部账号的沉淀列表与按账号统计、审核队列（通过 → 生成 `source_type='experience'` 文档并标注提报人；驳回必须填原因）、编辑、归档、软删、按筛选导出、技能全局启停与账号启用一览。
  - **写权分离**：员工只能把沉淀置为「待审核」，只有管理员能 `published` / `rejected`，管理员也不能把他人私有草稿直接改成已发布。
  - **未审内容不进检索**：私有沉淀只存在于 `ai_knowledge_notes`，不生成 `ai_documents`，因此不可能被问答检索到；管理员在对话检索中同样看不到他人私有沉淀。
  - **不编造**：AI 整理失败（模型不可用 / 输出无法解析）时降级为「原文草稿」（`degraded=true`、字段留空、原文放 evidence），界面明确提示字段待补充。
  - `provenance`（本人所写 / 模型推断）与 `evidence`（原文引句）用于让审核人一眼判断可信度。
  - **加固（2026-09-11）**：员工接口收窄为**所有者视角**（管理员也不能借员工接口读写他人条目，一律 404）；`provenance` 与 `evidence` 一律由**服务端**推导与逐字核对；审核通过改为**行锁 + 单事务**（文档生成失败保持待审核、可重试、幂等唯一约束兜底）；已发布条目同标题再沉淀生成**新修订**（重新审核，旧公共文档不被覆盖）；员工不能改待审核内容（409）；管理员时间筛选与导出共用同一组参数；每日配额改为**并发安全的预占**。详见 `docs/superpowers/plans/2026-09-11-knowledge-distill-hardening.md`。
- **信息架构：使用面与治理面分离（2026-09-11 重构）**：
  - 员工面（`/ai-agent`）：模块内导航只有「对话」与「我的沉淀」两项，**注入全局 Header 中段**（`HeaderSlot`）；
  - 治理面（`/admin/ai/*`，仅管理员，从侧边栏**设置 → AI 治理**进入）：顶栏中段导航为同一层级的六个入口 —— **AI 治理（概览首页）**｜知识库｜数据源与导入｜经验审核｜模型与配置｜审计台；
  - 五个治理子页**不进侧边栏**（避免三级菜单与导航层级分散），由 `admin-ai-nav.tsx` 横向承载；
  - 页面标题：`/ai-agent` 与 `/admin/ai` 通过路由 `staticData.title` 提供模块名（「AI 助手」/「AI 治理」），子页由导航高亮表达位置；`PageShell` **不再渲染 h1 与说明文案**（2026-09-11，见「全局布局与导航」责任田）；
  - `/admin/ai` 是概览首页：知识文档数 / 数据集覆盖 / 待审核经验 / 近 14 天用量四张统计卡，加「治理入口」「模型状态」「合规信号」三块，宽屏多列铺满；
  - 「模型与配置」已从审计台的 tab 里移出成独立页（改密钥、护栏、工具开关属于系统配置，审计台只负责"看历史"）；
  - 旧入口 `/ai-agent/{knowledge,datasources,distill,audit}` 保留为跳转路由，老书签自动跳到后台；
  - 员工侧技能卡里**只有开关可改**，触发方式 / 每日 AI 整理上限 / 整理字段由管理员在「经验审核 → 技能治理」统一设置（成本与合规参数上收）。
- 权限裁剪三层：工具注册裁剪、执行前二次校验、检索范围过滤。

## 入口与出口

- 入口：员工面为侧边栏「常用」→ **AI 助手** → 对话 / 我的沉淀；治理面为侧边栏「其他」→ **设置** → **AI 治理**（仅管理员）→ 概览首页，再由页内顶部导航横向切换五个子页。治理页的路由在 `/_authenticated/admin/ai/*`，由 `admin/route.tsx` 统一做 `beforeLoad` 管理员守卫。
- 出口：问答结果留在会话内；知识库/审计操作为原地刷新；被拦截请求统一返回「当前账号无权查询该数据，请联系管理员。」

## API 明细

- `POST /api/ai/chat` - 提问，SSE 流式返回。
- `GET /api/ai/conversations` - 会话列表。
- `GET /api/ai/conversations/:id/messages` - 会话消息（含引用与工具轨迹）。
- `PATCH /api/ai/conversations/:id` - 重命名 / 置顶。
- `DELETE /api/ai/conversations/:id` - 删除会话。
- `POST /api/ai/messages/:id/feedback` - 有用 / 有问题 / 纠错反馈。
- `GET /api/ai/tools` - 当前用户可用的已注册工具（用于验收「工具注册裁剪」）。
- `GET /api/ai/knowledge/documents` - 文档列表（管理员）。
- `GET /api/ai/knowledge/documents/:id/chunks` - 切片预览（管理员）。
- `POST /api/ai/knowledge/documents` - 粘贴文本入库（管理员）。
- `POST /api/ai/knowledge/documents/upload` - 文件上传入库（管理员）。原始 body + `X-File-Name` 头（`encodeURIComponent`），一期支持 TXT / Markdown / CSV / JSON。
- `PATCH /api/ai/knowledge/documents/:id` - 修改有效期 / 下线 / 重新启用（管理员）。
- `DELETE /api/ai/knowledge/documents/:id` - 删除文档及其切片（管理员）。
- `POST /api/ai/knowledge/reindex` - 重建知识索引（管理员）。
- `GET /api/ai/knowledge/feedback` - 待处理纠错反馈（管理员）。
- `POST /api/ai/knowledge/feedback/:id/handled` - 标记反馈已处理（管理员）。
- `GET /api/ai/datasets/freshness` - 各数据集最新导入时间（管理员）。
- `GET /api/ai/datasets` - 数据集清单：行数、覆盖周期、最近导入状态（管理员）。
- `GET /api/ai/imports/template?dataset=` - 下载导入模板 CSV（管理员）。
- `POST /api/ai/imports?dataset=&mode=&onRowError=` - 上传导入（原始 body + `X-File-Name` 头）（管理员）。
- `GET /api/ai/imports?dataset=` - 导入记录（含失败原因）（管理员）。
- `GET /api/ai/audit/conversations` - 会话轨迹。
- `GET /api/ai/audit/conversations/:id/trace` - 完整轨迹（审计完整性回溯）。
- `GET /api/ai/audit/runs` - 工具调用明细（含拦截记录）。
- `GET /api/ai/audit/logs` - 管理动作日志。
- `GET /api/ai/audit/export?type=runs|logs|conversations` - CSV 导出（导出动作本身写审计）。
- `GET /api/ai/usage` - token 用量统计（按天聚合）。
- `GET/PATCH /api/ai/settings` - 模型与编排配置（管理员）。PATCH 额外支持 `modelBaseUrl`、`forceDemo`、`modelApiKey`（`null`/空串表示清除密钥）。
- `POST /api/ai/settings/test` - 测试模型连通性（管理员）。可带未保存的候选参数先测后存；只做一次极短补全调用，不落库。
- `PATCH /api/ai/tools/:name` - 工具启用/停用（管理员）。
- 知识沉淀（账号级）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/ai/notes` | 我的沉淀列表（status / keyword / tag / 分页；keyword 命中标题/概述/原文依据/结构化字段正文） |
| GET | `/api/ai/notes/:id` | 沉淀详情（**仅所有者**；他人条目含管理员一律 404，不泄露存在性） |
| POST | `/api/ai/notes` | 新建（同账号同标题自动合并为新版本；同标题已发布则生成新修订；同标题在审核中返回 409） |
| POST | `/api/ai/notes/distill` | 从会话抽取沉淀草稿（**不落库**，需技能已开启且未超每日配额；配额以短事务预占） |
| PATCH | `/api/ai/notes/:id` | 编辑（**仅所有者**；待审核 / 已发布返回 409） |
| POST | `/api/ai/notes/:id/submit` | 提交审核（private/rejected → pending；**不能代他人提交**） |
| POST | `/api/ai/notes/:id/archive` | 归档（仅所有者；已发布条目的归档是管理员动作） |
| DELETE | `/api/ai/notes/:id` | 软删（保留行与审计；仅所有者） |
| GET | `/api/ai/notes/export?format=csv\|md\|json` | 导出我的沉淀（写审计） |
| GET/PUT | `/api/ai/notes/skill` | 我的「知识沉淀」技能配置（只有开关可由员工改） |
| GET | `/api/ai/distill/notes` | 全部账号沉淀（管理员，支持 userId / status / keyword / tag / from / to；from>to 或跨度>366 天返回 400） |
| GET | `/api/ai/distill/notes/:id` | 沉淀详情（管理员） |
| PATCH | `/api/ai/distill/notes/:id` | 编辑（管理员，允许改待审条目，写审计含改动字段与改前状态） |
| POST | `/api/ai/distill/notes/:id/review` | 审核：`approve` 生成知识库文档并标注提报人；`reject` 必须带 `comment`；非待审核状态返回 **409** |
| POST | `/api/ai/distill/notes/:id/archive` | 归档（管理员） |
| DELETE | `/api/ai/distill/notes/:id` | 软删（管理员） |
| GET | `/api/ai/distill/export?format=&userId=&status=&keyword=&tag=&from=&to=` | 全部账号导出（与列表同一组筛选参数，写审计含完整筛选条件） |
| GET | `/api/ai/distill/stats` | 总量与按账号统计（管理员） |
| GET | `/api/ai/distill/skills` | 技能定义 + 各账号启用一览（管理员） |
| PATCH | `/api/ai/distill/skills/:name` | 技能全局启停（管理员） |

### 知识沉淀的状态码语义（不要混用）

| 状态码 | 含义 | 典型场景 |
| --- | --- | --- |
| 400 | 输入不合法 / 状态流转本身不允许 | 驳回未填原因、`pending→pending` 重复提交、原文依据不在会话中、时间范围非法 |
| 404 | 条目不存在**或无权操作（不泄露存在性）** | 员工接口访问他人条目；管理员走员工接口访问他人条目 |
| 409 | 状态冲突（当前状态不允许该操作，可刷新后重试） | 编辑待审核/已发布条目、审核非待审核条目、同标题条目正在审核中 |
| 429 | 当日 AI 整理配额已用尽 | 并发触发 AI 整理超出上限 |

## 依赖关系

- 依赖：`server/db.mjs`（pg 连接池）、`server/index.mjs` 的 `requireUser` / `requireAdmin`、`express`、`jsonwebtoken`；前端依赖 `Header`、`Main`、`ConfirmDialog`、`Search`、`Button`、`Input`、`Textarea`、`Table`、`Tabs`、`Card`、`Badge`、`Select`、`DatePicker`、`Tooltip`、`Skeleton`、`sonner`、`@tanstack/react-query`、`@tanstack/react-table`、`recharts`、`lucide-react`。
- 被依赖：暂无（新模块，无下游）。
- 共享字段：`users.id` / `users.role` / `users.status`（只读引用，不写入）；`schema_migrations` 表（AI 迁移使用 `version >= 100` 段位）。

## 影响范围

- **新增**：`server/ai-agent/`、`src/features/ai-agent/`、`src/routes/_authenticated/ai-agent/`、`docs/modules/AI 助手.md`。
- **既有文件改动（最小）**：
  - `server/index.mjs`：挂载 `/api/ai/*` 路由、复用 `requireUser`/`requireAdmin`、启动时跑 AI 迁移。
  - `server/setup.mjs`：`pnpm run db:setup` 时一并建 AI 表。
  - `src/components/layout/data/sidebar-data.ts`：「常用」分组新增「AI 助手」。
  - `src/features/ai-agent/components/agent-nav.tsx`：模块内导航收敛为「对话 + 我的沉淀」（治理项已迁后台）。
  - `src/features/ai-agent/components/{admin-ai-nav,page-shell,skill-policy-card}.tsx`：治理面内导航（注入顶栏中段）、统一页面壳（只负责滚动容器，标题由顶栏渲染）、技能治理卡。
  - `src/routes/_authenticated/admin/**`：新增后台治理区域（`admin/route.tsx` 管理员守卫 + `admin/ai/route.tsx` 内导航 + 5 个治理页）。
  - `src/components/layout/{nav-filter.ts,types.ts,app-sidebar.tsx,data/sidebar-data.ts}`：**属「全局布局与导航」责任田**，本轮为支持治理入口收敛做了角色过滤与分组调整（该责任田文档已同步更新）。
  - `src/features/ai-agent/components/citation-panel.tsx`：引用 key 加下标兜底，避免历史重复引用触发 React 重复 key。
  - `server/ai-agent/knowledge.mjs`：检索 SQL 的提报人改为 `COALESCE(d.owner_user_id, d.created_by)`（experience 文档显示提报员工而非审核管理员）；`server/ai-agent/orchestrator.mjs`：多轮工具引用改为去重累计。
  - `src/routeTree.gen.ts`：由 TanStack Router 插件自动生成。
  - `package.json`：新增 `test:server` 脚本。
  - `.env.example`：新增模型 provider 变量（不含真实值）。
- **数据库**：新增 `ai_*` 表 15 张（含知识沉淀的 `ai_skills` / `ai_user_skills` / `ai_knowledge_notes`）、业务数据集表 5 张、`pgvector` 与 `pg_trgm` 扩展；`ai_documents` 增 `owner_user_id`（提报人归属，可空，旧数据行为不变）。
- **迁移 112 `harden_knowledge_distill`（本轮加固，只增不改）**：
  1. 只读检查 `ai_documents` 中 `source_type='experience'` 且 `source_ref` 重复的行——有重复就**中止迁移**并列出冲突 id，不自动删数据；
  2. `ai_documents(source_ref)` 部分唯一索引 `ai_documents_experience_source_ref_uidx`（`WHERE source_type='experience' AND source_ref IS NOT NULL`）；
  3. `ai_knowledge_notes.revision_of_note_id`（新修订指向旧版本，`ON DELETE SET NULL`）+ 索引 `ai_notes_revision_of_idx`；
  4. 唯一索引替换：删除 `ai_notes_owner_title_uidx`，新建 `ai_notes_owner_title_live_uidx`（`WHERE deleted_at IS NULL AND status <> 'archived'`），使归档历史版本能与新私有修订同标题共存。
  - **回滚/恢复方式**：本迁移只加索引与一列，不改数据类型、不删数据。如需回退：`DROP INDEX ai_documents_experience_source_ref_uidx; DROP INDEX ai_notes_revision_of_idx;`（`revision_of_note_id` 列可保留，旧代码不读它）、`DROP INDEX ai_notes_owner_title_live_uidx; CREATE UNIQUE INDEX ai_notes_owner_title_uidx ON ai_knowledge_notes(owner_user_id, lower(title)) WHERE deleted_at IS NULL;`——但回退前必须先确认没有"归档版本 + 新私有修订"的同标题组合，否则旧索引会建不上。
- **不得影响**：登录与认证流程、用户管理、快捷导航、竞品分析、设置中心、全局布局与主题体系（需回归验证 A12）。

## 修改边界

- 可以改：`server/ai-agent/*`、`src/features/ai-agent/*`、`src/routes/_authenticated/ai-agent/*`，以及上面列出的既有文件的**指定改动点**。
- 绝对不能动：`users` 表结构与角色取值（保持 `admin` / `operator`）、既有 API 契约与路径、JWT 签发与校验逻辑、`src/components/ui/**`、其他模块的责任田代码。

## 注意事项

- **汇总口径：广告销售额与业务销售额必须分开（2026-09-14 修复）**：`summarizeAds` 与 `summarizeSales` **都返回 `sales`**，合并时必须走 `mergeAdAndBusinessSummary()` —— 它保证 `sales` = 广告销售额、`businessSales` = 业务销售额。直接写 `{ ...ads, ...sales }` 会让业务销售额覆盖广告销售额，而 ACoS、卡片标签与事实清单都是**广告口径**，于是出现「广告销售额 60000、ACoS 25%」这种自相矛盾的组合（同一份数据真实 ACoS 是 8.3%），且编排层禁止模型改数字，错误会原样进结论。单测里两个口径的数字**不要取相等值**（原测试恰好相等，掩盖了这个缺陷一年多）。
- **`period.days` 是区间天数，不是行数**：行数在 `period.rowCount`。`summarizeAds().days` 统计的是参与汇总的**行数**（单 ASIN 30 天 × 5 campaign = 150），当作"区间天数"会写出「统计区间 …（150 天）」。
- **DATE 列按字符串处理**：`server/db.mjs` 用 `pg.types.setTypeParser(1082, v => v)` 覆盖了 pg 默认行为——默认会把 DATE 解析成**本地时区午夜**的 Date，再经 `toISOString()` 整体前移一天（东八区必现）。踩过的后果：按区间过滤时丢掉第一天（30 天窗口只算 29 天）、日均销量窗口偏移、提示词里出现 `覆盖 Fri Sep 11 ~ Wed Sep 10` 这种反向区间。新增涉及 DATE 列的查询时直接按 `'YYYY-MM-DD'` 字符串处理。
- **角色映射**：需求文档写 `user`/`admin`，现有库实际是 `operator`/`admin`。工具契约里 `requiredRole: 'user'` 表示"任意启用账号"，`'admin'` 表示"必须 `role = admin` 且启用"。不改 users 表。
- **迁移版本冲突坑**：`schema_migrations.version = 1` 已被快捷导航占用，AI 迁移从 **100** 起编号；若从 1 开始会被静默跳过。
- **中文全文检索**：库内无 `zhparser`，中文分词不可用。检索采用「关键词（CJK 双字切分 + 拉丁词）+ `pg_trgm` 相似度 + `simple` 全文」混合打分，勿直接依赖 `to_tsquery` 处理中文。
- **沉淀不进检索（本轮边界）**：私有沉淀不参与 `search_knowledge`；审核通过后才作为 `source_type='experience'` 文档进入公共知识库，且检索命中时标注「员工经验 · 提报人」。下一轮若要把个人沉淀也纳入检索，必须分路召回（独立相关性下限）并重跑 `eval/compare-retrieval.mjs` 重标定。
- **每日配额口径（易踩）**：`dailyQuota` 只统计**真实 AI 整理次数**（依据 `ai_audit_logs` 中 `action='note_distill'` 当天条数），手工新建沉淀不计入；`0` 表示不限制。**不要**改成按 `ai_knowledge_notes` 当天条数计数——那会把手工新建算进去，跑几轮验收就误报 429。
- **沉淀字段契约单一来源**：字段定义只写在 `server/ai-agent/skill-contracts.mjs`，迁移种子、抽取提示词、前端表单都从它派生（前端通过 `GET /api/ai/notes/skill` 拿到），禁止在前端或迁移里再抄一份。
- **审核幂等键**：审核通过生成的文档用 `source_ref = 'note:<id>'` 幂等，重复通过不会产生第二份文档（状态机本身也会拦住重复审核）。迁移 112 给 experience 文档加了 `source_ref` 唯一索引兜底；**若库里已存在重复的 experience `source_ref`，迁移会中止并给出修复提示，不会自动删数据**。
- **沉淀权限口径：可见 ≠ 可操作（本轮加固）**：`permissions.mjs` 里三个判定不能混用——
  `canSeeNote`（本人或管理员，**只给管理视图的展示用**）、`canOwnNote`（仅所有者，**员工接口 `/api/ai/notes/*` 专用**）、`canManageNote`（仅启用管理员，`/api/ai/distill/*` 专用）。
  员工接口一律 `getOwnedNote` + `scope='self'`，管理员通过员工接口访问他人条目按不存在返回 404（不能让管理员借员工接口绕过管理动作的审计口径）；`assertOwnerAction` 是第二道保险，防止后续把查询换成管理视图后静默放开越权写。
- **provenance 与 evidence 一律服务端定（本轮加固）**：
  - `provenance` 由 `deriveProvenance(sourceKind)` 推导（会话来源 → `inferred`，手工 → `user_stated`），**请求体里的 provenance 只做枚举校验、不落库**（客户端能改判就等于可信度标注失去意义）；合并时"只降不升"（一旦有模型推断内容并进来就整体标为推断）。
  - `evidence` 用 `isEvidenceFromConversation` 逐字核对（只做换行统一、逐行去空白、脱成对引号三类无损规整，**禁止用相似度代替逐字验证**）：抽取草稿核对不过就置空并标 `evidenceRejected`（界面提示"原文依据待补充"，但不谎报 `degraded`）；会话来源条目在**保存/修改**时核对不过直接 400，不静默清空。
- **审核通过是"行锁 + 单事务"（本轮加固）**：`reviewNote` 在同一事务里完成「`SELECT … FOR UPDATE` 锁行 → 校验仍为 pending → 生成/复用公共文档 → 更新状态与 `published_document_id` → 写审计」，任一步失败整体回滚（条目保持 pending 可重试，不会出现"已发布但没有文档"）；重复/并发审核返回 **409**。`ingestDocument` 支持传入外部事务 client（`client` 参数），不要再在路由里拼第二套文档写入逻辑。
- **同标题再沉淀 = 新修订（本轮加固）**：同标题条目已是 `published` 时**不原地合并**（否则公共文档会与条目内容悄悄脱钩），而是旧版本转 `archived`（**公共文档保持生效**）+ 新建 `private` 修订并记 `revision_of_note_id`；修订通过审核时用 `supersedesDocumentId` 让旧文档 `inactive`，保证同一标题在库里只有一份生效的「员工经验」。同标题条目处于 `pending` 时再次沉淀返回 409。
- **待审核内容审核期间不可被员工修改**：员工 `PATCH` 待审核/已发布条目返回 409（前端按钮同步禁用只是提示，服务端才是拦截点）；管理员在管理页改待审条目允许，但必须写审计（detail 含 `changedKeys` 与 `previousStatus`）。被驳回的条目可直接修改并重新提交（`rejected→pending` 是 owner 动作）。
- **每日配额是"预占"，不是"先查后调"（本轮加固）**：`reserveDistillQuota` 用 `pg_advisory_xact_lock(2026, userId)` 串行化同一账号的并发请求，在锁内计数并**先写入本次的 `note_distill` 审计行**（审计行即计数器），再放行去调模型——模型调用失败也照样计数，与产品口径一致。`countDistillCallsToday` 只用于展示/对账，单独使用不具备并发安全性。
- **管理端时间筛选与导出必须共用 `parseAdminNoteFilters`**：两处各解析一遍迟早会出现"列表筛了时间、导出没筛"，那是最难被发现的一类不一致。服务端校验 `from ≤ to` 且跨度 ≤ 366 天（超限 400），导出审计记录完整筛选条件与条数。
- **关键词搜索包含结构化字段**：`listNotes` 的 keyword 命中「标题 / 概述 / 原文依据 / `fields::text`」，量级上来后再评估 JSONB 索引或全文检索（当前 `fields::text ILIKE` 够用）。
- **前后端版本不一致会让页面白屏（已加兜底）**：`UserSkillState.policy` 是后加的字段，若前端先更新而后端仍是旧版本，`skill-config-card` 会在 `state.policy.fieldKeys` 上抛错并整页白屏。已在组件内做 `state.policy ?? 由 config 派生` 的兜底。**新增必返字段时同步考虑旧服务端的兼容读法。**
- **验证端口与 CORS（踩过的坑）**：`.env` 的 `CORS_ORIGIN` 当前为 `5173,5174`；即使启动时用 shell 变量覆盖成 5175，`dotenv` 仍会让 `.env` 生效，导致浏览器直接拦掉登录（表现为"登录后不跳转"）。验证实例请用 **5174**（或用 8787 + 5173 的标准开发服务）。
- **改动路由结构后必须重启 Vite 再跑 UI 冒烟**：新增/删除路由文件期间开发服务器可能进入漂移状态（依赖预构建与路由树不同步），表现为 **SSE 请求返回 200 后被 abort、答案不渲染**、或 React 重复实例报 `Invalid hook call`。规避：改完路由重启 dev server（必要时 `rm -rf node_modules/.vite`）。
- **检索相关性下限（关键）**：中文双字切分下「公司」「规定」这类高频词几乎每篇文档都有，只判断"命中数 > 0"会把无关文档捞回来，真实模型会拿它编造制度（违反 A9）。`knowledge.mjs` 因此要求 `命中关键词数 / 关键词总数 ≥ MIN_QUERY_COVERAGE`（默认 **0.2**，可用 `AI_RETRIEVAL_MIN_COVERAGE` 覆盖）。取值来自 `compare-retrieval.mjs` 在夹具语料上的实测：0 → 召回 100% 但负样本 100% 误召；0.2 → 负样本 100% 正确空返回、召回 87%；0.3 以上过度拒绝（空检索率 30%）。**接入真实文档后必须在该语料上重新标定。**
- **验收脚本必须复用文档**：`verify-e2e.mjs` 用固定标题 + `source_ref`（`e2e-fixture:`）复用同一篇文档，每次运行作为新版本替换旧版本。早期版本每跑一次新增两份文档，累积出多份近似重复的 SOP，直接污染检索质量评测（重复文档挤占 top-k 名额），已由 `clean-test-docs.mjs` 清理并修根因。
- **向量检索**：本轮建表即含 `embedding vector(1024)` 与 pgvector 扩展、ivfflat 索引，**但不写入向量**；检索走关键词路径。启用 embedding 需锁定维度后回填，届时只需改 `knowledge.mjs` 的检索实现。
- **演示 provider**：未配置 `AI_MODEL_API_KEY` 时自动使用 `providers/demo.mjs`（规则式意图路由）。它与真实 provider 走**完全相同**的编排/权限/审计代码路径，但**不产生真实模型推理**，UI 与审计中必须明示 `mode = demo`，禁止把它当成模型效果验收依据。
- **越权拦截文案统一**：「当前账号无权查询该数据，请联系管理员。」禁止提示"你有 A 权限但没有 B 权限"，避免权限探测。
- **上传即生效**：本轮文本/Markdown 上传即生效，无审核流程；补偿控制为「来源与时效强制展示 + 有效期 + 纠错反馈」。
- **PDF / Word / Excel 解析**：本轮不支持，接口明确返回"暂不支持该格式"，不静默失败、不伪装成功（解析库选型对应需求文档 Q6，待确认）。
- **审计不可删**：`ai_audit_logs` / `ai_runs` 无删除接口，也不在 UI 提供删除入口。
- 禁止使用 `console`（ESLint 报错），服务端一律走 `process.stdout.write` 或抛错。
- **销量口径优先级与如实声明**：`analyze_inventory_risk` 的日均销量优先用「产品主数据 → 销售报告」（完整历史，窗口默认 30 天），缺少映射时回退订单快照（近期切片，低置信度）。**两种口径必须在回答里说明**——混用而不说明等于让用户拿不同可靠度的结论做决策。工具输出里的「销量口径」列与摘要句就是为此。
- **统计窗口锚定"数据最后一天"而不是"今天"**：报表是人工导出的滞后数据，用今天做锚点会得到空窗口，把所有 SKU 误判成"无销量"。
- **区分"没卖出去"与"报表没覆盖"**：映射到的 ASIN 在窗口内完全无记录时标记 `hasCoverage=false` 并回退其他口径；只有报表确实覆盖这些日期且销量为 0 时才判滞销。
- **样本不足时不下"积压/滞销"结论**：日均销量来自订单快照（近期切片），实测踩到过"3 天样本 → 判定积压 133 天"。样本不足 7 天时滞销/积压降级为「样本不足」，可售天数仍如实给出并标注样本区间；**断货风险仍按保守告警**（风险不对称：漏报断货的代价远大于误报）。
- **越权时必须阻断"能力枚举"**：实测普通用户请求管理操作时，模型 4 次有 3 次会把自己的可用工具清单念出来（"我这次可用的工具只有…"），等于给越权用户一个权限探测探针。`enforcePermissionWording` 的模式表用**真实样本**固化，容忍"我…具备…能力"这类插入语，并把同义变体统一规整为固定文案——改这里的模式必须拿真实回答验证，不要凭想象写。
- **模型可能间歇性误判权限**：实测 deepseek-chat 有约 1/6 概率拒绝管理员的合法请求。系统提示词规则 7.1/7.2 已明确"判断依据只能是工具列表、工具在列表里就必须调用"，但仍需在验收里保留"管理员不被拦截"这条断言（A5-4），它是这类波动的探测器。
- **分析与数字一律服务端算**（`analytics.mjs`）：ACoS 涨跌、环比/同比、驱动因子分解、异常判定全部在服务端确定性计算，随工具结果一起回灌模型；模型只负责表达。理由：让模型做算术等于允许编造，且 A2 要求"归因主因可复核"。驱动分解采用顺序分解法，两部分**相加恰好等于总变化**（残差为 0），这是可校验的硬性质（有单测锁定）。
- **`today` 与数据覆盖范围必须进提示词**：模型不知道"今天"是哪天，也不知道数据覆盖到哪一天。实测真实模型把"上个月"算成训练数据里的月份，查了空区间后回答"查不到数据"。`renderRuntimeContext` 会把当前日期与各数据集的行数/覆盖区间/导入时间写进系统提示词，并要求超出覆盖范围时明确告知。
- **结构化数据块（`ai_messages.blocks`）**：工具返回 `blocks`（metrics/table/chart），编排层落库、前端用 react-table 与 recharts 渲染。不让模型排版 Markdown 表格——流式输出下会抖动且列易错位、也无法画图。**`chat.mjs` 的 `serializeMessage` 必须返回 `blocks`**，漏了会导致流式结束后表格与图消失（只剩文字）。
- **数据集引用与文档引用分开渲染**：`citation.kind = 'dataset'` 时显示数据集名、覆盖周期、导入时间与"准实时非实时"说明，与文档引用的视觉区分。
- **CSV 导入的编码回退**：中文 Excel 另存 CSV 默认 GBK，`decodeCsvBuffer` 先按 UTF-8 解，出现替换字符再回退 gb18030/gbk/big5。日期解析支持 ISO、斜杠、中文日期与 Excel 序列号。
- **数据时效同时声明"导入时间"与"覆盖至"**：只看导入时间会误导（导入很新但数据其实到上个月），`freshnessSentence` 两者都写。
- **不依赖模型自觉的三条服务端兜底**（真实模型不会稳定遵守格式与措辞要求，实测都踩到了）：
  1. **统一拦截文案**：模型用自己的话描述工具/权限范围、点名无权工具、或自述式拒绝时，`enforcePermissionWording` 一律替换为固定文案；模型若已直接输出固定文案，也会被记为「拦截」写审计（A5 要求拦截并记录）。判定模式在 `prompt.mjs`，可按语料补充。
  2. **声明条**：模型漏写数据来源与截至时间时，`ensureFreshnessDeclaration` 在回答末尾补一条确定性声明（仅在确有引用文档时补，避免"未找到"的回答被加上无效声明）。
  3. **降级返回**：模型没产出总结但检索有结果时，`buildDegradedAnswer` 直接返回检索原文并明示降级状态（需求文档 §9 可用性）。
- **新会话的刷新必须用 `conversationIdRef`**：`activeId` 在发起请求时可能还是 `null`，用闭包里的它刷新会刷到 `['ai','messages',0]`，导致回答落库后前端永远拉不回来（表现为"答案闪一下就消失"）。演示模式响应极快会掩盖这个竞态，改动这块逻辑时务必在真实模型下验证。
- **模型密钥存储（需求文档 §8.3 的受控偏离）**：原方案要求密钥只走环境变量、不入库；为支持管理员在后台自助配置，现改为**加密后入库**：
  - 算法 AES-256-GCM（`server/ai-agent/secrets.mjs`），加密密钥取自 `AI_SETTINGS_SECRET`，未配置时回退 `JWT_SECRET`；两者都没有时**拒绝保存**并给出可操作提示，绝不降级成明文存储。
  - 三条不可违反的约束：① 任何接口不回传明文（只回传掩码 `sk-a…b1c2`）；② 审计只记掩码与指纹，不记明文；③ 解密失败按"未配置"处理并向前端标记 `apiKeyInvalid`。
  - **运维注意**：换服务器时要一并带走 `AI_SETTINGS_SECRET`（或 `JWT_SECRET`），否则库里的密文解不开，后台会提示"密钥无法解密"，需重填一次 Key。
  - 配置优先级：**后台配置（数据库）> 环境变量 > 演示模式**。数据库优先是为了让后台改完即时生效、无需重启；环境变量保留给本地开发与 CI。`force_demo` 开关只影响是否使用密钥，不影响已保存的密钥。
- **鉴权不复用 `requireAdmin`**：需求文档要求管理类接口「403 并写审计」，而 `requireAdmin` 直接返回响应、没有插入审计写入的位置。`server/ai-agent/router.mjs` 因此自带 `identityGuard`（每请求回源查 `users`，用库里的 role/status 覆盖 JWT 旧值）+ `adminGuard`（非管理员 403 且写 `forbidden` 审计）。
- **权限判定依赖 `req.user.status`**：`permissions.mjs` 的 `isEnabledUser` 要求 `status === 'enabled'`。`server/index.mjs` 的 `requireUser` 必须把 `status` 一并下发（曾因为漏下发导致所有工具被误判为无权）；AI 路由的 `identityGuard` 是第二道保险。
- **`ai_runs.message_id` 指向本轮的提问消息**：回答消息在流程末尾才创建，工具轨迹挂在提问消息上作为这一轮的锚点；审计台按会话关联两者。

## 约束

- 必须复用：`Header` / `Main` / `ConfirmDialog` / `Button` 等既有组件；主题变量取色；`lucide-react` 图标；`@tanstack/react-query` 做数据获取；Zod 定义 schema。
- 流式接口不使用 axios 默认拦截器，单独封装 SSE 客户端（`src/features/ai-agent/sse.ts`）。
- 验证要求：`pnpm run lint`、`pnpm run build`、`pnpm run test:server`，并按需求文档第 10 章执行 A5/A6/A7/A9/A11/A12。

### 评测与验收资产

| 脚本 | 用途 | 用法 |
| --- | --- | --- |
| `server/ai-agent/eval/fixtures/*.md` | 8 篇评测夹具（断货补货 SOP、SKU 命名、报关、新品开发、旺季备货、客诉、ACoS 归因、盘点），`source_ref` 以 `eval-fixture:` 标记，与真实文档隔离 | — |
| `server/ai-agent/eval/a1-question-set.json` | A1 问题集（25 题：20 题正式 + 3 题口语化改写 + 1 题负样本 + 1 题越权），含 `expectedDocs` 作为引用是否命中预期文档的判定依据、留空的 `humanVerdict` 供人工判定 | 业务同事在此基础上替换为真实高频问题 |
| `server/ai-agent/eval/seed-fixtures.mjs` | 把夹具灌入知识库（幂等，重复执行作为新版本替换旧版本） | `node server/ai-agent/eval/seed-fixtures.mjs` |
| `server/ai-agent/eval/run-a1-baseline.mjs` | A1 基线：跑完问题集输出引用率/召回率/空检索率/拦截率/首字延迟/token，并生成带人工判定空列的 Markdown 报告 | `node server/ai-agent/eval/run-a1-baseline.mjs http://127.0.0.1:8787 "--label=live"` |
| `server/ai-agent/eval/compare-retrieval.mjs` | 检索参数对照实验（**不需要模型**）：扫描相关性下限 × topK × 切片参数，输出召回率/负样本空返回率，用于选参数而非凭感觉调 | `node server/ai-agent/eval/compare-retrieval.mjs --coverage=0,0.2,0.3 --topk=3,5,10` |
| `server/ai-agent/eval/clean-test-docs.mjs` | 清理验收脚本产生的临时文档（默认 dry-run，加 `--yes` 才真删，删除写审计） | `node server/ai-agent/eval/clean-test-docs.mjs --yes` |
| `server/ai-agent/eval/client.mjs` | 评测脚本共用的 HTTP/SSE 客户端（零依赖） | 被上述脚本引用 |

> 报告与截图产物：`server/ai-agent/eval/reports/`、`verify-artifacts/`。

### 验证脚本

| 脚本 | 用途 | 用法 |
| --- | --- | --- |
| `server/ai-agent/verify-e2e.mjs` | 服务端端到端验收（A5 越权拦截 / A6 注入防护 / A7 审计完整性 / A9 失败不编造 / 数据时效），会自动创建 `operator` 验收账号并上传验收文档 | `API_PORT=8788 SERVE_STATIC=false node server/index.mjs` 后执行 `node server/ai-agent/verify-e2e.mjs http://127.0.0.1:8788` |
| `server/ai-agent/verify-ui.mjs` | UI 冒烟 + A12 回归（Chrome，24 项检查 + 截图），用系统 Chrome（`channel: 'chrome'`），不需要下载 Playwright 浏览器 | 服务已在跑时直接 `node server/ai-agent/verify-ui.mjs http://localhost:5173`；也可配 `VITE_API_BASE_URL=http://127.0.0.1:8788/api` 起独立 Vite 到 5175 后再跑 |
| `server/ai-agent/verify-notes-hardening.mjs` | **知识沉淀加固验收（35 项，不依赖模型）**：权限隔离（员工接口 owner-only、管理员代操作一律 404）、停用账号全接口不可用、未审内容不进公共知识库、provenance 服务端归因、evidence 逐字核对、待审核不可改、驳回可重提、审核事务与并发幂等、文档生成失败保持 pending、同标题新修订与文档接管、时间筛选校验、关键词命中结构化字段、导出与列表一致、配额并发预占，最后用 SQL 反查"已发布必有一份生效文档 / 未审必无文档" | 先 `API_PORT=8788 SERVE_STATIC=false node server/index.mjs`，再 `node server/ai-agent/verify-notes-hardening.mjs http://127.0.0.1:8788`；脚本会临时把模型切到演示 provider 并上调配额，结束时恢复 |

三个脚本都会写入真实数据，只应在本地开发库执行；截图默认落在 `verify-artifacts/`。
`verify-notes-hardening.mjs` 刻意把权限与状态机断言放在**模型之外**（临时切演示 provider），模型效果验收仍以 `verify-e2e.mjs --live` 为准。

## 历史变更

| 日期 | 变更内容 | 修改人 / AI |
| --- | --- | --- |
| 2026-09-11 | 顶部布局统一（属「全局布局与导航」责任田的横向改造，本模块被动调整）：`AgentNav`/`AdminAiNav` 由内容区顶行改为注入全局 Header 中段，并去掉换行（槽位是固定高度）；`PageShell` 删除 `text-2xl` 的 h1 与说明文案、删除未使用的 `actions` prop、`pb-10`→`pb-8`；模块 layout 不再渲染自己的 `Header`，页面标题改由路由 `staticData.title` 提供（`/ai-agent`=「AI 助手」、`/admin/ai`=「AI 治理」，子页由导航高亮表达）；7 个页面调用方同步删除 `title`/`description` 传参。实测数据源与导入首个实质内容 top 由 314px 降到 88px（−226px）、知识库/审计台 −168px；高风险场景（聊天高度链、390/1024/1280 无横向滚动、侧边栏折叠、暗色模式）32/32 通过。 | AI |
| 2026-09-11 | 导航层级再收敛：AI 治理从独立主类目改为「设置 → AI 治理」二级项，五个子页不再出现在侧边栏，改由页内顶部导航以同一层级承载；新增 `/admin/ai` 概览首页（四张统计卡 + 治理入口 + 模型状态 + 合规信号），解决治理页单列、宽屏右侧空旷的问题；后台 Header 文案改为「设置 · AI 治理」。验证：UI 冒烟 63/63（新增六项层级断言）、e2e 43/43、单测 312 | AI |
| 2026-09-11 | **知识沉淀加固**（`docs/superpowers/plans/2026-09-11-knowledge-distill-hardening.md`）：① 员工接口收窄为所有者视角（新增 `canOwnNote`/`canManageNote`/`assertOwnerAction`，管理员借员工接口读写他人条目一律 404）；② `provenance` 由服务端按来源推导、`evidence` 用 `isEvidenceFromConversation` 逐字核对（抽取消不掉就置空并标 `evidenceRejected`，保存时核对不过 400）；③ 审核改为行锁 + 单事务（失败保持 pending 可重试、并发/重复审核 409、experience `source_ref` 唯一索引兜底）；④ 已发布条目同标题再沉淀生成新修订（旧版本归档但公共文档保留，修订通过后接管并让旧文档失效）；⑤ 员工不得修改待审核内容（409），驳回可直接重提（补齐 `rejected→pending`/`rejected→archived` 两条此前缺失的边，修掉"界面有按钮、服务端必 400"的不一致）；⑥ 管理员创建时间筛选（起止日期，校验 `from ≤ to` 且 ≤ 366 天）与导出共用同一组筛选参数并把完整条件写进审计；⑦ 关键词搜索覆盖六个结构化字段正文；⑧ 每日配额改为 advisory 锁 + 审计行预占（并发下不再是竞态）。迁移 **112** `harden_knowledge_distill`（重复 `source_ref` 只读检查 → 唯一索引 + `revision_of_note_id` + 唯一索引收窄为非归档）。验证：单测 309、加固验收 35/35、`verify-e2e` 43/43（真实模型）、定向 UI 校验 12/12、build+lint 全绿 | AI |
| 2026-09-11 | 信息架构重构：AI 助手拆分为**员工面**（`/ai-agent` 对话 + 我的沉淀）与**治理面**（`/admin/ai/*` 知识库 / 数据源与导入 / 经验审核 / 模型与配置 / 审计台，侧边栏「AI 治理」入口，仅管理员）；「模型与配置」从审计台 tab 移出成独立页；数据源与导入页补上入口（此前无任何入口）；侧边栏支持按角色过滤（顺手修掉「用户管理」对普通账号可见）；新增统一页面壳 `PageShell` 与治理内导航 `AdminAiNav`；技能成本参数上收给管理员（迁移 111 增 `ai_skills.policy`，员工只能开关）；旧 URL 保留跳转；修复 2 个缺陷（`.env` CORS 未含验证端口导致登录被拦、`policy` 字段缺失导致页面白屏）；验证：单测 309、e2e 43/43（真实模型）、UI 冒烟 59/59、build+lint 全绿 | AI |
| 2026-09-11 | M-C 知识沉淀 MVP：账号级沉淀空间（`ai_knowledge_notes` + `owner_user_id` 隔离）、技能契约（`skill-contracts.mjs`）+ 账号级技能配置（默认关闭，迁移 106/107）、可信度字段 `provenance`/`evidence`（迁移 108）、`GET/POST/PATCH/DELETE /api/ai/notes*` 与 `/api/ai/distill/*`、员工侧「我的沉淀」页与管理员侧「沉淀管理」页、会话内「沉淀为知识」入口、CSV/合并 Markdown/JSON 导出（均写审计）；修复 3 个缺陷（配额误把手工新建计入导致 429、多轮工具引用重复触发 React 重复 key、检索提报人取到审核管理员而非提报员工）；**不做**：自动触发、SKILL.md 导入、沉淀参与检索、ZIP 打包；单测 274、e2e 40/40（真实模型）、UI 冒烟 49/49 | AI |
| 2026-09-10 | 按 `需求文档.md` 创建责任田初稿，锁定 MVP-A 可信链路纵向切片范围 | AI |
| 2026-09-10 | 完成 MVP-A 实现：迁移 version 100/101（16 张表 + pgvector/pg_trgm）、权限三层、审计、3 个工具、知识链路（文本上传/切片/混合检索/有效期/下线）、真实+演示双 provider、编排层 SSE、对话工作台三栏、知识库管理、审计台（含 CSV 导出、工具开关、模型配置）；`pnpm run build`、`pnpm run lint`、`pnpm run test:server`（101 项）通过；端到端验收 16/16（A5/A6 一票否决项全通过），记录见 `docs/superpowers/verification/2026-09-10-ai-agent-mvp-acceptance.md` | AI |
| 2026-09-10 | 验收中发现并修复 4 个缺陷：`requireUser` 缺 `status` 导致全量误拦、检索未匹配标题、中文文件名失败、枚举参数校验被跳过 | AI |
| 2026-09-11 | M-D 准备：新增 `product_master` 数据集（迁移 109）打通 SKU↔ASIN，`analyze_inventory_risk` 改用「产品主数据 → 销售报告」的 30 天销售历史算日均销量（迁移 110 重播工具契约）；实测把 `KT-JH-001-BK` 的误报"积压"纠正为"健康"；未登记映射的 SKU 如实提示；单测 271、e2e 21/21、UI 38/38 | AI |
| 2026-09-11 | M-B 分析能力增强：`scan_amazon_anomalies`（全站异常扫描 + 严重度排序）、`analyze_inventory_risk`（可售天数/断货/积压/滞销 + 建议补货）、全站聚合与 ASIN 排行、柱状图渲染；修复 5 个缺陷（相对时间推算、模型误拒合法请求、越权时念出工具清单、快照类覆盖导入退化成合并、验收脚本数字匹配过窄）；单测 214、e2e 21/21、UI 38/38、数据类验收 12/12 | AI |
| 2026-09-11 | M-A 数据接入闭环：CSV 导入通道（模板/列名校验/整批拒绝/覆盖追加）、4 个数据集、`query_amazon_performance` 与 `query_inventory_orders` 两个工具、服务端分析引擎（环比/同比/ACoS 驱动分解/异常判定）、回答卡片结构化表格与趋势图、数据源与导入页；修复真实模型暴露的 3 个缺陷（模型不知道今天日期导致相对时间算错、blocks 未序列化导致表格图丢失、时效日期未格式化）；场景二/三验收 7/7 | AI |
| 2026-09-11 | 真实模型上线验证（deepseek-chat）：A1 基线召回率 100%、越权拦截 100%、首字 1.6s；结构验收 21/21、UI 冒烟 29/29、服务端单测 144 项；修复真实模型暴露的 3 个缺陷（空回答误报服务不可用、新会话回答闪退、拦截未记审计） |
| 2026-09-10 | 新增模型密钥后台配置：迁移 102 增 6 列、`secrets.mjs` 加密模块、配置优先级改为「库 > 环境变量」、`POST /api/ai/settings/test` 连通性测试、前端「模型接入」卡片；实测验证密钥全生命周期（保存/掩码/密文入库/审计脱敏/清除/强制演示/无效密钥不编造） | AI |
| 2026-09-14 | **修复两处结论级数据缺陷**（由竞品分析接入真实链路时暴露，影响本模块所有 Amazon 回答卡片）：① `analyzeAdsPerformance` / `marketplacePerformancePayload` 的汇总里 `sales` 被业务销售额覆盖（标签仍写「广告销售额」、ACoS 仍按广告口径算），新增 `mergeAdAndBusinessSummary()` 保留 `sales`=广告销售额、`businessSales`=业务销售额，对比块同步；② `period.days` 由「参与汇总的行数」改为真区间天数，行数移入 `period.rowCount`（`periodDays()`），单 ASIN 30 天不再显示「150 天」；③ `server/db.mjs` 覆盖 pg 的 DATE 解析（`setTypeParser(1082)`），修复回读整体前移一天导致的「区间第一天被过滤掉」——实测竞品分析卡片数字与数据库真值由 4/5 一致提升到 5/5。新增 `analytics.node-test.mjs` 口径与天数断言（原测试两个口径数字恰好相等，未能守护）。 | AI |

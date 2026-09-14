# M-A 数据接入闭环实施计划（对齐产品目标）

> **状态：已交付（2026-09-11）**。验收结果见 `docs/superpowers/verification/2026-09-10-ai-agent-mvp-acceptance.md` 第十节。
> 场景二/三自动化验收 7/7；单测 199 项；`verify-e2e --live` 21/21；`verify-ui` 35/35。
> 仍需业务侧提供：真实报表样例、ERP 授权表清单、报表导出频率（见文末）。

**Goal:** 让员工能用自然语言**查询与分析业务数据**（Amazon 广告/销售、库存、订单），补齐产品目标里"集中连接并沉淀业务数据 + 查询 / 分析"这块当前完全空白的能力。

**背景（为什么现在做这个）:** 截至 2026-09-11，已交付的是"可信问答骨架"：统一入口、权限三层、强制审计、知识检索问答全部可用且验收通过。但产品目标提到的业务数据一个都没接——4 张数据集表 0 行、数据源 0 个、导入记录 0 条、数据类工具 0 个，PRD 三个业务场景里场景二（Amazon 归因）与场景三（库存订单）覆盖度为 0。

**产品目标映射:**

| 目标要素 | 本计划覆盖 |
| --- | --- |
| 集中连接业务数据 | ✅ Excel/CSV 导入通道 + 4 张数据集落库 + 数据源与导入页 |
| 查询 | ✅ `query_amazon_performance`、`query_inventory_orders` 两个工具 |
| 分析 | ✅ 环比/同比、涨跌驱动因子分解、异常阈值判定——**全部由服务端确定性计算** |
| 权限与审计约束 | ✅ 复用已有三层裁剪与强制审计，数据工具同样受约束 |
| 只读边界 | ✅ 本期只读；写操作不在范围内（已与需求方确认） |

**Spec:** `需求文档.md` §5.1（回答卡片结构）、§5.3（数据源与导入）、§6.6（工具契约）、§8.5（Excel 导入）、第 4 章场景二/三

## 范围边界（明确不做，避免再次偏航）

- ❌ 写操作（改价、调库存）——已确认不在本期
- ❌ ERP 实时连接——需要只读账号与白名单表（PRD Q3），先用导入方式打通同一批表结构
- ❌ 物流与产品数据——你的目标里包含它们，但 PRD 列为二期，且数据来源未明；本期先把"导入 → 查询 → 分析"这条通道做通用，新增数据集只需登记规格
- ❌ 飞书文档同步 / PDF-Word 解析 / 经验提报审核——属 M-C，本轮不动
- ⚠️ `.xlsx` 二进制格式：本期支持 **CSV**（含 GBK 编码识别，中文 Excel 导出的 CSV 可直接用）。`.xlsx` 需要引入解析库（PRD Q6 待确认），确认后可在同一导入通道上扩展

## 关键设计决策

### 决策 1：分析结果必须由服务端算，模型只负责表达
ACoS 涨跌、主因分解、异常判定全部在 `analytics.mjs` 里用确定性算法算出来，随工具结果一起回灌模型。
理由：让模型做算术就等于允许编造数字，与已确立的"失败不编造"原则冲突；A2 验收要求"归因主因与人工结论一致"，
必须有一份可复核的计算过程。

### 决策 2：整批拒绝，不做部分导入
按 PRD §8.5：列名不匹配即整批拒绝；行级解析失败默认也整批拒绝并给出失败行明细（最多展示前 20 行）。
理由：宁可让人改文件重导，也不要把脏数据混进数据集。保留 `onRowError=skip` 配置项以便后续按运营反馈放宽。

### 决策 3：回答卡片用结构化块渲染，不让模型排版表格
工具返回 `rows` + `view`（表格列定义、图表规格），编排层落库到 `ai_messages.blocks`，前端用 `@tanstack/react-table` 与 `recharts` 渲染。
理由：模型排版表格在流式下会抖动且列易错位；结构化块可稳定渲染、可复用、也便于后续导出。

### 决策 4：数据时效来自导入批次
`dataFreshness` 取 `ai_imports` 中该数据集最近一次成功导入的时间，声明条如实显示；无数据时明确提示"该数据集暂无数据，请先导入"（不得让模型推测）。

## 任务拆分

### Task 1 · CSV 解析（`server/ai-agent/csv.mjs`）
- `parseCsv(text)`：支持引号包裹、字段内逗号/换行/双引号转义、CRLF、BOM
- `decodeCsvBuffer(buffer)`：UTF-8 优先，出现替换字符时回退 GBK（中文 Excel 导出的 CSV 通常是 GBK）
- `toCsv(columns, rows)`：导出模板与审计导出复用
- 测试：`csv.node-test.mjs`（引号、换行、GBK、BOM、列数不齐）

### Task 2 · 数据集规格与导入（`server/ai-agent/datasets.mjs`）
- `DATASET_SPECS`：4 个数据集的列规格（表列名、中文列名、别名、类型、是否必填、护栏）
- `parseDatasetFile(spec, buffer)` → `{ ok, rows, columns, unknownColumns, missingColumns, rowErrors }`
- `importDataset({ spec, buffer, mode, userId, fileName })` → 事务内 覆盖/追加 落库 + 写 `ai_imports`
- `datasetTemplate(spec)` → 模板 CSV
- 测试：列名缺失/多余、类型错误、整批拒绝、覆盖与追加、失败行明细

### Task 3 · 分析计算（`server/ai-agent/analytics.mjs`，纯函数）
- `summarizeAds(rows)` / `summarizeSales(rows)`：汇总曝光、点击、花费、订单、销售额、ACoS、CTR、CVR、CPC
- `comparePeriods(current, previous)`：环比/同比，（无上期数据时返回 null 并注明"缺少对比期数据"）
- `decomposeAcosChange(current, previous)`：把 ACoS 变化分解为"花费效应"与"销售额效应"
- `judgeAnomalies(summary)`：按 PRD 场景二给的阈值（ACoS>35%、转化率<7%、点击率<0.25%、广告订单占比>75%）判定异常
- 测试：`analytics.node-test.mjs`（含除零、空区间、仅有部分数据）

### Task 4 · 迁移与工具
- 迁移 103：`ai_messages.blocks JSONB NOT NULL DEFAULT '[]'`
- 迁移 104：把两个数据工具写入 `ai_tools`（`requiredRole: 'user'`）
- `tools.mjs` 增加 `query_amazon_performance`、`query_inventory_orders` 执行器
- 工具返回：`rows`（明细，受 2000 行护栏）+ `summary`（中文结论素材）+ `analysis`（服务端算出的结论）+ `view`（表格/图表规格）+ `dataFreshness`

### Task 5 · 接口（`server/ai-agent/datasource-routes.mjs`）
- `GET /api/ai/imports/template?dataset=` 模板下载（CSV）
- `POST /api/ai/imports` 上传导入（原始 body + X-File-Name，与知识上传一致）
- `GET /api/ai/imports` 导入记录（含失败行明细）
- `GET /api/ai/datasets` 数据集清单 + 行数 + 最新导入时间（数据时效）
- 管理类接口沿用 `adminGuard`，导入动作写审计

### Task 6 · 编排层
- 工具结果里的 `view` 汇总进 `blocks` 并落库
- 回答基于数据时，`dataFreshness` 走已有的声明条兜底（已实现）

### Task 7 · 前端
- 新增路由 `/ai-agent/datasources`（管理员）：数据集卡片（行数 + 数据时效）、模板下载、拖拽上传、导入记录表（含失败原因）
- 回答卡片：在"结论"之后渲染 `blocks`（表格用 react-table，趋势图用 recharts），保持 PRD §5.1 的固定顺序

### Task 8 · 验收
- 单元：csv / datasets / analytics / tools 新增用例，全量 `pnpm run test:server`
- 端到端：造一份覆盖 3 个月的模拟报表 → 导入 → 提问"上个月美国站 B0XXXX 的 ACoS 为什么涨了" → 断言回答含对比表、趋势图、驱动因子、数据时效声明
- 越权：普通用户可用数据工具、不可用管理工具；未导入数据集时明确提示"暂无数据"
- 回归：`verify-e2e`（21 项）+ `verify-ui`（29 项）+ A12

## 需要业务侧提供（否则模板要返工）

| # | 项 | 用途 |
| --- | --- | --- |
| 1 | Amazon 广告报表与业务报告的**一份真实样例文件** | 校准列名与别名映射 |
| 2 | 报表导出频率与责任人（PRD Q4） | 校验数据时效声明的口径 |
| 3 | ERP 可授权只读表清单（PRD Q3） | 后续把同一批数据集换成实时查询 |

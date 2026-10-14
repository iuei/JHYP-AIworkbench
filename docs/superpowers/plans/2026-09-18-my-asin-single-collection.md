# 「我的 ASIN」单集合重构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「我的 ASIN」从"多清单 + 13 列指标表"收敛为"全账号一份 ASIN 集合（每条自带站点）+ 表格/卡片双视图 + 单条弹窗导入 + 模板批量导入 + AI 查询分析"。

**Architecture:** 数据层新建 `my_asin_items`（owner + asin + marketplace 唯一），旧 `asin_watchlists*` 两张表**保留不删**（回滚保障）但停止读写，迁移把旧清单条目按站点合并进新表；服务端删除清单领域层与清单路由，新增 `/api/ai/my-asins*`；指标按站点分组复用 `asinSetPerformancePayload`（**跨站点不求和**）；AI 工具由 `query_asin_watchlist` 改为 `query_my_asins`。

**Tech Stack:** Node/Express（`server/ai-agent/`）、PostgreSQL（`schema_migrations` 版本化迁移）、React 19 + TanStack Router/Query + shadcn/ui + Tailwind v4、Vitest（Chrome headless）+ Playwright 验收脚本。

**Spec:** 用户 2026-09-18 会话决策（本文件"决策记录"节即规格）：
① 真删清单结构、重写服务端与 AI 工具；② 每条 ASIN 自带站点；③ 历史多清单合并为一份；

④ 保留指标 + 区间选择；⑤ 批量导入保留"先预览后确认"；⑥ 删除密度切换 / 维度筛选 / 表现筛选 / 页头信息块。

---

## 决策记录（规格）

| 项 | 结论 |
| --- | --- |
| 数据模型 | 新表 `my_asin_items(owner_user_id, asin, marketplace, alias, note, ...)`，唯一键 `(owner_user_id, asin, marketplace)` |
| 上限 | 单账号 **5000** 条（所有站点合计），超限 400 报错不截断 |
| 站点 | 每条 ASIN 自带站点（沿用 `US/UK/DE/FR/IT/ES/JP/CA/MX/AU`）；指标**按站点分组**，跨站点不求和 |
| 页面路径 | 保留 `/asin-watchlists`（侧边栏、旧链接、`staticData.title` = 我的 ASIN 不变） |
| 展示 | 表格 / 卡片双视图，切换用共享 `LayoutToggle` + `CARD_GRID` + `useListLayout('asin-watchlist-layout')`（localStorage 记忆） |
| 单条导入 | 弹窗表单：ASIN（必填）、站点（必填，默认 US）、别名、备注 → `POST /api/ai/my-asins/items` |
| 批量导入 | `GET /api/ai/my-asins/template`（xlsx：ASIN / 站点 / 别名 / 备注）→ `POST /api/ai/my-asins/import?dryRun=true` 预览 → 确认导入 |
| 指标 | `GET /api/ai/my-asins/metrics?windowDays=30` 或 `?startDate=&endDate=`，保留近 7/30/90 天 + 自定义 |
| AI 工具 | `query_my_asins`（`requiredRole: 'user'`，参数 `marketplace?` / `asins?`），按站点分组输出 |
| 保留交互 | 关键词搜索、**站点筛选（新增，多站点必需）**、分页（含跳页）、导出 CSV、批量选择 + 批量移除、别名/备注就地编辑、单条编辑/删除、行内复制 ASIN |
| 删除 | 清单全部概念（新建/切换/编辑/删除清单、清单名、清单面板）、页头站点 Badge/条目数上限/别名覆盖率/说明、密度切换、维度筛选、表现筛选 |
| 旧路由 | `GET|POST|PATCH|DELETE /api/ai/asin-watchlists*` 全部删除；`/asin-watchlists/items`、`/ai-agent/asin-watchlists` 前端重定向保留 |
| 提交 | **本计划不自动 commit**（项目规则：提交前需用户确认） |

## Global Constraints

- 必须复用：`parseAsinList` / `extractAsin`（ASIN 解析唯一实现）、`asinSetPerformancePayload`（页面与 AI 工具同一套计算）、`decodeCsvBuffer`、`ConfirmDialog`、`DataTable`、`SortableHead`、`TablePagination`、`src/lib/table-styles.ts` 列语义常量、`tableBlockToCsv` + `downloadCsv`、主题 token（不写死颜色）。
- `null ≠ 0`：无报表记录显示「—」，导出空单元格，排序恒排最后。
- 权限：数据只属于本人；管理员访问他人数据同样 404。
- 迁移只增不改：新表新建、旧表保留、旧工具行删除（`ai_runs.tool_name` 无外键，删除不影响历史审计）。
- 文件名 `watchlist-table.mjs` / `watchlist-template.mjs` **保留历史名**（避免无收益的连锁改名），仅内部表头/映射扩展站点列。
- 验证命令：`pnpm run build`、`pnpm run lint`、`pnpm run test:server`、`node server/ai-agent/verify-my-asins.mjs`、`node server/ai-agent/verify-my-asins-bulk.mjs`、`pnpm exec vitest run --config vitest.chrome.config.ts <file> --browser.headless`、页面脚本 `node verify-artifacts/my-asins-ui.mjs http://localhost:5200`。

## File Structure

**新建**
- `server/ai-agent/my-asins.mjs` —— 领域层（替换 `asin-watchlists.mjs`）
- `server/ai-agent/my-asin-routes.mjs` —— 路由（替换 `watchlist-routes.mjs`）
- `server/ai-agent/my-asins.node-test.mjs`、`server/ai-agent/verify-my-asins.mjs`、`server/ai-agent/verify-my-asins-bulk.mjs`
- `src/features/asin-watchlist/components/add-item-dialog.tsx`（单条表单弹窗）
- `src/features/asin-watchlist/components/item-cards.tsx`（卡片视图）
- `verify-artifacts/my-asins-ui.mjs`

**改写**
- `server/ai-agent/migrations.mjs`（+116/+117/+118）、`watchlist-table.mjs`、`watchlist-template.mjs`、`data-queries.mjs`（+`myAsinMetricsPayload`）、`tool-contracts.mjs`、`tools.mjs`、`router.mjs`
- `src/features/asin-watchlist/{types.ts,api.ts,hooks.ts,format.ts,format.test.ts,layout.tsx,pages/watchlist-page.tsx}`
- `src/features/asin-watchlist/components/{item-manager.tsx,item-toolbar.tsx,watchlist-import-dialog.tsx}`
- `src/routes/_authenticated/asin-watchlists/{route.tsx,index.tsx}`
- `docs/modules/ASIN 清单.md`、`docs/modules/AI 助手.md`、`交接文档.md`、`CHANGELOG.md`

**删除**
- 服务端：`asin-watchlists.mjs`、`watchlist-routes.mjs`、`asin-watchlists.node-test.mjs`、`verify-watchlists.mjs`、`verify-watchlist-bulk.mjs`
- 前端：`components/{watchlist-panel.tsx,watchlist-switcher.tsx,watchlist-form-dialog.tsx,workspace-header.tsx,workspace-body.tsx}`、`workspace-context.ts`
- 验收：`server/ai-agent/verify-watchlist-ui.mjs`、`verify-artifacts/{asin-data-table.mjs,asin-ui-preview.mjs,asin-redesign-check.mjs,asin-ui-diag.mjs,asin-add-dialog-diag.mjs}`

---

## Phase A · 服务端与数据

### Task 1: 迁移 120/121/122（建表 + 数据搬迁 + 工具重播）

**Files:**
- Modify: `server/ai-agent/migrations.mjs`（新增 3 个 up 函数 + 3 条迁移项，插在最后一个迁移项之后）

**Interfaces:**
- Produces: 表 `my_asin_items`；旧数据已迁入；`ai_tools` 中 `query_my_asins` 已注册、`query_asin_watchlist` 已删除

- [ ] **Step 1: 写迁移函数 `createMyAsinSchema`**

```js
async function createMyAsinSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS my_asin_items (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      asin VARCHAR(40) NOT NULL,
      marketplace VARCHAR(10) NOT NULL DEFAULT 'US',
      alias VARCHAR(120),
      note VARCHAR(300),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (owner_user_id, asin, marketplace)
    );

    CREATE INDEX IF NOT EXISTS my_asin_items_owner_idx
      ON my_asin_items(owner_user_id, marketplace, created_at ASC);
  `)
}
```

- [ ] **Step 2: 写数据搬迁 `mergeWatchlistItemsIntoMyAsins`**

```js
async function mergeWatchlistItemsIntoMyAsins(client) {
  await client.query(`
    INSERT INTO my_asin_items (owner_user_id, asin, marketplace, alias, note, created_at, updated_at)
    SELECT w.owner_user_id, i.asin, w.marketplace, i.alias, i.note, i.created_at, i.updated_at
      FROM asin_watchlist_items i
      JOIN asin_watchlists w ON w.id = i.watchlist_id
     WHERE w.deleted_at IS NULL
    ON CONFLICT (owner_user_id, asin, marketplace) DO UPDATE
       SET alias = COALESCE(my_asin_items.alias, EXCLUDED.alias),
           note  = COALESCE(my_asin_items.note, EXCLUDED.note),
           updated_at = GREATEST(my_asin_items.updated_at, EXCLUDED.updated_at)
  `)
}
```

- [ ] **Step 3: 写工具重播 `reseedMyAsinTool`**（先删旧工具行再 upsert 新契约）

```js
async function reseedMyAsinTool(client) {
  await client.query(`DELETE FROM ai_tools WHERE name = 'query_asin_watchlist'`)
  await seedAiToolsAndSettings(client)
}
```

- [ ] **Step 4: 注册三条迁移项**（BASE + 20 / 21 / 22，紧接 `add_message_block_reason` 之后）

- [ ] **Step 5: 验证**

Run: `pnpm run test:server`
Expected: 全绿；启动 `node server/index.mjs` 后 `\d my_asin_items` 可见新表，旧表仍在。

- [ ] **Step 6: 数据核对（手工 SQL）**

```sql
SELECT w.owner_user_id, COUNT(*) FROM asin_watchlist_items i
  JOIN asin_watchlists w ON w.id = i.watchlist_id WHERE w.deleted_at IS NULL GROUP BY 1;
SELECT owner_user_id, COUNT(*) FROM my_asin_items GROUP BY 1;
```
Expected: 前者每个 (owner, asin) 去重后条数 ≤ 后者。

### Task 2: 领域层 `my-asins.mjs`

**Files:**
- Create: `server/ai-agent/my-asins.mjs`
- Test: `server/ai-agent/my-asins.node-test.mjs`
- Delete: `server/ai-agent/asin-watchlists.mjs`、`asin-watchlists.node-test.mjs`

**Interfaces:**
- Produces:
```js
export const MAX_ITEMS_PER_USER = 5000
export const MY_ASIN_MARKETPLACES = ['US','UK','DE','FR','IT','ES','JP','CA','MX','AU']
export async function listMyAsins({ userId })                       // → [{ id, asin, marketplace, alias, note, createdAt, updatedAt }]
export async function addMyAsins({ userId, entries })               // entries: [{ asin, marketplace, alias, note }] → { added, duplicated, repeated, invalid, itemCount }
export async function parseAddPayload({ raw, defaultMarketplace })  // 文本/表格文本 → { entries, invalid, repeated }
export async function updateMyAsinItem({ userId, itemId, alias, note, marketplace })
export async function removeMyAsinItem({ userId, itemId })
export async function importMyAsinTable({ userId, buffer, fileName, dryRun, defaultMarketplace })
```

- [ ] **Step 1: 写失败测试**（`my-asins.node-test.mjs`，沿用旧测试的断言风格：解析 / 归一化 / 上限 / 去重 / 站点白名单 / 非法站点报错）
- [ ] **Step 2: 跑测试确认失败**：`pnpm run test:server` → `Cannot find module './my-asins.mjs'`
- [ ] **Step 3: 实现**：解析复用 `parseAsinList`（纯 ASIN 文本）与 `watchlist-table.mjs` 的 `parseTableText`（表格文本，新增站点列），站点经 `parseMarketplace` 归一化，写入用 `unnest` 三/四数组批量插入，冲突 `ON CONFLICT DO NOTHING`，超 5000 抛校验错误
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 删除旧领域层与其测试**，修正引用（`grep -rn "asin-watchlists.mjs" server`）

### Task 3: 模板与解析层支持站点列

**Files:**
- Modify: `server/ai-agent/watchlist-template.mjs`、`server/ai-agent/watchlist-table.mjs`
- Test: `server/ai-agent/watchlist-table.node-test.mjs`（扩展）

**Interfaces:**
- Produces: 模板表头 `ASIN / 站点 / 别名 / 备注`；`detectColumnMapping` 返回 `{ asin, marketplace, alias, note }`；`analyzeTableRows` 的 entry 形如 `{ asin, marketplace, alias, note, line }`

- [ ] **Step 1: 写失败测试**：表头 `站点/国家/Marketplace` 均能识别；`站点` 列值 `us`/`美国` 归一化为 `US`；非法站点进 `invalid`（不静默改站点）；缺站点列时用 `defaultMarketplace`
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**：
```js
const MARKETPLACE_HEADERS = ['站点', 'marketplace', '国家', '站点代码', 'market']
// detectColumnMapping 增加 marketplace；解析中文国名映射（美国→US…），非法值记 invalid 行
```
模板 `COLUMNS` 插入 `{ header: '站点', width: 10 }`，站点列显式 `type: String`，示例行补 `US`
- [ ] **Step 4: 跑测试确认通过**（`pnpm run test:server`）

### Task 4: 路由 `/api/ai/my-asins*`

**Files:**
- Create: `server/ai-agent/my-asin-routes.mjs`（替换 `watchlist-routes.mjs`）
- Modify: `server/ai-agent/router.mjs`（改挂新 router）
- Delete: `server/ai-agent/watchlist-routes.mjs`

**Interfaces（全部走 `requireUser` + `identityGuard`，无 adminGuard）:**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/ai/my-asins` | `{ items, maxItems, marketplaces }` |
| GET | `/api/ai/my-asins/template` | xlsx 模板（**必须注册在参数路由之前**） |
| POST | `/api/ai/my-asins/items` | `{ asins?: string, items?: [{asin, marketplace?, alias?, note?}] }`，四分类返回 |
| POST | `/api/ai/my-asins/import` | 原始 body + `X-File-Name`，`?dryRun=true` 只预览 |
| GET | `/api/ai/my-asins/metrics` | `?windowDays=` 或 `?startDate=&endDate=` |
| PATCH | `/api/ai/my-asins/items/:itemId` | 改别名 / 备注 / 站点 |
| DELETE | `/api/ai/my-asins/items/:itemId` | 移除单条 |

- [ ] **Step 1: 写失败测试**（并入 `verify-my-asins.mjs`，Task 7）；先手工 `curl` 断言 404（路由未挂）
- [ ] **Step 2: 实现路由**，错误语义保持 400/404/409 分离；`template` 在 `:itemId` 之前注册
- [ ] **Step 3: 挂载**：`router.mjs` 由 `createWatchlistRouter()` 换为 `createMyAsinRouter()`
- [ ] **Step 4: 验证**：`pnpm run lint` + `node server/index.mjs` 手工 curl 全部端点
- [ ] **Step 5: 删除旧路由文件**，`grep -rn "asin-watchlists" server` 应只剩无关历史注释

### Task 5: 多站点指标载荷 `myAsinMetricsPayload`

**Files:**
- Modify: `server/ai-agent/data-queries.mjs`

**Interfaces:**
- Produces:
```js
export async function myAsinMetricsPayload({ items, startDate, endDate }) // items: [{asin, marketplace, alias}]
// → { period: {startDate,endDate,days}, groups: [{ marketplace, summary, rows }], rows, summary, dataFreshness }
```

- [ ] **Step 1: 写失败测试**（`my-asins.node-test.mjs` 增补）：两个站点各有数据时，`groups` 长度 2 且**不合算跨站合计**；指标行 `null` 不被折成 0；行数与 items 对齐
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**：按 `marketplace` 分组 → 组内调用 `asinSetPerformancePayload({ asins, marketplace, startDate, endDate, aliasByAsin, detailLimit: null })` → 合并（`rows` 扁平化、`summary` 仅给总数与覆盖数，**金额/ACoS 不出跨站合计**）
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 确认 AI 工具路径零回归**：`node server/ai-agent/verify-my-asins-bulk.mjs`（Task 7 建立后回跑）

### Task 6: AI 工具 `query_my_asins`

**Files:**
- Modify: `server/ai-agent/tool-contracts.mjs`（删旧契约、加新契约）、`server/ai-agent/tools.mjs`（执行体改名与改写）、`server/ai-agent/migrations.mjs`（Task 1 已含重播）

**Interfaces:**
- Produces: 工具 `query_my_asins`，`requiredRole: 'user'`，`paramsSchema`:
```json
{ "type": "object", "properties": {
  "marketplace": { "type": "string", "description": "只看某个站点（US/UK/DE/FR/IT/ES/JP/CA/MX/AU），不传则按站点分组给出全部" },
  "asins": { "type": "array", "items": { "type": "string" }, "description": "只看指定 ASIN；不传则为全部" }
} }
```

- [ ] **Step 1: 写失败测试**（`verify-my-asins.mjs`）：工具列表含 `query_my_asins`、**不含** `query_asin_watchlist`；空集合时返回"先去页面添加 ASIN"的引导
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 改契约与执行体**：删除 `resolveWatchlistForTool` 分支，改为 `listMyAsins` → 过滤 → `myAsinMetricsPayload` → 输出**按站点分节的表格块 + 每站摘要 + 无数据站点提示**；`MAX_TABLE_ROWS = 30` 预算不变
- [ ] **Step 4: 跑测试确认通过**（`pnpm run test:server` + `verify-my-asins.mjs`）
- [ ] **Step 5: 全局检索旧工具名**：`grep -rn "query_asin_watchlist" --include=*.mjs --include=*.ts --include=*.tsx --include=*.md . --exclude-dir=node_modules --exclude-dir=dist`，除历史文档（`CHANGELOG.md` / 交接文档历史行）外不得残留

### Task 7: 服务端验收脚本重写

**Files:**
- Create: `server/ai-agent/verify-my-asins.mjs`、`server/ai-agent/verify-my-asins-bulk.mjs`
- Delete: `verify-watchlists.mjs`、`verify-watchlist-bulk.mjs`、`verify-watchlist-ui.mjs`

- [ ] **Step 1: 写 `verify-my-asins.mjs`**（约 26 项）：鉴权、账号隔离（他人 404）、单条/批量新增四分类、站点归一化与非法站点 400、重复 (asin, 站点) 不重复写、别名/备注更新、单条移除、模板是真 xlsx（ZIP 魔数 + 表头含"站点"）、导入 dryRun 不写库、真实导入写库、**多站点指标分组且无跨站合计**、`null` 不折算 0、超 5000 报 400 且数据不变、工具 `query_my_asins` 注册与取数、空集合引导
- [ ] **Step 2: 跑脚本**：`API_PORT=8788 node server/index.mjs` + `node server/ai-agent/verify-my-asins.mjs`
- [ ] **Step 3: 写 `verify-my-asins-bulk.mjs`**（约 7 项）：5000 条导入耗时、超限 400、页面指标全量返回、AI 工具只回 30 行且摘要指向页面
- [ ] **Step 4: 跑脚本确认全绿**
- [ ] **Step 5: 删除旧服务端验收脚本**并同步 `package.json` 中相关 script（若有）

---

## Phase B · 前端

### Task 8: 类型 / API / Hooks

**Files:**
- Modify: `src/features/asin-watchlist/{types.ts,api.ts,hooks.ts}`

**Interfaces:**
- Produces:
```ts
export interface MyAsinItem { id: number; asin: string; marketplace: string; alias: string | null; note: string | null; createdAt: string; updatedAt: string }
export interface MyAsinMetrics { period: {...}; groups: Array<{ marketplace: string; summary: MyAsinSummary; rows: MyAsinMetricRow[] }>; dataFreshness: DataFreshness | null }
fetchMyAsins(): Promise<{ items: MyAsinItem[]; maxItems: number; marketplaces: string[] }>
addMyAsins(payload: { asins?: string; items?: Array<{asin:string; marketplace?:string; alias?:string|null; note?:string|null}> })
importMyAsinTable(file: File, { dryRun }?: { dryRun?: boolean })
fetchMyAsinTemplate(): Promise<Blob>
fetchMyAsinMetrics(query: MetricsQuery): Promise<MyAsinMetrics>
updateMyAsinItem(itemId, patch) / removeMyAsinItem(itemId)
useMyAsins() / useMyAsinMetrics(query, {enabled}) / useAddMyAsins() / useImportMyAsinTable() / useUpdateMyAsinItem() / useRemoveMyAsinItem()
```
- queryKeys: `['my-asins']` / `['my-asins','metrics',query]`（保留"只切区间不重拉条目"与 `keepPreviousData`）

- [ ] **Step 1: 改 types.ts**（删清单类型、加 `marketplace` 到条目与指标行）
- [ ] **Step 2: 改 api.ts**（全部指向 `/ai/my-asins*`）
- [ ] **Step 3: 改 hooks.ts**（写操作统一失效 `['my-asins']`）
- [ ] **Step 4: 验证**：`pnpm run build`（此步会有下游编译错误，属预期，Task 10–13 修完）

### Task 9: `format.ts` 列表纯函数

**Files:**
- Modify: `src/features/asin-watchlist/format.ts`、`format.test.ts`

**Interfaces:**
- Produces: `filterMyAsinRows(rows, keyword, marketplace)`（维度筛选与表现筛选**删除**）、`sortMyAsinRows(rows, key, direction)`、`myAsinRowsToCsv(rows)`（含站点列）、`joinMyAsinRows(items, metricsGroups)`（按 (asin, marketplace) 连接）

- [ ] **Step 1: 改测试**：删除维度/表现筛选断言；新增"按站点筛选""站点列导出""无指标行恒排最后"
- [ ] **Step 2: 跑测试确认失败**：`pnpm exec vitest run --config vitest.chrome.config.ts src/features/asin-watchlist/format.test.ts --browser.headless`
- [ ] **Step 3: 实现**
- [ ] **Step 4: 跑测试确认通过**

### Task 10: 表格视图（`item-manager.tsx` 重写）

**Files:**
- Modify: `src/features/asin-watchlist/components/item-manager.tsx`（13 列 → 14 列：+站点，保留指标）、`item-toolbar.tsx`（单行工具条精简）
- Delete: 密度切换、维度筛选段控、表现筛选下拉的引用与 props

**Interfaces:**
- Consumes: `useListLayout`（Task 11）、`ItemCards`（Task 11）、`AddItemDialog`（Task 12）
- Produces: `<ItemManager layout={layout} onLayoutChange={...} />`，内部按 `layout` 渲染 `DataTable` 或 `ItemCards`

- [ ] **Step 1: 改工具条**：搜索框 + 站点 Select + 区间 Tabs + 自定义日期 + 视图切换 + 「添加 ASIN」/「从表格导入」/「导出 CSV」；删除密度与两种筛选
- [ ] **Step 2: 改表格**：保留勾选、行号、ASIN（hover 复制）、站点、别名、备注、数据覆盖、6 个指标列、操作（编辑/删除）；保留排序、吸顶、跳页、就地编辑、批量移除
- [ ] **Step 3: 校验 5000 条不分页退化**：仍为前端切片（每页 50），渲染节点数与现状一致
- [ ] **Step 4: 验证**：`pnpm run lint` + `pnpm run build`

### Task 11: 卡片视图（`item-cards.tsx`）

**Files:**
- Create: `src/features/asin-watchlist/components/item-cards.tsx`
- Modify: `pages/watchlist-page.tsx`（装配 `LayoutToggle`）

**Interfaces:**
- Consumes: `LayoutToggle`、`CARD_GRID`、`useListLayout`（`@/features/ai-agent/components/{layout-toggle,list-layout}`）
- Produces: `<ItemCards rows={...} selected={...} onToggleSelect onEdit onDelete onCopy />`

- [ ] **Step 1: 写卡片**：每张卡 = ASIN（mono + 复制按钮）+ 站点 Badge + 数据覆盖 Badge + 别名/备注（`line-clamp-2`）+ 指标 2×3 小格（花费 / 广告销售额 / 广告订单 / ACoS / 销量 / 销售额，`null` → 「—」，ACoS > 35% 标红）+ 操作（编辑 / 移除）
- [ ] **Step 2: 网格用 `CARD_GRID`**（`auto-rows-fr`、`sm:grid-cols-2 2xl:grid-cols-3`），所有卡片等高，不展开长文本
- [ ] **Step 3: 卡片视图下由页面补 `TablePagination`**（与提示词广场一致），表格视图用 `DataTable` 内部分页
- [ ] **Step 4: 验证**：手动切视图 + 5000 条下滚动无抖动；`pnpm run build`

### Task 12: 单条弹窗 + 批量导入弹窗

**Files:**
- Create: `src/features/asin-watchlist/components/add-item-dialog.tsx`
- Modify: `watchlist-import-dialog.tsx`（预览增加站点列/站点识别、默认站点选择）

**Interfaces:**
- Produces: `<AddItemDialog open onOpenChange onAdded />`（RHF + zod：`asin` 必填且经 `extractAsin` 校验、`marketplace` 必填默认 US、`alias` ≤120、`note` ≤300）
- 导入弹窗新增 props：`defaultMarketplace`（预览页可改，缺站点列时按它落库）

- [ ] **Step 1: 写单条弹窗**，提交 `POST /items { items: [{ asin, marketplace, alias, note }] }`，成功后 toast + 刷新
- [ ] **Step 2: 改导入弹窗**：预览表增加「站点」列（`willAdd` 行显示站点）、列识别文案含站点、缺站点列时显示"默认站点"下拉
- [ ] **Step 3: 验证**：空 ASIN、非法站点、超长别名三类错误提示可读；粘贴超 5000 行时 Textarea 仍限高（`max-h-40 overflow-y-auto`）

### Task 13: 页面与路由装配，删除旧组件

**Files:**
- Modify: `src/routes/_authenticated/asin-watchlists/{route.tsx,index.tsx}`、`src/features/asin-watchlist/{layout.tsx,pages/watchlist-page.tsx}`
- Delete: `components/{watchlist-panel.tsx,watchlist-switcher.tsx,watchlist-form-dialog.tsx,workspace-header.tsx,workspace-body.tsx}`、`workspace-context.ts`

**Interfaces:**
- Produces: `/asin-watchlists` 无 search 参数；`layout` 只负责 `Main` + 加载/错误/空态；页面 = 工具条 + 视图（表格/卡片）

- [ ] **Step 1: 简化 route.tsx**（去掉 `?list=` / `?view=` 校验；`items.tsx` 与 `/ai-agent/asin-watchlists` 重定向保持）
- [ ] **Step 2: 重写 layout.tsx / watchlist-page.tsx**：加载骨架、错误卡（"读不到，请刷新重试"）、空态引导（两个入口：粘贴单条 / 模板导入）
- [ ] **Step 3: 删除 5 个旧组件 + context**，`grep -rn "watchlist-panel\|watchlist-switcher\|workspace-header\|workspace-body\|workspace-context\|watchlist-form-dialog" src` 必须为空
- [ ] **Step 4: 验证**：`pnpm run build`、`pnpm run lint`、`pnpm run dev` 手测四条旧链接（`/asin-watchlists`、`/asin-watchlists/items`、`/ai-agent/asin-watchlists`、`?view=items`）全部落地正确

### Task 14: 页面验收脚本重写

**Files:**
- Create: `verify-artifacts/my-asins-ui.mjs`（替换 `asin-data-table.mjs` / `asin-ui-preview.mjs` / `asin-redesign-check.mjs` / `asin-ui-diag.mjs` / `asin-add-dialog-diag.mjs`）

- [ ] **Step 1: 写脚本**（约 18 项）：单条弹窗新增 → 表格出现该行；模板导入预览 → 确认导入；表格/卡片切换与刷新后偏好保持；站点筛选；区间切换后指标与手算值对齐；`null` 显示「—」；ACoS 标红；就地编辑保存；排序空值最后；批量选择 + 移除；导出 CSV 文件名与列；分页跳页；旧链接重定向；零控制台错误
- [ ] **Step 2: 跑脚本**：`API_PORT=8788 pnpm exec vite --port 5200 --strictPort` + `node verify-artifacts/my-asins-ui.mjs http://localhost:5200`
- [ ] **Step 3: 删除 5 个旧页面脚本**
- [ ] **Step 4: 更新 `server/verify-nav-ia.mjs`** 中与本模块相关的断言（侧边栏入口仍为「我的 ASIN」→ `/asin-watchlists`），跑 `node server/verify-nav-ia.mjs http://localhost:5200` 全绿

---

## Phase C · 收尾

### Task 15: 文档与全量验证

**Files:**
- Modify: `docs/modules/ASIN 清单.md`（功能清单、API 明细、影响范围、历史变更全量改）、`docs/modules/AI 助手.md`（工具改名与描述）、`交接文档.md`、`CHANGELOG.md`

- [ ] **Step 1: 重写责任田**：数据模型改成 `my_asin_items`、接口表改成 `/api/ai/my-asins*`、AI 工具改 `query_my_asins`、功能清单改成"单条弹窗 / 模板导入 / 表格卡片双视图 / 指标按站点分组"、历史变更追加一行（含删除项与验收数字）
- [ ] **Step 2: 跑全量验证**
```bash
pnpm run lint
pnpm run build
pnpm run test:server
node server/ai-agent/verify-my-asins.mjs
node server/ai-agent/verify-my-asins-bulk.mjs
pnpm exec vitest run --config vitest.chrome.config.ts src/features/asin-watchlist/format.test.ts --browser.headless
node verify-artifacts/my-asins-ui.mjs http://localhost:5200
node server/verify-nav-ia.mjs http://localhost:5200
```
- [ ] **Step 3: 交接文档记录"旧表保留不删"与回滚方式**（回滚 = 恢复旧代码 + 忽略新表）

---

## 风险与回滚

| 风险 | 缓解 |
| --- | --- |
| 数据迁移丢失别名/备注 | `ON CONFLICT` 用 `COALESCE` 保留非空值；旧表**不删**，可重跑 |
| 跨站点指标被误读为可相加 | 服务端不出跨站合计；页面按站点分区/列展示站点；AI 工具按站点分节 |
| 旧链接/书签 404 | `/asin-watchlists/items`、`/ai-agent/asin-watchlists` 重定向保留；页面路径不变 |
| 验收脚本大面积失效 | Task 7 / 14 同步重写，旧脚本随改动一并删除，不留假绿 |
| 上限提示消失后用户不知边界 | 导入超限由服务端 400 报错并在弹窗内显示差多少 |
| 工具改名导致模型看不到工具 | 迁移 118 `DELETE` 旧行 + `seedAiToolsAndSettings` upsert 新契约，验收脚本断言工具列表 |

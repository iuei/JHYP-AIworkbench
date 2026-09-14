# 账号级知识沉淀（M-C 知识沉淀 MVP）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 按任务顺序执行；每个 Task 完成后跑该 Task 的验证命令再进入下一个。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 让每个账号拥有自己的知识沉淀空间：员工可手动把一次问答沉淀成结构化经验条目、单独导出；管理员可在「沉淀管理」查看/审核/编辑/导出全部账号的沉淀；沉淀进公共知识库必须经审核。

**Architecture:** 复用既有 AI 助手模块的分层（迁移 → 纯函数领域层 → 仓储层 → HTTP 层 → 前端 feature 目录）。沉淀内容存 `ai_knowledge_notes`（`owner_user_id` 做账号隔离），账号级技能配置存 `ai_skills` + `ai_user_skills`（技能定义沿用 Claude SKILL.md 的 frontmatter 约定，便于与外部技能生态互通）。私有沉淀**不进**公共检索；审核通过后才生成 `ai_documents`（`source_type='experience'`、`source_ref='note:<id>'`）并标注提报人。

**Tech Stack:** PostgreSQL 16 + pgvector + pg_trgm、Express 5、Node 25（`node --test`）、React 19 + TanStack Router/Query + shadcn/ui + Tailwind v4。

**状态：已交付（2026-09-11）** —— 单测 274 项、端到端验收 40/40（真实模型 deepseek-chat）、UI 冒烟 49/49、`pnpm run build` 与 `pnpm run lint` 全绿。

## 交付结果与偏差（执行后回填）

| 计划项 | 实际落地 | 偏差说明 |
| --- | --- | --- |
| Task 1 迁移 106 | 106（建表）+ 107（技能种子）+ **108（补 `provenance`/`evidence`）** | 106 已应用到开发库后才发现需要可信度字段，按「已应用的迁移不得改动」原则另起 108 补列 |
| Task 2 `skills.mjs` | 另有新增文件 **`skill-contracts.mjs`** | 技能契约（名称/字段/正文）需要被迁移种子、抽取提示词、`skills.mjs` 三方共用；独立成文件可避免 `migrations ↔ skills` 循环依赖，且与既有 `tool-contracts.mjs` 的模式一致 |
| Task 3 `notes.mjs` | 配额改为统计**真实 AI 整理次数**（`countDistillCallsToday`，依据 `ai_audit_logs.action='note_distill'`） | 原计划按「当天新建沉淀数」计数，实测把手工新建也算进去，跑三轮验收即误报 429，与界面承诺矛盾 |
| 未在计划内 | 修复 `orchestrator.mjs` 引用重复累计（新增 `dedupeCitations`）、`citation-panel.tsx` key 兜底 | UI 冒烟暴露的既有缺陷：多轮工具调用重复返回同一片段，触发 React 重复 key 警告 |
| 未在计划内 | 放宽 `verify-e2e.mjs` 的 `A5-3` 查询窗口（20 → 300） | 该断言依赖最近 20 条 `tool_blocked` 窗口，被编排层「模型自己描述工具」的拦截记录挤出，属既有测试缺陷，与本次功能无关 |
| 迁移号 | 本轨道 106–108；并行轨道的产品主数据占用 109/110 | 同工作区两条轨道并行开发，迁移号由对方在 109 起续号 |

**Spec:** `需求文档.md` §5.2（F2 知识库 / F3 员工经验沉淀）、§5.4（审计台与导出）、§3.3（权限裁剪三层）；现状基准见 `docs/modules/AI 助手.md` 与 `交接文档.md`。

## Global Constraints

- 权限判断**只能**写在 `server/ai-agent/permissions.mjs`，业务模块不得自行拼接 `owner_user_id = ?` 之外的账号判断之外的角色判断。
- 所有管理类写操作必须 `recordAudit()` 落库；导出动作本身也写审计（`需求文档.md` §5.4）。
- 审计失败必须抛错，禁止吞异常。
- 迁移版本号必须从 **106** 起（`schema_migrations.version` 是唯一键，1 已被快捷导航占用，AI 模块用 100+ 号段）。
- 不新增任何依赖（无 zip 库、无 Markdown 渲染库）：导出用 CSV + 合并 Markdown，前端正文用 `whitespace-pre-wrap` 纯文本渲染。
- 项目根目录**不是 git 仓库**：本计划不含 commit 步骤。
- 禁止使用 `console`（ESLint 会报错）；服务端日志用 `process.stderr.write`。
- 沉淀抽取失败**不编造**：降级为原文草稿（`degraded: true`），字段留空由用户填。
- 私有沉淀默认**不进**公共检索；管理员在对话检索中**看不到**他人私有沉淀，只能在管理页查看（已确认）。
- 技能在每个账号上**默认关闭**（已确认）；沉淀进公共库**必须审核**（已确认）。

## 数据模型（迁移 106）

```sql
CREATE TABLE IF NOT EXISTS ai_skills (
  id SERIAL PRIMARY KEY,
  name VARCHAR(60) UNIQUE NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  version VARCHAR(20) NOT NULL DEFAULT '1.0.0',
  source VARCHAR(20) NOT NULL DEFAULT 'builtin' CHECK (source IN ('builtin', 'imported')),
  body TEXT NOT NULL DEFAULT '',
  field_schema JSONB NOT NULL DEFAULT '[]'::jsonb,
  triggers JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_user_skills (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES ai_skills(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  trigger_mode VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (trigger_mode IN ('manual', 'auto', 'both')),
  default_visibility VARCHAR(20) NOT NULL DEFAULT 'private' CHECK (default_visibility IN ('private', 'review')),
  daily_quota INTEGER NOT NULL DEFAULT 20,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, skill_id)
);

CREATE TABLE IF NOT EXISTS ai_knowledge_notes (
  id SERIAL PRIMARY KEY,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags TEXT[] NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'private'
    CHECK (status IN ('private', 'pending', 'published', 'rejected', 'archived')),
  source_kind VARCHAR(20) NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'conversation', 'feedback')),
  conversation_id INTEGER REFERENCES ai_conversations(id) ON DELETE SET NULL,
  message_ids INTEGER[] NOT NULL DEFAULT '{}',
  skill_name VARCHAR(60),
  provider VARCHAR(40),
  model VARCHAR(120),
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  note_version INTEGER NOT NULL DEFAULT 1,
  merged_from INTEGER[] NOT NULL DEFAULT '{}',
  degraded BOOLEAN NOT NULL DEFAULT FALSE,
  published_document_id INTEGER REFERENCES ai_documents(id) ON DELETE SET NULL,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  review_comment TEXT,
  reviewed_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ai_documents ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
```

索引：

```sql
CREATE INDEX IF NOT EXISTS ai_notes_owner_idx ON ai_knowledge_notes(owner_user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_notes_status_idx ON ai_knowledge_notes(status, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_notes_tags_idx ON ai_knowledge_notes USING GIN(tags);
CREATE UNIQUE INDEX IF NOT EXISTS ai_notes_owner_title_uidx
  ON ai_knowledge_notes(owner_user_id, lower(title))
  WHERE deleted_at IS NULL;
```

内置技能种子（`skill_name = 'knowledge-distill'`，字段对齐 `需求文档.md` §5.2 F3 七字段）。

## 状态机

| 起点 | 终点 | 谁可以做 |
| --- | --- | --- |
| private | pending | 本人 |
| pending | published / rejected | 管理员 |
| private / pending | archived | 本人或管理员 |
| rejected | private | 本人（改完重新提交） |
| published | archived | 管理员 |
| archived | private | 本人或管理员 |

---

### Task 1: 迁移 106 + 内置技能种子

**Files:**
- Modify: `server/ai-agent/migrations.mjs`（新增 `createKnowledgeDistillSchema`、`seedKnowledgeDistillSkill`，并追加两条 migration 到 `aiAgentMigrations`）
- Test: `server/ai-agent/migrations.node-test.mjs`（追加断言）

**Interfaces:**
- Produces: 表 `ai_skills` / `ai_user_skills` / `ai_knowledge_notes`；`ai_documents.owner_user_id`；常量 `DISTILL_SKILL_NAME = 'knowledge-distill'`

- [ ] **Step 1: 写测试**：断言 `aiAgentMigrations` 的版本号唯一且最新为 106，且 `DISTILL_SKILL_NAME` 等于 `'knowledge-distill'`。
- [ ] **Step 2: 跑测试看它失败**：`node --test server/ai-agent/migrations.node-test.mjs`
- [ ] **Step 3: 实现迁移**（DDL 见上文），`up` 用 `client.query` 一条条执行；种子用 `INSERT ... ON CONFLICT (name) DO UPDATE`。
- [ ] **Step 4: 跑迁移**：`pnpm run db:setup`，再用 `psql` 确认 4 张表/列存在。
- [ ] **Step 5: 跑测试**：`node --test server/ai-agent/migrations.node-test.mjs`

### Task 2: `skills.mjs`（技能定义与账号级配置）

**Files:**
- Create: `server/ai-agent/skills.mjs`
- Test: `server/ai-agent/skills.node-test.mjs`

**Interfaces:**
- Produces（后续任务依赖的精确签名）：
  - `SkillValidationError extends Error`
  - `DISTILL_SKILL_NAME = 'knowledge-distill'`
  - `DISTILL_FIELDS: { key, label, hint, required }[]`（scenario/background/approach/result/pitfalls/applicability）
  - `parseSkillFrontmatter(markdown) → { frontmatter: Record<string, unknown>, body: string }`
  - `renderSkillMarkdown(skill) → string`
  - `normalizeUserSkillConfig(input = {}) → { enabled, triggerMode, defaultVisibility, dailyQuota, fieldKeys }`
  - `resolveDistillFields(skill, config) → { key, label, hint, required }[]`
  - `listSkills({ includeDisabled }) / getSkillByName(name) / getUserSkill({ userId, skillName }) / saveUserSkill({ userId, skillName, patch }) / listUserSkillOverview() / setSkillEnabled({ skillName, enabled })`

**关键实现（纯函数，必须逐字实现）:**

```js
export function parseSkillFrontmatter(markdown) {
  const text = String(markdown ?? '').replace(/\r\n?/g, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (!match) return { frontmatter: {}, body: text.trim() }
  const frontmatter = {}
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf(':')
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    const raw = trimmed.slice(separator + 1).trim()
    frontmatter[key] = parseScalar(raw)
  }
  return { frontmatter, body: text.slice(match[0].length).trim() }
}

// parseScalar：'[a, b]' → ['a','b']；'true'/'false' → boolean；纯数字 → number；其余去引号后返回字符串
```

```js
const TRIGGER_MODES = new Set(['manual', 'auto', 'both'])
const VISIBILITIES = new Set(['private', 'review'])

export function normalizeUserSkillConfig(input = {}) {
  const triggerMode = input.triggerMode ?? 'manual'
  if (!TRIGGER_MODES.has(triggerMode)) {
    throw new SkillValidationError('触发方式只能是 manual / auto / both。')
  }
  const defaultVisibility = input.defaultVisibility ?? 'private'
  if (!VISIBILITIES.has(defaultVisibility)) {
    throw new SkillValidationError('默认可见性只能是 private / review。')
  }
  const quota = Number(input.dailyQuota ?? 20)
  const dailyQuota = Number.isInteger(quota) ? Math.max(0, Math.min(quota, 200)) : 20
  const fieldKeys = Array.isArray(input.fieldKeys)
    ? [...new Set(input.fieldKeys.filter((key) => typeof key === 'string' && key))]
    : []
  return { enabled: Boolean(input.enabled), triggerMode, defaultVisibility, dailyQuota, fieldKeys }
}
```

**测试用例（≥12 项）:** frontmatter 正常解析 / 无 frontmatter / 数组与布尔与数字标量 / 渲染后可被自己解析回来（往返一致）/ 非法 triggerMode 抛错 / 非法 visibility 抛错 / 配额越界夹取（-5→0，999→200，小数→20）/ fieldKeys 去重 / `resolveDistillFields` 未配置时返回全部必填字段 / 配置了不存在的 key 时忽略 / 配置的 key 顺序按 DISTILL_FIELDS 排序。

- [ ] Step 1 写测试 → Step 2 `node --test server/ai-agent/skills.node-test.mjs` 看失败 → Step 3 实现 → Step 4 看通过。

### Task 3: `notes.mjs`（沉淀条目领域层 + 仓储）

**Files:**
- Create: `server/ai-agent/notes.mjs`
- Test: `server/ai-agent/notes.node-test.mjs`

**Interfaces:**
- Produces:
  - `NoteValidationError extends Error`
  - `NOTE_STATUS = { private, pending, published, rejected, archived }`（值同键名）
  - `normalizeNoteInput(input) → { title, summary, fields, tags }`
  - `normalizeTags(input) → string[]`（去空白、去重、单个 ≤20 字、最多 10 个）
  - `mergeNoteFields(existing, incoming) → { fields, changedKeys }`（incoming 非空覆盖，空值保留 existing）
  - `canTransition(from, to, { isAdmin }) → boolean`
  - `assertTransition(from, to, { isAdmin })`（非法抛 `NoteValidationError`）
  - `noteToMarkdown(note, { fields }) → string`（带 frontmatter：id/title/status/owner/tags/created_at/conversation_id/skill）
  - `notesToMarkdown(notes, { fields }) → string`（条目之间用 `\n---\n` 分隔，首行加 `<!-- 知识沉淀导出 -->`）
  - `notesToCsv(rows, { fields }) → string`（用 `csv.mjs` 的 `toCsv`；列：id/标题/状态/账号/标签/字段各列/来源会话/创建时间/更新时间）
  - `createNote({ user, input, skillName, provider, model, tokensIn, tokensOut, conversationId, messageIds, sourceKind, degraded }) → row`
  - `listNotes({ userId = null, status, keyword, tag, from, to, page, pageSize }) → { rows, total, page, pageSize }`（`userId = null` 表示管理员全量视图）
  - `getNote({ id, user }) → row | null`（越权返回 null，不抛错）
  - `updateNote({ id, user, patch }) → row | null`
  - `transitionNote({ id, user, to, comment }) → row | null`
  - `publishNoteDocument({ note }) → documentId`（生成 `ai_documents`，`source_ref = 'note:' + id`，幂等）
  - `listNoteStats() → { totalNotes, pendingNotes, publishedNotes, accounts, byAccount: [{ userId, login, name, total, pending, published }] }`

**归一化规则:** 标题必填、`trim()` 后 1–200 字；`summary` 截断 500 字；`fields` 只保留字符串值并 `trim()`，空串剔除；非法类型抛 `NoteValidationError`。

- [ ] Step 1 写测试（≥14 项：标题空/超长、tags 归一、mergeNoteFields 三种情形、状态机允许与禁止组合（含"管理员也不能把 private 直接置 published"）、`noteToMarkdown` 往返 frontmatter、`notesToMarkdown` 分隔符、`notesToCsv` 表头与转义）→ Step 2 看失败 → Step 3 实现 → Step 4 看通过。

### Task 4: `permissions.mjs` 增账号维度

**Files:**
- Modify: `server/ai-agent/permissions.mjs`
- Test: `server/ai-agent/permissions.node-test.mjs`（追加）

**Interfaces:**
- Produces: `noteScopeSql(user, placeholder) → { clause, param }`、`canSeeNote(user, note) → boolean`

```js
/** 沉淀条目的账号隔离条件：owner 本人；占位符规则与 documentScopeSql 一致。 */
export function noteScopeSql(user, placeholder) {
  if (!placeholder || !/^\$\d+$/.test(placeholder)) {
    throw new Error('noteScopeSql 需要一个形如 $1 的占位符')
  }
  return { clause: `n.owner_user_id = ${placeholder}`, param: user?.id ?? -1 }
}

/** 私有沉淀可见性：本人或管理员（管理员仅限管理视图，不参与对话检索）。 */
export function canSeeNote(user, note) {
  if (!isEnabledUser(user)) return false
  if (!note) return false
  if (note.deleted_at) return false
  if (note.owner_user_id === user.id) return true
  return isEnabledAdmin(user)
}
```

- [ ] Step 1 写测试（本人可见 / 他人不可见 / 管理员可见 / 停用账号不可见 / 软删不可见 / 非法占位符抛错）→ Step 2 看失败 → Step 3 实现 → Step 4 看通过。

### Task 5: `distill.mjs`（手动沉淀抽取）

**Files:**
- Create: `server/ai-agent/distill.mjs`
- Test: `server/ai-agent/distill.node-test.mjs`

**Interfaces:**
- Produces:
  - `DistillParseError extends Error`
  - `shouldOfferDistill({ messages }) → boolean`（至少 1 轮 assistant 且 `status === 'ok'` 且内容长度 ≥ 20）
  - `buildDistillMessages({ messages, skill, fields }) → { role, content }[]`
  - `parseDistillResponse(text, fields) → { title, summary, fields }`（容忍 ```json 代码块；非法 JSON 或全空字段抛 `DistillParseError`）
  - `fallbackDraft({ conversation, messages }) → { title, summary, fields, degraded: true }`
  - `resolveDistillModels()`（暂不实现自动触发）

**关键规则:** 会话内容一律包在 `<<<UNTRUSTED_DATA>>> ... <<<END_UNTRUSTED_DATA>>>` 块里（沿用 `prompt.mjs` 的注入防护约定）；提示词明确"只输出 JSON，不要输出解释"；模型返回的字段必须在 `fields` 白名单内，多余键丢弃。

- [ ] Step 1 写测试（≥10 项：`shouldOfferDistill` 四种情形、提示词包含不可信数据块标记、JSON 解析成功 / 带代码块 / 非法 JSON 抛错 / 字段全空抛错 / 白名单过滤、`fallbackDraft` 带 `degraded` 且字段为空且标题带"（待补充）"）→ Step 2 看失败 → Step 3 实现 → Step 4 看通过。

### Task 6: `notes-routes.mjs` + 挂载

**Files:**
- Create: `server/ai-agent/notes-routes.mjs`
- Modify: `server/ai-agent/router.mjs`（`router.use(createNotesRouter({ adminGuard }))`）
- Modify: `server/ai-agent/audit.mjs`（`AUDIT_ACTIONS` 追加 `noteCreate/noteUpdate/noteSubmit/noteReview/noteArchive/noteDelete/noteExport/skillConfig`）

**Interfaces（全部经 `requireUser`，管理类再过 `adminGuard`）:**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/notes` | 我的沉淀列表（status/keyword/tag/page/pageSize） |
| GET | `/notes/:id` | 详情（越权 404） |
| POST | `/notes` | 手工新建（不走模型） |
| POST | `/notes/distill` | 会话抽取草稿预览（**不落库**，配额内才允许） |
| PATCH | `/notes/:id` | 编辑（本人） |
| POST | `/notes/:id/submit` | 提交审核 → pending |
| POST | `/notes/:id/archive` | 归档 |
| DELETE | `/notes/:id` | 软删 |
| GET | `/notes/export` | 导出 `format=csv\|md\|json`（写审计） |
| GET | `/notes/skill` / PUT | 我的知识沉淀技能配置 |
| GET | `/distill/notes` | 管理员：全量列表（userId/status/keyword/from/to/tag） |
| GET | `/distill/notes/:id` | 管理员：详情 |
| PATCH | `/distill/notes/:id` | 管理员：编辑 |
| POST | `/distill/notes/:id/review` | 管理员：通过/驳回（驳回必填原因） |
| POST | `/distill/notes/:id/archive` | 管理员：归档 |
| DELETE | `/distill/notes/:id` | 管理员：软删 |
| GET | `/distill/export` | 管理员：导出（CSV / 合并 Markdown / JSON，写审计） |
| GET | `/distill/stats` | 管理员：总量与按账号统计 |
| GET | `/distill/skills` | 管理员：技能列表 + 各账号启用一览 |
| PATCH | `/distill/skills/:name` | 管理员：全局启停技能 |

**审核通过的动作序列（必须在一个事务语义内顺序执行）:**
1. `transitionNote({ to: 'published' })`
2. `publishNoteDocument({ note })`：`source_ref = 'note:<id>'` 已存在则复用，否则 `ingestDocument({ title, text, sourceType: 'experience', ... })`，并把 `owner_user_id` 落为提报人
3. `recordAudit({ action: 'note_review', ... })`

- [ ] Step 1 先写 e2e 断言（Task 10 的 verify-e2e 新节），Step 2 跑失败，Step 3 实现路由，Step 4 跑通。

### Task 7: 引用面板标注提报人

**Files:**
- Modify: `server/ai-agent/knowledge.mjs`（检索 SQL `LEFT JOIN users owner ON owner.id = d.owner_user_id`，返回 `owner_name`）
- Modify: `server/ai-agent/orchestrator.mjs`（citation 透传 `ownerName`）
- Modify: `src/features/ai-agent/types.ts`、`src/features/ai-agent/components/citation-panel.tsx`
- Test: `node --test server/ai-agent/knowledge.node-test.mjs`（若有纯函数改动）

展示规则：`source_type = 'experience'` 且带 `ownerName` 时显示「员工经验 · 提报人：张三」，与官方文档视觉区分（`Badge` variant 用 `secondary`）。

- [ ] Step 1 改检索 SQL 与序列化 → Step 2 前端展示 → Step 3 `pnpm run build` 与 `verify-e2e` 相关断言通过。

### Task 8: 前端「我的知识沉淀」+ 技能配置卡 + 会话内沉淀入口

**Files:**
- Create: `src/routes/_authenticated/ai-agent/notes.tsx`
- Create: `src/features/ai-agent/pages/note-space.tsx`
- Create: `src/features/ai-agent/components/note-dialogs.tsx`（新建/编辑、详情、沉淀预览、导出）
- Create: `src/features/ai-agent/components/skill-config-card.tsx`
- Modify: `src/features/ai-agent/api/queries.ts`、`types.ts`、`components/agent-nav.tsx`、`pages/chat-workbench.tsx`

约定：页面用 `Header`/`Main` 布局体系、标题 `text-2xl font-bold tracking-tight`、说明 `text-muted-foreground`；表格用 `Table`；下拉用 `Select`；危险操作走 `ConfirmDialog`；正文用 `whitespace-pre-wrap` 渲染（不引入 Markdown 渲染库）。

- [ ] Step 1 路由 + 导航加「我的沉淀」（全员可见）→ Step 2 列表与筛选 → Step 3 技能配置卡（默认关闭、字段多选、保存后 toast）→ Step 4 会话内「沉淀为知识」按钮 + 预览对话框 → Step 5 `pnpm run build`、`pnpm run lint`。

### Task 9: 前端管理员「沉淀管理」

**Files:**
- Create: `src/routes/_authenticated/ai-agent/distill.tsx`（`beforeLoad` 管理员守卫，同 `knowledge.tsx` 写法）
- Create: `src/features/ai-agent/pages/distill-management.tsx`
- Modify: `components/agent-nav.tsx`、`api/queries.ts`、`types.ts`

内容：统计卡（总条数 / 待审核 / 已发布 / 参与账号数）、筛选（账号 / 状态 / 关键词 / 时间范围）、表格（账号 / 标题 / 状态 / 来源 / 标签 / 更新时间 / 操作）、审核对话框（通过 / 驳回 + 原因）、编辑、归档、软删、批量导出（CSV / 合并 Markdown）、技能概览卡（启用账号数 + 全局启停）。

- [ ] Step 1 路由 + 导航（adminOnly）→ Step 2 统计与列表 → Step 3 审核与编辑 → Step 4 导出 → Step 5 build/lint。

### Task 10: 验收

**Files:**
- Modify: `server/ai-agent/verify-e2e.mjs`（新增「沉淀链路」一节）
- Modify: `server/ai-agent/verify-ui.mjs`（新增冒烟）

- [ ] **Step 1: 单测** `pnpm run test:server`（新增 ≥36 项）
- [ ] **Step 2: e2e** `node server/ai-agent/verify-e2e.mjs http://127.0.0.1:8788`，新增断言：
  - 演示模式：抽取走降级草稿（`degraded: true`，字段为空，**不编造内容**）
  - 手工新建 → 本人可见 → 他人（另一账号）访问返回 404
  - 提交审核 → 管理员通过 → 生成 `source_type='experience'` 文档 → 引用面板可带提报人
  - 驳回必须填原因（空原因 400）
  - 导出 CSV 含 BOM 与表头、行数与库内一致；导出写审计
  - 越权：非管理员访问 `/api/ai/distill/notes` 返回 403
- [ ] **Step 3: 真实模型复跑** `node server/ai-agent/verify-e2e.mjs http://127.0.0.1:8788 --live`（交接文档明确要求：与模型相关的链路改动必须在 live 下复跑）
- [ ] **Step 4: UI 冒烟** `node server/ai-agent/verify-ui.mjs http://localhost:5175`
- [ ] **Step 5: 构建与 lint** `pnpm run build`、`pnpm run lint`

### Task 11: 文档

**Files:**
- Modify: `docs/modules/AI 助手.md`（功能清单、API 明细、影响范围、历史变更）
- Modify: `CHANGELOG.md`
- Modify: `交接文档.md`（阶段记录 + 环境备忘 + 踩过的坑）

- [ ] 逐份更新，确保"新会话 5 分钟读懂"。

---

## 明确不做（下一轮）

- **自动沉淀触发**（会话结束自动抽取）：本轮技能配置里保留 `triggerMode=auto` 字段但**不实现调度**，UI 标注"自动触发下一轮上线"。
- **SKILL.md 导入**：`parseSkillFrontmatter`/`renderSkillMarkdown` 本轮先落地并单测覆盖（导出已用得上），导入接口下一轮。
- **沉淀参与对话检索**：本轮私有沉淀只做"沉淀 + 治理 + 导出"，**不进** `search_knowledge`；下一轮在 `knowledge.mjs` 分路召回（独立相关性阈值 + 来源标注「我的知识沉淀」），并重跑 `eval/compare-retrieval.mjs` 重标定。
- **pg_trgm 相似度自动合并**：本轮去重只做"同账号同标题走合并 + 版本号递增"，模糊相似合并下一轮。
- **ZIP 打包导出**：本轮 CSV / 合并 Markdown / JSON，不引依赖。

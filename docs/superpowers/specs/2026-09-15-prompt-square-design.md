# 提示词广场设计规格

## 目标

在 AI 助手使用面新增「提示词广场」，让员工把自己反复使用的提问沉淀成可复用模板，并在对话中通过 `@提示词名称` 或输入框旁的入口快捷调出。

权限口径沿用「我的沉淀」的既有先例：提示词默认个人私有，本人可提报共享，管理员审核通过后全员可用。

## 与技能的关系（边界）

提示词与技能是**两个独立实体**，本规格不合并二者：

- 技能继续走既有 `ai_skills` / `ai_user_skills` 与 SKILL.md frontmatter 格式，由设置中心「技能配置」维护，服务于「沉淀为知识」链路的抽取字段定义。
- 提示词广场只存**纯文本提问模板**，不带变量字段、不参与知识抽取、不注入系统提示词。
- 两者互不引用；提示词广场不读取 `ai_skills`，也不写入。

## 页面结构

- 广场路由：`/_authenticated/ai-agent/prompts`，用户路径 `/ai-agent/prompts`。
- `agent-nav.tsx` 二级导航新增「提示词广场」，与「对话 / 我的 ASIN / 我的沉淀」同级。
- 页面复用 `Header`、`Main` 布局体系与 shadcn/ui 组件；主标题沿用 `text-2xl font-bold tracking-tight`。
- 列表分两个区块：「我的提示词」与「共享提示词」；本人条目显示状态徽标（私有 / 待审 / 已共享 / 已驳回）。
- 搜索框在列表上方，输入即搜（防抖 300ms），走服务端查询。
- 空态区分两种：「还没有提示词」引导新建；「没有匹配的提示词」提示换关键词。

## 对话内调用

- 输入框内键入 `@` 触发浮层；输入框左侧常驻「提示词」按钮，点开同一浮层，保证不使用 `@` 的用户也能发现该能力。
- 浮层分组展示「共享提示词」「我的提示词」，顶部带搜索框。
- 键盘：`↑`/`↓` 移动高亮，`Enter` 确认，`Esc` 关闭；鼠标点击等效。
- 选中后把已输入的 `@关键词` 整段替换为提示词正文，**填入输入框并把光标置末尾，不自动发送**，用户可继续编辑。
- 选中后 `usage_count` 加一，仅作调用次数留痕。
- 加载失败或无可用提示词时，浮层展示提示并要求用户手动继续输入，不阻塞发送。

### Enter 键优先级（关键）

现有输入框的 `Enter` 直接发送。浮层打开期间，`Enter` 必须由浮层优先消费用于确认选中，否则会把半截的 `@` 当作提问发出。关闭浮层后 `Enter` 恢复发送行为。此规则必须有前端测试覆盖。

## 数据模型

### ai_prompts

- `id SERIAL PRIMARY KEY`
- `owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `name VARCHAR(60) NOT NULL`
- `title VARCHAR(120) NOT NULL`
- `body TEXT NOT NULL`
- `summary VARCHAR(300) NOT NULL DEFAULT ''`
- `tags TEXT[] NOT NULL DEFAULT '{}'`
- `status VARCHAR(20) NOT NULL DEFAULT 'private' CHECK (status IN ('private', 'pending', 'published', 'rejected'))`
- `usage_count INTEGER NOT NULL DEFAULT 0`
- `reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL`
- `review_comment TEXT`
- `reviewed_at TIMESTAMPTZ`
- `deleted_at TIMESTAMPTZ`
- `created_at`、`updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

索引：

- `ai_prompts_owner_idx ON ai_prompts(owner_user_id, status, updated_at DESC)`
- `ai_prompts_status_idx ON ai_prompts(status, created_at DESC)`
- `ai_prompts_tags_idx USING GIN(tags)`

### 两层唯一约束

名称唯一按**可见范围**分层，避免"私有占名后他人无法使用同名"与"`@` 调用歧义"互相冲突：

- `CREATE UNIQUE INDEX ai_prompts_owner_name_idx ON ai_prompts(owner_user_id, lower(name)) WHERE deleted_at IS NULL`：个人库内不重名。
- `CREATE UNIQUE INDEX ai_prompts_published_name_idx ON ai_prompts(lower(name)) WHERE status = 'published' AND deleted_at IS NULL`：共享池内全局唯一。

由此保证 `@` 解析无歧义：共享池内名称全局唯一，个人库内名称本人唯一。

提报共享时若共享池已存在同名提示词，返回 409 并要求改名后提报，不静默改名。

审核通过时需重新校验共享池同名：`published` 条目被作者修改后会回到 `pending`，该期间名称已从共享池释放，可能被他人占用。此种情况审核通过返回 409 并提示管理员联系作者改名，不能把唯一索引冲突抛成 500。

## API 契约

挂载在既有 `/api/ai/*` 路由下，全部接口先过 `requireUser` 与 `identityGuard`。

### 员工接口

- `GET /prompts?scope=mine|published|usable&keyword=`：读取提示词列表。`mine` 为本人全部未删除条目；`published` 为共享池；`usable` 为二者合并（浮层用）。关键字走服务端 `ILIKE` 模糊匹配 `name`、`title`、`summary`、`body`。
- `GET /prompts/:id`：读取单条，仅本人或已共享条目可见。
- `POST /prompts`：新建，落 `private`，校验名称在个人库内唯一。
- `PATCH /prompts/:id`：修改本人提示词的名称、标题、正文、摘要、标签；`published` 条目修改后回到 `pending` 重新审核。
- `DELETE /prompts/:id`：软删除本人提示词。
- `POST /prompts/:id/submit`：提报共享，`private`/`rejected` → `pending`。
- `POST /prompts/:id/withdraw`：撤回提报，`pending` → `private`。
- `POST /prompts/:id/use`：调用计数加一。

### 管理员接口

- `GET /distill/prompts?status=pending`：审核队列。
- `POST /distill/prompts/:id/approve`：`pending` → `published`，记录 `reviewed_by`、`reviewed_at`。
- `POST /distill/prompts/:id/reject`：`pending` → `rejected`，记录 `review_comment`（必填）。

### 状态流转

统一由 `transitionPrompt` 实现，非法流转返回 409 而非静默忽略。允许的流转：

| 起点 | 终点 | 动作 | 角色 |
|---|---|---|---|
| private / rejected | pending | 提报 | 本人 |
| pending | private | 撤回提报 | 本人 |
| pending | published | 通过 | 管理员 |
| pending | rejected | 驳回 | 管理员 |
| published | pending | 修改后重审 | 本人 |

### 错误口径

- 参数校验失败 400；不存在或非本人资源 404（不泄露他人资源是否存在）；名称冲突与非法流转 409。
- 所有写入接口去除首尾空白并限制长度：`name` ≤ 60、`title` ≤ 120、`summary` ≤ 300、`body` ≤ 4000。

## 审计

`AUDIT_ACTIONS` 新增 `promptCreate`、`promptUpdate`、`promptSubmit`、`promptReview`、`promptDelete`，分别记录创建、修改、提报、审核（通过与驳回共用，`detail` 区分）、删除。`targetType` 为 `ai_prompt`。

## 视觉规范

- 仅使用项目既有主题变量（`background`、`foreground`、`card`、`muted`、`primary`、`border`、`destructive`），不在业务组件中硬编码颜色。
- 圆角、间距沿用项目 `rounded-*` / `space-*` token；列表用轻边框卡片，避免卡片嵌套卡片。
- 状态徽标复用 `Badge`，不同状态用 `variant` 与主题色区分，不自定义色值。
- 图标使用 `lucide-react`，图标按钮必须有 `aria-label`。
- 浮层使用 `role="listbox"` + `role="option"`，`aria-activedescendant` 跟随高亮项；支持键盘完整操作。
- 暗色模式、键盘焦点环、响应式布局必须完整支持；窄屏下浮层宽度不溢出。

## 测试与验收

- 服务端 Node 测试：个人库重名返回 409；共享池重名提报返回 409；非法状态流转返回 409；非本人资源返回 404；越权审核返回 403；提报与审核写入审计；`usable` 合并结果与关键字过滤正确。
- 前端测试：`@` 触发浮层、关键字过滤、**浮层打开时 `Enter` 不触发发送而确认选中**、选中后插入正文且光标在末尾、无可用提示词时不阻塞输入。
- 手动验证：建私有 → `@` 调出 → 提报 → 管理员通过 → 换普通账号确认共享可见。
- 运行 `pnpm run build`、`pnpm run lint`、`pnpm run test`、`pnpm run test:server`。

## 边界

- 不改动 `chat.mjs` 问答链路：提示词仅把文本填入输入框，服务端不感知提示词存在，`@` 不作为消息内容上送。
- 不做提示词变量 / 参数占位（属技能能力，见「与技能的关系」）。
- 不做提示词排序权重、点赞、收藏、使用排行。
- 不做提示词导入导出。
- 不做多人协作编辑；`published` 条目仅作者可改，改后重新审核。
- 不新增角色，不引入细粒度权限。

## 追加（2026-09-15）：一级类目与 AI 优化提示词

用户口径：「提示词广场属于一级类目，且用户输入后可选择优化提示词，点击优化提示词按钮 ai 会优化提示词」。四个关键点经用户逐项确认后落地。

### 导航层级调整

- 侧边栏「常用」组新增**一级项**「提示词广场」（`src/components/layout/data/sidebar-data.ts`），`agent-nav.tsx` 的模块内二级导航**保留**。两个入口并存是**有意为之**：侧边栏解决"这个功能在哪"，顶栏解决"模块内切换不用回侧边栏"。
- 页面路由不变（`/ai-agent/prompts`）。高亮不冲突：侧边栏该项按精确路径点亮，**未开启 `matchPrefix`**，不会连带激活「AI 助手」折叠项（符合"入口页在子页高亮只用显式字段"的既定口径）。

### AI 优化提示词

- 入口：编辑弹窗（新建 / 编辑两用）正文框右上角常驻「优化提示词」按钮；正文 trim 后不足 4 字符时禁用（不白烧一次模型调用）。
- 契约：`POST /api/ai/prompts/optimize`，body `{ body, name?, title? }` → `{ body, truncated, model, demo }`。
- **只优化正文**：名称牵扯两层唯一性（交给模型只会凭空制造 409），标题 / 说明 / 标签是给人看的元信息，都留给人写。
- **不落库、不改状态、不写审计**：返回的只是建议 —— 没有公司资产被改变；采用后仍走 `PATCH /prompts/:id` 才留痕。
- 交互：结果以「原文 / 优化后」两栏对比呈现；点「采用优化结果」才替换正文（采用后仍可「撤销采用」；若采用后又手动改正文，撤销入口消失，免得把新改动一并吞掉）；点「放弃」关闭对比区。采用只改输入框内容，**仍需点「保存 / 创建」才写库**。
- 安全：草稿与名称 / 标题包进 `<prompt-draft>` 数据块，块内试图闭合数据块的标签被转义 —— 草稿里的"忽略以上指令"是**待改写的文本**，不是给模型的指令；模型报错经 `sanitizeModelError` 抹掉 `sk-` 片段并限长后回传；结果超 4000 字按上限截断并置 `truncated`（前端必须在对比区提示，不静默丢内容）。
- 输出清洗 `extractOptimizedBody`：逐层剥掉模型输出的信封（代码块围栏 / "优化后："套话 / 整段引号 / 三个以上连续空行），但**不误删"任务："这类真结构行**；剥不掉的解释性文字不做猜测性裁剪。
- 失败口径：400 = 正文空 / 过短 / **演示模式未接入云模型**；502 = 模型调用失败或输出不可用。**失败不编造** —— 绝不把原文或半成品当优化结果返回；演示模式下前端禁用按钮并说明原因，服务端同样明确拒绝。

### 测试与验收

- 服务端单测 `server/ai-agent/prompt-optimize.node-test.mjs` 16 项；前端集成测试 `src/features/ai-agent/prompt-optimize.test.tsx` 5 项；接口验收 `verify-prompts.mjs` [9] 段 6 项；UI 端到端 `verify-prompt-optimize-ui.mjs` 17 项（系统 Chrome + 真实模型）。

## 追加（2026-09-15，同日）：标题字段下线

用户口径：「名称和标题只保留名称即可」。

- **动因**：一条提示词的名称与标题在列表里是上下两行、说的是同一件事，用户要填两遍、还得自己造差别。
- **不做数据库结构变更**：`ai_prompts.title` 列与历史值**保留**（改结构属危险操作，历史数据也没有删除的理由），只是不再被接口返回、不再被前端读写。
- 服务端：`serializePrompt` 不再返回 `title`；`normalizePromptInput` 的 title 改为**可选**（`optionalTitle`：缺省空串，仍校验长度以兼容仍在传该字段的旧调用方）；已无生产使用点的 `requiredText` 随之下线。
- 前端：删掉标题输入框与「请填写标题」校验；列表页、审核卡片删掉标题展示行；`@` 面板副行改显示**说明**（写的是"什么时候用"，信息量比标题大）；`AiPrompt.title` / `PromptInput.title` / 优化入参中的 title 一并移除。
- 编辑弹窗最终只剩四项：名称 / 提示词正文 / 说明（可选）/ 标签（可选）。

## 追加（2026-09-15，同日）：提示词广场自己的顶部子页

用户口径：「优化提示词广场页面 提示词广场没有顶部子页面」→ 经选项确认，要的是**属于它自己的子页**。

- **页面结构**：顶栏中段不再挂 AI 助手模块导航（对话 / 我的 ASIN / 我的沉淀），改为两个子页 **「我的提示词 ｜ 共享提示词」**（`components/prompt-square-nav.tsx`，与 `admin-ai-nav.tsx` 同构）。模块 layout 按路径分流：`/ai-agent/prompts` 用页面自己的导航，其余子页仍是 `AgentNav`。
- **子页与路由**：两个子页**共用同一路由** `/ai-agent/prompts`，用 search 参数 `view` 表达（`?view=shared`）。`validateSearch` 只认 `view=shared`，其余值回落默认页；默认页 URL 不带参数，与侧边栏一级项链接天然一致。拆成两个路由要动路由树（`prompts.tsx` 拆成目录），而它们只是同一份列表的两种取数范围，收益不抵成本。
- **渲染与取数**：页面按 `view` **只渲染当前子页**，并按子页 `enabled` **只拉那一份数据**（原先两个 `usePrompts` 恒发两次请求）；搜索词在子页间保留，便于对比着找；两块各自的 h2 去掉（位置已由顶栏导航表达），各留一行说明。
- **页面名**：该路由声明 `staticData: { title: '提示词广场' }` —— 子页默认继承模块级标题「AI 助手」，而它已是侧边栏一级类目、顶栏又是自己的子页导航，标题再写「AI 助手」就自相矛盾。
- **取舍**：该页不再有一键跳去「对话 / 我的沉淀」的入口，走侧边栏即可 —— 一级类目本就不该挂在别人的二级导航下。
- **验收**：UI 端到端 `verify-prompt-optimize-ui.mjs` 18 → **27/27**（新增 9 项覆盖顶栏子页、页面名、URL 参数与内容同步）。

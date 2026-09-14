# 知识沉淀 MVP 加固开发文档

> **给执行 agent：** 本文是对现有 M-C 知识沉淀实现的加固计划，不是从零开发方案。执行前必须阅读 `docs/modules/AI 助手.md`、本文件和相关源码；按 Task 顺序实施，每个 Task 完成后运行对应验证命令。除非用户另行要求，不提交、不 push、不修改无关模块。

## 1. 目标

在不推翻现有知识沉淀 MVP 的前提下，修复权限、可信度、审核一致性和筛选能力上的缺口，使以下不变式在服务端成立：

1. 未经管理员审核通过的沉淀不会进入公共知识库，也不会被任何问答检索到。
2. 员工只能操作自己的沉淀；管理员只能通过管理接口查看和管理他人沉淀，不能通过员工接口代员工提交审核。
3. AI 整理内容必须明确标为模型推断；原文依据必须能在会话中找到。
4. 审核通过要么完整生成并关联公共知识库文档，要么保持待审核并可重试，不能出现“已发布但没有文档”。
5. 已发布内容不可被同标题合并直接覆盖；新版本必须重新经过审核。
6. 待审核内容在审核期间不能被员工悄悄修改。

## 2. 当前基线

现有实现已经包含：

- `ai_knowledge_notes` 个人沉淀表和 `owner_user_id` 隔离；
- `private / pending / published / rejected / archived` 状态机；
- 手工新建、会话 AI 整理、失败降级、标签、导出和审计；
- `/api/ai/notes/*` 员工接口和 `/api/ai/distill/*` 管理员接口；
- 审核通过后生成 `ai_documents.source_type = 'experience'` 文档；
- 账号级技能配置，默认关闭，手动触发，每日配额；
- 现有服务端 275 项测试、`pnpm run lint`、`pnpm run build` 可通过。

相关入口：

- 服务端领域层：`server/ai-agent/notes.mjs`
- 服务端接口：`server/ai-agent/notes-routes.mjs`
- 权限：`server/ai-agent/permissions.mjs`
- 抽取：`server/ai-agent/distill.mjs`
- 技能契约：`server/ai-agent/skill-contracts.mjs`
- 员工页面：`src/features/ai-agent/pages/note-space.tsx`
- 管理页面：`src/features/ai-agent/pages/distill-management.tsx`
- 对话入口：`src/features/ai-agent/components/distill-button.tsx`

## 3. 必须先修复的问题

### 3.1 员工接口的所有权边界不完整

`canSeeNote` 允许管理员看到任意沉淀，这是管理页需要的；但员工接口复用了同一逻辑。当前管理员可以通过 `/api/ai/notes/:id` 访问他人条目，且 `/api/ai/notes/:id/submit` 固定传 `isAdmin: false`，状态机没有再次验证当前用户是否为 owner。

涉及文件：

- `server/ai-agent/permissions.mjs`
- `server/ai-agent/notes.mjs`
- `server/ai-agent/notes-routes.mjs`

要求：

- 员工侧 GET/PATCH/submit/archive/delete 使用 owner-only 查询；
- 管理员查看他人条目只能走 `/api/ai/distill/*`；
- `private -> pending` 必须同时满足 `note.ownerUserId === req.user.id` 且调用方不是管理员代办；
- 管理员通过员工接口访问他人条目时，统一按不存在处理或返回明确禁止，不能改变条目状态；
- 管理员管理页仍可正常查看、编辑、审核、归档和软删。

推荐增加明确的领域函数，而不是在路由中散落角色判断：

```text
getOwnedNote({ id, user })
getAdminNote({ id, user })
assertOwnerAction({ note, user, action })
```

不要删除管理视图需要的管理员可见能力；要把“可见”与“可操作”分开。

### 3.2 provenance 必须由服务端确定

当前会话 AI 整理成功后，前端会把条目默认标成 `user_stated`，只有降级草稿才标成 `inferred`。这会让审核人误以为模型整理内容是员工本人逐字填写。

要求：

- `source_kind = conversation` 的新条目默认 `provenance = inferred`；
- `source_kind = manual` 的新条目默认 `provenance = user_stated`；
- 员工请求体中的 `provenance` 不能覆盖服务端推导结果；
- 编辑 AI 条目时保持 `inferred`，除非未来增加明确的“本人已核对”动作；
- 管理员审核页、列表、导出和公共知识引用统一使用服务端值。

### 3.3 原文依据必须经过服务端验证

模型提示词要求 `evidence` 是会话原文，但目前解析后没有验证它是否真的存在于会话。

要求：

- 新增纯函数 `isEvidenceFromConversation(evidence, messages)`；
- 允许去掉成对的中英文引号、统一换行和首尾空白后再做匹配；
- 规范化后的 evidence 必须是某条 user/assistant 消息的真实子串；
- 匹配失败时 evidence 置空，并将草稿标记为 `degraded` 或返回“原文依据待补充”；
- 不要用模糊相似度代替逐字验证；
- 增加测试覆盖模型捏造引用、引号包裹引用、跨行引用和空引用。

### 3.4 审核通过必须具备一致性和并发保护

当前审核流程先把 note 改成 `published`，再生成文档。文档生成失败会留下“已发布但没有文档”的坏状态；并发审核还可能重复生成 `source_ref = note:<id>` 文档。

要求：

- 审核请求锁定 note 行，并要求当前状态仍为 `pending`；
- 同一个 note 只有一个审核请求能成功；重复审核返回可识别的冲突错误；
- 审核通过时，状态更新、文档生成、`published_document_id` 关联处在同一事务语义中；
- 任一步失败都保持 `pending`，允许重新审核；
- 为 experience 文档增加 `source_ref` 唯一约束或等价的并发幂等保护；
- 保留现有幂等语义：重试不会创建第二份公共文档。

实现时优先扩展 `ingestDocument`，使其可以复用外部事务 client；不要在审核路由里拼接第二套文档写入逻辑。若审计也要纳入同一事务，为 `recordAudit` 增加可选 DB client 参数。

迁移前先只读检查已有 experience 文档的 `source_ref` 重复情况；如果存在重复，不要自动删除数据，先让迁移失败并给出明确修复提示。

### 3.5 已发布条目不能被同标题合并覆盖

当前 `createNote` 同标题会直接进入 `mergeIntoNote`，可能更新已发布 note，但公共知识库文档仍保持旧内容。

要求：

- `published` note 不允许原地 merge；
- 同标题再次沉淀时创建新的私有修订条目，旧的已发布条目和公共文档保持不变；
- 新修订必须从 `private` 开始，重新提交审核；
- 使用已有 `merged_from` 或新增明确的父版本字段保存关联；
- 调整唯一索引，使归档后的历史版本可以与新的私有修订共存；
- 前端明确展示“这是新修订，需重新审核”。

推荐的最小实现：已发布旧版本转为历史归档，保留其公共文档；新建同标题 `private` 修订并记录旧 note id。不得删除旧公共文档，不得在新修订未审核前更新公共文档。

### 3.6 待审核期间禁止员工修改内容

当前员工页面只禁用了 `published` 的编辑，`pending` 仍可编辑，且编辑后仍保持 `pending`。

要求：

- 员工不能直接编辑 `pending`；服务端返回 409 或业务错误；
- 员工修改 `rejected` 后可保持 rejected 并重新提交，或按产品约定自动回到 private，二者必须统一；
- 员工不能直接编辑 `published`；
- 管理员编辑待审核条目必须写审计；
- 若未来允许编辑 pending，编辑必须生成新修订或自动退回 private，不能静默改变正在审核的内容。

## 4. 次要优化

### 4.1 管理员时间筛选

后端已经支持 `from/to`，但管理员页面没有日期控件，查询和导出也没有传递时间参数。

要求：

- 管理员页面增加开始日期、结束日期；
- 列表和导出使用完全相同的筛选对象；
- 服务端校验开始日期不晚于结束日期，并限制最大范围；
- 审计 detail 记录完整筛选条件，而不只记录账号和状态。

涉及：

- `src/features/ai-agent/pages/distill-management.tsx`
- `src/features/ai-agent/api/queries.ts`
- `server/ai-agent/notes-routes.mjs`

### 4.2 关键词搜索结构化字段

当前关键词只搜索标题、概述和原文依据，不搜索六个结构化字段。至少应让管理员和员工搜索到字段正文；实现可先使用 `fields::text ILIKE`，数据量增大后再评估 JSONB/全文索引。

涉及：`server/ai-agent/notes.mjs`。

### 4.3 配额并发保护

当前先查询今日使用次数，再调用模型，两个并发请求可能同时通过检查。建议增加数据库级计数/锁定或短事务预占逻辑，确保每日配额是真上限。

## 5. 推荐任务拆分

### Task 0：准备与基线

- 阅读 `docs/modules/AI 助手.md`、本文件和所有相关源码；
- 运行：

```bash
pnpm run test:server
pnpm run lint
pnpm run build
```

- 不修改现有已通过的无关测试；
- 记录当前测试数量和构建结果。

### Task 1：权限和路由隔离

修改：

- `server/ai-agent/permissions.mjs`
- `server/ai-agent/notes.mjs`
- `server/ai-agent/notes-routes.mjs`
- `server/ai-agent/permissions.node-test.mjs`
- 新增或扩展接口级测试文件

验收：

- operator A 访问 operator B 的 `/api/ai/notes/:id` 返回 404；
- admin 通过 `/api/ai/distill/notes/:id` 可以管理 B；
- admin 通过 `/api/ai/notes/:id/submit` 不能代 B 提交；
- B 仍可自己提交；
- 账号停用后所有 note API 均不可用。

### Task 2：可信度和证据校验

修改：

- `server/ai-agent/distill.mjs`
- `server/ai-agent/notes.mjs`
- `server/ai-agent/notes-routes.mjs`
- `src/features/ai-agent/components/note-dialogs.tsx`
- `server/ai-agent/distill.node-test.mjs`
- `server/ai-agent/notes.node-test.mjs`

验收：

- AI 成功整理条目显示“模型推断”；
- 手工新建显示“本人所写”；
- 客户端伪造 provenance 不生效；
- evidence 不在会话中时不能作为可信原文保存；
- 降级草稿仍保留原文，不生成缺失字段。

### Task 3：审核事务、幂等和版本修订

修改：

- `server/ai-agent/migrations.mjs`
- `server/ai-agent/knowledge.mjs`
- `server/ai-agent/notes.mjs`
- `server/ai-agent/notes-routes.mjs`
- `server/ai-agent/audit.mjs`（如需传事务 client）
- 新增审核并发/失败测试

验收：

- 文档生成失败后 note 仍为 pending；
- 重试成功后只有一份 `source_ref = note:<id>` 文档；
- 两个并发 approve 只有一个成功；
- 已发布条目同标题再次沉淀生成新私有修订，不改变旧公共文档；
- 发布、关联文档和状态可一致回读。

### Task 4：待审核编辑规则

修改：

- `server/ai-agent/notes.mjs`
- `server/ai-agent/notes-routes.mjs`
- `src/features/ai-agent/pages/note-space.tsx`
- `src/features/ai-agent/components/note-dialogs.tsx`

验收：

- pending 员工条目不显示可用编辑按钮；
- 直接调用 PATCH 也被服务端拒绝；
- rejected 条目可修改后重新提交；
- 管理员编辑动作写审计。

### Task 5：管理员筛选和搜索

修改：

- `src/features/ai-agent/pages/distill-management.tsx`
- `src/features/ai-agent/api/queries.ts`
- `server/ai-agent/notes.mjs`
- `server/ai-agent/notes-routes.mjs`

验收：

- 账号、状态、关键词、时间范围同时作用于列表；
- 导出与列表使用同一组筛选参数；
- 关键词能命中六个结构化字段；
- 审计记录导出范围和条数。

### Task 6：配额并发保护

修改：

- `server/ai-agent/notes.mjs`
- `server/ai-agent/notes-routes.mjs`
- 相关服务端测试

验收：

- 配额为 1 时并发触发两次，最多一次真正调用模型；
- 配额为 0 仍表示不限制；
- 手工新建不消耗配额；
- 模型调用失败也按产品约定计数并写审计。

## 6. 测试最低要求

除现有纯函数测试外，必须新增至少一组真实路由/服务端集成验证，覆盖：

1. 两个 operator 账号的 note 隔离；
2. admin 管理接口可见、员工接口不可代提交；
3. private 不进入 `ai_documents` 和问答检索；
4. reject 必须有原因；
5. approve 生成 experience 文档并显示提报人；
6. approve 失败可重试且不会留下 published 无文档；
7. 同标题合并的 private/rejected 行为；
8. published 同标题生成新修订；
9. evidence 真实性校验；
10. provenance 服务端归因；
11. pending 编辑被阻止；
12. 导出筛选和审计内容一致。

建议扩展 `server/ai-agent/verify-e2e.mjs`，不要只依赖 `node --test` 的纯函数断言。真实模型验收仍应保留，但必须把权限和状态机断言放在模型之外，避免模型输出波动影响结果。

## 7. 完成验收命令

```bash
pnpm run test:server
pnpm run test
pnpm run lint
pnpm run build
```

若修改了数据库迁移或接口流程，还要在本地开发数据库执行对应 e2e 验收，并确认：

- `private`、`pending`、`rejected`、`archived` 条目没有公共文档；
- `published` 条目恰好关联一个 active experience 文档；
- 普通问答检索结果不会出现未审核条目；
- 审计台能回溯创建、整理、编辑、提交、审核、导出和删除动作。

## 8. 责任田与交付要求

完成代码后同步更新：

- `docs/modules/AI 助手.md`：补充本次加固的接口、状态机、权限边界、迁移和历史变更；
- 如新增数据库字段或索引，写清迁移版本和回滚/恢复方式；
- 如改变公共 API，更新 API 明细和前端 hook 类型；
- 最终回复列出修改文件、验证命令、测试结果和未完成风险。

禁止：

- 直接修改已应用迁移；新增迁移必须使用未占用版本号；
- 用前端按钮禁用替代服务端权限控制；
- 用模型提示词替代 evidence 的服务端校验；
- 删除旧数据或旧公共文档来“修复”版本问题；
- 引入无关依赖、重构其他业务模块或使用 `console`。

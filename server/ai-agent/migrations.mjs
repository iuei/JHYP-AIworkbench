/**
 * AI 助手模块建表迁移。
 *
 * 版本号从 100 起：`schema_migrations.version = 1` 已被快捷导航迁移占用
 * （见 server/navigation-migrations.mjs），若复用小号会被静默跳过。
 *
 * 沿用 navigation-migrations.mjs 的迁移模式：单表 schema_migrations + 事务 + EXCLUSIVE 锁。
 */
import { BUILTIN_SKILLS, DEFAULT_SKILL_POLICY } from './skill-contracts.mjs'
import { TOOL_CONTRACTS } from './tool-contracts.mjs'

export const AI_AGENT_MIGRATION_BASE_VERSION = 100

export const defaultAiSettings = {
  modelProvider: 'openai-compatible',
  modelName: 'deepseek-chat',
  modelBaseUrl: 'https://api.deepseek.com/v1',
  temperature: 0.2,
  maxOutputTokens: 2048,
  maxTurnsPerConversation: 20,
  retrievalTopK: 5,
  requestTimeoutMs: 60000,
}

async function createAiAgentSchema(client) {
  // pgvector 用于二期语义检索（本轮不写入向量），pg_trgm 用于本轮关键词兜底检索。
  await client.query('CREATE EXTENSION IF NOT EXISTS vector')
  await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm')
  await client.query(`
    CREATE TABLE IF NOT EXISTS ai_tools (
      id SERIAL PRIMARY KEY,
      name VARCHAR(80) UNIQUE NOT NULL,
      description TEXT NOT NULL,
      params_schema JSONB NOT NULL DEFAULT '{}',
      required_role VARCHAR(20) NOT NULL CHECK (required_role IN ('user', 'admin')),
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(200) NOT NULL DEFAULT '新会话',
      message_count INTEGER NOT NULL DEFAULT 0,
      pinned BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_message_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS ai_conversations_user_idx
      ON ai_conversations(user_id, last_message_at DESC NULLS LAST, id DESC);

    CREATE TABLE IF NOT EXISTS ai_messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      provider VARCHAR(40),
      model VARCHAR(80),
      tokens_in INTEGER,
      tokens_out INTEGER,
      latency_ms INTEGER,
      status VARCHAR(20) NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'blocked', 'error')),
      citations JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx
      ON ai_messages(conversation_id, id);

    CREATE TABLE IF NOT EXISTS ai_runs (
      id SERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tool_name VARCHAR(80) NOT NULL,
      params JSONB NOT NULL DEFAULT '{}',
      result_summary TEXT,
      row_count INTEGER,
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'ok', 'blocked', 'error')),
      error TEXT,
      latency_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ai_runs_user_idx ON ai_runs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS ai_runs_tool_idx ON ai_runs(tool_name, created_at DESC);
    CREATE INDEX IF NOT EXISTS ai_runs_status_idx ON ai_runs(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS ai_documents (
      id SERIAL PRIMARY KEY,
      title VARCHAR(300) NOT NULL,
      source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('feishu', 'upload', 'experience')),
      source_ref TEXT,
      doc_version INTEGER NOT NULL DEFAULT 1,
      category VARCHAR(60),
      status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      effective_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      -- 行级权限预留字段：本轮恒为 '{}'；二期接入飞书部门后由 permissions.mjs 解释
      data_scope JSONB NOT NULL DEFAULT '{}',
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ai_documents_status_idx ON ai_documents(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS ai_documents_source_idx ON ai_documents(source_type, status);

    CREATE TABLE IF NOT EXISTS ai_chunks (
      id SERIAL PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES ai_documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER,
      -- 维度锁定 1024：本期不写入，启用 embedding 时不可随意更换维度
      embedding vector(1024),
      search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (document_id, chunk_index)
    );
    CREATE INDEX IF NOT EXISTS ai_chunks_document_idx ON ai_chunks(document_id, chunk_index);
    CREATE INDEX IF NOT EXISTS ai_chunks_search_idx ON ai_chunks USING GIN (search_vector);
    CREATE INDEX IF NOT EXISTS ai_chunks_trgm_idx ON ai_chunks USING GIN (content gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS ai_chunks_embedding_idx
      ON ai_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

    CREATE TABLE IF NOT EXISTS ai_experiences (
      id SERIAL PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      scenario TEXT NOT NULL,
      background TEXT NOT NULL,
      approach TEXT NOT NULL,
      result TEXT NOT NULL,
      pitfalls TEXT NOT NULL,
      applicability TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
      submitted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      review_comment TEXT,
      reviewed_at TIMESTAMPTZ,
      document_id INTEGER REFERENCES ai_documents(id) ON DELETE SET NULL,
      data_scope JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ai_experiences_status_idx
      ON ai_experiences(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS ai_datasources (
      id SERIAL PRIMARY KEY,
      name VARCHAR(80) UNIQUE NOT NULL,
      type VARCHAR(20) NOT NULL CHECK (type IN ('erp', 'excel')),
      config JSONB NOT NULL DEFAULT '{}',
      status VARCHAR(20) NOT NULL DEFAULT 'unknown',
      last_check_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ai_imports (
      id SERIAL PRIMARY KEY,
      dataset VARCHAR(40) NOT NULL,
      file_name VARCHAR(300) NOT NULL,
      mode VARCHAR(20) NOT NULL CHECK (mode IN ('overwrite', 'append')),
      period_start DATE,
      period_end DATE,
      row_count INTEGER NOT NULL DEFAULT 0,
      failed_rows INTEGER NOT NULL DEFAULT 0,
      fail_reason TEXT,
      status VARCHAR(20) NOT NULL CHECK (status IN ('ok', 'failed')),
      imported_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ai_imports_dataset_idx
      ON ai_imports(dataset, imported_at DESC);

    CREATE TABLE IF NOT EXISTS amazon_ads_daily (
      id SERIAL PRIMARY KEY,
      stat_date DATE NOT NULL,
      asin VARCHAR(40) NOT NULL,
      campaign VARCHAR(200) NOT NULL DEFAULT '',
      marketplace VARCHAR(10) NOT NULL DEFAULT 'US',
      impressions INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      spend NUMERIC(14, 2) NOT NULL DEFAULT 0,
      orders INTEGER NOT NULL DEFAULT 0,
      sales NUMERIC(14, 2) NOT NULL DEFAULT 0,
      acos NUMERIC(8, 4),
      import_id INTEGER REFERENCES ai_imports(id) ON DELETE SET NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (stat_date, asin, campaign, marketplace)
    );
    CREATE INDEX IF NOT EXISTS amazon_ads_daily_asin_idx
      ON amazon_ads_daily(asin, marketplace, stat_date DESC);

    CREATE TABLE IF NOT EXISTS amazon_sales_daily (
      id SERIAL PRIMARY KEY,
      stat_date DATE NOT NULL,
      asin VARCHAR(40) NOT NULL,
      marketplace VARCHAR(10) NOT NULL DEFAULT 'US',
      units INTEGER NOT NULL DEFAULT 0,
      sales NUMERIC(14, 2) NOT NULL DEFAULT 0,
      returns INTEGER NOT NULL DEFAULT 0,
      import_id INTEGER REFERENCES ai_imports(id) ON DELETE SET NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (stat_date, asin, marketplace)
    );
    CREATE INDEX IF NOT EXISTS amazon_sales_daily_asin_idx
      ON amazon_sales_daily(asin, marketplace, stat_date DESC);

    CREATE TABLE IF NOT EXISTS inventory_snapshot (
      id SERIAL PRIMARY KEY,
      sku VARCHAR(80) NOT NULL,
      warehouse VARCHAR(80) NOT NULL DEFAULT '',
      available INTEGER NOT NULL DEFAULT 0,
      in_transit INTEGER NOT NULL DEFAULT 0,
      reserved INTEGER NOT NULL DEFAULT 0,
      snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      import_id INTEGER REFERENCES ai_imports(id) ON DELETE SET NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (sku, warehouse)
    );
    CREATE INDEX IF NOT EXISTS inventory_snapshot_sku_idx
      ON inventory_snapshot(sku);

    CREATE TABLE IF NOT EXISTS order_snapshot (
      id SERIAL PRIMARY KEY,
      order_no VARCHAR(80) NOT NULL,
      sku VARCHAR(80) NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      status VARCHAR(40) NOT NULL DEFAULT '',
      ordered_at TIMESTAMPTZ,
      import_id INTEGER REFERENCES ai_imports(id) ON DELETE SET NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (order_no, sku)
    );
    CREATE INDEX IF NOT EXISTS order_snapshot_sku_idx ON order_snapshot(sku);

    CREATE TABLE IF NOT EXISTS ai_feedback (
      id SERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES ai_messages(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(20) NOT NULL CHECK (type IN ('helpful', 'unhelpful', 'correction')),
      comment TEXT,
      handled BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ai_feedback_handled_idx
      ON ai_feedback(handled, created_at DESC);

    CREATE TABLE IF NOT EXISTS ai_audit_logs (
      id SERIAL PRIMARY KEY,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(60) NOT NULL,
      target_type VARCHAR(40),
      target_id VARCHAR(80),
      detail JSONB NOT NULL DEFAULT '{}',
      ip VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ai_audit_logs_actor_idx
      ON ai_audit_logs(actor_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS ai_audit_logs_action_idx
      ON ai_audit_logs(action, created_at DESC);

    CREATE TABLE IF NOT EXISTS ai_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      model_provider VARCHAR(40) NOT NULL DEFAULT 'openai-compatible',
      model_name VARCHAR(80) NOT NULL DEFAULT 'deepseek-chat',
      temperature NUMERIC(3, 2) NOT NULL DEFAULT 0.20,
      max_output_tokens INTEGER NOT NULL DEFAULT 2048,
      max_turns_per_conversation INTEGER NOT NULL DEFAULT 20,
      retrieval_top_k INTEGER NOT NULL DEFAULT 5,
      request_timeout_ms INTEGER NOT NULL DEFAULT 60000,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `)
}

async function seedAiToolsAndSettings(client) {
  for (const tool of TOOL_CONTRACTS) {
    await client.query(
      `INSERT INTO ai_tools (name, description, params_schema, required_role, enabled)
       VALUES ($1, $2, $3::jsonb, $4, true)
       ON CONFLICT (name) DO UPDATE
         SET description = EXCLUDED.description,
             params_schema = EXCLUDED.params_schema,
             required_role = EXCLUDED.required_role,
             updated_at = NOW()`,
      [tool.name, tool.description, JSON.stringify(tool.paramsSchema), tool.requiredRole]
    )
  }

  await client.query(
    `INSERT INTO ai_settings (
       id, model_provider, model_name, temperature, max_output_tokens,
       max_turns_per_conversation, retrieval_top_k, request_timeout_ms
     )
     VALUES (1, $1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO NOTHING`,
    [
      defaultAiSettings.modelProvider,
      defaultAiSettings.modelName,
      defaultAiSettings.temperature,
      defaultAiSettings.maxOutputTokens,
      defaultAiSettings.maxTurnsPerConversation,
      defaultAiSettings.retrievalTopK,
      defaultAiSettings.requestTimeoutMs,
    ]
  )
}

/**
 * 后台可配置模型密钥（需求文档 §8.3 的受控偏离）。
 *
 * 只增列，不改既有列；密钥以 AES-256-GCM 密文存储（见 secrets.mjs），
 * 并单独保存掩码与指纹，分别用于前端展示与审计比对——两者都不可反推明文。
 */
async function addModelCredentialsToSettings(client) {
  await client.query(`
    ALTER TABLE ai_settings
      ADD COLUMN IF NOT EXISTS model_base_url VARCHAR(300) NOT NULL DEFAULT 'https://api.deepseek.com/v1',
      ADD COLUMN IF NOT EXISTS model_api_key_cipher TEXT,
      ADD COLUMN IF NOT EXISTS model_api_key_hint VARCHAR(60),
      ADD COLUMN IF NOT EXISTS model_api_key_fingerprint VARCHAR(64),
      ADD COLUMN IF NOT EXISTS model_api_key_updated_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS force_demo BOOLEAN NOT NULL DEFAULT false
  `)
}

/**
 * 账号级知识沉淀（M-C）：技能定义 + 账号级技能配置 + 沉淀条目。
 *
 * 为什么另起一套表而不是复用 ai_experiences：
 *   ai_experiences 是「提报表单」的单表形态（一条经验就是一次提报），
 *   而沉淀需要版本、合并、软删、状态机与账号隔离查询，字段也更多；
 *   ai_experiences 本轮保持不动（历史数据 0 行），避免破坏既有结构与后续兼容。
 *
 * ai_documents.owner_user_id = 提报人归属（experience 类文档在引用面板要显示提报人），
 * 与既有 created_by（操作人）语义区分：审核通过时 created_by 是审核管理员，owner_user_id 是提报员工。
 */
async function createKnowledgeDistillSchema(client) {
  await client.query(`
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
      trigger_mode VARCHAR(20) NOT NULL DEFAULT 'manual'
        CHECK (trigger_mode IN ('manual', 'auto', 'both')),
      default_visibility VARCHAR(20) NOT NULL DEFAULT 'private'
        CHECK (default_visibility IN ('private', 'review')),
      daily_quota INTEGER NOT NULL DEFAULT 20,
      config JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, skill_id)
    );
    CREATE INDEX IF NOT EXISTS ai_user_skills_user_idx ON ai_user_skills(user_id);

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
      -- 抽取失败降级为原文草稿时置 true：界面上要提示「字段待补充」，不能让人误以为是模型整理的
      degraded BOOLEAN NOT NULL DEFAULT FALSE,
      published_document_id INTEGER REFERENCES ai_documents(id) ON DELETE SET NULL,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      review_comment TEXT,
      reviewed_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ai_notes_owner_idx
      ON ai_knowledge_notes(owner_user_id, status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS ai_notes_status_idx
      ON ai_knowledge_notes(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS ai_notes_tags_idx ON ai_knowledge_notes USING GIN(tags);
    CREATE INDEX IF NOT EXISTS ai_notes_conversation_idx ON ai_knowledge_notes(conversation_id);
    -- 同账号同标题（忽略大小写）视为同一条沉淀：本轮的去重合并规则，靠唯一索引兜底并发写入
    CREATE UNIQUE INDEX IF NOT EXISTS ai_notes_owner_title_uidx
      ON ai_knowledge_notes(owner_user_id, lower(title))
      WHERE deleted_at IS NULL;

    ALTER TABLE ai_documents
      ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
  `)
}

/**
 * 技能种子必须独立成一个迁移：契约（名称/字段/正文）变更后要重放才会生效，
 * 已应用的迁移不会重跑——与 reseed_data_query_tools 同理。
 */
async function seedKnowledgeDistillSkills(client) {
  for (const skill of BUILTIN_SKILLS) {
    await client.query(
      `INSERT INTO ai_skills (name, display_name, description, version, source, body, field_schema, triggers)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
       ON CONFLICT (name) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             description = EXCLUDED.description,
             version = EXCLUDED.version,
             body = EXCLUDED.body,
             field_schema = EXCLUDED.field_schema,
             triggers = EXCLUDED.triggers,
             updated_at = NOW()`,
      [
        skill.name,
        skill.displayName,
        skill.description,
        skill.version,
        skill.source,
        skill.body,
        JSON.stringify(skill.fieldSchema),
        JSON.stringify(skill.triggers),
      ]
    )
  }
}

/**
 * 沉淀可信度字段：provenance（本人所写 / 模型推断）+ evidence（原文引句）。
 *
 * 为什么单独补一个迁移而不改 106：106 已经应用过，迁移器以版本号为唯一键、不会重跑，
 * 改 106 只会让「已装库」与「全新装库」结构不一致。
 *
 * 设计依据（借鉴行业实践）：
 *   provenance 比模型自评的 confidence 更能预测可靠性 —— 审核人要先知道
 *   「这条是员工自己写的，还是模型从会话里推断出来的」；
 *   evidence 是逐字引句，让审核人一眼可判，而不是通读整个会话。
 */
async function addNoteProvenanceAndEvidence(client) {
  await client.query(`
    ALTER TABLE ai_knowledge_notes
      ADD COLUMN IF NOT EXISTS provenance VARCHAR(20) NOT NULL DEFAULT 'user_stated'
        CHECK (provenance IN ('user_stated', 'inferred')),
      ADD COLUMN IF NOT EXISTS evidence TEXT NOT NULL DEFAULT ''
  `)
}

/**
 * 回答卡片的结构化数据块（表格 / 趋势图）。
 * 为什么不让模型排版表格：流式输出下模型排的 Markdown 表格会抖动、列容易错位；
 * 结构化块由服务端生成、前端用 react-table 与 recharts 渲染，稳定且可复用。
 */
async function addMessageBlocks(client) {
  await client.query(`
    ALTER TABLE ai_messages
      ADD COLUMN IF NOT EXISTS blocks JSONB NOT NULL DEFAULT '[]'::jsonb
  `)
}

/**
 * 产品主数据（SKU ↔ ASIN 映射）。
 *
 * 为什么需要：库存快照按 SKU、销售报告按 ASIN，两者原本无法关联，
 * 导致"可售天数"只能退而用订单快照的短样本估算（实测 3 天样本就判出积压 133 天）。
 * 有了映射后可以用业务报告的真实销售历史算日均销量，并给出可复核的统计窗口。
 *
 * 不含采购成本、毛利等敏感字段（需求文档 §2.3：一期任务数据不含敏感数据）。
 */
async function createProductMasterSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS product_master (
      id SERIAL PRIMARY KEY,
      sku VARCHAR(80) NOT NULL,
      asin VARCHAR(40) NOT NULL,
      marketplace VARCHAR(10) NOT NULL DEFAULT 'US',
      product_name VARCHAR(300) NOT NULL DEFAULT '',
      category VARCHAR(60) NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT '在售',
      import_id INTEGER REFERENCES ai_imports(id) ON DELETE SET NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (sku, marketplace)
    );
    CREATE INDEX IF NOT EXISTS product_master_asin_idx ON product_master(asin, marketplace);
    CREATE INDEX IF NOT EXISTS product_master_sku_idx ON product_master(sku);
  `)
}

/**
 * 技能策略列（管理员统一设置的成本与合规参数）。
 *
 * 为什么单独一列而不复用 ai_user_skills 的列：触发方式与每日上限本来就该由管理员定，
 * 放在员工行里等于每个员工都能自己调高上限绕过成本控制（上线后实测确实可以）。
 * 迁移只回填**空策略**，管理员在后台改过的值不会被后续重播覆盖。
 */
async function addSkillPolicy(client) {
  await client.query(`
    ALTER TABLE ai_skills
      ADD COLUMN IF NOT EXISTS policy JSONB NOT NULL DEFAULT '{}'::jsonb
  `)
  await client.query(
    `UPDATE ai_skills
        SET policy = $1::jsonb, updated_at = NOW()
      WHERE policy = '{}'::jsonb`,
    [JSON.stringify(DEFAULT_SKILL_POLICY)]
  )
}

/**
 * 知识沉淀加固（本轮）：审核幂等约束 + 同标题新修订。
 *
 * 三件事，顺序不能颠倒：
 * 1. **只读检查**已有 experience 文档的 source_ref 重复情况。发现重复就抛错中止迁移，
 *    不自动删数据——重复文档可能已经被人引用，删掉等于替业务做决定。
 *    修复方式写进报错文案（保留哪一份、下线哪一份由管理员在知识库管理页决定）。
 * 2. experience + source_ref 唯一索引：并发审核不可能生成两份同 key 文档。
 * 3. ai_knowledge_notes 增 revision_of_note_id（新修订指向被替代的旧版本），
 *    并把"同账号同标题唯一"收窄为"非归档的唯一"：归档历史版本必须能与新私有修订共存。
 */
/**
 * 补三个热路径上的缺失索引（2026-09-14）。
 *
 * 1. `ai_runs.message_id`：会话轨迹靠它 JOIN `ai_messages`（`conversations.mjs`），
 *    而 `ai_runs` 上只有以 user_id / tool_name / status 为前导列的复合索引 ——
 *    `message_id` 不是任何索引的前导列，打开一条历史会话就是一次 Seq Scan（+ CASCADE 校验同样扫全表）。
 * 2. `ai_messages.created_at` / `ai_audit_logs.created_at`：「近 N 天用量」按时间过滤、
 *    审计台默认按时间倒序，两者都没有以时间为前导列的索引。
 * 3. `amazon_ads_daily` / `amazon_sales_daily` / `order_snapshot`：现有索引前导列是 `asin`，
 *    而站点级查询（`scan_amazon_anomalies`、全站聚合、最新日期锚点）**不带 asin**，
 *    于是每次 Seq Scan 后再 Sort，一次最多把上万行载入内存。
 *
 * 全部 `IF NOT EXISTS`，可重复执行；只加索引、不改数据。
 */
async function addPerformanceIndexes(client) {
  await client.query(`
    CREATE INDEX IF NOT EXISTS ai_runs_message_idx ON ai_runs(message_id);
    CREATE INDEX IF NOT EXISTS ai_messages_created_idx ON ai_messages(created_at DESC);
    CREATE INDEX IF NOT EXISTS ai_audit_logs_created_idx ON ai_audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS amazon_ads_daily_marketplace_idx ON amazon_ads_daily(marketplace, stat_date DESC);
    CREATE INDEX IF NOT EXISTS amazon_sales_daily_marketplace_idx ON amazon_sales_daily(marketplace, stat_date DESC);
    CREATE INDEX IF NOT EXISTS order_snapshot_ordered_at_idx ON order_snapshot(ordered_at DESC);
  `)
}

async function hardenKnowledgeDistill(client) {
  const duplicates = await client.query(
    `SELECT source_ref, COUNT(*)::int AS total, array_agg(id ORDER BY id) AS ids
       FROM ai_documents
      WHERE source_type = 'experience' AND source_ref IS NOT NULL
      GROUP BY source_ref
     HAVING COUNT(*) > 1
      ORDER BY source_ref`
  )
  assertNoDuplicateExperienceSourceRefs(duplicates.rows)

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ai_documents_experience_source_ref_uidx
      ON ai_documents(source_ref)
      WHERE source_type = 'experience' AND source_ref IS NOT NULL;

    ALTER TABLE ai_knowledge_notes
      ADD COLUMN IF NOT EXISTS revision_of_note_id INTEGER
        REFERENCES ai_knowledge_notes(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS ai_notes_revision_of_idx
      ON ai_knowledge_notes(revision_of_note_id);

    DROP INDEX IF EXISTS ai_notes_owner_title_uidx;

    -- 归档版本（历史）与新私有修订必须能同标题共存，因此唯一性只约束"活跃"状态
    CREATE UNIQUE INDEX IF NOT EXISTS ai_notes_owner_title_live_uidx
      ON ai_knowledge_notes(owner_user_id, lower(title))
      WHERE deleted_at IS NULL AND status <> 'archived';
  `)
}

/**
 * 只读检查的判定（纯函数，便于单测）：有重复就抛错中止迁移，并给出可操作的修复提示。
 * 迁移失败优先于自动修数据：重复文档可能已被人引用，删哪一份不该由迁移决定。
 */
export function assertNoDuplicateExperienceSourceRefs(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  if (list.length === 0) return
  const detail = list
    .map((row) => `${row.source_ref} → 文档 ${(row.ids ?? []).join(', ')}`)
    .join('；')
  throw new Error(
    `迁移中止：已存在重复的 experience 文档 source_ref（${detail}）。` +
      '这会让"审核通过只生成一份公共文档"的幂等约束无法建立。' +
      '请在知识库管理页确认保留哪一份、下线其余份（不要直接删数据），' +
      '确认 source_ref 唯一后重新执行本迁移。'
  )
}

export const aiAgentMigrations = [
  {
    version: AI_AGENT_MIGRATION_BASE_VERSION,
    name: 'create_ai_agent_schema',
    up: createAiAgentSchema,
  },
  {
    version: AI_AGENT_MIGRATION_BASE_VERSION + 1,
    name: 'seed_ai_tools_and_settings',
    up: seedAiToolsAndSettings,
  },
  {
    version: AI_AGENT_MIGRATION_BASE_VERSION + 2,
    name: 'add_model_credentials_to_settings',
    up: addModelCredentialsToSettings,
  },
  {
    version: AI_AGENT_MIGRATION_BASE_VERSION + 3,
    name: 'add_message_blocks',
    up: addMessageBlocks,
  },
  {
    // 工具契约变更后必须新增一个重播迁移：旧迁移已记录为已应用、不会重跑，
    // 否则新工具（如两个数据查询工具）不会进入 ai_tools，模型也就看不到它们。
    version: AI_AGENT_MIGRATION_BASE_VERSION + 4,
    name: 'reseed_data_query_tools',
    up: seedAiToolsAndSettings,
  },
  {
    // 新增扫描与库存风险工具、并把 query_amazon_performance 的 asin 改为可选，
    // 同样必须新增重播迁移才会进入 ai_tools
    version: AI_AGENT_MIGRATION_BASE_VERSION + 5,
    name: 'reseed_proactive_analysis_tools',
    up: seedAiToolsAndSettings,
  },
  {
    version: AI_AGENT_MIGRATION_BASE_VERSION + 6,
    name: 'create_knowledge_distill_schema',
    up: createKnowledgeDistillSchema,
  },
  {
    // 技能契约变更（字段/正文）后同样要新增重播迁移
    version: AI_AGENT_MIGRATION_BASE_VERSION + 7,
    name: 'seed_knowledge_distill_skill',
    up: seedKnowledgeDistillSkills,
  },
  {
    version: AI_AGENT_MIGRATION_BASE_VERSION + 8,
    name: 'add_note_provenance_and_evidence',
    up: addNoteProvenanceAndEvidence,
  },
  {
    // 以下两条为本轮（M-D 准备）追加；并行轨道的迁移已占用 106-108，故从 109 起
    version: AI_AGENT_MIGRATION_BASE_VERSION + 9,
    name: 'create_product_master',
    up: createProductMasterSchema,
  },
  {
    version: AI_AGENT_MIGRATION_BASE_VERSION + 10,
    name: 'reseed_inventory_risk_tool',
    up: seedAiToolsAndSettings,
  },
  {
    // 110 已被并行轨道（库存风险工具重播）占用，故从 111 起
    version: AI_AGENT_MIGRATION_BASE_VERSION + 11,
    name: 'add_skill_policy',
    up: addSkillPolicy,
  },
  {
    // 111 已被技能策略占用，故从 112 起
    version: AI_AGENT_MIGRATION_BASE_VERSION + 12,
    name: 'harden_knowledge_distill',
    up: hardenKnowledgeDistill,
  },
  {
    // 112 已被沉淀加固占用，故从 113 起
    version: AI_AGENT_MIGRATION_BASE_VERSION + 13,
    name: 'add_performance_indexes',
    up: addPerformanceIndexes,
  },
]

export async function runAiAgentMigrations(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  for (const migration of aiAgentMigrations) {
    await client.query('BEGIN')
    try {
      await client.query('LOCK TABLE schema_migrations IN EXCLUSIVE MODE')
      const applied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE version = $1',
        [migration.version]
      )
      if (!applied.rowCount) {
        await migration.up(client)
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [migration.version, migration.name]
        )
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    }
  }
}

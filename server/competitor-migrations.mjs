/**
 * 竞品分析模块的表迁移。
 *
 * 版本号从 200 起：`schema_migrations.version` 已被快捷导航（1）、用户表（2/3）
 * 与 AI 助手模块（100 起）占用（见各自的 migrations 文件），复用号段会被迁移器
 * 静默跳过（迁移器以版本号为主键）。
 *
 * 为什么需要这些列：`competitor_analyses` 原本只记「谁在什么时候输了什么 ASIN」，
 * 结果本身没有落库，因此页面无法回看历史分析。现在把分析参数与结果快照一起存下来，
 * 回看时直接读快照（数据冻结，与当时的结论一致），而不是用今天的数据重算一遍。
 *
 * 沿用 navigation-migrations.mjs 的迁移模式：单表 schema_migrations + 事务 + EXCLUSIVE 锁。
 */

import { collectFindingKeys } from './finding-dispositions.mjs'

/**
 * 扩展 competitor_analyses：分析参数 + 结果快照 + 列表页需要的摘要字段。
 *
 * 表本身先 `CREATE TABLE IF NOT EXISTS` 兜底：该表原本由 `server/setup.mjs` 在
 * `db:setup` 时创建，而迁移会在每次服务启动时执行 —— 若某个库只跑过迁移没跑过 setup，
 * 直接 ALTER 会因表不存在而中止整个迁移链。
 */
async function extendCompetitorAnalyses(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS competitor_analyses (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      input_type VARCHAR(20) NOT NULL,
      input_value VARCHAR(200) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  // 分析参数
  await client.query("ALTER TABLE competitor_analyses ADD COLUMN IF NOT EXISTS marketplace VARCHAR(10)")
  await client.query(
    "ALTER TABLE competitor_analyses ADD COLUMN IF NOT EXISTS asins JSONB NOT NULL DEFAULT '[]'::jsonb"
  )
  await client.query('ALTER TABLE competitor_analyses ADD COLUMN IF NOT EXISTS start_date DATE')
  await client.query('ALTER TABLE competitor_analyses ADD COLUMN IF NOT EXISTS end_date DATE')
  await client.query('ALTER TABLE competitor_analyses ADD COLUMN IF NOT EXISTS window_days INTEGER')
  await client.query('ALTER TABLE competitor_analyses ADD COLUMN IF NOT EXISTS compare_with VARCHAR(20)')

  // 列表摘要：结论标题 / 最高严重度 / 命中条数（避免列表页把整份快照都读出来只为渲染一行）
  await client.query('ALTER TABLE competitor_analyses ADD COLUMN IF NOT EXISTS headline TEXT')
  await client.query('ALTER TABLE competitor_analyses ADD COLUMN IF NOT EXISTS level VARCHAR(10)')
  await client.query('ALTER TABLE competitor_analyses ADD COLUMN IF NOT EXISTS finding_count INTEGER')

  // 结果快照：回看时原样返回，不再重算
  await client.query('ALTER TABLE competitor_analyses ADD COLUMN IF NOT EXISTS result JSONB')

  // 历史列表与首页「最近分析」都按 (user_id, created_at DESC) 取数
  await client.query(
    'CREATE INDEX IF NOT EXISTS competitor_analyses_user_created_idx ON competitor_analyses(user_id, created_at DESC)'
  )
}

/**
 * 竞品公开数据缓存（2026-09-16）。
 *
 * 为什么必须有这张表：卖家精灵 MCP **按 HTTP 请求次数计费**（月付档普遍 1000–4000 次/月），
 * 而一次「全维度」分析要 20 次以上调用 —— 没有缓存就会在几次分析里把月额度吃掉。
 * 缓存按 `(kind, asin, marketplace)`（类目维度按 `nodeIdPath`）落库，默认 24 小时有效；
 * 过期后重新拉取并覆盖同一行，因此表不会无限增长。
 *
 * 存**原始返回**而不是解析后的结果：解析逻辑会随页面需求变化，
 * 而重新解析不需要再花钱调一次外部接口（额度比磁盘便宜得多）。
 */
async function createPublicDataCache(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS competitor_public_cache (
      id SERIAL PRIMARY KEY,
      cache_key VARCHAR(180) UNIQUE NOT NULL,
      kind VARCHAR(24) NOT NULL,
      asin VARCHAR(20),
      marketplace VARCHAR(10) NOT NULL,
      payload JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS competitor_public_cache_expires_idx
      ON competitor_public_cache(expires_at);
  `)
}

/**
 * 结论处置台账（2026-09-17）。
 *
 * 两件事：
 * 1. `competitor_analyses.finding_keys`：一条分析里**可处置结论的轻量清单**
 *    （`[{ code, target, level }]`）。首页要算"这条记录里还有几条没销账"，
 *    而 `result` 是几百 KB 的快照 JSON —— 不能为了几个计数把它读出来。
 *    老记录这一列为 NULL，列表接口回退到原来的 `level` / `finding_count`。
 * 2. `competitor_finding_dispositions`：**账号级**处置台账（不是快照的一部分）。
 *    结论每次分析都会重算，所以状态只能按 (账号, 诊断码, 处置目标) 沉淀，
 *    下次分析才能把"我上次标记过已处理"认出来并自动核验。
 *
 * 状态语义与两段式销账的完整说明见 `finding-dispositions.mjs` 顶部。
 */
async function createFindingDispositions(client) {
  await client.query('ALTER TABLE competitor_analyses ADD COLUMN IF NOT EXISTS finding_keys JSONB')

  await client.query(`
    CREATE TABLE IF NOT EXISTS competitor_finding_dispositions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code VARCHAR(64) NOT NULL,
      target VARCHAR(32) NOT NULL,
      status VARCHAR(24) NOT NULL,
      note TEXT,
      claimed_analysis_id INTEGER,
      claimed_at TIMESTAMPTZ,
      verified_analysis_id INTEGER,
      verified_at TIMESTAMPTZ,
      reopen_count INTEGER NOT NULL DEFAULT 0,
      verify_detail TEXT,
      last_seen_analysis_id INTEGER,
      last_seen_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, code, target)
    );
    CREATE INDEX IF NOT EXISTS competitor_finding_dispositions_user_idx
      ON competitor_finding_dispositions(user_id, status);
  `)
}

/**
 * 回填历史记录的 `finding_keys`（2026-09-17 补）。
 *
 * **为什么必须回填**：处置功能上线前落库的分析，其 findings **没有诊断码**，
 * 于是它们的 `finding_keys` 一直是 NULL。后果有两个，第二个是用户实测报上来的：
 * 1. 首页「待处理」计数只能回退到快照的 `finding_count`（含 `info` 级，数字偏大）；
 * 2. **首页「需处理的分析」列出的恰恰是这些老 high 记录，而它们的结论整块处置区不渲染
 *    —— 用户看到"需立即处理"却无法标记**（「需立即处理的结论为什么不能标记」）。
 *
 * 回填用与运行时**同一个** `collectFindingKeys`：没有诊断码的老结论派生
 * `legacy:<index>` 位置键（快照是冻结数组，下标稳定；永不参与自动核验）。
 * 若两处各写一套算法，键就会漂移 —— 界面上能点、服务端说"不属于该次分析"。
 */
async function backfillLegacyFindingKeys(client) {
  const { rows } = await client.query(
    'SELECT id, result FROM competitor_analyses WHERE finding_keys IS NULL AND result IS NOT NULL'
  )
  for (const row of rows) {
    const keys = collectFindingKeys(row.result?.findings, { asin: row.result?.asin ?? null })
    if (keys.length === 0) continue
    await client.query('UPDATE competitor_analyses SET finding_keys = $2 WHERE id = $1', [
      row.id,
      JSON.stringify(keys),
    ])
  }
}

export const competitorMigrations = [
  {
    version: 200,
    name: 'extend_competitor_analyses',
    up: extendCompetitorAnalyses,
  },
  {
    version: 201,
    name: 'create_competitor_public_cache',
    up: createPublicDataCache,
  },
  {
    version: 202,
    name: 'create_finding_dispositions',
    up: createFindingDispositions,
  },
  {
    version: 203,
    name: 'backfill_legacy_finding_keys',
    up: backfillLegacyFindingKeys,
  },
]

export async function runCompetitorMigrations(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  for (const migration of competitorMigrations) {
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

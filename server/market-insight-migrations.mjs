/**
 * 市场洞察模块迁移。
 *
 * 600 号段由市场洞察独占。新增模块在这里登记独立号段，避免与已有模块的
 * schema_migrations 版本冲突后被静默跳过。
 */

async function createMarketInsightTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS market_insight_reports (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      marketplace VARCHAR(10) NOT NULL,
      scope_type VARCHAR(20) NOT NULL
        CHECK (scope_type IN ('category', 'node', 'asin')),
      scope_key VARCHAR(200) NOT NULL,
      scope_label VARCHAR(300) NOT NULL DEFAULT '',
      filters JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(filters) = 'object'),
      result JSONB NOT NULL
        CHECK (jsonb_typeof(result) = 'object'),
      source_meta JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(source_meta) = 'object'),
      fetched_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS market_insight_reports_owner_created_idx
      ON market_insight_reports(owner_user_id, created_at DESC)
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS market_insight_reports_owner_scope_idx
      ON market_insight_reports(owner_user_id, scope_type, marketplace, created_at DESC)
  `)
}

export const marketInsightMigrations = [
  {
    version: 600,
    name: 'create_market_insight_reports',
    up: createMarketInsightTables,
  },
]

export async function runMarketInsightMigrations(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  for (const migration of marketInsightMigrations) {
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

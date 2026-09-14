/**
 * 用户表结构迁移。
 *
 * 版本号从 2 起：`schema_migrations.version = 1` 已被快捷导航迁移占用
 * （见 server/navigation-migrations.mjs），AI 助手模块占用 100 起的号段
 * （见 server/ai-agent/migrations.mjs），若复用小号会被静默跳过。
 *
 * 沿用 navigation-migrations.mjs 的迁移模式：单表 schema_migrations + 事务 + EXCLUSIVE 锁。
 */

/**
 * 部门是管理员配置的组织归属字段，用户只读。
 * 之所以落库而不是留在前端：用户管理页需要按组织维护用户，读接口也需要下发真实值，
 * 此前它只是个人资料表单里的一个前端假字段（无来源、不持久化）。
 */
async function addUsersDepartment(client) {
  await client.query(
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(40) NOT NULL DEFAULT ''"
  )
}

export const userMigrations = [
  {
    version: 2,
    name: 'add_users_department',
    up: addUsersDepartment,
  },
]

export async function runUserMigrations(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  for (const migration of userMigrations) {
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

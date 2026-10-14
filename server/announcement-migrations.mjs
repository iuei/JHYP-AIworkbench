/**
 * 公告模块表结构迁移。
 *
 * 版本号从 300 起：`schema_migrations.version` 的 1 被快捷导航占用、2/3 是用户表、
 * 100 起是 AI 助手、200 是竞品分析。复用任何既有号段都会被**静默跳过**（迁移器只按版本号查重），
 * 表现成"迁移跑过了但表不存在"，接口直到被调用才 500，排查成本很高。
 *
 * 两张表的分工：
 * - `announcements` 是公告本身：标题 / 正文（Markdown）/ 状态 / 弹出策略 / 可选有效期；
 * - `announcement_reads` 是"谁在哪一刻点了确定"，是**「只弹一次」的唯一依据**。
 *
 * 已读按**账号**（`user_id`）而不是浏览器记录：员工换电脑、清缓存、换浏览器后不该重复弹，
 * 管理员也需要知道到底有多少人看过。这也是它必须落库、不能用 localStorage 的原因。
 */

const ANNOUNCEMENT_MIGRATION_BASE_VERSION = 300

/**
 * 公告主表。
 *
 * 三个状态而不是一个布尔 `published`：编辑中的草稿不该出现在员工侧，
 * 而"已归档"与"草稿"的差别在于——归档是**曾经发出去过**的内容，保留它是为了追溯，
 * 不是为了再发。两者都只在管理员列表里可见。
 *
 * `display_mode` 是需求里的核心开关：`every_login` 每次登录都弹，
 * `once` 只弹一次（靠 `announcement_reads` 判断）。它落在**公告**上而不是用户偏好上，
 * 因为同一条公告对不同人群的打扰程度不同，管理员要能逐条决定。
 *
 * `publish_at` / `expire_at` 允许为空（= 不限制）：定时生效的公告靠 `publish_at` 提前建好，
 * 过期公告靠 `expire_at` 自动停弹，都不需要管理员半夜上系统手动开关。
 */
async function createAnnouncements(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS announcements (
      id SERIAL PRIMARY KEY,
      title VARCHAR(120) NOT NULL,
      body TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'published', 'archived')),
      display_mode VARCHAR(20) NOT NULL DEFAULT 'once'
        CHECK (display_mode IN ('once', 'every_login')),
      priority INTEGER NOT NULL DEFAULT 0,
      publish_at TIMESTAMPTZ,
      expire_at TIMESTAMPTZ,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      published_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      published_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS announcements_status_idx
      ON announcements(status, priority DESC, published_at DESC)
      WHERE deleted_at IS NULL;
  `)
}

/**
 * 已读表。
 *
 * 主键 `(announcement_id, user_id)` 本身就是幂等保证：重复点确定不会长出新行，
 * 因此 `POST /:id/ack` 天然可以重复调用（前端超时重试、双开页面都安全）。
 *
 * `ON DELETE CASCADE` 两侧级联：公告被物理删除或账号被删除后，
 * 已读记录没有任何独立意义，留着只会变成无法解读的孤儿行。
 */
async function createAnnouncementReads(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS announcement_reads (
      announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (announcement_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS announcement_reads_user_idx
      ON announcement_reads(user_id);
  `)
}

export const announcementMigrations = [
  {
    version: ANNOUNCEMENT_MIGRATION_BASE_VERSION,
    name: 'create_announcements',
    up: createAnnouncements,
  },
  {
    version: ANNOUNCEMENT_MIGRATION_BASE_VERSION + 1,
    name: 'create_announcement_reads',
    up: createAnnouncementReads,
  },
]

export async function runAnnouncementMigrations(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  for (const migration of announcementMigrations) {
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

/**
 * 产品开发模块的表迁移。
 *
 * 版本号从 **400** 起：`schema_migrations.version` 已被快捷导航（1）、用户表（2/3）、
 * AI 助手模块（100 起，见 `ai-agent/migrations.mjs`）、竞品分析（200，见
 * `competitor-migrations.mjs`）与公告（300 起，见 `announcement-migrations.mjs`）占用。
 *
 * **为什么必须避开 300**：公告模块在并行开发中先占了 300 号段，而迁移器以版本号为主键
 * （`INSERT` 冲突即视为已应用）。两模块同号时，先跑的那个把版本号写进 `schema_migrations`，
 * 后跑的那个**被静默跳过** —— 表不会建，接口全部 500，而迁移日志里没有任何报错。
 * 这是本项目最容易踩且最难定位的一类故障，新模块一律独占号段，用前先 grep 全局。
 *
 * 沿用 `competitor-migrations.mjs` 的迁移模式：单表 schema_migrations + 事务 + EXCLUSIVE 锁。
 */

/**
 * 建候选产品池与对比记录两张表。
 *
 * 为什么把选品字段分成「固定列 + attributes JSONB」两层：
 * 本模块立项时**数据源尚未确定**（候选的价格、评分、评论数等没有现成数据源，
 * 只能人工录入或表格导入，且将来可能接入外部选品数据）。把可变部分收进 `attributes`，
 * 数据源确定后新字段可以先落进来，不必立刻改表结构；而身份与决策核心
 * （站点 / ASIN / 名称 / 类目 / 目标售价 / 阶段）是稳定的，值得可索引的固定列。
 *
 * `target_price` 之所以留在固定列而不是 attributes：它是选品决策的第一维度，
 * 检索与对比都要按它排序/展示，塞进 JSONB 会让每次取值都变成一次类型转换。
 */
async function createProductDevTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS product_dev_candidates (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      marketplace VARCHAR(10) NOT NULL DEFAULT 'US',
      asin VARCHAR(40),
      product_name VARCHAR(300) NOT NULL DEFAULT '',
      category VARCHAR(60) NOT NULL DEFAULT '',
      target_price NUMERIC(14, 2),
      stage VARCHAR(20) NOT NULL DEFAULT 'candidate'
        CHECK (stage IN ('candidate', 'researching', 'approved', 'rejected')),
      note TEXT,
      -- 选品附加维度（评分、评论数、来源链接…），键来自用户表头，值一律字符串。
      -- 强制 object：写入数组会让前端对比表的取键逻辑静默失效。
      attributes JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(attributes) = 'object'),
      source VARCHAR(20) NOT NULL DEFAULT 'manual'
        CHECK (source IN ('manual', 'import')),
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  /*
   * 同一账号下同站点同 ASIN 不允许重复（软删的不算）。
   *
   * 用**部分唯一索引**而不是应用层检查：应用层校验在并发下不可靠（两个请求同时通过检查
   * 再同时插入），只有数据库能真正兜住。`asin IS NOT NULL` 必须写进条件里 ——
   * 候选可能还没有 ASIN（只知道产品名），NULL 在唯一索引里互不相等，
   * 但把条件写清楚能避免将来有人误以为"NULL 也参与了去重"。
   */
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS product_dev_candidates_owner_asin_uidx
      ON product_dev_candidates(owner_user_id, marketplace, asin)
      WHERE deleted_at IS NULL AND asin IS NOT NULL
  `)

  // 检索与列表固定按 (owner, 更新时间倒序) 取数
  await client.query(`
    CREATE INDEX IF NOT EXISTS product_dev_candidates_owner_updated_idx
      ON product_dev_candidates(owner_user_id, updated_at DESC)
  `)

  // 关键词命中产品名称与 ASIN（类目与备注走顺序扫描，量级远小于前者）
  await client.query(`
    CREATE INDEX IF NOT EXISTS product_dev_candidates_owner_stage_idx
      ON product_dev_candidates(owner_user_id, stage)
  `)

  /*
   * 对比记录：参数 + 维度定义 + 结果快照。
   *
   * 结果**必须冻结**（存 result 快照）而不是回看时重算：报表数据每天在变，
   * 重算会让同一份历史记录在不同日期打开得到不同数字，而它的 `created_at`
   * 却写着当初的时间 —— 那是比"没有历史"更有害的假象。
   */
  await client.query(`
    CREATE TABLE IF NOT EXISTS product_dev_comparisons (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title VARCHAR(200) NOT NULL DEFAULT '',
      marketplace VARCHAR(10) NOT NULL DEFAULT 'US',
      -- 参与对比的候选 ID（保序，第一个是基准项）
      candidate_ids JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(candidate_ids) = 'array'),
      -- 对比维度定义快照：回看时按当时的维度渲染，不跟着候选的 attributes 变动
      dimensions JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(dimensions) = 'array'),
      result JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(result) = 'object'),
      start_date DATE,
      end_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  await client.query(`
    CREATE INDEX IF NOT EXISTS product_dev_comparisons_owner_created_idx
      ON product_dev_comparisons(owner_user_id, created_at DESC)
  `)
}

export const productDevMigrations = [
  {
    version: 400,
    name: 'create_product_dev_tables',
    up: createProductDevTables,
  },
]

export async function runProductDevMigrations(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name VARCHAR(160) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  for (const migration of productDevMigrations) {
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

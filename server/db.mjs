import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

/**
 * DATE 列（OID 1082）原样按 `'YYYY-MM-DD'` 字符串回传。
 *
 * 为什么必须覆盖默认行为：pg 默认把 DATE 解析成**本地时区午夜**的 Date 对象，
 * 再经 `toISOString()` 就会整体前移一天（东八区必现）。实测后果：
 * - `queryAdsDaily` 取回后按区间过滤时丢掉第一天（30 天窗口只算 29 天，汇总数字系统性偏小）；
 * - 销量速度窗口、导入周期声明、喂给模型的"数据覆盖范围"同样偏移一天
 *   （提示词里会出现 `覆盖 Fri Sep 11 ~ Wed Sep 10` 这种反向区间）。
 *
 * 业务层的日期处理本来就带字符串分支（`dateOnly` / `normalizeDate` / `toIsoDate`），
 * 因此返回字符串比返回 Date 更准确，也更接近 DATE 本身的语义。
 */
pg.types.setTypeParser(1082, (value) => value)

export const pool = new pg.Pool({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? 'jhyp_workbench',
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD,
  // 连接池上限与超时。
  // 必须显式设置：pg 默认 `max = 10` 且没有任何超时，一次慢查询（例如全站报表扫描）在
  // 上层 `Promise.race` 超时后**连接并不会被释放**，仍在后端跑；约 10 个并发问答就能把池占满，
  // 此后所有接口的查询永久排队 —— 表现为整站挂死，且应用日志里看不到错误。
  max: Number(process.env.PG_POOL_MAX ?? 20),
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 5000),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30000),
  // 单条语句的服务端超时：让慢查询自己结束并把连接还回池子。
  // 注意这是"每条语句"而不是"整个事务"，因此导入时逐行 INSERT 的事务不受影响。
  statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 15000),
  query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS ?? 20000),
})

export async function query(text, params) {
  return pool.query(text, params)
}

/**
 * 「竞品分析记录可在 AI 会话里调取」的验证（真实库，**只读**）。
 *
 * 用法：
 *   node server/verify-competitor-tool.mjs
 *
 * 为什么不用浏览器：这条链路的全部逻辑都在服务端（工具契约 → 载荷组装 → 已落库快照），
 * 页面上没有任何新东西；因此这里直接调 `competitorAnalysisPayload`，比开浏览器更接近真相。
 *
 * 守住的行为：
 * - 工具契约已注册进 `ai_tools`（普通员工可见、启用）—— 不注册模型就看不到；
 * - 三种调取方式都能命中：按记录号 / 按 ASIN / 不指定（列最近几次）；
 * - **只读**：调用前后 `competitor_analyses` 行数不变（不触发任何分析、不消耗卖家精灵额度）；
 * - 越权与不存在一律"查不到"，与页面 404 同口径；
 * - 载荷里**模型看得见的字段**（summary / rows）已含关键数字，回答里渲染的 blocks 只留
 *   结论表 + 横向对比 + 商品公开数据（图表 / 流量词 / 评论不进）。
 */
import dotenv from 'dotenv'
import { query, pool } from './db.mjs'
import { competitorAnalysisPayload } from './ai-agent/competitor-history.mjs'

dotenv.config()

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok })
  process.stdout.write(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}\n`)
}

const TOOL_NAME = 'query_competitor_analysis'

async function main() {
  // ---------- 1. 工具契约是否已注册进 ai_tools ----------
  const { rows: toolRows } = await query(
    'SELECT name, required_role, enabled FROM ai_tools WHERE name = $1',
    [TOOL_NAME]
  )
  const tool = toolRows[0] ?? null
  check(
    `${TOOL_NAME} 已注册进 ai_tools`,
    Boolean(tool),
    tool ? `required_role=${tool.required_role} enabled=${tool.enabled}` : '未注册（需重启后端让迁移 118 执行）'
  )
  check(
    '注册状态为「启用」且对普通员工开放',
    Boolean(tool) && tool.enabled === true && tool.required_role === 'user'
  )

  // ---------- 2. 取一条真实记录作为素材 ----------
  const { rows: sampleRows } = await query(
    `SELECT id, user_id, asins
       FROM competitor_analyses
      WHERE result IS NOT NULL
      ORDER BY id DESC
      LIMIT 1`
  )
  const sample = sampleRows[0] ?? null
  if (!sample) {
    process.stdout.write(
      '\n库里还没有带快照的竞品分析记录，无法验证调取链路（先在页面上跑一次分析）。\n'
    )
    return
  }
  const asins = Array.isArray(sample.asins) ? sample.asins : []
  const userId = sample.user_id
  const beforeCount = (await query('SELECT count(*)::int AS n FROM competitor_analyses')).rows[0].n

  // ---------- 3. 按记录号调取 ----------
  const byId = await competitorAnalysisPayload({ userId, analysisId: sample.id })
  check(
    `按记录号调取 #${sample.id} 命中`,
    byId.empty === false && byId.analysis?.analysisId === sample.id
  )
  const summary = String(byId.summary ?? '')
  check(
    'summary 写明这是历史快照、不重新取数不消耗额度',
    /不重新取数、不调用卖家精灵、不消耗任何额度/.test(summary)
  )
  check(
    'summary 里有关键指标数字（模型能直接引用）',
    asins.length === 0 || /广告花费|广告销售额/.test(summary),
    asins.slice(0, 2).join('、')
  )
  check('summary 里有结论明细', /结论明细/.test(summary) || byId.rowCount === 0)
  check(
    'rows 是结论行（含判定 / 结论 / 事实 / 建议）',
    Array.isArray(byId.rows) &&
      (byId.rows.length === 0 ||
        byId.rows.every((row) => 'levelLabel' in row && 'title' in row && 'detail' in row))
  )
  const blockTitles = (byId.blocks ?? []).map((block) => block.title)
  check(
    '回答里渲染的块只留结论表 + 横向对比 + 公开数据',
    blockTitles.every(
      (title) =>
        /结论与建议/.test(title) ||
        /ASIN 横向对比/.test(title) ||
        /商品公开数据/.test(title)
    ),
    blockTitles.join(' / ') || '(无块)'
  )
  check(
    '关键块的行已截断到上限内（不会把整张 30 天的表塞进回答）',
    (byId.blocks ?? []).every((block) => (block.rows ?? []).length <= 20)
  )

  // ---------- 4. 按 ASIN 调取 ----------
  if (asins.length > 0) {
    const byAsin = await competitorAnalysisPayload({
      userId,
      asin: asins[0],
    })
    check(
      `按 ASIN（${asins[0]}）取到包含它的最近一次`,
      byAsin.empty === false && byAsin.analysis?.matchedBy === 'asin'
    )
    check(
      '按 ASIN 命中的记录确实是包含该 ASIN 的那条',
      Array.isArray(byAsin.analysis?.asins) &&
        byAsin.analysis.asins.map((item) => String(item).toUpperCase()).includes(String(asins[0]).toUpperCase())
    )
  }

  // ---------- 5. 不指定：列出最近几次 ----------
  const listed = await competitorAnalysisPayload({ userId, limit: 3 })
  check(
    '不指定时列出最近几次（rows 为记录摘要）',
    listed.rows.length > 0 &&
      listed.rows.every((row) => 'id' in row && 'headline' in row && 'hasSnapshot' in row)
  )
  check(
    '列表文案告诉用户怎么继续追问',
    /请告诉我记录号/.test(String(listed.summary ?? ''))
  )
  check(
    'limit 被夹到上限内（不会一次列出几百条）',
    listed.rows.length <= 20,
    `${listed.rows.length} 条`
  )

  // ---------- 6. 越权与不存在 ----------
  const otherUser = await competitorAnalysisPayload({ userId: -1, analysisId: sample.id })
  check('他人账号读这条记录 → 查不到（与页面 404 同口径）', otherUser.empty === true)
  const missing = await competitorAnalysisPayload({ userId, analysisId: 999999999 })
  check('不存在的记录号 → 如实说没找到', missing.empty === true && /没有找到记录/.test(String(missing.summary)))
  const noUser = await competitorAnalysisPayload({ userId: null })
  check('没有用户身份 → 明确拒绝，不泄露任何记录', noUser.empty === true && noUser.rows.length === 0)

  // ---------- 7. 只读：没有触发任何分析与写入 ----------
  const afterCount = (await query('SELECT count(*)::int AS n FROM competitor_analyses')).rows[0].n
  check(
    '全程只读：competitor_analyses 行数不变（未触发新分析）',
    beforeCount === afterCount,
    `${beforeCount} → ${afterCount}`
  )

  const failed = checks.filter((item) => !item.ok)
  process.stdout.write(`\n合计 ${checks.length - failed.length}/${checks.length} 通过\n`)
  process.exitCode = failed.length === 0 ? 0 : 1
}

main()
  .catch((error) => {
    process.stdout.write(`\n✖ 验证脚本异常：${error?.stack ?? error}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })

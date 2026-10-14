/**
 * 竞品分析接口验收（HTTP 层，不依赖模型）。
 *
 * 用法：
 *   API_PORT=8789 SERVE_STATIC=false node server/index.mjs   # 终端 A（改完服务端必须重启，Node 无热重载）
 *   node server/competitor-verify.mjs http://127.0.0.1:8789  # 终端 B
 *
 * 覆盖：多 ASIN 对比、参数校验分支（400）、历史列表与快照回看、越权与不存在记录（404）。
 * 会写入分析记录用于验证「落库 → 列表 → 回看」链路，脚本结束前按 id 删除自己创建的记录。
 */
import dotenv from 'dotenv'

dotenv.config()

const BASE = process.argv[2] ?? 'http://127.0.0.1:8789'
let pass = 0
let fail = 0
const created = []

function check(label, ok, detail = '') {
  if (ok) {
    pass += 1
    process.stdout.write(`✔ ${label}\n`)
  } else {
    fail += 1
    process.stdout.write(`✖ ${label} ${detail}\n`)
  }
}

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: response.status, json, text }
}

const login = await request('/api/auth/login', {
  method: 'POST',
  body: {
    login: process.env.INITIAL_ADMIN_LOGIN,
    password: process.env.INITIAL_ADMIN_PASSWORD,
  },
})
check('管理员登录成功', login.status === 200 && Boolean(login.json?.token), `HTTP ${login.status}`)
const token = login.json?.token

/* 1. 未认证必须 401 */
const anonymous = await request('/api/competitor-analyses')
check('未登录读历史被拒（401）', anonymous.status === 401, `HTTP ${anonymous.status}`)

/* 2. 多 ASIN 分析 */
const analysis = await request('/api/competitor-analyses', {
  method: 'POST',
  token,
  body: {
    inputType: 'ASIN',
    inputValue: 'B0SAMPLE01, B0SAMPLE02',
    marketplace: 'US',
    windowDays: 30,
    compareWith: 'previous_period',
  },
})
const result = analysis.json?.result
check('多 ASIN 分析返回 200', analysis.status === 200 && Boolean(result), `HTTP ${analysis.status}`)
if (result) {
  created.push(result.analysisId)
  check('返回落库记录 id', Number.isInteger(result.analysisId), `id=${result.analysisId}`)
  check('对比行包含两个 ASIN 且都有数据', result.comparison.rows.length === 2 && result.comparison.rows.every((row) => row.hasData))
  check('块顺序：汇总 → 对比 → 明细 → 趋势 → 库存', (() => {
    const titles = result.blocks.map((block) => block.title)
    const indexOf = (keyword) => titles.findIndex((title) => (title ?? '').includes(keyword))
    return indexOf('期间汇总') === 0 && indexOf('ASIN 横向对比') > 0 && indexOf('ASIN 横向对比') < indexOf('按日明细') && indexOf('关联库存') > indexOf('按日明细')
  })(), JSON.stringify(result.blocks.map((block) => block.title)))
  check('结论带建议动作与依据', result.findings.every((item) => item.level && item.title && item.detail) && result.findings.some((item) => item.action))
  check('库存联动到 SKU', result.inventory.mapped === true && result.inventory.skus.length > 0, JSON.stringify(result.inventory.skus))
  check('数据时效文案由服务端给出', typeof result.dataFreshness?.note === 'string' && result.dataFreshness.note.length > 0)
  process.stdout.write(`  headline：${result.headline}\n`)
  process.stdout.write(`  结论：${result.findings.map((item) => `${item.level}:${item.title}`).join(' | ')}\n`)
}

/* 3. 参数校验分支 */
const cases = [
  ['品牌维度', { inputType: '品牌名', inputValue: 'Anker' }, /尚未接入/],
  ['非法站点', { inputType: 'ASIN', inputValue: 'B0SAMPLE01', marketplace: 'USA' }, /两位站点代码/],
  ['天数越界', { inputType: 'ASIN', inputValue: 'B0SAMPLE01', windowDays: 500 }, /统计天数/],
  ['区间缺一半', { inputType: 'ASIN', inputValue: 'B0SAMPLE01', startDate: '2026-08-01' }, /同时提供/],
  ['区间倒置', { inputType: 'ASIN', inputValue: 'B0SAMPLE01', startDate: '2026-08-31', endDate: '2026-08-01' }, /不能早于/],
  ['基线非法', { inputType: 'ASIN', inputValue: 'B0SAMPLE01', compareWith: 'WoW' }, /对比基线/],
  ['无法识别的 ASIN', { inputType: 'ASIN', inputValue: 'B0SAMPLE01, XYZ123' }, /XYZ123/],
  [
    '超过 5 个 ASIN',
    { inputType: 'ASIN', inputValue: 'B0AAAAAA01,B0AAAAAA02,B0AAAAAA03,B0AAAAAA04,B0AAAAAA05,B0AAAAAA06' },
    /最多对比/,
  ],
]
for (const [label, body, pattern] of cases) {
  const response = await request('/api/competitor-analyses', { method: 'POST', token, body })
  check(`参数校验·${label} → 400 且说明原因`, response.status === 400 && pattern.test(response.json?.message ?? ''), `HTTP ${response.status} ${response.json?.message ?? ''}`)
}

/* 4. 历史列表与快照 */
const history = await request('/api/competitor-analyses?limit=5', { token })
check('历史列表返回 200 与数组', history.status === 200 && Array.isArray(history.json?.items), `HTTP ${history.status}`)
const newest = history.json?.items?.[0]
check('最新一条是刚写入的记录', newest?.id === created[0], `newest=${newest?.id} created=${created[0]}`)
check('列表项含参数摘要与快照标记', Boolean(newest?.headline) && newest?.marketplace === 'US' && newest?.windowDays === 30 && newest?.hasSnapshot === true && Array.isArray(newest?.asins) && newest.asins.length === 2)

const snapshot = await request(`/api/competitor-analyses/${created[0]}`, { token })
check('单条回看返回完整快照', snapshot.status === 200 && snapshot.json?.result?.comparison?.rows?.length === 2, `HTTP ${snapshot.status}`)

const missing = await request('/api/competitor-analyses/99999999', { token })
check('不存在的记录返回 404', missing.status === 404, `HTTP ${missing.status}`)
const badId = await request('/api/competitor-analyses/not-a-number', { token })
check('非法 id 返回 404 而不是 500', badId.status === 404, `HTTP ${badId.status}`)

/* 5. 清理本次验证写入的记录 */
const { pool } = await import('./db.mjs')
for (const id of created.filter(Boolean)) {
  await pool.query('DELETE FROM competitor_analyses WHERE id = $1', [id])
}
process.stdout.write(`已清理验证记录：${created.filter(Boolean).join('、')}\n`)
await pool.end()

process.stdout.write(`\n结果：${pass} 通过，${fail} 失败\n`)
process.exit(fail === 0 ? 0 : 1)

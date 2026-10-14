/**
 * 「我的 ASIN」大清单专项验收（5000 条上限）。
 *
 * 用法：
 *   API_PORT=8788 SERVE_STATIC=false node server/index.mjs   # 另开终端
 *   node server/ai-agent/verify-my-asins-bulk.mjs [baseUrl]
 *
 * 盯的是"上限提到 5000 之后必须一起兜住的代价"：
 * 1. 5000 条一次性导入的耗时与落库条数；
 * 2. 第 5001 条**报错而不是截断**（静默丢弃最难被发现）；
 * 3. 页面指标接口返回**全量**行（分页与导出都基于它）；
 * 4. AI 工具路径只回预算内的行（30 行表格 + 120 行 `rows`），不把 5000 行塞进模型上下文。
 *
 * 会写入真实数据（测试条目与 1 天报表行），只应在本地开发库执行；结束时清理。
 */
import dotenv from 'dotenv'
import { query } from '../db.mjs'
import { executeTool, loadRegisteredTools } from './tools.mjs'
import { MAX_ITEMS_PER_USER } from './my-asins.mjs'
import { MAX_TABLE_ROWS } from './data-queries.mjs'

dotenv.config()

const ARGS = process.argv.slice(2)
const BASE =
  ARGS.find((arg) => /^https?:\/\//.test(arg)) ?? `http://127.0.0.1:${process.env.API_PORT ?? 8788}`
const ADMIN_LOGIN = process.env.INITIAL_ADMIN_LOGIN
const ADMIN_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD

const OWNER_LOGIN = 'my-asin-bulk-owner'
const ACCOUNT_PASSWORD = 'MyAsin#2026'
const RANGE = { startDate: '2026-06-01', endDate: '2026-06-30' }
const CAMPAIGN = 'C-我的ASIN批量验收'

const results = []
let failures = 0

function check(id, title, passed, detail = '') {
  results.push({ id, title, passed, detail })
  if (!passed) failures += 1
  process.stdout.write(`${passed ? '✔' : '✖'} ${id} ${title}${detail ? ` — ${detail}` : ''}\n`)
}

async function request(path, { token, method = 'GET', body, expect } = {}) {
  const headers = {}
  if (token) headers.authorization = `Bearer ${token}`
  let payload
  if (body !== undefined) {
    headers['content-type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const response = await fetch(`${BASE}${path}`, { method, headers, body: payload })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  if (expect && response.status !== expect) {
    throw new Error(`${method} ${path} 期望 ${expect}，实际 ${response.status}：${text.slice(0, 200)}`)
  }
  return { status: response.status, json, text }
}

async function login(loginName, password) {
  const { json } = await request('/api/auth/login', {
    method: 'POST',
    body: { login: loginName, password },
    expect: 200,
  })
  return json.token
}

async function uploadTable(path, { token, fileName, body }) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/octet-stream',
      'x-file-name': encodeURIComponent(fileName),
    },
    body,
  })
  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: response.status, json, text }
}

async function ensureUser(adminToken, { login: loginName, name }) {
  const list = await request('/api/users', { token: adminToken, expect: 200 })
  const existing = list.json.find((user) => user.login === loginName)
  if (existing) return existing
  const created = await request('/api/users', {
    token: adminToken,
    method: 'POST',
    body: { login: loginName, password: ACCOUNT_PASSWORD, name, role: 'operator' },
    expect: 201,
  })
  return created.json
}

/** 生成第 i 个测试 ASIN（10 位：`B0BULK` + 4 位序号）。 */
function bulkAsin(index) {
  return `B0BULK${String(index).padStart(4, '0')}`
}

function buildCsv(count, startIndex = 0) {
  const lines = ['ASIN,站点,别名,备注']
  for (let index = startIndex; index < startIndex + count; index += 1) {
    lines.push(`${bulkAsin(index)},US,,`)
  }
  return lines.join('\n')
}

async function cleanup(userId) {
  await query('DELETE FROM amazon_ads_daily WHERE campaign = $1', [CAMPAIGN])
  await query('DELETE FROM amazon_sales_daily WHERE asin LIKE $1', ['B0BULK%'])
  if (userId) await query('DELETE FROM my_asin_items WHERE owner_user_id = $1', [userId])
}

async function main() {
  const adminToken = await login(ADMIN_LOGIN, ADMIN_PASSWORD)
  const owner = await ensureUser(adminToken, { login: OWNER_LOGIN, name: '我的 ASIN 大清单验收' })
  const ownerToken = await login(OWNER_LOGIN, ACCOUNT_PASSWORD)
  await cleanup(owner.id)

  // ── B1 一次性导入 5000 条
  const started = Date.now()
  const imported = await uploadTable('/api/ai/my-asins/import', {
    token: ownerToken,
    fileName: 'bulk.csv',
    body: Buffer.from(buildCsv(MAX_ITEMS_PER_USER), 'utf8'),
  })
  const elapsed = Date.now() - started
  check(
    'B1',
    `${MAX_ITEMS_PER_USER} 条一次性导入成功`,
    imported.status === 200 && imported.json.added?.length === MAX_ITEMS_PER_USER,
    `status=${imported.status} added=${imported.json.added?.length} 耗时=${elapsed}ms`
  )

  const list = await request('/api/ai/my-asins', { token: ownerToken, expect: 200 })
  check(
    'B2',
    '列表返回全部 5000 条',
    list.json.items.length === MAX_ITEMS_PER_USER,
    `items=${list.json.items.length}`
  )

  // ── B3 第 5001 条必须报错（400），且不动已有数据
  const overflow = await uploadTable('/api/ai/my-asins/import?dryRun=true', {
    token: ownerToken,
    fileName: 'overflow.csv',
    body: Buffer.from(`ASIN,站点\n${bulkAsin(9999)},US\n`, 'utf8'),
  })
  check(
    'B3',
    '超出上限时预览即给出 overflow（不静默截断）',
    overflow.status === 200 && overflow.json.summary?.overflow === true,
    `status=${overflow.status} overflow=${overflow.json.summary?.overflow} by=${overflow.json.summary?.overflowBy}`
  )

  // ── B4 给前 200 个 ASIN 造 1 天数据，页面指标必须回全量行
  const sampleAsins = Array.from({ length: 200 }, (_, index) => bulkAsin(index))
  await query(
    `INSERT INTO amazon_ads_daily
       (stat_date, asin, marketplace, campaign, impressions, clicks, spend, orders, sales, acos)
     SELECT $1::date, a, 'US', $3, 100, 10, 10, 1, 40, NULL
       FROM unnest($2::text[]) AS a
     ON CONFLICT (stat_date, asin, campaign, marketplace) DO NOTHING`,
    [RANGE.startDate, sampleAsins, CAMPAIGN]
  )

  const metrics = await request(
    `/api/ai/my-asins/metrics?startDate=${RANGE.startDate}&endDate=${RANGE.endDate}`,
    { token: ownerToken, expect: 200 }
  )
  const usGroup = (metrics.json.groups ?? []).find((group) => group.marketplace === 'US')
  check(
    'B4',
    '页面指标返回全量 5000 行（不受给模型看的行数预算限制）',
    metrics.json.rows.length === MAX_ITEMS_PER_USER && usGroup?.covered === sampleAsins.length,
    `rows=${metrics.json.rows.length} covered=${usGroup?.covered}`
  )

  // ── B5 AI 工具只回预算内的行
  const userRow = await query('SELECT id, login, role, status FROM users WHERE id = $1', [owner.id])
  const registeredTools = await loadRegisteredTools(userRow.rows[0])
  const toolResult = await executeTool({
    user: userRow.rows[0],
    registeredTools,
    toolName: 'query_my_asins',
    params: { marketplace: 'US', startDate: RANGE.startDate, endDate: RANGE.endDate },
    ctx: {},
  })
  const tableBlock = (toolResult.blocks ?? []).find((block) => block.kind === 'table')
  check(
    'B5',
    'AI 工具路径只回预算内的行（表格 ≤ 30 行）',
    toolResult.status === 'ok' &&
      tableBlock !== undefined &&
      tableBlock.rows.length <= MAX_TABLE_ROWS &&
      (toolResult.rows ?? []).length <= 120,
    `tableRows=${tableBlock?.rows.length} rows=${toolResult.rows?.length}`
  )

  await cleanup(owner.id)

  process.stdout.write(
    `\n${failures === 0 ? '全部通过' : `${failures} 项未通过`}：共 ${results.length} 项\n`
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (error) => {
  process.stderr.write(`验收脚本异常：${error?.stack ?? error}\n`)
  try {
    const row = await query('SELECT id FROM users WHERE login = $1', [OWNER_LOGIN])
    await cleanup(row.rows[0]?.id ?? null)
  } catch {
    // 清理失败不覆盖原始错误
  }
  process.exit(1)
})

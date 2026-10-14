/**
 * 「我的 ASIN」验收脚本（服务端 HTTP + 工具层）。
 *
 * 用法：
 *   API_PORT=8788 SERVE_STATIC=false node server/index.mjs   # 另开终端（别占用正在用的 8787）
 *   node server/ai-agent/verify-my-asins.mjs [baseUrl]
 *
 * 覆盖：
 * 1. 单条结构化新增（弹窗表单路径）与批量粘贴（纯文本 / 表格文本，含站点列）；
 * 2. 以 `(asin, 站点)` 为键的去重：同 ASIN 换站点是合法新增；
 * 3. 校验边界：非法站点、空 ASIN、超长别名、自定义区间不成对、区间超长；
 * 4. 账号隔离（他人 404，管理员同样看不到）；
 * 5. 模板下载（真 xlsx）、导入预览不写库、正式导入落库、.xls 与坏表头明确 400；
 * 6. **多站点指标**：分组取数、数字与库内真值一致、`null` 不折算成 0、
 *    顶层**没有跨站点合计**（不同站点货币不同，合计没有含义）；
 * 7. AI 工具 `query_my_asins`：注册可见、按站点分组取数、站点过滤、空/未命中提示。
 *
 * 说明：会写入真实数据（测试报表行与条目），只应在本地开发库执行；
 * 脚本结束时会删除自己插入的报表行与条目。
 */
import dotenv from 'dotenv'
import { query } from '../db.mjs'
import { executeTool, loadRegisteredTools } from './tools.mjs'
import { MAX_ITEMS_PER_USER } from './my-asins.mjs'
import { makeXlsxBuffer } from './xlsx-fixture.mjs'

dotenv.config()

const ARGS = process.argv.slice(2)
const BASE =
  ARGS.find((arg) => /^https?:\/\//.test(arg)) ?? `http://127.0.0.1:${process.env.API_PORT ?? 8788}`
const ADMIN_LOGIN = process.env.INITIAL_ADMIN_LOGIN
const ADMIN_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD

const OWNER_LOGIN = 'my-asin-owner'
const OTHER_LOGIN = 'my-asin-other'
const ACCOUNT_PASSWORD = 'MyAsin#2026'

/** 测试 ASIN（必须 10 位：`extractAsin` 只认 10 位）。 */
const SUBJECT_ASIN = 'B0MYASIN01'
const PEER_ASIN = 'B0MYASIN02'
const NO_DATA_ASIN = 'B0MYASIN03'
const PENDING_ASIN = 'B0MYASIN04'
const TEST_ASINS = [SUBJECT_ASIN, PEER_ASIN, NO_DATA_ASIN, PENDING_ASIN]

const US = 'US'
const DE = 'DE'
/** 显式区间（30 天，不依赖"数据最新日期"，断言值稳定）。 */
const RANGE = { startDate: '2026-06-01', endDate: '2026-06-30' }
const DAYS = 30

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
  return { status: response.status, json, text, headers: response.headers }
}

async function login(loginName, password) {
  const { json } = await request('/api/auth/login', {
    method: 'POST',
    body: { login: loginName, password },
    expect: 200,
  })
  return json.token
}

/** 上传表格文件：原始 body + `X-File-Name` 头（与前端 `rawRequest` 完全一致）。 */
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

/** 复用/新建账号（管理员接口）。 */
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

/* ---------- 测试报表数据 ---------- */

async function seedReportRows() {
  await query('DELETE FROM amazon_ads_daily WHERE asin = ANY($1::text[])', [TEST_ASINS])
  await query('DELETE FROM amazon_sales_daily WHERE asin = ANY($1::text[])', [TEST_ASINS])

  const adsPlan = [
    // [asin, 站点, 每日花费, 每日广告销售额, 每日订单]
    [SUBJECT_ASIN, US, 100, 400, 20],
    [SUBJECT_ASIN, DE, 50, 200, 10],
  ]
  for (const [asin, marketplace, spend, sales, orders] of adsPlan) {
    await query(
      `INSERT INTO amazon_ads_daily
         (stat_date, asin, marketplace, campaign, impressions, clicks, spend, orders, sales, acos)
       SELECT d::date, $1, $2, 'C-我的ASIN验收', 5000, 200, $3, $4, $5, NULL
         FROM generate_series($6::date, $7::date, '1 day') AS d
       ON CONFLICT (stat_date, asin, campaign, marketplace) DO NOTHING`,
      [asin, marketplace, spend, orders, sales, RANGE.startDate, RANGE.endDate]
    )
  }

  const salesPlan = [
    [SUBJECT_ASIN, US, 10, 500],
    [SUBJECT_ASIN, DE, 4, 200],
  ]
  for (const [asin, marketplace, units, sales] of salesPlan) {
    await query(
      `INSERT INTO amazon_sales_daily (stat_date, asin, marketplace, units, sales, returns)
       SELECT d::date, $1, $2, $3, $4, 0
         FROM generate_series($5::date, $6::date, '1 day') AS d
       ON CONFLICT (stat_date, asin, marketplace) DO NOTHING`,
      [asin, marketplace, units, sales, RANGE.startDate, RANGE.endDate]
    )
  }
}

async function cleanup(userId) {
  await query('DELETE FROM amazon_ads_daily WHERE asin = ANY($1::text[])', [TEST_ASINS])
  await query('DELETE FROM amazon_sales_daily WHERE asin = ANY($1::text[])', [TEST_ASINS])
  if (userId) await query('DELETE FROM my_asin_items WHERE owner_user_id = $1', [userId])
}

/** 每天固定值 × 30 天的期望汇总（用于核对服务端算出的数字）。 */
const EXPECTED = {
  us: {
    spend: 100 * DAYS,
    adSales: 400 * DAYS,
    orders: 20 * DAYS,
    acos: Math.round((100 / 400) * 100 * 100) / 100,
    units: 10 * DAYS,
    businessSales: 500 * DAYS,
  },
  de: {
    spend: 50 * DAYS,
    adSales: 200 * DAYS,
    orders: 10 * DAYS,
    acos: Math.round((50 / 200) * 100 * 100) / 100,
    units: 4 * DAYS,
    businessSales: 200 * DAYS,
  },
}

async function main() {
  await seedReportRows()

  const adminToken = await login(ADMIN_LOGIN, ADMIN_PASSWORD)
  const owner = await ensureUser(adminToken, { login: OWNER_LOGIN, name: '我的 ASIN 验收账号 A' })
  await ensureUser(adminToken, { login: OTHER_LOGIN, name: '我的 ASIN 验收账号 B' })
  const ownerToken = await login(OWNER_LOGIN, ACCOUNT_PASSWORD)
  const otherToken = await login(OTHER_LOGIN, ACCOUNT_PASSWORD)

  // 幂等：清掉上一次运行留下的条目
  await query('DELETE FROM my_asin_items WHERE owner_user_id = $1', [owner.id])
  await query('DELETE FROM my_asin_items WHERE owner_user_id = (SELECT id FROM users WHERE login = $1)', [
    OTHER_LOGIN,
  ])

  // ── A1 列表
  const list = await request('/api/ai/my-asins', { token: ownerToken, expect: 200 })
  check(
    'A1',
    '列表接口返回条目、站点白名单与上限',
    Array.isArray(list.json.items) &&
      list.json.items.length === 0 &&
      list.json.maxItems === MAX_ITEMS_PER_USER &&
      list.json.marketplaces.includes('US'),
    `items=${list.json.items?.length} maxItems=${list.json.maxItems}`
  )

  // ── A2 单条结构化新增（弹窗表单路径）
  const created = await request('/api/ai/my-asins/items', {
    token: ownerToken,
    method: 'POST',
    body: { items: [{ asin: SUBJECT_ASIN.toLowerCase(), marketplace: 'us', alias: '主力款', note: '观察中' }] },
    expect: 201,
  })
  check(
    'A2',
    '单条新增：ASIN 大写化、站点大写化、别名备注落库',
    created.json.added.length === 1 &&
      created.json.added[0].asin === SUBJECT_ASIN &&
      created.json.added[0].marketplace === 'US' &&
      created.json.itemCount === 1,
    JSON.stringify(created.json.added)
  )

  // ── A3 同站重复
  const duplicated = await request('/api/ai/my-asins/items', {
    token: ownerToken,
    method: 'POST',
    body: { items: [{ asin: SUBJECT_ASIN, marketplace: 'US' }] },
    expect: 201,
  })
  check(
    'A3',
    '同一 ASIN + 同一站点再新增 → duplicated，不重复写入',
    duplicated.json.added.length === 0 &&
      duplicated.json.duplicated.length === 1 &&
      duplicated.json.itemCount === 1,
    `added=${duplicated.json.added.length} duplicated=${duplicated.json.duplicated.length}`
  )

  // ── A4 同 ASIN 换站点 = 合法新增
  const otherSite = await request('/api/ai/my-asins/items', {
    token: ownerToken,
    method: 'POST',
    body: { items: [{ asin: SUBJECT_ASIN, marketplace: 'DE' }] },
    expect: 201,
  })
  check(
    'A4',
    '同一 ASIN 换站点是合法新增（键是 ASIN + 站点）',
    otherSite.json.added.length === 1 &&
      otherSite.json.added[0].marketplace === 'DE' &&
      otherSite.json.itemCount === 2,
    JSON.stringify(otherSite.json.added)
  )

  // ── A5/A6/A7 校验边界
  const badSite = await request('/api/ai/my-asins/items', {
    token: ownerToken,
    method: 'POST',
    body: { items: [{ asin: PEER_ASIN, marketplace: 'ZZ' }] },
  })
  check('A5', '非法站点返回 400（不静默改成默认站点）', badSite.status === 400, `status=${badSite.status}`)

  const emptyAsin = await request('/api/ai/my-asins/items', {
    token: ownerToken,
    method: 'POST',
    body: { items: [{ asin: '   ', marketplace: 'US' }] },
  })
  check('A6', '空 ASIN 返回 400', emptyAsin.status === 400, `status=${emptyAsin.status}`)

  const longAlias = await request('/api/ai/my-asins/items', {
    token: ownerToken,
    method: 'POST',
    body: { items: [{ asin: PEER_ASIN, marketplace: 'US', alias: 'x'.repeat(200) }] },
  })
  check('A7', '超长别名返回 400', longAlias.status === 400, `status=${longAlias.status}`)

  // ── A8 批量粘贴（纯文本 + 重复 + 非法片段）
  const pasted = await request('/api/ai/my-asins/items', {
    token: ownerToken,
    method: 'POST',
    body: {
      asins: `${PEER_ASIN}, ${NO_DATA_ASIN}\n${PEER_ASIN}、夏季款水杯`,
      defaultMarketplace: 'US',
    },
    expect: 201,
  })
  check(
    'A8',
    '批量粘贴：新增 / 内容内重复 / 无法识别分别报告',
    pasted.json.added.length === 2 &&
      pasted.json.repeated.length === 1 &&
      pasted.json.invalid.length === 1 &&
      pasted.json.itemCount === 4,
    `added=${pasted.json.added.length} repeated=${pasted.json.repeated.length} invalid=${pasted.json.invalid.join('/')} itemCount=${pasted.json.itemCount}`
  )

  // ── A9 表格文本粘贴（带站点列）
  const tablePaste = await request('/api/ai/my-asins/items', {
    token: ownerToken,
    method: 'POST',
    body: {
      asins: ['ASIN\t站点\t别名\t备注', `${PENDING_ASIN}\t英国\t表格款\t来自 Excel`].join('\n'),
      defaultMarketplace: 'US',
    },
    expect: 201,
  })
  check(
    'A9',
    '从 Excel 复制的表格文本：站点列被识别并按站点落库',
    tablePaste.json.table === true &&
      tablePaste.json.added.length === 1 &&
      tablePaste.json.added[0].marketplace === 'UK',
    JSON.stringify(tablePaste.json.added)
  )

  // ── 取回条目，供后续更新/删除使用
  const afterAdd = await request('/api/ai/my-asins', { token: ownerToken, expect: 200 })
  const subjectUsItem = afterAdd.json.items.find(
    (item) => item.asin === SUBJECT_ASIN && item.marketplace === 'US'
  )
  const pendingItem = afterAdd.json.items.find((item) => item.asin === PENDING_ASIN)

  // ── A10 更新别名/备注
  const updated = await request(`/api/ai/my-asins/items/${subjectUsItem.id}`, {
    token: ownerToken,
    method: 'PATCH',
    body: { alias: '主力款 v2', note: '已复核' },
    expect: 200,
  })
  check(
    'A10',
    '更新别名与备注',
    updated.json.item.alias === '主力款 v2' && updated.json.item.note === '已复核',
    JSON.stringify({ alias: updated.json.item.alias, note: updated.json.item.note })
  )

  // ── A11 改站点：先挪到 CA，再挪到一个已存在同一 ASIN 的站点（US），最后挪回来
  const subjectDeItem = afterAdd.json.items.find(
    (item) => item.asin === SUBJECT_ASIN && item.marketplace === 'DE'
  )
  const moved = await request(`/api/ai/my-asins/items/${subjectDeItem.id}`, {
    token: ownerToken,
    method: 'PATCH',
    body: { marketplace: 'CA' },
    expect: 200,
  })
  const moveConflict = await request(`/api/ai/my-asins/items/${subjectDeItem.id}`, {
    token: ownerToken,
    method: 'PATCH',
    body: { marketplace: 'US' },
  })
  const movedBack = await request(`/api/ai/my-asins/items/${subjectDeItem.id}`, {
    token: ownerToken,
    method: 'PATCH',
    body: { marketplace: 'DE' },
    expect: 200,
  })
  check(
    'A11',
    '改站点成功；目标站点已有同一 ASIN 时返回 400 而不是 500；可以改回来',
    moved.json.item.marketplace === 'CA' &&
      moveConflict.status === 400 &&
      movedBack.json.item.marketplace === 'DE',
    `moved=${moved.json.item.marketplace} conflict=${moveConflict.status} back=${movedBack.json.item.marketplace}`
  )

  // ── A11b 改 ASIN（身份的一部分，2026-09-18 起可改）
  const noDataItem = afterAdd.json.items.find(
    (item) => item.asin === NO_DATA_ASIN && item.marketplace === 'US'
  )
  const renamedAsin = 'B0MYASIN09'
  const renamed = await request(`/api/ai/my-asins/items/${noDataItem.id}`, {
    token: ownerToken,
    method: 'PATCH',
    body: { asin: renamedAsin.toLowerCase() },
    expect: 200,
  })
  check(
    'A11b',
    '改 ASIN：小写输入被归一化为大写，站点与别名不变',
    renamed.json.item.asin === renamedAsin &&
      renamed.json.item.marketplace === 'US' &&
      renamed.json.item.alias === noDataItem.alias,
    JSON.stringify({
      asin: renamed.json.item.asin,
      marketplace: renamed.json.item.marketplace,
    })
  )

  // ── A11c 改成已存在的 (ASIN, 站点) → 400，且原值不变
  const renameConflict = await request(`/api/ai/my-asins/items/${noDataItem.id}`, {
    token: ownerToken,
    method: 'PATCH',
    body: { asin: SUBJECT_ASIN, marketplace: 'US' },
  })
  const afterConflict = await request('/api/ai/my-asins', { token: ownerToken, expect: 200 })
  const stillRenamed = afterConflict.json.items.find((item) => item.id === noDataItem.id)
  check(
    'A11c',
    '改 ASIN 到已存在的同站点组合：返回 400 且原值不变',
    renameConflict.status === 400 && stillRenamed?.asin === renamedAsin,
    `status=${renameConflict.status} asin=${stillRenamed?.asin}`
  )

  // ── A11d 同时改 ASIN + 站点（合法组合）→ 200
  const renamedSite = await request(`/api/ai/my-asins/items/${noDataItem.id}`, {
    token: ownerToken,
    method: 'PATCH',
    body: { asin: renamedAsin, marketplace: 'CA' },
    expect: 200,
  })
  check(
    'A11d',
    '同时改 ASIN 与站点成功',
    renamedSite.json.item.marketplace === 'CA' &&
      renamedSite.json.item.asin === renamedAsin,
    JSON.stringify({
      asin: renamedSite.json.item.asin,
      marketplace: renamedSite.json.item.marketplace,
    })
  )

  // ── A11e 改回原值：后面的指标 / 工具断言依赖"US 站有一个无数据的 ASIN"这一形态
  const restored = await request(`/api/ai/my-asins/items/${noDataItem.id}`, {
    token: ownerToken,
    method: 'PATCH',
    body: { asin: NO_DATA_ASIN, marketplace: 'US' },
    expect: 200,
  })
  check(
    'A11e',
    '改回原 ASIN 与站点',
    restored.json.item.asin === NO_DATA_ASIN &&
      restored.json.item.marketplace === 'US',
    JSON.stringify({ asin: restored.json.item.asin, marketplace: restored.json.item.marketplace })
  )

  // ── A12 移除单条
  const removed = await request(`/api/ai/my-asins/items/${pendingItem.id}`, {
    token: ownerToken,
    method: 'DELETE',
    expect: 200,
  })
  check('A12', '移除单条 ASIN', removed.json.deleted === true && removed.json.id === pendingItem.id)

  // ── A13 账号隔离
  const otherList = await request('/api/ai/my-asins', { token: otherToken, expect: 200 })
  const otherPatch = await request(`/api/ai/my-asins/items/${subjectUsItem.id}`, {
    token: otherToken,
    method: 'PATCH',
    body: { alias: '越权' },
  })
  const otherDelete = await request(`/api/ai/my-asins/items/${subjectUsItem.id}`, {
    token: otherToken,
    method: 'DELETE',
  })
  check(
    'A13',
    '账号隔离：他人列表看不到，改/删他人条目一律 404',
    otherList.json.items.length === 0 && otherPatch.status === 404 && otherDelete.status === 404,
    `list=${otherList.json.items.length} patch=${otherPatch.status} delete=${otherDelete.status}`
  )

  // ── A14 模板下载（真 xlsx）
  const template = await fetch(`${BASE}/api/ai/my-asins/template`, {
    headers: { authorization: `Bearer ${ownerToken}` },
  })
  const templateBuffer = Buffer.from(await template.arrayBuffer())
  check(
    'A14',
    '模板下载是真 xlsx（ZIP 魔数）+ 正确的 Content-Type',
    template.status === 200 &&
      templateBuffer.subarray(0, 2).toString('latin1') === 'PK' &&
      String(template.headers.get('content-type')).includes('spreadsheetml'),
    `status=${template.status} magic=${templateBuffer.subarray(0, 2).toString('latin1')}`
  )

  // ── A15/A16 表格文件导入：先预览、后落库
  const importAsin = 'B0MYASIN05'
  const csvText = [
    'ASIN,站点,别名,备注',
    `${SUBJECT_ASIN},DE,已存在的组合,`,
    `${importAsin},jp,导入新增,来自 CSV`,
    'bad-row,,,',
  ].join('\n')

  const beforeImport = await request('/api/ai/my-asins', { token: ownerToken, expect: 200 })
  const preview = await uploadTable('/api/ai/my-asins/import?dryRun=true', {
    token: ownerToken,
    fileName: 'my-asins.csv',
    body: Buffer.from(csvText, 'utf8'),
  })
  const afterPreview = await request('/api/ai/my-asins', { token: ownerToken, expect: 200 })
  check(
    'A15',
    '导入预览：识别站点/别名/备注列，且**不写库**',
    preview.status === 200 &&
      preview.json.summary.mapping.asin === 0 &&
      preview.json.summary.mapping.marketplace === 1 &&
      preview.json.summary.entries === 2 &&
      preview.json.summary.addCount === 1 &&
      preview.json.summary.duplicated.length === 1 &&
      preview.json.summary.invalid.length === 1 &&
      afterPreview.json.items.length === beforeImport.json.items.length,
    `mapping=${JSON.stringify(preview.json.summary?.mapping)} addCount=${preview.json.summary?.addCount} before=${beforeImport.json.items.length} after=${afterPreview.json.items.length}`
  )

  const imported = await uploadTable('/api/ai/my-asins/import', {
    token: ownerToken,
    fileName: 'my-asins.csv',
    body: Buffer.from(csvText, 'utf8'),
  })
  const importedList = await request('/api/ai/my-asins', { token: ownerToken, expect: 200 })
  const importedItem = importedList.json.items.find((item) => item.asin === importAsin)
  check(
    'A16',
    '确认导入：条目落库并带上站点与别名',
    imported.status === 200 &&
      imported.json.added.length === 1 &&
      importedItem?.marketplace === 'JP' &&
      importedItem?.alias === '导入新增',
    JSON.stringify(importedItem)
  )

  // ── A17/A18 导入的错误分支
  const xlsImport = await uploadTable('/api/ai/my-asins/import?dryRun=true', {
    token: ownerToken,
    fileName: 'old.xls',
    body: Buffer.from('x'),
  })
  check('A17', '上传 .xls 明确返回 400（提示另存为 .xlsx）', xlsImport.status === 400, `status=${xlsImport.status}`)

  const badHeader = await uploadTable('/api/ai/my-asins/import?dryRun=true', {
    token: ownerToken,
    fileName: 'bad.csv',
    body: Buffer.from('商品,价格\n水杯,19.9\n', 'utf8'),
  })
  check(
    'A18',
    '表里找不到 ASIN 列时返回 400 并回显表头',
    badHeader.status === 400 && String(badHeader.json?.message ?? '').includes('商品'),
    `status=${badHeader.status}`
  )

  // ── A19/A20/A21/A22 指标
  const metrics = await request(
    `/api/ai/my-asins/metrics?startDate=${RANGE.startDate}&endDate=${RANGE.endDate}`,
    { token: ownerToken, expect: 200 }
  )
  const usRow = metrics.json.rows.find(
    (row) => row.asin === SUBJECT_ASIN && row.marketplace === 'US'
  )
  check(
    'A19',
    'US 站指标与库内真值一致（花费/广告销售额/订单/ACoS/销量/销售额）',
    usRow?.spend === EXPECTED.us.spend &&
      usRow?.adSales === EXPECTED.us.adSales &&
      usRow?.orders === EXPECTED.us.orders &&
      usRow?.acos === EXPECTED.us.acos &&
      usRow?.units === EXPECTED.us.units &&
      usRow?.businessSales === EXPECTED.us.businessSales,
    JSON.stringify({
      spend: usRow?.spend,
      adSales: usRow?.adSales,
      acos: usRow?.acos,
      units: usRow?.units,
    })
  )

  const noDataRow = metrics.json.rows.find(
    (row) => row.asin === NO_DATA_ASIN && row.marketplace === 'US'
  )
  check(
    'A20',
    '没有报表记录的 ASIN：覆盖为「无数据」且金额是 null（不折算成 0）',
    noDataRow?.coverage === '无数据' && noDataRow?.spend === null && noDataRow?.units === null,
    JSON.stringify({ coverage: noDataRow?.coverage, spend: noDataRow?.spend })
  )

  const groupSites = (metrics.json.groups ?? []).map((group) => group.marketplace).sort()
  const summaryKeys = Object.keys(metrics.json.summary ?? {})
  check(
    'A21',
    '多站点指标按站点分组，且顶层**没有跨站点金额合计**',
    groupSites.includes('US') &&
      groupSites.includes('DE') &&
      !summaryKeys.includes('spend') &&
      !summaryKeys.includes('sales') &&
      !summaryKeys.includes('acos'),
    `groups=${groupSites.join('/')} summaryKeys=${summaryKeys.join(',')}`
  )

  check(
    'A22',
    '区间天数按起止日期计算',
    metrics.json.period?.days === DAYS && metrics.json.period?.startDate === RANGE.startDate,
    JSON.stringify(metrics.json.period)
  )

  // ── A29–A34 人工录入的区间指标（2026-09-18：手工值优先，未填字段用报表）
  const subjectUsItemNow = afterAdd.json.items.find(
    (item) => item.asin === SUBJECT_ASIN && item.marketplace === 'US'
  )
  const manualSave = await request(`/api/ai/my-asins/items/${subjectUsItemNow.id}/metrics`, {
    token: ownerToken,
    method: 'PUT',
    body: { startDate: RANGE.startDate, endDate: RANGE.endDate, spend: 999.99, units: 7 },
    expect: 200,
  })
  check(
    'A29',
    '录入人工指标：填了的项写入，未填的为 null（= 继续用报表）',
    manualSave.json.override?.spend === 999.99 &&
      manualSave.json.override?.units === 7 &&
      manualSave.json.override?.adSales === null &&
      manualSave.json.override?.businessSales === null,
    JSON.stringify(manualSave.json.override)
  )

  const metricsWithManual = await request(
    `/api/ai/my-asins/metrics?startDate=${RANGE.startDate}&endDate=${RANGE.endDate}`,
    { token: ownerToken, expect: 200 }
  )
  const manualRow = metricsWithManual.json.rows.find(
    (row) => row.asin === SUBJECT_ASIN && row.marketplace === 'US'
  )
  check(
    'A30',
    '页面指标：人工值优先、未填字段仍取报表，并带 manual 标记',
    manualRow?.spend === 999.99 &&
      manualRow?.units === 7 &&
      manualRow?.adSales === EXPECTED.us.adSales &&
      manualRow?.businessSales === EXPECTED.us.businessSales &&
      manualRow?.manual === true,
    JSON.stringify({
      spend: manualRow?.spend,
      units: manualRow?.units,
      adSales: manualRow?.adSales,
      manual: manualRow?.manual,
    })
  )

  const noDataItemNow = afterAdd.json.items.find(
    (item) => item.asin === NO_DATA_ASIN && item.marketplace === 'US'
  )
  await request(`/api/ai/my-asins/items/${noDataItemNow.id}/metrics`, {
    token: ownerToken,
    method: 'PUT',
    body: { startDate: RANGE.startDate, endDate: RANGE.endDate, spend: 500 },
    expect: 200,
  })
  const metricsAfterNoDataManual = await request(
    `/api/ai/my-asins/metrics?startDate=${RANGE.startDate}&endDate=${RANGE.endDate}`,
    { token: ownerToken, expect: 200 }
  )
  const noDataManualRow = metricsAfterNoDataManual.json.rows.find(
    (row) => row.asin === NO_DATA_ASIN && row.marketplace === 'US'
  )
  check(
    'A31',
    '报表本来没有数据的 ASIN：只填花费后覆盖情况自动推导为「仅广告」',
    noDataManualRow?.coverage === '仅广告' && noDataManualRow?.spend === 500,
    JSON.stringify({
      coverage: noDataManualRow?.coverage,
      spend: noDataManualRow?.spend,
    })
  )

  const otherPeriod = await request(
    '/api/ai/my-asins/metrics?startDate=2026-05-01&endDate=2026-05-31',
    { token: ownerToken, expect: 200 }
  )
  const otherPeriodRow = otherPeriod.json.rows.find(
    (row) => row.asin === SUBJECT_ASIN && row.marketplace === 'US'
  )
  check(
    'A32',
    '人工值只对录入的那个区间生效（换区间回到报表口径）',
    otherPeriodRow?.spend !== 999.99 && otherPeriodRow?.manual !== true,
    JSON.stringify({ spend: otherPeriodRow?.spend, manual: otherPeriodRow?.manual })
  )

  // 恢复现场：后面工具断言的合计依赖"US 站只有 SUBJECT 有报表数据"
  await request(
    `/api/ai/my-asins/items/${noDataItemNow.id}/metrics?startDate=${RANGE.startDate}&endDate=${RANGE.endDate}`,
    { token: ownerToken, method: 'DELETE', expect: 200 }
  )

  const badManual = await request(`/api/ai/my-asins/items/${subjectUsItemNow.id}/metrics`, {
    token: ownerToken,
    method: 'PUT',
    body: { startDate: RANGE.startDate, endDate: RANGE.endDate, spend: -1 },
  })
  check('A33', '人工指标为负数 → 400', badManual.status === 400, `status=${badManual.status}`)

  const clearedManual = await request(
    `/api/ai/my-asins/items/${subjectUsItemNow.id}/metrics?startDate=${RANGE.startDate}&endDate=${RANGE.endDate}`,
    { token: ownerToken, method: 'DELETE', expect: 200 }
  )
  const metricsAfterClear = await request(
    `/api/ai/my-asins/metrics?startDate=${RANGE.startDate}&endDate=${RANGE.endDate}`,
    { token: ownerToken, expect: 200 }
  )
  const clearedRow = metricsAfterClear.json.rows.find(
    (row) => row.asin === SUBJECT_ASIN && row.marketplace === 'US'
  )
  check(
    'A34',
    '清除人工值后回到报表口径',
    clearedManual.json.removed === true &&
      clearedRow?.spend === EXPECTED.us.spend &&
      !clearedRow?.manual,
    JSON.stringify({ spend: clearedRow?.spend, manual: clearedRow?.manual })
  )

  // ── A23/A24 区间校验
  const halfRange = await request(`/api/ai/my-asins/metrics?startDate=${RANGE.startDate}`, {
    token: ownerToken,
  })
  check('A23', '自定义区间只给一半 → 400', halfRange.status === 400, `status=${halfRange.status}`)

  const tooLong = await request(
    '/api/ai/my-asins/metrics?startDate=2025-01-01&endDate=2026-06-30',
    { token: ownerToken }
  )
  check('A24', '区间超过 366 天 → 400', tooLong.status === 400, `status=${tooLong.status}`)

  // ── A25 工具注册
  const tools = await request('/api/ai/tools', { token: ownerToken, expect: 200 })
  const toolNames = tools.json.tools.map((tool) => tool.name)
  check(
    'A25',
    'query_my_asins 已注册给普通员工，query_asin_watchlist 已下线',
    toolNames.includes('query_my_asins') && !toolNames.includes('query_asin_watchlist'),
    toolNames.join(',')
  )

  // ── A26/A27/A28 工具执行
  const userRow = await query('SELECT id, login, role, status FROM users WHERE id = $1', [owner.id])
  const registeredTools = await loadRegisteredTools(userRow.rows[0])

  const toolResult = await executeTool({
    user: userRow.rows[0],
    registeredTools,
    toolName: 'query_my_asins',
    params: { startDate: RANGE.startDate, endDate: RANGE.endDate },
    ctx: {},
  })
  const tableBlocks = (toolResult.blocks ?? []).filter((block) => block.kind === 'table')
  /*
   * 只有"按站点分组的块"才带站点前缀与站点列；工具还会额外产出全局的清单明细块
   * （2026-09-18 别人补的"让 AI 能列出我的 ASIN"），断言不能要求每个表块都带站点前缀。
   */
  const siteBlocks = tableBlocks.filter((block) =>
    /^(US|UK|DE|FR|IT|ES|JP|CA|MX|AU) · /.test(String(block.title))
  )
  check(
    'A26',
    'AI 工具按站点分组取数：分站点标题、明细带站点列、摘要声明不可相加',
    toolResult.status === 'ok' &&
      siteBlocks.length >= 2 &&
      siteBlocks.every((block) =>
        block.columns.some((column) => column.key === 'marketplace')
      ) &&
      toolResult.summary.includes('不能相加') &&
      toolResult.summary.includes(String(EXPECTED.us.spend)),
    `status=${toolResult.status} tableBlocks=${tableBlocks.length} siteBlocks=${siteBlocks.length}`
  )

  const usOnly = await executeTool({
    user: userRow.rows[0],
    registeredTools,
    toolName: 'query_my_asins',
    params: { marketplace: 'US', startDate: RANGE.startDate, endDate: RANGE.endDate },
    ctx: {},
  })
  check(
    'A27',
    '工具支持按站点过滤（只给 US 时不含 DE）',
    usOnly.status === 'ok' &&
      usOnly.summary.includes('站点 US') &&
      !usOnly.summary.includes('站点 DE'),
    usOnly.summary.split('\n')[0]?.slice(0, 80)
  )

  const unknownAsin = await executeTool({
    user: userRow.rows[0],
    registeredTools,
    toolName: 'query_my_asins',
    params: { asins: ['B0NOTEXIST'], startDate: RANGE.startDate, endDate: RANGE.endDate },
    ctx: {},
  })
  check(
    'A28',
    '工具指定列表中不存在的 ASIN 时如实说明，不编造数据',
    unknownAsin.status === 'ok' &&
      unknownAsin.empty === true &&
      unknownAsin.summary.includes('不在「我的 ASIN」列表里'),
    unknownAsin.summary.split('\n')[0]?.slice(0, 80)
  )

  // ── A35 人工指标同样进入 AI 工具（页面与工具共用同一处合并）
  await request(`/api/ai/my-asins/items/${subjectUsItemNow.id}/metrics`, {
    token: ownerToken,
    method: 'PUT',
    body: { startDate: RANGE.startDate, endDate: RANGE.endDate, spend: 1234.5 },
    expect: 200,
  })
  const toolWithManual = await executeTool({
    user: userRow.rows[0],
    registeredTools,
    toolName: 'query_my_asins',
    params: { marketplace: 'US', startDate: RANGE.startDate, endDate: RANGE.endDate },
    ctx: {},
  })
  check(
    'A35',
    'AI 工具读到同一份人工值，并在摘要里说明它是人工录入',
    toolWithManual.status === 'ok' &&
      toolWithManual.summary.includes('人工录入') &&
      toolWithManual.summary.includes('1234.5'),
    toolWithManual.summary.split('\n').slice(0, 2).join(' ').slice(0, 120)
  )
  await request(
    `/api/ai/my-asins/items/${subjectUsItemNow.id}/metrics?startDate=${RANGE.startDate}&endDate=${RANGE.endDate}`,
    { token: ownerToken, method: 'DELETE', expect: 200 }
  )

  await cleanup(owner.id)
  await query('DELETE FROM my_asin_items WHERE owner_user_id = (SELECT id FROM users WHERE login = $1)', [
    OTHER_LOGIN,
  ])

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

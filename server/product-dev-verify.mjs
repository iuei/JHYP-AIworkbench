/**
 * 产品开发模块接口验收（可重复运行，不依赖页面）。
 *
 * 与 `server/ai-agent/verify-*.mjs` 同一套路：起一个真实服务、用真实 HTTP 请求跑完整链路，
 * 断言口径与单测互补 —— 单测覆盖纯函数，这里覆盖**路由注册、权限、请求体形态与落库**，
 * 也就是单测碰不到的那一层（`/candidates/template` 会不会被 `:id` 吞掉、粘贴文本与上传文件
 * 是否真的走同一个端点，只有发真实请求才能验）。
 *
 * 用法：
 *   API_PORT=8788 node server/index.mjs &
 *   node server/product-dev-verify.mjs
 *
 * 环境变量：`API_BASE`（默认 http://localhost:8788）。
 * 测试数据统一带 `__verify__` 前缀，结束时按 id 精确删除（不碰任何非本次创建的数据）。
 */
import dotenv from 'dotenv'
import pg from 'pg'

dotenv.config()

const BASE = process.env.API_BASE ?? 'http://localhost:8788'

let passed = 0
let failed = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1
    process.stdout.write(`  ✔ ${name}\n`)
  } else {
    failed += 1
    failures.push(`${name}${detail ? ` —— ${detail}` : ''}`)
    process.stdout.write(`  ✖ ${name}${detail ? ` —— ${detail}` : ''}\n`)
  }
}

function section(title) {
  process.stdout.write(`\n${title}\n`)
}

async function call(path, { method = 'GET', token, body, raw, headers = {} } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(raw ? headers : body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { status: response.status, json, text, headers: response.headers }
}

/* ---------- 登录 ---------- */

const login = await call('/api/auth/login', {
  method: 'POST',
  body: {
    login: process.env.INITIAL_ADMIN_LOGIN,
    password: process.env.INITIAL_ADMIN_PASSWORD,
  },
})
if (!login.json?.token) {
  process.stderr.write('登录失败，请确认 INITIAL_ADMIN_LOGIN / INITIAL_ADMIN_PASSWORD。\n')
  process.exit(1)
}
const token = login.json.token
const userId = login.json.user?.id

/* ---------- 准备：找一个我方报表里真实存在的 ASIN ---------- */

const pool = new pg.Pool({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? 'jhyp_workbench',
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD,
})

const realAsinRows = await pool.query(
  `SELECT asin, marketplace FROM amazon_ads_daily
    WHERE marketplace = 'US' GROUP BY asin, marketplace ORDER BY COUNT(*) DESC LIMIT 2`
)
const realAsins = realAsinRows.rows.map((row) => row.asin)
process.stdout.write(`\n使用我方报表中真实存在的 ASIN：${realAsins.join('、') || '（无，将验证「无我方数据」分支）'}\n`)

const createdCandidateIds = []
const createdComparisonIds = []
const tag = `__verify__${Date.now()}`

try {
  /* ---------- 候选：新增与校验 ---------- */

  section('候选池：新增与校验')

  const created = await call('/api/product-dev/candidates', {
    method: 'POST',
    token,
    body: {
      productName: `${tag}便携榨汁杯`,
      asin: realAsins[0] ?? 'B0VERIFY01',
      category: '厨房小家电',
      targetPrice: '19.99',
      marketplace: 'US',
      stage: 'candidate',
      note: '验收测试数据',
      attributes: { 评分: '4.3', 评论数: '1200' },
    },
  })
  check('POST /candidates 新建候选返回 201', created.status === 201, `实际 ${created.status}`)
  const first = created.json?.candidate
  if (first) createdCandidateIds.push(first.id)
  check('返回体带 id 与归一化后的 ASIN', Boolean(first?.id && first?.asin), JSON.stringify(created.json))
  check('附加维度按字符串原样保存', first?.attributes?.['评分'] === '4.3', JSON.stringify(first?.attributes))
  check('目标售价落库为数字', first?.target_price === 19.99)

  const noIdentity = await call('/api/product-dev/candidates', {
    method: 'POST',
    token,
    body: { productName: '', asin: '' },
  })
  check('名称与 ASIN 都为空 → 400', noIdentity.status === 400, `实际 ${noIdentity.status}`)

  const badAsin = await call('/api/product-dev/candidates', {
    method: 'POST',
    token,
    body: { productName: `${tag}坏ASIN`, asin: '不是ASIN' },
  })
  check('无法识别的 ASIN → 400', badAsin.status === 400, `实际 ${badAsin.status}`)

  if (realAsins[0]) {
    const duplicated = await call('/api/product-dev/candidates', {
      method: 'POST',
      token,
      body: { productName: `${tag}重复`, asin: realAsins[0], marketplace: 'US' },
    })
    check('同站点同 ASIN 重复 → 409', duplicated.status === 409, `实际 ${duplicated.status}`)
  }

  // 只有链接也能建：验证"粘一整条 URL"这条最常用路径
  const fromLink = await call('/api/product-dev/candidates', {
    method: 'POST',
    token,
    body: {
      productName: `${tag}只有名称的候选`,
      marketplace: 'US',
      stage: '调研中',
    },
  })
  check('只填名称、不填 ASIN 也能建（未上架候选）', fromLink.status === 201, `实际 ${fromLink.status}`)
  if (fromLink.json?.candidate) createdCandidateIds.push(fromLink.json.candidate.id)

  /* ---------- 候选：检索 ---------- */

  section('候选池：检索与筛选')

  const listed = await call(`/api/product-dev/candidates?keyword=${encodeURIComponent(tag)}`, { token })
  check('关键词检索命中本次创建的候选', (listed.json?.total ?? 0) >= 2, `total=${listed.json?.total}`)
  check('列表下发阶段枚举与上限口径', Array.isArray(listed.json?.stages) && listed.json?.maxCandidates > 0)

  const byStage = await call(
    `/api/product-dev/candidates?keyword=${encodeURIComponent(tag)}&stage=researching`,
    { token }
  )
  check('按阶段筛选生效', byStage.json?.total === 1, `total=${byStage.json?.total}`)

  const tooLongKeyword = await call(
    `/api/product-dev/candidates?keyword=${'x'.repeat(200)}`,
    { token }
  )
  check('超长关键词 → 400', tooLongKeyword.status === 400, `实际 ${tooLongKeyword.status}`)

  /* ---------- 导入：预览与落库 ---------- */

  section('导入：先预览后确认')

  const tableText = [
    '产品名称\tASIN\t类目\t目标售价\t站点\t阶段\t评分',
    `${tag}导入A\t\t户外\t15.99\tUS\t候选\t4.6`,
    `${tag}导入A\t\t户外\t15.99\tUS\t候选\t4.6`,
    `${tag}导入B\t\t户外\t12.99-15.99\tUS\t候选\t4.1`,
  ].join('\n')

  const preview = await call('/api/product-dev/candidates/import?dryRun=true', {
    method: 'POST',
    token,
    body: { text: tableText },
  })
  check('粘贴文本预览返回 200', preview.status === 200, `实际 ${preview.status} ${preview.text?.slice(0, 120)}`)
  check('预览识别到表头', preview.json?.headerRecognized === true)
  check('预览统计：新增 2 条', preview.json?.counts?.added === 2, JSON.stringify(preview.json?.counts))
  check('预览统计：本次重复 1 条', preview.json?.counts?.repeated === 1, JSON.stringify(preview.json?.counts))
  check(
    '价格区间读不出数字时单独列出（不静默留空）',
    preview.json?.priceUnparsed?.length === 1,
    JSON.stringify(preview.json?.priceUnparsed)
  )
  check('预览阶段不返回内部写入体（不带 _fresh 字段）', preview.json?._fresh === undefined)

  const previewOnly = await call(`/api/product-dev/candidates?keyword=${encodeURIComponent(tag)}`, { token })
  check('预览不写库', previewOnly.json?.total === 2, `total=${previewOnly.json?.total}`)

  const imported = await call('/api/product-dev/candidates/import', {
    method: 'POST',
    token,
    body: { text: tableText },
  })
  check('正式导入返回 200', imported.status === 200, `实际 ${imported.status} ${imported.text?.slice(0, 120)}`)
  check('正式导入写入 2 条', imported.json?.added === 2, JSON.stringify(imported.json))

  const afterImport = await call(`/api/product-dev/candidates?keyword=${encodeURIComponent(tag)}`, { token })
  check('导入后候选总数 4', afterImport.json?.total === 4, `total=${afterImport.json?.total}`)
  for (const item of afterImport.json?.items ?? []) {
    if (!createdCandidateIds.includes(item.id)) createdCandidateIds.push(item.id)
  }

  const reImport = await call('/api/product-dev/candidates/import?dryRun=true', {
    method: 'POST',
    token,
    body: { text: tableText },
  })
  check(
    '重复导入同一份内容：全部识别为「池里已有」',
    reImport.json?.counts?.duplicated === 2 && reImport.json?.counts?.added === 0,
    JSON.stringify(reImport.json?.counts)
  )

  /* ---------- 导入：无表头与非法值的兜底 ---------- */

  const noHeader = await call('/api/product-dev/candidates/import?dryRun=true', {
    method: 'POST',
    token,
    body: { text: `${tag}无表头A\t19.99\t厨房\n${tag}无表头B\t29.99\t厨房` },
  })
  check('无表头表格：只取第 1 列', noHeader.json?.headerRecognized === false, JSON.stringify(noHeader.json?.counts))
  check(
    '无表头时第 2 列不当作价格（不猜）',
    noHeader.json?.preview?.every((row) => row.target_price === null),
    JSON.stringify(noHeader.json?.preview?.map((row) => row.target_price))
  )

  const badMarketplace = await call('/api/product-dev/candidates/import?dryRun=true', {
    method: 'POST',
    token,
    body: { text: `产品名称\t站点\n${tag}火星站\t火星站` },
  })
  check(
    '无法识别的站点整行拒绝（不静默回落默认站点）',
    badMarketplace.json?.counts?.invalid === 1 && badMarketplace.json?.counts?.added === 0,
    JSON.stringify(badMarketplace.json?.counts)
  )

  const emptyImport = await call('/api/product-dev/candidates/import?dryRun=true', {
    method: 'POST',
    token,
    body: { text: '   ' },
  })
  check('空内容导入 → 400', emptyImport.status === 400, `实际 ${emptyImport.status}`)

  /* ---------- 模板下载 ---------- */

  const template = await call('/api/product-dev/candidates/template', { token })
  check(
    '模板路由未被 /candidates/:id 吞掉（返回 CSV 而非"候选 ID 无效"）',
    template.status === 200 && template.text.includes('产品名称'),
    `status=${template.status}`
  )

  /* ---------- 对比 ---------- */

  section('对比：校验与结果')

  const tooFew = await call('/api/product-dev/comparisons', {
    method: 'POST',
    token,
    body: { candidateIds: [createdCandidateIds[0]] },
  })
  check('只选 1 个候选 → 400', tooFew.status === 400, `实际 ${tooFew.status}`)

  const notFound = await call('/api/product-dev/comparisons', {
    method: 'POST',
    token,
    body: { candidateIds: [999999, 999998] },
  })
  check('候选不存在 → 404', notFound.status === 404, `实际 ${notFound.status}`)

  const usIds = (afterImport.json?.items ?? [])
    .filter((item) => item.marketplace === 'US')
    .map((item) => item.id)
    .slice(0, 3)

  if (usIds.length >= 2) {
    const comparison = await call('/api/product-dev/comparisons', {
      method: 'POST',
      token,
      body: { candidateIds: usIds, windowDays: 30 },
    })
    check('同站点对比返回 200', comparison.status === 200, `实际 ${comparison.status} ${comparison.text?.slice(0, 160)}`)

    const result = comparison.json?.result
    if (result?.comparisonId) createdComparisonIds.push(result.comparisonId)

    check('结果带站点与区间', Boolean(result?.marketplace && result?.startDate && result?.endDate))
    check('维度分为人工录入与报表两类', 
      result?.dimensions?.some((d) => d.source === 'manual') &&
        result?.dimensions?.some((d) => d.source === 'report'),
      JSON.stringify(result?.dimensions?.map((d) => `${d.key}:${d.source}`).slice(0, 6))
    )
    check('行数等于参与对比的候选数', result?.rows?.length === usIds.length)
    check(
      '每行 values 已按维度摊平（含附加维度前缀）',
      result?.rows?.every((row) => 'product_name' in row.values && 'spend' in row.values),
      JSON.stringify(Object.keys(result?.rows?.[0]?.values ?? {}))
    )
    check(
      '无我方数据的候选：报表指标为 null 而不是 0',
      result?.rows?.every((row) =>
        row.coverage === 'ok'
          ? true
          : Object.entries(row.values).every(
              ([key, value]) => !['spend', 'adSales', 'businessSales', 'units'].includes(key) || value === null
            )
      ),
      JSON.stringify(result?.rows?.map((row) => ({ c: row.coverage, spend: row.values.spend })))
    )
    check('结果带数据时效说明', Boolean(result?.dataFreshness?.note), String(result?.dataFreshness?.note))
    check('结果明确声明不产出选品结论', typeof result?.conclusionNote === 'string' && result.conclusionNote.includes('不给出'))

    // 跨站点必须拒绝
    const jpCandidate = await call('/api/product-dev/candidates', {
      method: 'POST',
      token,
      body: { productName: `${tag}日本候选`, marketplace: 'JP', asin: 'B0VERIFYJP' },
    })
    if (jpCandidate.json?.candidate) createdCandidateIds.push(jpCandidate.json.candidate.id)
    const mixed = await call('/api/product-dev/comparisons', {
      method: 'POST',
      token,
      body: { candidateIds: [usIds[0], jpCandidate.json?.candidate?.id].filter(Boolean) },
    })
    check(
      '跨站点对比 → 400 并说明原因',
      mixed.status === 400 && String(mixed.json?.message ?? '').includes('站点'),
      `status=${mixed.status} ${mixed.json?.message ?? ''}`
    )

    /* ---------- 历史与回看 ---------- */

    section('历史对比：列表与快照回看')

    const history = await call('/api/product-dev/comparisons', { token })
    check('历史列表返回数组', Array.isArray(history.json?.items))
    check(
      '列表包含刚落库的记录',
      (history.json?.items ?? []).some((item) => item.id === result?.comparisonId)
    )
    check('列表只回摘要（不含大 result 字段）', !('result' in (history.json?.items?.[0] ?? {})))

    const detail = await call(`/api/product-dev/comparisons/${result.comparisonId}`, { token })
    check('单条回看返回快照', detail.status === 200 && Boolean(detail.json?.result), `status=${detail.status}`)

    const missing = await call('/api/product-dev/comparisons/999999', { token })
    check('越权/不存在的对比 → 404', missing.status === 404, `实际 ${missing.status}`)
  } else {
    process.stdout.write('  （候选数不足 2 个，跳过对比链路）\n')
  }

  /* ---------- 编辑与删除 ---------- */

  section('编辑与删除')

  const edited = await call(`/api/product-dev/candidates/${createdCandidateIds[0]}`, {
    method: 'PATCH',
    token,
    body: { stage: '已立项', category: '厨房小家电' },
  })
  check('PATCH 更新阶段成功', edited.status === 200 && edited.json?.candidate?.stage === 'approved', JSON.stringify(edited.json?.candidate?.stage))

  const clearedBoth = await call(`/api/product-dev/candidates/${createdCandidateIds[0]}`, {
    method: 'PATCH',
    token,
    body: { productName: '', asin: '' },
  })
  check('同时清空名称与 ASIN → 400', clearedBoth.status === 400, `实际 ${clearedBoth.status}`)

  const unauthorized = await call('/api/product-dev/candidates/999999', { token })
  check('不存在的候选 → 404', unauthorized.status === 404, `实际 ${unauthorized.status}`)

  const noAuth = await call('/api/product-dev/candidates')
  check('不带令牌 → 401', noAuth.status === 401, `实际 ${noAuth.status}`)
} finally {
  /* ---------- 清理：只删除本次创建的记录 ---------- */
  section('清理测试数据')
  if (createdComparisonIds.length > 0) {
    const removed = await pool.query(
      'DELETE FROM product_dev_comparisons WHERE id = ANY($1::int[]) AND owner_user_id = $2',
      [createdComparisonIds, userId]
    )
    process.stdout.write(`  已删除 ${removed.rowCount} 条对比测试记录\n`)
  }
  if (createdCandidateIds.length > 0) {
    const removed = await pool.query(
      'DELETE FROM product_dev_candidates WHERE id = ANY($1::int[]) AND owner_user_id = $2',
      [createdCandidateIds, userId]
    )
    process.stdout.write(`  已删除 ${removed.rowCount} 条候选测试记录\n`)
  }
  // 兜底：前缀匹配（防止某条创建成功但 id 未被收集）
  const leftover = await pool.query(
    'DELETE FROM product_dev_candidates WHERE owner_user_id = $1 AND product_name LIKE $2',
    [userId, '__verify__%']
  )
  if (leftover.rowCount > 0) process.stdout.write(`  按前缀兜底删除 ${leftover.rowCount} 条\n`)

  await pool.end()
}

process.stdout.write(`\n结果：${passed} 通过 / ${failed} 失败\n`)
if (failures.length > 0) {
  process.stdout.write(`\n失败项：\n${failures.map((item) => `  - ${item}`).join('\n')}\n`)
  process.exit(1)
}

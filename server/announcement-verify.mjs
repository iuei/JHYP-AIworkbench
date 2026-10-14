/**
 * 公告验收脚本（API + 真实库 + 跨账号权限，不依赖模型、不启浏览器）。
 *
 * 用法：
 *   API_PORT=8790 SERVE_STATIC=false node server/index.mjs   # 另开终端，不要占用正在用的 8787
 *   node server/announcement-verify.mjs [baseUrl]
 *
 * 覆盖的是「纯函数单测」与「mock 掉接口的前端测试」都够不到的那一层：
 * 1. 权限：未登录 401、普通账号访问管理接口 403；
 * 2. 入参校验：空标题 / 空正文 / 非法弹出方式 / 非法时间 / 失效早于生效 / 优先级越界 一律 400；
 * 3. **「只弹一次」是按账号记录**：员工 A 点过确定后不再弹，员工 B 照样弹（这条错了就等于
 *    "一个人看过，全公司都不弹"，是最危险的那种实现偏差）；
 * 4. **「每次登录都弹」忽略已读记录**：点过确定后仍然在待弹列表里；
 * 5. 有效期语义：未到生效时间 / 已过失效时间都不进待弹列表（时间判断在 SQL 里用数据库的 NOW()）；
 * 6. 优先级排序：数值大的排在待弹列表最前；
 * 7. 状态流转：草稿不弹、发布后弹、下线后不弹、重新发布后**已确认过的人不再被弹**；
 * 8. 列表接口：状态筛选、关键词搜索、分页 total、已读人数；
 * 9. 审计留痕：创建 / 修改 / 上下线 / 删除四个动作都落 `ai_audit_logs`。
 *
 * 全部测试数据用 `__DSH` 前缀，结束时通过接口软删（与界面删除语义一致，保留行与审计）。
 * 只应在本地开发库执行。
 */
import dotenv from 'dotenv'
import { pool, query } from './db.mjs'

dotenv.config()

const ARGS = process.argv.slice(2)
const BASE =
  ARGS.find((arg) => /^https?:\/\//.test(arg)) ??
  `http://127.0.0.1:${process.env.API_PORT ?? 8790}/api`

const ADMIN_LOGIN = process.env.INITIAL_ADMIN_LOGIN
const ADMIN_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD

const READER_LOGIN = 'ai-announce-reader'
const PEER_LOGIN = 'ai-announce-peer'
const ACCOUNT_PASSWORD = 'Announce#2026'

const TITLE_PREFIX = '__DSH 公告验收'
const BODY = '第一条**加粗**内容。\n\n- 要点一\n- 要点二'

let passed = 0
const failures = []

function check(name, ok, extra = '') {
  if (ok) {
    passed += 1
    process.stdout.write(`  ✓ ${name}\n`)
  } else {
    failures.push(`${name}${extra ? ` — ${extra}` : ''}`)
    process.stdout.write(`  ✗ ${name}${extra ? ` — ${extra}` : ''}\n`)
  }
}

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text.slice(0, 160) }
  }
  return { status: response.status, data }
}

async function login(loginName, password) {
  const { status, data } = await api('/auth/login', {
    method: 'POST',
    body: { login: loginName, password },
  })
  return status === 200 ? (data.token ?? data.accessToken ?? null) : null
}

async function ensureOperator(adminToken, loginName, name) {
  const list = await api('/users', { token: adminToken })
  const existing = (list.data ?? []).find((user) => user.login === loginName)
  if (existing) {
    await api(`/users/${existing.id}/reset-password`, {
      method: 'POST',
      token: adminToken,
      body: { password: ACCOUNT_PASSWORD },
    })
    if (existing.status !== 'enabled') {
      await api(`/users/${existing.id}/status`, {
        method: 'PATCH',
        token: adminToken,
        body: { status: 'enabled' },
      })
    }
    return existing
  }
  const created = await api('/users', {
    method: 'POST',
    token: adminToken,
    body: { login: loginName, name, password: ACCOUNT_PASSWORD, role: 'operator' },
  })
  return created.data
}

/** 待弹列表里的公告 id。 */
async function pendingIds(token) {
  const { data } = await api('/announcements/pending', { token })
  return (data?.items ?? []).map((item) => item.id)
}

const createdIds = []

async function createAnnouncement(adminToken, payload) {
  const { status, data } = await api('/announcements', {
    method: 'POST',
    token: adminToken,
    body: { body: BODY, displayMode: 'once', priority: 0, ...payload },
  })
  if (data?.id) createdIds.push(data.id)
  return { status, data }
}

async function main() {
  process.stdout.write('\n[1] 鉴权与验收账号\n')
  const anonymousPending = await api('/announcements/pending')
  check('未登录访问待弹公告返回 401', anonymousPending.status === 401, `实际 ${anonymousPending.status}`)
  const anonymousAdmin = await api('/announcements')
  check('未登录访问公告管理列表返回 401', anonymousAdmin.status === 401, `实际 ${anonymousAdmin.status}`)

  const adminToken = await login(ADMIN_LOGIN, ADMIN_PASSWORD)
  check('管理员登录成功', Boolean(adminToken))
  if (!adminToken) throw new Error('管理员登录失败，终止验收')

  await ensureOperator(adminToken, READER_LOGIN, '公告验收员工')
  await ensureOperator(adminToken, PEER_LOGIN, '公告验收同事')
  const readerToken = await login(READER_LOGIN, ACCOUNT_PASSWORD)
  const peerToken = await login(PEER_LOGIN, ACCOUNT_PASSWORD)
  check('员工账号登录成功', Boolean(readerToken))
  check('同事账号登录成功', Boolean(peerToken))
  if (!readerToken || !peerToken) throw new Error('验收账号准备失败，终止验收')

  const readerForbidden = await api('/announcements', { token: readerToken })
  check('普通账号访问管理列表返回 403', readerForbidden.status === 403, `实际 ${readerForbidden.status}`)
  const readerCreate = await api('/announcements', {
    method: 'POST',
    token: readerToken,
    body: { title: `${TITLE_PREFIX} 越权`, body: BODY },
  })
  check('普通账号创建公告返回 403', readerCreate.status === 403, `实际 ${readerCreate.status}`)

  process.stdout.write('\n[2] 入参校验\n')
  const cases = [
    ['空标题 400', { title: '   ' }],
    ['空正文 400', { title: `${TITLE_PREFIX} 校验`, body: '   ' }],
    ['非法弹出方式 400', { title: `${TITLE_PREFIX} 校验`, displayMode: 'sometimes' }],
    ['非法时间字符串 400', { title: `${TITLE_PREFIX} 校验`, publishAt: '2026-13-45' }],
    ['优先级越界 400', { title: `${TITLE_PREFIX} 校验`, priority: 999 }],
    [
      '失效早于生效 400',
      {
        title: `${TITLE_PREFIX} 校验`,
        publishAt: new Date(Date.now() + 7200_000).toISOString(),
        expireAt: new Date(Date.now() + 3600_000).toISOString(),
      },
    ],
  ]
  for (const [name, payload] of cases) {
    const result = await createAnnouncement(adminToken, payload)
    check(name, result.status === 400, `实际 ${result.status}`)
  }

  process.stdout.write('\n[3] 草稿与发布\n')
  const draft = await createAnnouncement(adminToken, { title: `${TITLE_PREFIX} 一次性公告` })
  check('创建公告返回 201', draft.status === 201, `实际 ${draft.status}`)
  check('新建默认是草稿（不会直接弹给员工）', draft.data?.status === 'draft', `实际 ${draft.data?.status}`)
  const onceId = draft.data?.id
  check('草稿不出现在员工待弹列表', !(await pendingIds(readerToken)).includes(onceId))

  const published = await api(`/announcements/${onceId}/status`, {
    method: 'POST',
    token: adminToken,
    body: { status: 'published' },
  })
  check('发布返回已发布状态', published.data?.status === 'published', `实际 ${published.data?.status}`)
  check('发布后写入发布时间', Boolean(published.data?.publishedAt))
  check('发布后进入员工待弹列表', (await pendingIds(readerToken)).includes(onceId))

  process.stdout.write('\n[4] 「只弹一次」按账号记录\n')
  const ack = await api(`/announcements/${onceId}/ack`, { method: 'POST', token: readerToken })
  check('员工确认已读返回 204', ack.status === 204, `实际 ${ack.status}`)
  check('确认后不再弹给该员工', !(await pendingIds(readerToken)).includes(onceId))
  check(
    '**其他员工照样弹**（已读按账号，不是全公司共享）',
    (await pendingIds(peerToken)).includes(onceId)
  )
  const ackAgain = await api(`/announcements/${onceId}/ack`, { method: 'POST', token: readerToken })
  check('重复确认已读仍是 204（幂等）', ackAgain.status === 204, `实际 ${ackAgain.status}`)

  const missingAck = await api('/announcements/99999999/ack', { method: 'POST', token: readerToken })
  check('确认不存在的公告返回 404', missingAck.status === 404, `实际 ${missingAck.status}`)

  const draftForAck = await createAnnouncement(adminToken, { title: `${TITLE_PREFIX} 草稿不可确认` })
  const draftAck = await api(`/announcements/${draftForAck.data.id}/ack`, {
    method: 'POST',
    token: readerToken,
  })
  check('确认草稿公告返回 404（没有可写的语义）', draftAck.status === 404, `实际 ${draftAck.status}`)

  process.stdout.write('\n[5] 「每次登录都弹」\n')
  const everyLogin = await createAnnouncement(adminToken, {
    title: `${TITLE_PREFIX} 每次登录都弹`,
    displayMode: 'every_login',
  })
  await api(`/announcements/${everyLogin.data.id}/status`, {
    method: 'POST',
    token: adminToken,
    body: { status: 'published' },
  })
  check('发布后进入待弹列表', (await pendingIds(readerToken)).includes(everyLogin.data.id))
  await api(`/announcements/${everyLogin.data.id}/ack`, { method: 'POST', token: readerToken })
  check(
    '确认后**仍然**会弹（已读只用于统计）',
    (await pendingIds(readerToken)).includes(everyLogin.data.id)
  )

  process.stdout.write('\n[6] 有效期语义\n')
  const future = await createAnnouncement(adminToken, {
    title: `${TITLE_PREFIX} 未生效`,
    publishAt: new Date(Date.now() + 3600_000).toISOString(),
  })
  await api(`/announcements/${future.data.id}/status`, {
    method: 'POST',
    token: adminToken,
    body: { status: 'published' },
  })
  check('未到生效时间不进待弹列表', !(await pendingIds(peerToken)).includes(future.data.id))

  const expired = await createAnnouncement(adminToken, {
    title: `${TITLE_PREFIX} 已过期`,
    expireAt: new Date(Date.now() - 3600_000).toISOString(),
  })
  await api(`/announcements/${expired.data.id}/status`, {
    method: 'POST',
    token: adminToken,
    body: { status: 'published' },
  })
  check('已过失效时间不进待弹列表', !(await pendingIds(peerToken)).includes(expired.data.id))

  const inWindow = await createAnnouncement(adminToken, {
    title: `${TITLE_PREFIX} 有效期内`,
    publishAt: new Date(Date.now() - 3600_000).toISOString(),
    expireAt: new Date(Date.now() + 3600_000).toISOString(),
  })
  await api(`/announcements/${inWindow.data.id}/status`, {
    method: 'POST',
    token: adminToken,
    body: { status: 'published' },
  })
  check('有效期内进待弹列表', (await pendingIds(peerToken)).includes(inWindow.data.id))

  process.stdout.write('\n[7] 优先级排序\n')
  const low = await createAnnouncement(adminToken, {
    title: `${TITLE_PREFIX} 低优先级`,
    priority: 1,
  })
  const high = await createAnnouncement(adminToken, {
    title: `${TITLE_PREFIX} 高优先级`,
    priority: 9,
  })
  for (const target of [low, high]) {
    await api(`/announcements/${target.data.id}/status`, {
      method: 'POST',
      token: adminToken,
      body: { status: 'published' },
    })
  }
  const peerPending = await pendingIds(peerToken)
  check('优先级高的排在待弹列表最前', peerPending[0] === high.data.id, `实际首条 ${peerPending[0]}`)
  check(
    '同批公告都返回给前端（逐条弹，而不是只给一条）',
    peerPending.includes(low.data.id) && peerPending.includes(high.data.id)
  )

  process.stdout.write('\n[8] 状态流转与删除\n')
  const offline = await api(`/announcements/${high.data.id}/status`, {
    method: 'POST',
    token: adminToken,
    body: { status: 'draft' },
  })
  check('下线返回草稿状态', offline.data?.status === 'draft', `实际 ${offline.data?.status}`)
  check('下线后不再弹', !(await pendingIds(peerToken)).includes(high.data.id))

  await api(`/announcements/${onceId}/status`, {
    method: 'POST',
    token: adminToken,
    body: { status: 'draft' },
  })
  await api(`/announcements/${onceId}/status`, {
    method: 'POST',
    token: adminToken,
    body: { status: 'published' },
  })
  check(
    '下线再上线后，已确认过的人不再被弹（同一条公告不重复打扰）',
    !(await pendingIds(readerToken)).includes(onceId)
  )
  check('下线再上线后，没确认过的人继续弹', (await pendingIds(peerToken)).includes(onceId))

  const removed = await api(`/announcements/${expired.data.id}`, {
    method: 'DELETE',
    token: adminToken,
  })
  check('删除公告返回 204', removed.status === 204, `实际 ${removed.status}`)
  check('删除后不再进待弹列表', !(await pendingIds(peerToken)).includes(expired.data.id))
  const removeAgain = await api(`/announcements/${expired.data.id}`, {
    method: 'DELETE',
    token: adminToken,
  })
  check('重复删除返回 404', removeAgain.status === 404, `实际 ${removeAgain.status}`)

  process.stdout.write('\n[9] 管理列表接口\n')
  const all = await api(`/announcements?keyword=${encodeURIComponent(TITLE_PREFIX)}&pageSize=100`, {
    token: adminToken,
  })
  check('列表返回 items 与 total', Array.isArray(all.data?.items) && typeof all.data?.total === 'number')
  check(
    '关键词只命中本次验收数据',
    (all.data?.items ?? []).every((item) => item.title.startsWith(TITLE_PREFIX)),
    `实际 ${all.data?.items?.length} 条`
  )
  check(
    '列表带上已读人数（一次性公告已被 1 人确认）',
    (all.data?.items ?? []).find((item) => item.id === onceId)?.readCount === 1,
    `实际 ${(all.data?.items ?? []).find((item) => item.id === onceId)?.readCount}`
  )
  const draftOnly = await api('/announcements?status=draft&pageSize=100', { token: adminToken })
  check(
    '状态筛选生效',
    (draftOnly.data?.items ?? []).every((item) => item.status === 'draft')
  )
  const badStatus = await api('/announcements?status=whatever', { token: adminToken })
  check('非法状态筛选返回 400', badStatus.status === 400, `实际 ${badStatus.status}`)
  const paged = await api(`/announcements?keyword=${encodeURIComponent(TITLE_PREFIX)}&page=1&pageSize=2`, {
    token: adminToken,
  })
  check('分页每页 2 条', (paged.data?.items ?? []).length === 2, `实际 ${paged.data?.items?.length}`)

  process.stdout.write('\n[10] 审计留痕\n')
  const audit = await query(
    `SELECT action, count(*)::int AS total FROM ai_audit_logs
      WHERE target_type = 'announcement' AND target_id = ANY($1::text[])
      GROUP BY action`,
    [createdIds.map(String)]
  )
  const actions = new Set(audit.rows.map((row) => row.action))
  check('创建写审计', actions.has('announcement_create'))
  check('上下线写审计', actions.has('announcement_publish'))
  check('删除写审计', actions.has('announcement_delete'))

  const editTarget = await createAnnouncement(adminToken, { title: `${TITLE_PREFIX} 待编辑` })
  const edited = await api(`/announcements/${editTarget.data.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { title: `${TITLE_PREFIX} 已编辑`, body: BODY, displayMode: 'every_login' },
  })
  check('编辑返回 200', edited.status === 200, `实际 ${edited.status}`)
  check('编辑后弹出方式已更新', edited.data?.displayMode === 'every_login')
  const editAudit = await query(
    `SELECT 1 FROM ai_audit_logs WHERE action = 'announcement_update' AND target_id = $1`,
    [String(editTarget.data.id)]
  )
  check('修改落审计（announcement_update）', editAudit.rowCount > 0)

  process.stdout.write('\n[11] 清理验收数据\n')
  for (const id of createdIds) {
    await api(`/announcements/${id}`, { method: 'DELETE', token: adminToken })
  }
  const left = await query(
    `SELECT count(*)::int AS total FROM announcements WHERE title LIKE $1 AND deleted_at IS NULL`,
    [`${TITLE_PREFIX}%`]
  )
  check('验收数据已软删（列表不可见）', left.rows[0].total === 0, `剩余 ${left.rows[0].total} 条`)
}

try {
  await main()
} catch (error) {
  process.stderr.write(`\n验收中断：${error?.stack ?? error}\n`)
  failures.push(`未捕获异常：${error?.message ?? error}`)
} finally {
  process.stdout.write(
    `\n公告验收：${passed} 通过，${failures.length} 失败\n` +
      (failures.length ? `失败项：\n${failures.map((item) => `  - ${item}`).join('\n')}\n` : '') +
      '\n如需连同软删行一并清除（审计不可删，按项目原则保留）：\n' +
      `  DELETE FROM announcements WHERE title LIKE '${TITLE_PREFIX}%';\n\n`
  )
  await pool.end()
  process.exit(failures.length ? 1 : 0)
}

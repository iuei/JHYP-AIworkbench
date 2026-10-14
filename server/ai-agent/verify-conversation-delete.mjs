/**
 * 「聊天列表管理与删除会话」真实接口验收。
 *
 * 用法（后端已在 8787 运行）：
 *   node server/ai-agent/verify-conversation-delete.mjs
 *
 * 设计原则：**断言只落在状态码与数据库事实上**，不看模型输出，也不消耗模型额度 ——
 * 会话夹具直接落库（`ai_conversations` + `ai_messages` + `ai_runs`），
 * 这样"删除会话"这条链路与模型完全解耦。
 *
 * 脚本会写入真实数据（两个账号各一条 [验收-会话删除] 会话），结束即清理：
 * 只删自己插入的、标题带该前缀的会话，不触碰任何既有数据。
 */
import dotenv from 'dotenv'

dotenv.config()

const ARGS = process.argv.slice(2)
const BASE =
  ARGS.find((arg) => /^https?:\/\//.test(arg)) ??
  `http://127.0.0.1:${process.env.API_PORT ?? 8787}`
const ADMIN_LOGIN = process.env.INITIAL_ADMIN_LOGIN
const ADMIN_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD

const PREFIX = '[验收-会话删除]'
const OPERATOR_LOGIN = 'ai-conv-delete-verify'
const OPERATOR_PASSWORD = 'ConvDelete#2026'

const { query, pool } = await import('../db.mjs')

const results = []
let failures = 0

function check(id, title, passed, detail = '') {
  results.push({ id, title, passed, detail })
  if (!passed) failures += 1
  process.stdout.write(
    `${passed ? '✔' : '✖'} ${id} ${title}${detail ? ` — ${detail}` : ''}\n`
  )
}

/** 只记录事实、不参与通过判定的信息项（例如"当前实现是否写审计"）。 */
function note(id, title, detail) {
  process.stdout.write(`· ${id} ${title} — ${detail}\n`)
}

async function request(path, { token, method = 'GET', body } = {}) {
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
  return { status: response.status, json, text }
}

async function login(login, password) {
  const { status, json, text } = await request('/api/auth/login', {
    method: 'POST',
    body: { login, password },
  })
  if (status !== 200) throw new Error(`登录 ${login} 失败：${status} ${text.slice(0, 200)}`)
  return json.token
}

/** 普通账号（删除越权断言需要一个非管理员身份）。已存在则直接复用。 */
async function ensureOperator(adminToken) {
  const list = await request('/api/users', { token: adminToken })
  const existing = (list.json ?? []).find((user) => user.login === OPERATOR_LOGIN)
  if (existing) return existing
  const created = await request('/api/users', {
    token: adminToken,
    method: 'POST',
    body: {
      login: OPERATOR_LOGIN,
      name: '会话删除验收账号',
      password: OPERATOR_PASSWORD,
      role: 'operator',
    },
  })
  if (created.status !== 201) {
    throw new Error(`创建验收账号失败：${created.status} ${created.text.slice(0, 200)}`)
  }
  return created.json
}

/** 会话夹具：直接落库，含一条用户消息、一条回答与一条工具轨迹（用于验证级联）。 */
async function createFixture({ userId, title, question }) {
  const conversation = await query(
    `INSERT INTO ai_conversations (user_id, title, message_count, last_message_at)
     VALUES ($1, $2, 2, NOW()) RETURNING id`,
    [userId, title]
  )
  const conversationId = conversation.rows[0].id
  const message = await query(
    `INSERT INTO ai_messages (conversation_id, role, content, status)
     VALUES ($1, 'user', $2, 'ok') RETURNING id`,
    [conversationId, question]
  )
  await query(
    `INSERT INTO ai_messages (conversation_id, role, content, status)
     VALUES ($1, 'assistant', $2, 'ok')`,
    [conversationId, '（夹具回答，不经过模型）']
  )
  const run = await query(
    `INSERT INTO ai_runs (message_id, user_id, tool_name, params, status)
     VALUES ($1, $2, 'search_knowledge', '{}', 'ok') RETURNING id`,
    [message.rows[0].id, userId]
  )
  return { conversationId, runId: run.rows[0].id }
}

async function countRows(sql, params) {
  const { rows } = await query(sql, params)
  return rows[0]?.total ?? 0
}

async function cleanup() {
  // 先删会话再删账号：脚本只碰自己插入的数据，跑完库与跑前一致
  await query(`DELETE FROM ai_conversations WHERE title LIKE $1`, [`${PREFIX}%`])
  await query(`DELETE FROM users WHERE login = $1`, [OPERATOR_LOGIN])
}

async function main() {
  if (!ADMIN_LOGIN || !ADMIN_PASSWORD) {
    throw new Error('.env 缺少 INITIAL_ADMIN_LOGIN / INITIAL_ADMIN_PASSWORD')
  }

  const adminToken = await login(ADMIN_LOGIN, ADMIN_PASSWORD)
  const me = await request('/api/auth/me', { token: adminToken })
  // `/api/auth/me` 直接返回用户对象（不是 { user } 包装）
  const adminId = me.json?.id ?? me.json?.user?.id
  if (!adminId) throw new Error(`取管理员 id 失败：${me.text.slice(0, 200)}`)

  await cleanup()
  const operator = await ensureOperator(adminToken)
  const operatorToken = await login(OPERATOR_LOGIN, OPERATOR_PASSWORD)

  const mine = await createFixture({
    userId: adminId,
    title: `${PREFIX} 待删除`,
    question: '这条会话会被删除',
  })
  const kept = await createFixture({
    userId: adminId,
    title: `${PREFIX} 保留`,
    question: '这条会话必须留着',
  })
  const other = await createFixture({
    userId: operator.id,
    title: `${PREFIX} 他人`,
    question: '别人账号的会话',
  })

  // ---------- 列表 ----------
  const list = await request('/api/ai/conversations', { token: adminToken })
  const conversations = list.json?.conversations ?? []
  const row = conversations.find((item) => item.id === mine.conversationId)
  check(
    'A1',
    '会话列表返回分页对象与列表项字段',
    list.status === 200 &&
      typeof list.json?.total === 'number' &&
      typeof list.json?.page === 'number' &&
      typeof list.json?.pageSize === 'number' &&
      Boolean(row) &&
      typeof row.title === 'string' &&
      typeof row.messageCount === 'number' &&
      typeof row.pinned === 'boolean' &&
      typeof row.createdAt === 'string' &&
      'lastMessageAt' in row,
    `status=${list.status} total=${list.json?.total}`
  )

  // ---------- 重命名 / 置顶 ----------
  const renamed = await request(`/api/ai/conversations/${mine.conversationId}`, {
    token: adminToken,
    method: 'PATCH',
    body: { title: `${PREFIX} 已重命名` },
  })
  check(
    'A2',
    '重命名后接口回传新标题',
    renamed.status === 200 && renamed.json?.conversation?.title === `${PREFIX} 已重命名`,
    `status=${renamed.status} title=${renamed.json?.conversation?.title}`
  )

  const pinned = await request(`/api/ai/conversations/${mine.conversationId}`, {
    token: adminToken,
    method: 'PATCH',
    body: { pinned: true },
  })
  const afterPin = await request('/api/ai/conversations', { token: adminToken })
  const pinnedRow = (afterPin.json?.conversations ?? []).find(
    (item) => item.id === mine.conversationId
  )
  check(
    'A3',
    '置顶后列表里的 pinned 为 true',
    pinned.status === 200 && pinnedRow?.pinned === true,
    `pinned=${pinnedRow?.pinned}`
  )

  // ---------- 服务端搜索 ----------
  const searched = await request(
    `/api/ai/conversations?keyword=${encodeURIComponent('已重命名')}`,
    { token: adminToken }
  )
  const searchedRows = searched.json?.conversations ?? []
  check(
    'A4',
    '关键词搜索走服务端并按标题命中',
    searched.status === 200 &&
      searchedRows.some((item) => item.id === mine.conversationId) &&
      !searchedRows.some((item) => item.id === other.conversationId),
    `hits=${searchedRows.length}`
  )

  // ---------- 越权删除 ----------
  const crossDelete = await request(`/api/ai/conversations/${kept.conversationId}`, {
    token: operatorToken,
    method: 'DELETE',
  })
  const keptAfterCross = await request(
    `/api/ai/conversations/${kept.conversationId}/messages`,
    { token: adminToken }
  )
  check(
    'A5',
    '删除他人会话返回 404 且会话仍在',
    crossDelete.status === 404 && keptAfterCross.status === 200,
    `delete=${crossDelete.status} messages=${keptAfterCross.status}`
  )

  const operatorList = await request('/api/ai/conversations', { token: operatorToken })
  const operatorIds = (operatorList.json?.conversations ?? []).map((item) => item.id)
  check(
    'A6',
    '账号隔离：他人列表里看不到管理员会话',
    operatorList.status === 200 &&
      !operatorIds.includes(kept.conversationId) &&
      operatorIds.includes(other.conversationId),
    `operatorTotal=${operatorList.json?.total}`
  )

  // ---------- 参数校验 ----------
  const badId = await request('/api/ai/conversations/not-a-number', {
    token: adminToken,
    method: 'DELETE',
  })
  const missing = await request('/api/ai/conversations/2147483000', {
    token: adminToken,
    method: 'DELETE',
  })
  check(
    'A7',
    '非法 id 400、不存在的 id 404',
    badId.status === 400 && missing.status === 404,
    `bad=${badId.status} missing=${missing.status}`
  )

  // ---------- 删除自己的会话 ----------
  const deleted = await request(`/api/ai/conversations/${mine.conversationId}`, {
    token: adminToken,
    method: 'DELETE',
  })
  check('A8', '删除自己的会话返回 204', deleted.status === 204, `status=${deleted.status}`)

  const afterDelete = await request('/api/ai/conversations', { token: adminToken })
  const afterIds = (afterDelete.json?.conversations ?? []).map((item) => item.id)
  check(
    'A9',
    '删除后列表不再返回该会话，且未误删其他会话',
    !afterIds.includes(mine.conversationId) && afterIds.includes(kept.conversationId),
    `stillHasKept=${afterIds.includes(kept.conversationId)}`
  )

  const messagesAfter = await request(
    `/api/ai/conversations/${mine.conversationId}/messages`,
    { token: adminToken }
  )
  check(
    'A10',
    '删除后该会话的消息接口返回 404',
    messagesAfter.status === 404,
    `status=${messagesAfter.status}`
  )

  const deleteAgain = await request(`/api/ai/conversations/${mine.conversationId}`, {
    token: adminToken,
    method: 'DELETE',
  })
  check('A11', '重复删除同一条返回 404（幂等边界）', deleteAgain.status === 404, `status=${deleteAgain.status}`)

  // ---------- 级联事实（直接查库） ----------
  const leftMessages = await countRows(
    `SELECT COUNT(*)::int AS total FROM ai_messages WHERE conversation_id = $1`,
    [mine.conversationId]
  )
  const leftRuns = await countRows(`SELECT COUNT(*)::int AS total FROM ai_runs WHERE id = $1`, [
    mine.runId,
  ])
  check(
    'A12',
    '会话删除后消息与工具轨迹一并级联清除',
    leftMessages === 0 && leftRuns === 0,
    `messages=${leftMessages} runs=${leftRuns}`
  )

  // ---------- 信息项：删除动作是否留下审计 ----------
  const auditDeleteRows = await countRows(
    `SELECT COUNT(*)::int AS total FROM ai_audit_logs
      WHERE target_type = 'conversation' AND target_id = $1`,
    [String(mine.conversationId)]
  )
  const adminActionAudit = await countRows(
    `SELECT COUNT(*)::int AS total FROM ai_audit_logs WHERE actor_id = $1`,
    [adminId]
  )
  note(
    'I1',
    '删除动作的审计落库情况（不判定通过）',
    `conversation 维度记录 ${auditDeleteRows} 条；该账号全部审计 ${adminActionAudit} 条`
  )
  note(
    'I2',
    '被删会话对审计台的影响（不判定通过）',
    '会话轨迹读 ai_conversations、工具调用明细读 ai_runs，两者均已随级联删除消失；' +
      'ai_audit_logs（拦截记录 / 管理动作日志）不含外键，不受影响'
  )

  const passed = results.filter((item) => item.passed).length
  process.stdout.write(`\n通过 ${passed}/${results.length}\n`)
  if (failures > 0) {
    process.stdout.write(
      `\n失败项：\n${results
        .filter((item) => !item.passed)
        .map((item) => `- ${item.id} ${item.title}${item.detail ? `（${item.detail}）` : ''}`)
        .join('\n')}\n`
    )
    process.exitCode = 1
  }
}

await main()
  .catch((error) => {
    process.stdout.write(`\n验收中断：${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await cleanup().catch(() => {})
    await pool.end()
  })

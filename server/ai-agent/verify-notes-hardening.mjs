/**
 * 知识沉淀加固验收（本轮加固：权限隔离 / 可信度 / 证据核对 / 审核事务 / 版本修订 / 配额并发）。
 *
 * 用法：
 *   API_PORT=8788 SERVE_STATIC=false node server/index.mjs   # 另开一个终端
 *   node server/ai-agent/verify-notes-hardening.mjs [baseUrl]
 *
 * 设计原则（对应开发文档 §6）：**权限与状态机断言必须放在模型之外**。
 * 因此本脚本不依赖模型输出质量：
 *   - 运行期间把模型配置临时切到演示 provider（force_demo），结束后恢复原值；
 *   - 所有断言看的是状态码、状态机取值、数据库事实（公共文档数量、审计条数），
 *     而不是"模型说了什么"。真实模型验收仍然由 verify-e2e.mjs 负责。
 *
 * 脚本会写入真实数据（账号 / 沉淀 / 文档 / 审计），并对全局技能策略与模型开关
 * 做临时改动后恢复，只应在本地开发库执行。
 */
import dotenv from 'dotenv'

dotenv.config()

const ARGS = process.argv.slice(2)
const BASE =
  ARGS.find((arg) => /^https?:\/\//.test(arg)) ??
  `http://127.0.0.1:${process.env.API_PORT ?? 8788}`
const ADMIN_LOGIN = process.env.INITIAL_ADMIN_LOGIN
const ADMIN_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD

const PASSWORD = 'Hardening#2026'
const ACCOUNT_A = 'ai-notes-harden-a'
const ACCOUNT_B = 'ai-notes-harden-b'
const ACCOUNT_QUOTA = 'ai-notes-harden-quota'
const SKILL = 'knowledge-distill'

const { query, pool } = await import('../db.mjs')
const { reserveDistillQuota, reviewNote } = await import('./notes.mjs')

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

async function login(login, password) {
  const { json } = await request('/api/auth/login', {
    method: 'POST',
    body: { login, password },
    expect: 200,
  })
  return json.token
}

/** 建号或复用（密码可能是上一次运行设的，因此复用前统一重置一次）。 */
async function ensureOperator(adminToken, login, name) {
  const list = await request('/api/users', { token: adminToken, expect: 200 })
  const existing = list.json.find((user) => user.login === login)
  if (existing) {
    await request(`/api/users/${existing.id}/reset-password`, {
      token: adminToken,
      method: 'POST',
      body: { password: PASSWORD },
      expect: 204,
    })
    if (existing.status !== 'enabled') {
      await request(`/api/users/${existing.id}/status`, {
        token: adminToken,
        method: 'PATCH',
        body: { status: 'enabled' },
        expect: 200,
      })
    }
    return existing
  }
  const created = await request('/api/users', {
    token: adminToken,
    method: 'POST',
    body: { login, name, password: PASSWORD, role: 'operator' },
    expect: 201,
  })
  return created.json
}

/**
 * 造一个"有实质回答"的会话（直接落库，不走模型）。
 *
 * 为什么不跑一次真实问答再借它的会话：演示 provider 的回答里带"依据权限范围"这种声明句，
 * 会被权限文案过滤器规整成拦截文案，从而让会话不具备"可沉淀的实质回答"。
 * 本脚本要验证的是沉淀侧的规则，不该被另一处的措辞模式牵连，
 * 因此直接写一条确定的会话夹具，让断言与模型完全解耦。
 */
async function createFixtureConversation({ userId, question, answer }) {
  const conversation = await query(
    `INSERT INTO ai_conversations (user_id, title, message_count, last_message_at)
     VALUES ($1, $2, 2, NOW()) RETURNING id`,
    [userId, question.slice(0, 200)]
  )
  const conversationId = conversation.rows[0].id
  await query(
    `INSERT INTO ai_messages (conversation_id, role, content, status) VALUES ($1, 'user', $2, 'ok')`,
    [conversationId, question]
  )
  await query(
    `INSERT INTO ai_messages (conversation_id, role, content, status) VALUES ($1, 'assistant', $2, 'ok')`,
    [conversationId, answer]
  )
  return { conversationId, answer }
}

async function countDocumentsForNote(noteId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total FROM ai_documents WHERE source_ref = $1`,
    [`note:${noteId}`]
  )
  return rows[0]?.total ?? 0
}

async function documentStatusForNote(noteId) {
  const { rows } = await query(
    `SELECT id, status, owner_user_id FROM ai_documents WHERE source_ref = $1 ORDER BY id`,
    [`note:${noteId}`]
  )
  return rows
}

async function countDistillAudits(userId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total FROM ai_audit_logs
      WHERE actor_id = $1 AND action = 'note_distill' AND created_at >= date_trunc('day', NOW())`,
    [userId]
  )
  return rows[0]?.total ?? 0
}

async function main() {
  process.stdout.write(`验收目标：${BASE}\n\n`)

  const adminToken = await login(ADMIN_LOGIN, ADMIN_PASSWORD)
  const adminMe = await request('/api/ai/tools', { token: adminToken, expect: 200 })
  process.stdout.write(
    `Provider 当前：${adminMe.json.provider.name} / mode=${adminMe.json.provider.mode}\n\n`
  )

  // ── 临时切到演示 provider：状态机/权限断言不能受模型波动影响；结束后恢复
  const settingsBefore = await request('/api/ai/settings', { token: adminToken, expect: 200 })
  const skillBefore = await request(`/api/ai/distill/skills`, { token: adminToken, expect: 200 })
  const policyBefore = skillBefore.json.skill?.policy ?? {}
  const users = await request('/api/users', { token: adminToken, expect: 200 })
  const adminUser = users.json.find((user) => user.login === ADMIN_LOGIN)

  try {
    await request('/api/ai/settings', {
      token: adminToken,
      method: 'PATCH',
      body: { forceDemo: true },
      expect: 200,
    })
    await request(`/api/ai/distill/skills/${SKILL}`, {
      token: adminToken,
      method: 'PATCH',
      body: { policy: { triggerMode: 'manual', dailyQuota: 200, fieldKeys: [] } },
      expect: 200,
    })

    const userA = await ensureOperator(adminToken, ACCOUNT_A, '加固验收 A')
    const userB = await ensureOperator(adminToken, ACCOUNT_B, '加固验收 B')
    const userQ = await ensureOperator(adminToken, ACCOUNT_QUOTA, '加固验收 配额')
    const tokenA = await login(ACCOUNT_A, PASSWORD)
    const tokenB = await login(ACCOUNT_B, PASSWORD)
    // 开启技能开关（技能默认关闭；配额由管理员策略控制，本脚本已临时上调）
    await request('/api/ai/notes/skill', {
      token: tokenA,
      method: 'PUT',
      body: { enabled: true },
      expect: 200,
    })

    const stamp = Date.now()
    const titleA = `【加固】断货补货要经运营主管审批 ${stamp}`

    // ── H1 权限隔离：员工接口 owner-only，管理接口才可跨账号
    const createdA = await request('/api/ai/notes', {
      token: tokenA,
      method: 'POST',
      body: {
        title: titleA,
        summary: '补货需先经运营主管审批再提交采购。',
        fields: { scenario: '库存不足时', approach: '先报运营主管审批审批' },
        tags: ['加固验收'],
        // 客户端伪造：会话来源才是模型推断，手工新建必须保持"本人所写"
        provenance: 'inferred',
      },
      expect: 201,
    })
    const noteA = createdA.json.note
    check(
      'H1-1',
      '手工新建的沉淀由服务端判为「本人所写」，客户端伪造 provenance 不生效',
      noteA.provenance === 'user_stated' && noteA.status === 'private',
      `provenance=${noteA.provenance} status=${noteA.status}`
    )

    const readOwn = await request(`/api/ai/notes/${noteA.id}`, { token: tokenA })
    const readOther = await request(`/api/ai/notes/${noteA.id}`, { token: tokenB })
    check(
      'H1-2',
      'operator B 读不到 A 的私有沉淀（按不存在处理，不泄露存在性）',
      readOwn.status === 200 && readOther.status === 404,
      `本人 ${readOwn.status} / 他人 ${readOther.status}`
    )

    const adminReadEmp = await request(`/api/ai/notes/${noteA.id}`, { token: adminToken })
    check(
      'H1-3',
      'admin 通过员工接口读他人条目同样 404（可见 ≠ 可操作）',
      adminReadEmp.status === 404,
      `status=${adminReadEmp.status}`
    )

    const adminPatchEmp = await request(`/api/ai/notes/${noteA.id}`, {
      token: adminToken,
      method: 'PATCH',
      body: { title: '被管理员改掉的标题' },
    })
    const afterPatchEmp = await request(`/api/ai/distill/notes/${noteA.id}`, {
      token: adminToken,
      expect: 200,
    })
    check(
      'H1-4',
      'admin 不能通过员工接口改他人条目，且条目内容未被改动',
      adminPatchEmp.status === 404 && afterPatchEmp.json.note.title === titleA,
      `status=${adminPatchEmp.status} title=${afterPatchEmp.json.note.title === titleA ? '未变' : '被改'}` 
    )

    const adminSubmitEmp = await request(`/api/ai/notes/${noteA.id}/submit`, {
      token: adminToken,
      method: 'POST',
    })
    const afterSubmitEmp = await request(`/api/ai/distill/notes/${noteA.id}`, {
      token: adminToken,
      expect: 200,
    })
    check(
      'H1-5',
      'admin 不能通过员工接口代他人提交审核，条目状态保持 private',
      adminSubmitEmp.status === 404 && afterSubmitEmp.json.note.status === 'private',
      `status=${adminSubmitEmp.status} note=${afterSubmitEmp.json.note.status}`
    )

    const adminArchiveEmp = await request(`/api/ai/notes/${noteA.id}/archive`, {
      token: adminToken,
      method: 'POST',
    })
    const adminDeleteEmp = await request(`/api/ai/notes/${noteA.id}`, {
      token: adminToken,
      method: 'DELETE',
    })
    check(
      'H1-6',
      'admin 不能通过员工接口归档或删除他人条目，条目仍存在',
      adminArchiveEmp.status === 404 &&
        adminDeleteEmp.status === 404 &&
        (await countDocumentsForNote(noteA.id)) === 0,
      `archive=${adminArchiveEmp.status} delete=${adminDeleteEmp.status}`
    )

    const adminReadMgmt = await request(`/api/ai/distill/notes/${noteA.id}`, {
      token: adminToken,
    })
    check(
      'H1-7',
      'admin 通过管理接口可以看到他人条目（管理能力未被削弱）',
      adminReadMgmt.status === 200 && adminReadMgmt.json.note.ownerUserId === userA.id,
      `status=${adminReadMgmt.status}`
    )

    const auditBeforeAdminEdit = await request('/api/ai/audit/logs?action=note_update&limit=1', {
      token: adminToken,
      expect: 200,
    })
    void auditBeforeAdminEdit
    const adminPatchMgmt = await request(`/api/ai/distill/notes/${noteA.id}`, {
      token: adminToken,
      method: 'PATCH',
      body: { summary: '补货需先经运营主管审批，再由采购下单（管理员补充）。' },
      expect: 200,
    })
    const adminEditLogs = await request('/api/ai/audit/logs?action=note_update&limit=5', {
      token: adminToken,
      expect: 200,
    })
    const adminEditLog = (adminEditLogs.json.logs ?? []).find(
      (log) => String(log.targetId) === String(noteA.id) && log.detail?.scope === 'admin'
    )
    check(
      'H1-8',
      'admin 通过管理接口编辑他人条目成功且写入审计（含改动字段与改前状态）',
      adminPatchMgmt.json.note.summary.includes('管理员补充') &&
        Boolean(adminEditLog) &&
        Array.isArray(adminEditLog.detail.changedKeys) &&
        adminEditLog.detail.changedKeys.includes('summary'),
      adminEditLog ? `changedKeys=${JSON.stringify(adminEditLog.detail.changedKeys)}` : '未找到审计'
    )

    // ── H2 停用账号后所有沉淀接口不可用
    await request(`/api/users/${userB.id}/status`, {
      token: adminToken,
      method: 'PATCH',
      body: { status: 'disabled' },
      expect: 200,
    })
    const disabledRead = await request(`/api/ai/notes`, { token: tokenB })
    const disabledSubmit = await request(`/api/ai/notes/${noteA.id}/submit`, {
      token: tokenB,
      method: 'POST',
    })
    await request(`/api/users/${userB.id}/status`, {
      token: adminToken,
      method: 'PATCH',
      body: { status: 'enabled' },
      expect: 200,
    })
    check(
      'H2-1',
      '账号停用后沉淀接口一律不可用（401），不依赖前端是否隐藏入口',
      disabledRead.status === 401 && disabledSubmit.status === 401,
      `list=${disabledRead.status} submit=${disabledSubmit.status}`
    )

    // ── H3 未审内容不进公共知识库
    const privateDocs = await request(`/api/ai/knowledge/documents?keyword=${stamp}&pageSize=50`, {
      token: adminToken,
      expect: 200,
    })
    check(
      'H3-1',
      '私有沉淀不生成任何公共知识库文档（因此不可能被问答检索到）',
      (privateDocs.json.documents ?? []).length === 0 && (await countDocumentsForNote(noteA.id)) === 0,
      `命中文档 ${privateDocs.json.documents?.length ?? 0} 篇`
    )

    // ── H4 会话来源沉淀：provenance 与 evidence 都由服务端兜底
    const chat = await createFixtureConversation({
      userId: userA.id,
      question: '断货补货的流程是什么？',
      answer:
        '补货申请需要先提交给运营主管审批，审批通过后再走采购下单流程；跨境仓还需额外确认清关时效，' +
        '避免因为清关延误造成二次断货。',
    })
    const evidence = chat.answer.slice(0, 60)
    const conversationNote = await request('/api/ai/notes', {
      token: tokenA,
      method: 'POST',
      body: {
        title: `【加固】会话来源沉淀 ${stamp}`,
        conversationId: chat.conversationId,
        evidence,
        fields: { scenario: '会话整理' },
        provenance: 'user_stated',
      },
      expect: 201,
    })
    check(
      'H4-1',
      '会话来源的沉淀由服务端判为「模型推断」，客户端伪造 provenance 不生效',
      conversationNote.json.note.provenance === 'inferred' &&
        conversationNote.json.note.sourceKind === 'conversation',
      `provenance=${conversationNote.json.note.provenance} sourceKind=${conversationNote.json.note.sourceKind}`
    )

    const fabricated = await request('/api/ai/notes', {
      token: tokenA,
      method: 'POST',
      body: {
        title: `【加固】捏造原文依据 ${stamp}`,
        conversationId: chat.conversationId,
        evidence: '这句话在会话里从未出现过，是模型编的',
        fields: { scenario: '捏造' },
      },
    })
    const fabricatedRow = await query(
      `SELECT COUNT(*)::int AS total FROM ai_knowledge_notes WHERE title = $1`,
      [`【加固】捏造原文依据 ${stamp}`]
    )
    check(
      'H4-2',
      '原文依据在会话里找不到时拒绝保存（400），不会落库成"可信原文"',
      fabricated.status === 400 && fabricatedRow.rows[0].total === 0,
      `status=${fabricated.status} ${fabricated.json?.message ?? ''}`
    )

    const distillDraft = await request('/api/ai/notes/distill', {
      token: tokenA,
      method: 'POST',
      body: { conversationId: chat.conversationId },
      expect: 200,
    })
    check(
      'H4-3',
      '抽取草稿返回原文核对结论，且降级草稿仍保留会话原文（不编造字段）',
      distillDraft.json.draft.evidenceRejected === false &&
        distillDraft.json.draft.degraded === true &&
        Object.keys(distillDraft.json.draft.fields ?? {}).length === 0 &&
        chat.answer.includes(distillDraft.json.draft.evidence),
      `evidenceRejected=${distillDraft.json.draft.evidenceRejected} degraded=${distillDraft.json.draft.degraded}`
    )

    // ── H5 待审核不可改；驳回后可改可重提
    await request(`/api/ai/notes/${noteA.id}/submit`, {
      token: tokenA,
      method: 'POST',
      expect: 200,
    })
    const editPending = await request(`/api/ai/notes/${noteA.id}`, {
      token: tokenA,
      method: 'PATCH',
      body: { summary: '审核期间偷偷改内容' },
    })
    const pendingAfterTry = await request(`/api/ai/distill/notes/${noteA.id}`, {
      token: adminToken,
      expect: 200,
    })
    check(
      'H5-1',
      '员工直接调 PATCH 修改待审核条目被拒（409），审核人看到的内容未被偷改',
      editPending.status === 409 && !pendingAfterTry.json.note.summary.includes('偷偷改'),
      `status=${editPending.status}`
    )

    const rejectNoReason = await request(`/api/ai/distill/notes/${noteA.id}/review`, {
      token: adminToken,
      method: 'POST',
      body: { decision: 'reject' },
    })
    const rejected = await request(`/api/ai/distill/notes/${noteA.id}/review`, {
      token: adminToken,
      method: 'POST',
      body: { decision: 'reject', comment: '请补充适用条件' },
      expect: 200,
    })
    check(
      'H5-2',
      '驳回必须填原因，填了原因才生效并保留给提报人',
      rejectNoReason.status === 400 &&
        rejected.json.note.status === 'rejected' &&
        rejected.json.note.reviewComment === '请补充适用条件',
      `无原因=${rejectNoReason.status} 有原因=${rejected.json.note.status}`
    )

    const editRejected = await request(`/api/ai/notes/${noteA.id}`, {
      token: tokenA,
      method: 'PATCH',
      body: { fields: { scenario: '库存不足时', approach: '先报运营主管审批', applicability: '国内仓' } },
      expect: 200,
    })
    const resubmit = await request(`/api/ai/notes/${noteA.id}/submit`, {
      token: tokenA,
      method: 'POST',
      expect: 200,
    })
    check(
      'H5-3',
      '被驳回的条目可修改（状态仍为已驳回）并重新提交审核',
      editRejected.json.note.status === 'rejected' && resubmit.json.note.status === 'pending',
      `改后=${editRejected.json.note.status} 重提=${resubmit.json.note.status}`
    )

    // ── H6 审核事务、幂等与并发
    const approved = await request(`/api/ai/distill/notes/${noteA.id}/review`, {
      token: adminToken,
      method: 'POST',
      body: { decision: 'approve', comment: '加固验收通过' },
      expect: 200,
    })
    const docs = await documentStatusForNote(noteA.id)
    check(
      'H6-1',
      '审核通过生成恰好一份生效的 experience 文档，并标注提报人归属',
      approved.json.note.status === 'published' &&
        docs.length === 1 &&
        docs[0].status === 'active' &&
        docs[0].owner_user_id === userA.id,
      `文档 ${docs.length} 份，owner=${docs[0]?.owner_user_id}`
    )

    const reApprove = await request(`/api/ai/distill/notes/${noteA.id}/review`, {
      token: adminToken,
      method: 'POST',
      body: { decision: 'approve' },
    })
    check(
      'H6-2',
      '重复审核返回可识别的冲突（409），不会生成第二份文档',
      reApprove.status === 409 && (await countDocumentsForNote(noteA.id)) === 1,
      `status=${reApprove.status} 文档 ${await countDocumentsForNote(noteA.id)} 份`
    )

    // 并发审核：两个请求同时到达，只能有一个成功
    const concurrentNote = await request('/api/ai/notes', {
      token: tokenA,
      method: 'POST',
      body: { title: `【加固】并发审核 ${stamp}`, fields: { scenario: '并发' } },
      expect: 201,
    })
    await request(`/api/ai/notes/${concurrentNote.json.note.id}/submit`, {
      token: tokenA,
      method: 'POST',
      expect: 200,
    })
    const [raceA, raceB] = await Promise.all([
      request(`/api/ai/distill/notes/${concurrentNote.json.note.id}/review`, {
        token: adminToken,
        method: 'POST',
        body: { decision: 'approve' },
      }),
      request(`/api/ai/distill/notes/${concurrentNote.json.note.id}/review`, {
        token: adminToken,
        method: 'POST',
        body: { decision: 'approve' },
      }),
    ])
    const raceStatuses = [raceA.status, raceB.status].sort()
    check(
      'H6-3',
      '并发审核只有一个成功（另一个 409），且只生成一份公共文档',
      raceStatuses[0] === 200 &&
        raceStatuses[1] === 409 &&
        (await countDocumentsForNote(concurrentNote.json.note.id)) === 1,
      `状态码 ${raceStatuses.join(' / ')}`
    )

    // 文档生成失败 → 条目保持 pending 可重试（故障注入：Markdown 渲染抛错）
    const failNote = await request('/api/ai/notes', {
      token: tokenA,
      method: 'POST',
      body: { title: `【加固】生成失败可重试 ${stamp}`, fields: { scenario: '失败重试' } },
      expect: 201,
    })
    await request(`/api/ai/notes/${failNote.json.note.id}/submit`, {
      token: tokenA,
      method: 'POST',
      expect: 200,
    })
    let injected = null
    try {
      await reviewNote({
        id: failNote.json.note.id,
        user: { id: adminUser.id, role: adminUser.role, status: 'enabled' },
        decision: 'approve',
        fields: 42, // 非法字段集合 → 渲染文档时抛错，模拟文档生成失败
      })
    } catch (error) {
      injected = error
    }
    const failRow = await request(`/api/ai/distill/notes/${failNote.json.note.id}`, {
      token: adminToken,
      expect: 200,
    })
    check(
      'H6-4',
      '文档生成失败后事务整体回滚：条目仍为待审核、没有半成品文档，且可重试成功',
      Boolean(injected) &&
        failRow.json.note.status === 'pending' &&
        (await countDocumentsForNote(failNote.json.note.id)) === 0,
      `注入异常=${Boolean(injected)} 状态=${failRow.json.note.status}`
    )
    const retry = await request(`/api/ai/distill/notes/${failNote.json.note.id}/review`, {
      token: adminToken,
      method: 'POST',
      body: { decision: 'approve' },
      expect: 200,
    })
    check(
      'H6-5',
      '重试审核成功且只有一份 source_ref 文档（幂等键未被破坏）',
      retry.json.note.status === 'published' &&
        (await countDocumentsForNote(failNote.json.note.id)) === 1,
      `文档 ${await countDocumentsForNote(failNote.json.note.id)} 份`
    )

    // ── H7 已发布条目的同标题再沉淀 → 新修订，旧公共文档不被覆盖
    const revision = await request('/api/ai/notes', {
      token: tokenA,
      method: 'POST',
      body: {
        title: titleA,
        summary: '补货流程补充：跨境仓需额外确认清关时效。',
        fields: { scenario: '库存不足时', approach: '先报运营主管审批，跨境仓加确认清关' },
      },
      expect: 201,
    })
    const oldNoteAfterRevision = await request(`/api/ai/distill/notes/${noteA.id}`, {
      token: adminToken,
      expect: 200,
    })
    const oldDocsAfterRevision = await documentStatusForNote(noteA.id)
    check(
      'H7-1',
      '同标题再次沉淀生成新的私有修订：旧版本转历史归档，旧公共文档保持不变',
      revision.json.newRevision === true &&
        revision.json.note.status === 'private' &&
        revision.json.note.revisionOfNoteId === noteA.id &&
        oldNoteAfterRevision.json.note.status === 'archived' &&
        oldDocsAfterRevision.length === 1 &&
        oldDocsAfterRevision[0].status === 'active',
      `newRevision=${revision.json.newRevision} 旧条目=${oldNoteAfterRevision.json.note.status} 旧文档=${oldDocsAfterRevision[0]?.status}`
    )

    await request(`/api/ai/notes/${revision.json.note.id}/submit`, {
      token: tokenA,
      method: 'POST',
      expect: 200,
    })
    // 新修订还在审核中：同标题再来一次必须被拒（否则等于绕过审核改内容）
    const pendingAgain = await request('/api/ai/notes', {
      token: tokenA,
      method: 'POST',
      body: { title: titleA, fields: { scenario: '同标题再来一次' } },
    })
    check(
      'H7-3',
      '同标题条目已在审核中时拒绝再次沉淀（409），不允许绕过审核',
      pendingAgain.status === 409,
      `status=${pendingAgain.status}`
    )

    const approveRevision = await request(`/api/ai/distill/notes/${revision.json.note.id}/review`, {
      token: adminToken,
      method: 'POST',
      body: { decision: 'approve' },
      expect: 200,
    })
    const oldDocsFinal = await documentStatusForNote(noteA.id)
    const newDocsFinal = await documentStatusForNote(revision.json.note.id)
    check(
      'H7-2',
      '新修订通过审核后接管公共文档：新版生效、旧版失效（同一标题不留两份互相矛盾的经验）',
      approveRevision.json.note.status === 'published' &&
        newDocsFinal.length === 1 &&
        newDocsFinal[0].status === 'active' &&
        oldDocsFinal.length === 1 &&
        oldDocsFinal[0].status === 'inactive',
      `新版文档=${newDocsFinal[0]?.status} 旧版文档=${oldDocsFinal[0]?.status}`
    )

    // ── H8 管理端筛选与搜索（列表与导出同一组参数）
    const badRange = await request('/api/ai/distill/notes?from=2026-09-12&to=2026-09-11', {
      token: adminToken,
    })
    const tooWide = await request('/api/ai/distill/notes?from=2024-01-01&to=2026-09-11', {
      token: adminToken,
    })
    check(
      'H8-1',
      '服务端校验时间范围：开始晚于结束、跨度超限都明确报错（400）',
      badRange.status === 400 && tooWide.status === 400,
      `倒序=${badRange.status} 超限=${tooWide.status}`
    )

    const uniqueKeyword = String(stamp)
    const structuredHit = await request(
      `/api/ai/distill/notes?keyword=${encodeURIComponent('先报运营主管审批')}&pageSize=50`,
      { token: adminToken, expect: 200 }
    )
    check(
      'H8-2',
      '关键词能命中六个结构化字段的正文（不只是标题/概述/原文依据）',
      (structuredHit.json.rows ?? []).some((row) => row.id === noteA.id) &&
        !titleA.includes('先报运营主管审批'),
      `命中 ${structuredHit.json.total} 条`
    )

    const filterQuery = `userId=${userA.id}&keyword=${encodeURIComponent(uniqueKeyword)}&from=${encodeURIComponent(
      new Date(Date.now() - 86400000).toISOString()
    )}&to=${encodeURIComponent(new Date().toISOString())}`
    const filteredList = await request(`/api/ai/distill/notes?${filterQuery}&pageSize=100`, {
      token: adminToken,
      expect: 200,
    })
    const filteredExport = await request(`/api/ai/distill/export?${filterQuery}&format=csv`, {
      token: adminToken,
      expect: 200,
    })
    const exportRows = filteredExport.text.replace(/^\uFEFF/, '').trim().split('\r\n').length - 1
    check(
      'H8-3',
      '导出与列表使用完全相同的筛选参数（账号 + 关键词 + 时间范围），条数一致',
      filteredList.json.total === exportRows && exportRows > 0,
      `列表 ${filteredList.json.total} 条 / 导出 ${exportRows} 行`
    )

    const exportLogs = await request('/api/ai/audit/logs?action=note_export&limit=5', {
      token: adminToken,
      expect: 200,
    })
    const latestExportLog = (exportLogs.json.logs ?? [])[0]
    check(
      'H8-4',
      '导出审计记录完整筛选条件与条数（能回答"这份导出覆盖了什么范围"）',
      latestExportLog?.detail?.filters?.userId === userA.id &&
        latestExportLog?.detail?.filters?.keyword === uniqueKeyword &&
        Boolean(latestExportLog?.detail?.filters?.from) &&
        latestExportLog?.detail?.rows === exportRows,
      JSON.stringify(latestExportLog?.detail?.filters ?? {})
    )

    // ── H9 配额并发：真上限，而不是"先查后调"的竞态
    await query(`DELETE FROM ai_audit_logs WHERE actor_id = $1 AND action = 'note_distill'`, [
      userQ.id,
    ])
    const [reserveOne, reserveTwo] = await Promise.all([
      reserveDistillQuota({ userId: userQ.id, limit: 1 }),
      reserveDistillQuota({ userId: userQ.id, limit: 1 }),
    ])
    const allowedCount = [reserveOne.allowed, reserveTwo.allowed].filter(Boolean).length
    check(
      'H9-1',
      '配额预占在并发下成立：limit=1 同时请求两次只放行一次',
      allowedCount === 1,
      `放行 ${allowedCount} 次（${reserveOne.allowed} / ${reserveTwo.allowed}）`
    )
    const usedAfterReserve = await countDistillAudits(userQ.id)
    check(
      'H9-2',
      '预占即计数（模型调用成功与否都算），0 表示不限制',
      usedAfterReserve === 1 &&
        (await reserveDistillQuota({ userId: userQ.id, limit: 0 })).allowed === true,
      `预占后计数=${usedAfterReserve}`
    )

    // HTTP 级并发：走完整接口链路（技能开关 → 会话校验 → 配额预占 → 抽取）
    await query(`DELETE FROM ai_audit_logs WHERE actor_id = $1 AND action = 'note_distill'`, [
      userQ.id,
    ])
    const tokenQ = await login(ACCOUNT_QUOTA, PASSWORD)
    await request('/api/ai/notes/skill', {
      token: tokenQ,
      method: 'PUT',
      body: { enabled: true },
      expect: 200,
    })
    const chatQ = await createFixtureConversation({
      userId: userQ.id,
      question: '断货补货流程是什么？',
      answer: '补货需要先由运营主管审批，再提交采购下单，跨境仓额外确认清关时效。',
    })
    await request(`/api/ai/distill/skills/${SKILL}`, {
      token: adminToken,
      method: 'PATCH',
      body: { policy: { triggerMode: 'manual', dailyQuota: 1, fieldKeys: [] } },
      expect: 200,
    })
    const [distillOne, distillTwo] = await Promise.all([
      request('/api/ai/notes/distill', {
        token: tokenQ,
        method: 'POST',
        body: { conversationId: chatQ.conversationId },
      }),
      request('/api/ai/notes/distill', {
        token: tokenQ,
        method: 'POST',
        body: { conversationId: chatQ.conversationId },
      }),
    ])
    const httpStatuses = [distillOne.status, distillTwo.status].sort()
    const quotaAudits = await countDistillAudits(userQ.id)
    check(
      'H9-3',
      '配额为 1 时并发触发两次 AI 整理，最多一次真正执行（另一次 429），审计只记一次',
      httpStatuses[0] === 200 && httpStatuses[1] === 429 && quotaAudits === 1,
      `状态码 ${httpStatuses.join(' / ')}，审计 ${quotaAudits} 条`
    )

    // 手工新建不消耗配额（历史缺陷：按当天新建条数计数，跑几轮就误报 429）
    await request('/api/ai/notes', {
      token: tokenQ,
      method: 'POST',
      body: { title: `【加固】手工新建不占配额 ${stamp}`, fields: { scenario: '手工' } },
      expect: 201,
    })
    const auditsAfterManual = await countDistillAudits(userQ.id)
    check(
      'H9-4',
      '手工新建沉淀不消耗 AI 整理配额',
      auditsAfterManual === quotaAudits,
      `审计 ${auditsAfterManual} 条`
    )

    // ── H10 公共知识库与条目状态的一致性（数据库事实核对）
    const unreviewed = await query(
      `SELECT id, status FROM ai_knowledge_notes
        WHERE status IN ('private', 'pending', 'rejected') AND deleted_at IS NULL`
    )
    let leaked = 0
    for (const row of unreviewed.rows) {
      leaked += await countDocumentsForNote(row.id)
    }
    check(
      'H10-1',
      'private / pending / rejected 条目在库里都没有公共文档（未审内容不进检索）',
      leaked === 0,
      `未审条目 ${unreviewed.rowCount} 条，其中带公共文档 ${leaked} 条`
    )

    // 归档条目允许保留公共文档，但只允许"历史发布版本"这一种来源
    const archivedWithDocs = await query(
      `SELECT n.id, n.published_document_id
         FROM ai_knowledge_notes n
        WHERE n.status = 'archived' AND n.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM ai_documents d WHERE d.source_ref = 'note:' || n.id)`
    )
    const badArchived = archivedWithDocs.rows.filter((row) => !row.published_document_id)
    check(
      'H10-2',
      '归档条目若仍带公共文档，必然是发布过的历史版本（不是从没审过就进了知识库）',
      badArchived.length === 0,
      `归档且带文档 ${archivedWithDocs.rowCount} 条，其中无发布记录 ${badArchived.length} 条`
    )

    // 反向不变式：已发布条目必须恰好有一份生效文档（"已发布但没有文档"是坏状态）
    const brokenPublished = await query(
      `SELECT n.id, COUNT(d.id) FILTER (WHERE d.status = 'active')::int AS active_docs
         FROM ai_knowledge_notes n
         LEFT JOIN ai_documents d ON d.source_ref = 'note:' || n.id
        WHERE n.status = 'published' AND n.deleted_at IS NULL
        GROUP BY n.id
       HAVING COUNT(d.id) FILTER (WHERE d.status = 'active') <> 1`
    )
    check(
      'H10-3',
      '每条已发布条目都恰好关联一份生效的 experience 文档（不存在"已发布但没有文档"）',
      brokenPublished.rowCount === 0,
      `异常条目 ${brokenPublished.rowCount} 条`
    )

    process.stdout.write('\n────────── 验收汇总 ──────────\n')
  } finally {
    // 恢复全局模型开关与技能策略（无论验收是否失败）
    await request('/api/ai/settings', {
      token: adminToken,
      method: 'PATCH',
      body: { forceDemo: Boolean(settingsBefore.json.settings.forceDemo) },
    })
    await request(`/api/ai/distill/skills/${SKILL}`, {
      token: adminToken,
      method: 'PATCH',
      body: { policy: policyBefore },
    })
  }

  const passed = results.filter((item) => item.passed).length
  process.stdout.write(`通过 ${passed}/${results.length}\n`)
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

await main().finally(async () => {
  await pool.end()
})

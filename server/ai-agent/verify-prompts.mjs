/**
 * 提示词广场验收脚本（API + 真实库 + 跨账号权限，不依赖模型）。
 *
 * 用法：
 *   API_PORT=8789 SERVE_STATIC=false node server/index.mjs   # 另开一个终端（不要占用正在用的 8787）
 *   node server/ai-agent/verify-prompts.mjs [baseUrl]
 *
 * 脚本会：
 * 1. 建/复用两个 operator 验收账号（作者与"他人"），复用时统一重置密码；
 * 2. 覆盖名称两层唯一：个人库内重名 409、共享池重名提报 409；并覆盖**标题字段已下线**
 *    （不传 `title` 也能建、接口不再返回 `title`）；
 * 3. 覆盖状态机全链路：建私有 → 提报 → 待审 → 通过 → 全员可见 → 修改后回待审 → 驳回 → 重新提报；
 * 4. 覆盖跨账号语义：他人私有条目 404、普通账号审核 403、已共享条目全体可见；
 * 5. 覆盖 AI 优化接口：未登录 401、空/过短正文 400、**演示模式明确拒绝而非 500**、
 *    优化是纯建议（条目正文不被改动）；
 * 6. 校验审计留痕（`prompt_create` / `prompt_submit` / `prompt_review`，`targetType=ai_prompt`）。
 *
 * 为什么必须打真实库：`scope=published` 这类分支曾因"SQL 无占位符却多传参数"直接 500，
 * 纯函数单测与 mock 掉 api 的前端测试都覆盖不到。详见 `docs/modules/AI 助手.md`「踩过的坑」。
 *
 * 说明：全部测试数据用 `__DSH` 前缀；结束时通过 `DELETE /api/ai/prompts/:id` **软删**
 * （与界面删除语义一致，保留行与审计），只应在本地开发库执行。
 * 若要连同软删行一并清除，可执行：
 *   `DELETE FROM ai_prompts WHERE name LIKE '__DSH%'`（审计留痕按项目原则不可删）。
 */
import dotenv from 'dotenv'

dotenv.config()

const ARGS = process.argv.slice(2)
const BASE =
  ARGS.find((arg) => /^https?:\/\//.test(arg)) ??
  `http://127.0.0.1:${process.env.API_PORT ?? 8789}/api`

const ADMIN_LOGIN = process.env.INITIAL_ADMIN_LOGIN
const ADMIN_PASSWORD = process.env.INITIAL_ADMIN_PASSWORD

/** 验收账号（作者 / 他人），密码固定便于复用。 */
const AUTHOR_LOGIN = 'ai-prompt-author'
const PEER_LOGIN = 'ai-prompt-peer'
const ACCOUNT_PASSWORD = 'Prompt#2026'

const NAME_A = '__DSH 提示词验收 ACoS 归因'
const NAME_B = '__DSH 提示词验收 库存检查'
const BODY = '帮我看下 ACoS 为什么涨，并给出可执行的排查建议。'

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
  return status === 200 ? (data.accessToken ?? data.token ?? null) : null
}

/** 建号或复用（密码可能是上一次运行设的，复用前统一重置一次）。 */
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

const createdIds = []

async function main() {
  process.stdout.write('\n[1] 鉴权与验收账号\n')
  const anonymous = await api('/ai/prompts?scope=mine')
  check('未登录访问提示词接口返回 401', anonymous.status === 401, `实际 ${anonymous.status}`)

  const adminToken = await login(ADMIN_LOGIN, ADMIN_PASSWORD)
  check('管理员登录成功', Boolean(adminToken))
  if (!adminToken) throw new Error('管理员登录失败，终止验收')

  await ensureOperator(adminToken, AUTHOR_LOGIN, '提示词验收作者')
  await ensureOperator(adminToken, PEER_LOGIN, '提示词验收他人')
  const authorToken = await login(AUTHOR_LOGIN, ACCOUNT_PASSWORD)
  const peerToken = await login(PEER_LOGIN, ACCOUNT_PASSWORD)
  check('作者账号登录成功', Boolean(authorToken))
  check('他人账号登录成功', Boolean(peerToken))
  if (!authorToken || !peerToken) throw new Error('验收账号准备失败，终止验收')

  process.stdout.write('\n[2] 创建与校验\n')
  const created1 = await api('/ai/prompts', {
    method: 'POST',
    token: authorToken,
    body: {
      name: NAME_A,
      title: 'ACoS 异常归因',
      body: BODY,
      summary: '广告效率排查',
      tags: ['广告', '广告', 'ACoS'],
    },
  })
  check('新建提示词返回 201', created1.status === 201, `实际 ${created1.status}`)
  const promptA = created1.data?.prompt
  if (promptA?.id) createdIds.push({ id: promptA.id, token: authorToken })
  check('新建后状态为 private（不会直接进共享池）', promptA?.status === 'private', `实际 ${promptA?.status}`)
  check(
    '标签按大小写不敏感去重',
    JSON.stringify(promptA?.tags) === JSON.stringify(['广告', 'ACoS']),
    JSON.stringify(promptA?.tags)
  )

  // 标题字段 2026-09-15 下线：只保留名称。列与历史值仍在库里，但接口既不要求也不返回它
  const noTitle = await api('/ai/prompts', {
    method: 'POST',
    token: authorToken,
    body: { name: '__DSH 提示词验收 无标题', body: BODY },
  })
  check('不传 title 也能新建（字段已下线）', noTitle.status === 201, `实际 ${noTitle.status}`)
  check(
    '接口不再返回 title 字段',
    noTitle.data?.prompt !== undefined && !('title' in noTitle.data.prompt),
    JSON.stringify(Object.keys(noTitle.data?.prompt ?? {}))
  )
  if (noTitle.data?.prompt?.id) createdIds.push({ id: noTitle.data.prompt.id, token: authorToken })

  const duplicate = await api('/ai/prompts', {
    method: 'POST',
    token: authorToken,
    body: { name: NAME_A.toLowerCase(), title: '重复名', body: BODY },
  })
  check('个人库内同名（大小写不同）返回 409', duplicate.status === 409, `实际 ${duplicate.status}`)

  const badName = await api('/ai/prompts', {
    method: 'POST',
    token: authorToken,
    body: { name: '__DSH @非法名', title: 't', body: BODY },
  })
  check('名称含 @ 返回 400', badName.status === 400, `实际 ${badName.status}`)

  const emptyBody = await api('/ai/prompts', {
    method: 'POST',
    token: authorToken,
    body: { name: '__DSH 空正文', title: 't', body: '   ' },
  })
  check('正文为空返回 400', emptyBody.status === 400, `实际 ${emptyBody.status}`)

  process.stdout.write('\n[3] 跨账号隔离\n')
  const peerRead = await api(`/ai/prompts/${promptA.id}`, { token: peerToken })
  check('他人读取我的私有提示词返回 404（不泄露存在性）', peerRead.status === 404, `实际 ${peerRead.status}`)

  const peerMine = await api('/ai/prompts?scope=mine', { token: peerToken })
  check(
    '他人列表里看不到我的私有提示词',
    !(peerMine.data?.prompts ?? []).some((item) => item.id === promptA.id)
  )

  process.stdout.write('\n[4] 提报与审核队列\n')
  const illegalApprove = await api(`/ai/distill/prompts/${promptA.id}/approve`, {
    method: 'POST',
    token: adminToken,
  })
  check(
    'private 直接审核通过被拒（409，管理员也不能跳过待审）',
    illegalApprove.status === 409,
    `实际 ${illegalApprove.status}`
  )

  const submit = await api(`/ai/prompts/${promptA.id}/submit`, { method: 'POST', token: authorToken })
  check('提报返回 pending', submit.data?.prompt?.status === 'pending', `实际 ${submit.data?.prompt?.status}`)

  const resubmit = await api(`/ai/prompts/${promptA.id}/submit`, { method: 'POST', token: authorToken })
  check('重复提报返回 409', resubmit.status === 409, `实际 ${resubmit.status}`)

  const queue = await api('/ai/distill/prompts?status=pending', { token: adminToken })
  check('待审队列包含该条目', (queue.data?.prompts ?? []).some((item) => item.id === promptA.id))
  check('队列返回 pendingTotal 供角标', typeof queue.data?.pendingTotal === 'number')

  const peerApprove = await api(`/ai/distill/prompts/${promptA.id}/approve`, {
    method: 'POST',
    token: peerToken,
  })
  check('普通账号审核返回 403', peerApprove.status === 403, `实际 ${peerApprove.status}`)

  const peerQueue = await api('/ai/distill/prompts', { token: peerToken })
  check('普通账号读取审核队列返回 403', peerQueue.status === 403, `实际 ${peerQueue.status}`)

  process.stdout.write('\n[5] 通过后全员可用\n')
  const approve = await api(`/ai/distill/prompts/${promptA.id}/approve`, { method: 'POST', token: adminToken })
  check('管理员通过返回 published', approve.data?.prompt?.status === 'published', `实际 ${approve.data?.prompt?.status}`)

  const publishedForPeer = await api('/ai/prompts?scope=published', { token: peerToken })
  check(
    '他人账号在共享池能看到已通过条目',
    (publishedForPeer.data?.prompts ?? []).some((item) => item.id === promptA.id),
    `接口状态 ${publishedForPeer.status}`
  )

  const usable = await api(`/ai/prompts?scope=usable&keyword=${encodeURIComponent('ACoS 归因')}`, {
    token: peerToken,
  })
  /*
   * 状态码要单独断言（2026-09-16 补）：此前只断言"第一条是它"，接口 500 时
   * `data.prompts` 是 undefined、断言失败信息也只说"不是第一条"，看起来像数据问题；
   * 而真实原因是 `listPrompts` 把 ORDER BY 用的精确匹配参数混进了过滤参数数组，
   * 导致**任何带关键词的列表请求都 500**（不带关键词正常）。断言状态码才能一眼看出是接口挂了。
   */
  check('usable + 关键词返回 200', usable.status === 200, `接口状态 ${usable.status}`)
  check('usable 查询把名称精确匹配排第一位', usable.data?.prompts?.[0]?.id === promptA.id)

  const publishedSearch = await api(
    `/ai/prompts?scope=published&keyword=${encodeURIComponent('__DSH')}`,
    { token: peerToken }
  )
  check(
    'published + 关键词返回 200（三条 scope 都要覆盖）',
    publishedSearch.status === 200,
    `接口状态 ${publishedSearch.status}`
  )

  const mineSearch = await api(
    `/ai/prompts?scope=mine&keyword=${encodeURIComponent('__DSH')}`,
    { token: authorToken }
  )
  check('mine + 关键词返回 200', mineSearch.status === 200, `接口状态 ${mineSearch.status}`)

  const withdrawPublished = await api(`/ai/prompts/${promptA.id}/withdraw`, { method: 'POST', token: authorToken })
  check('已共享条目撤回提报被拒（409）', withdrawPublished.status === 409, `实际 ${withdrawPublished.status}`)

  const reApprove = await api(`/ai/distill/prompts/${promptA.id}/approve`, { method: 'POST', token: adminToken })
  check('已共享条目再次审核通过被拒（409）', reApprove.status === 409, `实际 ${reApprove.status}`)

  process.stdout.write('\n[6] 已共享条目修改后重审\n')
  const edit = await api(`/ai/prompts/${promptA.id}`, {
    method: 'PATCH',
    token: authorToken,
    body: { body: `${BODY}（已修改）` },
  })
  check('修改已共享条目后回到 pending', edit.data?.prompt?.status === 'pending', `实际 ${edit.data?.prompt?.status}`)

  const afterEdit = await api('/ai/prompts?scope=published', { token: peerToken })
  check(
    '回到待审后不再出现在共享池（保证审核不被绕过）',
    afterEdit.status === 200 && !(afterEdit.data?.prompts ?? []).some((item) => item.id === promptA.id),
    `接口状态 ${afterEdit.status}`
  )

  process.stdout.write('\n[7] 驳回\n')
  const rejectNoReason = await api(`/ai/distill/prompts/${promptA.id}/reject`, {
    method: 'POST',
    token: adminToken,
    body: {},
  })
  check('驳回未填原因返回 400', rejectNoReason.status === 400, `实际 ${rejectNoReason.status}`)

  const reject = await api(`/ai/distill/prompts/${promptA.id}/reject`, {
    method: 'POST',
    token: adminToken,
    body: { comment: '__DSH 验收驳回原因' },
  })
  check(
    '驳回返回 rejected 并带回原因',
    reject.data?.prompt?.status === 'rejected' && reject.data?.prompt?.reviewComment === '__DSH 验收驳回原因'
  )

  const resubmitAfterReject = await api(`/ai/prompts/${promptA.id}/submit`, { method: 'POST', token: authorToken })
  check('被驳回后可重新提报', resubmitAfterReject.data?.prompt?.status === 'pending')

  const withdraw = await api(`/ai/prompts/${promptA.id}/withdraw`, { method: 'POST', token: authorToken })
  check('待审状态可撤回为 private', withdraw.data?.prompt?.status === 'private')

  process.stdout.write('\n[8] 共享池名称全局唯一\n')
  const created2 = await api('/ai/prompts', {
    method: 'POST',
    token: peerToken,
    body: { name: NAME_B, title: '库存与在途检查', body: '看看这个 SKU 的可用库存、在途与占用。' },
  })
  const promptB = created2.data?.prompt
  check('他人账号新建提示词成功', created2.status === 201, `实际 ${created2.status}`)
  if (promptB?.id) createdIds.push({ id: promptB.id, token: peerToken })

  await api(`/ai/prompts/${promptB.id}/submit`, { method: 'POST', token: peerToken })
  await api(`/ai/distill/prompts/${promptB.id}/approve`, { method: 'POST', token: adminToken })

  const renameClash = await api(`/ai/prompts/${promptA.id}`, {
    method: 'PATCH',
    token: authorToken,
    body: { name: NAME_B },
  })
  check('个人库内改名允许（与共享池同名还不冲突）', renameClash.status === 200, `实际 ${renameClash.status}`)

  const clashSubmit = await api(`/ai/prompts/${promptA.id}/submit`, { method: 'POST', token: authorToken })
  check('提报时共享池已有同名返回 409', clashSubmit.status === 409, `实际 ${clashSubmit.status}`)

  process.stdout.write('\n[9] AI 优化提示词（不落库）\n')
  const optimizeAnon = await api('/ai/prompts/optimize', { method: 'POST', body: { body: BODY } })
  check('未登录调用优化接口返回 401', optimizeAnon.status === 401, `实际 ${optimizeAnon.status}`)

  const optimizeEmpty = await api('/ai/prompts/optimize', {
    method: 'POST',
    token: authorToken,
    body: { body: '   ' },
  })
  check('空正文返回 400', optimizeEmpty.status === 400, `实际 ${optimizeEmpty.status}`)

  const optimizeShort = await api('/ai/prompts/optimize', {
    method: 'POST',
    token: authorToken,
    body: { body: '看' },
  })
  check('过短草稿返回 400（不白烧一次模型调用）', optimizeShort.status === 400, `实际 ${optimizeShort.status}`)

  const bodyBefore = (await api(`/ai/prompts/${promptA.id}`, { token: authorToken })).data?.prompt?.body
  const optimize = await api('/ai/prompts/optimize', {
    method: 'POST',
    token: authorToken,
    body: { body: BODY, name: NAME_A, title: 'ACoS 归因' },
  })
  if (optimize.status === 200) {
    check(
      '已接入云模型时返回非空优化正文',
      typeof optimize.data?.body === 'string' && optimize.data.body.trim().length > 0
    )
  } else {
    // 演示模式（未配置 API Key）必须**明确拒绝**：既不能 500，也不能把原文当优化结果糊弄过去
    check(
      '演示模式下明确拒绝优化（400 + 说明），不编造结果',
      optimize.status === 400 && /演示模式|云模型/.test(String(optimize.data?.message ?? '')),
      `实际 ${optimize.status} ${optimize.data?.message ?? ''}`
    )
  }
  check('优化接口不返回 5xx', optimize.status < 500, `实际 ${optimize.status}`)

  const bodyAfter = (await api(`/ai/prompts/${promptA.id}`, { token: authorToken })).data?.prompt?.body
  check('优化是纯建议：条目正文未被改动', bodyAfter === bodyBefore, `实际 ${String(bodyAfter).slice(0, 20)}`)

  process.stdout.write('\n[10] 调用计数\n')
  const use = await api(`/ai/prompts/${promptB.id}/use`, { method: 'POST', token: peerToken })
  check('调用计数接口返回成功', use.status === 200 && use.data?.ok === true)
  const used = await api(`/ai/prompts/${promptB.id}`, { token: peerToken })
  check('调用次数已累加', used.data?.prompt?.usageCount === 1, String(used.data?.prompt?.usageCount))

  process.stdout.write('\n[11] 审计留痕\n')
  for (const action of ['prompt_create', 'prompt_submit', 'prompt_review']) {
    const logs = await api(`/ai/audit/logs?action=${action}&pageSize=5`, { token: adminToken })
    const rows = logs.data?.logs ?? logs.data?.rows ?? []
    check(
      `审计台记录 ${action}（targetType=ai_prompt）`,
      logs.status === 200 && rows.some((row) => (row.target_type ?? row.targetType) === 'ai_prompt')
    )
  }

  process.stdout.write('\n[12] 清理测试数据\n')
  for (const item of createdIds) {
    const removed = await api(`/ai/prompts/${item.id}`, { method: 'DELETE', token: item.token })
    check(`删除测试提示词 #${item.id}`, removed.status === 200, `实际 ${removed.status}`)
  }
  const afterClean = await api(`/ai/prompts?scope=usable&keyword=${encodeURIComponent('__DSH')}`, {
    token: adminToken,
  })
  check('清理后搜不到测试数据', (afterClean.data?.prompts ?? []).length === 0)
}

main()
  .catch((error) => {
    failures.push(`脚本异常：${error.message}`)
    process.stdout.write(`\n脚本异常：${error.message}\n`)
  })
  .finally(() => {
    process.stdout.write(`\n结果：通过 ${passed} 项，失败 ${failures.length} 项\n`)
    if (failures.length) {
      process.stdout.write('失败清单：\n')
      for (const item of failures) process.stdout.write(`  - ${item}\n`)
      process.exit(1)
    }
  })

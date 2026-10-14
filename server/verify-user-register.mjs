/**
 * 「用户自助注册 + 管理员审核」接口级验收脚本。
 *
 * 用法：
 *   node server/verify-user-register.mjs [baseUrl]
 *   默认 baseUrl = http://127.0.0.1:8787/api
 *
 * 前提：
 *   - API 已启动（launchd 服务或 pnpm run server）；
 *   - 仓库 .env 里有 INITIAL_ADMIN_LOGIN / INITIAL_ADMIN_PASSWORD（或用同名环境变量覆盖）。
 *
 * 两条必须知道的约束：
 *   1. 注册接口有**同 IP 每分钟 3 次**的频率限制，本脚本会刻意打满它来验证 429，
 *      因此跑之前 1 分钟内不要再做手工注册，否则前面几步会提前拿到 429；
 *   2. 脚本创建的临时账号在结束前会**按本次拿到的 ID 精确删除**，
 *      绝不按"最新 N 条"或时间范围清理（那会误删真实数据）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baseUrl = (process.argv[2] ?? 'http://127.0.0.1:8787/api').replace(/\/$/, '')

function readEnvFile() {
  const file = path.join(root, '.env')
  if (!fs.existsSync(file)) return {}
  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        const key = line.slice(0, index).trim()
        const value = line
          .slice(index + 1)
          .trim()
          .replace(/^["']|["']$/g, '')
        return [key, value]
      })
  )
}

const env = readEnvFile()
const adminLogin = process.env.ADMIN_LOGIN ?? env.INITIAL_ADMIN_LOGIN
const adminPassword = process.env.ADMIN_PASSWORD ?? env.INITIAL_ADMIN_PASSWORD

if (!adminLogin || !adminPassword) {
  process.stderr.write(
    '缺少管理员账号：请在 .env 配置 INITIAL_ADMIN_LOGIN / INITIAL_ADMIN_PASSWORD，' +
      '或用 ADMIN_LOGIN / ADMIN_PASSWORD 环境变量传入。\n'
  )
  process.exit(2)
}

let passed = 0
let failed = 0
const lines = []

function check(name, ok, extra = '') {
  if (ok) passed += 1
  else failed += 1
  lines.push(`${ok ? '✔' : '✘'} ${name}${extra ? `  （${extra}）` : ''}`)
}

async function request(method, route, { body, token } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }
  return { status: response.status, data }
}

const stamp = Date.now()
const testLogin = `e2e_register_${stamp}`
const testPassword = 'e2e-pass-12345'
/** 本次创建的账号 id：只按这些 id 清理，不做范围删除 */
const createdIds = []

async function main() {
  process.stdout.write(`▶ 自助注册验收：${baseUrl}\n`)

  // 1. 管理员登录，拿后续要用的 token
  const admin = await request('POST', '/auth/login', {
    body: { login: adminLogin, password: adminPassword },
  })
  check(
    '管理员可登录并拿到 token',
    admin.status === 200 && Boolean(admin.data?.token),
    `HTTP ${admin.status}`
  )
  const adminToken = admin.data?.token
  if (!adminToken) return

  // 2. 注册（请求体里故意带 role=admin / department，验证服务端会丢弃这些字段）
  const register = await request('POST', '/auth/register', {
    body: {
      login: testLogin,
      name: '注册验收账号',
      password: testPassword,
      role: 'admin',
      department: '伪造部门',
    },
  })
  check(
    '注册接口返回 201',
    register.status === 201,
    `HTTP ${register.status} ${JSON.stringify(register.data)}`
  )

  // 3. 待审核账号不能登录，且提示语要说明原因
  const pendingLogin = await request('POST', '/auth/login', {
    body: { login: testLogin, password: testPassword },
  })
  check(
    '待审核账号登录被拒（401）',
    pendingLogin.status === 401,
    `HTTP ${pendingLogin.status}`
  )
  check(
    '提示语说明「等待管理员审核」',
    /等待管理员审核/.test(pendingLogin.data?.message ?? ''),
    pendingLogin.data?.message
  )

  // 4. 密码错误时必须仍是统一文案 —— 否则不用密码就能探出账号状态
  const wrongPassword = await request('POST', '/auth/login', {
    body: { login: testLogin, password: 'definitely-wrong-password' },
  })
  check(
    '密码错误时不泄露账号状态',
    /账号或密码错误/.test(wrongPassword.data?.message ?? ''),
    wrongPassword.data?.message
  )

  // 5. 管理员列表里应能筛出这条待审核记录
  const list = await request('GET', '/users', { token: adminToken })
  const target = (list.data ?? []).find((user) => user.login === testLogin)
  if (target?.id) createdIds.push(target.id)
  check('新账号落库状态为 pending', target?.status === 'pending', `status=${target?.status}`)
  check(
    '注册者不能自选角色（落库为 operator）',
    target?.role === 'operator',
    `role=${target?.role}`
  )
  check(
    '注册者不能自填部门（落库为空）',
    (target?.department ?? '') === '',
    `department="${target?.department ?? ''}"`
  )

  // 6. 审核通过 → 立即可登录
  if (target?.id) {
    const approve = await request('PATCH', `/users/${target.id}/status`, {
      token: adminToken,
      body: { status: 'enabled' },
    })
    check('管理员审核通过（置为 enabled）', approve.status === 200, `HTTP ${approve.status}`)

    const loginAfterApprove = await request('POST', '/auth/login', {
      body: { login: testLogin, password: testPassword },
    })
    check(
      '审核通过后可正常登录',
      loginAfterApprove.status === 200 && Boolean(loginAfterApprove.data?.token),
      `HTTP ${loginAfterApprove.status}`
    )
  } else {
    check('管理员审核通过（置为 enabled）', false, '未在列表中找到该账号')
    check('审核通过后可正常登录', false, '未在列表中找到该账号')
  }

  // 7. 重复注册 → 409（复用账号唯一约束口径）
  const duplicate = await request('POST', '/auth/register', {
    body: { login: testLogin, name: '重复注册', password: testPassword },
  })
  check('账号已存在时返回 409', duplicate.status === 409, `HTTP ${duplicate.status}`)

  // 8. 弱密码 → 400（公开接口不能放过弱密码）
  const weak = await request('POST', '/auth/register', {
    body: { login: `e2e_weak_${stamp}`, name: '弱密码', password: '123' },
  })
  check('弱密码被拒（400）', weak.status === 400, `HTTP ${weak.status} ${weak.data?.message ?? ''}`)

  // 9. 第 4 次注册请求应被频率限制拦下（默认 3 次/分钟）
  const limited = await request('POST', '/auth/register', {
    body: { login: `e2e_rate_${stamp}`, name: '限流测试', password: testPassword },
  })
  check(
    '超过频率限制返回 429',
    limited.status === 429,
    `HTTP ${limited.status} ${limited.data?.message ?? ''}`
  )

  // 10. 注册动作必须留痕
  const audit = await request('GET', '/ai/audit/logs?action=user_register&pageSize=20', {
    token: adminToken,
  })
  const audited = (audit.data?.logs ?? []).some((log) => log.detail?.login === testLogin)
  check('注册动作写入审计（action=user_register）', audited, `HTTP ${audit.status}`)

  // 11. 精确清理（按 id）
  for (const id of createdIds) {
    const removed = await request('DELETE', `/users/${id}`, { token: adminToken })
    check(`清理临时账号 #${id}`, removed.status === 204, `HTTP ${removed.status}`)
  }
}

await main()

process.stdout.write(`${lines.join('\n')}\n`)
process.stdout.write(
  `\n${failed === 0 ? '✔ 全部通过' : '✘ 存在失败'}：${passed}/${passed + failed}\n`
)
process.exit(failed === 0 ? 0 : 1)

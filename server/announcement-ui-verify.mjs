/**
 * 公告功能 UI 验收（系统 Chrome，不需要下载 Playwright Chromium）。
 *
 * 用法（与 verify-ui.mjs 同一套路：独立 Vite 实例指向独立 API 实例）：
 *   API_PORT=8790 SERVE_STATIC=false node server/index.mjs                          # 终端 A
 *   API_PORT=8790 pnpm exec vite --port 5176 --strictPort                           # 终端 B
 *   node server/announcement-ui-verify.mjs http://localhost:5176                     # 终端 C
 *
 * 断言的就是需求本身：
 * ① 管理员在「设置 → 公告管理」能新建 / 发布公告；
 * ② 员工**登录后**看到弹窗，点「我知道了」后关闭；
 * ③ 多条待弹公告排队逐条展示；
 * ④ **刷新页面不再弹**（"每次登录时弹出"里的"登录"必须真的指登录）；
 * ⑤ 「只弹一次」的公告确定后，**再次登录也不再弹**；「每次登录都弹」的公告再次登录仍会弹。
 *
 * 数据全部用 `__DSH` 前缀，结束时通过接口软删（与界面删除语义一致）。
 */
import dotenv from 'dotenv'
import { chromium } from 'playwright'

dotenv.config()

const BASE = process.argv[2] ?? 'http://localhost:5176'
const API = `${BASE}/api`
const LOGIN = process.env.INITIAL_ADMIN_LOGIN
const PASSWORD = process.env.INITIAL_ADMIN_PASSWORD
const OUT = process.env.ANNOUNCE_VERIFY_OUT ?? 'verify-artifacts'

const PREFIX = '__DSH 公告验收'
const ONCE_TITLE = `${PREFIX} 一次性通知`
const EVERY_TITLE = `${PREFIX} 每次登录通知`
const CREATED_TITLE = `${PREFIX} UI 新建`

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  process.stdout.write(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}\n`)
}

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(API + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  try {
    return { status: response.status, data: JSON.parse(text) }
  } catch {
    return { status: response.status, data: null }
  }
}

const loginResponse = await api('/auth/login', {
  method: 'POST',
  body: { login: LOGIN, password: PASSWORD },
})
const adminToken = loginResponse.data?.token
if (!adminToken) {
  process.stderr.write('管理员登录失败，终止 UI 验收\n')
  process.exit(1)
}

/** 先清掉上一次运行可能残留的同名公告，避免"到底弹的是哪一条"说不清。 */
async function cleanup() {
  const list = await api(`/announcements?keyword=${encodeURIComponent(PREFIX)}&pageSize=100`, {
    token: adminToken,
  })
  for (const item of list.data?.items ?? []) {
    await api(`/announcements/${item.id}`, { method: 'DELETE', token: adminToken })
  }
}

await cleanup()

async function createPublished(title, displayMode) {
  const created = await api('/announcements', {
    method: 'POST',
    token: adminToken,
    body: {
      title,
      body: `这是「${title}」的正文。\n\n- 第一点\n- 第二点`,
      displayMode,
      priority: displayMode === 'every_login' ? 5 : 1,
    },
  })
  await api(`/announcements/${created.data.id}/status`, {
    method: 'POST',
    token: adminToken,
    body: { status: 'published' },
  })
  return created.data.id
}

// 「每次登录都弹」的优先级更高，因此它总是排在待弹队列最前面
const everyId = await createPublished(EVERY_TITLE, 'every_login')
const onceId = await createPublished(ONCE_TITLE, 'once')

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } })
// 拦掉外部字体：截图会等 document.fonts.ready，CDN 不可达时这一步会直接挂超时
await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
const page = await context.newPage()

const consoleErrors = []
/**
 * 无 URL 的"资源加载失败"按外部噪声处理：被上面拦掉的字体请求正是这条文案
 * （与 verify-ui.mjs / verify-prompt-optimize-ui.mjs 同口径）。
 * 应用自身的问题按 URL 归因，不靠猜控制台文案。
 */
const EXTERNAL_RESOURCE_NOISE =
  /^Failed to load resource: net::ERR_(CONNECTION_CLOSED|ABORTED|FAILED)$/
const appRequestFailures = []

page.on('console', (msg) => {
  if (msg.type() !== 'error') return
  const text = msg.text().slice(0, 300)
  if (EXTERNAL_RESOURCE_NOISE.test(text)) return
  consoleErrors.push(text)
})
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`))
page.on('requestfailed', (request) => {
  const url = request.url()
  // 只关心应用自己的请求；Vite 依赖预构建重建会让旧 deps URL 上的在途请求 abort
  if (!url.startsWith(BASE) || /\/node_modules\/\.vite\/deps\//.test(url)) return
  /*
    Vite dev 的**源码模块**请求在页面导航时会被浏览器取消（net::ERR_ABORTED）：
    本脚本大量 page.goto / 重新登录，稳定会触发若干条，与接口成败无关。
    真正要盯的是 XHR/fetch（/api/*）与静态资源 —— 它们不匹配下面这条，仍然会被记下来。
  */
  const abortedDevModule =
    request.failure()?.errorText === 'net::ERR_ABORTED' &&
    /\/src\/|\/@(vite|react-refresh|id)\//.test(url)
  if (abortedDevModule) return
  appRequestFailures.push(`${url} → ${request.failure()?.errorText ?? 'unknown'}`)
})

/** 已读上报的公告 id（[6] 段用来验证"关掉也算已读"）。 */
const ackedIds = []
page.on('request', (request) => {
  const matched = request.url().match(/\/announcements\/(\d+)\/ack/)
  if (matched) ackedIds.push(Number(matched[1]))
})

async function shot(name) {
  try {
    // 等弹窗/抽屉的进出场动画结束再截：动画中途的截图整屏都是淡入的中间态，作为证据读不出内容
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 15000 })
  } catch {
    process.stdout.write(`  （截图 ${name} 失败，不影响验收结论）\n`)
  }
}

async function signIn() {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('textbox', { name: '账号 / 邮箱' }).fill(LOGIN)
  await page.getByLabel('密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 15000 })
}

/** 弹窗容器（Radix dialog），用于判断"有没有公告弹出"。 */
function dialog() {
  return page.locator('[role="dialog"]')
}

async function waitForAnnouncement(title, timeout = 10000) {
  await page.locator('[role="dialog"]', { hasText: title }).first().waitFor({ timeout })
}

/**
 * 逐条关闭队列里的其它公告，直到目标标题成为当前弹窗。
 *
 * 多个公告是**排队逐条弹**的（顺序由服务端定：优先级 → 发布时间），
 * 所以"等某一条出现"必须先把它前面的处理掉 —— 否则等待的是排在后面的那一条，只会超时。
 */
async function dismissUntilVisible(title, max = 6) {
  const currentTitle = async () =>
    page
      .locator('[role="dialog"] [data-slot="dialog-title"]')
      .first()
      .textContent()
      .catch(() => null)

  for (let i = 0; i < max; i += 1) {
    if ((await currentTitle()) === title) return true
    const button = page.getByRole('button', { name: '我知道了' })
    if (!(await button.count())) break
    await button.first().click()
    await page.waitForTimeout(700)
  }
  return (await currentTitle()) === title
}

process.stdout.write('\n[1] 登录后弹出公告（多条排队）\n')
await signIn()

await waitForAnnouncement(EVERY_TITLE)
check('登录后弹出待弹公告', true)
check(
  '优先级高的排在前面',
  await dialog().filter({ hasText: EVERY_TITLE }).first().isVisible()
)
const remainingHint = page.getByText(/还有 \d+ 条公告待查看/)
check('提示还剩几条公告', await remainingHint.isVisible())
await shot('announcement-login-1')

await page.getByRole('button', { name: '我知道了' }).click()
await page.getByRole('button', { name: '我知道了' }).waitFor({ state: 'visible', timeout: 10000 })
check('点「我知道了」后接着弹下一条（不是一次性全关掉）', true)
check(
  '第二条是一次性通知',
  await dialog().filter({ hasText: ONCE_TITLE }).first().isVisible()
)

await page.getByRole('button', { name: '我知道了' }).click()
await dialog().waitFor({ state: 'detached', timeout: 10000 })
check('全部确认后弹窗关闭', true)

process.stdout.write('\n[2] 刷新页面不再弹（"每次登录"必须真的指登录）\n')
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
check('刷新页面后没有公告弹窗', (await dialog().count()) === 0)

process.stdout.write('\n[3] 「只弹一次」与「每次登录都弹」的差别\n')
await context.clearCookies()
await signIn()
await waitForAnnouncement(EVERY_TITLE)
check('再次登录：每次登录都弹的公告仍然弹出', true)
await page.waitForTimeout(800)
check('再次登录：只弹一次的公告不再弹出', (await page.getByText(ONCE_TITLE).count()) === 0)

await page.getByRole('button', { name: '我知道了' }).click()
await dialog().waitFor({ state: 'detached', timeout: 10000 })

process.stdout.write('\n[4] 管理页：列表 / 新建 / 发布\n')
await page.goto(`${BASE}/settings/announcements`, { waitUntil: 'domcontentloaded' })
await page.getByText(EVERY_TITLE).first().waitFor({ timeout: 10000 })
check('公告管理页列出已有公告', true)
check(
  '列表显示弹出方式',
  (await page.getByText('每次登录都弹').count()) > 0 &&
    (await page.getByText('只弹一次').count()) > 0
)
check('列表显示已读人数', (await page.getByText('已读').count()) > 0)
await shot('announcement-admin-list')

await page.getByRole('button', { name: '新建公告' }).click()
await page.locator('#announcement-title').fill(CREATED_TITLE)
await page.locator('#announcement-body').fill('由 UI 验收脚本创建的公告正文。')
await page.getByRole('button', { name: '创建草稿' }).click()
await page.locator('[role="dialog"]').waitFor({ state: 'detached', timeout: 10000 })

const createdRow = page.locator('tr', { hasText: CREATED_TITLE }).first()
await createdRow.waitFor({ timeout: 10000 })
check('新建后出现在列表里', true)
check('新建的公告是草稿状态', (await createdRow.getByText('草稿').count()) > 0)

await page.getByRole('button', { name: `发布 ${CREATED_TITLE}` }).click()
await page
  .locator('tr', { hasText: CREATED_TITLE })
  .first()
  .getByText('已发布')
  .waitFor({ timeout: 10000 })
check('点「发布」后状态变为已发布', true)

await page
  .locator('tr', { hasText: CREATED_TITLE })
  .first()
  .getByRole('button', { name: `下线 ${CREATED_TITLE}` })
  .waitFor({ timeout: 10000 })
check('已发布的行显示「下线」按钮（可回退）', true)
await shot('announcement-admin-published')

process.stdout.write('\n[5] 新发布的公告出现的时机\n')
await page.goto(`${BASE}/ai-agent`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
check('站内跳转不会重复弹公告', (await dialog().count()) === 0)

await context.clearCookies()
await signIn()
await waitForAnnouncement(EVERY_TITLE)
check('管理员新发布的公告出现在下一次登录的弹窗队列里', true)
const onlineQueue = page.getByText(/还有 \d+ 条公告待查看/)
check('队列里已包含刚发布的公告（提示条仍在）', await onlineQueue.isVisible())
await shot('announcement-login-2')

/*
  [6] 关闭方式即确认（2026-09-16 缺陷的回归护栏）
  用户反馈「同一条公告关掉又弹」：当时只有点「我知道了」才上报已读，
  用 ✕ / Esc / 遮罩关掉不算，于是「只弹一次」的公告下次登录还会再弹。
  这里固定住修复后的语义：关掉就上报已读，重新登录不再弹。
*/
process.stdout.write('\n[6] 关闭方式即确认（✕ 关闭后重新登录不再弹）\n')
const CLOSE_TITLE = `${PREFIX} 关闭方式验证`
const closeTarget = await api('/announcements', {
  method: 'POST',
  token: adminToken,
  body: { title: CLOSE_TITLE, body: '关闭方式验证正文。', displayMode: 'once', priority: 0 },
})
await api(`/announcements/${closeTarget.data.id}/status`, {
  method: 'POST',
  token: adminToken,
  body: { status: 'published' },
})

await context.clearCookies()
await signIn()
// 队列里还有「每次登录都弹」的那条（优先级更高，排在最前），先逐条关掉再看目标
check('弹出「关闭方式验证」公告', await dismissUntilVisible(CLOSE_TITLE))

await page.locator('[role="dialog"] button:has(svg.lucide-x)').first().click()
await page.waitForTimeout(1000)
// 队列里可能还有别的公告：关掉一条会前进到下一条，而不是"弹窗消失"
const titleAfterClose = await page
  .locator('[role="dialog"] [data-slot="dialog-title"]')
  .first()
  .textContent()
  .catch(() => null)
check(
  '✕ 关闭后不再显示该条（队列前进）',
  titleAfterClose !== CLOSE_TITLE,
  `当前显示 ${titleAfterClose ?? '（无）'}`
)
check(
  '✕ 关闭也上报了已读（修复前这里为 0）',
  ackedIds.includes(closeTarget.data.id),
  `已上报 ${JSON.stringify(ackedIds)}`
)

await context.clearCookies()
await signIn()
await page.waitForTimeout(1500)
check(
  '重新登录不再弹同一条（修复前会再弹）',
  (await page.getByText(CLOSE_TITLE).count()) === 0
)

process.stdout.write('\n[7] 控制台与清理\n')
check(
  '全程无控制台 error',
  consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(' | ')
)
check(
  '应用自身请求没有失败',
  appRequestFailures.length === 0,
  appRequestFailures.slice(0, 3).join(' | ')
)

await cleanup()
const left = await api(`/announcements?keyword=${encodeURIComponent(PREFIX)}&pageSize=100`, {
  token: adminToken,
})
check('验收数据已软删', (left.data?.items ?? []).length === 0)

await context.close()
await browser.close()

const failed = checks.filter((item) => !item.ok)
process.stdout.write(
  `\n公告 UI 验收：${checks.length - failed.length} 通过，${failed.length} 失败\n` +
    (failed.length
      ? `失败项：\n${failed.map((item) => `  - ${item.name}${item.detail ? ` — ${item.detail}` : ''}`).join('\n')}\n`
      : '') +
    '\n如需连同软删行一并清除（审计不可删，按项目原则保留）：\n' +
    `  DELETE FROM announcements WHERE title LIKE '${PREFIX}%';\n\n`
)
process.exit(failed.length ? 1 : 0)

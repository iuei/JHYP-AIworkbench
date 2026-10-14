/**
 * 顶栏面包屑 + 多页签工作台 + 列表页壳的浏览器验收脚本（2026-09-17）。
 *
 * 用法（默认打用户自己的开发实例；**只读**，不写任何业务数据）：
 *   node server/verify-page-shell.mjs [http://localhost:5173]
 *
 * 与 `server/verify-nav-ia.mjs` 相同的两条纪律：用系统 Chrome（`channel: 'chrome'`）、
 * 只在应用自身来源的请求失败或页面报错时判失败（外部字体 CDN 噪声不算）。
 *
 * 它守的是本轮改动的四条口径：
 *   1. 顶栏**只有一个 h1**，且就是面包屑末级（页面名）—— 这是 2026-09-11
 *      "顶部栏是唯一的页面标题位"这条口径的延续，`asin-redesign-check.mjs` 也依赖它；
 *   2. 面包屑层级名与侧边栏**同源**（`/admin/ai/datasources` → 仪表盘 / AI 治理 / 数据源与导入）；
 *   3. 页签栏：打开过哪些页面、重复打开不新增、刷新保持、关闭当前页会跳到相邻页；
 *   4. 用户管理页的列表页壳：工具区分两排（检索 + 筛选 / 动作按钮），
 *      批量启停按钮在**未勾选时置灰**、勾选后可用。
 *
 * **无副作用**：批量启用/停用按钮只做 `disabled` 断言，**从不点击**；
 * 勾选的行在断言后立即取消。
 */
import dotenv from 'dotenv'
import { chromium } from 'playwright'

dotenv.config()

const BASE = process.argv[2] ?? 'http://localhost:5173'
const LOGIN = process.env.INITIAL_ADMIN_LOGIN
const PASSWORD = process.env.INITIAL_ADMIN_PASSWORD
const OUT = process.env.PAGE_SHELL_VERIFY_OUT ?? 'verify-artifacts'

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail, skipped: false })
  process.stdout.write(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}\n`)
}
function skip(name, detail) {
  checks.push({ name, ok: true, detail, skipped: true })
  process.stdout.write(`○ ${name}${detail ? ` — ${detail}` : ''}（跳过）\n`)
}

/**
 * 各模块的代表性路径 → 期望的完整面包屑。
 *
 * 这几条一起构成"层级推导"的回归护栏，覆盖四种命中方式：
 * 精确命中一级叶子、精确命中二级子项、`matchPrefix` 前缀命中、以及**逐级回退**。
 * 期望值**写死**是有意的 —— 用 `buildBreadcrumb` 自己算一遍再比对等于没测。
 */
const BREADCRUMB_CASES = [
  ['/', ['仪表盘']],
  ['/prompts', ['仪表盘', '提示词广场']],
  ['/asin-watchlists', ['仪表盘', '我的 ASIN']],
  /*
   * 两条**旧链接**用例（2026-09-18 起都不再有独立页面，重定向到新落点）：
   * `/asin-watchlists/items` → `/asin-watchlists`（我的 ASIN 单页化，明细页并入数据表）；
   * `/ai-agent/notes` → `/knowledge`（我的沉淀迁进「知识库 → 个人知识库」）。
   * 断言随之改为"重定向后真实落在哪"；旧链接不能掉进 notFound 仍是要守住的东西。
   */
  ['/asin-watchlists/items', ['仪表盘', '我的 ASIN']],
  ['/ai-agent/notes', ['仪表盘', '知识库']],
  ['/product-dev/market', ['仪表盘', '产品开发', '市场调研']],
  ['/competitor-analysis', ['仪表盘', '竞品分析', '分析']],
  ['/competitor-analysis/results', ['仪表盘', '竞品分析', '分析结果']],
  ['/admin/users', ['仪表盘', '用户管理']],
  // 「AI 治理」现在是一级入口，四个治理子页由顶栏中段导航承载 —— 面包屑三级，标签名各自独立
  // （「知识库」2026-09-18 已并入「AI 工作台 → 知识库」，不再是治理子页）
  ['/admin/ai/datasources', ['仪表盘', 'AI 治理', '数据源与导入']],
  ['/admin/ai/audit', ['仪表盘', 'AI 治理', '审计台']],
  // 个人页刻意不在 navItems 里 → 退化成"根 + 路由标题"
  ['/settings', ['仪表盘', '用户信息']],
]

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } })
// 外部字体 CDN 在受限网络下会挂起，而 screenshot() 会等字体就绪（实测能卡到 30s）
await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
const page = await context.newPage()

const BASE_ORIGIN = new URL(BASE).origin
const APP_ORIGINS = [
  new RegExp(`^${BASE_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`),
  /^https?:\/\/127\.0\.0\.1:8787\//,
]
const VITE_DEP_CHURN = /\/node_modules\/\.vite\/deps\//
/*
 * 外部字体 CDN 是**本脚本自己**中断的（见上面的 route.abort），
 * 浏览器会因此打一条通用资源错误 —— 它不是应用缺陷，必须过滤掉，
 * 否则每次运行都会假失败一次。应用自身的加载失败由下面的 `requestfailed` 单独统计。
 */
const EXTERNAL_NOISE =
  /^Failed to load resource: net::ERR_(CONNECTION_CLOSED|ABORTED|FAILED)$/

const consoleErrors = []
const appRequestFailures = []
page.on('console', (msg) => {
  if (msg.type() !== 'error') return
  const text = msg.text().slice(0, 300)
  if (EXTERNAL_NOISE.test(text)) return
  consoleErrors.push(text)
})
page.on('pageerror', (err) =>
  consoleErrors.push(`pageerror: ${String(err).slice(0, 300)}`)
)
page.on('requestfailed', (request) => {
  const url = request.url()
  const reason = request.failure()?.errorText ?? 'unknown'
  if (!APP_ORIGINS.some((p) => p.test(url)) || VITE_DEP_CHURN.test(url)) return
  // dev server 上跳转/HMR 会主动中断在途模块请求，不算失败
  if (reason.includes('ERR_ABORTED')) return
  appRequestFailures.push(`${url} → ${reason}`)
})

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
}

/** 面包屑的各级文字（不含分隔符 —— 分隔符带 aria-hidden）。 */
async function breadcrumbTitles() {
  return (
    await page
      .locator("nav[aria-label='面包屑'] li > :not([aria-hidden])")
      .allInnerTexts()
  ).map((text) => text.trim())
}

/** 页签栏里每个标签的标题。 */
async function tabTitles() {
  return (
    await page.locator('[data-page-tab] a').allInnerTexts()
  ).map((text) => text.trim())
}

async function activeTabTitle() {
  const active = page.locator('[data-page-tab][data-active="true"] a')
  if ((await active.count()) === 0) return null
  return (await active.first().innerText()).trim()
}

async function tabCount() {
  return page.locator('[data-page-tab]').count()
}

try {
  // ---------- 登录 ----------
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('账号 / 邮箱').fill(LOGIN)
  await page.getByLabel('密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL((url) => !url.pathname.includes('sign-in'), { timeout: 20000 })
  check('登录成功', true, page.url().replace(BASE, ''))

  /*
   * 把页签状态清干净再开始：这个 sessionStorage 键可能带着上一次人工操作留下的标签，
   * 不清的话下面的"标签数 === N"断言全是假的（不是本轮代码算错了，是起点不干净）。
   */
  await page.evaluate(() => sessionStorage.clear())
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-page-tabs]', { timeout: 20000 })

  // ---------- 1. 首页：面包屑只有一项，且它仍是唯一的 h1 ----------
  const homeTitles = await breadcrumbTitles()
  check(
    '首页面包屑只有一项（就是侧边栏第一项的名字）',
    homeTitles.length === 1 && homeTitles[0] === '仪表盘',
    homeTitles.join(' / ')
  )
  const homeH1 = await page.getByRole('heading', { level: 1 }).count()
  check('顶栏仍是全页唯一的 h1', homeH1 === 1, `h1 数量 ${homeH1}`)

  // ---------- 2. 治理入口（自身即一级项）：两级面包屑 ----------
  await page.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector("nav[aria-label='面包屑']", { timeout: 20000 })
  await page.waitForSelector("table tbody tr", { timeout: 20000 })

  const usersTitles = await breadcrumbTitles()
  check(
    '面包屑给出「根 / 当前页」两级，名字与侧边栏同源',
    JSON.stringify(usersTitles) === JSON.stringify(['仪表盘', '用户管理']),
    usersTitles.join(' / ')
  )
  const usersH1 = await page.getByRole('heading', { level: 1 }).allInnerTexts()
  check(
    'h1 仍是唯一一个，且它就是面包屑末级（页面名）',
    usersH1.length === 1 && usersH1[0].trim() === '用户管理',
    usersH1.map((t) => t.trim()).join(' ｜ ')
  )
  const rootHref = await page
    .locator("nav[aria-label='面包屑'] a")
    .first()
    .getAttribute('href')
  check('面包屑根节点可点（回到首页）', rootHref === '/', String(rootHref))
  // 末级是"我在哪"，不给点不动的假链接：两级里只有根节点是 <a>
  const crumbLinks = (
    await page.locator("nav[aria-label='面包屑'] a").allInnerTexts()
  ).map((t) => t.trim())
  check(
    '只有根节点是可点链接（末级不给假链接）',
    JSON.stringify(crumbLinks) === JSON.stringify(['仪表盘']),
    crumbLinks.join(' / ')
  )
  await shot('page-shell-breadcrumb-tabs')

  // ---------- 3. 页签栏：打开、去重、激活 ----------
  const openedTitles = await tabTitles()
  check(
    '页签栏记录了打开过的两个页面（顺序 = 打开顺序）',
    JSON.stringify(openedTitles) === JSON.stringify(['仪表盘', '用户管理']),
    openedTitles.join(' ｜ ')
  )
  const activeOnUsers = await activeTabTitle()
  check('当前页的标签是激活态', activeOnUsers === '用户管理', String(activeOnUsers))

  await page.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(400)
  check(
    '重复打开同一路径不新增标签',
    (await tabCount()) === 2,
    `${await tabCount()} 个标签`
  )

  // ---------- 4. 刷新保持（sessionStorage） ----------
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-page-tabs]', { timeout: 20000 })
  check(
    '刷新后标签仍在（sessionStorage 保持）',
    (await tabCount()) === 2,
    (await tabTitles()).join(' ｜ ')
  )

  // ---------- 5. 点标签切页 / 关当前标签跳相邻页 ----------
  await page.locator('[data-page-tab] a', { hasText: '仪表盘' }).first().click()
  await page.waitForURL((url) => url.pathname === '/', { timeout: 10000 })
  check(
    '点标签切回上一页，且没有多开标签',
    (await tabCount()) === 2 && (await activeTabTitle()) === '仪表盘',
    (await tabTitles()).join(' ｜ ')
  )

  await page
    .locator('[data-page-tab][data-active="true"] button')
    .first()
    .click()
  await page.waitForTimeout(700)
  const urlAfterClose = new URL(page.url()).pathname
  check(
    '关掉当前标签后跳到相邻标签（不停在一个已关闭的页面上）',
    urlAfterClose === '/admin/users',
    urlAfterClose
  )
  check(
    '标签数随之减少，剩下那个仍是激活态',
    (await tabCount()) === 1 && (await activeTabTitle()) === '用户管理',
    (await tabTitles()).join(' ｜ ')
  )

  // ---------- 6. 多页面面包屑抽查（面包屑是全局改动，40+ 个路由都受影响） ----------
  for (const [path, expected] of BREADCRUMB_CASES) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector("nav[aria-label='面包屑']", { timeout: 20000 })
    await page.waitForTimeout(200)
    const titles = await breadcrumbTitles()
    const headings = (
      await page.getByRole('heading', { level: 1 }).allInnerTexts()
    ).map((text) => text.trim())
    const expectedTip = expected[expected.length - 1]
    const ok =
      JSON.stringify(titles) === JSON.stringify(expected) &&
      headings.length === 1 &&
      headings[0] === expectedTip
    check(
      `面包屑 ${path} → ${expected.join(' / ')}`,
      ok,
      `实际 [${titles.join(' / ')}]，h1 [${headings.join(' ｜ ')}]`
    )
  }

  /*
    标签栏的可用性底线：**已打开的标签不能重名**。
    这一条是实测截图发现的真实缺陷（`/asin-watchlists` 与 `/asin-watchlists/items`
    都叫「我的 ASIN」、五个治理子页都叫「AI 治理」），修法是让这些页面在路由上声明
    自己的 `staticData.title`。抽查段刚把 13 个页面都打开过，正好在这里统一验一次。
  */
  const allTabTitles = await tabTitles()
  check(
    '多页签里的标签不重名（同名用户无法区分）',
    new Set(allTabTitles).size === allTabTitles.length,
    allTabTitles.join(' ｜ ')
  )

  // ---------- 7. 列表页壳：工具区与按钮禁用态 ----------
  if (new URL(page.url()).pathname !== '/admin/users') {
    await page.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' })
  }
  await page.waitForSelector("table tbody tr", { timeout: 20000 })

  const searchBox = page.getByRole('search').locator('input')
  const roleFilter = page.getByLabel('角色筛选')
  const statusFilter = page.getByLabel('状态筛选')
  const createButton = page.getByRole('button', { name: '开通账号' })
  check(
    '工具区第一排：检索输入 + 两个筛选都在',
    (await searchBox.count()) === 1 &&
      (await roleFilter.count()) === 1 &&
      (await statusFilter.count()) === 1
  )
  check('工具区第二排：主按钮（开通账号）在位', (await createButton.count()) === 1)

  const enableButton = page.getByRole('button', { name: '批量启用' })
  const disableButton = page.getByRole('button', { name: '批量停用' })
  check(
    '未勾选时两个批量按钮置灰（禁用态）',
    (await enableButton.isDisabled()) && (await disableButton.isDisabled())
  )

  const allOnPage = page.getByRole('checkbox', { name: '全选本页用户' })
  check('表头有多选复选框', (await allOnPage.count()) === 1)

  /*
   * 勾第一行可用的复选框（自己的账号是 disabled 的，跳过它）。
   * 只勾不提交 —— 批量启停是影响他人的动作，脚本绝不触发。
   */
  const firstRowCheckbox = page
    .locator('table tbody button[role="checkbox"]:not([disabled])')
    .first()
  const rowCheckboxCount = await page
    .locator('table tbody button[role="checkbox"]:not([disabled])')
    .count()
  if (rowCheckboxCount === 0) {
    skip('勾选一行后按钮变可用', '本页没有可勾选的行（可能只有当前账号）')
  } else {
    await firstRowCheckbox.click()
    await page.waitForTimeout(200)
    check(
      '勾选一行后两个批量按钮变可用',
      (await enableButton.isEnabled()) && (await disableButton.isEnabled())
    )
    const selfCheckboxDisabled = await page
      .locator('table tbody button[role="checkbox"][disabled]')
      .count()
    check(
      '自己的账号那一行不可勾选（与行内按钮的既有闸门一致）',
      selfCheckboxDisabled >= 1,
      `${selfCheckboxDisabled} 行禁用`
    )
    await firstRowCheckbox.click()
    await page.waitForTimeout(200)
    check(
      '取消勾选后按钮回到禁用态，且没有残留选中',
      (await enableButton.isDisabled()) && (await disableButton.isDisabled())
    )
  }

  // 勾选状态不应跟着翻页/筛选残留 —— 改一次筛选即清空选择
  await statusFilter.click()
  await page.getByRole('option', { name: '已启用' }).click()
  await page.waitForTimeout(400)
  check(
    '改筛选会清空已选（避免跨筛选的批量操作）',
    (await page.locator('table tbody tr[data-state="selected"]').count()) === 0
  )
  await shot('page-shell-list-toolbar')

  // ---------- 7. 控制台 ----------
  check(
    '页面无控制台错误',
    consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' ｜ ')
  )
  check(
    '应用自身的请求没有失败',
    appRequestFailures.length === 0,
    appRequestFailures.slice(0, 3).join(' ｜ ')
  )
} finally {
  await browser.close()
}

const failed = checks.filter((c) => !c.ok)
const skipped = checks.filter((c) => c.skipped)
process.stdout.write(
  `\n${checks.length - failed.length - skipped.length}/${checks.length - skipped.length} 通过` +
    (skipped.length ? `（跳过 ${skipped.length}）` : '') +
    '\n'
)
if (failed.length) {
  process.stdout.write(
    `失败项：\n${failed.map((c) => ` - ${c.name} — ${c.detail}`).join('\n')}\n`
  )
  process.exit(1)
}

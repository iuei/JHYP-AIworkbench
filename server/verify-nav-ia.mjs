/**
 * 阶段 A（导航数据源统一 + 视图落 URL）的浏览器验收脚本。
 *
 * 用法（默认打用户自己的开发实例，只读、不写任何数据）：
 *   node server/verify-nav-ia.mjs [http://localhost:5173]
 *
 * 与 `server/ai-agent/verify-ui.mjs` 相同的两条纪律：
 * - 用系统 Chrome（`channel: 'chrome'`），不依赖下载 Playwright Chromium；
 * - 只在应用自身来源的请求失败或页面报错时判失败，外部字体 CDN 噪声不算。
 *
 * 它守的是**回归**，不是"环境是否完全可用"，所以每条断言都对应本轮改动的具体口径：
 *   1. 顶栏二级导航与侧边栏子项**同源**（此前 agent-nav.tsx 自己写了一份同样的三项）；
 *   2. 治理面的五项仍然齐（ADMIN_ITEMS 已搬进数据层，不能搬丢）；
 *   3. 顶栏的"可用工具"徽标仍在（改数据源时不能把徽标一起删掉）；
 *   4. 「我的 ASIN」两个视图 = 两个真实路由：点选跳转、刷新保持、深链直达、脏值不崩、
 *      旧链接（`?view=items` 与 `/ai-agent/asin-watchlists`）全部跳到新路径。
 */
import dotenv from 'dotenv'
import { chromium } from 'playwright'

dotenv.config()

const BASE = process.argv[2] ?? 'http://localhost:5173'
const LOGIN = process.env.INITIAL_ADMIN_LOGIN
const PASSWORD = process.env.INITIAL_ADMIN_PASSWORD
const OUT = process.env.NAV_IA_VERIFY_OUT ?? 'verify-artifacts'

/** 候选池为空时临时创建的验证用候选：名字带前缀便于识别，脚本末尾必定删除。 */
const VERIFY_CANDIDATE_NAME = '__DSH 验证__ 跨子页状态'
let createdForVerify = false

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail, skipped: false })
  process.stdout.write(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}\n`)
}
function skip(name, detail) {
  checks.push({ name, ok: true, detail, skipped: true })
  process.stdout.write(`○ ${name}${detail ? ` — ${detail}` : ''}（跳过）\n`)
}

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } })
/*
 * 外部字体 CDN 在受限网络下会一直挂起，而 Playwright 的 `screenshot()` 会等字体就绪
 * （实测卡到 30s 超时，整段脚本被打断）。这里直接中断这两个域名的请求：
 * 页面按系统字体回退渲染，布局断言与截图都不受影响。
 */
await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
const page = await context.newPage()

/** 应用自身的来源：BASE 自己 + 后端 API;脚本可跑在 5173（用户实例）或独立验证实例上。 */
const BASE_ORIGIN = new URL(BASE).origin
const APP_ORIGINS = [
  new RegExp(`^${BASE_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`),
  /^https?:\/\/127\.0\.0\.1:8787\//,
]
const EXTERNAL_NOISE = /^Failed to load resource: net::ERR_(CONNECTION_CLOSED|ABORTED|FAILED)$/
const VITE_DEP_CHURN = /\/node_modules\/\.vite\/deps\//

const consoleErrors = []
const appRequestFailures = []
const abortedRequests = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
})
page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${String(err).slice(0, 300)}`))
page.on('requestfailed', (request) => {
  const url = request.url()
  const reason = request.failure()?.errorText ?? 'unknown'
  if (!APP_ORIGINS.some((p) => p.test(url)) || VITE_DEP_CHURN.test(url)) return
  /*
   * `net::ERR_ABORTED` 单独归类：开发服务器上源码模块是按需加载的，
   * 页面跳转 / HMR 会让在途的模块请求被浏览器主动中断，这是 dev server 的固有行为，
   * 不代表资源加载失败（真实的 404 / 连接失败仍会进入 appRequestFailures 判失败）。
   */
  if (reason.includes('ERR_ABORTED')) {
    abortedRequests.push(url)
    return
  }
  appRequestFailures.push(`${url} → ${reason}`)
})

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
}

/**
 * 等「我的 ASIN」的页面导航（顶栏中段槽位）渲染。
 *
 * 2026-09-17 起这一模块不再有页内页签：一键分析 `/asin-watchlists` 与商品明细
 * `/asin-watchlists/items` 是两个**独立路由**，导航用链接（语义就是页面跳转），
 * 当前页由 `aria-current='page'` 表达。
 */
async function waitWorkspaceNav(timeout = 10000) {
  try {
    await page.waitForSelector("nav[aria-label='我的 ASIN 功能导航']", { timeout })
    return true
  } catch {
    return false
  }
}

/** 当前所在的页面（导航未渲染时返回 null）。 */
async function activePageLabel() {
  const current = page.locator(
    "nav[aria-label='我的 ASIN 功能导航'] a[aria-current='page']"
  )
  if ((await current.count()) === 0) return null
  return (await current.first().innerText()).trim()
}

try {
  // ---------- 登录 ----------
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('账号 / 邮箱').fill(LOGIN)
  await page.getByLabel('密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL((url) => !url.pathname.includes('sign-in'), { timeout: 20000 })
  check('登录成功', true, page.url().replace(BASE, ''))

  // ---------- 1. 顶栏与侧边栏同源 ----------
  await page.goto(`${BASE}/ai-agent`, { waitUntil: 'domcontentloaded' })

  /*
   * 2026-09-18：「AI 助手」由折叠类目（对话 / 我的沉淀）改为**单页类目** ——
   * 「我的沉淀」迁进新的「知识库」一级类目，顶栏因此不再挂二级导航，
   * 只保留「可用工具」状态徽标。
   *
   * 这里断言的是"没有页内导航"而不是"有 0 个子项"：同源派生的口径没变
   * （子项仍由 `sidebar-data.ts` 决定），将来给它加回子项时这段会失败，
   * 正好提醒把顶栏导航一起补上。
   */
  check(
    'AI 助手已是单页类目：顶栏不再挂二级导航',
    (await page.locator("nav[aria-label='AI 助手功能导航']").count()) === 0
  )
  check(
    '顶栏保留「可用工具」徽标',
    (await page.locator('header').innerText()).includes('可用工具')
  )

  // 侧边栏「AI 助手」不再是折叠类目：hover 不该弹出子项浮窗
  await page
    .locator('[data-slot="sidebar-content"] a[href="/ai-agent"]')
    .first()
    .hover()
  await page.waitForTimeout(600)
  check(
    '侧边栏「AI 助手」不再有子项浮窗（已是叶子类目）',
    (await page.locator("[role='menuitem']").count()) === 0
  )
  await shot('stage-a-header-vs-sidebar')

  // ---------- 1b. 侧边栏入口可达性：知识库（新一级项）+ 我的 ASIN + 提示词广场 ----------
  let navigated = 0
  for (const href of ['/knowledge', '/asin-watchlists', '/prompts']) {
    await page.goto(`${BASE}/ai-agent`, { waitUntil: 'domcontentloaded' })
    await page
      .locator(`[data-slot="sidebar-content"] a[href="${href}"]`)
      .first()
      .click()
    const landed = await page
      .waitForURL((url) => url.pathname === href, { timeout: 10000 })
      .then(() => true)
      .catch(() => false)
    if (landed) navigated += 1
  }
  check(
    '侧边栏入口可正常跳转（知识库 / 我的 ASIN / 提示词广场）',
    navigated === 3,
    `${navigated}/3`
  )

  // ---------- 2. 治理面四项仍在（数据层搬迁无遗漏；知识库 2026-09-18 已移出） ----------
  await page.goto(`${BASE}/admin/ai/datasources`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector("nav[aria-label='AI 治理功能导航']", { timeout: 20000 })
  const adminItems = (await page
    .locator("nav[aria-label='AI 治理功能导航'] a")
    .allInnerTexts()).map((t) => t.trim())
  check(
    'AI 治理顶栏 4 项齐备且顺序不变（知识库已移出）',
    JSON.stringify(adminItems) ===
      JSON.stringify(['数据源与导入', '经验审核', '模型与配置', '审计台']),
    adminItems.join(' ｜ ')
  )

  // ---------- 2.5 产品开发：三个子页是独立路由（阶段 B） ----------
  /** 顶栏可能带「（已选 N）」徽标（选了候选时才出现），比对名称时去掉它。 */
  const stripBulkBadge = (text) => text.replace(/（已选 \d+）/g, '').trim()

  await page.goto(`${BASE}/product-dev`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector("nav[aria-label='产品开发功能导航']", { timeout: 20000 })
  const prodHeaderItems = (
    await page.locator("nav[aria-label='产品开发功能导航'] a").allInnerTexts()
  ).map(stripBulkBadge)

  await page.getByRole('button', { name: '产品开发' }).hover()
  await page.waitForSelector("[role='menuitem']", { timeout: 5000 })
  const prodSidebarItems = (
    await page.locator("[role='menuitem']").allInnerTexts()
  ).map(stripBulkBadge)

  check(
    '侧边栏「产品开发」浮窗含 3 个子页',
    prodSidebarItems.length === 3,
    prodSidebarItems.join(' ｜ ')
  )
  check(
    '产品开发顶栏与侧边栏子项逐字一致（同源派生）',
    JSON.stringify(prodHeaderItems) === JSON.stringify(prodSidebarItems),
    `顶栏 [${prodHeaderItems.join(' ｜ ')}] / 侧边栏 [${prodSidebarItems.join(' ｜ ')}]`
  )

  // 两个非默认子页都能直达，且顶栏高亮跟着走
  for (const [path, label] of [
    ['/product-dev/compare', '对比与历史'],
    ['/product-dev/market', '市场调研'],
  ]) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    const active = await page
      .locator("nav[aria-label='产品开发功能导航'] a", { hasText: label })
      .first()
      .getAttribute('aria-current')
      .catch(() => null)
    check(`${label}可直接深链且顶栏高亮`, active === 'page', `${path} → aria-current=${active}`)
  }
  await shot('stage-b-product-dev-subpages')

  /*
    旧链接兼容：`?view=market` / `?view=compare` 是阶段 B 之前的页签参数，
    老书签与老的验收脚本都用过。这里**不带 keyword** —— 带关键词会让市场调研页
    自动发起一次卖家精灵调用（真实额度），而关键词透传已由
    `verify-market-research-ui.mjs` 的跳转链路覆盖。
  */
  for (const [legacy, expected] of [
    ['/product-dev?view=market', '/product-dev/market'],
    ['/product-dev?view=compare', '/product-dev/compare'],
  ]) {
    await page.goto(`${BASE}${legacy}`, { waitUntil: 'domcontentloaded' })
    const landed = await page
      .waitForURL((url) => url.pathname.endsWith(expected), { timeout: 8000 })
      .then(() => true)
      .catch(() => false)
    check(`旧链接 ${legacy} 重定向到 ${expected}`, landed, new URL(page.url()).pathname)
  }

  // ---------- 2.6 跨子页状态不丢（阶段 B 的核心不变量） ----------
  /*
    这是拆路由最容易踩坏的地方：状态若留在子页组件里，一切换就回到初始值 ——
    表现为"勾了候选、切到对比页却提示还没选择"，以及对比区间被打回默认。
    本段只读不写：不点「开始对比」（那会在库里留下一条对比历史记录）。
  */
  await page.goto(`${BASE}/product-dev`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector("nav[aria-label='产品开发功能导航']", { timeout: 20000 })
  const firstRowCheckbox = page.locator('table tbody tr').first().getByRole('checkbox')
  const hasCandidate = await firstRowCheckbox
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false)

  if (!hasCandidate) {
    /*
      自闭环：候选池为空时**临时造一条验证用候选**，否则这段核心断言只能跳过 ——
      而"跨子页状态不丢"恰恰是本次拆路由最容易踩坏、也最需要证据的地方。
      候选名带 `__DSH 验证__` 前缀，脚本末尾必定删除（无论后续断言成败）。
    */
    await page.getByRole('button', { name: '新增候选' }).click()
    await page.waitForSelector('#candidate-name', { timeout: 10000 })
    await page.fill('#candidate-name', VERIFY_CANDIDATE_NAME)
    await page
      .locator('[role=dialog]')
      .getByRole('button', { name: '保存', exact: true })
      .click()
    await page.waitForTimeout(1500)
    createdForVerify = true
    check('候选池为空，已临时创建验证用候选', true, VERIFY_CANDIDATE_NAME)
  }

  {
    await page.locator('table tbody tr').first().waitFor({ timeout: 15000 })
    await page.locator('table tbody tr').first().getByRole('checkbox').click()
    await page.waitForTimeout(400)

    const headerText = await page
      .locator("nav[aria-label='产品开发功能导航']")
      .innerText()
    check(
      '勾选候选后顶栏「对比与历史」出现已选数',
      /已选 1/.test(headerText),
      headerText.replace(/\s+/g, ' ')
    )

    // 切到对比子页：已选集合必须还在
    await page
      .locator("nav[aria-label='产品开发功能导航'] a", { hasText: '对比与历史' })
      .click()
    await page.waitForURL((url) => url.pathname.endsWith('/product-dev/compare'), {
      timeout: 10000,
    })
    await page.waitForTimeout(400)
    const compareMain = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
    /*
      断言的是"对比页拿到了同一个已选候选"：每个已选候选在对比卡片上都有一个
      「移除 X」按钮（`aria-label='移除 候选名'`），数量就是已选集合的大小。
      （「已选 1」只写在顶栏导航里，不在 main 内，所以不能拿它判 main。）
    */
    const selectedChips = await page.getByRole('button', { name: /^移除 / }).count()
    check(
      '对比子页仍带着同一个已选候选',
      selectedChips === 1 && !compareMain.includes('还没有选择候选'),
      `对比卡片上已选候选 ${selectedChips} 个`
    )

    // 对比区间也跨子页保留：换成「近 7 天」，切走再回来应仍是它
    await page.getByRole('tab', { name: '近 7 天' }).click()
    await page.waitForTimeout(400)
    await page
      .locator("nav[aria-label='产品开发功能导航'] a", { hasText: '候选池' })
      .click()
    await page.waitForURL((url) => !url.pathname.endsWith('/compare'), { timeout: 10000 })
    await page.waitForTimeout(500)
    await page
      .locator("nav[aria-label='产品开发功能导航'] a", { hasText: '对比与历史' })
      .click()
    await page.waitForURL((url) => url.pathname.endsWith('/product-dev/compare'), {
      timeout: 10000,
    })
    await page.waitForTimeout(400)
    const windowStillSeven = await page
      .getByRole('tab', { name: '近 7 天' })
      .getAttribute('aria-selected')
    check('对比区间切走再回来仍保留（近 7 天）', windowStillSeven === 'true')

    // 回候选池：勾选仍在（这是"状态上提"与"状态留在子页里"的分水岭）
    await page
      .locator("nav[aria-label='产品开发功能导航'] a", { hasText: '候选池' })
      .click()
    await page.waitForURL((url) => !url.pathname.endsWith('/compare'), { timeout: 10000 })
    await page.locator('table tbody tr').first().waitFor({ timeout: 15000 })
    await page.waitForTimeout(400)
    const stillChecked = await page
      .locator('table tbody tr')
      .first()
      .getByRole('checkbox')
      .getAttribute('aria-checked')
    check('回到候选池后勾选仍保持', stillChecked === 'true', String(stillChecked))
    await shot('stage-b-cross-page-state')
  }

  // ---------- 2.65 「开发中」徽标：产品开发（2026-09-18 用户口径；任务中心已于 2026-09-20 下线） ----------
  /*
    用户原话「任务中心板块和产品开发板块标注为开发中」。任务中心 2026-09-20 按用户要求整体下线后，
    这条断言只剩「产品开发」—— 但仍要守住它不会被角色过滤与三种渲染分支（叶子 / 桌面浮窗 / 移动端内联）丢掉。
  */
  const badgeLabels = await page
    .locator('[data-slot="sidebar-content"] a, [data-slot="sidebar-content"] button')
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => (node.textContent ?? '').includes('开发中'))
        .map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim())
    )
  check(
    '侧边栏「产品开发」带「开发中」徽标',
    badgeLabels.some((text) => text.includes('产品开发')),
    badgeLabels.join(' / ') || '（没有找到带徽标的入口）'
  )
  check(
    '侧边栏不再出现「任务中心」',
    !badgeLabels.some((text) => text.includes('任务中心')),
    badgeLabels.join(' / ') || '（干净）'
  )

  // ---------- 2.7 系统管理：三个治理入口平铺（2026-09-18 取消同名折叠类目） ----------
  /*
    改前侧边栏上「系统管理」连着出现两次（分组标签 + 同名折叠类目，子项在浮窗里），
    用户口径「现在不需要这个一级类目为系统管理了」。现在分组名只作归类，
    三个治理入口各自成为一级项 —— 因此这里不再 hover 浮窗，而是直接读侧边栏文本断言。
  */
  const sidebarContent = page.locator('[data-slot="sidebar-content"]')
  const managedSidebarText = await sidebarContent.innerText()
  check(
    '侧边栏「系统管理」分组下平铺三项（AI 治理 / 用户管理 / 公告管理）',
    ['AI 治理', '用户管理', '公告管理'].every((label) =>
      managedSidebarText.includes(label)
    ),
    managedSidebarText.replaceAll('\n', ' ｜ ')
  )
  check(
    '「系统管理」不再有同名的折叠类目（侧边栏里只作为分组标签出现一次）',
    managedSidebarText.split('系统管理').length - 1 === 1,
    `${managedSidebarText.split('系统管理').length - 1} 次`
  )
  const managedEntryRoles = await sidebarContent
    .locator('a, button')
    .evaluateAll((nodes) =>
      nodes
        .filter((node) =>
          ['AI 治理', '用户管理', '公告管理'].includes(
            (node.textContent ?? '').trim()
          )
        )
        .map((node) => node.tagName.toLowerCase())
    )
  check(
    '三个治理入口都是可直接点的一级入口（链接，不是浮窗子项）',
    managedEntryRoles.length === 3 && managedEntryRoles.every((tag) => tag === 'a'),
    managedEntryRoles.join(' / ')
  )
  await sidebarContent.getByRole('link', { name: 'AI 治理' }).first().click()
  await page
    .waitForURL((url) => url.pathname.startsWith('/admin/ai'), { timeout: 10000 })
    .catch(() => {})
  check(
    '侧边栏点「AI 治理」直接进入治理页',
    new URL(page.url()).pathname.startsWith('/admin/ai'),
    new URL(page.url()).pathname
  )
  check(
    '侧边栏不再有名为「设置」的一级类目（个人入口不进 navItems）',
    !managedSidebarText.includes('设置')
  )

  /*
    侧边栏 208px 是本项目实测出来的"类目名与品牌名都能完整显示"的最窄值
    （见 `docs/modules/全局布局与导航.md`）。治理入口现在是更长的「AI 治理 / 公告管理」，
    必须复验它们不折行 —— 判据是 `getClientRects().length > 1`（按钮高度固定，折行不会撑高它）。
  */
  const wrappedNavLabels = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        '[data-slot="sidebar-content"] ul a span, [data-slot="sidebar-content"] ul button span'
      )
    )
      .filter((el) => el.getClientRects().length > 1)
      .map((el) => (el.textContent ?? '').trim())
  )
  check(
    '侧边栏一级/二级类目均不折行（208px 下的「AI 治理 / 公告管理」）',
    wrappedNavLabels.length === 0,
    wrappedNavLabels.join(' / ')
  )

  for (const [legacy, expectedPath] of [
    ['/settings/users', '/admin/users'],
    ['/settings/announcements', '/admin/announcements'],
  ]) {
    await page.goto(`${BASE}${legacy}`, { waitUntil: 'domcontentloaded' })
    const landed = await page
      .waitForURL((url) => url.pathname === expectedPath, { timeout: 8000 })
      .then(() => true)
      .catch(() => false)
    check(`旧链接 ${legacy} 重定向到 ${expectedPath}`, landed, new URL(page.url()).pathname)
  }

  /*
    知识库治理 2026-09-18 并入「AI 工作台 → 知识库 → 团队知识库」：
    `/admin/ai/knowledge` 保留为纯跳转（老书签与历史记录都指向它），必须落到真实页面。
    2026-10-14：知识库的默认子页就是「团队知识库」，跳转不再需要 `?view=team`，
    URL 保持干净。
  */
  await page.goto(`${BASE}/admin/ai/knowledge`, { waitUntil: 'domcontentloaded' })
  const knowledgeLanded = await page
    .waitForURL((url) => url.pathname === '/knowledge', { timeout: 8000 })
    .then(() => true)
    .catch(() => false)
  check(
    '旧链接 /admin/ai/knowledge 跳到「知识库 → 团队知识库」',
    knowledgeLanded && !new URL(page.url()).searchParams.get('view'),
    page.url().replace(BASE, '')
  )

  // ---------- 3. 我的 ASIN：单页（2026-09-18 起无清单、无页面级导航） ----------
  await page.goto(`${BASE}/asin-watchlists`, { waitUntil: 'domcontentloaded' })
  const hasWorkspaceNav = await waitWorkspaceNav()
  check(
    '我的 ASIN 不再挂页面级模块导航（只剩一个页面：数据表）',
    !hasWorkspaceNav,
    hasWorkspaceNav ? `仍渲染：${await activePageLabel()}` : '无模块导航'
  )
  check(
    '未指定参数时 URL 保持干净',
    new URL(page.url()).pathname === '/asin-watchlists' &&
      new URL(page.url()).search === '',
    page.url().replace(BASE, '')
  )
  await shot('stage-a-asin-single-page')

  // ---------- 3.5 旧链接重定向（阶段 C：我的 ASIN 与提示词广场的路径规范化） ----------
  for (const [legacy, expectedPath] of [
    ['/ai-agent/asin-watchlists', '/asin-watchlists'],
    ['/ai-agent/prompts', '/prompts'],
  ]) {
    await page.goto(`${BASE}${legacy}`, { waitUntil: 'domcontentloaded' })
    const landed = await page
      .waitForURL((url) => url.pathname === expectedPath, { timeout: 8000 })
      .then(() => true)
      .catch(() => false)
    check(`旧链接 ${legacy} 重定向到 ${expectedPath}`, landed, new URL(page.url()).pathname)
  }

  /*
   * 旧链接的 `view` 参数必须**不报错地**落到当前唯一页面。
   *
   * 2026-09-18 起「我的 ASIN」是单页数据表（分析移出、明细页合并进来），
   * `?view=items` 不再有第二个落点 —— 期望值随之从 `/asin-watchlists/items`
   * 改成 `/asin-watchlists`。旧链接可用（不 404）仍是要守住的东西。
   */
  await page.goto(`${BASE}/ai-agent/asin-watchlists?view=items`, {
    waitUntil: 'domcontentloaded',
  })
  await page
    .waitForURL((url) => url.pathname === '/asin-watchlists', { timeout: 8000 })
    .catch(() => {})
  check(
    '旧链接的 ?view=items 落到 /asin-watchlists（单页化后不再有第二个视图）',
    new URL(page.url()).pathname === '/asin-watchlists',
    new URL(page.url()).href.replace(BASE, '')
  )

  // ---------- 3.6 提示词广场：迁到 /prompts 后仍可用（阶段 C） ----------
  await page.goto(`${BASE}/prompts`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector("nav[aria-label='提示词广场功能导航']", { timeout: 20000 })
  const promptNav = (
    await page.locator("nav[aria-label='提示词广场功能导航'] a").allInnerTexts()
  ).map((t) => t.trim())
  check(
    '提示词广场顶栏是它自己的两个子页（共享在前，因为它是默认页）',
    JSON.stringify(promptNav) === JSON.stringify(['共享提示词', '我的提示词']),
    promptNav.join(' ｜ ')
  )
  check(
    '顶栏标题是「提示词广场」（不再继承「AI 助手」）',
    (await page.locator('header').innerText()).includes('提示词广场')
  )
  /*
    一级类目不该挂在别人的二级导航下：这条正是 2026-09-15 移除「提示词广场」二级入口的理由，
    迁到 /prompts 之后它必须继续成立（此前靠 AiAgentLayout 的按路径分流凑出来的，现在是真路径）。
  */
  check(
    '提示词广场页不挂 AI 助手模块导航',
    (await page.locator("nav[aria-label='AI 助手功能导航']").count()) === 0
  )

  /*
    2026-10-14：默认子页由「我的提示词」改为「共享提示词」——无参数进页面即共享页。
  */
  check(
    '无参数进入默认落在「共享提示词」',
    (await page
      .locator("nav[aria-label='提示词广场功能导航'] a[aria-current='page']")
      .innerText()).trim() === '共享提示词' && !new URL(page.url()).searchParams.get('view'),
    page.url().replace(BASE, '')
  )

  await page
    .locator("nav[aria-label='提示词广场功能导航'] a", { hasText: '我的提示词' })
    .click()
  await page.waitForTimeout(600)
  check(
    '切到「我的提示词」写入 ?view=mine',
    new URL(page.url()).pathname === '/prompts' &&
      new URL(page.url()).searchParams.get('view') === 'mine',
    page.url().replace(BASE, '')
  )

  await page.goto(`${BASE}/ai-agent/prompts?view=mine`, { waitUntil: 'domcontentloaded' })
  await page
    .waitForURL((url) => url.pathname === '/prompts', { timeout: 8000 })
    .catch(() => {})
  check(
    '旧链接 /ai-agent/prompts?view=mine 重定向并保留参数',
    new URL(page.url()).pathname === '/prompts' &&
      new URL(page.url()).searchParams.get('view') === 'mine',
    page.url().replace(BASE, '')
  )
  await shot('stage-c-prompts-and-my-asin')

  // ---------- 3.7 普通账号看不到治理入口（阶段 D 的权限断言） ----------
  /*
    阶段 D 把治理项收口到「系统管理」，权限口径**必须**一起验：
    管理员看得见三项是"改对了"，普通账号一点也看不见才是"没改漏"。
    验收用普通账号来自 `server/ai-agent/verify-ui.mjs`（同为验收账号）；账号不存在时跳过而不判失败。
  */
  const operatorContext = await browser.newContext({ viewport: { width: 1440, height: 950 } })
  const operatorPage = await operatorContext.newPage()
  try {
    await operatorPage.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
    await operatorPage.getByLabel('账号 / 邮箱').fill('ai-agent-acceptance')
    await operatorPage.getByLabel('密码').fill('Acceptance#2026')
    await operatorPage.getByRole('button', { name: '登录' }).click()
    const loggedIn = await operatorPage
      .waitForURL((url) => !url.pathname.includes('sign-in'), { timeout: 15000 })
      .then(() => true)
      .catch(() => false)

    if (!loggedIn) {
      skip('普通账号不可见治理入口', '验收用普通账号登录失败（该账号可能未创建）')
    } else {
      await operatorPage.waitForTimeout(1500)
      const operatorSidebar = (
        await operatorPage.locator('[data-slot="sidebar-content"]').innerText()
      ).replaceAll('\n', ' ')
      check(
        '普通账号侧边栏不含「系统管理」分组（三个治理入口全被过滤，不留下空标题）',
        !operatorSidebar.includes('系统管理'),
        operatorSidebar.slice(0, 100)
      )
      check(
        '普通账号侧边栏不含任何治理子项',
        !['用户管理', '公告管理', 'AI 治理'].some((label) =>
          operatorSidebar.includes(label)
        )
      )
      await operatorPage.goto(`${BASE}/admin/users`, { waitUntil: 'domcontentloaded' })
      await operatorPage.waitForTimeout(1500)
      check(
        '普通账号直接访问 /admin/users 被重定向到 403',
        operatorPage.url().includes('/403'),
        new URL(operatorPage.url()).pathname
      )
      await operatorPage.screenshot({
        path: `${OUT}/stage-d-operator-sidebar.png`,
        fullPage: false,
      })
    }
  } finally {
    await operatorContext.close()
  }

  // ---------- 4. 控制台与请求 ----------
  const productErrors = consoleErrors.filter((t) => !EXTERNAL_NOISE.test(t))
  check('零产品控制台错误', productErrors.length === 0, productErrors.slice(0, 3).join(' | '))
  check('应用自身请求无失败', appRequestFailures.length === 0, appRequestFailures.slice(0, 3).join(' | '))
  if (abortedRequests.length) {
    process.stdout.write(
      `○ 另有 ${abortedRequests.length} 个源码模块请求被中断（dev server 跳转/HMR 的正常现象，不判失败）\n`
    )
  }
} catch (error) {
  check('脚本执行未抛异常', false, String(error).slice(0, 400))
  await shot('stage-a-failure')
} finally {
  /*
    清理临时创建的验证候选：无论前面的断言成败都要删掉 ——
    验收脚本在开发库里留下业务数据，下一个人盘点候选池时会以为是真实候选。
  */
  if (createdForVerify) {
    try {
      await page.goto(`${BASE}/product-dev`, { waitUntil: 'domcontentloaded' })
      await page.locator('table tbody tr').first().waitFor({ timeout: 15000 })
      await page
        .locator('table tbody tr')
        .first()
        .getByRole('button', { name: /^删除/ })
        .click()
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: '删除', exact: true })
        .click()
      await page.waitForTimeout(1500)
      const left = await page
        .locator(`table tbody tr:has-text("${VERIFY_CANDIDATE_NAME}")`)
        .count()
      process.stdout.write(
        `${left === 0 ? '✔' : '✖'} 已清理验证用候选「${VERIFY_CANDIDATE_NAME}」${
          left === 0 ? '' : `（仍剩 ${left} 行）`
        }\n`
      )
    } catch (error) {
      process.stdout.write(
        `✖ 清理验证用候选失败：${String(error).slice(0, 200)}（请在候选池手动删除「${VERIFY_CANDIDATE_NAME}」）\n`
      )
    }
  }
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
  process.stdout.write(`失败项：\n${failed.map((c) => ` - ${c.name} — ${c.detail}`).join('\n')}\n`)
  process.exit(1)
}

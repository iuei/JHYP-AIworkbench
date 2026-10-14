/**
 * 「竞品分析 → 市场调研」分页联动验证（真实 Chrome + 真实库 + 真实卖家精灵 MCP）。
 *
 * 用法：
 *   pnpm run dev:all                                        # 终端 A（API 8787 + Vite 5173）
 *   node server/verify-market-research-ui.mjs http://localhost:5173
 *
 * 验的是分页之后**两个页面各自职责清楚、且能互相跳转**：
 *   1. 竞品分析里不再有「类目市场」勾选项（它已迁到产品开发模块）；
 *   2. 竞品分析结果里给出"去市场调研查看「该类目」"的跳转；
 *   3. 跳过去落在「市场调研」页签，并自动带关键词搜出候选类目；
 *   4. 选中类目后产出市场块与市场判断结论。
 *
 * 额度：类目搜索与市场结构都走 24h 缓存，重复运行不消耗调用次数。
 */
import dotenv from 'dotenv'
import { chromium } from 'playwright'

dotenv.config()

const BASE = process.argv[2] ?? 'http://localhost:5173'
const LOGIN = process.env.INITIAL_ADMIN_LOGIN
const PASSWORD = process.env.INITIAL_ADMIN_PASSWORD
const OUT = process.env.AI_VERIFY_OUT ?? 'verify-artifacts'
/** 真实 ASIN（卖家精灵有收录），用于让竞品分析产出品类关键词。 */
const ASINS = 'B07BGLT25K, B0BB3JGBH5'

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  process.stdout.write(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}\n`)
}

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1680, height: 1100 } })
await context.route(/fonts\.(gstatic|googleapis)\.com/, (route) => route.abort())
const page = await context.newPage()

const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
})
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`))
const EXTERNAL_NOISE = /^Failed to load resource: net::ERR_(CONNECTION_CLOSED|ABORTED|FAILED)$/

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
}

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('账号 / 邮箱').fill(LOGIN)
  await page.getByLabel('密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL((url) => !url.pathname.includes('sign-in'), { timeout: 20000 })

  // ── 1. 竞品分析：不再有「类目市场」维度 ──
  await page.goto(`${BASE}/competitor-analysis`, { waitUntil: 'domcontentloaded' })
  await page.locator('#competitor-asin').waitFor({ timeout: 20000 })
  // 只断言"勾选项"里没有它 —— 页面文案里提到"类目市场已迁走"是正常的
  check(
    '竞品分析页不再提供「类目市场」勾选项',
    (await page.getByRole('checkbox', { name: /类目市场/ }).count()) === 0
  )

  await page.locator('#competitor-asin').fill(ASINS)
  await page.getByRole('button', { name: '开始分析' }).click()
  const link = page.getByRole('link', { name: /去市场调研查看/ }).first()
  const hasLink = await link.waitFor({ timeout: 120000 }).then(() => true).catch(() => false)
  check('竞品分析结果给出「去市场调研」跳转', hasLink)

  // ── 2. 跳转过去：落在「市场调研」子页（独立路由），并自动带关键词搜索 ──
  if (hasLink) {
    await link.click()
    await page.waitForURL((url) => url.pathname.includes('/product-dev/market'), {
      timeout: 20000,
    })
    check(
      '跳转到产品开发的「市场调研」子页',
      new URL(page.url()).pathname.endsWith('/product-dev/market'),
      page.url()
    )

    // 2026-09-16 阶段 B：市场调研由「页内页签」改为独立路由，位置改由顶栏导航表达
    const marketNav = page.locator("nav[aria-label='产品开发功能导航'] a", {
      hasText: '市场调研',
    })
    check(
      '顶栏导航高亮为市场调研',
      (await marketNav.getAttribute('aria-current')) === 'page'
    )

    const keywordInput = page.locator('#market-keyword')
    const keyword = (await keywordInput.inputValue()).trim()
    check('带过去的类目关键词已填入', keyword.length > 0, keyword)

    // 自动搜索应当已产出候选类目
    const firstCategory = page.getByRole('button', { name: /在售/ }).first()
    const listed = await firstCategory.waitFor({ timeout: 120000 }).then(() => true).catch(() => false)
    check('进入后自动搜出候选类目', listed)
    await shot('market-research-categories')

    // ── 3. 选中类目 → 市场分析结果 ──
    if (listed) {
      await firstCategory.click()
      const headline = page.getByText(/月销量约|卖家精灵没有返回/).first()
      const analyzed = await headline.waitFor({ timeout: 120000 }).then(() => true).catch(() => false)
      check('选中类目后产出市场结论', analyzed, analyzed ? (await headline.innerText()).slice(0, 80) : '')

      check('出现「类目市场概览」块', (await page.getByText(/类目市场概览/).count()) > 0)
      check('出现「价格带分布」表', (await page.getByText('价格带分布（卖家精灵）').count()) > 0)
      check('出现「市场判断」结论面板', (await page.getByRole('heading', { name: '市场判断' }).count()) > 0 || (await page.getByText('市场判断').count()) > 0)
      const consumption = page.getByText(/本次调用\s*\d+\s*次/).first()
      check('显示本次调用与缓存命中', (await consumption.count()) > 0, (await consumption.innerText().catch(() => '')).replace(/\s+/g, ' '))
      await shot('market-research-result')
    }
  }

  const realErrors = consoleErrors.filter((text) => !EXTERNAL_NOISE.test(text))
  check('页面无控制台错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))

  const failed = checks.filter((item) => !item.ok)
  process.stdout.write(`\n合计 ${checks.length - failed.length}/${checks.length} 通过\n`)
  process.exitCode = failed.length === 0 ? 0 : 1
} catch (error) {
  process.stdout.write(`\n✖ 验证中断：${error?.message ?? error}\n`)
  await shot('market-research-error')
  process.exitCode = 1
} finally {
  await context.close()
  await browser.close()
}

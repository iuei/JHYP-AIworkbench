/**
 * 竞品分析「公开数据」的端到端验证（真实 Chrome + 真实库 + 真实卖家精灵 MCP）。
 *
 * 用法：
 *   pnpm run dev:all                                   # 终端 A（API 8787 + Vite 5173）
 *   node server/verify-competitor-public.mjs http://localhost:5173
 *
 * 验证的是**这条链路真的能跑通**：勾选维度 → 服务端采集 → 页面出现公开数据块与分组结论。
 * 用的是固定的真实 ASIN（类目 TOP 商品），首次运行会消耗卖家精灵调用次数，
 * 之后 24 小时内走缓存（脚本会在结果里核对 `实际调用` 与 `缓存命中` 两个数字）。
 *
 * 只读 + 新增一条分析记录（这是产品本身的正常行为），不修改任何其它数据。
 */
import dotenv from 'dotenv'
import { chromium } from 'playwright'

dotenv.config()

const BASE = process.argv[2] ?? 'http://localhost:5173'
const LOGIN = process.env.INITIAL_ADMIN_LOGIN
const PASSWORD = process.env.INITIAL_ADMIN_PASSWORD
const OUT = process.env.AI_VERIFY_OUT ?? 'verify-artifacts'

/** 真实 ASIN：第一个是类目 TOP 商品（卖家精灵有完整数据），第二个作为竞品对比。 */
const ASINS = 'B07BGLT25K, B0BB3JGBH5'

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  process.stdout.write(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}\n`)
}

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1680, height: 1100 } })
// 拦掉外部字体 CDN：Playwright 截图会等 document.fonts.ready，受限网络下会一直挂着
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

  await page.goto(`${BASE}/competitor-analysis`, { waitUntil: 'domcontentloaded' })
  await page.locator('#competitor-asin').waitFor({ timeout: 20000 })
  check('竞品分析页渲染出分析表单', true)

  // 维度勾选：默认应只勾「商品公开数据」
  const publicBox = page.getByRole('checkbox').first()
  check('默认勾选「商品公开数据」维度', (await publicBox.getAttribute('aria-checked')) === 'true')
  // 文案由"本组合…预估约 N 次调用"改为"本品 N 次 ＝ 预估 N 次调用"（沿用"预估 + N 次调用"的判据）
  const estimate = await page.getByText(/预估/).first().innerText()
  check('界面显示预估调用次数', /\d+\s*次调用/.test(estimate), estimate.replace(/\s+/g, ' '))

  await page.locator('#competitor-asin').fill(ASINS)
  await page.getByRole('button', { name: '开始分析' }).click()

  /*
   * 分析成功会**自动进入「分析结果」页**（2026-09-16 起分析页只留参数与历史，不承载结果），
   * 所以消耗与结论断言都在结果页做 —— 先等跳转，再等结果渲染。
   */
  await page.waitForURL(/\/competitor-analysis\/results(\?|$)/, { timeout: 120000 })
  await page.getByText('结论与建议', { exact: true }).first().waitFor({ timeout: 60000 })
  check('自动进入「分析结果」页', true, page.url().replace(BASE, ''))

  // 结果卡：公开数据的实际调用与缓存命中
  const publicLine = page.getByText(/公开数据调用/).first()
  const ok = await publicLine
    .waitFor({ timeout: 30000 })
    .then(() => true)
    .catch(() => false)
  const lineText = ok ? (await publicLine.innerText()).replace(/\s+/g, ' ') : '(未出现)'
  check('结果页显示公开数据实际调用与缓存命中', ok, lineText)

  const calls = Number((lineText.match(/调用\s*(\d+)\s*次/) ?? [])[1] ?? -1)
  const hits = Number((lineText.match(/缓存命中\s*(\d+)\s*次/) ?? [])[1] ?? -1)
  check('消耗计数可用（调用数 + 缓存命中数）', calls >= 0 && hits >= 0, `调用 ${calls} 次 / 缓存 ${hits} 次`)

  // 结论分组：自家经营数据 / 卖家精灵公开数据
  check('结论面板出现「自家经营数据」分组', (await page.getByText('自家经营数据').count()) > 0)

  await shot('competitor-public-result')

  const analysisId = Number((page.url().match(/analysisId=(\d+)/) ?? [])[1] ?? 0)
  check('结果页 URL 带上了新分析记录 id', analysisId > 0, `#${analysisId}`)

  // 公开数据的块：商品卡片（每个 ASIN 一张，带主图）+ 月销量趋势图
  // 2026-09-16 起卡片**只在结果页**（分析页只放参数与历史）
  const layoutGroup = page.locator('[aria-label="展示方式"]')
  await layoutGroup.getByRole('button', { name: '卡片' }).click()
  const cardCount = await page.locator('[data-product-card]').count()
  check('结果页出现商品卡片（每个 ASIN 一张）', cardCount >= 2, `${cardCount} 张`)
  const cardImages = await page.locator('[data-product-card] img').count()
  check('卡片包含商品主图', cardImages > 0, `${cardImages} 张主图`)

  // 表格是可切换的第二种读法（「内容优先用数据表格」的口径仍然成立）
  await layoutGroup.getByRole('button', { name: '表格' }).click()
  const publicTable = page.getByText('商品公开数据对比（卖家精灵）').first()
  check('切到表格视图仍有「商品公开数据对比」表', (await publicTable.count()) > 0)
  await layoutGroup.getByRole('button', { name: '卡片' }).click()

  const trendChart = page.getByText(/月销量趋势对比/).first()
  check('结果页出现「月销量趋势对比」图', (await trendChart.count()) > 0)

  // 口径声明：公开数据块必须标注来源
  const scopeNote = page.getByText(/卖家精灵第三方公开数据/).first()
  check('公开数据块带有口径声明', (await scopeNote.count()) > 0)

  /*
   * 「数据口径与未接入维度」卡**已删除**（用户口径 2026-09-17，两次确认）。
   * 断言为**守护删除**；「公开数据块必须标注来源」仍由上一项断言守着（块的 `note` 不受影响）。
   */
  check(
    '结果页不再渲染「数据口径与未接入维度」卡（用户口径删除）',
    (await page.getByText('数据口径与未接入维度').count()) === 0 &&
      (await page.getByText('仍未接入').count()) === 0
  )

  // 页面不应再把已接入的维度列为"未接入"
  const staleNote = page.getByText('评论痛点：需要评论数据')
  check('「未接入维度」不再包含已接入的评论/定价项', (await staleNote.count()) === 0)

  const realErrors = consoleErrors.filter((text) => !EXTERNAL_NOISE.test(text))
  check('页面无控制台错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))

  const failed = checks.filter((item) => !item.ok)
  process.stdout.write(`\n合计 ${checks.length - failed.length}/${checks.length} 通过\n`)
  process.exitCode = failed.length === 0 ? 0 : 1
} catch (error) {
  process.stdout.write(`\n✖ 验证中断：${error?.message ?? error}\n`)
  await shot('competitor-public-error')
  process.exitCode = 1
} finally {
  await context.close()
  await browser.close()
}

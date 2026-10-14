/**
 * 「分析页只留参数与历史 / 分析结果页承载全部结果」的端到端验证
 * （真实 Chrome + 真实库；第 2 步会跑一次分析用于取素材，其余只读）。
 *
 * 用法：
 *   pnpm run dev:all                                            # 终端 A（API 8787 + Vite 5173）
 *   node server/verify-competitor-results.mjs http://localhost:5173
 *
 * 守住的信息架构（用户口径 2026-09-16：「数据明细应该修改为分析结果，分析页面的分析结果卡片移动到
 * 新名称为分析结果页面内，分析结果页面内包含数据明细。**分析页面只保留需要分析数据的填充设置和历史分析，
 * 其他内容都放入到分析结果内**」）：
 * - 分析页 = 参数设置 + 历史分析（**没有**结论、没有数据块、没有商品卡片）；
 * - 分析结果页 = 结果头卡（判定 + 头条 + 口径）+ **结论与建议** + 全部数据块
 *   （**不含**「数据口径与未接入维度」卡 —— 该卡 2026-09-17 按用户口径删除，见第 3 段的守护断言）；
 * - 分析成功后自动落到结果页；历史「回看」也进结果页；旧路径 `details` 重定向到新路径。
 */
import dotenv from 'dotenv'
import { chromium } from 'playwright'

dotenv.config()

const BASE = process.argv[2] ?? 'http://localhost:5173'
const LOGIN = process.env.INITIAL_ADMIN_LOGIN
const PASSWORD = process.env.INITIAL_ADMIN_PASSWORD
const OUT = process.env.AI_VERIFY_OUT ?? 'verify-artifacts'

/** 分析页高度上限（px）：只放参数与历史之后应远小于从前那张长页。 */
const MAX_HOME_HEIGHT = 2400

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  process.stdout.write(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}\n`)
}

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({
  viewport: { width: 1680, height: 1080 },
})
await context.route(/fonts\.(gstatic|googleapis)\.com/, (route) => route.abort())
const page = await context.newPage()

const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
})
page.on('pageerror', (error) =>
  consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`)
)
let analysisPosts = 0
page.on('request', (request) => {
  if (
    request.method() === 'POST' &&
    request.url().includes('/api/competitor-analyses')
  ) {
    analysisPosts += 1
  }
})

const EXTERNAL_NOISE =
  /^Failed to load resource: net::ERR_(CONNECTION_CLOSED|ABORTED|FAILED)$/

async function seeText(text, timeout = 10000) {
  return page
    .getByText(text)
    .first()
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false)
}

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('账号 / 邮箱').fill(LOGIN)
  await page.getByLabel('密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL((url) => !url.pathname.includes('sign-in'), {
    timeout: 20000,
  })

  // ---------- 1. 分析页：只有"参数 + 历史" ----------
  await page.goto(`${BASE}/competitor-analysis`, { waitUntil: 'domcontentloaded' })
  await page.locator('#competitor-asin').waitFor({ timeout: 20000 })
  check('无结果时表单默认展开（可直接输入 ASIN）', true)

  const homeText = await page.locator('main').innerText()
  check(
    '分析页不再出现结论与建议（已移入分析结果页）',
    !homeText.includes('结论与建议')
  )
  /*
   * 用**表格数量**判断而不是关键词：表单里的维度说明本来就写着"月销量趋势对比"这类词，
   * 按文案判会误伤（实测踩到）。分析页只该有历史分析这一张表。
   */
  check(
    '分析页只有历史分析这一张表（数据块都在结果页）',
    (await page.locator('table').count()) === 1,
    `${await page.locator('table').count()} 张表`
  )
  check(
    '分析页不出现口径声明与库存表',
    !homeText.includes('数据口径与未接入维度') &&
      !homeText.includes('关联库存（本品 SKU）')
  )
  check(
    '分析页没有商品卡片（卡片属于结果）',
    (await page.locator('[data-product-card]').count()) === 0
  )

  // ---------- 2. 跑一次分析 → 自动落到「分析结果」 ----------
  // 素材：两个在自家报表里有日数据的演示 ASIN（公开数据 24h 内已拉过 → 走缓存不计费）
  await page.locator('#competitor-asin').fill('B0SAMPLE01, B0SAMPLE02')
  await page.getByRole('button', { name: '开始分析' }).click()
  await page.waitForURL(/\/competitor-analysis\/results(\?|$)/, { timeout: 90000 })
  const resultUrl = page.url()
  check('分析成功后自动进入「分析结果」页', true, resultUrl.replace(BASE, ''))
  const analysisId = Number((resultUrl.match(/analysisId=(\d+)/) ?? [])[1] ?? 0)
  check('结果页 URL 带上了分析记录 id', analysisId > 0, `#${analysisId}`)

  // ---------- 3. 结果页：结果卡 + 结论 + 明细 + 口径 ----------
  await seeText('结论与建议', 20000)
  const resultText = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
  check('结果页有结果头卡（区间 / 判定 / 一句话结论）', /统计区间/.test(resultText))
  check('结果页包含结论与建议', resultText.includes('结论与建议'))
  // 「按日对比」是服务端新块（需重启后的 API 才产出），老快照里没有 —— 不作硬性要求
  check(
    '结果页包含数据明细（ASIN 横向对比，按日对比随新分析产出）',
    resultText.includes('ASIN 横向对比'),
    resultText.includes('按日对比') ? '含「按日对比」' : '本记录无「按日对比」（旧 API / 老快照）'
  )
  /*
   * 底部的「数据口径与未接入维度」卡**已删除**（用户口径 2026-09-17，两次确认：
   * 「数据口径与未接入维度确实需要删除。我要你优化最上方的几张卡片 分析结果页面的顶部结论与建议」）。
   * 断言为**守护删除**：该卡与它的"未接入维度"清单都不许回到结果页上。
   */
  check(
    '结果页不再渲染「数据口径与未接入维度」卡（用户口径删除）',
    !resultText.includes('数据口径与未接入维度') &&
      !resultText.includes('仍未接入')
  )
  check(
    '结果页包含商品卡片（可切表格）',
    (await page.locator('[data-product-card]').count()) > 0 &&
      (await page.locator('[aria-label="展示方式"]').count()) === 1
  )
  check(
    '结果页给出返回分析的出口',
    (await page.getByRole('link', { name: /返回竞品分析/ }).count()) > 0
  )

  // 顶栏子导航：分析 ｜ 分析结果（与侧边栏同源派生）
  const subNav = page.locator('nav[aria-label="竞品分析功能导航"]')
  const subNavItems = (await subNav.locator('a').allInnerTexts()).map((text) =>
    text.replace(/\s+/g, '')
  )
  check(
    '顶栏子导航是「分析 / 分析结果」',
    subNavItems.join('|') === '分析|分析结果',
    subNavItems.join(' | ')
  )
  check(
    '当前页在子导航里高亮为「分析结果」（且只有它）',
    (await subNav
      .locator(
        '[data-nav-item="/competitor-analysis/results"][data-active="true"]'
      )
      .count()) === 1 &&
      (await subNav
        .locator('[data-nav-item="/competitor-analysis"][data-active="true"]')
        .count()) === 0
  )

  const postsBefore = analysisPosts
  await page.screenshot({ path: `${OUT}/competitor-results.png` })

  // ---------- 4. 返回分析页：只剩参数与历史 ----------
  await page.getByRole('link', { name: /返回竞品分析/ }).click()
  await page.waitForURL(/\/competitor-analysis(\?|$)/, { timeout: 20000 })
  await page
    .locator('[data-form-expand], #competitor-asin')
    .first()
    .waitFor({ timeout: 20000 })
  /*
   * 返回分析页后表单是**完整的**（不是摘要条）：本页不再承载结果，也就没有"有结果时收起"的需要。
   * 分析成功后已跳到结果页、组件卸载，`result` 状态不会保留 —— 摘要条与"本次分析已完成"卡
   * 永远不会显示，因此已从实现里删除（这里守住"删干净了"）。
   */
  check(
    '返回分析页后是完整表单（可直接改参数跑下一次）',
    (await page.locator('#competitor-asin').count()) === 1 &&
      (await page.locator('[data-form-expand]').count()) === 0
  )
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  check(
    '分析页高度已收敛（只放参数与历史）',
    height <= MAX_HOME_HEIGHT,
    `${height}px（上限 ${MAX_HOME_HEIGHT}px）`
  )
  await page.locator('[data-history-row]').first().waitFor({ timeout: 20000 })
  check(
    '分析页保留历史分析表',
    (await page.locator('[data-history-row]').count()) > 0
  )

  // ---------- 5. 历史「回看」→ 结果页 ----------
  const firstHistory = page.locator('button[data-history-item]').first()
  await firstHistory.click()
  await page.waitForURL(/\/competitor-analysis\/results(\?|$)/, { timeout: 20000 })
  check(
    '历史「回看」进入分析结果页并带上记录 id',
    page.url().includes('analysisId='),
    page.url().replace(BASE, '')
  )

  // ---------- 6. 旧路径重定向 + 异常输入不白屏 ----------
  const errorsBeforeNegative = consoleErrors.length
  await page.goto(
    `${BASE}/competitor-analysis/results?analysisId=${analysisId}`,
    { waitUntil: 'domcontentloaded' }
  )
  await page.waitForURL(/\/competitor-analysis\/results(\?|$)/, { timeout: 20000 })
  check(
    '旧路径 details 重定向到 results（收藏的旧链接仍可用）',
    page.url().includes(`analysisId=${analysisId}`),
    page.url().replace(BASE, '')
  )

  await page.goto(`${BASE}/competitor-analysis/results`, {
    waitUntil: 'domcontentloaded',
  })
  check(
    '结果页不带 analysisId 时自动展示最近一次分析',
    await seeText('自动打开最近一次', 20000)
  )

  await page.goto(`${BASE}/competitor-analysis/results?analysisId=999999`, {
    waitUntil: 'domcontentloaded',
  })
  check('记录不存在时给出失败提示', await seeText('打不开这次分析'))

  await page.goto(`${BASE}/competitor-analysis/results?analysisId=abc`, {
    waitUntil: 'domcontentloaded',
  })
  check('脏 analysisId 被忽略后回落最近一次分析', await seeText('自动打开最近一次'))

  check(
    '结果页打开过程不重新发起分析（不消耗卖家精灵额度）',
    analysisPosts === postsBefore,
    `POST 次数 ${analysisPosts - postsBefore}`
  )

  const realErrors = consoleErrors
    .slice(0, errorsBeforeNegative)
    .filter((text) => !EXTERNAL_NOISE.test(text))
  check('页面无控制台错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))

  const failed = checks.filter((item) => !item.ok)
  process.stdout.write(
    `\n合计 ${checks.length - failed.length}/${checks.length} 通过\n`
  )
  process.exitCode = failed.length === 0 ? 0 : 1
} catch (error) {
  process.stdout.write(`\n✖ 验证中断：${error?.message ?? error}\n`)
  await page
    .screenshot({ path: `${OUT}/competitor-results-error.png` })
    .catch(() => {})
  process.exitCode = 1
} finally {
  await context.close()
  await browser.close()
}

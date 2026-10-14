/**
 * 「按日对比（本品 vs 竞品）」的端到端验证（真实 Chrome + 真实库 + 真实 API）。
 *
 * 用法：
 *   API_PORT=8789 node server/index.mjs                        # 终端 A（新代码的 API）
 *   API_PORT=8789 pnpm exec vite --port 5175 --strictPort      # 终端 B（代理到 8789）
 *   node server/verify-competitor-daily.mjs http://localhost:5175
 *
 * 这条链路**必须跑在重启后的 API 上**：`按日对比` 块由服务端在分析时生成，
 * 落进快照后才可能被结果页渲染 —— 旧快照里只有本品的「按日明细」，没有竞品的按日数据。
 *
 * 用固定的真实 ASIN（两个都在自家报表里、且 24h 内已拉过卖家精灵公开数据 → 走缓存不计费）。
 */
import dotenv from 'dotenv'
import { chromium } from 'playwright'

dotenv.config()

const BASE = process.argv[2] ?? 'http://localhost:5175'
const LOGIN = process.env.INITIAL_ADMIN_LOGIN
const PASSWORD = process.env.INITIAL_ADMIN_PASSWORD
const OUT = process.env.AI_VERIFY_OUT ?? 'verify-artifacts'

/**
 * 两个 ASIN 都要**在自家报表里有日数据**，否则对比表会是空的。
 * （实测踩到：换成卖家精灵收录、但自家报表里没有记录的 ASIN，本品那侧整段没有数据，
 * `按日对比` 根本不会产出 —— 素材必须选"报表内有数据"的 ASIN。）
 */
const ASINS = 'B0SAMPLE01, B0SAMPLE02'

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  process.stdout.write(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}\n`)
}

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1680, height: 1080 } })
await context.route(/fonts\.(gstatic|googleapis)\.com/, (route) => route.abort())
const page = await context.newPage()

const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
})
page.on('pageerror', (error) =>
  consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`)
)
const EXTERNAL_NOISE =
  /^Failed to load resource: net::ERR_(CONNECTION_CLOSED|ABORTED|FAILED)$/

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('账号 / 邮箱').fill(LOGIN)
  await page.getByLabel('密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL((url) => !url.pathname.includes('sign-in'), {
    timeout: 20000,
  })

  // ---------- 跑一次新分析（公开数据走缓存，不消耗额度） ----------
  await page.goto(`${BASE}/competitor-analysis`, { waitUntil: 'domcontentloaded' })
  await page.locator('#competitor-asin').waitFor({ timeout: 20000 })
  await page.locator('#competitor-asin').fill(ASINS)
  await page.getByRole('button', { name: '开始分析' }).click()
  // 分析成功会**自动进入「分析结果」页**（2026-09-16 起分析页只留参数与历史，不承载结果）
  await page.waitForURL(/\/competitor-analysis\/results(\?|$)/, { timeout: 90000 })
  check('新分析完成并自动进入「分析结果」页', true)

  // ---------- 结果页：按日对比表 ----------
  await page.getByText('结论与建议', { exact: true }).first().waitFor({ timeout: 20000 })

  // 只做记录，不作断言（等结果页真的渲染完再读，否则会读到跳转过渡期的旧 DOM）
  const pageText = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
  process.stdout.write(
    `  · 本次公开数据消耗：${(pageText.match(/公开数据调用 \d+ 次（缓存命中 \d+ 次[^）]*）/) ?? ['(未找到)'])[0]}\n`
  )

  const dailyTable = page.locator('table').filter({ hasText: '日期' }).filter({
    hasText: '花费',
  })
  const dailyTitle = page.getByText('按日对比（本品 vs 竞品）').first()
  check(
    '结果页出现「按日对比（本品 vs 竞品）」',
    (await dailyTitle.count()) > 0
  )

  /*
   * 表头是**两行**（用户口径 2026-09-16：「表头 本品 竞品，然后再是本品字段和竞品字段」）：
   * 第一行归属分组、第二行各自字段名。上一版把归属塞进每列标签（`花费 本品`）被否掉了。
   */
  const headRows = dailyTable.first().locator('thead tr')
  check('表头是两行', (await headRows.count()) === 2, `${await headRows.count()} 行`)

  const groupCells = (
    await headRows.nth(0).locator('th').allInnerTexts()
  ).map((text) => text.replace(/\s+/g, ''))
  check(
    '第一行是归属分组（本品 / 竞品1，带 ASIN）',
    groupCells.includes('日期') &&
      groupCells.includes('本品（B0SAMPLE01）') &&
      groupCells.includes('竞品1（B0SAMPLE02）'),
    groupCells.join(' | ')
  )

  const fieldCells = (
    await headRows.nth(1).locator('th').allInnerTexts()
  ).map((text) => text.replace(/\s+/g, ''))
  check(
    '第二行是字段名，每个 ASIN 各一组 7 个',
    fieldCells.length === 14 &&
      fieldCells.filter((text) => text === '花费').length === 2 &&
      fieldCells.filter((text) => text === '销售额').length === 2,
    `${fieldCells.length} 个字段列 · ${fieldCells.slice(0, 7).join('/')}`
  )

  /*
   * 整组列的淡色底（用户口径 2026-09-16：「再为对应列填充对应颜色 颜色不要太鲜艳能看出来就行颜色淡一点」）。
   * 这里直接读**计算后的背景色**：类名写了不等于样式生效（Tailwind 不会为拼接出来的类名生成样式）。
   */
  const toneInfo = await dailyTable.first().evaluate((table) => {
    const cells = [...table.querySelectorAll('tbody tr:first-child td')]
    const read = (index) => {
      const element = cells[index]
      if (!element) return null
      return getComputedStyle(element).backgroundColor
    }
    /**
     * 取透明度分量：Chrome 对 Tailwind 的 `color-mix` 会算成 `oklab(L a b / alpha)`，
     * 老写法是 `rgba(r, g, b, alpha)` —— 两种都要认（只认 rgba 会解析成 null，
     * 而 `[].every()` 恒为 true，断言会**假通过**，实测踩到过）。
     */
    const alphaOf = (value) => {
      const text = value ?? ''
      const slash = text.match(/\/\s*([\d.]+)\s*\)/)
      if (slash) return Number(slash[1])
      const rgba = text.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/)
      if (rgba) return Number(rgba[1])
      if (/^rgb\(/.test(text)) return 1
      return null
    }
    return {
      date: read(0),
      subject: read(1),
      competitor: read(8),
      subjectAlpha: alphaOf(read(1)),
      competitorAlpha: alphaOf(read(8)),
    }
  })
  check(
    '本品组与竞品组各铺一层底色，且首列保持中性',
    toneInfo.subject !== toneInfo.competitor &&
      toneInfo.date === 'rgba(0, 0, 0, 0)',
    `日期 ${toneInfo.date} · 本品 ${toneInfo.subject} · 竞品 ${toneInfo.competitor}`
  )
  check(
    '底色足够淡（透明度 ≤ 15%，不抢数字的注意力）',
    typeof toneInfo.subjectAlpha === 'number' &&
      typeof toneInfo.competitorAlpha === 'number' &&
      toneInfo.subjectAlpha > 0 &&
      toneInfo.subjectAlpha <= 0.15 &&
      toneInfo.competitorAlpha > 0 &&
      toneInfo.competitorAlpha <= 0.15,
    `本品 alpha=${toneInfo.subjectAlpha} · 竞品 alpha=${toneInfo.competitorAlpha}`
  )

  const bodyRows = await dailyTable.first().locator('tbody tr').count()
  check('按天一行（区间内每一天一行）', bodyRows >= 20, `${bodyRows} 行`)

  const firstRow = (
    await dailyTable.first().locator('tbody tr').first().innerText()
  )
    .replace(/\s+/g, ' ')
    .trim()
  check(
    '同一行里本品与竞品的值都在（可直接对照）',
    /^\d{4}-\d{2}-\d{2} /.test(firstRow) &&
      firstRow.split(' ').length >= 15,
    firstRow.slice(0, 80)
  )
  check(
    '原来的「按日明细」（只有本品）已被替换，不重复铺同一份数据',
    (await page.getByText('按日明细', { exact: true }).count()) === 0
  )

  // 截到表格本体（表格在结果页下方，截视口顶部等于没截）
  await dailyTitle.scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/competitor-daily-compare.png` })

  const realErrors = consoleErrors.filter((text) => !EXTERNAL_NOISE.test(text))
  check(
    '页面无控制台错误',
    realErrors.length === 0,
    realErrors.slice(0, 3).join(' | ')
  )

  const failed = checks.filter((item) => !item.ok)
  process.stdout.write(
    `\n合计 ${checks.length - failed.length}/${checks.length} 通过\n`
  )
  process.exitCode = failed.length === 0 ? 0 : 1
} catch (error) {
  process.stdout.write(`\n✖ 验证中断：${error?.message ?? error}\n`)
  await page
    .screenshot({ path: `${OUT}/competitor-daily-error.png` })
    .catch(() => {})
  process.exitCode = 1
} finally {
  await context.close()
  await browser.close()
}

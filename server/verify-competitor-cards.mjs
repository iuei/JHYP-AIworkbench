/**
 * 竞品分析「商品卡片 + 竞品详情页」的端到端验证（真实 Chrome + 真实库快照）。
 *
 * 用法：
 *   pnpm run dev:all                                            # 终端 A（API 8787 + Vite 5173）
 *   node server/verify-competitor-cards.mjs http://localhost:5173
 *
 * 验证的是**只读链路**：历史快照 → 卡片（带主图）→ 点卡片进单个竞品详情页。
 * **不发起任何新分析**（因此不消耗卖家精灵额度）：脚本自己在前几条历史记录里
 * 找一条含商品公开数据的快照，找不到就明确报失败（库里没有可用素材）。
 *
 * 其中一条断言专门守住设计要点：详情页打开过程中**不得**出现
 * `POST /api/competitor-analyses`（详情页只读快照，不重新取数）。
 */
import dotenv from 'dotenv'
import { chromium } from 'playwright'

dotenv.config()

const BASE = process.argv[2] ?? 'http://localhost:5173'
const LOGIN = process.env.INITIAL_ADMIN_LOGIN
const PASSWORD = process.env.INITIAL_ADMIN_PASSWORD
const OUT = process.env.AI_VERIFY_OUT ?? 'verify-artifacts'

/** 最多翻几条历史记录找素材（每条都要打开快照，太多会拖慢验证）。 */
const MAX_LOOKBACK = 10

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  process.stdout.write(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}\n`)
}

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({
  viewport: { width: 1680, height: 1100 },
})
// 拦掉外部字体 CDN：Playwright 截图会等 document.fonts.ready，受限网络下会一直挂着
await context.route(/fonts\.(gstatic|googleapis)\.com/, (route) => route.abort())
const page = await context.newPage()

const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
})
page.on('pageerror', (error) =>
  consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`)
)
/** 详情页不得触发新分析：这条计数是"不消耗额度"的硬证据。 */
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

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
}

/** 滚到目标元素再截图：截图是给人看的，落在页面顶部等于没截。 */
async function shotOf(name, locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(300)
  await shot(name)
}

/** 主图是否真的渲染出来了（`src` 有值 ≠ 图片能显示）。 */
async function imageLoaded(locator) {
  return locator
    .first()
    .evaluate((img) => img.complete && img.naturalWidth > 0)
    .catch(() => false)
}

/**
 * 等一段文案出现（最多 8 秒）。
 *
 * 这些异常分支都要等 React 挂载 / 快照请求返回，`goto` 之后直接数元素一定是 0 ——
 * 那样会把"还没渲染完"误判成"提示没出现"。
 */
async function seeText(text) {
  return page
    .getByText(text)
    .first()
    .waitFor({ timeout: 8000 })
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

  await page.goto(`${BASE}/competitor-analysis`, { waitUntil: 'domcontentloaded' })
  // 分析页现在**始终**是完整表单（不再承载结果，也就没有"收起成摘要条"的状态）
  await page.locator('#competitor-asin').waitFor({ timeout: 20000 })

  // ---------- 1. 找一条含商品公开数据的历史快照 ----------
  // 历史列表是**另一个查询**，返回比表单晚：不等它出现就数行数会数到 0（实测踩到）
  await page
    .locator('[data-history-row]')
    .first()
    .waitFor({ timeout: 20000 })
    .catch(() => {})
  const historyIds = await page
    .locator('[data-history-row]')
    .evaluateAll((rows) =>
      rows.map((row) => Number(row.getAttribute('data-history-row')))
    )
  check('历史分析列表渲染出行', historyIds.length > 0, `${historyIds.length} 条`)

  /*
   * 商品卡片**只存在于分析结果页**（2026-09-16：分析页只留参数与历史）。因此素材要在结果页里找。
   */
  await page.goto(`${BASE}/competitor-analysis`, { waitUntil: 'domcontentloaded' })
  await page.locator('#competitor-asin').waitFor({ timeout: 20000 })
  await page.waitForTimeout(800)
  check(
    '主页不再出现商品卡片（只留结论与历史）',
    (await page.locator('[data-product-card]').count()) === 0
  )

  let target = null
  for (const id of historyIds.slice(0, MAX_LOOKBACK)) {
    await page.goto(`${BASE}/competitor-analysis/results?analysisId=${id}`, {
      waitUntil: 'domcontentloaded',
    })
    // 结果页的就绪信号：结果头卡的「统计区间」（卡片可能因未收录而不存在，不能只等卡片）
    await page
      .locator('text=统计区间, [data-product-card]')
      .first()
      .waitFor({ timeout: 20000 })
      .catch(() => {})
    const count = await page.locator('[data-product-card]').count()
    /*
     * 素材必须**带主图**：卖家精灵会漏收录（演示 ASIN `B0SAMPLE01` 之类就查不到），
     * 那种记录的卡片只有"无主图"占位，用它验"卡片包含图片"必然失败（实测踩到）。
     */
    const withImage = await page.locator('[data-product-card] img').count()
    if (count > 0 && withImage > 0) {
      target = { id, count, asins: await readCardAsins(page) }
      break
    }
  }
  check(
    '前几条历史记录里找到含商品主图与公开数据的快照',
    target !== null,
    target
      ? `记录 #${target.id} · ${target.count} 张卡片 · ${target.asins.join('、')}`
      : `前 ${MAX_LOOKBACK} 条都没有"有主图的商品卡片"（无法验证卡片与详情页）`
  )

  if (!target) {
    throw new Error('没有可验证的快照素材：请先跑一次勾选「商品公开数据」的分析')
  }

  // ---------- 2. 卡片本身 ----------
  const cardImages = await page
    .locator('[data-product-card] img')
    .evaluateAll((imgs) =>
      imgs.map((img) => img.getAttribute('src')).filter(Boolean)
    )
  check(
    '卡片包含商品主图',
    cardImages.length > 0,
    `${cardImages.length} 张 · ${cardImages[0]?.slice(0, 60)}`
  )

  // 图床是亚马逊：等它真的解码出来（`src` 有值不等于图片能显示）
  await page
    .locator('[data-product-card] img')
    .first()
    .evaluate((img) => img.decode?.().catch(() => {}))
    .catch(() => {})
  check(
    '卡片主图渲染成功（不是空白占位）',
    await imageLoaded(page.locator('[data-product-card] img')),
    (await page.locator('[data-product-card] img').first().getAttribute('src')) ??
      '(无主图)'
  )

  const cardText = await page.locator('[data-product-card]').first().innerText()
  check(
    '卡片显示角色徽章（本品/竞品）',
    /本品|竞品/.test(cardText),
    cardText.split('\n').slice(0, 3).join(' / ')
  )
  check(
    '卡片显示该 ASIN',
    cardText.includes(target.asins[0]),
    target.asins[0]
  )

  await shotOf('competitor-cards', page.locator('[aria-label="展示方式"]'))

  // ---------- 3. 表格仍可切换（上一轮「内容优先用数据表格」的口径没有丢） ----------
  const layoutGroup = page.locator('[aria-label="展示方式"]')
  await layoutGroup.getByRole('button', { name: '表格' }).click()
  const tableTitle = page.getByText('商品公开数据对比（卖家精灵）').first()
  check(
    '切到表格视图能看到商品公开数据表',
    (await tableTitle.count()) > 0
  )
  await layoutGroup.getByRole('button', { name: '卡片' }).click()
  check(
    '切回卡片视图',
    (await page.locator('[data-product-card]').count()) === target.count
  )

  // ---------- 4. 点卡片进详情页 ----------
  const firstCard = page.locator('[data-product-card]').first()
  const firstAsin = await firstCard.getAttribute('data-product-card')
  const postsBefore = analysisPosts
  await firstCard.click()
  await page.waitForURL(
    new RegExp(`/competitor-analysis/${firstAsin}(\\?|$)`),
    { timeout: 20000 }
  )
  check('点卡片跳转到该竞品的独立页面', true, page.url().replace(BASE, ''))
  check(
    '详情页 URL 带上了分析记录 id',
    page.url().includes(`analysisId=${target.id}`),
    page.url().replace(BASE, '')
  )

  await page.getByText('数据来源与口径').first().waitFor({ timeout: 20000 })
  check(
    '详情页显示商品主图',
    (await page.locator('img[alt*="商品主图"]').count()) > 0
  )
  // 概览卡与主图一起截；再单独截下方明细块，两张图合起来能看清整页
  await page.locator('img[alt*="商品主图"]').first().evaluate((img) =>
    img.decode?.().catch(() => {})
  ).catch(() => {})
  check(
    '详情页主图渲染成功',
    await imageLoaded(page.locator('img[alt*="商品主图"]'))
  )
  const detailText = await page.locator('main').innerText()
  check(
    '详情页显示该 ASIN 与站点',
    detailText.includes(firstAsin),
    firstAsin
  )
  check(
    '详情页给出返回竞品分析的出口',
    (await page.getByRole('link', { name: /返回竞品分析/ }).count()) > 0
  )
  check(
    '详情页展示数据来源与额度口径',
    detailText.includes('缓存命中'),
    '含"实际调用 / 缓存命中"'
  )
  check(
    '详情页没有重新发起分析请求（不消耗卖家精灵额度）',
    analysisPosts === postsBefore,
    `POST 次数 ${analysisPosts - postsBefore}`
  )

  await shot('competitor-asin-detail')

  // ---------- 5. 同一次分析里切换另一个 ASIN ----------
  if (target.asins.length > 1) {
    const otherLink = page
      .locator(`a[href*="/competitor-analysis/"]`)
      .filter({ hasText: target.asins[1] })
      .first()
    const hasOther = (await otherLink.count()) > 0
    check('详情页给出同批其它 ASIN 的入口', hasOther, target.asins[1])
    if (hasOther) {
      await otherLink.click()
      await page.waitForURL(
        new RegExp(`/competitor-analysis/${target.asins[1]}(\\?|$)`),
        { timeout: 20000 }
      )
      check(
        '切换到另一个 ASIN 的详情页正常渲染',
        await seeText('数据来源与口径'),
        target.asins[1]
      )
      check(
        '切换后页面确实换成了那个 ASIN',
        (await page.locator('main').innerText()).includes(target.asins[1]),
        target.asins[1]
      )
    }
  }

  // ---------- 6. 异常输入不白屏 ----------
  // 这一段的断言会**故意**打 404（不存在的记录），浏览器必然记一条控制台错误 ——
  // 它正是被测的错误处理路径，因此控制台检查只看这段之前的错误。
  const errorsBeforeNegativeTests = consoleErrors.length
  /*
   * 2026-09-16：不带 analysisId 时不再只给一句提示，而是**自动回落**到
   * 最近一次包含该 ASIN 的分析（用户口径：「为什么没有直接展示在子页面」）——
   * 收藏夹、手改地址、从别处粘链接进来都应该看到内容。
   */
  await page.goto(`${BASE}/competitor-analysis/${firstAsin}`, {
    waitUntil: 'domcontentloaded',
  })
  check(
    '不带 analysisId 时自动回落到包含该 ASIN 的最近一次分析',
    await seeText('数据来源与口径', 20000)
  )
  check('并标出"自动打开最近一次"', await seeText('自动打开最近一次'))

  await page.goto(`${BASE}/competitor-analysis/${firstAsin}?analysisId=999999`, {
    waitUntil: 'domcontentloaded',
  })
  check(
    '记录不存在时给出失败提示而不是白屏',
    await seeText('打不开这次分析')
  )

  await page.goto(`${BASE}/competitor-analysis/${firstAsin}?analysisId=abc`, {
    waitUntil: 'domcontentloaded',
  })
  check(
    '脏 analysisId 被忽略后回落最近一次包含该 ASIN 的分析',
    await seeText('自动打开最近一次')
  )

  await page.goto(`${BASE}/competitor-analysis/B0NOTEXIST?analysisId=${target.id}`, {
    waitUntil: 'domcontentloaded',
  })
  check(
    'ASIN 不属于这次分析时给出说明',
    await seeText('这个 ASIN 不在这次分析里')
  )

  const realErrors = consoleErrors
    .slice(0, errorsBeforeNegativeTests)
    .filter((text) => !EXTERNAL_NOISE.test(text))
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
  await shot('competitor-cards-error')
  process.exitCode = 1
} finally {
  await context.close()
  await browser.close()
}

/** 当前页面上卡片的 ASIN 列表（按出现顺序）。 */
async function readCardAsins(page) {
  return page
    .locator('[data-product-card]')
    .evaluateAll((cards) =>
      cards.map((card) => card.getAttribute('data-product-card'))
    )
}

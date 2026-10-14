/**
 * 「提示词广场升为一级类目 + AI 优化提示词」UI 验收（系统 Chrome，不需要下载 Playwright Chromium）。
 *
 * 用法（与 verify-ui.mjs 同一套路：独立 Vite 实例指向独立 API 实例）：
 *   API_PORT=8789 SERVE_STATIC=false node server/index.mjs                                   # 终端 A
 *   VITE_API_BASE_URL=http://127.0.0.1:8789/api pnpm exec vite --port 5175 --strictPort      # 终端 B
 *   node server/ai-agent/verify-prompt-optimize-ui.mjs http://localhost:5175                 # 终端 C
 *
 * 断言的是**这条需求本身**：① 侧边栏一级类目里「提示词广场」是**一级项**（不需要展开 AI 助手就能点到）；
 * ② 点开新建弹窗 → 正文框旁有「优化提示词」；③ 点它由真实模型返回结果，且**只展示对比、不动输入框**；
 * ④ 点「采用优化结果」才替换正文。
 *
 * 不落库：全程不点「创建」，结束后回列表确认没有新条目（脚本数据用 `__DSH` 前缀，万一误存也能识别）。
 */
import dotenv from 'dotenv'
import { chromium } from 'playwright'

dotenv.config()

const BASE = process.argv[2] ?? 'http://localhost:5175'
const LOGIN = process.env.INITIAL_ADMIN_LOGIN
const PASSWORD = process.env.INITIAL_ADMIN_PASSWORD
const OUT = process.env.AI_VERIFY_OUT ?? 'verify-artifacts'

const DRAFT = '__DSH 帮我看下这个月 ACoS 为啥涨了，是不是广告的问题，我应该怎么调'
const OPTIMIZED_MARK = '优化结果（尚未采用）'
const APPLIED_MARK = '优化结果（已采用）'

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  process.stdout.write(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}\n`)
}

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } })

/**
 * 拦掉外部字体（fonts.gstatic.com / googleapis）。
 *
 * 两个原因：① 截图会等 `document.fonts.ready`，CDN 在当前网络不可达时这一步**直接挂 30s 超时**
 * （本轮就撞上过："waiting for fonts to load"）；② 这些失败会在控制台刷出无法归因的
 * "Failed to load resource" 噪声。字体回退到系统字体不影响任何断言（断言全是 DOM 与文本）。
 */
await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())

const page = await context.newPage()

const consoleErrors = []
/** 无 URL 的"资源加载失败"按外部噪声处理：被拦掉的字体请求正是这条文案（与 verify-ui.mjs 同口径）。 */
const EXTERNAL_RESOURCE_NOISE =
  /^Failed to load resource: net::ERR_(CONNECTION_CLOSED|ABORTED|FAILED)$/
/** 应用自身来源的请求失败才算问题，按 URL 归因，不靠猜控制台文案。 */
const appRequestFailures = []

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
})
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`))
page.on('requestfailed', (request) => {
  const url = request.url()
  // Vite 依赖预构建重建会让旧 deps URL 上的在途请求 abort，属开发服务器正常行为
  if (!url.startsWith(BASE) || /\/node_modules\/\.vite\/deps\//.test(url)) return
  appRequestFailures.push(`${url} → ${request.failure()?.errorText ?? 'unknown'}`)
})

/** 截图是**证据**不是断言：失败只提示，不把整轮验收变成"未完成"。 */
async function shot(name) {
  try {
    await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 15000 })
  } catch (error) {
    process.stdout.write(
      `ℹ 截图 ${name} 失败（不影响断言）：${String(error).split('\n')[0]}\n`
    )
  }
}

/** 正文框（弹窗内唯一的多行输入）：Label 与 Textarea 通过 id 关联。 */
const bodyBox = () => page.getByLabel('提示词正文')

try {
  // 1. 登录
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('账号 / 邮箱').fill(LOGIN)
  await page.getByLabel('密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL((url) => !url.pathname.includes('sign-in'), { timeout: 15000 })
  check('登录成功并跳转', true, page.url())

  // 2. 侧边栏一级项：不展开「AI 助手」也能直接看到并点到
  const sidebarLink = page.locator(
    '[data-slot="sidebar-content"] a[href="/prompts"]'
  )
  let entryOk = true
  try {
    await sidebarLink.first().waitFor({ state: 'visible', timeout: 10000 })
  } catch {
    entryOk = false
  }
  check('侧边栏一级类目里直接出现「提示词广场」', entryOk)
  if (entryOk) {
    const label = (await sidebarLink.first().innerText()).trim()
    check('一级项文案为「提示词广场」', label === '提示词广场', label)

    // 点进去（不是 goto：要验证这一项真的可点、且落地页正确）
    await sidebarLink.first().click()
    await page.waitForURL((url) => url.pathname === '/prompts', { timeout: 15000 })
    check('点击一级项进入提示词广场', new URL(page.url()).pathname === '/prompts', page.url())
    await page.waitForTimeout(800)
    const active = await sidebarLink.first().getAttribute('data-active')
    check('侧边栏该项保持高亮（data-active=true）', active === 'true', String(active))
    await shot('20-prompt-square-sidebar')
  }

  // 2b. 提示词广场自己的顶部子页（用户口径："提示词广场没有顶部子页面"）
  const header = page.locator('header').first()
  const headerLabels = await header.getByRole('link').allInnerTexts()
  const labelText = headerLabels.join(' / ')
  check(
    '顶栏换成提示词广场自己的子页：我的提示词 ｜ 共享提示词',
    headerLabels.includes('我的提示词') && headerLabels.includes('共享提示词'),
    labelText
  )
  check(
    '顶栏不再挂 AI 助手模块导航（对话 / 我的沉淀）',
    !headerLabels.includes('我的沉淀') && !headerLabels.includes('对话'),
    labelText
  )
  check(
    '页面名不再是继承来的「AI 助手」',
    (await header.locator('text=AI 助手').count()) === 0,
    (await header.innerText()).replace(/\n+/g, ' | ')
  )

  const mineTab = header.getByRole('link', { name: '我的提示词' })
  const sharedTab = header.getByRole('link', { name: '共享提示词' })
  check(
    '默认落在「我的提示词」子页',
    (await mineTab.getAttribute('aria-current')) === 'page',
    String(await mineTab.getAttribute('aria-current'))
  )

  await sharedTab.click()
  await page.waitForURL((url) => url.searchParams.get('view') === 'shared', {
    timeout: 10000,
  })
  await page.waitForTimeout(800)
  check(
    '切到「共享提示词」：URL 带 view=shared',
    page.url().includes('view=shared'),
    page.url()
  )
  check(
    '「共享提示词」子页高亮切过去',
    (await sharedTab.getAttribute('aria-current')) === 'page'
  )
  check(
    '页面内只剩共享那一块（不再纵向堆叠两块）',
    (await page.locator('text=同事共享出来的提示词').count()) > 0 &&
      (await page.locator('text=只有你自己可以用').count()) === 0
  )
  await shot('23-prompt-square-shared')

  await mineTab.click()
  await page.waitForURL((url) => !url.searchParams.get('view'), { timeout: 10000 })
  await page.waitForTimeout(500)
  check(
    '切回「我的提示词」：URL 参数被清掉',
    !page.url().includes('view=shared'),
    page.url()
  )
  check(
    '页面内只剩我的那一块',
    (await page.locator('text=只有你自己可以用').count()) > 0 &&
      (await page.locator('text=同事共享出来的提示词').count()) === 0
  )

  /*
   * 2b-2. 展示方式（2026-09-17 更新）：提示词广场**默认卡片网格**，数据表格保留为可切换视图。
   * 用户口径：「提示词广场使用卡片展示」+「显示使用次数以及创建人」，经选项确认为
   * 「默认卡片 + 保留表格切换」与「使用次数 / 创建人始终显示」。
   * 因此"默认是卡片""卡片上两个字段始终在""表格仍可用且偏好被记住"都要断言 ——
   * 只测其中一半，要么默认值被改回去没人发现，要么表格视图悄悄坏掉没人发现。
   */
  const defaultCards = await page.locator('article').count()
  check(
    '默认以卡片网格展示',
    defaultCards > 0 && (await page.getByRole('button', { name: '卡片' }).count()) > 0,
    `命中 ${defaultCards} 张卡片`
  )
  // 卡片上「创建人」「使用次数」必须写出来，且**始终显示**（0 次也如实写）：
  // 这两项是本轮需求的原文，用正则兜住而非只测"存在某个容器"。
  const firstCardText = (await page.locator('article').first().innerText()).replace(
    /\s+/g,
    ' '
  )
  check(
    '卡片显示创建人',
    /创建人\s*\S/.test(firstCardText),
    firstCardText.slice(0, 90)
  )
  check(
    '卡片显示使用次数（0 次也显示）',
    /使用\s*\d+\s*次/.test(firstCardText),
    firstCardText.slice(0, 90)
  )
  await shot('24b-prompt-square-cards')

  /*
   * 2b-2b. 展开改为弹窗（2026-09-17 用户口径："点击卡片后以弹窗的方式呈现而不是拉长"）。
   * 要守住的不是"有个弹窗"，而是**两件事同时成立**：① 完整正文确实进了弹窗；
   * ② 卡片本身尺寸不变 —— 改前是"该卡跨满整行 + 正文全展开"，卡片会明显长高。
   * 数据为空时跳过（空态没有卡片可点），并在 detail 里说明，避免误读成"通过了"。
   */
  if (defaultCards > 0) {
    const cardBoxBefore = await page
      .locator('article')
      .first()
      .evaluate((el) => {
        const rect = el.getBoundingClientRect()
        return { w: Math.round(rect.width), h: Math.round(rect.height) }
      })
    await page.locator('article').first().click()
    await page.waitForTimeout(400)
    const detailDialog = page.getByRole('dialog')
    check(
      '点击卡片打开详情弹窗',
      (await detailDialog.count()) === 1,
      `命中 ${await detailDialog.count()} 个 dialog`
    )
    const dialogText = (await detailDialog.innerText()).replace(/\s+/g, ' ')
    check(
      '弹窗内给出创建人与使用次数（与卡片同口径）',
      /创建人\s*\S/.test(dialogText) && /使用\s*\d+\s*次/.test(dialogText),
      dialogText.slice(0, 90)
    )
    // 正文容器：详情弹窗里唯一带 `whitespace-pre-wrap` 的段落（提问模板靠它保换行）
    check(
      '弹窗承载完整正文',
      (await detailDialog.locator('p.whitespace-pre-wrap').count()) > 0
    )
    const cardBoxAfter = await page
      .locator('article')
      .first()
      .evaluate((el) => {
        const rect = el.getBoundingClientRect()
        return { w: Math.round(rect.width), h: Math.round(rect.height) }
      })
    check(
      '打开详情后卡片尺寸不变（不再被拉长）',
      cardBoxBefore.w === cardBoxAfter.w && cardBoxBefore.h === cardBoxAfter.h,
      `改前 ${cardBoxBefore.w}×${cardBoxBefore.h} → 改后 ${cardBoxAfter.w}×${cardBoxAfter.h}`
    )
    await shot('24c-prompt-detail-dialog')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    check('Esc 可关闭详情弹窗', (await page.getByRole('dialog').count()) === 0)
  } else {
    check('点击卡片打开详情弹窗', false, '当前列表没有卡片，无法验证（非脚本问题）')
  }

  // 切到表格视图：可比字段的读法必须仍然一键可达（卡片不是唯一视图）
  await page.getByRole('button', { name: '表格' }).click()
  await page.waitForTimeout(600)
  check('可切到表格视图（表格仍是有效读法）', (await page.locator('table').count()) > 0)
  const tableHeaders = (await page.locator('thead th').allInnerTexts()).map((text) =>
    text.replace(/\s+/g, '')
  )
  check(
    '表格列出可比字段（名称 / 说明 / 标签 / 状态 / 更新于 / 使用）',
    ['名称', '说明', '标签', '状态', '更新于', '使用'].every((expected) =>
      tableHeaders.some((header) => header.includes(expected))
    ),
    tableHeaders.join(' | ')
  )
  check(
    '展示方式偏好被记住（localStorage）',
    (await page.evaluate(() => localStorage.getItem('prompt-square-layout:v2'))) ===
      'table'
  )
  await shot('24b-prompt-square-table')

  // 表格视图的「查看全文」必须打开**同一个弹窗**（否则换布局就丢了读全文的能力），
  // 且不再走"在行下方插一行"的老路 —— 那会当场多出一行。
  if ((await page.getByRole('button', { name: '查看全文' }).count()) > 0) {
    const rowsBefore = await page.locator('tbody tr').count()
    await page.getByRole('button', { name: '查看全文' }).first().click()
    await page.waitForTimeout(400)
    check('表格「查看全文」也打开同一个详情弹窗', (await page.getByRole('dialog').count()) === 1)
    check(
      '表格不再用「行下方插一行」承载正文',
      (await page.locator('tbody tr').count()) === rowsBefore,
      `行数 ${rowsBefore} → ${await page.locator('tbody tr').count()}`
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  } else {
    check('表格「查看全文」也打开同一个详情弹窗', false, '当前表格没有数据行，无法验证')
  }

  // 切回卡片视图：后面两条"网格 / 宽高一致"是**卡片视图**的口径，必须在卡片视图下量
  await page.getByRole('button', { name: '卡片' }).click()
  await page.waitForTimeout(600)
  check('可切回卡片视图（卡片仍是有效读法）', (await page.locator('article').count()) > 0)

  // 2c. 网格布局（用户口径："一行应该可以放 2-3 个卡片"）：量卡宽占内容区的比例，
  //     不依赖数据条数（只有一张卡时它同样只占一个轨道）
  const cardRatio = await page
    .locator('article')
    .first()
    .evaluate((el) => {
      const parent = el.parentElement
      if (!parent) return 1
      return (
        el.getBoundingClientRect().width / parent.getBoundingClientRect().width
      )
    })
  check(
    '宽屏下卡片按网格排布（一行 2–3 张，不再是整行单列）',
    cardRatio < 0.6,
    `卡宽占内容区 ${(cardRatio * 100).toFixed(0)}%`
  )

  // 卡片尺寸一致（用户口径："卡片的长宽高应该一致"）：量渲染出来的宽与高，各自只应有一个取值。
  // 高度靠 `auto-rows-fr` + 卡片 `h-full` 保证 —— 内容多少（标签、驳回原因、正文长短）不再影响卡片高度。
  const boxes = await page.locator('article').evaluateAll((els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect()
      return { w: Math.round(rect.width), h: Math.round(rect.height) }
    })
  )
  const widths = [...new Set(boxes.map((item) => item.w))]
  const heights = [...new Set(boxes.map((item) => item.h))]
  check(
    '同页卡片宽高完全一致',
    widths.length === 1 && heights.length === 1,
    `宽 ${widths.join(' / ')}，高 ${heights.join(' / ')}`
  )

  // 2d. 排版（2026-09-15）：空态给"图标 + 结论 + 说明 + 出口"三件套，而不是一行灰字
  //     先切到表格视图：空态在两种视图下都要能出来，这里顺带验证"切到表格"这条路径
  //     （默认已是卡片视图，所以这一步是真的发生了切换，不是空操作）
  await page.getByRole('button', { name: '表格' }).click()
  await page.waitForTimeout(400)
  check('可切回表格视图', (await page.locator('table').count()) > 0)
  await page.getByLabel('搜索提示词').fill('zzz-没有这种提示词')
  await page.waitForSelector('text=没有匹配的提示词', { timeout: 10000 })
  check(
    '空态给出结论标题与说明',
    (await page.locator('text=换个关键词试试').count()) > 0
  )
  check(
    '空态带出口按钮（清空搜索）',
    (await page.getByRole('button', { name: '清空搜索' }).count()) > 0
  )
  await shot('24-prompt-square-empty')
  await page.getByRole('button', { name: '清空搜索' }).click()
  await page.waitForTimeout(600)
  check(
    '清空搜索后输入框被清空',
    (await page.getByLabel('搜索提示词').inputValue()) === ''
  )

  // 3. 打开新建弹窗，填入草稿
  await page.goto(`${BASE}/prompts`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '新建提示词' }).first().click()
  await page.waitForSelector('text=新建提示词', { timeout: 10000 })

  // 「标题」字段 2026-09-15 下线：表单只留名称（名称与标题原本是上下两个输入框、说的是同一件事）
  const legacyTitle = await page
    .getByRole('dialog')
    .getByText('标题', { exact: true })
    .count()
  check('弹窗只保留「名称」：已下线的「标题」字段不再出现', legacyTitle === 0, `命中 ${legacyTitle}`)

  await bodyBox().fill(DRAFT)
  check('新建弹窗可输入提示词正文', (await bodyBox().inputValue()) === DRAFT)

  const optimizeButton = page.getByRole('button', { name: '优化提示词' })
  check('正文框旁有常驻「优化提示词」按钮', (await optimizeButton.count()) > 0)

  // 4. 点优化：等真实模型返回（deepseek 通常 5–30s，给足超时）
  await optimizeButton.first().click()
  let optimizedText = ''
  let optimizeOk = true
  try {
    await page.waitForSelector(`text=${OPTIMIZED_MARK}`, { timeout: 90_000 })
    const panels = page.locator('p.wrap-anywhere')
    optimizedText = (await panels.last().innerText()).trim()
  } catch {
    optimizeOk = false
  }
  check('优化返回并展示对比区', optimizeOk, optimizeOk ? '' : '未出现对比区（真实模型不可用？）')
  if (optimizeOk) {
    check('优化结果非空且不同于原文', optimizedText.length > 0 && optimizedText !== DRAFT, `${optimizedText.length} 字`)
    check('原文栏保留发起优化时的草稿', (await page.locator('text=原文').count()) > 0)
    // 核心不变式：AI 结果只是展示，输入框内容不变
    check('采用前输入框内容未被改动', (await bodyBox().inputValue()) === DRAFT)
    await shot('21-prompt-optimize-compare')

    // 5. 采用 → 正文被替换；撤销 → 回到原文
    await page.getByRole('button', { name: '采用优化结果' }).click()
    await page.waitForTimeout(500)
    const appliedValue = await bodyBox().inputValue()
    check('点「采用优化结果」后正文替换为优化结果', appliedValue === optimizedText, appliedValue.slice(0, 40))
    check('对比区标记为已采用', (await page.locator(`text=${APPLIED_MARK}`).count()) > 0)

    await page.getByRole('button', { name: '撤销采用' }).click()
    await page.waitForTimeout(500)
    check('「撤销采用」把正文还原为原文', (await bodyBox().inputValue()) === DRAFT)
    await shot('22-prompt-optimize-applied')
  }

  // 6. 不落库：直接取消
  await page.getByRole('button', { name: '取消' }).click()
  await page.waitForTimeout(600)
  const dialogGone = (await page.getByRole('dialog').count()) === 0
  check('取消后弹窗关闭', dialogGone)
  const created = await page.locator(`text=${DRAFT.slice(0, 20)}`).count()
  check('未创建条目（草稿不出现在列表里）', created === 0, `命中 ${created}`)

  const productErrors = consoleErrors.filter(
    (text) => !EXTERNAL_RESOURCE_NOISE.test(text)
  )
  check('浏览器控制台无 error', productErrors.length === 0, productErrors.slice(0, 2).join(' | '))
  check(
    '应用自身资源请求无失败',
    appRequestFailures.length === 0,
    appRequestFailures.slice(0, 2).join(' | ')
  )
} catch (error) {
  check('UI 验收到执行完成', false, String(error).split('\n')[0])
  await shot('29-prompt-optimize-failure')
} finally {
  await browser.close()
}

const failed = checks.filter((item) => !item.ok)
process.stdout.write(`\n通过 ${checks.length - failed.length}/${checks.length}\n`)
if (failed.length) {
  process.stdout.write(`失败：\n${failed.map((item) => `- ${item.name}：${item.detail}`).join('\n')}\n`)
  process.exitCode = 1
}

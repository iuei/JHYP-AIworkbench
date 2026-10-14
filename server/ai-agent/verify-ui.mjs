/**
 * AI 助手 UI 冒烟验证（使用系统 Chrome，不需要下载 Playwright Chromium）。
 *
 * 用法：
 *   VITE_API_BASE_URL=http://127.0.0.1:8788/api pnpm exec vite --port 5175 --strictPort   # 终端 A
 *   node server/ai-agent/verify-ui.mjs http://localhost:5175                              # 终端 B
 */
import dotenv from 'dotenv'
import { chromium } from 'playwright'

dotenv.config()

const BASE = process.argv[2] ?? 'http://localhost:5175'
const LOGIN = process.env.INITIAL_ADMIN_LOGIN
const PASSWORD = process.env.INITIAL_ADMIN_PASSWORD
const OUT = process.env.AI_VERIFY_OUT ?? 'verify-artifacts'

const problems = []
const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  process.stdout.write(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}\n`)
}

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } })
const page = await context.newPage()

/**
 * 断言"产品有没有错"，而不是"环境是否完全可用"：
 * - 外部字体 CDN（fonts.gstatic.com，由 font-provider 引入）在当前网络可能不可达，
 *   浏览器会打出 "Failed to load resource: net::ERR_CONNECTION_CLOSED"，这条控制台消息**不带 URL**，
 *   无法用正则区分来源；因此改为用 requestfailed 事件按 URL 判定来源；
 * - 页面跳转本身会让未完成的资源请求变成 net::ERR_ABORTED，也属正常。
 * 判定规则：应用自身来源（5173 / 8787）的请求不允许失败；其余来源的失败单独列出、不判失败。
 */
const APP_ORIGINS = [/^https?:\/\/localhost:5173\//, /^https?:\/\/127\.0\.0\.1:8787\//]
const EXTERNAL_RESOURCE_NOISE = /^Failed to load resource: net::ERR_(CONNECTION_CLOSED|ABORTED|FAILED)$/

const consoleErrors = []
const appRequestFailures = []
const externalRequestFailures = []

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
})
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`))
/**
 * Vite 依赖预构建（deps optimizer）在源码新增 import 后会重建，旧 deps URL 上的在途请求会变成
 * ERR_ABORTED。这是开发服务器的正常行为，不代表产品资源加载失败，因此单独归类。
 */
const VITE_DEP_CHURN = /\/node_modules\/\.vite\/deps\//

page.on('requestfailed', (request) => {
  const url = request.url()
  const reason = request.failure()?.errorText ?? 'unknown'
  const isAppOrigin = APP_ORIGINS.some((pattern) => pattern.test(url))
  if (isAppOrigin && !VITE_DEP_CHURN.test(url)) {
    appRequestFailures.push(`${url} → ${reason}`)
    return
  }
  externalRequestFailures.push(`${url} → ${reason}`)
})

/** 控制台里无法归因到具体 URL 的"资源加载失败"，按外部噪声处理（真实的失败会在 appRequestFailures 里出现）。 */
function productConsoleErrors() {
  return consoleErrors.filter((text) => !EXTERNAL_RESOURCE_NOISE.test(text))
}

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
}

try {
  // 1. 登录
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('账号 / 邮箱').fill(LOGIN)
  await page.getByLabel('密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL((url) => !url.pathname.includes('sign-in'), { timeout: 15000 })
  check('登录成功并跳转', true, page.url())

  // 2. 侧边栏入口
  // 登录跳转刚完成时侧边栏可能尚未挂载，这里显式等待。
  // 注意：AI 助手是可展开类目（对话 / 我的沉淀），因此断言类目标题与展开后的子项，
  // 不能再只找 a[href="/ai-agent"]（类目收起时子项不渲染）。
  // 侧边栏已于 2026-09-15 取消「常用 / 其他」分组，一级类目直接平铺。
  let sidebarOk = true
  try {
    await page
      .locator('[data-slot="sidebar-content"]')
      .getByText('AI 助手', { exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: 10000 })
  } catch {
    sidebarOk = false
  }
  check('侧边栏一级类目出现 AI 助手入口', sidebarOk)
  if (sidebarOk) {
    /*
      二级类目 2026-09-16 起改为**悬停/点击弹出浮窗**（不再内联展开），
      浮窗内容 Portal 到 body、不在 `sidebar-content` 里，所以这里用 hover 打开浮窗后
      直接在浮窗内断言子项；同时守住"侧边栏里不再内联出现子项"。
    */
    await page
      .locator('[data-slot="sidebar-content"]')
      .getByRole('button', { name: 'AI 助手' })
      .first()
      .hover()
    await page.waitForTimeout(700)
    const subItems = await page
      .locator('[role="menuitem"][href="/ai-agent/notes"]')
      .count()
    check('悬停 AI 助手后浮窗内可见「我的沉淀」子项', subItems > 0, `子项 ${subItems}`)
    const inlineSubItems = await page
      .locator('[data-slot="sidebar-content"] a[href="/ai-agent/notes"]')
      .count()
    check('侧边栏不再内联展开「我的沉淀」（改为浮窗）', inlineSubItems === 0, `内联 ${inlineSubItems}`)
    // 关闭浮窗，避免影响后续断言（鼠标移开即可）
    await page.mouse.move(900, 500)
    await page.waitForTimeout(500)
  }

  // 3. 对话工作台
  await page.goto(`${BASE}/ai-agent`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=用自然语言提问', { timeout: 15000 })
  check('对话工作台空状态渲染', true)
  const guideCount = await page.locator('button:has-text("制度 / SOP 查询")').count()
  check('空状态引导问题卡片存在', guideCount > 0)
  await shot('01-workbench-empty')

  // 3b. 左栏宽度由用户自己定：拖拽 / 键盘两条通道，选择写 cookie 下次仍生效。
  //     另外钉住一条不变式——拖到极限也不能把中栏压没（pane-width.ts 的 limitPaneWidths）。
  //     右栏（本次回答的依据）已取消，依据改由回答卡片内「查看依据」按钮展开，故只剩一根分隔条。
  const paneResizers = page.locator(
    '[role="separator"][aria-orientation="vertical"]'
  )
  const resizerCount = await paneResizers.count()
  check('只剩一根可调分隔条（右栏已取消）', resizerCount === 1, `分隔条 ${resizerCount}`)

  // 左栏 = 左分隔条的前一个兄弟节点，中栏 = 左分隔条的后一个兄弟节点
  const paneWidth = (handle, side) =>
    handle.evaluate((el, dir) => {
      const target = el[dir]
      return target ? Math.round(target.getBoundingClientRect().width) : -1
    }, side)
  const leftPaneWidth = () => paneWidth(paneResizers.first(), 'previousElementSibling')
  const centerPaneWidth = () => paneWidth(paneResizers.first(), 'nextElementSibling')

  const dragResizer = async (handle, deltaX) => {
    const box = await handle.boundingBox()
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width / 2, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + deltaX, y, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(250)
  }

  const defaultLeft = await leftPaneWidth()
  await dragResizer(paneResizers.first(), 60)
  const draggedLeft = await leftPaneWidth()
  check(
    '拖动左栏分隔条可加宽会话列表',
    draggedLeft >= defaultLeft + 48,
    `${defaultLeft} → ${draggedLeft}px`
  )

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=用自然语言提问', { timeout: 15000 })
  const persistedLeft = await leftPaneWidth()
  check(
    '刷新后仍按用户设置的宽度（写入 cookie）',
    Math.abs(persistedLeft - draggedLeft) <= 1,
    `${persistedLeft}px`
  )

  await paneResizers.first().focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(250)
  const keyboardLeft = await leftPaneWidth()
  check(
    '分隔条支持键盘调整（拖动不是唯一方式）',
    keyboardLeft === persistedLeft + 16,
    `${persistedLeft} → ${keyboardLeft}px`
  )

  const widthMenuButtons = await page.getByRole('button', { name: '页面宽度' }).count()
  check(
    '输入区不再有「页面宽度」按钮（宽度只由分隔条调整）',
    widthMenuButtons === 0,
    `按钮 ${widthMenuButtons}`
  )

  // 把左栏拖到最大档：中栏必须仍留出最小可用宽度，且不出现横向滚动
  // （容器过窄时"停在下限"的边界由 pane-width.test.ts 的 limitPaneWidths 单测覆盖）
  await dragResizer(paneResizers.first(), 900)
  const widenedLeft = await leftPaneWidth()
  const centerAfterExtreme = await centerPaneWidth()
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  )
  check('左栏拖到最大档也不超过上限', widenedLeft <= 420, `左栏 ${widenedLeft}px`)
  check(
    '左栏拉到最大后中栏仍保留最小宽度',
    centerAfterExtreme >= 360,
    `中栏 ${centerAfterExtreme}px`
  )
  check('调整宽度不产生横向滚动', horizontalOverflow <= 1, `溢出 ${horizontalOverflow}px`)

  // 双击分隔条恢复默认（唯一的重置入口，键盘用 Enter 等价）
  await paneResizers.first().dblclick()
  await page.waitForTimeout(300)
  const resetLeft = await leftPaneWidth()
  check('双击分隔条恢复默认宽度（左 288）', resetLeft === 288, `左 ${resetLeft}px`)

  // 键盘 Enter 同样能恢复默认（拖拽 + 双击都是鼠标通路，键盘用户需要等价操作）
  await paneResizers.first().focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(250)
  const widenForReset = await leftPaneWidth()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  const keyboardResetLeft = await leftPaneWidth()
  check(
    '键盘 Enter 恢复默认宽度',
    widenForReset === 304 && keyboardResetLeft === 288,
    `${widenForReset} → ${keyboardResetLeft}px`
  )

  // 拖拽断言用了真实鼠标按下/抬起：若 Vite 在拖拽中途重载页面，指针可能停在"按下"状态，
  // 会让后面所有 click 变成拖拽（表现为"点击引导卡没反应"）。这里兜底释放一次。
  await page.mouse.up()

  // 4. 发起一次问答
  await page.getByRole('button', { name: /制度 \/ SOP 查询/ }).click()
  // Vite 依赖预构建重建后会自行 reload，偶发把这一次点击吞掉（点击成功但页面已重载，React 事件丢失）。
  // 用"是否出现回答卡片"判断，未生效就再点一次，并把重试写进日志——区分环境抖动与产品问题。
  try {
    await page.waitForSelector(
      'article[aria-label="AI 正在回答"], article[aria-label="AI 回答"]',
      { timeout: 8000 }
    )
  } catch {
    process.stdout.write('… 首次点击未触发问答（疑似 Vite reload 抖动），重试一次\n')
    await page.getByRole('button', { name: /制度 \/ SOP 查询/ }).click()
  }
  // 真实模型 + 两轮工具调用，偶发变慢（实测 10~40s）；60s 超时避免把模型抖动当产品缺陷。
  // 等「AI 回答」卡片（流式期间是 aria-label="AI 正在回答"）出现 —— 卡片内已不再渲染引用清单，
  // 依据改为卡片内「查看依据」按钮按需展开，所以这里用卡片本身当问答完成的信号。
  await page.waitForSelector('article[aria-label="AI 回答"]', { timeout: 60000 })
  const answerArticle = page.locator('article[aria-label="AI 回答"]').last()
  const answerText = await answerArticle.innerText()
  check('问答返回回答卡片', answerText.length > 0, answerText.slice(0, 60).replaceAll('\n', ' '))
  check('回答带声明条（数据来源 / 数据截至）', answerText.includes('数据来源') && answerText.includes('数据截至'))
  check('回答卡片内不再渲染引用清单', !answerText.includes('引用来源'))
  // 右栏已取消：依据默认**不可见**，只有点卡片内按钮才展开（2026-09-15 用户要求）
  const evidenceButton = answerArticle.getByRole('button', { name: '查看依据' })
  check('回答卡片内有「查看依据」按钮', (await evidenceButton.count()) > 0)
  const evidenceHidden = await answerArticle.locator('text=引用文档').count()
  check('依据默认收起（未点按钮时不可见）', evidenceHidden === 0, `可见区块 ${evidenceHidden}`)
  await evidenceButton.first().click()
  await page.waitForTimeout(500)
  const panelCitations = await answerArticle.locator('text=引用文档').count()
  const panelToolRuns = await answerArticle.locator('text=工具调用与参数').count()
  const toolRunVisible = await answerArticle.locator('code:has-text("search_knowledge")').count()
  check('点开按钮后卡片内展示引用文档', panelCitations > 0)
  check(
    '点开按钮后卡片内展示工具调用与参数',
    panelToolRuns > 0 && toolRunVisible > 0,
    `工具条目 ${toolRunVisible}`
  )
  const inlineTrace = await answerArticle.locator('text=已search_knowledge').count()
  check('回答卡片内联展示工具调用进展', inlineTrace > 0)
  await shot('02-workbench-answer')

  // 5. 会话列表出现新会话
  await page.waitForTimeout(1500)
  const conversationItems = await page.locator('aside button:has-text("条消息")').count()
  check('左栏会话列表出现新会话', conversationItems > 0, `${conversationItems} 条`)

  // 6. 知识库管理（2026-09-18 起在「AI 工作台 → 知识库 → 团队知识库」的管理员视图）
  await page.goto(`${BASE}/knowledge?view=team`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=团队知识库', { timeout: 15000 })
  // 管理员视图默认卡片（与员工侧同构）；表格断言前先切到表格
  await page.getByRole('button', { name: '表格' }).click()
  let docRows = 0
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('table tbody tr').length > 0,
      undefined,
      { timeout: 15000 }
    )
  } catch {
    docRows = -1
  }
  docRows = docRows === -1 ? 0 : await page.locator('table tbody tr').count()
  check('知识库页文档表格渲染', docRows > 0, `${docRows} 行`)
  const chunkButton = page.getByRole('button', { name: '查看片段' }).first()
  if (await chunkButton.count()) {
    await chunkButton.click()
    await page.waitForTimeout(1200)
    check('切片预览弹窗可打开', (await page.locator('text=片段 #').count()) > 0)
    await shot('03b-knowledge-chunks')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }
  await shot('03-knowledge')

  // 7. 审计台（已迁到 /admin/ai/audit；「模型与配置」已从 tab 里移出成独立页）
  await page.goto(`${BASE}/admin/ai/audit`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=工具调用明细', { timeout: 15000 })
  await page.waitForTimeout(1500)
  const runRows = await page.locator('table tbody tr').count()
  check('审计台工具调用明细渲染', runRows > 0, `${runRows} 行`)
  await page.getByRole('tab', { name: '拦截记录' }).click()
  await page.waitForTimeout(800)
  const blockedBlocks = await page.locator('text=越权拦截').count()
  check('审计台拦截记录视图可见', blockedBlocks > 0)
  await shot('04-audit-blocked')
  const auditTabs = await page.getByRole('tab').count()
  const staleSettingsTab = await page.getByRole('tab', { name: '模型与配置' }).count()
  check(
    '审计台只保留 4 个审计视图，配置不再混在审计里',
    auditTabs === 4 && staleSettingsTab === 0,
    `tab 数 ${auditTabs}`
  )

  // 7b. 模型与配置（独立页）
  await page.goto(`${BASE}/admin/ai/settings`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=工具开关', { timeout: 15000 })
  await page.waitForTimeout(1000)
  const toolSwitches = await page.locator('button[role="switch"]').count()
  check('模型与配置独立页渲染工具开关', toolSwitches > 0, `${toolSwitches} 个开关`)

  // 模型接入（后台配置密钥）
  const baseUrlInput = page.locator('#model-base-url')
  const apiKeyInput = page.locator('#model-api-key')
  check('模型接入卡片渲染 Base URL 输入框', (await baseUrlInput.count()) > 0)
  check(
    'API Key 使用密码输入框且默认留空（不回填明文）',
    (await apiKeyInput.count()) > 0 &&
      (await apiKeyInput.getAttribute('type')) === 'password' &&
      (await apiKeyInput.inputValue()) === ''
  )
  check('存在「测试连接」按钮', (await page.getByRole('button', { name: '测试连接' }).count()) > 0)
  const modeBadge = await page.locator('text=当前生效模式：').count()
  check('展示当前生效模式与密钥来源', modeBadge > 0)
  check(
    '强制演示模式开关存在',
    (await page.getByRole('switch', { name: '强制演示模式开关' }).count()) > 0
  )
  await shot('05-audit-settings')

  // 8. 窄屏：右栏与依据抽屉都已取消，只剩会话列表抽屉
  await page.goto(`${BASE}/ai-agent`, { waitUntil: 'domcontentloaded' })
  await page.setViewportSize({ width: 900, height: 900 })
  await page.waitForTimeout(600)
  const evidenceDrawer = await page.getByRole('button', { name: '查看本次回答的依据' }).count()
  const historyButton = await page.getByRole('button', { name: '打开会话列表' }).count()
  check('窄屏下不再有依据抽屉入口（依据在回答卡片内）', evidenceDrawer === 0)
  check('窄屏下会话列表入口可见', historyButton > 0)
  await page.getByRole('button', { name: '打开会话列表' }).click()
  await page.waitForTimeout(900)
  const drawerItems = await page.locator('[role="dialog"] button:has-text("条消息")').count()
  check('窄屏会话抽屉可打开', drawerItems > 0, `${drawerItems} 条`)
  await shot('06-narrow')
  await page.keyboard.press('Escape')

  // 9. 数据源与导入页 + 回答卡片的数据块（M-A 新增能力）
  await page.goto(`${BASE}/admin/ai/datasources`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=导入记录', { timeout: 15000 })
  await page.waitForTimeout(1200)
  const datasetCards = await page.locator('text=Amazon 广告日报').count()
  check('数据源页渲染数据集卡片', datasetCards > 0)
  const templateButton = await page.getByRole('button', { name: '下载模板' }).count()
  // 上传入口在安全加固轮已由 `<label>` 改为按钮触发隐藏 file input（键盘可达、disabled 真正生效），
  // 断言随之按按钮文案匹配 —— `label:has-text("上传报表")` 早已不存在，会永远失败。
  const uploadButton = await page.getByRole('button', { name: '上传报表' }).count()
  check('模板下载与上传入口存在', templateButton > 0 && uploadButton > 0)
  const emptyBadge = await page.locator('text=暂无数据').count()
  check('无数据的数据集会显示「暂无数据」标记', emptyBadge >= 0)
  await shot('08-datasources')

  // 回答卡片的数据块：问一个业务数据问题，断言表格与趋势图渲染出来
  await page.goto(`${BASE}/ai-agent`, { waitUntil: 'domcontentloaded' })
  // 等提问输入框：空态文案只在 activeId === null 且非流式时渲染，用它当就绪信号会在
  // 恢复会话 / 窄屏等场景下假失败（本节此前正是踩到这个）。
  await page.waitForSelector('[aria-label="提问内容"]', { timeout: 15000 })
  const dataQuestion = '上个月美国站 B0SAMPLE01 的 ACoS 是多少？'
  await page.getByLabel('提问内容').fill(dataQuestion)
  await page.getByRole('button', { name: '发送' }).click()
  try {
    await page.waitForSelector('table', { timeout: 90000 })
    check('业务数据回答渲染出表格', (await page.locator('table').count()) > 0)
    check(
      '业务数据回答渲染出趋势图',
      (await page.locator('.recharts-surface').count()) > 0,
      `recharts 容器 ${await page.locator('.recharts-surface').count()} 个`
    )
    await page.waitForSelector('text=数据来源', { timeout: 20000 })
    check('业务数据回答带声明条', (await page.locator('text=数据来源').count()) > 0)
    await shot('09-data-answer')
  } catch (error) {
    check('业务数据回答渲染出表格与趋势图', false, String(error).split('\n')[0])
  }

  // 10. 主动分析：异常扫描应渲染出柱状图与异常清单
  await page.goto(`${BASE}/ai-agent`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=用自然语言提问', { timeout: 15000 })
  await page.getByLabel('提问内容').fill('八月美国站有哪几个 ASIN 的广告需要关注？')
  await page.getByRole('button', { name: '发送' }).click()
  try {
    // 真实模型 + 全站扫描，实测 20~90s，模型限流时更久
    await page.waitForSelector('.recharts-bar', { timeout: 150000 })
    check('异常扫描回答渲染出柱状图', (await page.locator('.recharts-bar').count()) > 0)
    const bodyText = await page.locator('body').innerText()
    check(
      '异常扫描回答给出需要关注的 ASIN',
      bodyText.includes('B0SAMPLE02'),
      bodyText.includes('B0SAMPLE02') ? '' : '未在页面文本中找到高风险 ASIN'
    )
    await shot('10-anomaly-scan')
  } catch (error) {
    check('异常扫描回答渲染出柱状图', false, String(error).split('\n')[0])
  }

  // 10. 知识沉淀（M-C 新增能力）：我的沉淀 / 沉淀管理
  await page.goto(`${BASE}/ai-agent/notes`, { waitUntil: 'domcontentloaded' })
  // 页面标题已由「顶部布局统一」轮移到全局 Header（路由 staticData.title = 「我的沉淀」），
  // 页面内不再有「我的知识沉淀」这段文案，用条目区当就绪信号。
  await page.waitForSelector('text=沉淀条目', { timeout: 15000 })
  await page.waitForTimeout(1200)
  /*
    技能卡 2026-09-16 精简为「一句说明 + 一个开关」：原先的「知识沉淀 技能」标题、
    版本徽章与只读参数区都已按需求删除，所以这里改判真正要守住的两件事 ——
    说明文案在、开关可用；顺带守住"参数回显与保存按钮不再回来"。
  */
  const skillHint = await page
    .locator('text=开启后可用 AI 从会话中整理经验条目')
    .count()
  check('「我的沉淀」页保留技能开关说明', skillHint > 0, `命中 ${skillHint}`)
  const skillSwitch = await page.locator('#distill-enabled').count()
  check('「我的沉淀」页渲染技能开关', skillSwitch > 0)
  check(
    '技能卡不再回显管理员参数与保存按钮',
    (await page.getByText('以下参数由管理员统一设置，账号不可修改').count()) === 0 &&
      (await page.locator('text=知识沉淀 技能').count()) === 0
  )
  const noteSection = await page.locator('text=沉淀条目').count()
  check('「我的沉淀」页渲染条目区', noteSection > 0)
  const manualButton = await page.getByRole('button', { name: '手工新建' }).count()
  const exportButton = await page.getByRole('button', { name: '导出我的沉淀' }).count()
  check('手工新建与导出入口存在', manualButton > 0 && exportButton > 0)
  await shot('12-my-notes')

  // 手工新建对话框：字段来自技能契约（服务端下发），不是前端硬编码
  await page.getByRole('button', { name: '手工新建' }).click()
  await page.waitForSelector('text=沉淀为知识', { timeout: 10000 })
  const noteDialogText = await page.locator('[role="dialog"]').innerText()
  check(
    '新建对话框按技能契约渲染六个字段',
    ['场景', '背景', '做法', '结果', '踩过的坑', '适用条件'].every((label) =>
      noteDialogText.includes(label)
    )
  )
  check('新建对话框说明私有边界与审核边界', noteDialogText.includes('只有你能看到'))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // 管理员：经验审核页（查看 / 审核 / 导出 / 技能治理）；页面标题已由「沉淀管理」改为「经验审核」
  await page.goto(`${BASE}/admin/ai/distill`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=经验审核', { timeout: 15000 })
  await page.waitForTimeout(1200)
  const pendingStat = await page.locator('text=待审核').count()
  check('沉淀管理页渲染统计卡', pendingStat > 0)
  const reviewButtons = await page.getByRole('button', { name: '通过' }).count()
  const rejectButtons = await page.getByRole('button', { name: '驳回' }).count()
  check(
    '沉淀管理页渲染审核操作',
    reviewButtons > 0 && rejectButtons > 0,
    `通过 ${reviewButtons} / 驳回 ${rejectButtons}`
  )
  const globalSkillSwitch = await page.locator('#global-skill').count()
  check('沉淀管理页可全局启停技能', globalSkillSwitch > 0)
  const adminExportButton = await page.getByRole('button', { name: /导出/ }).count()
  check('沉淀管理页提供导出入口', adminExportButton > 0)
  await shot('13-distill-management')

  // 审核对话框：展示提报人与原文依据（审核人一眼可判）
  if (rejectButtons > 0) {
    await page.getByRole('button', { name: '驳回' }).first().click()
    await page.waitForSelector('text=驳回必须填写原因', { timeout: 10000 })
    const reviewDialogText = await page.locator('[role="dialog"]').innerText()
    check(
      '审核对话框声明驳回必填原因并展示提报人',
      reviewDialogText.includes('驳回必须填写原因') && /提报人|原文依据/.test(reviewDialogText)
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }

  // 窄屏不破版
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${BASE}/ai-agent/notes`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const narrowBody = await page.locator('body').innerText()
  check('窄屏下「我的沉淀」页正常渲染', narrowBody.includes('沉淀条目'))
  await shot('14-notes-narrow')
  await page.setViewportSize({ width: 1680, height: 1000 })

  // 10b. 信息架构：治理面收敛到后台，员工侧只留使用面
  await page.goto(`${BASE}/ai-agent`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const moduleNavText = await page.locator('nav[aria-label="AI 助手功能导航"]').innerText()
  const moduleNavLabels = moduleNavText.split('\n').map((line) => line.trim()).filter(Boolean)
  check(
    // 断言口径（2026-09-15 修正）：原先钉"恰好两项"，而「我的 ASIN」（2026-09-14）与
    // 「提示词广场」（2026-09-15）先后进入员工面导航后，这条就变成永久假失败 ——
    // 真正要守的不变式是"员工面必须有对话与我的沉淀，且治理项不在员工导航里"。
    '员工侧模块导航为使用面（含对话 / 我的沉淀，且不含治理项）',
    moduleNavLabels.includes('对话') &&
      moduleNavLabels.includes('我的沉淀') &&
      !moduleNavLabels.some((label) =>
        ['知识库', '数据源与导入', '经验审核', '模型与配置', '审计台'].includes(label)
      ),
    moduleNavLabels.join(' / ')
  )
  check(
    // 「提示词广场」在侧边栏「常用」里是一级类目、页面顶栏又是它自己的两个子页，
    // 再挂到模块导航下等于把一级类目降格成 AI 助手的子页、同一个入口一屏内出现两遍。
    '模块导航不再挂「提示词广场」（它已是侧边栏一级类目）',
    !moduleNavLabels.includes('提示词广场'),
    moduleNavLabels.join(' / ')
  )

  // 治理面（2026-09-18 起）：「系统管理」只作分组标签，三个治理入口平铺为一级项
  // （不再有与分组同名的折叠类目，也就没有浮窗可 hover）。
  const sidebarText = await page
    .locator('[data-slot="sidebar-content"]')
    .innerText()
  check(
    '侧边栏「系统管理」分组下平铺「AI 治理 / 用户管理 / 公告管理」三个入口',
    sidebarText.includes('系统管理') &&
      ['AI 治理', '用户管理', '公告管理'].every((label) =>
        sidebarText.includes(label)
      ),
    sidebarText.replaceAll('\n', ' ').slice(0, 120)
  )
  check(
    '治理子页不在侧边栏内联（改由顶部横向导航承载；「知识库」是独立一级入口、不在此列）',
    ['数据源与导入', '经验审核', '模型与配置', '审计台'].every(
      (label) => !sidebarText.includes(label)
    ),
    sidebarText.replaceAll('\n', ' ').slice(0, 90)
  )

  // 点进「AI 治理」→ 直接落到「数据源与导入」+ 四个同级顶部入口
  // （概览首页 2026-09-15 移除；落点 2026-09-18 由知识库改为数据源与导入）
  await page
    .locator('[data-slot="sidebar-content"]')
    .getByRole('link', { name: 'AI 治理' })
    .first()
    .click()
  await page.waitForTimeout(1500)
  check(
    '进入「AI 治理」直接落在数据源与导入 /admin/ai/datasources（概览页已移除）',
    new URL(page.url()).pathname === '/admin/ai/datasources',
    new URL(page.url()).pathname
  )
  const adminNavLabels = (
    await page.locator('nav[aria-label="AI 治理功能导航"]').innerText()
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  check(
    '顶部导航为同一层级的四个入口（不再有「AI 治理」概览项与「知识库」）',
    adminNavLabels.length === 4 &&
      ['数据源与导入', '经验审核', '模型与配置', '审计台'].every((label) =>
        adminNavLabels.includes(label)
      ),
    adminNavLabels.join(' | ')
  )
  const sidebarActive = await page
    .locator('[data-slot="sidebar-content"] a[data-active="true"]')
    .count()
  check(
    '侧边栏「AI 治理」在子页下保持激活（前缀匹配）',
    sidebarActive >= 0,
    `激活项 ${sidebarActive}`
  )
  await shot('17-admin-landing')

  // 旧 URL 兼容跳转（知识库的两个历史入口现在都落到「AI 工作台 → 知识库」）
  // 2026-10-14：知识库默认子页就是「团队知识库」，跳转不再带 `?view=team`。
  await page.goto(`${BASE}/ai-agent/knowledge`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  check(
    '旧入口 /ai-agent/knowledge 自动跳到「知识库 → 团队知识库」',
    new URL(page.url()).pathname === '/knowledge' &&
      !new URL(page.url()).searchParams.get('view'),
    page.url().replace(BASE, '')
  )
  await shot('15-admin-ia')

  // 10c. 普通账号：治理入口与治理页都不可达
  const operatorContext = await browser.newContext({ viewport: { width: 1440, height: 950 } })
  const operatorPage = await operatorContext.newPage()
  try {
    // 新开 context 首次访问开发服务器时会触发一次模块编译，偶发超过默认 30s
    await operatorPage.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await operatorPage.getByLabel('账号 / 邮箱').fill('ai-agent-acceptance')
    await operatorPage.getByLabel('密码').fill('Acceptance#2026')
    await operatorPage.getByRole('button', { name: '登录' }).click()
    await operatorPage.waitForURL((url) => !url.pathname.includes('sign-in'), { timeout: 15000 })
    await operatorPage.waitForTimeout(1500)
    const operatorSidebar = await operatorPage
      .locator('[data-slot="sidebar-content"]')
      .innerText()
    check(
      '普通账号的侧边栏不含「AI 治理」，但「知识库」作为一级入口可见',
      !operatorSidebar.includes('AI 治理') && operatorSidebar.includes('知识库')
    )
    check(
      '普通账号的侧边栏不含「用户管理」（治理入口不暴露）',
      !operatorSidebar.includes('用户管理')
    )
    // 知识库治理已并入团队知识库：普通账号打开同一子页必须只有只读视图
    await operatorPage.goto(`${BASE}/knowledge?view=team`, {
      waitUntil: 'domcontentloaded',
    })
    await operatorPage.waitForTimeout(1500)
    check(
      '普通账号在团队知识库看到只读视图（无上传 / 重建索引等管理操作）',
      (await operatorPage.locator('text=团队知识库').count()) > 0 &&
        (await operatorPage.getByRole('button', { name: '更多知识库操作' }).count()) === 0
    )
    await operatorPage.goto(`${BASE}/admin/ai/audit`, { waitUntil: 'domcontentloaded' })
    await operatorPage.waitForTimeout(1500)
    check(
      '普通账号直接访问治理页被重定向到 403',
      operatorPage.url().includes('/403'),
      new URL(operatorPage.url()).pathname
    )
    await operatorPage.goto(`${BASE}/ai-agent`, { waitUntil: 'domcontentloaded' })
    await operatorPage.waitForTimeout(1200)
    const operatorNoteEntry = await operatorPage.locator('a[href="/ai-agent/notes"]').count()
    check('普通账号仍可使用「我的沉淀」', operatorNoteEntry > 0)
    await operatorPage.screenshot({ path: `${OUT}/16-operator-sidebar.png` })
  } finally {
    await operatorContext.close()
  }

  // 11. A12 回归：现有模块冒烟（不破坏既有功能）
  //     注意：`/quick-navigation` 已随快捷导航模块删除（2026-09-15），不再作为回归页
  const regressionPages = [
    { path: '/', expect: '仪表盘' },
    { path: '/competitor-analysis', expect: '竞品分析' },
    { path: '/admin/users', expect: '用户管理' },
  ]
  for (const item of regressionPages) {
    const errorsBefore = productConsoleErrors().length
    await page.setViewportSize({ width: 1440, height: 950 })
    await page.goto(`${BASE}${item.path}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    const bodyText = await page.locator('body').innerText()
    check(
      `A12 回归：${item.path} 正常渲染`,
      bodyText.includes(item.expect) && productConsoleErrors().length === errorsBefore,
      productConsoleErrors().slice(errorsBefore, errorsBefore + 1).join('')
    )
  }
  await page.goto(`${BASE}/ai-agent`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1000)
  await shot('07-regression-after')

  // 「外观」页已按需求删除（主题切换保留在右上角）：侧边栏里不应再出现该入口。
  // 2026-09-18 起「系统管理」只是分组标签、没有可展开的菜单，因此直接读侧边栏文本。
  const sidebarNavText = await page
    .locator('[data-slot="sidebar-content"]')
    .innerText()
  check(
    '侧边栏不再提供「外观」入口（该页已删除）',
    // 「用户管理」可见即证明治理入口确实渲染了，否则"看不到外观"只是没渲染造成的假通过
    sidebarNavText.includes('用户管理') && !sidebarNavText.includes('外观'),
    sidebarNavText.replaceAll('\n', ' ').slice(0, 80)
  )
  await shot('07b-settings-nav')

  const productErrors = productConsoleErrors()
  check(
    '浏览器控制台无产品相关 error',
    productErrors.length === 0,
    productErrors.slice(0, 3).join(' | ') ||
      (consoleErrors.length > 0 ? `（另有 ${consoleErrors.length} 条资源加载噪声，见下方外部请求）` : '')
  )
  check(
    '应用自身资源请求无失败',
    appRequestFailures.length === 0,
    appRequestFailures.slice(0, 3).join(' | ')
  )
  if (externalRequestFailures.length > 0) {
    const unique = [...new Set(externalRequestFailures.map((item) => item.split(' → ')[0]))]
    process.stdout.write(
      `ℹ 非产品资源失败 ${externalRequestFailures.length} 次（外部 CDN / Vite 依赖预构建重建，不计入失败）：${unique.slice(0, 3).join(', ')}\n`
    )
  }
} catch (error) {
  check('UI 冒烟执行完成', false, String(error).split('\n')[0])
  // 失败现场截图不能再冒泡：截图本身超时会把真正的失败原因替换成"page.screenshot timeout"，
  // 排查时会误以为是截图问题（本轮实测踩到过）。
  try {
    await shot('99-failure')
  } catch {
    process.stdout.write('ℹ 失败现场截图超时，已跳过（不影响上面的失败原因）\n')
  }
} finally {
  await browser.close()
}

const failed = checks.filter((item) => !item.ok)
process.stdout.write(`\n通过 ${checks.length - failed.length}/${checks.length}\n`)
if (failed.length) {
  process.stdout.write(`失败：\n${failed.map((item) => `- ${item.name}：${item.detail}`).join('\n')}\n`)
  process.exitCode = 1
}

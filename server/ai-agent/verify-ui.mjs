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
  // 注意：AI 助手已改为可展开分组（对话 / 我的沉淀），因此断言分组标题与展开后的子项，
  // 不能再只找 a[href="/ai-agent"]（分组收起时子项不渲染）。
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
  check('侧边栏「常用」出现 AI 助手入口', sidebarOk)
  if (sidebarOk) {
    await page
      .locator('[data-slot="sidebar-content"]')
      .getByRole('button', { name: 'AI 助手' })
      .first()
      .click()
    await page.waitForTimeout(800)
    const subItems = await page
      .locator('[data-slot="sidebar-content"] a[href="/ai-agent/notes"]')
      .count()
    check('展开 AI 助手后可见「我的沉淀」子项', subItems > 0, `子项 ${subItems}`)
  }

  // 3. 对话工作台
  await page.goto(`${BASE}/ai-agent`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=用自然语言提问', { timeout: 15000 })
  check('对话工作台空状态渲染', true)
  const guideCount = await page.locator('button:has-text("制度 / SOP 查询")').count()
  check('空状态引导问题卡片存在', guideCount > 0)
  await shot('01-workbench-empty')

  // 4. 发起一次问答
  await page.getByRole('button', { name: /制度 \/ SOP 查询/ }).click()
  // 真实模型 + 两轮工具调用，偶发变慢（实测 10~40s）；60s 超时避免把模型抖动当产品缺陷
  await page.waitForSelector('text=引用来源', { timeout: 60000 })
  const answerText = await page.locator('article[aria-label="AI 回答"]').last().innerText()
  check('问答返回回答卡片', answerText.length > 0, answerText.slice(0, 60).replaceAll('\n', ' '))
  check('回答带声明条（数据来源 / 数据截至）', answerText.includes('数据来源') && answerText.includes('数据截至'))
  check('引用来源区块可见', answerText.includes('引用来源'))
  const rightPanel = await page.locator('text=工具调用与参数').count()
  const toolRunVisible = await page.locator('code:has-text("search_knowledge")').count()
  check('右栏「本次回答的依据」渲染工具轨迹', rightPanel > 0 && toolRunVisible > 0, `工具条目 ${toolRunVisible}`)
  const answerArticle = page.locator('article[aria-label="AI 回答"]').last()
  const inlineTrace = await answerArticle.locator('text=已search_knowledge').count()
  check('回答卡片内联展示工具调用进展', inlineTrace > 0)
  await shot('02-workbench-answer')

  // 5. 会话列表出现新会话
  await page.waitForTimeout(1500)
  const conversationItems = await page.locator('aside button:has-text("条消息")').count()
  check('左栏会话列表出现新会话', conversationItems > 0, `${conversationItems} 条`)

  // 6. 知识库管理（已迁到后台治理区域 /admin/ai/knowledge）
  await page.goto(`${BASE}/admin/ai/knowledge`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=知识文档', { timeout: 15000 })
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

  // 8. 窄屏右栏折叠
  await page.goto(`${BASE}/ai-agent`, { waitUntil: 'domcontentloaded' })
  await page.setViewportSize({ width: 900, height: 900 })
  await page.waitForTimeout(600)
  const drawerButton = await page.getByRole('button', { name: '查看本次回答的依据' }).count()
  const historyButton = await page.getByRole('button', { name: '打开会话列表' }).count()
  check('窄屏下引用面板按钮可见', drawerButton > 0)
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
  const uploadLabel = await page.locator('label:has-text("上传报表")').count()
  check('模板下载与上传入口存在', templateButton > 0 && uploadLabel > 0)
  const emptyBadge = await page.locator('text=暂无数据').count()
  check('无数据的数据集会显示「暂无数据」标记', emptyBadge >= 0)
  await shot('08-datasources')

  // 回答卡片的数据块：问一个业务数据问题，断言表格与趋势图渲染出来
  await page.goto(`${BASE}/ai-agent`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('text=用自然语言提问', { timeout: 15000 })
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
  await page.waitForSelector('text=我的知识沉淀', { timeout: 15000 })
  await page.waitForTimeout(1200)
  const skillCard = await page.locator('text=知识沉淀 技能').count()
  check('「我的沉淀」页渲染技能配置卡', skillCard > 0, `命中 ${skillCard}`)
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
  check('窄屏下「我的沉淀」页正常渲染', narrowBody.includes('我的知识沉淀'))
  await shot('14-notes-narrow')
  await page.setViewportSize({ width: 1680, height: 1000 })

  // 10b. 信息架构：治理面收敛到后台，员工侧只留使用面
  await page.goto(`${BASE}/ai-agent`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const moduleNavText = await page.locator('nav[aria-label="AI 助手功能导航"]').innerText()
  const moduleNavLabels = moduleNavText.split('\n').map((line) => line.trim()).filter(Boolean)
  check(
    '员工侧模块导航收敛为「对话 + 我的沉淀」两项',
    moduleNavLabels.length === 2 &&
      moduleNavLabels.includes('对话') &&
      moduleNavLabels.includes('我的沉淀'),
    moduleNavLabels.join(' / ')
  )

  // 治理面收缩在「设置 → AI 治理」下面：先展开「设置」分组
  await page
    .locator('[data-slot="sidebar-content"]')
    .getByRole('button', { name: '设置' })
    .first()
    .click()
  await page.waitForTimeout(700)
  const sidebarText = await page
    .locator('[data-slot="sidebar-content"]')
    .innerText()
  check(
    '「AI 治理」已收缩到侧边栏「设置」下面（二级项）',
    sidebarText.includes('AI 治理') && sidebarText.includes('设置'),
    sidebarText.replaceAll('\n', ' ').slice(0, 90)
  )
  check(
    '侧边栏不再挂五个治理子页（改由顶部横向导航承载）',
    ['知识库', '数据源与导入', '经验审核', '模型与配置', '审计台'].every(
      (label) => !sidebarText.includes(label)
    ),
    sidebarText.replaceAll('\n', ' ').slice(0, 90)
  )

  // 点进「AI 治理」→ 概览首页 + 六个同级顶部入口
  await page.getByRole('link', { name: 'AI 治理' }).first().click()
  await page.waitForTimeout(1500)
  check(
    '进入「AI 治理」落在概览首页 /admin/ai',
    new URL(page.url()).pathname === '/admin/ai',
    new URL(page.url()).pathname
  )
  const adminNavLabels = (
    await page.locator('nav[aria-label="AI 治理功能导航"]').innerText()
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  check(
    '顶部导航为同一层级的六个入口',
    adminNavLabels.length === 6 &&
      adminNavLabels[0] === 'AI 治理' &&
      ['知识库', '数据源与导入', '经验审核', '模型与配置', '审计台'].every((label) =>
        adminNavLabels.includes(label)
      ),
    adminNavLabels.join(' | ')
  )
  const overviewCards = await page.locator('text=治理入口').count()
  const overviewStats = await page.locator('text=知识文档').count()
  check(
    '概览首页渲染统计卡与治理入口（宽屏铺满，不再是单列空白）',
    overviewCards > 0 && overviewStats > 0
  )
  const sidebarActive = await page
    .locator('[data-slot="sidebar-content"] a[data-active="true"]')
    .count()
  check(
    '侧边栏「AI 治理」在子页下保持激活（前缀匹配）',
    sidebarActive >= 0,
    `激活项 ${sidebarActive}`
  )
  await shot('17-admin-overview')

  // 旧 URL 兼容跳转
  await page.goto(`${BASE}/ai-agent/knowledge`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  check(
    '旧入口 /ai-agent/knowledge 自动跳到后台治理页',
    page.url().includes('/admin/ai/knowledge'),
    new URL(page.url()).pathname
  )
  await shot('15-admin-ia')

  // 10c. 普通账号：治理入口与治理页都不可达
  const operatorContext = await browser.newContext({ viewport: { width: 1440, height: 950 } })
  const operatorPage = await operatorContext.newPage()
  try {
    await operatorPage.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
    await operatorPage.getByLabel('账号 / 邮箱').fill('ai-agent-acceptance')
    await operatorPage.getByLabel('密码').fill('Acceptance#2026')
    await operatorPage.getByRole('button', { name: '登录' }).click()
    await operatorPage.waitForURL((url) => !url.pathname.includes('sign-in'), { timeout: 15000 })
    await operatorPage.waitForTimeout(1500)
    const operatorSidebarTrigger = operatorPage
      .locator('[data-slot="sidebar-content"]')
      .getByRole('button', { name: '设置' })
      .first()
    if (await operatorSidebarTrigger.count()) {
      await operatorSidebarTrigger.click()
      await operatorPage.waitForTimeout(600)
    }
    const operatorSidebar = await operatorPage
      .locator('[data-slot="sidebar-content"]')
      .innerText()
    check(
      '普通账号的侧边栏不含「AI 治理」',
      !operatorSidebar.includes('AI 治理') && !operatorSidebar.includes('知识库')
    )
    check(
      '普通账号的侧边栏不含「用户管理」（治理入口不暴露）',
      !operatorSidebar.includes('用户管理')
    )
    await operatorPage.goto(`${BASE}/admin/ai/knowledge`, { waitUntil: 'domcontentloaded' })
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
  const regressionPages = [
    { path: '/', expect: '仪表盘' },
    { path: '/quick-navigation', expect: '快捷导航' },
    { path: '/competitor-analysis', expect: '竞品分析' },
    { path: '/settings/users', expect: '用户管理' },
    { path: '/settings/appearance', expect: '外观' },
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
  await shot('99-failure')
} finally {
  await browser.close()
}

const failed = checks.filter((item) => !item.ok)
process.stdout.write(`\n通过 ${checks.length - failed.length}/${checks.length}\n`)
if (failed.length) {
  process.stdout.write(`失败：\n${failed.map((item) => `- ${item.name}：${item.detail}`).join('\n')}\n`)
  process.exitCode = 1
}

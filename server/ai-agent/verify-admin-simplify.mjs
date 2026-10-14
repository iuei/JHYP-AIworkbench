/**
 * AI 治理子页「简化」验收（临时脚本，只读产品、不写业务数据）。
 *
 * 用法（项目根目录）：node /tmp/verify-gov-simplify.mjs http://127.0.0.1:5173
 *
 * 断言两件事：
 *   1. 减负是否真的发生（主体内容距顶距离、页面总高度、首屏可见行数）；
 *   2. 被"收起"的功能是否仍然可达（逐个展开折叠区与菜单并断言元素出现）。
 */
import dotenv from 'dotenv'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

dotenv.config()

const BASE = process.argv[2] ?? 'http://127.0.0.1:5173'
const LOGIN = process.env.INITIAL_ADMIN_LOGIN
const PASSWORD = process.env.INITIAL_ADMIN_PASSWORD
const OUT = 'verify-artifacts'
mkdirSync(OUT, { recursive: true })

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  process.stdout.write(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}\n`)
}

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({
  viewport: { width: 1680, height: 1000 },
})

/*
 * 拦掉外部字体 CDN（与 verify-prompt-optimize-ui.mjs 同口径）。
 *
 * 本机网络访问不到 googleapis / gstatic，失败会以
 * "Failed to load resource: net::ERR_CONNECTION_CLOSED" 刷进控制台，
 * 让「全程无控制台错误」这条断言恒红 —— 它反映的是网络环境而不是产品缺陷。
 * 字体回退到系统字体不影响任何断言（断言全是 DOM 与文本）。
 */
await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())

const page = await context.newPage()

const consoleErrors = []
/** 无 URL 的"资源加载失败"按外部噪声处理：被拦掉的字体请求正是这条文案。 */
const EXTERNAL_RESOURCE_NOISE =
  /^Failed to load resource: net::ERR_(CONNECTION_CLOSED|ABORTED|FAILED)$/
/** 应用自身来源的请求失败才算问题，按 URL 归因，不靠猜控制台文案。 */
const appRequestFailures = []

page.on('console', (msg) => {
  if (msg.type() !== 'error') return
  const text = msg.text().slice(0, 300)
  if (EXTERNAL_RESOURCE_NOISE.test(text)) return
  consoleErrors.push(text)
})
page.on('pageerror', (error) =>
  consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`)
)
page.on('requestfailed', (request) => {
  const url = request.url()
  // Vite 依赖预构建重建会让旧 deps URL 上的在途请求 abort，属开发服务器正常行为
  if (!url.startsWith(BASE) || /\/node_modules\/\.vite\/deps\//.test(url)) return
  /*
   * 本脚本会连续 `page.goto` 五个治理页，每次导航都会取消上一页尚未完成的模块请求
   * （`net::ERR_ABORTED`）。那是导航语义，不是加载失败 —— 只统计真正的失败
   * （连接被拒/中断、协议错误等），否则这条断言会在任何一次页面切换时误报。
   */
  if (request.failure()?.errorText === 'net::ERR_ABORTED') return
  appRequestFailures.push(`${url} → ${request.failure()?.errorText ?? 'unknown'}`)
})

const shot = (name) => page.screenshot({ path: `${OUT}/gov-${name}.png` })

/** 主体度量：关键元素距视口顶部的距离 + 滚动容器总高度（越小 = 首屏越早看到主体）。 */
const measure = (selector) =>
  page.evaluate((sel) => {
    const el = sel ? document.querySelector(sel) : null
    const scroller = document.querySelector('.overflow-y-auto')
    const bodyRows = Array.from(document.querySelectorAll('table tbody tr'))
    return {
      top: el ? Math.round(el.getBoundingClientRect().top) : null,
      scrollHeight: scroller ? scroller.scrollHeight : null,
      clientHeight: scroller ? scroller.clientHeight : null,
      rows: bodyRows.length,
      // 首屏真正看得见的行数：行是否落在视口内，比"DOM 里有几行"更能说明首屏利用率
      visibleRows: bodyRows.filter(
        (row) => row.getBoundingClientRect().top < window.innerHeight - 24
      ).length,
    }
  }, selector)

// ── 登录 ────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
await page.getByLabel('账号 / 邮箱').fill(LOGIN)
await page.getByLabel('密码').fill(PASSWORD)
await page.getByRole('button', { name: '登录' }).click()
await page.waitForURL((url) => !url.pathname.includes('sign-in'), {
  timeout: 20000,
})
check('管理员登录成功', true)
/*
 * 待办按钮依赖登录后的 auth store（角色判断）与一次待办查询，而 `waitForURL` 只保证
 * 地址栏变了、不保证 React 已经渲染完 —— 不加这个窗口会偶发取不到按钮。
 */
await page.waitForTimeout(1500)
check(
  '顶栏待办按钮对管理员可见（可访问名含待处理条数）',
  (await page.getByRole('button', { name: /待办事项/ }).count()) > 0
)

// ── 1. 治理入口落地 ───────────────────────────────────────────────────
// 概览页已于 2026-09-15 按需求移除（总览 + 横向入口实用性不大，各子页在顶栏本就可达）。
// 落点 2026-09-18 由「知识库」改为「数据源与导入」（知识库治理并入「AI 工作台 → 知识库 →
// 团队知识库」，`/admin/ai/knowledge` 只剩历史跳转，不能再作为落点）：这里只断言落地正确。
await page.goto(`${BASE}/admin/ai`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => window.location.pathname === '/admin/ai/datasources',
  undefined,
  { timeout: 15000 }
)
await page.waitForTimeout(800)
check(
  '治理入口 /admin/ai 直接落到数据源与导入（概览页已移除）',
  new URL(page.url()).pathname === '/admin/ai/datasources',
  new URL(page.url()).pathname
)
await shot('01-landing')

// ── 2. 知识库（管理员视图：2026-09-18 起在「AI 工作台 → 知识库 → 团队知识库」） ──
// 2026-10-14：团队知识库是知识库的默认子页，直接进 `/knowledge` 即可（不再用 ?view=team）。
await page.goto(`${BASE}/knowledge`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('text=团队知识库', { timeout: 15000 })
/*
 * 2026-09-18 第二轮起管理员视图也默认**卡片**（与员工侧同构，用户反馈"团队知识库修改没生效"），
 * 因此这里先切到表格视图再跑原有的表格度量与行内操作断言（表格视图的能力一行未减）。
 */
await page.getByRole('button', { name: '表格' }).click()
await page.waitForFunction(
  () => document.querySelectorAll('table tbody tr').length > 0,
  undefined,
  { timeout: 15000 }
)
await page.waitForTimeout(800)
const knowledge = await measure('table')
check(
  '知识库：表格距顶距离',
  knowledge.top !== null && knowledge.top < 460,
  `${knowledge.top}px`
)
check(
  '知识库：表格已渲染且首屏可见行与总行数一致',
  knowledge.rows > 0 && knowledge.visibleRows === knowledge.rows,
  `共 ${knowledge.rows} 行 / 首屏可见 ${knowledge.visibleRows} 行`
)
await shot('02-knowledge')

// 展开「更多」菜单 → 重建索引仍可达
await page.getByRole('button', { name: '更多知识库操作' }).click()
await page.waitForTimeout(400)
check(
  '知识库：重建索引收进「更多」后仍可达',
  (await page.locator('[role="menuitem"]:has-text("重建索引")').count()) > 0
)
await shot('02b-knowledge-more')
await page.keyboard.press('Escape')

// 行内图标操作仍可点开弹窗
await page.getByRole('button', { name: '查看片段' }).first().click()
await page.waitForTimeout(900)
check('知识库：切片预览弹窗可打开', (await page.locator('text=片段 #').count()) > 0)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
await page.getByRole('button', { name: '设置有效期' }).first().click()
await page.waitForTimeout(700)
check('知识库：有效期弹窗可打开', (await page.getByRole('dialog').count()) > 0)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check(
  '知识库：下线 / 启用仍为明面按钮',
  (await page.getByRole('button', { name: /下线|启用/ }).count()) > 0
)

// ── 3. 经验审核 ───────────────────────────────────────────────────────
await page.goto(`${BASE}/admin/ai/distill`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('text=提示词审核', { timeout: 15000 })
await page.waitForTimeout(1200)

/*
 * 2026-10-14 结构变更：本页由「三个职责纵向堆叠」改为「两个审核队列用选项卡切换 +
 * 技能治理下移到页底」。默认落在「提示词审核」，所以先按提示词视图断言，
 * 再切到「沉淀条目」断言沉淀侧能力 —— 改前两套筛选控件与分页器会同屏，现已不可能。
 */
const queueTabs = await page.getByRole('tab').allInnerTexts()
check(
  '经验审核：三个子视图（提示词审核 / 沉淀条目 / 技能治理）用选项卡切换',
  queueTabs.length === 3 &&
    queueTabs.join('|').includes('提示词审核') &&
    queueTabs.join('|').includes('沉淀条目') &&
    queueTabs.join('|').includes('技能治理'),
  queueTabs.join(' | ')
)
check('经验审核：待审核指标保留', (await page.locator('dt:has-text("待审核")').count()) > 0)
const reviewTable = page.locator('table').first()
const reviewHeads = (
  await reviewTable.locator('thead th').allInnerTexts()
).map((text) => text.trim())
check(
  '经验审核：提示词审核队列是表格（名称/说明/提报人/状态/更新于/操作）',
  JSON.stringify(reviewHeads) ===
    JSON.stringify(['名称', '说明', '提报人', '状态', '更新于', '操作']),
  reviewHeads.join(' | ')
)
check('经验审核：提示词审核队列可见筛选', (await page.getByLabel('搜索提示词').count()) > 0)
check(
  '经验审核：提示词审核队列已不再使用卡片（article）',
  (await page.locator('article').count()) === 0
)
await shot('03-distill-prompts')

// 切到「沉淀条目」视图后再度量主体表格
await page.getByRole('tab', { name: '沉淀条目' }).click()
await page.waitForTimeout(1000)
const distill = await measure('table')
check(
  '经验审核：沉淀表格距顶距离',
  distill.top !== null && distill.top < 560,
  `${distill.top}px（首屏可见 ${distill.visibleRows} 行）`
)
check(
  '经验审核：指标条跟随子视图切换为沉淀口径',
  (await page.locator('dt:has-text("沉淀总数")').count()) > 0
)
await shot('03-distill')

// 技能治理折叠 → 展开后参数与保存按钮可达
/*
 * 技能治理已并入同级选项卡（2026-10-14，按用户口径：「技能治理也像提示词审核、
 * 沉淀条目一样可切换」）：它不再常驻页面，断言前必须先切到该子视图，
 * 否则 `#global-skill` 压根不在 DOM 里。
 */
await page.getByRole('tab', { name: '技能治理' }).click()
await page.waitForTimeout(900)
check(
  '经验审核：技能治理子视图内全局开关可见',
  (await page.locator('#global-skill').count()) > 0
)
await page.getByRole('button', { name: /展开参数与账号明细/ }).first().click()
await page.waitForTimeout(500)
check(
  '经验审核：展开后技能参数可编辑',
  (await page.getByRole('button', { name: '保存技能参数' }).count()) > 0
)
check(
  '经验审核：展开后账号启用情况可见',
  (await page.locator('text=账号启用情况').count()) > 0
)
await shot('03b-distill-skill-expanded')
await page.getByRole('button', { name: /收起参数与账号明细/ }).first().click()
await page.waitForTimeout(400)

// 切回沉淀视图：下面的时间筛选与行内菜单都属于沉淀队列
await page.getByRole('tab', { name: '沉淀条目' }).click()
await page.waitForTimeout(900)

// 时间筛选折叠
check(
  '经验审核：时间筛选默认收起',
  (await page.getByRole('button', { name: '按创建时间筛选' }).count()) > 0
)
await page.getByRole('button', { name: '按创建时间筛选' }).click()
await page.waitForTimeout(400)
check(
  '经验审核：展开后可选择日期',
  (await page.locator('text=开始日期').count()) > 0
)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

/*
 * 行菜单断言前先把状态筛选切到「全部状态」。
 * 默认筛选是「待审核」，而库里待审沉淀可能为 0 条 —— 那时表格只渲染空态、没有数据行，
 * 行内「更多」按钮自然不存在。脚本若假定有数据，就会因数据状态而非代码问题卡住
 * （本轮与上一轮都在此步超时，根因即此）。切到「全部状态」后必然有行可断言。
 */
await page.getByLabel('按状态筛选').click()
await page.waitForTimeout(400)
await page.getByRole('option', { name: '全部状态' }).click()
await page.waitForTimeout(900)

const noteHeads = (
  await page.locator('table').first().locator('thead th').allInnerTexts()
).map((text) => text.trim())
check(
  '经验审核：沉淀表格列结构保留（多选 + 标题/账号/状态/来源/更新时间/操作）',
  noteHeads.length === 7 && noteHeads.includes('标题') && noteHeads.includes('操作'),
  noteHeads.join(' | ')
)

// 行内「更多」菜单
await page.getByRole('button', { name: '更多沉淀操作' }).first().click()
await page.waitForTimeout(400)
const menuText = await page.locator('[role="menu"]').innerText()
check(
  '经验审核：查看/编辑/归档/删除仍在菜单里',
  ['查看详情', '编辑', '归档', '删除'].every((item) => menuText.includes(item))
)
await shot('03c-distill-row-menu')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check(
  '经验审核：通过 / 驳回仍是明面按钮',
  (await page.getByRole('button', { name: '通过' }).count()) > 0 &&
    (await page.getByRole('button', { name: '驳回' }).count()) > 0
)

// ── 4. 审计台 ─────────────────────────────────────────────────────────
await page.goto(`${BASE}/admin/ai/audit`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('text=工具调用明细', { timeout: 15000 })
await page.waitForTimeout(1200)
const audit = await measure('table')
check(
  '审计台：五个视图保留（拦截记录已拍平为两个一级选项卡）',
  (await page.getByRole('tab').count()) === 5
)
check('审计台：表格距顶距离', audit.top !== null && audit.top < 420, `${audit.top}px`)
await shot('04-audit-runs')

await page.getByRole('button', { name: '导出' }).click()
await page.waitForTimeout(400)
const exportMenu = await page.locator('[role="menu"]').innerText()
check(
  '审计台：两个导出仍在菜单里',
  exportMenu.includes('导出工具调用明细') && exportMenu.includes('导出管理动作日志')
)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)

await page.getByRole('tab', { name: '被拦截的工具调用' }).click()
await page.waitForTimeout(900)
const auditBlocked = await measure('table')
check(
  '审计台：被拦截的工具调用视图可切换并渲染',
  auditBlocked.top !== null && auditBlocked.top < 500,
  `${auditBlocked.top}px`
)
await shot('04b-audit-blocked')

/*
 * 拦截记录的两个视角已由「内层二级选项卡」拍平为**同级一级选项卡**（2026-10-14，
 * 按用户口径：四个治理页骨架统一）。它们与「工具调用明细 / 会话轨迹 / 管理动作」并列，
 * 一次只渲染一个、不存在嵌套 —— 这条断言直接切到第二个一级选项卡即可。
 */
await page.getByRole('tab', { name: '越权与拦截事件' }).click()
await page.waitForTimeout(900)
check(
  '审计台：越权与拦截事件视图可切换并渲染',
  (await page.locator('text=越权拦截').count()) > 0
)

/*
 * 指标条随视图切换（2026-10-14 修复）：原先三条指标恒定显示工具调用口径，
 * 切到管理动作后连"共多少条"都看不到。现在每个视图各带自己的口径。
 */
await page.getByRole('tab', { name: '管理动作' }).click()
await page.waitForTimeout(900)
check(
  '审计台：指标条跟随当前视图变化',
  (await page.locator('dl:has-text("管理动作")').count()) > 0 &&
    (await page.locator('dl:has-text("工具调用记录")').count()) === 0
)

await page.getByRole('tab', { name: '会话轨迹' }).click()
await page.waitForTimeout(900)
const firstConversation = page.locator('main button:has-text("条")').first()
if (await firstConversation.count()) {
  await firstConversation.click()
  await page.waitForTimeout(1500)
  check('审计台：完整轨迹在内层滚动容器里', (await page.locator('.max-h-\\[32rem\\]').count()) > 0)
  await shot('04c-audit-trace')
}

// ── 5. 数据源与导入 ───────────────────────────────────────────────────
await page.goto(`${BASE}/admin/ai/datasources`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('text=导入记录', { timeout: 15000 })
await page.waitForTimeout(1200)
check(
  '数据源：下载模板 / 上传报表仍在工具栏',
  (await page.getByRole('button', { name: '下载模板' }).count()) > 0 &&
    (await page.getByRole('button', { name: '上传报表' }).count()) > 0
)
check(
  '数据源：数据集卡片仍渲染',
  (await page.locator('text=Amazon 广告日报').count()) > 0
)
check('数据源：字段单行摘要可见', (await page.locator('text=/字段 \\d+ 个/').count()) > 0)
await shot('05-datasources')
await page.getByRole('button', { name: '导入规则' }).click()
await page.waitForTimeout(400)
check(
  '数据源：导入规则展开后内容完整',
  (await page.locator('text=缺失必填列会整批拒绝').count()) > 0
)
await shot('05b-datasources-rules')
await page.getByRole('button', { name: '导入规则' }).click()
await page.waitForTimeout(300)
await page
  .getByRole('button', { name: /查看Amazon 广告日报数据详情/ })
  .click()
await page.waitForTimeout(1200)
check('数据源：点卡片仍能打开数据详情', (await page.locator('text=数据详情').count()) > 0)
await page.keyboard.press('Escape')
await page.waitForTimeout(400)

// ── 6. 模型与配置 ─────────────────────────────────────────────────────
await page.goto(`${BASE}/admin/ai/settings`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('text=模型接入', { timeout: 15000 })
await page.waitForTimeout(1000)
check(
  '模型与配置：四个子视图用选项卡切换（模型接入 / 卖家精灵 MCP / 护栏与工具 / 用量）',
  (await page.getByRole('tab').count()) === 4
)
check(
  '模型与配置：默认落在「模型接入」子视图',
  (await page.locator('#model-base-url').count()) > 0
)
await shot('06-settings')

/*
 * 「护栏与工具」与「用量」都已收进子视图：前者含工具开关，后者不再是折叠卡 ——
 * 用量独立成子视图后删掉了"展开 / 收起明细"按钮，因此断言改为切过去直接看表格。
 */
await page.getByRole('tab', { name: '护栏与工具' }).click()
await page.waitForTimeout(900)
check('模型与配置：工具开关常显', (await page.locator('button[role="switch"]').count()) > 0)
await shot('06b-settings-guard')

await page.getByRole('tab', { name: '用量' }).click()
await page.waitForTimeout(900)
check(
  '模型与配置：用量子视图渲染表格',
  (await page.locator('text=输入 token').count()) > 0
)
await shot('06c-settings-usage')

// ── 汇总 ─────────────────────────────────────────────────────────────
check('全程无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))
check(
  '全程无应用自身资源加载失败',
  appRequestFailures.length === 0,
  appRequestFailures.slice(0, 3).join(' | ')
)

await browser.close()

const failed = checks.filter((item) => !item.ok)
process.stdout.write(
  `\n通过 ${checks.length - failed.length}/${checks.length}\n` +
    `度量：知识库 top=${knowledge.top} scroll=${knowledge.scrollHeight} / ` +
    `经验审核 top=${distill.top} scroll=${distill.scrollHeight} / 审计台 top=${audit.top} scroll=${audit.scrollHeight}\n`
)
process.exit(failed.length === 0 ? 0 : 1)

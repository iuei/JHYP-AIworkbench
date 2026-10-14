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
const page = await context.newPage()

const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200))
})
page.on('pageerror', (error) =>
  consoleErrors.push(`pageerror: ${String(error).slice(0, 200)}`)
)

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
await page.goto(`${BASE}/knowledge?view=team`, { waitUntil: 'domcontentloaded' })
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
await page.waitForSelector('text=沉淀条目', { timeout: 15000 })
await page.waitForTimeout(1200)
const distill = await measure('table')
check('经验审核：待审核指标保留', (await page.locator('dt:has-text("待审核")').count()) > 0)
check(
  '经验审核：表格距顶距离',
  distill.top !== null && distill.top < 620,
  `${distill.top}px（首屏可见 ${distill.visibleRows} 行）`
)
await shot('03-distill')

// 技能治理折叠 → 展开后参数与保存按钮可达
check('经验审核：全局开关常显', (await page.locator('#global-skill').count()) > 0)
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

// 提示词审核折叠（默认无待审时收起）
const promptToggle = page.getByRole('button', { name: /展开队列|收起队列/ }).first()
if (await promptToggle.count()) {
  const label = (await promptToggle.textContent()) ?? ''
  if (label.includes('展开队列')) {
    await promptToggle.click()
    await page.waitForTimeout(500)
    check(
      '经验审核：提示词审核队列展开后可见筛选',
      (await page.getByLabel('搜索提示词').count()) > 0
    )
  } else {
    check('经验审核：提示词审核队列有待审时默认展开', true)
  }

  /*
   * 2026-09-16：队列由「每条一张卡片」改为表格（每条一行，与提示词广场同一形态）。
   * 页面 DOM 顺序上它是第一张表（提示词审核卡片在「沉淀条目」卡片之前），
   * 且无论是空态还是有数据，表头都在 —— 因此这段断言在无待审数据的库上同样有效。
   */
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
  check(
    '经验审核：提示词审核队列已不再使用卡片（article）',
    (await page.locator('article').count()) === 0
  )
}

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
check('审计台：四个视图保留', (await page.getByRole('tab').count()) === 4)
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

await page.getByRole('tab', { name: '拦截记录' }).click()
await page.waitForTimeout(900)
check(
  '审计台：拦截记录视图仍可切换并渲染',
  (await page.locator('text=越权拦截').count()) > 0
)
const auditBlocked = await measure('table')
check('审计台：拦截记录表格距顶距离', auditBlocked.top !== null && auditBlocked.top < 500, `${auditBlocked.top}px`)
await shot('04b-audit-blocked')

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
await page.waitForSelector('text=工具开关', { timeout: 15000 })
await page.waitForTimeout(1000)
check('模型与配置：工具开关常显', (await page.locator('button[role="switch"]').count()) > 0)
await page.getByRole('button', { name: '展开明细' }).click()
await page.waitForTimeout(600)
check(
  '模型与配置：用量明细展开后渲染表格',
  (await page.locator('text=输入 token').count()) > 0
)
await shot('06-settings-usage')
await page.getByRole('button', { name: '收起明细' }).click()
await page.waitForTimeout(400)
await shot('06-settings')

// ── 汇总 ─────────────────────────────────────────────────────────────
check('全程无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

await browser.close()

const failed = checks.filter((item) => !item.ok)
process.stdout.write(
  `\n通过 ${checks.length - failed.length}/${checks.length}\n` +
    `度量：知识库 top=${knowledge.top} scroll=${knowledge.scrollHeight} / ` +
    `经验审核 top=${distill.top} scroll=${distill.scrollHeight} / 审计台 top=${audit.top} scroll=${audit.scrollHeight}\n`
)
process.exit(failed.length === 0 ? 0 : 1)

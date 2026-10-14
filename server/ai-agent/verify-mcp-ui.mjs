/**
 * 卖家精灵 MCP 接入的 UI + 服务端连通性验证（使用系统 Chrome）。
 *
 * 用法（**必须让前端代理指向加载了新代码的 API**）：
 *   API_PORT=8790 SERVE_STATIC=false node server/index.mjs      # 终端 A：独立端口的 API
 *   API_PORT=8790 pnpm exec vite --port 5173 --strictPort       # 终端 B：代理指向 8790
 *   node server/ai-agent/verify-mcp-ui.mjs http://localhost:5173 # 终端 C
 *
 * 为什么强调独立端口：本机 8787/5173 上经常还跑着**改动前**启动的进程，直接对准它们会
 * 得到 `Cannot POST /api/ai/settings/mcp/test` 的 404（Express 默认 404 页）——
 * 那是"服务端没有这段代码"，不是产品缺陷。Vite 的代理目标读 `API_PORT`，两个进程要一致。
 *
 * 覆盖的是「页面上真的能配、配错真的会被指出来」这条链路：
 * 字段是否齐全 → 用一个**格式合法但无效的密钥**做连通性测试 →
 * 必须明确报"密钥不合法"而不是"连接成功"。卖家精灵在密钥错误时不返回 HTTP 错误，
 * 而是把工具清单退化成一个 `secret_invalid` 伪工具，这条断言就是那个坑的探针。
 *
 * 全程**只点「测试连接」，不点「保存配置」**：既验证了"先测后存"，
 * 也不会往库里写入假密钥（测试结束不留任何脏数据）。
 */
import dotenv from 'dotenv'
import { chromium } from 'playwright'

dotenv.config()

const BASE = process.argv[2] ?? 'http://localhost:5174'
const LOGIN = process.env.INITIAL_ADMIN_LOGIN
const PASSWORD = process.env.INITIAL_ADMIN_PASSWORD
const OUT = process.env.AI_VERIFY_OUT ?? 'verify-artifacts'

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  process.stdout.write(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}\n`)
}

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } })
/**
 * 拦掉外部字体 CDN：Playwright 截图会等 `document.fonts.ready`，而 fonts.gstatic.com
 * 在受限网络下会一直挂着 → 截图报 "waiting for fonts to load" 并超时 30s。
 * 同一坑在 `verify-prompt-optimize-ui.mjs` 上踩过，处理方式保持一致。
 */
await context.route(/fonts\.(gstatic|googleapis)\.com/, (route) => route.abort())
const page = await context.newPage()

const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
})
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`))

/**
 * 外链资源被拦产生的噪声：本脚本刻意 abort 了字体 CDN（否则截图的
 * `document.fonts.ready` 会挂到超时），浏览器会据此打出**不带 URL** 的
 * `Failed to load resource: net::ERR_FAILED` —— 与产品无关。
 * 口径与 `verify-ui.mjs` / `verify-prompt-optimize-ui.mjs` 保持一致。
 */
const EXTERNAL_RESOURCE_NOISE = /^Failed to load resource: net::ERR_(CONNECTION_CLOSED|ABORTED|FAILED)$/

async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false })
}

try {
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('账号 / 邮箱').fill(LOGIN)
  await page.getByLabel('密码').fill(PASSWORD)
  await page.getByRole('button', { name: '登录' }).click()
  await page.waitForURL((url) => !url.pathname.includes('sign-in'), { timeout: 15000 })

  await page.goto(`${BASE}/admin/ai/settings`, { waitUntil: 'domcontentloaded' })
  await page.getByText('卖家精灵 MCP（外部数据工具）').waitFor({ timeout: 15000 })

  // 作用域限定在 MCP 卡片内：「测试连接」在模型接入卡里也有一个同名按钮，
  // 全局定位会命中两个（strict mode violation）。
  const mcpCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: '卖家精灵 MCP（外部数据工具）' })

  check('模型与配置页渲染出「卖家精灵 MCP」配置卡', (await mcpCard.count()) === 1)

  const endpointInput = mcpCard.locator('#mcp-endpoint')
  const secretInput = mcpCard.locator('#mcp-secret')
  await endpointInput.waitFor({ timeout: 10000 })
  check('MCP 端点默认已填好', (await endpointInput.inputValue()) === 'https://mcp.sellersprite.com/mcp', await endpointInput.inputValue())
  check('密钥输入框是密码态（不回显明文）', (await secretInput.getAttribute('type')) === 'password')
  check('存在「测试连接」按钮', (await mcpCard.getByRole('button', { name: '测试连接' }).count()) === 1)
  check('存在「同步工具」按钮', (await mcpCard.getByRole('button', { name: '同步工具' }).count()) === 1)
  check('存在「启用卖家精灵 MCP」开关', (await mcpCard.getByRole('switch', { name: '启用卖家精灵 MCP' }).count()) === 1)

  // 高级设置折叠着也要能看到当前生效值（折叠不藏信息）
  const advanced = mcpCard.getByRole('button', { name: /高级设置/ })
  check('折叠的「高级设置」行显示当前生效值', /前缀\s*\S+\s*·\s*超时\s*\d+s/.test((await advanced.innerText()) ?? ''), (await advanced.innerText())?.replace(/\s+/g, ' '))

  await shot('mcp-settings-card')

  // ── 用无效密钥做连通性测试：必须被判成"密钥不合法"，而不是"连接成功" ──
  await secretInput.fill('sj-verify-invalid-0000000000')
  await mcpCard.getByRole('button', { name: '测试连接' }).click()
  const result = mcpCard.locator('p[role="status"]')
  await result.first().waitFor({ timeout: 40000 })
  const text = (await result.first().innerText()).replace(/\s+/g, ' ')
  check('无效密钥被明确判为失败（而不是"连接成功、1 个工具"）', !text.includes('连接成功'), text)
  check('失败原因指向密钥', /密钥|不合法|auth/i.test(text), text)
  await shot('mcp-settings-test-failed')

  // ── 已保存的有效密钥：测试连接必须成功，并且工具数要如实报出来 ──
  // 这一段只在库里确实配了可用密钥时跑（未配置的环境不该因此判失败）。
  const ready = (await mcpCard.getByText('已就绪').count()) > 0
  if (!ready) {
    check('已保存有效密钥的成功路径', true, '当前未就绪，跳过（需先在页面上配置并保存密钥）')
  } else {
    // 清空输入框 → 服务端改用**已保存**的密钥，这才是不带候选参数的真实路径
    await secretInput.fill('')
    await mcpCard.getByRole('button', { name: '测试连接' }).click()
    const success = mcpCard.locator('p[role="status"]', { hasText: '连接成功' })
    const ok = await success
      .waitFor({ timeout: 60000 })
      .then(() => true)
      .catch(() => false)
    const text = ok ? (await success.first().innerText()).replace(/\s+/g, ' ') : '(未出现成功提示)'
    check('已保存的密钥测试连接成功（有效密钥不得被判成密钥不合法）', ok, text)

    const toolCount = Number((text.match(/(\d+)\s*个卖家精灵工具/) ?? [])[1] ?? 0)
    check('成功提示里带出工具数量', toolCount > 0, `${toolCount} 个`)

    // 工具开关：MCP 工具默认折叠，折痕处要能看到"已启用 x/y"（折叠不藏信息）。
    // 注意作用域 —— 工具开关在**另一张卡**（「工具开关」），不在 MCP 凭据卡里。
    const toolCard = page.locator('[data-slot="card"]').filter({ hasText: '工具开关' })
    const mcpToolsToggle = toolCard.getByRole('button', { name: /卖家精灵 MCP 工具/ })
    await mcpToolsToggle.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    const toggleText = ((await mcpToolsToggle.innerText()) ?? '').replace(/\s+/g, ' ')
    check('工具开关区出现 MCP 分组且折痕显示启用数', /已启用\s*\d+\/\d+/.test(toggleText), toggleText)

    await mcpToolsToggle.click()
    await page.waitForTimeout(500)
    // 1 个「启用卖家精灵 MCP」总开关（在 MCP 卡）+ 每个已同步工具一个开关（在工具开关卡）
    const switches = (await mcpCard.locator('button[role="switch"]').count())
      + (await toolCard.locator('button[role="switch"]').count())
    check(
      '展开后 MCP 工具逐个可停用',
      switches >= toolCount + 1,
      `${switches} 个开关（期望至少 ${toolCount + 1}）`
    )
    await shot('mcp-settings-tools-expanded')
  }

  const realErrors = consoleErrors.filter((text) => !EXTERNAL_RESOURCE_NOISE.test(text))
  check('页面无控制台错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))

  const failed = checks.filter((item) => !item.ok)
  process.stdout.write(`\n合计 ${checks.length - failed.length}/${checks.length} 通过\n`)
  process.exitCode = failed.length === 0 ? 0 : 1
} catch (error) {
  process.stdout.write(`\n✖ 验证中断：${error?.message ?? error}\n`)
  await shot('mcp-settings-error')
  process.exitCode = 1
} finally {
  await context.close()
  await browser.close()
}

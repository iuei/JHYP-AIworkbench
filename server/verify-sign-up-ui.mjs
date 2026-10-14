/**
 * 自助注册页的浏览器验收脚本（**只读**：不提交表单、不写任何业务数据）。
 *
 * 用法：
 *   node server/verify-sign-up-ui.mjs [http://localhost:5173]
 *
 * 为什么要单独跑一遍真浏览器：组件测试（vitest browser）渲染的是**组件**，
 * 覆盖不到"路由是否真的注册进 dev server、整页布局会不会白屏"。
 * 本脚本只做渲染与前端校验断言，**从不点击可提交成功的表单**，因此不会产生待审核账号。
 *
 * 与 `server/verify-page-shell.mjs` 同两条纪律：用系统 Chrome（`channel: 'chrome'`）、
 * 只在应用自身来源报错或请求失败时判失败（外部字体 CDN 的噪声要过滤）。
 */
import { chromium } from 'playwright'

const BASE = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '')
const OUT = process.env.SIGN_UP_VERIFY_OUT ?? 'verify-artifacts'

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok })
  process.stdout.write(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}\n`)
}

/*
 * ⚠️ 用文本定位而不是 getByRole('heading')：CardTitle 渲染成
 * `[data-slot="card-title"]` 的 div，不是 heading。这里踩过一次 ——
 * 定位器写错会超时，而页面其实完全正常，很容易误判成"注册页白屏"。
 */
const SIGN_UP_TITLE = '注册账号'

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
})
// 外部字体 CDN 在受限网络下会挂起，screenshot() 会一直等字体就绪（实测能卡到 30s）
await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
const page = await context.newPage()

const BASE_ORIGIN = new URL(BASE).origin
const APP_ORIGINS = [
  new RegExp(`^${BASE_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`),
  /^https?:\/\/127\.0\.0\.1:8787\//,
]
const VITE_DEP_CHURN = /\/node_modules\/\.vite\/deps\//
/* 字体 CDN 是本脚本自己 abort 的，浏览器会因此打一条通用资源错误，不是应用缺陷 */
const EXTERNAL_NOISE =
  /^Failed to load resource: net::ERR_(CONNECTION_CLOSED|ABORTED|FAILED)$/

const consoleErrors = []
const appRequestFailures = []
page.on('console', (message) => {
  if (message.type() !== 'error') return
  const text = message.text().slice(0, 300)
  if (EXTERNAL_NOISE.test(text)) return
  consoleErrors.push(text)
})
page.on('pageerror', (error) =>
  consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`)
)
page.on('requestfailed', (request) => {
  const url = request.url()
  const reason = request.failure()?.errorText ?? 'unknown'
  if (!APP_ORIGINS.some((pattern) => pattern.test(url))) return
  if (VITE_DEP_CHURN.test(url)) return
  // dev server 上跳转 / HMR 会主动中断在途模块请求，不算失败
  if (reason.includes('ERR_ABORTED')) return
  appRequestFailures.push(`${url} → ${reason}`)
})

// 1. 注册页：路由可达 + 表单完整渲染
await page.goto(`${BASE}/sign-up`, { waitUntil: 'domcontentloaded' })
await page.getByText(SIGN_UP_TITLE, { exact: true }).waitFor({ timeout: 20000 })
check('注册页可达并渲染标题', true)
await page.screenshot({ path: `${OUT}/sign-up.png`, fullPage: true })

check(
  '账号输入框可见',
  await page.getByRole('textbox', { name: '账号 / 邮箱' }).isVisible()
)
check('姓名输入框可见', await page.getByRole('textbox', { name: '姓名' }).isVisible())
check('密码输入框可见', await page.getByLabel('密码', { exact: true }).isVisible())
check(
  '确认密码输入框可见',
  await page.getByLabel('确认密码', { exact: true }).isVisible()
)
check(
  '提交按钮可见',
  await page.getByRole('button', { name: '提交注册申请' }).isVisible()
)
check('返回登录入口可见', await page.getByRole('link', { name: '返回登录' }).isVisible())

// 2. 空表单提交必须被前端校验拦住（这一步不会发任何请求）
await page.getByRole('button', { name: '提交注册申请' }).click()
await page.getByText('请输入账号或邮箱。').waitFor({ timeout: 5000 })
check('空表单提交被前端校验拦住', true)
check('仍停留在注册页（未提交成功）', page.url().endsWith('/sign-up'), page.url())

// 3. 登录页的注册入口能真的跳到注册页
await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded' })
await page.getByRole('heading', { name: '欢迎回来' }).waitFor({ timeout: 20000 })
const entry = page.getByRole('link', { name: '注册新账号' })
check('登录页出现注册入口', await entry.isVisible())
await entry.click()
await page.getByText(SIGN_UP_TITLE, { exact: true }).waitFor({ timeout: 20000 })
check('注册入口可跳转到 /sign-up', page.url().endsWith('/sign-up'), page.url())

check(
  '应用自身无控制台报错',
  consoleErrors.length === 0,
  consoleErrors.join(' | ').slice(0, 300)
)
check(
  '应用自身请求无失败',
  appRequestFailures.length === 0,
  appRequestFailures.join(' | ').slice(0, 300)
)

await browser.close()

const failed = checks.filter((item) => !item.ok)
process.stdout.write(
  `\n${failed.length === 0 ? '✔ 全部通过' : '✘ 存在失败'}：${checks.length - failed.length}/${checks.length}\n`
)
process.exit(failed.length === 0 ? 0 : 1)

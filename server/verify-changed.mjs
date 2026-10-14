/**
 * 只跑「与本次改动相关」的后端测试（`node:test` 没有内置的相关性选择，所以在这里实现）。
 *
 * 为什么要它（2026-10-14）：此前每次改完代码都习惯性跑 `pnpm run test:server`（当前 662 项），
 * 改 3 个文件却验证整个后端，收益边际、还把反馈时间从几秒拉到几十秒。
 * 全量测试的合适位置是 **CI（`.github/workflows/ci.yml`）与提交前**，不是每一次编辑之后。
 *
 * 选择规则（保守优先，宁可多跑也不漏）：
 *   1. **限深反向依赖（默认 2 跳）** —— 扫 `server/**\/*.mjs` 的 import 关系，选中「改动文件 ← 一跳
 *      ← 二跳」范围内的 `*.node-test.mjs`。这既覆盖同名测试，也覆盖"测试 → 被测模块 → 共享模块"
 *      这种真实链路；**超过 2 跳的一律不选**：实测无深度限制时，改 `knowledge.mjs` 会顺着
 *      `knowledge → tools → routes` 把十几个语义无关的测试都拉进来（import 图 ≠ 行为相关），
 *      而这类更深的下游本来就该由 CI 全量兜底；
 *   2. **契约 / 装配层直接全量** —— `server/index.mjs`（路由装配）、`*-migrations.mjs`（表结构）、
 *      `dev.mjs` / `setup.mjs`：这些一改就不是"某个模块的行为"了；
 *   3. **选不出测试就全量** —— 不许出现"没有相关测试 ⇒ 静默通过"（例：只改了没有测试的 `db.mjs`）。
 *
 * 用法：
 *   node server/verify-changed.mjs                     # 按 git 变更自动选
 *   node server/verify-changed.mjs server/ai-agent/knowledge.mjs   # 显式指定改动文件
 *   node server/verify-changed.mjs --dry-run           # 只打印选中的测试，不执行
 *   node server/verify-changed.mjs --all               # 强制全量（等价 test:server）
 *   node server/verify-changed.mjs --depth=3           # 调整反向依赖深度（默认 2）
 *
 * 前端对应命令：`pnpm run test:web:changed`（vitest --changed，走系统 Chrome 配置）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SERVER_DIR = join(ROOT, 'server')
const TEST_SUFFIX = '.node-test.mjs'
/** 改这些文件等于改契约或装配方式，直接全量（判据写在文件头注释里）。 */
const FULL_RUN_PATTERNS = [
  /(^|\/)index\.mjs$/,
  /-migrations\.mjs$/,
  /(^|\/)dev\.mjs$/,
  /(^|\/)setup\.mjs$/,
]

const args = process.argv.slice(2)
const flags = new Set(args.filter((arg) => arg.startsWith('--')))
const explicitFiles = args.filter((arg) => !arg.startsWith('--'))
/** 反向依赖深度：默认 2（一跳=直接 import 改动文件的模块，二跳=它们的调用方）。 */
const maxDepth = Math.max(1, Number(args.find((arg) => arg.startsWith('--depth='))?.split('=')[1] ?? 2) || 2)
const write = (line) => process.stdout.write(`${line}\n`)

/** 递归收集 `server/**\/*.mjs`（跳过 node_modules 与隐藏目录）。 */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.mjs')) out.push(full)
  }
  return out
}

/** 解析一个文件里的相对 import / 动态 import（只认 `./` 与 `../` 开头的字面量）。 */
function parseImports(file) {
  const source = readFileSync(file, 'utf8')
  const deps = new Set()
  const specifier = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g
  let match
  while ((match = specifier.exec(source)) !== null) {
    const target = resolve(dirname(file), match[1])
    if (existsSync(target)) deps.add(target)
    else if (existsSync(`${target}.mjs`)) deps.add(`${target}.mjs`)
  }
  return deps
}

function gitLines(gitArgs) {
  const result = spawnSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' })
  if (result.status !== 0) return []
  return String(result.stdout ?? '')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    // 只丢空行，**不要 trim 行首**：porcelain 的 " M path" 前导空格是状态位的一部分，
    // trim 掉会让后面的 slice(3) 再多吃一个字符（实测把 server/ 解析成 erver/）
    .filter((line) => line.trim().length > 0)
}

/** git 变更（含未跟踪文件）；返回仓库相对路径。 */
function changedPaths() {
  const paths = new Set()
  for (const line of gitLines(['status', '--porcelain', '-uall'])) {
    // " M path" / "?? path" / "R  old -> new"
    let value = line.slice(3).trim()
    if (value.includes(' -> ')) value = value.split(' -> ').pop().trim()
    paths.add(value.replace(/^"|"$/g, ''))
  }
  for (const line of gitLines(['diff', '--name-only', 'HEAD'])) paths.add(line)
  return [...paths]
}

const allFiles = walk(SERVER_DIR)
const fileSet = new Set(allFiles)
const graph = new Map(allFiles.map((file) => [file, parseImports(file)]))
const importers = new Map()
for (const [file, deps] of graph) {
  for (const dep of deps) {
    if (!importers.has(dep)) importers.set(dep, new Set())
    importers.get(dep).add(file)
  }
}

function dependentsOf(seeds, maxDepth) {
  const seen = new Set(seeds)
  let frontier = [...seeds]
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next = []
    for (const current of frontier) {
      for (const importer of importers.get(current) ?? []) {
        if (seen.has(importer)) continue
        seen.add(importer)
        next.push(importer)
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }
  return seen
}

const allTests = allFiles.filter((file) => file.endsWith(TEST_SUFFIX)).sort()
function runFull(reason) {
  write(`[test:changed] ${reason}`)
  write(`[test:changed] 回退到后端全量（${allTests.length} 个测试文件）`)
  if (flags.has('--dry-run')) return []
  return allTests
}
function runTests(tests) {
  if (tests.length === 0) return
  write(`[test:changed] 执行 ${tests.length} 个测试文件…\n`)
  const testArgs = ['--test']
  /*
   * 兜底开关（Node ≥ 22 才有）：测试若留下未清理的 handle，`node --test` 会一直等事件循环清空，
   * 表现为"测试全绿但干等 30 秒"——2026-10-14 实测过一次（编排层单测连了数据库，被 pg 连接池的
   * idleTimeoutMillis: 30000 吊住，全量 30.5s → 0.6s）。**根因该修**（那次已在
   * `orchestrator.node-test.mjs` 里 mock 掉 `loadDatasetCoverage`），这里只是防止再次回归。
   * CI 用 Node 20，不支持该参数，故按版本判断。
   */
  if (Number(process.versions.node.split('.')[0]) >= 22) testArgs.push('--test-force-exit')
  testArgs.push(...tests.map((file) => relative(ROOT, file)))
  const result = spawnSync(process.execPath, testArgs, { cwd: ROOT, stdio: 'inherit' })
  process.exit(result.status ?? 1)
}

let selected = []
let reason = ''

if (flags.has('--all')) {
  selected = runFull('--all：按要求强制全量')
} else {
  const rawChanged =
    explicitFiles.length > 0 ? explicitFiles : changedPaths()
  const changedServer = []
  const changedOther = []
  for (const rel of rawChanged) {
    const abs = resolve(ROOT, rel)
    if (!abs.startsWith(SERVER_DIR + sep)) {
      if (rel.endsWith('.mjs') || rel.endsWith('.ts') || rel.endsWith('.tsx')) changedOther.push(rel)
      continue
    }
    changedServer.push(abs)
  }

  const contractFile = changedServer.find((file) => FULL_RUN_PATTERNS.some((re) => re.test(file)))
  if (changedServer.length === 0) {
    selected = runFull('没有检测到 server/ 下的 .mjs 改动')
  } else if (contractFile) {
    selected = runFull(`改到了契约 / 装配层（${relative(ROOT, contractFile)}）`)
  } else {
    write('[test:changed] 本次后端改动：')
    for (const file of changedServer) write(`  - ${relative(ROOT, file)}`)
    const missing = changedServer.filter((file) => !fileSet.has(file))
    for (const file of missing) write(`  ! ${relative(ROOT, file)} 不在 server/ 源码树内（按未选中处理）`)

    const dependents = dependentsOf(
      changedServer.filter((file) => fileSet.has(file)),
      maxDepth
    )
    const tests = [...dependents]
      .filter((file) => file.endsWith(TEST_SUFFIX))
      .sort()
    // 改的本身就是测试文件时直接跑它
    for (const file of changedServer) {
      if (file.endsWith(TEST_SUFFIX) && !tests.includes(file)) tests.push(file)
    }

    if (tests.length === 0) {
      selected = runFull(`改动文件在 ${maxDepth} 跳内没有任何依赖它的后端测试`)
    } else {
      write(`[test:changed] 选中的相关测试（反向依赖 ≤ ${maxDepth} 跳）：`)
      for (const file of tests) write(`  ✔ ${relative(ROOT, file)}`)
      write(
        `[test:changed] 更深的依赖下游不在这里跑：全量后端测试交给 CI` +
          `（.github/workflows/ci.yml 的 test:server）或提交前 \`pnpm run test:server\`，不必每次改完都跑`
      )
      selected = flags.has('--dry-run') ? [] : tests
    }
  }

  if (changedOther.length > 0) {
    write('[test:changed] 另有非 server 改动，前端相关测试请跑：pnpm run test:web:changed')
    for (const file of changedOther.slice(0, 5)) write(`  · ${file}`)
  }
}

runTests(selected)

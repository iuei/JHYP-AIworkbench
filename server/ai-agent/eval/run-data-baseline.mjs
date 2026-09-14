/**
 * 场景二 / 场景三验收执行器（需求文档 A2 / A3 / A4）。
 *
 * 核心思路：**用服务端真值校验模型的转述**
 * - 真值由同一套 analytics/data-queries 代码算出（即回答所依据的那份计算）；
 * - 断言模型回答里出现了这些关键数字、调用了正确的工具、回答里带了对应结构化块与时效声明；
 * - 负样本要求明确回答"没有数据"，不允许出现任何看起来像数据的数字。
 *
 * 这样"归因主因是否一致"就有了可复核的机器证据，人工只需复核结论表述。
 *
 * 用法：node server/ai-agent/eval/run-data-baseline.mjs [baseUrl] [--label=xxx]
 * 报告：server/ai-agent/eval/reports/<时间戳>-data-baseline[-label].md
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  amazonPerformancePayload,
  anomalyScanPayload,
  inventoryOrdersPayload,
  inventoryRiskPayload,
  marketplacePerformancePayload,
} from '../data-queries.mjs'
import { pool } from '../../db.mjs'
import { createClient } from './client.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPORT_DIR = path.join(HERE, 'reports')
const QUESTION_SET = path.join(HERE, 'data-question-set.json')

function parseArgs(argv) {
  const options = { base: undefined, label: null }
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--label=')) options.label = arg.slice(8)
    else if (/^https?:\/\//.test(arg)) options.base = arg
  }
  return options
}

function pick(object, dottedPath) {
  return dottedPath.split('.').reduce((acc, key) => (acc == null ? null : acc[key]), object)
}

/** 算出该题的服务端真值，并给出可接受的数字写法（容忍四舍五入与千分位）。 */
async function computeTruth(item) {
  if (!item.truth) return { numbers: [] }
  const { type, params, fields } = item.truth

  if (type === 'amazon') {
    const payload = await amazonPerformancePayload(params)
    const analysis = payload.analysis ?? {}
    // current / decomposition 都相对 analysis 解析：题目集里的 current.acos 即 analysis.current.acos
    const context = { current: analysis.current ?? null, decomposition: analysis.decomposition ?? null }
    const numbers = fields.map((field) => ({
      label: field.from,
      value: pick(context, field.from),
      alternatives: numericAlternatives(pick(context, field.from), field.digits),
    }))
    return { numbers, payload }
  }

  if (type === 'marketplace') {
    const payload = await marketplacePerformancePayload(params)
    const numbers = fields.map((field) => ({
      label: field.from,
      value: pick(payload.analysis, field.from),
      alternatives: numericAlternatives(pick(payload.analysis, field.from), field.digits),
    }))
    return { numbers, payload }
  }

  if (type === 'scan') {
    const payload = await anomalyScanPayload(params)
    const context = {
      scan: payload.analysis?.scan ?? null,
      flagged: payload.analysis?.flagged ?? [],
    }
    const numbers = fields.map((field) => ({
      label: field.from,
      value: pick(context, field.from),
      alternatives: numericAlternatives(pick(context, field.from), field.digits),
    }))
    return { numbers, payload }
  }

  if (type === 'inventory-risk') {
    const payload = await inventoryRiskPayload(params)
    const context = { sum: payload.analysis?.summary ?? null, items: payload.analysis?.items ?? [] }
    const numbers = fields.map((field) => ({
      label: field.from,
      value: pick(context, field.from),
      alternatives: numericAlternatives(pick(context, field.from), field.digits),
    }))
    return { numbers, payload }
  }

  if (type === 'inventory') {
    const payload = await inventoryOrdersPayload(params)
    const sum = (payload.blocks[0]?.items ?? []).reduce((acc, entry) => {
      acc[entry.key] = entry.value
      return acc
    }, {})
    const orderBlock = payload.blocks.find((block) => block.kind === 'table' && block.title === '最近订单')
    const context = { sum, orderCount: orderBlock?.rows?.length ?? 0 }
    const numbers = fields.map((field) => ({
      label: field.from,
      value: pick(context, field.from),
      alternatives: numericAlternatives(pick(context, field.from), field.digits),
    }))
    return { numbers, payload }
  }

  return { numbers: [] }
}

/**
 * 生成一个数字的若干可接受写法。
 *
 * 实测教训：模型会写 `6,427.95`（千分位 + 两位小数），而早期只生成了 `6428` / `6427.95`，
 * 于是把"模型答对"误判成"数字不一致"。这里把常见写法都列上：
 * 纯数字、千分位、以及 2/1/0 三种小数位下的两种格式。
 */
function numericAlternatives(value, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return []
  const number = Number(value)
  const options = new Set()
  for (const scale of new Set([digits, 2, 1, 0])) {
    const fixed = number.toFixed(scale)
    options.add(fixed)
    options.add(fixed.replace(/\.0+$/, ''))
    options.add(number.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: scale }))
  }
  options.add(String(number))
  options.add(String(Math.round(number)))
  return [...options].filter((option) => option && option !== '-' && /\d/.test(option))
}

function textHasNumber(text, alternatives) {
  return alternatives.some((candidate) => {
    if (!candidate) return false
    // 用非数字边界包裹，避免 "32" 命中 "320"
    const pattern = new RegExp(`(?<![\\d.])${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\d])`)
    return pattern.test(text)
  })
}

async function main() {
  const options = parseArgs(process.argv)
  const client = createClient(options.base)
  const adminToken = await client.loginAdmin()
  const { provider } = await client.providerInfo(adminToken)
  const operator = await client.ensureOperator({ adminToken })

  if (provider.mode !== 'live') {
    process.stdout.write(
      `⚠️ 当前 provider 为 ${provider.mode}（演示模式）。本项验收必须在真实模型下执行才有意义。\n`
    )
  }

  const questionSet = JSON.parse(await readFile(QUESTION_SET, 'utf8'))
  const rows = []

  process.stdout.write(`场景二/三验收：${questionSet.questions.length} 题，provider=${provider.mode}\n\n`)

  for (const item of questionSet.questions) {
    const truth = await computeTruth(item)
    const result = await client.streamChat(operator.token, { content: item.question })
    const done = result.events.find((event) => event.type === 'done')?.data ?? null
    const answer = result.answer
    const toolRuns = done?.toolRuns ?? []
    const calledTools = [...new Set(toolRuns.map((run) => run.toolName))]
    const blocks = done?.blocks ?? []
    const blockKinds = [...new Set(blocks.map((block) => block.kind))]

    // 允许一题匹配多个工具：有些问题两个工具都能正确回答（如"哪个 ASIN ACoS 最高"），
    // 强求唯一工具会把"模型选得合理"误判为失败
    const acceptableTools = item.expectedToolsAny ?? [item.expectedTool].filter(Boolean)
    const toolOk = acceptableTools.some((name) => calledTools.includes(name))
    const blocksOk = (item.expectBlocks ?? []).every((kind) => blockKinds.includes(kind))
    const numbersOk =
      truth.numbers.length === 0 ||
      truth.numbers.every((entry) => textHasNumber(answer, entry.alternatives))
    const keywordsOk = (item.expectKeywords ?? []).every((keyword) => answer.includes(keyword))
    const noDataOk = !item.expectNoData
      ? true
      : /(没有|未找到|暂无|不存在)/.test(answer) &&
        // 负样本里不应出现带小数或千分位的"像数据的数字"
        !/\d+\.\d+|\d{1,3}(,\d{3})+/.test(answer)
    const freshnessOk = /数据(来源|截至|覆盖)|导入于/.test(answer)

    const checks = {
      toolOk,
      acceptableTools,
      blocksOk,
      numbersOk,
      keywordsOk,
      noDataOk,
      freshnessOk,
    }
    const passed = Object.values(checks).every(Boolean)
    rows.push({
      id: item.id,
      scenario: item.scenario,
      question: item.question,
      answer,
      calledTools,
      blockKinds,
      truth: truth.numbers.map((entry) => ({ label: entry.label, value: entry.value })),
      checks,
      passed,
      latencyMs: result.totalMs,
      tokensOut: done?.tokensOut ?? null,
      humanVerdict: null,
    })

    const mark = (value) => (value ? '✔' : '✘')
    process.stdout.write(
      `${item.id} ${passed ? '✔' : '✘'} 工具${mark(toolOk)} 块${mark(blocksOk)} 数字${mark(numbersOk)} 关键词${mark(keywordsOk)} 负样本${mark(noDataOk)} 时效${mark(freshnessOk)}  ${result.totalMs}ms\n`
    )
    if (!numbersOk && truth.numbers.length > 0) {
      process.stdout.write(
        `     真值：${truth.numbers.map((entry) => `${entry.label}=${entry.value}`).join('，')}\n`
      )
    }
  }

  const metrics = {
    题目数: rows.length,
    工具调用正确率: percent(rows.filter((row) => row.checks.toolOk).length, rows.length),
    结构化块齐全率: percent(rows.filter((row) => row.checks.blocksOk).length, rows.length),
    关键数字一致率: percent(rows.filter((row) => row.checks.numbersOk).length, rows.length),
    时效声明率: percent(rows.filter((row) => row.checks.freshnessOk).length, rows.length),
    负样本正确率: percent(
      rows.filter((row) => row.checks.noDataOk).length,
      rows.filter((row) => row.checks.noDataOk !== undefined).length
    ),
    端到端中位数ms: median(rows.map((row) => row.latencyMs)),
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const label = options.label ? `-${options.label}` : ''
  const baseName = `${stamp}-data-baseline${label}`
  await mkdir(REPORT_DIR, { recursive: true })
  await writeFile(
    path.join(REPORT_DIR, `${baseName}.json`),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), base: client.base, provider, metrics, questions: rows }, null, 2)}\n`
  )
  await writeFile(path.join(REPORT_DIR, `${baseName}.md`), renderMarkdown({ provider, metrics, rows }))

  process.stdout.write('\n────────── 场景二/三指标 ──────────\n')
  for (const [key, value] of Object.entries(metrics)) {
    process.stdout.write(`${key}：${key.includes('率') ? `${value}%` : value}\n`)
  }
  process.stdout.write(
    `\n报告：server/ai-agent/eval/reports/${baseName}.md（含「人工判定」空列，供复核归因主因是否与人工结论一致）\n`
  )
}

function percent(numerator, denominator) {
  if (!denominator) return null
  return Number(((numerator / denominator) * 100).toFixed(1))
}

function median(values) {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (list.length === 0) return null
  const middle = Math.floor(list.length / 2)
  return list.length % 2 === 0 ? Math.round((list[middle - 1] + list[middle]) / 2) : list[middle]
}

function renderMarkdown({ provider, metrics, rows }) {
  const lines = [
    '# 场景二 / 场景三验收报告（自动生成）',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- Provider：\`${provider.name}\` / \`${provider.model}\`，mode = **${provider.mode}**`,
    '',
    '> 真值由服务端 analytics 代码算出；「关键数字一致率」校验模型是否如实转述这些数字（防止编造）。',
    '> 人工需复核：归因主因是否与人工结论一致（A2 ≥ 3/5、A4 正确率 ≥ 90%）。',
    '',
    '## 指标',
    '',
    '| 指标 | 值 |',
    '| --- | --- |',
  ]
  for (const [key, value] of Object.entries(metrics)) {
    lines.push(`| ${key} | ${key.includes('率') ? `${value}%` : value} |`)
  }
  lines.push(
    '',
    '## 逐题结果',
    '',
    '| ID | 场景 | 工具 | 结构化块 | 真值 | 通过 | 人工判定 |',
    '| --- | --- | --- | --- | --- | --- | --- |'
  )
  for (const row of rows) {
    lines.push(
      `| ${row.id} | ${row.scenario} | ${row.calledTools.join('/') || '—'} | ${row.blockKinds.join('+') || '—'} | ${
        row.truth.map((entry) => `${entry.label}=${entry.value}`).join('；') || '—'
      } | ${row.passed ? '✔' : '✘'} |  |`
    )
  }
  lines.push('', '## 回答原文', '')
  for (const row of rows) {
    lines.push(`### ${row.id} ${row.question}`, '', `- 调用工具：${row.calledTools.join(', ') || '无'}`, `- 结构化块：${row.blockKinds.join(', ') || '无'}`, '', '```text', row.answer.slice(0, 1500), '```', '')
  }
  return `${lines.join('\n')}\n`
}

try {
  await main()
} finally {
  await pool.end()
}

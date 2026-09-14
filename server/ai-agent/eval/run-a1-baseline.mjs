/**
 * A1 基线执行器（需求文档 A1：Top 20 高频真实问题，答案正确且有出处 ≥ 80%）。
 *
 * 关键设计：把 A1 拆成两半，其中一半**不需要模型 Key** 就能测——
 *   ① 检索半边（现在就能测）：是否检索到内容、是否引用到预期文档、空检索率、预期文档召回率
 *   ② 回答半边（需要真实模型）：答案是否正确、是否编造 → 由人工按 humanVerdict 判定
 * 演示 provider 下只输出①，并明确标注②不可判。
 *
 * 用法：
 *   node server/ai-agent/eval/seed-fixtures.mjs                 # 先灌评测夹具（可选）
 *   node server/ai-agent/eval/run-a1-baseline.mjs [baseUrl] [--topk=5] [--limit=25]
 *
 * 产出：eval/reports/<时间戳>-a1-baseline.json 与 .md（含人工判定空列）
 * 只应在本地开发库执行（会写入会话与审计数据）。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from './client.mjs'
import { loadFixtures } from './seed-fixtures.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPORT_DIR = path.join(HERE, 'reports')
const QUESTION_SET = path.join(HERE, 'a1-question-set.json')

function parseArgs(argv) {
  const options = { base: undefined, topK: null, limit: null, label: null }
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--topk=')) options.topK = Number(arg.slice(7))
    else if (arg.startsWith('--limit=')) options.limit = Number(arg.slice(8))
    else if (arg.startsWith('--label=')) options.label = arg.slice(8)
    // 只把看起来像地址的参数当作 base，避免 `--label pre-live` 这类写法把 base 覆盖掉
    else if (!arg.startsWith('--') && /^https?:\/\//.test(arg)) options.base = arg
  }
  return options
}

function percent(numerator, denominator) {
  if (!denominator) return null
  return Number(((numerator / denominator) * 100).toFixed(1))
}

function formatPercent(value) {
  return value === null ? '—' : `${value}%`
}

/** 判断引用里是否命中预期文档（按夹具 key 或标题片段匹配）。 */
function matchExpectedDocs(citations, expectedDocs, fixtureTitles) {
  if (expectedDocs.length === 0) return null
  const hits = []
  for (const citation of citations) {
    const title = String(citation.title ?? '')
    for (const expected of expectedDocs) {
      const fixtureTitle = fixtureTitles.get(expected) ?? expected
      if (title.includes(fixtureTitle) || title === expected || title.includes(expected)) {
        hits.push(expected)
      }
    }
  }
  return [...new Set(hits)]
}

async function main() {
  const options = parseArgs(process.argv)
  const client = createClient(options.base)
  const adminToken = await client.loginAdmin()
  const { provider, tools } = await client.providerInfo(adminToken)
  const operator = await client.ensureOperator({ adminToken })

  const fixtures = await loadFixtures()
  const fixtureTitles = new Map(fixtures.map((fixture) => [fixture.key, fixture.title]))

  const questionSet = JSON.parse(await readFile(QUESTION_SET, 'utf8'))
  const questions = options.limit
    ? questionSet.questions.slice(0, options.limit)
    : questionSet.questions

  const live = provider.mode === 'live'
  process.stdout.write(`A1 基线开始：${questions.length} 个问题\n`)
  process.stdout.write(`目标：${client.base}\n`)
  process.stdout.write(
    `Provider：${provider.name} / ${provider.model}，mode=${provider.mode}${live ? '' : '（演示模式：答案质量不可判定，仅检索指标有效）'}\n`
  )
  process.stdout.write(`可用工具：${tools.map((tool) => tool.name).join(', ')}\n\n`)

  const rows = []
  for (const [index, item] of questions.entries()) {
    const result = await client.streamChat(operator.token, { content: item.question })
    const done = result.events.find((event) => event.type === 'done')?.data ?? null
    const citations = done?.citations ?? []
    const runs = done?.toolRuns ?? []
    const searchRun = runs.find((run) => run.toolName === 'search_knowledge') ?? null
    const matched = matchExpectedDocs(citations, item.expectedDocs ?? [], fixtureTitles)
    const blocked = done?.status === 'blocked'
    const noResult = /知识库中未找到相关内容/.test(result.answer)

    const row = {
      id: item.id,
      category: item.category,
      question: item.question,
      expectedDocs: item.expectedDocs ?? [],
      expectedNoResult: Boolean(item.expectedNoResult),
      expectedBlocked: Boolean(item.expectedBlocked),
      status: done?.status ?? 'failed',
      answer: result.answer,
      answerExcerpt: result.answer.replace(/\s+/g, ' ').slice(0, 160),
      citationCount: citations.length,
      citedTitles: [...new Set(citations.map((citation) => citation.title))],
      matchedDocs: matched,
      searchRows: searchRun?.rowCount ?? null,
      toolNames: [...new Set(runs.map((run) => run.toolName))],
      blocked,
      noResult,
      firstDeltaMs: result.firstDeltaMs,
      totalMs: result.totalMs,
      tokensIn: done?.tokensIn ?? null,
      tokensOut: done?.tokensOut ?? null,
      humanVerdict: null,
      humanNote: null,
    }
    rows.push(row)

    const flag = item.expectedBlocked
      ? blocked
        ? '✔拦截'
        : '✘未拦截'
      : item.expectedNoResult
        ? noResult
          ? '✔未找到'
          : '✘未声明未找到'
        : matched === null
          ? '—'
          : matched.length > 0
            ? `✔命中(${matched.join('/')})`
            : '✘未命中预期文档'
    process.stdout.write(
      `${String(index + 1).padStart(2)}/${questions.length} ${item.id} ${flag} 引用${citations.length}条 检索${searchRun?.rowCount ?? 0}片段 ${result.firstDeltaMs ?? '—'}ms\n`
    )
  }

  // ── 指标计算
  const answerable = rows.filter((row) => !row.expectedBlocked)
  const withExpectation = answerable.filter((row) => row.expectedDocs.length > 0)
  const negative = rows.filter((row) => row.expectedNoResult)
  const blockedCases = rows.filter((row) => row.expectedBlocked)

  const metrics = {
    问题数: rows.length,
    引用了文档的比例: percent(
      answerable.filter((row) => row.citationCount > 0).length,
      answerable.length
    ),
    预期文档召回率: percent(
      withExpectation.filter((row) => (row.matchedDocs ?? []).length > 0).length,
      withExpectation.length
    ),
    空检索比例: percent(
      answerable.filter((row) => row.noResult || row.searchRows === 0).length,
      answerable.length
    ),
    越权拦截率: percent(blockedCases.filter((row) => row.blocked).length, blockedCases.length),
    负样本正确声明率: percent(negative.filter((row) => row.noResult).length, negative.length),
    首字延迟中位数ms: median(answerable.map((row) => row.firstDeltaMs).filter(Boolean)),
    首字延迟P90ms: percentile(answerable.map((row) => row.firstDeltaMs).filter(Boolean), 90),
    端到端耗时中位数ms: median(answerable.map((row) => row.totalMs)),
    token输入合计: rows.reduce((total, row) => total + (row.tokensIn ?? 0), 0),
    token输出合计: rows.reduce((total, row) => total + (row.tokensOut ?? 0), 0),
    答案正确率: null,
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const label = options.label ? `-${options.label}` : ''
  const baseName = `${stamp}-a1-baseline${label}${options.topK ? `-topk${options.topK}` : ''}`
  await mkdir(REPORT_DIR, { recursive: true })

  const report = {
    generatedAt: new Date().toISOString(),
    base: client.base,
    provider,
    topK: options.topK,
    metrics,
    questions: rows,
  }
  await writeFile(path.join(REPORT_DIR, `${baseName}.json`), `${JSON.stringify(report, null, 2)}\n`)

  const markdown = renderMarkdown(report, { live })
  await writeFile(path.join(REPORT_DIR, `${baseName}.md`), markdown)

  process.stdout.write('\n────────── A1 基线指标 ──────────\n')
  for (const [key, value] of Object.entries(metrics)) {
    if (value === null) continue
    process.stdout.write(
      `${key}：${typeof value === 'number' && key.includes('比例') ? formatPercent(value) : value}${typeof value === 'number' && key.includes('率') ? '%' : ''}\n`
    )
  }
  if (!live) {
    process.stdout.write(
      '\n⚠️ 当前为演示模式：答案正确率（A1 通过线 ≥ 80%）必须在接入真实模型后由业务同事人工判定。\n'
    )
  }
  process.stdout.write(`\n报告：server/ai-agent/eval/reports/${baseName}.md\n`)
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle]
}

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index]
}

function renderMarkdown(report, { live }) {
  const { metrics, provider, questions } = report
  const lines = [
    '# A1 基线报告（自动生成）',
    '',
    `- 生成时间：${report.generatedAt}`,
    `- 目标环境：${report.base}`,
    `- Provider：\`${provider.name}\` / \`${provider.model}\`，mode = **${provider.mode}**`,
    `- 参数：topK = ${report.topK ?? '服务端默认'}，问题数 = ${questions.length}`,
    '',
    live
      ? '> 已接入真实模型，请业务同事填写下方「人工判定」列，并按 `答案正确且有出处 ≥ 80%` 计算 A1 结论。'
      : '> **演示模式**：回答由知识库检索结果模板汇总，**答案正确率不可判定**；本报告的检索指标（引用率、召回率、空检索率、拦截率）仍然有效，可作为接入模型前的对照基线。',
    '',
    '## 自动指标',
    '',
    '| 指标 | 值 |',
    '| --- | --- |',
  ]
  for (const [key, value] of Object.entries(metrics)) {
    if (value === null) continue
    lines.push(`| ${key} | ${key.includes('比例') || key.includes('率') ? formatPercent(value) : value} |`)
  }
  lines.push(
    '',
    '## 逐题明细',
    '',
    '人工判定列取值：`correct`（正确且有出处）/ `partial`（部分正确）/ `wrong`（错误）/ `hallucinated`（编造）/ `cannot-judge`（无法判定）',
    '',
    '| ID | 分类 | 问题 | 期望文档 | 引用数 | 命中预期 | 检索片段 | 状态 | 首字ms | 耗时ms | 人工判定 | 备注 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
  )
  for (const row of questions) {
    lines.push(
      `| ${row.id} | ${row.category} | ${row.question} | ${row.expectedDocs.join('/') || '—'} | ${row.citationCount} | ${
        row.matchedDocs === null ? '—' : row.matchedDocs.length ? `✔ ${row.matchedDocs.join('/')}` : '✘'
      } | ${row.searchRows ?? '—'} | ${row.status}${row.blocked ? '(拦截)' : ''}${row.noResult ? '(未找到)' : ''} | ${
        row.firstDeltaMs ?? '—'
      } | ${row.totalMs} |  |  |`
    )
  }
  lines.push('', '## 回答摘录', '')
  for (const row of questions) {
    lines.push(`### ${row.id} ${row.question}`, '', `- 引用：${row.citedTitles.join('；') || '无'}`, '', '```text', row.answerExcerpt, '```', '')
  }
  return `${lines.join('\n')}\n`
}

await main()

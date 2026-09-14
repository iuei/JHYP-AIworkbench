/**
 * 检索参数对照实验（不需要模型 Key、不需要重启服务）。
 *
 * 直接在本进程调用 knowledge.searchKnowledge，扫描「相关性下限 + topK + 切片参数」，
 * 用 A1 问题集给出召回率 / 空检索率 / 负样本正确率，用来选定参数而不是凭感觉调。
 *
 * 用法：
 *   node server/ai-agent/eval/compare-retrieval.mjs
 *   node server/ai-agent/eval/compare-retrieval.mjs --coverage=0,0.2,0.3,0.4 --topk=3,5,10
 *   node server/ai-agent/eval/compare-retrieval.mjs --rechunk=800/100,1200/150   # 需配合 --fixtures 重灌
 *   node server/ai-agent/eval/compare-retrieval.mjs --fixtures=800/100           # 按切片参数重灌夹具后再测
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { pool, query } from '../../db.mjs'
import { chunkText, searchKnowledge } from '../knowledge.mjs'
import { loadFixtures } from './seed-fixtures.mjs'

dotenv.config()

const HERE = path.dirname(fileURLToPath(import.meta.url))
const QUESTION_SET = path.join(HERE, 'a1-question-set.json')

function parseArgs(argv) {
  const options = { coverage: [0, 0.2, 0.3, 0.4], topK: [3, 5, 10], rechunk: null, fixtures: null }
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--coverage=')) options.coverage = arg.slice(11).split(',').map(Number)
    else if (arg.startsWith('--topk=')) options.topK = arg.slice(7).split(',').map(Number)
    else if (arg.startsWith('--rechunk=')) options.rechunk = arg.slice(10).split(',')
    else if (arg.startsWith('--fixtures=')) options.fixtures = arg.slice(11).split(',')
  }
  return options
}

function parseChunkSpec(spec) {
  const [size, overlap] = spec.split('/').map(Number)
  return { spec, size, overlap }
}

const percent = (numerator, denominator) =>
  denominator === 0 ? null : Number(((numerator / denominator) * 100).toFixed(1))

/** 用指定切片参数重灌评测夹具（以 eval-fixture-rechunk 为标记，与正式夹具隔离）。 */
async function rechunkFixtures(chunkOptions) {
  const fixtures = await loadFixtures()
  const client = await pool.connect()
  const summary = { documents: 0, chunks: 0 }
  try {
    await client.query('BEGIN')
    await client.query(
      `DELETE FROM ai_documents WHERE source_ref LIKE 'eval-rechunk:%'`
    )
    for (const fixture of fixtures) {
      const chunks = chunkText(fixture.content, chunkOptions)
      const doc = await client.query(
        `INSERT INTO ai_documents
           (title, source_type, source_ref, category, status, chunk_count, data_scope, created_by)
         VALUES ($1, 'upload', $2, '评测夹具-切片实验', 'active', $3, '{}'::jsonb, NULL)
         RETURNING id`,
        [`[切片实验] ${fixture.title}`, `eval-rechunk:${fixture.key}`, chunks.length]
      )
      for (const [index, content] of chunks.entries()) {
        await client.query(
          `INSERT INTO ai_chunks (document_id, chunk_index, content, token_count)
           VALUES ($1, $2, $3, $4)`,
          [doc.rows[0].id, index, content, Math.ceil(content.length / 1.5)]
        )
      }
      summary.documents += 1
      summary.chunks += chunks.length
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
  return summary
}

/** 评测用的最小用户对象（走 canSeeDocument 的同一套可见性规则）。 */
const EVAL_USER = { id: 1, login: 'retrieval-eval', role: 'admin', status: 'enabled' }

async function evaluate({ coverage, topK, fixtures }) {
  const questionSet = JSON.parse(await readFile(QUESTION_SET, 'utf8'))
  const rows = []
  const startedAt = Date.now()

  for (const item of questionSet.questions) {
    if (item.expectedBlocked || item.expectedNoResult) {
      // 只关心检索的题目之外，负样本用于衡量"不乱召回"
    }
    const result = await searchKnowledge({
      user: EVAL_USER,
      searchText: item.question,
      topK,
      minCoverage: coverage,
    })
    const titles = result.rows.map((row) => row.title)
    const matched = (item.expectedDocs ?? []).filter((key) =>
      titles.some((title) => title.includes(fixtureTitleOf(key, fixtures)))
    )
    rows.push({
      id: item.id,
      expectedDocs: item.expectedDocs ?? [],
      expectedNoResult: Boolean(item.expectedNoResult),
      expectedBlocked: Boolean(item.expectedBlocked),
      rowCount: result.rows.length,
      titles,
      matched,
    })
  }

  const answerable = rows.filter((row) => !row.expectedBlocked && !row.expectedNoResult)
  const withExpectation = answerable.filter((row) => row.expectedDocs.length > 0)
  const negative = rows.filter((row) => row.expectedNoResult)

  return {
    coverage,
    topK,
    metrics: {
      召回率: percent(
        withExpectation.filter((row) => row.matched.length > 0).length,
        withExpectation.length
      ),
      平均返回片段数: Number(
        (answerable.reduce((total, row) => total + row.rowCount, 0) / answerable.length).toFixed(2)
      ),
      空检索率: percent(
        answerable.filter((row) => row.rowCount === 0).length,
        answerable.length
      ),
      负样本正确空返回率: percent(
        negative.filter((row) => row.rowCount === 0).length,
        negative.length
      ),
    },
    misses: withExpectation.filter((row) => row.matched.length === 0).map((row) => row.id),
    negativeHits: negative.filter((row) => row.rowCount > 0).map((row) => row.id),
    elapsedMs: Date.now() - startedAt,
  }
}

function fixtureTitleOf(key, fixtures) {
  return fixtures.get(key) ?? key
}

async function main() {
  const options = parseArgs(process.argv)
  const fixtures = await loadFixtures()
  const fixtureTitles = new Map(fixtures.map((fixture) => [fixture.key, fixture.title]))

  if (options.rechunk || options.fixtures) {
    for (const spec of [...(options.fixtures ?? []), ...(options.rechunk ?? [])]) {
      const chunkOptions = parseChunkSpec(spec)
      const summary = await rechunkFixtures(chunkOptions)
      process.stdout.write(
        `切片重灌 ${spec}：${summary.documents} 篇 / ${summary.chunks} 个切片（source_ref 前缀 eval-rechunk:）\n`
      )
    }
  }

  // 只统计正式夹具（eval-fixture:）时结果最干净；含切片实验文档时单独说明
  const counts = await query(
    `SELECT
       COUNT(*) FILTER (WHERE source_ref LIKE 'eval-fixture:%' AND status = 'active') AS fixture_docs,
       COUNT(*) FILTER (WHERE source_ref LIKE 'eval-rechunk:%') AS rechunk_docs,
       (SELECT COUNT(*) FROM ai_documents WHERE status = 'active') AS active_docs
     FROM ai_documents`
  )
  const stats = counts.rows[0]
  process.stdout.write(
    `知识库现状：生效文档 ${stats.active_docs} 篇（正式夹具 ${stats.fixture_docs} / 切片实验 ${stats.rechunk_docs}）\n\n`
  )

  const results = []
  for (const coverage of options.coverage) {
    for (const topK of options.topK) {
      const result = await evaluate({ coverage, topK, fixtures: fixtureTitles })
      results.push(result)
      process.stdout.write(
        `coverage=${coverage} topK=${topK} → 召回 ${result.metrics.召回率}% · 平均片段 ${result.metrics.平均返回片段数} · 空检索 ${result.metrics.空检索率}% · 负样本空返回 ${result.metrics.负样本正确空返回率}%` +
          `${result.misses.length ? ` · 未召回 ${result.misses.join(',')}` : ''}` +
          `${result.negativeHits.length ? ` · 负样本误召 ${result.negativeHits.join(',')}` : ''}\n`
      )
    }
  }

  const best = [...results].sort(
    (a, b) =>
      (b.metrics.召回率 ?? 0) - (a.metrics.召回率 ?? 0) ||
      (b.metrics.负样本正确空返回率 ?? 0) - (a.metrics.负样本正确空返回率 ?? 0)
  )[0]
  process.stdout.write(
    `\n建议：coverage=${best.coverage}、topK=${best.topK}（召回 ${best.metrics.召回率}%，负样本空返回 ${best.metrics.负样本正确空返回率}%）\n`
  )
  process.stdout.write(
    '选定后写入 .env 的 AI_RETRIEVAL_MIN_COVERAGE，并同步 server/ai-agent/knowledge.mjs 的默认值。\n'
  )
}

try {
  await main()
} finally {
  await pool.end()
}

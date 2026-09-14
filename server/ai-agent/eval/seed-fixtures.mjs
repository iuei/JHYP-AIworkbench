/**
 * 把 eval/fixtures/*.md 灌入知识库，作为可复现的评测知识底料。
 *
 * 幂等：以 source_ref = `eval-fixture:<文件名去序号>` 作为标记，
 * 已存在则先下线旧文档再入库新版本（模拟"文档更新产生新版本"）。
 *
 * 用法：node server/ai-agent/eval/seed-fixtures.mjs [baseUrl]
 * 只应在本地开发库执行。
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from './client.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.join(HERE, 'fixtures')

export function fixtureKey(fileName) {
  return fileName.replace(/^\d+-/, '').replace(/\.md$/, '')
}

/** 读取夹具文档，返回 [{ key, fileName, title, content }]。 */
export async function loadFixtures() {
  const files = (await readdir(FIXTURE_DIR)).filter((name) => name.endsWith('.md')).sort()
  const fixtures = []
  for (const fileName of files) {
    const content = await readFile(path.join(FIXTURE_DIR, fileName), 'utf8')
    const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? fixtureKey(fileName)
    fixtures.push({ key: fixtureKey(fileName), fileName, title, content })
  }
  return fixtures
}

/** 灌库：返回 { created, updated, documentIds }。 */
export async function seedFixtures(client, adminToken, fixtures = null) {
  const list = fixtures ?? (await loadFixtures())
  const existing = await client.expect(
    '/api/ai/knowledge/documents?pageSize=100&sourceType=upload',
    { token: adminToken },
    200
  )
  const byRef = new Map(
    existing.json.documents
      .filter((doc) => typeof doc.sourceRef === 'string' && doc.sourceRef.startsWith('eval-fixture:'))
      .map((doc) => [doc.sourceRef, doc])
  )

  const documentIds = {}
  let created = 0
  let updated = 0
  for (const fixture of list) {
    const sourceRef = `eval-fixture:${fixture.key}`
    const previous = byRef.get(sourceRef)
    if (previous) updated += 1
    else created += 1
    const response = await client.expect(
      '/api/ai/knowledge/documents',
      {
        token: adminToken,
        method: 'POST',
        body: {
          title: fixture.title,
          content: fixture.content,
          sourceType: 'upload',
          category: '评测夹具',
          sourceRef,
          supersedesDocumentId: previous?.id ?? null,
        },
      },
      201
    )
    documentIds[fixture.key] = response.json.document.id
  }
  return { created, updated, documentIds, count: list.length }
}

async function main() {
  const base = process.argv[2]
  const client = createClient(base)
  const adminToken = await client.loginAdmin()
  const result = await seedFixtures(client, adminToken)
  process.stdout.write(
    `夹具灌库完成：${result.count} 篇（新增 ${result.created} / 更新 ${result.updated}）\n`
  )
  for (const [key, id] of Object.entries(result.documentIds)) {
    process.stdout.write(`  ${key} → 文档 #${id}\n`)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main()
}

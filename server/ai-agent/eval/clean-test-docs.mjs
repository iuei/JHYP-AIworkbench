/**
 * 清理评测/验收脚本往开发库写入的临时文档。
 *
 * 为什么需要：验收脚本每跑一次就新增文档，同一个 SOP 会留下多份近似重复内容，
 * 既污染检索质量评测（重复文档挤占 top-k 名额），也让"引用哪一篇"变得不可判定。
 *
 * 用法：
 *   node server/ai-agent/eval/clean-test-docs.mjs            # 只列出将被删除的文档（dry-run）
 *   node server/ai-agent/eval/clean-test-docs.mjs --yes      # 真正删除（经 API，删除动作会写审计）
 *   node server/ai-agent/eval/clean-test-docs.mjs --yes --keep-fixtures   # 保留 eval-fixture: 夹具
 *
 * 只应在本地开发库执行。
 */
import { createClient } from './client.mjs'

/** 判定"这是脚本产生的临时文档"：标题带验收标记且没有正式来源引用。 */
export function isTestArtifact(document, { keepFixtures = false } = {}) {
  const title = String(document.title ?? '')
  const sourceRef = String(document.sourceRef ?? '')
  if (keepFixtures && sourceRef.startsWith('eval-fixture:')) return false
  if (sourceRef.startsWith('e2e-fixture:')) return true
  const looksTemporary = /^【验收】/.test(title) || /注入测试文档/.test(title)
  // 有正式来源引用（飞书/夹具）的文档不算临时产物
  if (sourceRef && !sourceRef.startsWith('e2e-')) return false
  return looksTemporary
}

async function main() {
  const args = process.argv.slice(2)
  const confirmed = args.includes('--yes')
  const keepFixtures = args.includes('--keep-fixtures')
  const base = args.find((arg) => /^https?:\/\//.test(arg))

  const client = createClient(base)
  const adminToken = await client.loginAdmin()
  const list = await client.expect(
    '/api/ai/knowledge/documents?pageSize=100&status=active',
    { token: adminToken },
    200
  )

  const targets = list.json.documents.filter((document) =>
    isTestArtifact(
      // API 返回里字段名是 sourceRef
      document,
      { keepFixtures }
    )
  )

  process.stdout.write(`生效文档共 ${list.json.documents.length} 篇，识别到临时文档 ${targets.length} 篇：\n`)
  for (const document of targets) {
    process.stdout.write(
      `  #${document.id} ${document.title}（${document.sourceRef ?? '无来源引用'}，${document.chunkCount} 切片）\n`
    )
  }

  if (targets.length === 0) return
  if (!confirmed) {
    process.stdout.write('\n这是 dry-run。确认后加 --yes 真正删除。\n')
    return
  }

  for (const document of targets) {
    await client.expect(
      `/api/ai/knowledge/documents/${document.id}`,
      { token: adminToken, method: 'DELETE' },
      204
    )
    process.stdout.write(`已删除 #${document.id} ${document.title}\n`)
  }
  process.stdout.write(`\n完成：删除 ${targets.length} 篇，删除动作已写入审计。\n`)
}

await main()

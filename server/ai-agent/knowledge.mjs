/**
 * 知识库：解析 → 切片 → 入库 → 混合检索 → 重建索引 → 下线。
 *
 * 检索范围强制经由 permissions.documentScopeSql(③ 检索范围过滤)，
 * 本模块不得自行拼接角色判断。
 *
 * 中文检索说明：库内没有 zhparser，中文分词不可用。因此检索采用
 * 「CJK 双字切分 + 拉丁词」生成关键词，配合 ILIKE 命中数 + pg_trgm 相似度混合排序，
 * 只在有需要时才借助 search_vector（simple 配置，对拉丁词有效）。
 * 二期启用 embedding 时，只需在此文件补充向量召回并合并排序。
 */
import { pool, query } from '../db.mjs'
import { documentScopeSql } from './permissions.mjs'

export class KnowledgeValidationError extends Error {}

export const CHUNK_DEFAULTS = { size: 800, overlap: 100 }
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024
export const MAX_TOP_K = 20
/**
 * 检索相关性下限：命中的关键词数 / 问题关键词总数。
 *
 * 为什么必须有：中文用双字切分，像「公司」「规定」「流程」这类高频双字词几乎每篇文档都有，
 * 只要 `命中数 > 0` 就会把不相关文档捞回来。A1 基线实测：问「公司的星际飞船停放规定」
 * 也能「检索到片段」，真实模型下这就是编造制度（违反 A9）的入口。
 *
 * 取值来自 eval/compare-retrieval.mjs 在 8 篇评测夹具语料上的实测（A1 问题集 25 题）：
 *   coverage=0    → 预期文档召回 100%，但负样本 100% 误召（会编造）
 *   coverage=0.2  → 预期文档召回 87%，负样本 100% 正确空返回，空检索率 8.7%  ← 选定
 *   coverage=0.3  → 召回跌到 69.6%，空检索率 30.4%（过度拒绝，用户频繁被告知"不知道"）
 *   coverage=0.4  → 召回 60.9%，空检索率 39.1%
 * 取舍原则：宁可明确回答"知识库中未找到相关内容"，也不基于无关片段编造制度。
 * 剩余 13% 召回损失是口语化提问（"补货走谁审批" vs 文档"提报运营主管审批"）造成的，
 * 关键词方案解决不了，需要在 P2 接 embedding 做混合检索。
 *
 * 接入真实文档后必须用 eval/compare-retrieval.mjs 在该语料上重新标定；
 * 可用环境变量 AI_RETRIEVAL_MIN_COVERAGE 覆盖。
 */
export const MIN_QUERY_COVERAGE = Number(process.env.AI_RETRIEVAL_MIN_COVERAGE ?? 0.2)
export const SUPPORTED_DATASETS = [
  'amazon_ads_daily',
  'amazon_sales_daily',
  'inventory_snapshot',
  'order_snapshot',
]

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'csv', 'json', 'log', 'text'])
const BINARY_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
])

/** 疑问/功能类双字词，检索时作为噪声剔除，避免"怎么/什么/如何"拉回无关片段。 */
const STOP_TOKENS = new Set([
  '怎么',
  '什么',
  '为什',
  '哪些',
  '哪个',
  '如何',
  '可以',
  '是否',
  '请问',
  '一下',
  '我该',
  '应该',
  '需要',
  '有无',
])

export function parsePositiveInt(value, { fallback, min = 1, max = Number.MAX_SAFE_INTEGER }) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return fallback
  if (parsed < min) return min
  if (parsed > max) return max
  return parsed
}

/**
 * 切分文本。
 * 段落优先成块，单段超长时按 size 硬切并保留 overlap 字符重叠，避免语义被切断。
 */
export function chunkText(text, { size = CHUNK_DEFAULTS.size, overlap = CHUNK_DEFAULTS.overlap } = {}) {
  const normalized = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
  if (!normalized) return []
  if (!Number.isInteger(size) || size <= 0) {
    throw new KnowledgeValidationError('切片长度必须为正整数。')
  }
  const safeOverlap = Math.max(0, Math.min(Number(overlap) || 0, Math.floor(size / 2)))
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

  const chunks = []
  let buffer = ''
  const flush = () => {
    const value = buffer.trim()
    if (value) chunks.push(value)
    buffer = ''
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > size) {
      flush()
      let start = 0
      while (start < paragraph.length) {
        const end = Math.min(start + size, paragraph.length)
        const piece = paragraph.slice(start, end).trim()
        if (piece) chunks.push(piece)
        if (end >= paragraph.length) break
        start = end - safeOverlap
      }
      continue
    }
    const candidate = buffer ? `${buffer}\n\n${paragraph}` : paragraph
    if (candidate.length > size) flush()
    buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph
  }
  flush()
  return chunks
}

/** 生成检索关键词：CJK 双字 bigram + 拉丁/数字词，去重去噪，最多 12 个。 */
export function extractQueryTokens(searchText, { max = 12 } = {}) {
  const text = String(searchText ?? '').toLowerCase()
  const tokens = []
  const seen = new Set()
  const add = (token) => {
    if (!token || seen.has(token) || STOP_TOKENS.has(token)) return
    seen.add(token)
    tokens.push(token)
  }

  for (const word of text.match(/[a-z0-9][a-z0-9._-]*/g) ?? []) add(word)

  for (const run of text.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length === 1) {
      add(run)
      continue
    }
    for (let index = 0; index < run.length - 1; index += 1) {
      add(run.slice(index, index + 2))
    }
  }

  return tokens.slice(0, max)
}

/** 粗略估算 token 数（审计与成本统计用途，非计费依据）。 */
export function estimateTokenCount(text) {
  const value = String(text ?? '')
  if (!value) return 0
  const cjk = (value.match(/[\u4e00-\u9fff]/g) ?? []).length
  const rest = value.length - cjk
  return cjk + Math.ceil(rest / 4)
}

/**
 * 从上传内容中提取纯文本。
 * 一期只支持文本类格式；PDF/Word/Excel 明确拒绝，不静默失败、不伪装成功
 * （解析库选型对应需求文档 Q6，待确认）。
 */
export function extractDocumentText({ fileName = '', buffer } = {}) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? '')
  if (bytes.length === 0) {
    return { ok: false, error: '文件内容为空，未写入知识库。' }
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `文件超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 上限，请拆分后上传。`,
    }
  }
  const extension = String(fileName).toLowerCase().split('.').pop() ?? ''
  if (BINARY_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      error: `暂不支持解析 .${extension} 文件，请先另存为 TXT 或 Markdown 后重新上传。`,
    }
  }
  if (!TEXT_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      error: `无法识别的文件格式 .${extension}，一期仅支持 TXT / Markdown / CSV / JSON。`,
    }
  }
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '')
  if (!text.trim()) {
    return { ok: false, error: '文件解析后没有可用文本，未写入知识库。' }
  }
  return { ok: true, text }
}

function normalizeSourceType(sourceType) {
  if (sourceType === undefined || sourceType === null || sourceType === '') return 'upload'
  if (!['feishu', 'upload', 'experience'].includes(sourceType)) {
    throw new KnowledgeValidationError('知识来源类型无效。')
  }
  return sourceType
}

function normalizeTitle(title) {
  const value = String(title ?? '').trim()
  if (!value) throw new KnowledgeValidationError('文档标题不能为空。')
  if (value.length > 300) throw new KnowledgeValidationError('文档标题不能超过 300 个字符。')
  return value
}

/** 知识库数据时效：可见范围内最近一次文档更新时间。 */
export async function knowledgeFreshness(user) {
  const scope = documentScopeSql(user, '$1')
  const { rows } = await query(
    `SELECT COUNT(*)::int AS document_count, MAX(d.updated_at) AS imported_at
       FROM ai_documents d
      WHERE ${scope.clause}`,
    [scope.param]
  )
  return {
    dataset: 'knowledge',
    label: '知识库',
    importedAt: rows[0]?.imported_at ?? null,
    documentCount: rows[0]?.document_count ?? 0,
    note: '知识库内容为上传/同步时的版本，非实时数据。',
  }
}

/**
 * 写入文档及其切片。同一份新版本会先让上一版本失效，避免新旧制度同时被引用。
 *
 * `client`：可传入调用方已有的事务 client（审核通过必须把"状态变更 + 文档生成 + 关联"
 * 放进同一个事务，任一步失败整体回滚）。传入时本函数不再自行 BEGIN/COMMIT/RELEASE，
 * 事务边界完全由调用方掌握。
 */
export async function ingestDocument({
  title,
  text,
  sourceType = 'upload',
  sourceRef = null,
  category = null,
  expiresAt = null,
  createdBy = null,
  dataScope = {},
  supersedesDocumentId = null,
  chunkOptions = CHUNK_DEFAULTS,
  client: externalClient = null,
}) {
  const safeTitle = normalizeTitle(title)
  const safeSourceType = normalizeSourceType(sourceType)
  const chunks = chunkText(text, chunkOptions)
  if (chunks.length === 0) {
    throw new KnowledgeValidationError('文档内容为空，未写入任何切片。')
  }

  const ownsTransaction = !externalClient
  const client = externalClient ?? (await pool.connect())
  try {
    if (ownsTransaction) await client.query('BEGIN')
    if (supersedesDocumentId) {
      await client.query(
        `UPDATE ai_documents
            SET status = 'inactive', updated_at = NOW()
          WHERE id = $1 AND status = 'active'`,
        [supersedesDocumentId]
      )
    }
    const document = await client.query(
      `INSERT INTO ai_documents
         (title, source_type, source_ref, category, status, expires_at, chunk_count, data_scope, created_by)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $7::jsonb, $8)
       RETURNING id, title, source_type, doc_version, status, expires_at, chunk_count, created_at`,
      [
        safeTitle,
        safeSourceType,
        sourceRef,
        category,
        expiresAt,
        chunks.length,
        JSON.stringify(dataScope ?? {}),
        createdBy,
      ]
    )
    const documentId = document.rows[0].id
    // 分批多值 INSERT：长文档会被切成上百片，逐片插入就是上百次往返，且全程占着事务。
    const CHUNK_BATCH_SIZE = 200
    for (let start = 0; start < chunks.length; start += CHUNK_BATCH_SIZE) {
      const batch = chunks.slice(start, start + CHUNK_BATCH_SIZE)
      const params = []
      const tuples = batch.map((content, offset) => {
        params.push(documentId, start + offset, content, estimateTokenCount(content))
        const base = params.length - 3
        return `($${base}, $${base + 1}, $${base + 2}, $${base + 3})`
      })
      await client.query(
        `INSERT INTO ai_chunks (document_id, chunk_index, content, token_count)
         VALUES ${tuples.join(', ')}`,
        params
      )
    }
    if (ownsTransaction) await client.query('COMMIT')
    return { ...document.rows[0], chunkCount: chunks.length }
  } catch (error) {
    if (ownsTransaction) await client.query('ROLLBACK')
    throw error
  } finally {
    if (ownsTransaction) client.release()
  }
}

/**
 * 混合检索：在 ③ 可见文档范围内取片段，按「关键词命中数 + pg_trgm 相似度」排序。
 *
 * 两个关键设计：
 * 1. 关键词同时匹配**文档标题**与片段正文——员工经常直接指名提问（"《XX 流程》写了什么"），
 *    只匹配正文会漏召回；
 * 2. 设有**相关性下限**（命中关键词数 / 关键词总数 ≥ MIN_QUERY_COVERAGE）——
 *    中文双字切分下「公司」「规定」这类高频词几乎每篇文档都有，只判断"命中数 > 0"
 *    会把不相关文档捞回来，进而让模型基于无关片段编造制度（违反 A9）。
 *
 * 返回 { rows, tokens, dataFreshness }，rows 供工具回灌模型与引用面板使用。
 */
export async function searchKnowledge({
  user,
  searchText,
  topK = 5,
  sourceType = 'all',
  // 允许调用方（评测脚本/调参）覆盖相关性下限，避免为了对比取值反复重启服务
  minCoverage = MIN_QUERY_COVERAGE,
} = {}) {
  const target = String(searchText ?? '').trim()
  const limit = parsePositiveInt(topK, { fallback: 5, min: 1, max: MAX_TOP_K })
  const tokens = extractQueryTokens(target)
  const freshness = await knowledgeFreshness(user)

  if (!target) throw new KnowledgeValidationError('检索关键词不能为空。')
  const coverageFloor = Number.isFinite(Number(minCoverage)) ? Number(minCoverage) : MIN_QUERY_COVERAGE
  if (tokens.length === 0) {
    return { rows: [], tokens, dataFreshness: freshness, minCoverage: coverageFloor }
  }

  const scope = documentScopeSql(user, '$1')
  const params = [scope.param, tokens, target, limit, tokens.length, coverageFloor]
  let sourceClause = ''
  if (sourceType && sourceType !== 'all') {
    if (!['feishu', 'upload', 'experience'].includes(sourceType)) {
      throw new KnowledgeValidationError('知识来源筛选值无效。')
    }
    params.push(sourceType)
    sourceClause = `AND d.source_type = $${params.length}`
  }

  const { rows } = await query(
    `SELECT c.id AS chunk_id, c.chunk_index, c.content,
            d.id AS document_id, d.title, d.source_type, d.category, d.doc_version,
            d.source_ref, d.expires_at, d.updated_at,
            u.name AS submitter,
            hits.hit_count,
            (hits.hit_count::float / $5) AS coverage,
            similarity(c.content, $3) AS trgm_score
       FROM ai_chunks c
       JOIN ai_documents d ON d.id = c.document_id
       -- 提报人优先取 owner_user_id：experience 类文档由审核管理员创建，
       -- created_by 是审核人，owner_user_id 才是提报员工；上传类文档 owner 为空，回落 created_by
       LEFT JOIN users u ON u.id = COALESCE(d.owner_user_id, d.created_by)
       CROSS JOIN LATERAL (
         SELECT COUNT(*)::int AS hit_count
           FROM unnest($2::text[]) AS token
          WHERE c.content ILIKE '%' || token || '%'
             OR d.title ILIKE '%' || token || '%'
       ) hits
      WHERE ${scope.clause}
        ${sourceClause}
        AND (hits.hit_count > 0 OR c.content % $3)
        AND (hits.hit_count::float / $5) >= $6
      ORDER BY coverage DESC, hits.hit_count DESC, trgm_score DESC,
               d.updated_at DESC, c.chunk_index ASC
      LIMIT $4`,
    params
  )

  return {
    rows: rows.map((row) => ({
      chunkId: row.chunk_id,
      chunkIndex: row.chunk_index,
      snippet: row.content,
      documentId: row.document_id,
      title: row.title,
      sourceType: row.source_type,
      category: row.category,
      docVersion: row.doc_version,
      sourceRef: row.source_ref,
      expiresAt: row.expires_at,
      updatedAt: row.updated_at,
      submitter: row.source_type === 'experience' ? row.submitter : null,
      score: Number(row.hit_count) * 10 + Number(row.trgm_score ?? 0),
      hitCount: Number(row.hit_count),
      coverage: Number(Number(row.coverage ?? 0).toFixed(3)),
    })),
    tokens,
    dataFreshness: freshness,
    minCoverage: coverageFloor,
  }
}

/**
 * 重建知识索引。
 * search_vector 是生成列，插入即已建好；这里做的是修计数器 + 刷新统计信息，
 * 使新增/更新文档立即可被检索到（对应工具 rebuild_knowledge_index）。
 */
export async function rebuildKnowledgeIndex() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE ai_documents d
          SET chunk_count = counts.total
         FROM (SELECT document_id, COUNT(*)::int AS total FROM ai_chunks GROUP BY document_id) counts
        WHERE counts.document_id = d.id AND d.chunk_count <> counts.total`
    )
    await client.query(
      `UPDATE ai_documents d
          SET chunk_count = 0
        WHERE d.chunk_count <> 0
          AND NOT EXISTS (SELECT 1 FROM ai_chunks c WHERE c.document_id = d.id)`
    )
    await client.query('ANALYZE ai_chunks')
    const documents = await client.query(
      `SELECT COUNT(*)::int AS active FROM ai_documents WHERE status = 'active'`
    )
    const chunks = await client.query('SELECT COUNT(*)::int AS total FROM ai_chunks')
    await client.query('COMMIT')
    return {
      documents: documents.rows[0].active,
      chunks: chunks.rows[0].total,
      refreshedAt: new Date().toISOString(),
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

/**
 * 下线文档：置为 inactive，检索立即失效（切片保留以便追溯与恢复）。
 *
 * `client` 用于加入调用方的事务：归档已发布沉淀时，「条目归档 + 文档下线」必须原子完成，
 * 否则中途失败会留下「条目已归档、文档仍 active 被检索」的治理链断点。
 */
export async function deactivateDocument({ documentId, actorId = null, client = null }) {
  const run = client ? (text, params) => client.query(text, params) : query
  const { rows } = await run(
    `UPDATE ai_documents
        SET status = 'inactive', updated_at = NOW()
      WHERE id = $1 AND status = 'active'
      RETURNING id, title, chunk_count, source_type`,
    [documentId]
  )
  if (!rows[0]) return null
  return { ...rows[0], actorId }
}

/** 重新启用文档：同时清掉已过期的有效期，避免启用后立即失效。 */
export async function reactivateDocument({ documentId, expiresAt = undefined }) {
  const fields = [`status = 'active'`, `updated_at = NOW()`]
  const params = [documentId]
  if (expiresAt !== undefined) {
    params.push(expiresAt)
    fields.push(`expires_at = $${params.length}`)
  } else {
    fields.push(`expires_at = CASE WHEN expires_at IS NOT NULL AND expires_at <= NOW() THEN NULL ELSE expires_at END`)
  }
  const { rows } = await query(
    `UPDATE ai_documents SET ${fields.join(', ')} WHERE id = $1
     RETURNING id, title, status, expires_at, chunk_count`,
    params
  )
  return rows[0] ?? null
}

/** 只改有效期，不动生效状态。 */
export async function updateDocumentExpiry({ documentId, expiresAt = null }) {
  const { rows } = await query(
    `UPDATE ai_documents SET expires_at = $2, updated_at = NOW()
      WHERE id = $1
      RETURNING id, title, status, expires_at, chunk_count`,
    [documentId, expiresAt]
  )
  return rows[0] ?? null
}

/** 按 ID 取文档（含可见性校验所需字段）。 */
export async function findDocumentById(documentId) {
  const { rows } = await query(
    `SELECT id, title, source_type, source_ref, doc_version, category, status,
            effective_at, expires_at, chunk_count, data_scope, created_by,
            created_at, updated_at
       FROM ai_documents WHERE id = $1`,
    [documentId]
  )
  return rows[0] ?? null
}

/** 管理员文档列表（分页 + 筛选）。 */
export async function listDocuments({
  page = 1,
  pageSize = 20,
  status = null,
  sourceType = null,
  keyword = null,
} = {}) {
  const safePage = parsePositiveInt(page, { fallback: 1, min: 1, max: 100000 })
  const safePageSize = parsePositiveInt(pageSize, { fallback: 20, min: 1, max: 100 })
  const offset = (safePage - 1) * safePageSize
  const { rows } = await query(
    `SELECT d.id, d.title, d.source_type, d.source_ref, d.doc_version, d.category,
            d.status, d.effective_at, d.expires_at, d.chunk_count, d.created_at, d.updated_at,
            u.name AS created_by_name,
            (SELECT COUNT(*)::int FROM ai_feedback f
               JOIN ai_messages m ON m.id = f.message_id
              WHERE m.content ILIKE '%' || d.title || '%' AND f.type <> 'helpful'
            ) AS correction_count
       FROM ai_documents d
       LEFT JOIN users u ON u.id = d.created_by
      WHERE ($1::text IS NULL OR d.status = $1)
        AND ($2::text IS NULL OR d.source_type = $2)
        AND ($3::text IS NULL OR d.title ILIKE '%' || $3 || '%')
      ORDER BY d.updated_at DESC, d.id DESC
      LIMIT $4 OFFSET $5`,
    [status, sourceType, keyword, safePageSize, offset]
  )
  const total = await query(
    `SELECT COUNT(*)::int AS total FROM ai_documents d
      WHERE ($1::text IS NULL OR d.status = $1)
        AND ($2::text IS NULL OR d.source_type = $2)
        AND ($3::text IS NULL OR d.title ILIKE '%' || $3 || '%')`,
    [status, sourceType, keyword]
  )
  return { rows, total: total.rows[0].total, page: safePage, pageSize: safePageSize }
}

/** 员工团队知识库列表：分页、搜索与文档可见性必须使用同一套范围规则。 */
export async function listVisibleDocuments({
  user,
  page = 1,
  pageSize = 20,
  sourceType = null,
  keyword = null,
} = {}) {
  const safePage = parsePositiveInt(page, { fallback: 1, min: 1, max: 100000 })
  const safePageSize = parsePositiveInt(pageSize, { fallback: 20, min: 1, max: 100 })
  const offset = (safePage - 1) * safePageSize
  const scope = documentScopeSql(user, '$1')
  const { rows } = await query(
    `SELECT d.id, d.title, d.source_type, d.doc_version, d.category,
            d.status, d.effective_at, d.expires_at, d.chunk_count,
            u.name AS created_by_name, d.updated_at
       FROM ai_documents d
       LEFT JOIN users u ON u.id = d.created_by
      WHERE ${scope.clause}
        AND ($2::text IS NULL OR d.source_type = $2)
        AND ($3::text IS NULL OR d.title ILIKE '%' || $3 || '%')
      ORDER BY d.updated_at DESC, d.id DESC
      LIMIT $4 OFFSET $5`,
    [scope.param, sourceType, keyword, safePageSize, offset]
  )
  const total = await query(
    `SELECT COUNT(*)::int AS total FROM ai_documents d
      WHERE ${scope.clause}
        AND ($2::text IS NULL OR d.source_type = $2)
        AND ($3::text IS NULL OR d.title ILIKE '%' || $3 || '%')`,
    [scope.param, sourceType, keyword]
  )
  return { rows, total: total.rows[0].total, page: safePage, pageSize: safePageSize }
}

/** 文档切片预览（管理员核对引用来源）。 */
export async function listDocumentChunks(documentId, { limit = 50 } = {}) {
  const { rows } = await query(
    `SELECT id, chunk_index, content, token_count, created_at
       FROM ai_chunks WHERE document_id = $1 ORDER BY chunk_index ASC LIMIT $2`,
    [documentId, parsePositiveInt(limit, { fallback: 50, min: 1, max: 200 })]
  )
  return rows
}

/** 删除文档及其切片（审计不可删，但知识文档可删）。 */
export async function deleteDocument(documentId) {
  const { rows } = await query(
    `DELETE FROM ai_documents WHERE id = $1 RETURNING id, title, chunk_count, source_type`,
    [documentId]
  )
  return rows[0] ?? null
}

/** 各数据集最新导入时间（数据时效声明用；一期数据集为空时如实返回 null）。 */
export async function datasetFreshness() {
  const { rows } = await query(
    `SELECT dataset, MAX(imported_at) AS imported_at, COUNT(*)::int AS imports
       FROM ai_imports
      WHERE status = 'ok'
      GROUP BY dataset`
  )
  const byDataset = new Map(rows.map((row) => [row.dataset, row]))
  return SUPPORTED_DATASETS.map((dataset) => ({
    dataset,
    importedAt: byDataset.get(dataset)?.imported_at ?? null,
    imports: byDataset.get(dataset)?.imports ?? 0,
  }))
}

/** 获取单行配置（含模型连接参数与 MCP 接入参数；密钥为密文，解密只在 providers / mcp 层发生）。 */
export async function loadSettings() {
  const { rows } = await query(
    `SELECT id, model_provider, model_name, model_base_url,
            model_api_key_cipher, model_api_key_hint, model_api_key_fingerprint,
            model_api_key_updated_at, force_demo,
            temperature, max_output_tokens, max_turns_per_conversation,
            retrieval_top_k, request_timeout_ms,
            mcp_enabled, mcp_endpoint, mcp_prefix, mcp_timeout_ms,
            mcp_secret_cipher, mcp_secret_hint, mcp_secret_fingerprint,
            mcp_secret_updated_at, mcp_synced_at, updated_at
       FROM ai_settings WHERE id = 1`
  )
  return rows[0] ?? null
}

/**
 * 产品开发领域层：候选产品池 + 横向对比。
 *
 * 定位：面向**上架前的候选新品**（ASIN 清单是在售商品、竞品分析是即时横比），
 * 把选品调研沉淀成可检索、可对比、可回看的对象。
 *
 * 三条不可让步的口径（沿用相邻模块的既有结论，不重新发明）：
 *
 * 1. **数据双轨、来源分明**。候选的身份与选品字段（价格、评分…）由**人工录入或表格导入**，
 *    经营指标来自**本公司已导入的报表**。对比结果里每列带 `source`（`manual` / `report`），
 *    界面不得把用户填的价格暗示成平台抓取的数据。
 * 2. **无数据一律 `null`，不补 0**。与竞品分析「无数据的 ASIN 指标为 null 而不是 0」同口径 ——
 *    候选多半尚未上架，本来就不该有我方报表记录，把"没记录"算成"表现差"会直接误导选品决策。
 * 3. **同一站点才允许对比**。广告与销售日报按 `(asin, marketplace)` 存储，把两个站点的数字
 *    放在一张表里比，得到的是一份**错误**的结论而不是"不够精确"的结论。
 *
 * 本模块**不产出"建议开发 / 不建议开发"这类结论**：竞品分析的 `buildFindings` 之所以能给结论，
 * 是因为每条都带可复算的 `evidence`；本模块目前没有这样的确定性规则，凭空给评语就是
 * 项目明令禁止的"用推测填充没有数据源的板块"。它只呈现事实。
 */
import { query } from './db.mjs'
import {
  DEFAULT_WINDOW_DAYS,
  MAX_RANGE_DAYS,
  MAX_WINDOW_DAYS,
  MIN_WINDOW_DAYS,
  diffDays,
  extractAsin,
  normalizeDateInput,
  shiftDays,
} from './competitor-analysis.mjs'
import {
  DEFAULT_MARKETPLACE,
  MARKETPLACE_LABELS,
  // 站点枚举的唯一定义在 my-asins.mjs（原 ASIN 清单领域层，2026-09-18 改名）；
  // 本模块只是复用同一份白名单，与"清单"概念无关，因此保留原有局部名以减少改动面
  MY_ASIN_MARKETPLACES as WATCHLIST_MARKETPLACES,
} from './ai-agent/my-asins.mjs'
import { summarizeAds, summarizeSales } from './ai-agent/analytics.mjs'
import {
  combineFreshness,
  queryAdsDailyByAsins,
  queryLatestAmazonDate,
  querySalesDailyByAsins,
} from './ai-agent/data-queries.mjs'
import { datasetFreshnessOf } from './ai-agent/datasets.mjs'
import {
  MAX_IMPORT_ROWS,
  STAGE_LABELS,
  STAGES,
  parseProductDevRows,
  parseProductDevTableText,
  parseProductDevTextLines,
} from './product-dev-table.mjs'

export { MAX_IMPORT_ROWS, STAGE_LABELS, STAGES }

/** 校验类错误 → 400。 */
export class ProductDevValidationError extends Error {}

/** 资源不存在或不属于当前账号 → 404（不区分两者，避免探测他人数据）。 */
export class ProductDevNotFoundError extends Error {}

/** 唯一约束冲突（同站点同 ASIN 已存在）→ 409。 */
export class ProductDevConflictError extends Error {}

/** 每个账号的候选数上限（与单次导入上限一致：一次导入即可填满）。 */
export const MAX_CANDIDATES_PER_USER = MAX_IMPORT_ROWS

/** 一次对比允许的候选数量区间。少于 2 个不构成"对比"。 */
export const MIN_COMPARE_ITEMS = 2
export const MAX_COMPARE_ITEMS = 10

export const MAX_NAME_LENGTH = 300
export const MAX_CATEGORY_LENGTH = 60
export const MAX_NOTE_LENGTH = 500
export const MAX_KEYWORD_LENGTH = 100
export const MAX_ATTRIBUTE_KEYS = 30
export const MAX_ATTRIBUTE_KEY_LENGTH = 60
export const MAX_ATTRIBUTE_VALUE_LENGTH = 300

/**
 * 对比表里动态维度（来自 `attributes`）的列数上限。
 *
 * 用户表里可能出现几十个列（评分、评论数、月销、BSM 排名、供应商…），全摊平会让对比表
 * 横向无限宽。按"出现次数多的优先"截断，并**在结果里如实说明被省略了多少个维度** ——
 * 静默截断会让用户以为"我就填了这么几列"。
 */
export const MAX_DYNAMIC_DIMENSIONS = 12

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

const ROUND = (value, digits = 2) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null
  const factor = 10 ** digits
  return Math.round(Number(value) * factor) / factor
}

/* ---------- 纯函数：校验 ---------- */

export function normalizeText(raw, { max, label, required = false }) {
  if (raw === undefined) return undefined
  if (raw === null) {
    if (required) throw new ProductDevValidationError(`${label}不能为空。`)
    return null
  }
  const text = String(raw).replace(/\s+/g, ' ').trim()
  if (!text) {
    if (required) throw new ProductDevValidationError(`${label}不能为空。`)
    return null
  }
  if (text.length > max) {
    throw new ProductDevValidationError(`${label}不能超过 ${max} 个字符。`)
  }
  return text
}

export function parseMarketplace(raw) {
  const text = String(raw ?? DEFAULT_MARKETPLACE)
    .trim()
    .toUpperCase()
  if (!WATCHLIST_MARKETPLACES.includes(text)) {
    throw new ProductDevValidationError(
      `站点 ${text || '(空)'} 不在支持范围内，可选：${WATCHLIST_MARKETPLACES.join('、')}。`
    )
  }
  return text
}

export function parseStage(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return undefined
  const lower = text.toLowerCase()
  if (STAGES.includes(lower)) return lower
  const labelEntry = Object.entries(STAGE_LABELS).find(([, label]) => label === text)
  if (labelEntry) return labelEntry[0]
  throw new ProductDevValidationError(
    `阶段「${text}」不在允许范围内，可选：${Object.values(STAGE_LABELS).join('、')}。`
  )
}

/** 目标售价：只接受 0 与正数；空串按"清空"处理。 */
export function parseTargetPrice(raw) {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value)) {
    throw new ProductDevValidationError('目标售价必须是一个数字。')
  }
  if (value < 0) throw new ProductDevValidationError('目标售价不能是负数。')
  if (value > 99999999999) throw new ProductDevValidationError('目标售价超出可存储范围。')
  return ROUND(value)
}

/**
 * 附加维度（`attributes`）：键值一律字符串，键数、键长、值长都有上限。
 *
 * 全部转字符串是有意的：这一层的用途是**承载尚未确定数据源的列**，用户表头写的是
 * 「评分 4.5」「月销 300+」这类自由文本。强行转数字会在遇到 "300+" 时静默变成 NaN，
 * 而对比表只需要能把原值如实列出来。
 */
export function normalizeAttributes(raw) {
  if (raw === undefined) return undefined
  if (raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ProductDevValidationError('附加维度必须是一个对象。')
  }
  const entries = Object.entries(raw)
  if (entries.length > MAX_ATTRIBUTE_KEYS) {
    throw new ProductDevValidationError(`附加维度不能超过 ${MAX_ATTRIBUTE_KEYS} 项。`)
  }
  const result = {}
  for (const [key, value] of entries) {
    const name = String(key ?? '').trim()
    if (!name) continue
    if (name.length > MAX_ATTRIBUTE_KEY_LENGTH) {
      throw new ProductDevValidationError(
        `附加维度的名称「${name.slice(0, 20)}…」超过 ${MAX_ATTRIBUTE_KEY_LENGTH} 个字符。`
      )
    }
    if (value === null || value === undefined || value === '') continue
    const text = String(value).trim()
    if (text.length > MAX_ATTRIBUTE_VALUE_LENGTH) {
      throw new ProductDevValidationError(
        `附加维度「${name}」的值超过 ${MAX_ATTRIBUTE_VALUE_LENGTH} 个字符。`
      )
    }
    result[name] = text
  }
  return result
}

/**
 * 候选写入体校验。
 *
 * `partial = true` 用于 PATCH：只校验传进来的键，未传的键不出现在返回值里，
 * 避免"没传的字段被悄悄清空"。但**产品名称与 ASIN 不能同时为空**这条不变式在
 * 两种模式下都要成立 —— 更新时若把名称清空而 ASIN 本来就没有，会得到一条无法识别的候选。
 */
export function normalizeCandidateInput(body = {}, { partial = false } = {}) {
  const source = body ?? {}
  const result = {}

  if (!partial || 'productName' in source || 'product_name' in source) {
    const name = normalizeText(source.productName ?? source.product_name, {
      max: MAX_NAME_LENGTH,
      label: '产品名称',
    })
    result.product_name = name ?? ''
  }

  if (!partial || 'asin' in source) {
    /*
     * ASIN 不能先按长度校验再解析：用户粘进来的通常是一整条商品链接
     * （`https://www.amazon.com/dp/B0XXXXXXXX?ref_=...` 远超 40 字符），
     * 先卡长度会让"粘链接"这条最常用的路径直接报错。正确顺序是先解析出 10 位 ASIN，
     * 落库的永远是解析结果（`VARCHAR(40)` 足够），超长输入只作为防滥用的上限。
     */
    const rawAsin = source.asin === null || source.asin === undefined ? '' : String(source.asin).trim()
    if (rawAsin.length > 500) {
      throw new ProductDevValidationError('ASIN 或商品链接过长，请检查是否粘贴了多余内容。')
    }
    if (rawAsin) {
      const parsed = extractAsin(rawAsin)
      if (!parsed) {
        throw new ProductDevValidationError(
          `ASIN「${rawAsin.slice(0, 60)}」无法识别，请填写 10 位 ASIN 或亚马逊商品链接。`
        )
      }
      result.asin = parsed
    } else {
      result.asin = null
    }
  }

  if (!partial || 'category' in source) {
    result.category =
      normalizeText(source.category, { max: MAX_CATEGORY_LENGTH, label: '类目' }) ?? ''
  }

  if (!partial || 'targetPrice' in source || 'target_price' in source) {
    result.target_price = parseTargetPrice(source.targetPrice ?? source.target_price) ?? null
  }

  if (!partial || 'marketplace' in source) {
    result.marketplace = source.marketplace ? parseMarketplace(source.marketplace) : DEFAULT_MARKETPLACE
  }

  if (!partial || 'stage' in source) {
    result.stage = parseStage(source.stage) ?? 'candidate'
  }

  if (!partial || 'note' in source) {
    result.note = normalizeText(source.note, { max: MAX_NOTE_LENGTH, label: '备注' })
  }

  if (!partial || 'attributes' in source) {
    result.attributes = normalizeAttributes(source.attributes) ?? {}
  }

  // 不变式：名称与 ASIN 至少要有一个，否则这条候选在列表里无法被识别
  if (!partial) {
    if (!result.product_name && !result.asin) {
      throw new ProductDevValidationError('产品名称与 ASIN 至少填写一个。')
    }
  } else if ('product_name' in result || 'asin' in result) {
    const name = 'product_name' in result ? result.product_name : source.currentName
    const asin = 'asin' in result ? result.asin : source.currentAsin
    if (!name && !asin) {
      throw new ProductDevValidationError('产品名称与 ASIN 至少保留一个，不能同时清空。')
    }
  }

  return result
}

/** 判重键（与解析层 `dedupeKey` 同口径；有 ASIN 按 ASIN，否则按站点 + 名称）。 */
export function candidateDedupeKey({ marketplace, asin, product_name }) {
  if (asin) return `asin:${marketplace}:${asin}`
  return `name:${marketplace}:${String(product_name ?? '').toLowerCase()}`
}

/* ---------- 纯函数：对比装配 ---------- */

export const MANUAL_DIMENSIONS = [
  { key: 'product_name', label: '产品名称', source: 'manual', format: 'text' },
  { key: 'asin', label: 'ASIN', source: 'manual', format: 'text' },
  { key: 'category', label: '类目', source: 'manual', format: 'text' },
  { key: 'target_price', label: '目标售价', source: 'manual', format: 'currency' },
  { key: 'stage', label: '阶段', source: 'manual', format: 'stage' },
  { key: 'note', label: '备注', source: 'manual', format: 'text' },
]

export const REPORT_DIMENSIONS = [
  { key: 'spend', label: '广告花费', source: 'report', format: 'currency' },
  { key: 'adSales', label: '广告销售额', source: 'report', format: 'currency' },
  { key: 'acos', label: 'ACoS(%)', source: 'report', format: 'percent' },
  { key: 'clicks', label: '点击', source: 'report', format: 'number' },
  { key: 'cvr', label: '转化率(%)', source: 'report', format: 'percent' },
  { key: 'businessSales', label: '业务销售额', source: 'report', format: 'currency' },
  { key: 'units', label: '销量', source: 'report', format: 'number' },
  { key: 'returnRate', label: '退货率(%)', source: 'report', format: 'percent' },
]

/** 动态维度 key 加前缀，避免用户表头恰好叫「asin」「spend」时与固定维度撞车。 */
export const ATTRIBUTE_KEY_PREFIX = 'attr:'

/**
 * 收集本次对比要展示的附加维度。
 *
 * 按"在多少个候选里出现"降序排（出现得越普遍越值得占一列），同频次按首次出现的顺序，
 * 保证同一批候选每次生成的列顺序稳定。超出上限的部分如实返回数量，由装配层写进说明。
 */
export function collectDynamicDimensions(candidates, { max = MAX_DYNAMIC_DIMENSIONS } = {}) {
  const counts = new Map()
  for (const candidate of candidates) {
    const attributes = candidate.attributes ?? {}
    for (const key of Object.keys(attributes)) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  const ordered = [...counts.entries()]
    .map(([key, count], index) => ({ key, count, index }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map((item) => item.key)

  return {
    keys: ordered.slice(0, max),
    omitted: Math.max(0, ordered.length - max),
  }
}

/**
 * 把候选 + 指标装配成对比结果（**纯函数**，单测直接覆盖）。
 *
 * `metricsByAsin` 是 `asin → 指标对象` 的映射；缺失即"无我方数据"。
 * 每行的 `values` 已经按维度 key 摊平，前端只按 `dimensions` 取键即可渲染，
 * 不需要在前端再写一遍"固定字段 / 附加字段"的取值分支（两处分支必然会漂移）。
 */
export function buildComparisonRows({ candidates, metricsByAsin = new Map(), dynamicKeys = [] }) {
  return candidates.map((candidate) => {
    const metrics = candidate.asin ? metricsByAsin.get(candidate.asin) ?? null : null
    const coverage = !candidate.asin ? 'no_asin' : metrics ? 'ok' : 'no_report_data'

    const values = {
      product_name: candidate.product_name || null,
      asin: candidate.asin || null,
      category: candidate.category || null,
      target_price: candidate.target_price === null ? null : Number(candidate.target_price),
      stage: STAGE_LABELS[candidate.stage] ?? candidate.stage,
      note: candidate.note || null,
    }
    for (const key of dynamicKeys) {
      const value = candidate.attributes?.[key]
      values[`${ATTRIBUTE_KEY_PREFIX}${key}`] = value === undefined ? null : value
    }
    for (const dimension of REPORT_DIMENSIONS) {
      values[dimension.key] = metrics ? metrics[dimension.key] ?? null : null
    }

    return {
      id: candidate.id,
      name: candidate.product_name || candidate.asin || `候选 #${candidate.id}`,
      asin: candidate.asin || null,
      stage: candidate.stage,
      coverage,
      coverageLabel:
        coverage === 'ok'
          ? '有我方报表数据'
          : coverage === 'no_asin'
            ? '未填 ASIN，无法关联我方报表'
            : '无我方报表数据',
      emptyReason:
        coverage === 'ok'
          ? null
          : coverage === 'no_asin'
            ? '这条候选没有填写 ASIN，因此无法在广告日报与业务报告中找到对应记录。'
            : '我方广告日报与业务报告中没有该 ASIN 在所选区间的记录。候选通常尚未上架，这是正常状态。',
      values,
    }
  })
}

/** 对比口径说明（固定文案，由服务端生成，前端不自己拼）。 */
export function buildComparisonNote({ marketplaceLabel, startDate, endDate, omitted }) {
  const parts = [
    `本次对比的 ${marketplaceLabel} 站数据区间为 ${startDate} ~ ${endDate}。`,
    '「人工录入」列由使用者填写，平台不做校验与抓取；「我方报表」列来自本公司已导入的 Amazon 广告日报与业务报告，为人工导出的准实时数据。',
    '候选未填写 ASIN、或我方报表没有该 ASIN 的记录时，报表指标一律留空（显示为「—」），不使用 0 代替 —— 未上架的候选没有我方数据属于正常状态。',
  ]
  if (omitted > 0) {
    parts.push(
      `附加维度较多，本次只展示出现次数最多的前 ${MAX_DYNAMIC_DIMENSIONS} 个，另有 ${omitted} 个未展示（可在候选池里查看完整信息）。`
    )
  }
  return parts.join('')
}

/* ---------- 数据库：候选池 ---------- */

const CANDIDATE_COLUMNS = `
  id, marketplace, asin, product_name, category, target_price, stage, note,
  attributes, source, created_at, updated_at
`

function toCandidateRow(row) {
  return {
    id: row.id,
    marketplace: row.marketplace,
    asin: row.asin,
    product_name: row.product_name,
    category: row.category,
    target_price: row.target_price === null ? null : Number(row.target_price),
    stage: row.stage,
    stageLabel: STAGE_LABELS[row.stage] ?? row.stage,
    note: row.note,
    attributes: row.attributes ?? {},
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function countCandidates(userId) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS total FROM product_dev_candidates WHERE owner_user_id = $1 AND deleted_at IS NULL',
    [userId]
  )
  return rows[0]?.total ?? 0
}

/**
 * 检索候选池。
 *
 * 关键词只在**文本类固定列 + attributes 的值**里搜（`attributes::text ILIKE`）：
 * 用户填的「评分 4.5」这类附加维度也应该能被搜到，否则检索的意义少一半。
 */
export async function listCandidates({
  userId,
  keyword = null,
  marketplace = null,
  stage = null,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
}) {
  const conditions = ['owner_user_id = $1', 'deleted_at IS NULL']
  const params = [userId]

  if (keyword) {
    params.push(`%${keyword}%`)
    const index = params.length
    conditions.push(
      `(product_name ILIKE $${index} OR COALESCE(asin, '') ILIKE $${index} OR category ILIKE $${index} OR COALESCE(note, '') ILIKE $${index} OR attributes::text ILIKE $${index})`
    )
  }
  if (marketplace) {
    params.push(marketplace)
    conditions.push(`marketplace = $${params.length}`)
  }
  if (stage) {
    params.push(stage)
    conditions.push(`stage = $${params.length}`)
  }

  const where = conditions.join(' AND ')
  const totalResult = await query(
    `SELECT COUNT(*)::int AS total FROM product_dev_candidates WHERE ${where}`,
    params
  )
  const total = totalResult.rows[0]?.total ?? 0

  const offset = (page - 1) * pageSize
  const listParams = [...params, pageSize, offset]
  const { rows } = await query(
    `SELECT ${CANDIDATE_COLUMNS}
       FROM product_dev_candidates
      WHERE ${where}
      ORDER BY updated_at DESC, id DESC
      LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  )

  return { items: rows.map(toCandidateRow), total, page, pageSize }
}

export async function getCandidate(userId, id) {
  const { rows } = await query(
    `SELECT ${CANDIDATE_COLUMNS} FROM product_dev_candidates
      WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`,
    [id, userId]
  )
  return rows[0] ? toCandidateRow(rows[0]) : null
}

/** 一次对比用：按 ID 批量取候选（保持传入顺序），任何一个不属于本人即整体判为不可用。 */
export async function getCandidatesByIds(userId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return []
  const { rows } = await query(
    `SELECT ${CANDIDATE_COLUMNS} FROM product_dev_candidates
      WHERE owner_user_id = $1 AND deleted_at IS NULL AND id = ANY($2::int[])`,
    [userId, ids]
  )
  const byId = new Map(rows.map((row) => [row.id, toCandidateRow(row)]))
  return ids.map((id) => byId.get(id)).filter(Boolean)
}

/** 池内已有的判重键集合（导入前先查，解析层据此区分 `duplicated` 与 `repeated`）。 */
export async function loadCandidateKeys(userId) {
  const { rows } = await query(
    `SELECT marketplace, asin, product_name FROM product_dev_candidates
      WHERE owner_user_id = $1 AND deleted_at IS NULL`,
    [userId]
  )
  return new Set(rows.map((row) => candidateDedupeKey(row)))
}

export async function createCandidate({ userId, input }) {
  const total = await countCandidates(userId)
  if (total >= MAX_CANDIDATES_PER_USER) {
    throw new ProductDevValidationError(
      `候选池最多保存 ${MAX_CANDIDATES_PER_USER} 条，当前已有 ${total} 条。请先清理不再跟进的候选。`
    )
  }

  try {
    const { rows } = await query(
      `INSERT INTO product_dev_candidates
         (owner_user_id, marketplace, asin, product_name, category, target_price, stage, note, attributes, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, 'manual')
       RETURNING ${CANDIDATE_COLUMNS}`,
      [
        userId,
        input.marketplace ?? DEFAULT_MARKETPLACE,
        input.asin ?? null,
        input.product_name ?? '',
        input.category ?? '',
        input.target_price ?? null,
        input.stage ?? 'candidate',
        input.note ?? null,
        JSON.stringify(input.attributes ?? {}),
      ]
    )
    return toCandidateRow(rows[0])
  } catch (error) {
    // 23505 = unique_violation：部分唯一索引兜住并发下的重复插入
    if (error?.code === '23505') {
      throw new ProductDevConflictError('这个 ASIN 已经在候选池里了（同站点同 ASIN 不允许重复）。')
    }
    throw error
  }
}

export async function updateCandidate({ userId, id, input }) {
  const fields = []
  const params = [id, userId]
  const push = (column, value) => {
    params.push(value)
    fields.push(`${column} = $${params.length}`)
  }

  if ('marketplace' in input) push('marketplace', input.marketplace)
  if ('asin' in input) push('asin', input.asin)
  if ('product_name' in input) push('product_name', input.product_name)
  if ('category' in input) push('category', input.category)
  if ('target_price' in input) push('target_price', input.target_price)
  if ('stage' in input) push('stage', input.stage)
  if ('note' in input) push('note', input.note)
  if ('attributes' in input) {
    params.push(JSON.stringify(input.attributes))
    fields.push(`attributes = $${params.length}::jsonb`)
  }

  if (fields.length === 0) {
    throw new ProductDevValidationError('没有需要更新的字段。')
  }

  try {
    const { rows } = await query(
      `UPDATE product_dev_candidates
          SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL
        RETURNING ${CANDIDATE_COLUMNS}`,
      params
    )
    if (!rows[0]) throw new ProductDevNotFoundError('候选不存在。')
    return toCandidateRow(rows[0])
  } catch (error) {
    if (error?.code === '23505') {
      throw new ProductDevConflictError('这个 ASIN 已经在候选池里了（同站点同 ASIN 不允许重复）。')
    }
    throw error
  }
}

/** 软删：只置 `deleted_at`，条目保留，因此"删除后重新加同一 ASIN"是允许的。 */
export async function deleteCandidate(userId, id) {
  const { rowCount } = await query(
    `UPDATE product_dev_candidates SET deleted_at = NOW()
      WHERE id = $1 AND owner_user_id = $2 AND deleted_at IS NULL`,
    [id, userId]
  )
  if (!rowCount) throw new ProductDevNotFoundError('候选不存在。')
  return { id, deleted: true }
}

/**
 * 批量写入导入结果（单事务）。
 *
 * 用 `unnest` 一次提交而不是逐行 INSERT 的原因与 ASIN 清单一致：逐行插入 500 条光往返
 * 就是分钟级，而这是一次导入里最容易被用户察觉的等待。
 *
 * 并发下仍可能撞上唯一索引（两个导入同时进行）：**单事务 + 冲突即整体回滚**，
 * 报 409 让用户重试，不做"部分成功"——部分成功的导入结果无法向用户解释清楚。
 */
export async function insertCandidateEntries({ userId, entries }) {
  if (entries.length === 0) return { added: 0, items: [] }

  const total = await countCandidates(userId)
  if (total + entries.length > MAX_CANDIDATES_PER_USER) {
    throw new ProductDevValidationError(
      `候选池最多保存 ${MAX_CANDIDATES_PER_USER} 条，当前已有 ${total} 条，本次将新增 ${entries.length} 条，超出上限。请先清理不再跟进的候选。`
    )
  }

  const marketplaces = entries.map((entry) => entry.marketplace ?? DEFAULT_MARKETPLACE)
  const asins = entries.map((entry) => entry.asin ?? null)
  const names = entries.map((entry) => entry.product_name ?? '')
  const categories = entries.map((entry) => entry.category ?? '')
  const prices = entries.map((entry) => entry.target_price ?? null)
  const stages = entries.map((entry) => entry.stage ?? 'candidate')
  const notes = entries.map((entry) => entry.note ?? null)
  const attributes = entries.map((entry) => JSON.stringify(entry.attributes ?? {}))

  try {
    const { rows } = await query(
      `INSERT INTO product_dev_candidates
         (owner_user_id, marketplace, asin, product_name, category, target_price, stage, note, attributes, source)
       SELECT $1, m, a, n, c, p, s, nt, at::jsonb, 'import'
         FROM unnest(
           $2::text[], $3::text[], $4::text[], $5::text[],
           $6::numeric[], $7::text[], $8::text[], $9::text[]
         ) AS t(m, a, n, c, p, s, nt, at)
       RETURNING ${CANDIDATE_COLUMNS}`,
      [userId, marketplaces, asins, names, categories, prices, stages, notes, attributes]
    )
    return { added: rows.length, items: rows.map(toCandidateRow) }
  } catch (error) {
    if (error?.code === '23505') {
      throw new ProductDevConflictError(
        '导入过程中发现重复的候选（同站点同 ASIN），本次导入已全部取消。请重新预览后再导入。'
      )
    }
    throw error
  }
}

/* ---------- 数据库：导入编排 ---------- */

/**
 * 解析导入内容（文件缓冲或文本），返回**预览结果**（不写库）。
 *
 * 文件与文本两条入口共用同一套列识别与四分类，区别只在"二维行从哪来"。
 */
export async function parseImport({ userId, rows, text, fileName = '' }) {
  const knownKeys = await loadCandidateKeys(userId)

  let parsed
  if (Array.isArray(rows)) {
    parsed = parseProductDevRows(rows, { knownKeys })
  } else {
    // 先按表格文本试；不是表格就回退到"一行一个产品名称 / ASIN"
    parsed = parseProductDevTableText(text, { knownKeys })
    if (!parsed) {
      parsed = parseProductDevTextLines(text, { knownKeys })
    }
  }

  const duplicated = parsed.entries.filter((entry) => entry.duplicated)
  const fresh = parsed.entries.filter((entry) => !entry.duplicated)

  return {
    fileName: fileName || null,
    headerRecognized: parsed.headerRecognized,
    columns: parsed.columns,
    extraColumns: parsed.extraColumns,
    maxRows: MAX_IMPORT_ROWS,
    // 预览里带上"这一批会写进去的前 5 条"，让用户在确认前就能看出列是不是对上了
    preview: fresh.slice(0, 5).map((entry) => ({
      line: entry.line,
      marketplace: entry.marketplace,
      asin: entry.asin,
      product_name: entry.product_name,
      category: entry.category,
      target_price: entry.target_price,
      stage: entry.stage,
      stageLabel: STAGE_LABELS[entry.stage] ?? entry.stage,
      attributes: entry.attributes,
    })),
    counts: {
      added: fresh.length,
      duplicated: duplicated.length,
      repeated: parsed.repeated.length,
      invalid: parsed.invalid.length,
      emptyRows: parsed.emptyRows,
    },
    duplicated: duplicated.map((entry) => ({
      line: entry.line,
      label: entry.asin || entry.product_name,
    })),
    repeated: parsed.repeated,
    invalid: parsed.invalid,
    // 价格列有内容但读不出数字的行：单独列出，避免用户以为"价格都导进来了"
    priceUnparsed: parsed.entries
      .filter((entry) => entry.price_unparsed)
      .map((entry) => ({ line: entry.line, value: entry.price_unparsed })),
    _fresh: fresh,
  }
}

/** 正式导入：把预览里筛出的新增条目写入候选池。 */
export async function commitImport({ userId, preview }) {
  const result = await insertCandidateEntries({ userId, entries: preview._fresh ?? [] })
  return {
    added: result.added,
    counts: preview.counts,
    duplicated: preview.duplicated,
    repeated: preview.repeated,
    invalid: preview.invalid,
    priceUnparsed: preview.priceUnparsed,
  }
}

/* ---------- 数据库：对比 ---------- */

/**
 * 对比区间解析。
 *
 * 与竞品分析、ASIN 清单同一套规则：显式区间优先；否则以**该站点报表数据的最新日期**为终点
 * 向前取 `windowDays`。用数据最新日期而不是今天做锚点，是因为报表由人工导出、可能滞后数天，
 * 以今天为终点会得到一个大部分为空的区间，看起来像"没有数据"。
 */
export async function resolveCompareWindow({
  marketplace,
  windowDays,
  startDate,
  endDate,
}) {
  const explicit = startDate !== undefined && startDate !== null && startDate !== ''
  const explicitEnd = endDate !== undefined && endDate !== null && endDate !== ''

  if (explicit || explicitEnd) {
    if (!explicit || !explicitEnd) {
      throw new ProductDevValidationError('自定义区间需要同时提供开始与结束日期。')
    }
    const start = normalizeDateInput(startDate, '开始日期')
    const end = normalizeDateInput(endDate, '结束日期')
    if (start > end) throw new ProductDevValidationError('开始日期不能晚于结束日期。')
    const days = diffDays(start, end) + 1
    if (days > MAX_RANGE_DAYS) {
      throw new ProductDevValidationError(`自定义区间最长 ${MAX_RANGE_DAYS} 天。`)
    }
    return { startDate: start, endDate: end, windowDays: days }
  }

  const raw = windowDays === undefined || windowDays === null || windowDays === '' ? DEFAULT_WINDOW_DAYS : windowDays
  const days = Number(raw)
  if (!Number.isInteger(days) || days < MIN_WINDOW_DAYS || days > MAX_WINDOW_DAYS) {
    throw new ProductDevValidationError(
      `统计天数需要是 ${MIN_WINDOW_DAYS}~${MAX_WINDOW_DAYS} 之间的整数。`
    )
  }

  const anchor = (await queryLatestAmazonDate({ marketplace })) ?? null
  const end = anchor ?? new Date().toISOString().slice(0, 10)
  return {
    startDate: shiftDays(end, -(days - 1)),
    endDate: end,
    windowDays: days,
    marketplaceSource: anchor ? 'auto' : 'no_data',
  }
}

/**
 * 按 ASIN 批量取我方报表指标。
 *
 * 一次查询取回全部行再按 ASIN 分组汇总（而不是"每个 ASIN 查一次"）：10 个候选逐个查
 * 就是 20 次数据库往返，而这 20 次完全可以用两次查询完成。汇总口径走 `analytics.mjs`，
 * 与 AI 助手、竞品分析同源。
 *
 * **广告销售额与业务销售额分开返回**（`adSales` / `businessSales`）：两者都叫「销售额」，
 * 混成一个字段会让 ACoS 与销售额口径互相冲突（`analytics.mjs` 的
 * `mergeAdAndBusinessSummary` 就是为这个坑写的）。
 */
export async function loadMetricsByAsin({ asins, marketplace, startDate, endDate }) {
  const unique = [...new Set(asins.filter(Boolean))]
  if (unique.length === 0) return new Map()

  const [adsRows, salesRows] = await Promise.all([
    queryAdsDailyByAsins({ asins: unique, marketplace, startDate, endDate }),
    querySalesDailyByAsins({ asins: unique, marketplace, startDate, endDate }),
  ])

  const adsByAsin = new Map()
  for (const row of adsRows) {
    if (!adsByAsin.has(row.asin)) adsByAsin.set(row.asin, [])
    adsByAsin.get(row.asin).push(row)
  }
  const salesByAsin = new Map()
  for (const row of salesRows) {
    if (!salesByAsin.has(row.asin)) salesByAsin.set(row.asin, [])
    salesByAsin.get(row.asin).push(row)
  }

  const result = new Map()
  for (const asin of unique) {
    const ads = adsByAsin.get(asin) ?? []
    const sales = salesByAsin.get(asin) ?? []
    if (ads.length === 0 && sales.length === 0) continue
    const adSummary = summarizeAds(ads)
    const salesSummary = summarizeSales(sales)
    result.set(asin, {
      impressions: adSummary.impressions,
      clicks: adSummary.clicks,
      spend: adSummary.spend,
      adSales: adSummary.sales,
      orders: adSummary.orders,
      acos: adSummary.acos,
      ctr: adSummary.ctr,
      cvr: adSummary.cvr,
      cpc: adSummary.cpc,
      units: salesSummary.units,
      businessSales: salesSummary.sales,
      returns: salesSummary.returns,
      returnRate: salesSummary.returnRate,
    })
  }
  return result
}

/**
 * 装配一次对比（不落库）。
 *
 * 站点是**硬约束**：候选池允许混站点，但一次对比只能选同一站点 —— 不同站点的数字
 * 放在一起比是错的结论，而不是"不够精确"的结论。这里直接拒绝并说清原因，
 * 而不是悄悄按第一个候选的站点取数（那会让用户以为自己看到的对比是有效的）。
 */
export async function buildComparison({ userId, candidateIds, windowDays, startDate, endDate }) {
  const ids = (candidateIds ?? []).map((value) => Number(value))
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new ProductDevValidationError('候选 ID 必须是正整数。')
  }
  if (ids.length < MIN_COMPARE_ITEMS) {
    throw new ProductDevValidationError(`请至少选择 ${MIN_COMPARE_ITEMS} 个候选再进行对比。`)
  }
  if (ids.length > MAX_COMPARE_ITEMS) {
    throw new ProductDevValidationError(
      `一次最多对比 ${MAX_COMPARE_ITEMS} 个候选，当前选了 ${ids.length} 个。`
    )
  }
  if (new Set(ids).size !== ids.length) {
    throw new ProductDevValidationError('同一个候选不能重复参与对比。')
  }

  const candidates = await getCandidatesByIds(userId, ids)
  if (candidates.length !== ids.length) {
    throw new ProductDevNotFoundError('部分候选不存在或不属于当前账号，请刷新候选池后重试。')
  }

  const marketplaces = [...new Set(candidates.map((item) => item.marketplace))]
  if (marketplaces.length > 1) {
    const labels = marketplaces.map((code) => `${MARKETPLACE_LABELS[code] ?? code}(${code})`)
    throw new ProductDevValidationError(
      `选中的候选横跨多个站点：${labels.join('、')}。广告与销售日报按站点分别存储，把不同站点的数字放在一起对比会得到错误结论，请只勾选同一站点的候选。`
    )
  }
  const marketplace = marketplaces[0]
  const window = await resolveCompareWindow({ marketplace, windowDays, startDate, endDate })

  const asins = candidates.map((item) => item.asin).filter(Boolean)
  const [metricsByAsin, adsFreshness, salesFreshness] = await Promise.all([
    loadMetricsByAsin({
      asins,
      marketplace,
      startDate: window.startDate,
      endDate: window.endDate,
    }),
    datasetFreshnessOf('amazon_ads_daily'),
    datasetFreshnessOf('amazon_sales_daily'),
  ])

  const dynamic = collectDynamicDimensions(candidates)
  const rows = buildComparisonRows({
    candidates,
    metricsByAsin,
    dynamicKeys: dynamic.keys,
  })

  const dimensions = [
    ...MANUAL_DIMENSIONS,
    ...dynamic.keys.map((key) => ({
      key: `${ATTRIBUTE_KEY_PREFIX}${key}`,
      label: key,
      source: 'manual',
      format: 'text',
    })),
    ...REPORT_DIMENSIONS,
  ]

  const withData = rows.filter((row) => row.coverage === 'ok').length

  return {
    marketplace,
    marketplaceLabel: MARKETPLACE_LABELS[marketplace] ?? marketplace,
    marketplaceSource: window.marketplaceSource ?? 'explicit',
    startDate: window.startDate,
    endDate: window.endDate,
    windowDays: window.windowDays,
    candidateIds: ids,
    candidateCount: candidates.length,
    coverage: {
      withData,
      withoutData: candidates.length - withData,
      note:
        withData === candidates.length
          ? '本次对比的候选全部关联到了我方报表数据。'
          : `${candidates.length} 个候选里有 ${candidates.length - withData} 个没有我方报表数据（报表指标按「—」展示）。候选通常尚未上架，这是正常状态。`,
    },
    dimensions,
    omittedDimensionCount: dynamic.omitted,
    rows,
    // 结果排序与展示顺序由服务端定：先人工录入的选品字段，再附加维度，最后才是我方报表指标
    dataFreshness: combineFreshness([adsFreshness, salesFreshness]),
    note: buildComparisonNote({
      marketplaceLabel: MARKETPLACE_LABELS[marketplace] ?? marketplace,
      startDate: window.startDate,
      endDate: window.endDate,
      omitted: dynamic.omitted,
    }),
    // 明确声明本模块不产出结论，避免前端或用户期待一个"选品建议"
    conclusionNote:
      '本页只呈现事实，不给出「建议开发 / 不建议开发」的结论：当前没有可复算的选品判定规则，凭推测下结论会把主观判断包装成数据结论。',
  }
}

/** 对比结果落库（快照冻结：回看读的是当时的结果，不用今天的数据重算）。 */
export async function recordComparison({ userId, result, title = '' }) {
  const { rows } = await query(
    `INSERT INTO product_dev_comparisons
       (owner_user_id, title, marketplace, candidate_ids, dimensions, result, start_date, end_date)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8)
     RETURNING id, title, marketplace, candidate_ids, start_date, end_date, created_at`,
    [
      userId,
      String(title ?? '').slice(0, 200),
      result.marketplace,
      JSON.stringify(result.candidateIds),
      JSON.stringify(result.dimensions),
      JSON.stringify(result),
      result.startDate,
      result.endDate,
    ]
  )
  return rows[0]
}

export async function listComparisons(userId, limit = 10) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50)
  const { rows } = await query(
    `SELECT id, title, marketplace, candidate_ids, start_date, end_date, created_at,
            jsonb_array_length(candidate_ids) AS candidate_count
       FROM product_dev_comparisons
      WHERE owner_user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, safeLimit]
  )
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    marketplace: row.marketplace,
    candidateCount: row.candidate_count,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
  }))
}

export async function getComparison(userId, id) {
  const { rows } = await query(
    `SELECT id, result, created_at FROM product_dev_comparisons
      WHERE id = $1 AND owner_user_id = $2`,
    [id, userId]
  )
  if (!rows[0]) return null
  return {
    id: rows[0].id,
    createdAt: rows[0].created_at,
    result: rows[0].result ?? null,
  }
}

export async function deleteComparison(userId, id) {
  const { rowCount } = await query(
    'DELETE FROM product_dev_comparisons WHERE id = $1 AND owner_user_id = $2',
    [id, userId]
  )
  if (!rowCount) throw new ProductDevNotFoundError('对比记录不存在。')
  return { id, deleted: true }
}

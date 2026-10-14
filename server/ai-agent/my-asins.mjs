/**
 * 「我的 ASIN」领域层（2026-09-18 取代 ASIN 清单）。
 *
 * 产品定位：一个账号**一份** ASIN 列表，用来记住"我负责的这批商品"，
 * 之后在页面按区间看它们的花费与销量，或在对话里直接问"我这批货这 30 天怎么样"。
 *
 * 与原「ASIN 清单」的差别（用户 2026-09-18 决策）：
 * 1. **没有清单这一层**：账号即集合，不再有名称/说明/多清单切换，
 *    因此也没有"同名冲突"与"清单数量上限"。
 * 2. **站点挂在每条 ASIN 上**：广告与销售日报按 `(asin, marketplace)` 存储，
 *    清单消失后站点必须跟着条目走，否则取不到数；同一账号可以有多个站点的 ASIN，
 *    但**跨站点的金额/ACoS 永远不合算**（由调用方按站点分组，见 `myAsinMetricsPayload`）。
 * 3. **上限只有一条**：单账号 5000 条，超限报错不截断。
 *
 * 两条不可动摇的口径：
 * - ASIN 解析复用 `competitor-analysis.mjs` 的 `parseAsinList`，表格形态交给 `watchlist-table.mjs`，
 *   本文件只做"条目 → 落库"的领域判断，不重写识别规则；
 * - 账号隔离：所有查询都带 `owner_user_id`，他人（含管理员）访问一律 404。
 */
import { query } from '../db.mjs'
import {
  MAX_RANGE_DAYS,
  diffDays,
  extractAsin,
  normalizeDateInput,
  parseAsinList,
} from '../competitor-analysis.mjs'
import {
  MAX_TABLE_ROWS,
  analyzeTableRows,
  parseTableText,
  readTableRowsFromBuffer,
} from './watchlist-table.mjs'

/** 校验类错误 → 400。 */
export class MyAsinValidationError extends Error {}

/** 条目不存在或不属于当前账号 → 404（不区分"不存在"与"无权"，避免探测）。 */
export class MyAsinNotFoundError extends Error {}

/** 单账号 ASIN 数上限（所有站点合计）。 */
export const MAX_ITEMS_PER_USER = 5000

/** 单次导入上限：一次导入即可填满整个集合。 */
export const MAX_BULK_ASINS = MAX_TABLE_ROWS

export const MAX_ALIAS_LENGTH = 120
export const MAX_NOTE_LENGTH = 300

/** 站点枚举（与工具契约、报表数据的 marketplace 维度一致）。 */
export const MY_ASIN_MARKETPLACES = [
  'US',
  'UK',
  'DE',
  'FR',
  'IT',
  'ES',
  'JP',
  'CA',
  'MX',
  'AU',
]

export const DEFAULT_MARKETPLACE = 'US'

export const MARKETPLACE_LABELS = {
  US: '美国',
  UK: '英国',
  DE: '德国',
  FR: '法国',
  IT: '意大利',
  ES: '西班牙',
  JP: '日本',
  CA: '加拿大',
  MX: '墨西哥',
  AU: '澳大利亚',
}

/* ---------- 纯函数：校验与合并计划（单测直接覆盖，不需要数据库） ---------- */

/** 可选文本字段：空串按"清空"处理（返回 null），超长报错。 */
export function optionalText(raw, { max, label }) {
  if (raw === undefined) return undefined
  if (raw === null) return null
  const text = String(raw).replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (text.length > max) {
    throw new MyAsinValidationError(`${label}不能超过 ${max} 个字符。`)
  }
  return text
}

/** 站点：大写、必须在枚举内。 */
export function parseMarketplace(raw) {
  const text = String(raw ?? DEFAULT_MARKETPLACE)
    .trim()
    .toUpperCase()
  if (!MY_ASIN_MARKETPLACES.includes(text)) {
    throw new MyAsinValidationError(
      `站点 ${text || '(空)'} 不在支持范围内，可选：${MY_ASIN_MARKETPLACES.join('、')}。`
    )
  }
  return text
}

/**
 * 单条 ASIN 归一化：去空白、大写、**校验格式**（空值报错 —— 安静失败会让用户以为加进去了）。
 *
 * 2026-09-18 修：此前只做去空白 + 大写、**不校验格式**，任何文本都能入库 ——
 * 实测库里出现了一条 ASIN = 「测试」（中文）的清单数据，之后指标查询与 AI 工具都拿它没办法
 * （用户侧表现为"查不到 ASIN 数据"）。合法性判定复用 `extractAsin`（与批量导入同一口径），
 * 它同时认"10 位字母数字"与商品链接里的 ASIN。
 */
export function normalizeAsin(raw) {
  const text = String(raw ?? '').trim()
  if (!text) throw new MyAsinValidationError('ASIN 不能为空。')
  const asin = extractAsin(text)
  if (!asin) {
    throw new MyAsinValidationError(
      `ASIN 格式不正确：${text.slice(0, 24)}。应为 10 位字母或数字（例如 B0XXXXXXXX），也可以直接粘贴商品链接。`
    )
  }
  return asin
}

/** 站点 + ASIN 的合并键：同一 ASIN 在不同站点是两条合法数据。 */
export function itemKey(asin, marketplace) {
  return `${String(asin ?? '').toUpperCase()}::${String(marketplace ?? DEFAULT_MARKETPLACE).toUpperCase()}`
}

/** 纯 ASIN 文本 → 条目（逗号/换行/顿号分隔、支持商品链接）。 */
export function parseAsinText(raw, marketplace = DEFAULT_MARKETPLACE) {
  const site = parseMarketplace(marketplace)
  const { asins, invalid, duplicates } = parseAsinList(raw)
  if (asins.length > MAX_BULK_ASINS) {
    throw new MyAsinValidationError(
      `一次最多导入 ${MAX_BULK_ASINS} 个 ASIN（本次识别到 ${asins.length} 个）。`
    )
  }
  return { asins, invalid, repeated: duplicates ?? [], marketplace: site }
}

/**
 * 解析"新增 ASIN"的输入（**表格感知**）。
 *
 * 两条路径共用同一套四分类口径：
 * - 表格形态（多列 / TSV / 带表头，即"从 Excel 复制粘贴一片区域"）→ `watchlist-table.mjs`，
 *   站点、别名、备注列会一并带进来；站点列缺失或为空时用 `defaultMarketplace`；
 * - 纯 ASIN 文本 → `parseAsinText`，全部落到 `defaultMarketplace`。
 *
 * 返回的 `entries` 已带 `marketplace`，调用方无需再补。
 */
export function parseAddPayload({ raw, defaultMarketplace = DEFAULT_MARKETPLACE }) {
  const site = parseMarketplace(defaultMarketplace)
  const table = parseTableText(raw, {
    maxRows: MAX_BULK_ASINS,
    maxAliasLength: MAX_ALIAS_LENGTH,
    maxNoteLength: MAX_NOTE_LENGTH,
    defaultMarketplace: site,
  })

  if (table) {
    if (table.entries.length === 0) {
      throw new MyAsinValidationError(
        table.invalid.length > 0
          ? `没有识别到合法 ASIN：第 ${table.invalid[0].line} 行「${table.invalid[0].value}」等 ${table.invalid.length} 行无法识别。`
          : '表格里没有可导入的数据行。'
      )
    }
    return {
      table: true,
      entries: table.entries.map((entry) => ({
        asin: entry.asin,
        marketplace: entry.marketplace ?? site,
        alias: entry.alias ?? null,
        note: entry.note ?? null,
        line: entry.line ?? null,
      })),
      invalid: table.invalid.map((item) => item.value),
      invalidRows: table.invalid,
      repeated: table.repeated.map((item) => item.asin),
      repeatedRows: table.repeated,
      columns: table.columns,
      mapping: table.mapping,
    }
  }

  const legacy = parseAsinText(raw, site)
  return {
    table: false,
    entries: legacy.asins.map((asin) => ({
      asin,
      marketplace: site,
      alias: null,
      note: null,
      line: null,
    })),
    invalid: legacy.invalid,
    invalidRows: [],
    repeated: legacy.repeated,
    repeatedRows: [],
    columns: [],
    mapping: { asin: null, marketplace: null, alias: null, note: null },
  }
}

/**
 * 计算本次导入的落库计划（纯函数）。
 *
 * 以 `(asin, marketplace)` 为键去重 —— 同一个 ASIN 加到另一个站点是**合法新增**，
 * 按 ASIN 去重会把"同款在美国站和德国站"当成重复，等于丢掉一个站点。
 *
 * @param {Array<{asin: string, marketplace: string, alias?: string|null, note?: string|null}>} entries
 * @param {Array<{asin: string, marketplace: string}>} existing
 */
export function planEntryMerge(entries, existing, { maxItems = MAX_ITEMS_PER_USER } = {}) {
  const existingSet = new Set(
    (existing ?? []).map((item) => itemKey(item.asin, item.marketplace))
  )
  const toAdd = []
  const duplicated = []
  for (const entry of entries ?? []) {
    const asin = String(entry?.asin ?? '').toUpperCase()
    if (!asin) continue
    const marketplace = String(entry?.marketplace ?? DEFAULT_MARKETPLACE).toUpperCase()
    const key = itemKey(asin, marketplace)
    if (existingSet.has(key)) {
      duplicated.push(asin)
      continue
    }
    existingSet.add(key)
    toAdd.push({
      asin,
      marketplace,
      alias: entry?.alias ? String(entry.alias) : null,
      note: entry?.note ? String(entry.note) : null,
    })
  }
  const total = new Set(
    (existing ?? []).map((item) => itemKey(item.asin, item.marketplace))
  ).size
  const overflow = total + toAdd.length > maxItems
  return {
    toAdd,
    duplicated,
    overflow,
    overflowBy: overflow ? total + toAdd.length - maxItems : 0,
  }
}

/* ---------- 数据库访问 ---------- */

function mapItemRow(row) {
  return {
    id: row.id,
    asin: row.asin,
    marketplace: row.marketplace,
    alias: row.alias ?? null,
    note: row.note ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const ITEM_COLUMNS = `id, asin, marketplace, alias, note, created_at, updated_at`

/** 当前账号的全部 ASIN（按加入顺序）。 */
export async function listMyAsins({ userId }) {
  const { rows } = await query(
    `SELECT ${ITEM_COLUMNS}
       FROM my_asin_items
      WHERE owner_user_id = $1
      ORDER BY created_at ASC, id ASC`,
    [userId]
  )
  return rows.map(mapItemRow)
}

/** 只取 `(asin, marketplace)` 键，用于合并计划（不读别名备注）。 */
export async function listMyAsinKeys({ userId }) {
  const { rows } = await query(
    `SELECT asin, marketplace FROM my_asin_items WHERE owner_user_id = $1`,
    [userId]
  )
  return rows.map((row) => ({ asin: row.asin, marketplace: row.marketplace }))
}

/**
 * 批量写入条目：重复的静默跳过（数据库唯一约束兜底），返回**实际新增**的行。
 *
 * 用 `unnest` 四数组一次插入而不是逐条 INSERT：5000 条时逐条往返是分钟级，
 * 一次语句是毫秒级。别名/备注跟着条目走 —— 那是用户实际维护的信息。
 */
async function insertItems({ userId, entries }) {
  if (entries.length === 0) return []
  const asins = entries.map((entry) => entry.asin)
  const marketplaces = entries.map((entry) => entry.marketplace)
  const aliases = entries.map((entry) => entry.alias ?? null)
  const notes = entries.map((entry) => entry.note ?? null)
  const { rows } = await query(
    `INSERT INTO my_asin_items (owner_user_id, asin, marketplace, alias, note)
     SELECT $1, t.asin, t.marketplace, t.alias, t.note
       FROM unnest($2::text[], $3::text[], $4::text[], $5::text[])
         AS t(asin, marketplace, alias, note)
     ON CONFLICT (owner_user_id, asin, marketplace) DO NOTHING
     RETURNING id, asin, marketplace`,
    [userId, asins, marketplaces, aliases, notes]
  )
  // 带上 id：单条添加时若同时录入了人工指标，前端需要它去 PUT /items/:id/metrics
  return rows.map((row) => ({
    id: Number(row.id),
    asin: row.asin,
    marketplace: row.marketplace,
  }))
}

/**
 * 新增 ASIN（单条与批量同一条路径）。
 *
 * 报告四类结果：`added`（真正新增）、`duplicated`（账号里已有同一个 ASIN + 站点）、
 * `repeated`（本次输入内部重复）、`invalid`（无法识别）。超上限时报错并保持数据不变 ——
 * 允许"部分导入"会让界面上的条数与用户预期不符。
 */
export async function addMyAsins({
  userId,
  entries = [],
  repeated = [],
  invalid = [],
  defaultMarketplace = DEFAULT_MARKETPLACE,
}) {
  const site = parseMarketplace(defaultMarketplace)
  const normalized = []
  for (const entry of entries) {
    const asin = normalizeAsin(entry?.asin)
    const marketplace =
      entry?.marketplace === undefined || entry?.marketplace === null || entry?.marketplace === ''
        ? site
        : parseMarketplace(entry.marketplace)
    normalized.push({
      asin,
      marketplace,
      alias: optionalText(entry?.alias, { max: MAX_ALIAS_LENGTH, label: '别名' }) ?? null,
      note: optionalText(entry?.note, { max: MAX_NOTE_LENGTH, label: '备注' }) ?? null,
    })
  }

  if (normalized.length === 0) {
    throw new MyAsinValidationError(
      invalid.length > 0
        ? `没有识别到合法 ASIN：${invalid.slice(0, 5).join('、')}${invalid.length > 5 ? ' 等' : ''}。`
        : '请先填写至少一个 ASIN。'
    )
  }

  const existing = await listMyAsinKeys({ userId })
  const plan = planEntryMerge(normalized, existing)
  if (plan.overflow) {
    throw new MyAsinValidationError(
      `「我的 ASIN」最多 ${MAX_ITEMS_PER_USER} 条（当前 ${existing.length} 条，本次可再加 ${Math.max(
        0,
        MAX_ITEMS_PER_USER - existing.length
      )} 条）。`
    )
  }

  const added = await insertItems({ userId, entries: plan.toAdd })
  return {
    added,
    duplicated: plan.duplicated,
    repeated,
    invalid,
    itemCount: existing.length + added.length,
  }
}

/**
 * 修改条目：ASIN / 站点 / 别名 / 备注（2026-09-18 起 ASIN 也可改）。
 *
 * `undefined` 表示"这次不改这一列"（与"改成空"区分开）：前端只提交用户动过的字段。
 * `asin` 与 `marketplace` 都是**身份的一部分**（唯一键 `(owner, asin, 站点)`）：
 * 改成一个已存在的组合会被数据库拦下，这里转成可读的校验错误而不是 500 ——
 * "同一款商品在两个站点各一条"是合法数据，但"同站点同 ASIN 两条"不是。
 *
 * 改 ASIN / 站点**不会动任何报表数据**：指标按新身份重新取数（页面与 AI 工具仍是同一套口径）。
 */
export async function updateMyAsinItem({ userId, itemId, asin, alias, note, marketplace }) {
  const nextAsin = asin === undefined ? undefined : normalizeAsin(asin)
  const nextAlias = optionalText(alias, { max: MAX_ALIAS_LENGTH, label: '别名' })
  const nextNote = optionalText(note, { max: MAX_NOTE_LENGTH, label: '备注' })
  const nextMarketplace = marketplace === undefined ? undefined : parseMarketplace(marketplace)

  try {
    const { rows } = await query(
      `UPDATE my_asin_items
          SET asin = CASE WHEN $3::boolean THEN $4 ELSE asin END,
              alias = CASE WHEN $5::boolean THEN $6 ELSE alias END,
              note = CASE WHEN $7::boolean THEN $8 ELSE note END,
              marketplace = CASE WHEN $9::boolean THEN $10 ELSE marketplace END,
              updated_at = NOW()
        WHERE id = $1 AND owner_user_id = $2
        RETURNING ${ITEM_COLUMNS}`,
      [
        itemId,
        userId,
        asin !== undefined,
        nextAsin ?? null,
        alias !== undefined,
        nextAlias ?? null,
        note !== undefined,
        nextNote ?? null,
        marketplace !== undefined,
        nextMarketplace ?? null,
      ]
    )
    if (!rows[0]) throw new MyAsinNotFoundError('这个 ASIN 不在你的列表里。')
    return { item: mapItemRow(rows[0]) }
  } catch (error) {
    if (error?.code === '23505') {
      throw new MyAsinValidationError('这个 ASIN 在目标站点已经有一条记录了。')
    }
    throw error
  }
}

/** 从「我的 ASIN」移除一条。 */
export async function removeMyAsinItem({ userId, itemId }) {
  const { rows } = await query(
    `DELETE FROM my_asin_items WHERE id = $1 AND owner_user_id = $2 RETURNING id`,
    [itemId, userId]
  )
  if (!rows[0]) throw new MyAsinNotFoundError('这个 ASIN 不在你的列表里。')
  return { id: rows[0].id }
}

/**
 * 从表格文件导入（CSV / XLSX）：**先预览后落库**。
 *
 * 为什么分两阶段（`dryRun`）：用户的表里常常混着别的列，甚至第一列不是 ASIN。
 * 一步到位会让人"先导进去再看结果"，而列表里多出来的脏 ASIN 得手工删。
 * 预览阶段不写库，正式导入时前端重新上传同一个文件 —— 服务端因此无状态。
 *
 * `defaultMarketplace` 是"表格里没写站点"时的落点，由用户在预览界面上选。
 */
export async function importMyAsinTable({
  userId,
  buffer,
  fileName,
  dryRun = false,
  defaultMarketplace = DEFAULT_MARKETPLACE,
}) {
  const site = parseMarketplace(defaultMarketplace)
  const { rows, format, encoding } = await readTableRowsFromBuffer({ buffer, fileName })
  const analysis = analyzeTableRows(rows, {
    maxRows: MAX_BULK_ASINS,
    maxAliasLength: MAX_ALIAS_LENGTH,
    maxNoteLength: MAX_NOTE_LENGTH,
    defaultMarketplace: site,
  })

  if (analysis.entries.length === 0) {
    const first = analysis.invalid[0]
    throw new MyAsinValidationError(
      first
        ? `没有识别到合法 ASIN：第 ${first.line} 行「${first.value}」等 ${analysis.invalid.length} 行无法识别。`
        : '表格里没有可导入的数据行。'
    )
  }

  const entries = analysis.entries.map((entry) => ({
    asin: entry.asin,
    marketplace: entry.marketplace ?? site,
    alias: entry.alias ?? null,
    note: entry.note ?? null,
  }))

  const existing = await listMyAsinKeys({ userId })
  const plan = planEntryMerge(entries, existing)

  const summary = {
    format,
    encoding: encoding ?? null,
    columns: analysis.columns,
    mapping: analysis.mapping,
    headerRow: analysis.headerRow,
    defaultMarketplace: site,
    entries: entries.length,
    invalid: analysis.invalid,
    repeated: analysis.repeated,
    duplicated: plan.duplicated,
    willAdd: plan.toAdd.slice(0, 5),
    addCount: plan.toAdd.length,
    itemCount: existing.length,
    capacity: MAX_ITEMS_PER_USER,
    overflow: plan.overflow,
    overflowBy: plan.overflowBy,
  }

  if (dryRun) return { dryRun: true, summary, added: [] }

  if (plan.overflow) {
    throw new MyAsinValidationError(
      `导入后会有 ${existing.length + plan.toAdd.length} 条 ASIN，超出上限 ${MAX_ITEMS_PER_USER} 条（多出 ${
        plan.overflowBy
      } 条）。当前已有 ${existing.length} 条，本次表格可导入 ${Math.max(
        0,
        MAX_ITEMS_PER_USER - existing.length
      )} 条。`
    )
  }

  const added = await insertItems({ userId, entries: plan.toAdd })
  return {
    dryRun: false,
    summary,
    added,
    itemCount: existing.length + added.length,
  }
}

/* ---------- 人工录入的区间指标（2026-09-18） ---------- */

/** 可以人工录入的指标列（与表格里的 6 个指标一一对应；「数据覆盖」由它们推导，不单独录）。 */
export const MANUAL_METRIC_FIELDS = [
  { key: 'spend', label: '花费', integer: false },
  { key: 'adSales', label: '广告销售额', integer: false },
  { key: 'orders', label: '广告订单', integer: true },
  { key: 'acos', label: 'ACoS', integer: false },
  { key: 'units', label: '销量', integer: true },
  { key: 'businessSales', label: '销售额', integer: false },
]

/** 按 id 读取本人条目（人工指标与后续编辑都要先确认归属）。 */
export async function findMyAsinItem({ userId, itemId }) {
  const { rows } = await query(
    `SELECT ${ITEM_COLUMNS} FROM my_asin_items WHERE id = $1 AND owner_user_id = $2`,
    [itemId, userId]
  )
  return rows[0] ? mapItemRow(rows[0]) : null
}

/**
 * 指标数值校验：`undefined` = 本次不改（保留原值），`null` / 空串 = 清空。
 *
 * 负数与超范围一律拒绝 —— 金额与计数没有负值，写进去只会污染合计，
 * 而合计是要拿去做决策的。
 */
function parseMetricNumber(raw, { label, integer }) {
  if (raw === undefined) return undefined
  if (raw === null || raw === '') return null
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new MyAsinValidationError(`${label}必须是数字。`)
  if (value < 0) throw new MyAsinValidationError(`${label}不能是负数。`)
  if (integer && !Number.isInteger(value)) {
    throw new MyAsinValidationError(`${label}必须是整数。`)
  }
  const max = integer ? 1_000_000_000 : 1_000_000_000_000
  if (value > max) throw new MyAsinValidationError(`${label}超出合理范围。`)
  return integer ? value : Math.round(value * 100) / 100
}

/** 人工指标的区间：必须是**具体起止日期**（相对区间会随报表最新日期漂移，填的数字会对不上账）。 */
function parseMetricPeriod({ startDate, endDate }) {
  if (!startDate || !endDate) {
    throw new MyAsinValidationError('人工指标需要同时指定开始与结束日期。')
  }
  const start = normalizeDateInput(startDate, '开始日期')
  const end = normalizeDateInput(endDate, '结束日期')
  if (start > end) throw new MyAsinValidationError('开始日期不能晚于结束日期。')
  const days = diffDays(start, end) + 1
  if (days > MAX_RANGE_DAYS) {
    throw new MyAsinValidationError(`区间不能超过 ${MAX_RANGE_DAYS} 天，请缩小范围后重试。`)
  }
  return { start, end }
}

function mapOverrideRow(row) {
  if (!row) return null
  return {
    itemId: Number(row.item_id),
    asin: row.asin,
    marketplace: row.marketplace,
    spend: row.spend === null ? null : Number(row.spend),
    adSales: row.ad_sales === null ? null : Number(row.ad_sales),
    orders: row.orders === null ? null : Number(row.orders),
    acos: row.acos === null ? null : Number(row.acos),
    units: row.units === null ? null : Number(row.units),
    businessSales: row.business_sales === null ? null : Number(row.business_sales),
  }
}

/**
 * 录入 / 更新一条人工指标（同一条目同一区间只有一条）。
 *
 * 六个数字**全部留空 = 清除**该区间的人工值（回到报表口径），而不是存一条全空记录 ——
 * 后者会让"这条到底是不是人工录的"变得无法判断。
 */
export async function upsertMyAsinMetricOverride({
  userId,
  itemId,
  startDate,
  endDate,
  metrics = {},
}) {
  const item = await findMyAsinItem({ userId, itemId })
  if (!item) throw new MyAsinNotFoundError('这个 ASIN 不在你的列表里。')
  const { start, end } = parseMetricPeriod({ startDate, endDate })

  const values = {}
  for (const field of MANUAL_METRIC_FIELDS) {
    values[field.key] = parseMetricNumber(metrics[field.key], field)
  }
  const filled = MANUAL_METRIC_FIELDS.filter(
    (field) => values[field.key] !== undefined && values[field.key] !== null
  )

  if (filled.length === 0) {
    await query(
      `DELETE FROM my_asin_metric_overrides
        WHERE item_id = $1 AND owner_user_id = $2 AND start_date = $3 AND end_date = $4`,
      [itemId, userId, start, end]
    )
    return { override: null }
  }

  const { rows } = await query(
    `INSERT INTO my_asin_metric_overrides
       (item_id, owner_user_id, asin, marketplace, start_date, end_date,
        spend, ad_sales, orders, acos, units, business_sales)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (item_id, start_date, end_date) DO UPDATE
        SET spend = EXCLUDED.spend,
            ad_sales = EXCLUDED.ad_sales,
            orders = EXCLUDED.orders,
            acos = EXCLUDED.acos,
            units = EXCLUDED.units,
            business_sales = EXCLUDED.business_sales,
            asin = EXCLUDED.asin,
            marketplace = EXCLUDED.marketplace,
            updated_at = NOW()
     RETURNING item_id, asin, marketplace, spend, ad_sales, orders, acos, units, business_sales`,
    [
      itemId,
      userId,
      item.asin,
      item.marketplace,
      start,
      end,
      values.spend ?? null,
      values.adSales ?? null,
      values.orders ?? null,
      values.acos ?? null,
      values.units ?? null,
      values.businessSales ?? null,
    ]
  )
  return { override: mapOverrideRow(rows[0]) }
}

/** 清除某条目在某区间的人工值。 */
export async function removeMyAsinMetricOverride({ userId, itemId, startDate, endDate }) {
  const item = await findMyAsinItem({ userId, itemId })
  if (!item) throw new MyAsinNotFoundError('这个 ASIN 不在你的列表里。')
  const { start, end } = parseMetricPeriod({ startDate, endDate })
  const { rows } = await query(
    `DELETE FROM my_asin_metric_overrides
      WHERE item_id = $1 AND owner_user_id = $2 AND start_date = $3 AND end_date = $4
      RETURNING id`,
    [itemId, userId, start, end]
  )
  return { removed: rows.length > 0 }
}

/**
 * 取某区间内的人工值，按 `itemId` 索引。
 *
 * 页面（`myAsinMetricsPayload`）与 AI 工具都从这里拿同一份数据，
 * 因此"页面看到的"和"AI 说的"在人工值这条链路上也不会分叉。
 */
export async function listMyAsinMetricOverrides({ userId, startDate, endDate }) {
  const { start, end } = parseMetricPeriod({ startDate, endDate })
  const { rows } = await query(
    `SELECT item_id, asin, marketplace, spend, ad_sales, orders, acos, units, business_sales
       FROM my_asin_metric_overrides
      WHERE owner_user_id = $1 AND start_date = $2 AND end_date = $3`,
    [userId, start, end]
  )
  const map = new Map()
  for (const row of rows) {
    const mapped = mapOverrideRow(row)
    map.set(mapped.itemId, mapped)
  }
  return map
}

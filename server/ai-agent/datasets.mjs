/**
 * 业务数据集的规格、校验与导入（需求文档 §5.3 / §8.5）。
 *
 * 设计要点：
 * 1. **列名以中文模板为准，同时接受常见别名**（Amazon 后台导出、人工整理的中文表头都能直接导入）；
 * 2. **缺必填列 → 整批拒绝**；多余列不拒绝，但会在导入结果里列出"已忽略的列"，让人看得见而不是静默丢弃；
 * 3. **行级解析失败默认整批拒绝**并给出失败行明细（最多展示前 20 行），避免脏数据混入数据集；
 *    可用 `onRowError: 'skip'` 放宽为"跳过并记录"，由调用方显式选择；
 * 4. 覆盖模式按数据自身的周期删除后写入；追加模式用 ON CONFLICT DO NOTHING，重复行计入 skipped；
 * 5. 失败也要落 `ai_imports`（status='failed' + fail_reason），否则管理员无法从页面看出失败原因。
 */
import { pool, query } from '../db.mjs'
import { CsvParseError, decodeCsvBuffer, parseCsvToObjects, toCsv } from './csv.mjs'

export class DatasetValidationError extends Error {}

export const MAX_IMPORT_BYTES = 8 * 1024 * 1024
export const MAX_IMPORT_ROWS = 50000
export const MAX_ERROR_DETAIL = 20

/** 站点名归一化：中文报表常写"美国站"，Amazon 报表用 US。 */
const MARKETPLACE_MAP = {
  美国: 'US',
  美国站: 'US',
  亚马逊美国: 'US',
  加拿大: 'CA',
  墨西哥: 'MX',
  英国: 'UK',
  英国站: 'UK',
  德国: 'DE',
  德国站: 'DE',
  法国: 'FR',
  法国站: 'FR',
  意大利: 'IT',
  西班牙: 'ES',
  日本: 'JP',
  日本站: 'JP',
  澳大利亚: 'AU',
  荷兰: 'NL',
  瑞典: 'SE',
  波兰: 'PL',
}

const CURRENCY_PATTERN = /[¥$€£,\s]/g

/** 解析日期：支持 ISO、斜杠格式、Excel 序列号；返回 YYYY-MM-DD 或 null。 */
export function parseDateValue(value) {
  const text = String(value ?? '').trim()
  if (!text) return null

  // Excel 把日期存成序列号时导出的是纯数字（1900 日期系统，含 1900 闰年 bug）
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const serial = Number(text)
    const base = Date.UTC(1899, 11, 30)
    const date = new Date(base + Math.round(serial) * 86400000)
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
  }

  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (iso) {
    const [, year, month, day] = iso
    return formatDateParts(year, month, day)
  }

  const slash = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/)
  if (slash) {
    const [, month, day, year] = slash
    // 中文/美国报表常见 月/日/年
    return formatDateParts(year, month, day)
  }

  const chinese = text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?/)
  if (chinese) {
    const [, year, month, day] = chinese
    return formatDateParts(year, month, day)
  }

  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10)
}

function formatDateParts(year, month, day) {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

/** 解析整数：容忍千分位、货币符号、空值。 */
export function parseIntValue(value, { fallback = null } = {}) {
  const text = String(value ?? '').replace(CURRENCY_PATTERN, '').trim()
  if (!text) return fallback
  const number = Number(text)
  if (!Number.isFinite(number)) return null
  return Math.round(number)
}

/**
 * 解析小数：容忍千分位、货币符号、百分号与全角符号。
 * 百分号按"数值本身即百分数"处理（"25.3%" → 25.3），与表内 ACoS 的存储口径一致。
 */
export function parseDecimalValue(value, { fallback = null } = {}) {
  const text = String(value ?? '')
    .replace(CURRENCY_PATTERN, '')
    .replace(/[%％]/g, '')
    // 负号有四种写法：ASCII 连字符、全角减号、破折号、U+2212 数学减号
    .replace(/[－—−–]/g, '-')
    .trim()
  if (!text) return fallback
  const number = Number(text)
  return Number.isFinite(number) ? Number(number.toFixed(6)) : null
}

/** 站点归一化：中文站点名转代码，未知值原样大写保留（不阻断导入）。 */
export function normalizeMarketplace(value, { fallback = 'US' } = {}) {
  const text = String(value ?? '').trim()
  if (!text) return fallback
  if (MARKETPLACE_MAP[text]) return MARKETPLACE_MAP[text]
  return text.toUpperCase().slice(0, 10)
}

const COLUMN_TYPES = {
  date: (value) => parseDateValue(value),
  string: (value) => {
    const text = String(value ?? '').trim()
    return text === '' ? null : text
  },
  integer: (value) => parseIntValue(value),
  decimal: (value) => parseDecimalValue(value),
  marketplace: (value) => normalizeMarketplace(value),
  timestamp: (value) => {
    const text = String(value ?? '').trim()
    if (!text) return null
    const date = new Date(text)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  },
}

function column(key, label, type, aliases, options = {}) {
  return { key, label, type, aliases: [label, key, ...aliases], ...options }
}

/**
 * 数据集规格。
 * 表列名与 `server/ai-agent/migrations.mjs` 的建表语句严格对应；
 * 中文列名即模板表头，别名覆盖 Amazon 后台与人工整理的常见写法。
 */
export const DATASET_SPECS = [
  {
    key: 'amazon_ads_daily',
    label: 'Amazon 广告日报',
    description: '广告活动/关键词层级的每日曝光、点击、花费、订单与销售额',
    table: 'amazon_ads_daily',
    periodColumn: 'stat_date',
    dateColumn: 'stat_date',
    columns: [
      column('stat_date', '日期', 'date', ['date', 'Date', '广告日期', '报告日期'], {
        required: true,
      }),
      column('asin', 'ASIN', 'string', ['asin', 'Asin', '商品ASIN', '子ASIN'], { required: true }),
      column('campaign', '广告活动', 'string', ['campaign', 'Campaign', 'Campaign Name', '广告活动名称', '广告组'], {
        default: '',
      }),
      column('marketplace', '站点', 'marketplace', ['marketplace', 'Marketplace', '国家', '站点代码'], {
        default: 'US',
      }),
      column('impressions', '曝光', 'integer', ['impressions', 'Impressions', '曝光量', '展示量'], {
        default: 0,
      }),
      column('clicks', '点击', 'integer', ['clicks', 'Clicks', '点击量'], { default: 0 }),
      column('spend', '花费', 'decimal', ['spend', 'Spend', '支出', '成本', '广告花费'], { default: 0 }),
      column('orders', '订单', 'integer', ['orders', 'Orders', '订单量', '7天订单', '14天订单'], {
        default: 0,
      }),
      column('sales', '销售额', 'decimal', ['sales', 'Sales', '销售', '7天销售额', '14天销售额'], {
        default: 0,
      }),
      column('acos', 'ACoS', 'decimal', ['acos', 'ACOS', 'Acos', '广告销售成本比'], { default: null }),
    ],
  },
  {
    key: 'amazon_sales_daily',
    label: 'Amazon 业务报告（销售日报）',
    description: 'ASIN 层级的每日销量、销售额与退货量',
    table: 'amazon_sales_daily',
    periodColumn: 'stat_date',
    dateColumn: 'stat_date',
    columns: [
      column('stat_date', '日期', 'date', ['date', 'Date', '报告日期'], { required: true }),
      column('asin', 'ASIN', 'string', ['asin', 'Asin', '商品ASIN', '子ASIN'], { required: true }),
      column('marketplace', '站点', 'marketplace', ['marketplace', 'Marketplace', '国家'], {
        default: 'US',
      }),
      column('units', '销量', 'integer', ['units', 'Units', '销量（件）', '已订购商品数量', '订单商品数'], {
        default: 0,
      }),
      column('sales', '销售额', 'decimal', ['sales', 'Sales', '已订购商品销售额', '销售额(USD)'], {
        default: 0,
      }),
      column('returns', '退货量', 'integer', ['returns', 'Returns', '退货数量', '退款量'], { default: 0 }),
    ],
  },
  {
    key: 'inventory_snapshot',
    label: '库存快照',
    description: 'SKU 维度的可用库存、在途与占用数量',
    table: 'inventory_snapshot',
    // 快照表没有"周期"概念：导入时点即快照时点，由表的 snapshot_at 默认值 NOW() 记录
    periodColumn: null,
    dateColumn: null,
    columns: [
      column('sku', 'SKU', 'string', ['sku', 'Sku', 'SKU编码', '商品SKU'], { required: true }),
      column('warehouse', '仓库', 'string', ['warehouse', 'Warehouse', '仓库名称', '库位'], { default: '' }),
      column('available', '可用库存', 'integer', ['available', 'Available', '可用数量', '可用'], {
        required: true,
      }),
      column('in_transit', '在途数量', 'integer', ['in_transit', 'In Transit', '在途', '在途库存'], {
        default: 0,
      }),
      column('reserved', '占用数量', 'integer', ['reserved', 'Reserved', '占用', '锁定量', '预留'], {
        default: 0,
      }),
    ],
  },
  {
    key: 'product_master',
    label: '产品主数据（SKU ↔ ASIN）',
    description: 'SKU 与 ASIN/站点的对应关系，用于把库存（按 SKU）与销售（按 ASIN）打通',
    table: 'product_master',
    // 主数据是"当前有效版本"的快照语义：覆盖导入整表替换
    periodColumn: null,
    dateColumn: null,
    columns: [
      column('sku', 'SKU', 'string', ['sku', 'Sku', 'SKU编码', '商品SKU', 'MSKU'], { required: true }),
      column('asin', 'ASIN', 'string', ['asin', 'Asin', '商品ASIN', '子ASIN'], { required: true }),
      column('marketplace', '站点', 'marketplace', ['marketplace', 'Marketplace', '国家', '站点代码'], {
        default: 'US',
      }),
      column('product_name', '商品名称', 'string', ['product_name', 'Product Name', '产品名称', '标题'], {
        default: '',
      }),
      column('category', '分类', 'string', ['category', 'Category', '品类'], { default: '' }),
      column('status', '状态', 'string', ['status', 'Status', '销售状态'], { default: '在售' }),
    ],
  },
  {
    key: 'order_snapshot',
    label: '订单快照',
    description: '订单号 + SKU 维度的订单状态与数量',
    table: 'order_snapshot',
    periodColumn: null,
    dateColumn: 'ordered_at',
    columns: [
      column('order_no', '订单号', 'string', ['order_no', 'Order ID', '订单编号', '亚马逊订单号'], {
        required: true,
      }),
      column('sku', 'SKU', 'string', ['sku', 'Sku', '商品SKU', 'MSKU'], { required: true }),
      column('quantity', '数量', 'integer', ['quantity', 'Quantity', '购买数量', '件数'], {
        required: true,
      }),
      column('status', '状态', 'string', ['status', 'Status', '订单状态'], { default: '' }),
      column('ordered_at', '下单时间', 'timestamp', ['ordered_at', 'Order Date', '下单日期', '购买时间'], {
        required: true,
      }),
    ],
  },
]

export function findDatasetSpec(key) {
  return DATASET_SPECS.find((spec) => spec.key === key) ?? null
}

/** 生成模板 CSV（表头 + 一行示例）。 */
export function datasetTemplate(spec) {
  const example = spec.columns.map((item) => {
    if (item.type === 'date') return '2026-09-01'
    if (item.type === 'timestamp') return '2026-09-01 12:30:00'
    if (item.type === 'integer') return '10'
    if (item.type === 'decimal') return '12.50'
    if (item.type === 'marketplace') return 'US'
    if (item.key === 'asin') return 'B0XXXXXXXX'
    if (item.key === 'sku') return 'KT-JH-001-BK'
    if (item.key === 'order_no') return '112-1234567-1234567'
    return '示例'
  })
  return toCsv(
    spec.columns.map((item) => ({ label: item.label, key: item.key })),
    [Object.fromEntries(spec.columns.map((item, index) => [item.key, example[index]]))]
  )
}

/**
 * 把表头映射到规格列。
 * 返回 { mapping: {列key: 表头名}, missing: [缺失的必填中文名], ignored: [被忽略的表头] }
 */
export function resolveColumns(spec, headerColumns) {
  const headerMap = new Map()
  for (const header of headerColumns) {
    const normalized = String(header).trim().toLowerCase()
    if (!headerMap.has(normalized)) headerMap.set(normalized, header)
  }

  const mapping = {}
  const usedHeaders = new Set()
  const missing = []

  for (const item of spec.columns) {
    const candidates = item.aliases.map((alias) => String(alias).trim().toLowerCase())
    const matched = candidates.map((alias) => headerMap.get(alias)).find(Boolean)
    if (matched) {
      mapping[item.key] = matched
      usedHeaders.add(String(matched).trim().toLowerCase())
    } else if (item.required) {
      missing.push(item.label)
    }
  }

  const ignored = headerColumns.filter(
    (header) => !usedHeaders.has(String(header).trim().toLowerCase())
  )
  return { mapping, missing, ignored }
}

/**
 * 解析并校验导入文件（纯函数，便于单测）。
 * 返回 { ok, error, records, ignoredColumns, rowErrors, encoding, rowCount, period }
 */
export function parseDatasetBuffer(spec, buffer, { onRowError = 'reject' } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, error: '文件内容为空，未导入任何数据。' }
  }
  if (buffer.length > MAX_IMPORT_BYTES) {
    return {
      ok: false,
      error: `文件超过 ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)}MB 上限，请拆分后分次导入。`,
    }
  }

  const { text, encoding } = decodeCsvBuffer(buffer)
  let parsed
  try {
    parsed = parseCsvToObjects(text)
  } catch (error) {
    if (error instanceof CsvParseError) return { ok: false, error: error.message }
    throw error
  }

  if (parsed.columns.length === 0) return { ok: false, error: '文件没有表头，未导入任何数据。' }
  if (parsed.records.length === 0) {
    return { ok: false, error: '文件只有表头、没有数据行，未导入任何数据。' }
  }
  if (parsed.records.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `数据行数 ${parsed.records.length} 超过单次 ${MAX_IMPORT_ROWS} 行上限，请拆分后分次导入。`,
    }
  }

  const { mapping, missing, ignored } = resolveColumns(spec, parsed.columns)
  if (missing.length > 0) {
    // PRD §8.5：列名不匹配整批拒绝，不做部分导入
    return {
      ok: false,
      error: `缺少必填列：${missing.join('、')}。请使用模板文件（表头需与模板一致）。`,
      ignoredColumns: ignored,
    }
  }

  const records = []
  const rowErrors = []

  for (const row of parsed.records) {
    const record = { __line: row.__line }
    let rowFailed = false

    for (const item of spec.columns) {
      const header = mapping[item.key]
      const raw = header === undefined ? '' : row[header]
      const parsedValue = COLUMN_TYPES[item.type](raw)

      if (parsedValue === null) {
        const hasDefault = Object.hasOwn(item, 'default')
        if (item.required) {
          rowErrors.push({ line: row.__line, column: item.label, reason: '必填列为空或格式不正确' })
          rowFailed = true
        } else if (hasDefault) {
          record[item.key] = item.default
        } else {
          record[item.key] = null
        }
        continue
      }
      record[item.key] = parsedValue
    }

    if (rowFailed) continue
    records.push(record)
  }

  if (rowErrors.length > 0 && onRowError === 'reject') {
    return {
      ok: false,
      error: `发现 ${rowErrors.length} 行数据有问题，已整批拒绝（不做部分导入）。请修正后重新导入。`,
      rowErrors: rowErrors.slice(0, MAX_ERROR_DETAIL),
      ignoredColumns: ignored,
      encoding,
    }
  }

  if (records.length === 0) {
    return {
      ok: false,
      error: '没有任何一行通过校验，未导入数据。',
      rowErrors: rowErrors.slice(0, MAX_ERROR_DETAIL),
      ignoredColumns: ignored,
    }
  }

  const dates = spec.dateColumn
    ? records.map((record) => record[spec.dateColumn]).filter(Boolean).sort()
    : []
  return {
    ok: true,
    records,
    rowErrors: rowErrors.slice(0, MAX_ERROR_DETAIL),
    skippedRows: rowErrors.length,
    ignoredColumns: ignored,
    encoding,
    rowCount: records.length,
    period: {
      start: dates[0] ?? null,
      end: dates[dates.length - 1] ?? null,
    },
  }
}

function buildInsert(spec) {
  const keys = spec.columns.map((item) => item.key)
  const columns = keys.join(', ')
  const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ')
  return {
    keys,
    /** 列清单（含 import_id / imported_at），供批量插入拼多值 VALUES 使用 */
    insertColumns: `${columns}, import_id, imported_at`,
    sql: `INSERT INTO ${spec.table} (${columns}, import_id, imported_at)
          VALUES (${placeholders}, $${keys.length + 1}, NOW())
          ON CONFLICT DO NOTHING`,
    conflictHint: 'ON CONFLICT DO NOTHING',
  }
}

/**
 * 导入数据集。整批成功或整批失败；失败也落 ai_imports（status='failed'）以便页面展示原因。
 * @returns {{ ok: boolean, importId?: number, inserted?: number, skipped?: number, rowCount?: number,
 *             failedRows?: number, period?: {start,end}, ignoredColumns?: string[],
 *             rowErrors?: Array, error?: string, encoding?: string }}
 */
export async function importDataset({
  spec,
  buffer,
  mode = 'overwrite',
  userId,
  fileName = '',
  onRowError = 'reject',
}) {
  if (!['overwrite', 'append'].includes(mode)) {
    throw new DatasetValidationError('导入模式只能是覆盖或追加。')
  }

  const parsed = parseDatasetBuffer(spec, buffer, { onRowError })
  const client = await pool.connect()
  let importId = null

  try {
    if (!parsed.ok) {
      // 失败也要留记录：否则页面看不到失败原因
      const failed = await client.query(
        `INSERT INTO ai_imports (dataset, file_name, mode, row_count, failed_rows, fail_reason, status, imported_by)
         VALUES ($1, $2, $3, 0, $4, $5, 'failed', $6) RETURNING id`,
        [
          spec.key,
          fileName.slice(0, 300),
          mode,
          0,
          `${parsed.error}${parsed.rowErrors?.length ? `；失败行示例：${parsed.rowErrors.map((item) => `第${item.line}行(${item.column})`).join('、')}` : ''}`.slice(
            0,
            2000
          ),
          userId,
        ]
      )
      return { ...parsed, importId: failed.rows[0].id }
    }

    await client.query('BEGIN')
    const inserted = await client.query(
      `INSERT INTO ai_imports
         (dataset, file_name, mode, period_start, period_end, row_count, failed_rows, fail_reason, status, imported_by)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7, 'ok', $8) RETURNING id`,
      [
        spec.key,
        fileName.slice(0, 300),
        mode,
        parsed.period?.start ?? null,
        parsed.period?.end ?? null,
        parsed.skippedRows ?? 0,
        parsed.skippedRows ? '部分行未通过校验，已跳过（onRowError=skip）' : null,
        userId,
      ]
    )
    importId = inserted.rows[0].id

    // 覆盖模式：
    // - 有周期列的数据集（日报类）只删掉本次数据覆盖的周期，保留其他周期；
    // - 没有周期列的数据集（快照类：库存快照、订单快照）整表替换——
    //   这类数据本身就是"某一时点的全量快照"，若不做整表替换，"覆盖"会退化成合并，
    //   上一批快照里已下架/已关闭的行会一直留着（实测踩到过：库存快照导 5 行只进 3 行）。
    if (mode === 'overwrite') {
      if (spec.periodColumn && parsed.period?.start && parsed.period?.end) {
        await client.query(
          `DELETE FROM ${spec.table} WHERE ${spec.periodColumn} BETWEEN $1 AND $2`,
          [parsed.period.start, parsed.period.end]
        )
      } else if (!spec.periodColumn) {
        await client.query(`DELETE FROM ${spec.table}`)
      }
    }

    const insert = buildInsert(spec)
    // 分批多值 INSERT。
    // 逐行 `client.query` 是"一行一次往返"：几千行的报表就是几千次序列化→网络→解析→计划→执行，
    // 而且全程占着同一个事务与数据库连接（事务时长还会放大并发审核时的行锁等待）。
    // 分成 500 行一批，往返次数降低两个数量级，冲突语义（ON CONFLICT DO NOTHING）保持不变。
    const INSERT_BATCH_SIZE = 500
    let insertedRows = 0
    for (let start = 0; start < parsed.records.length; start += INSERT_BATCH_SIZE) {
      const batch = parsed.records.slice(start, start + INSERT_BATCH_SIZE)
      const params = []
      const tuples = batch.map((record) => {
        const placeholders = insert.keys.map((key) => {
          const value = record[key]
          params.push(value === undefined ? null : value)
          return `$${params.length}`
        })
        params.push(importId)
        placeholders.push(`$${params.length}`, 'NOW()')
        return `(${placeholders.join(', ')})`
      })
      const sql = `INSERT INTO ${spec.table} (${insert.insertColumns}) VALUES ${tuples.join(', ')} ${insert.conflictHint}`
      const result = await client.query(sql, params)
      insertedRows += result.rowCount
    }

    await client.query(
      `UPDATE ai_imports SET row_count = $2 WHERE id = $1`,
      [importId, insertedRows]
    )
    await client.query('COMMIT')

    return {
      ok: true,
      importId,
      inserted: insertedRows,
      skipped: parsed.records.length - insertedRows,
      rowCount: parsed.records.length,
      failedRows: parsed.skippedRows ?? 0,
      period: parsed.period,
      ignoredColumns: parsed.ignoredColumns,
      rowErrors: parsed.rowErrors,
      encoding: parsed.encoding,
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/**
 * 导入记录（含失败原因与失败行明细）。
 *
 * 支持 offset 分页：导入记录会随每次上传长期累积，只能看"最近 50 条"等于把历史留痕藏起来，
 * 而导入失败排查恰恰最需要往前翻。
 */
export async function listImports({ dataset = null, limit = 50, offset = 0 } = {}) {
  const { rows } = await query(
    `SELECT i.id, i.dataset, i.file_name, i.mode, i.period_start, i.period_end,
            i.row_count, i.failed_rows, i.fail_reason, i.status, i.imported_at,
            u.name AS imported_by_name, u.login AS imported_by_login
       FROM ai_imports i
       LEFT JOIN users u ON u.id = i.imported_by
      WHERE ($1::text IS NULL OR i.dataset = $1)
      ORDER BY i.imported_at DESC, i.id DESC
      LIMIT $2 OFFSET $3`,
    [dataset, Math.min(200, Math.max(1, limit)), Math.max(0, offset)]
  )
  return rows
}

/** 导入记录总数（与 `listImports` 同一筛选条件，供分页器计算页数）。 */
export async function countImports({ dataset = null } = {}) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS total FROM ai_imports i
      WHERE ($1::text IS NULL OR i.dataset = $1)`,
    [dataset]
  )
  return rows[0].total
}

/** 数据集清单：行数与最近一次成功导入时间（数据时效的唯一来源）。 */
export async function datasetOverview() {
  const overview = []
  for (const spec of DATASET_SPECS) {
    const counts = await query(`SELECT COUNT(*)::int AS rows FROM ${spec.table}`)
    const lastOk = await query(
      `SELECT id, imported_at, file_name, period_start, period_end
         FROM ai_imports WHERE dataset = $1 AND status = 'ok'
        ORDER BY imported_at DESC, id DESC LIMIT 1`,
      [spec.key]
    )
    const lastAny = await query(
      `SELECT status, imported_at, fail_reason FROM ai_imports WHERE dataset = $1
        ORDER BY imported_at DESC, id DESC LIMIT 1`,
      [spec.key]
    )
    overview.push({
      key: spec.key,
      label: spec.label,
      description: spec.description,
      rows: counts.rows[0].rows,
      columns: spec.columns.map((item) => ({
        key: item.key,
        label: item.label,
        required: Boolean(item.required),
      })),
      importedAt: toIsoString(lastOk.rows[0]?.imported_at),
      lastImportAt: toIsoString(lastAny.rows[0]?.imported_at),
      lastImportStatus: lastAny.rows[0]?.status ?? null,
      lastImportError: lastAny.rows[0]?.fail_reason ?? null,
      periodStart: toIsoDate(lastOk.rows[0]?.period_start),
      periodEnd: toIsoDate(lastOk.rows[0]?.period_end),
    })
  }
  return overview
}

/**
 * 行详情里的附加展示列（不属于导入模板）。
 *
 * 这些列由数据库默认值填充，用户不该在 CSV 里提供，所以不进 `spec.columns`；
 * 但排查"刚导入的这批数据到底长什么样"时，快照时点是唯一能区分批次的字段，必须看得到。
 */
const ROW_EXTRA_COLUMNS = {
  inventory_snapshot: [
    { key: 'snapshot_at', label: '快照时间', type: 'timestamp', required: false },
  ],
}

/**
 * 行详情展示列 = 模板列 + 附加列。
 *
 * 列名一律来自数据集规格这个白名单：行详情的 SQL 会把列名拼进语句（列名不能参数化），
 * 只要列名只可能来自规格，就不存在经由列名的注入面。
 */
export function datasetRowColumns(spec) {
  if (!spec) return []
  return [...spec.columns, ...(ROW_EXTRA_COLUMNS[spec.key] ?? [])].map((item) => ({
    key: item.key,
    label: item.label,
    type: item.type,
    required: Boolean(item.required),
  }))
}

/**
 * 关键词可搜索的列：只搜文本类列。
 *
 * 为什么不搜数值列：`spend::text ILIKE '%1%'` 几乎命中所有行，用户既搜不准，
 * 又让每次搜索都退化成全表扫描（数值列上没有可用的前缀索引）。
 */
export function datasetSearchColumns(spec) {
  const searchable = new Set(['string', 'marketplace', 'date', 'timestamp'])
  return (spec?.columns ?? [])
    .filter((item) => searchable.has(item.type))
    .map((item) => item.key)
}

/**
 * 行详情排序：有日期列按日期倒序（看最新数据），否则按自增主键倒序（看最近写入）。
 *
 * `NULLS LAST` 不是可选项：`order_snapshot.ordered_at` 允许为空，
 * 默认的 `DESC` 会把 NULL 排在最前面，第一页全是空行。
 */
export function datasetRowOrder(spec) {
  const dateColumn = spec?.dateColumn
  return dateColumn ? `${dateColumn} DESC NULLS LAST, id DESC` : 'id DESC'
}

/**
 * SELECT 表达式：日期/时间列用 `to_char` 直接取文本。
 *
 * `db.mjs` 的 `setTypeParser(1082)` 已经让 DATE 按字符串返回，但 **TIMESTAMPTZ 仍会被解析成
 * JS Date 并以 UTC 序列化**（`snapshot_at` / `ordered_at`），东八区显示时会比库内值差 8 小时，
 * 管理员核对导入结果时会以为导错了时间。统一用 `to_char` 让所有时间列按库内字面值展示。
 */
export function datasetRowSelectList(spec) {
  return [
    'id',
    ...datasetRowColumns(spec).map((item) => {
      if (item.type === 'date') return `to_char(${item.key}, 'YYYY-MM-DD') AS ${item.key}`
      if (item.type === 'timestamp') {
        return `to_char(${item.key}, 'YYYY-MM-DD HH24:MI:SS') AS ${item.key}`
      }
      return item.key
    }),
  ].join(', ')
}

/**
 * 数据集行详情（分页 + 关键词）。
 *
 * 与数据集清单分开查询：清单是每次进页面都要的轻量统计，行详情是管理员显式点开才拉的数据，
 * 把行数据塞进 `/datasets` 会让页面首屏为一份没人看的数据买单。
 */
export async function listDatasetRows({ spec, limit = 50, offset = 0, keyword = null } = {}) {
  if (!spec) throw new DatasetValidationError('未知数据集。')
  const text = String(keyword ?? '').trim()
  const params = []
  let whereSql = ''
  if (text) {
    const searchColumns = datasetSearchColumns(spec)
    if (searchColumns.length > 0) {
      params.push(`%${text}%`)
      whereSql = `WHERE (${searchColumns
        .map((column) => `${column}::text ILIKE $${params.length}`)
        .join(' OR ')})`
    }
  }

  const [counts, rows] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total FROM ${spec.table} ${whereSql}`, params),
    query(
      `SELECT ${datasetRowSelectList(spec)} FROM ${spec.table} ${whereSql}
        ORDER BY ${datasetRowOrder(spec)}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, Math.min(200, Math.max(1, limit)), Math.max(0, offset)]
    ),
  ])
  return { rows: rows.rows, total: counts.rows[0].total }
}

/** 导出行数上限：再多就不是"核对"而是"搬运全表"，前端会提示缩小关键词范围。 */
export const MAX_EXPORT_ROWS = 20000

/** 导出用行集（最多 MAX_EXPORT_ROWS 行，与列表同一筛选条件）。 */
export async function listDatasetRowsForExport({ spec, keyword = null, limit = MAX_EXPORT_ROWS } = {}) {
  const { rows, total } = await listDatasetRows({ spec, limit, offset: 0, keyword })
  return { rows, total, truncated: total > rows.length }
}

/** Date / 字符串 → ISO 字符串；空值返回 null。 */
function toIsoString(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Date / 字符串 → YYYY-MM-DD；空值返回 null。 */
function toIsoDate(value) {
  const iso = toIsoString(value)
  return iso ? iso.slice(0, 10) : null
}

/** 某个数据集的数据时效（供工具返回 dataFreshness）。 */
export async function datasetFreshnessOf(datasetKey) {
  const spec = findDatasetSpec(datasetKey)
  if (!spec) throw new DatasetValidationError(`未知数据集：${datasetKey}`)
  const { rows } = await query(
    `SELECT MAX(imported_at) AS imported_at, MAX(period_end) AS period_end, COUNT(*)::int AS imports
       FROM ai_imports WHERE dataset = $1 AND status = 'ok'`,
    [datasetKey]
  )
  const counts = await query(`SELECT COUNT(*)::int AS rows FROM ${spec.table}`)
  return {
    dataset: datasetKey,
    label: spec.label,
    // 统一成 ISO 字符串：pg 返回 Date 对象时 String() 会得到 "Fri Sep 11 2026"，既不好看也不可解析
    importedAt: toIsoString(rows[0].imported_at),
    periodEnd: toIsoDate(rows[0].period_end),
    imports: rows[0].imports ?? 0,
    rows: counts.rows[0].rows,
    note: `${spec.label}由人工导出后导入，为准实时数据，非实时数据。`,
  }
}

/**
 * 数据覆盖范围摘要（轻量：2 次查询）。
 *
 * 为什么每次问答都要带上它：语言模型不知道"今天"是哪天，也不知道数据覆盖到哪一天，
 * 遇到"上个月""最近 7 天"这类相对时间只能瞎猜——实测真实模型会把"上个月"算成训练数据里的月份，
 * 进而查一个空区间并回答"查不到数据"。把今天日期与各数据集的覆盖区间写进提示词，它才能正确换算。
 */
export async function datasetCoverageSummary() {
  const union = DATASET_SPECS.map(
    (spec) => `SELECT '${spec.key}' AS dataset, COUNT(*)::int AS rows FROM ${spec.table}`
  ).join('\nUNION ALL ')
  const [counts, imports] = await Promise.all([
    query(union),
    query(
      `SELECT dataset,
              MAX(imported_at) AS imported_at,
              MAX(period_start) AS period_start,
              MAX(period_end) AS period_end
         FROM ai_imports WHERE status = 'ok'
        GROUP BY dataset`
    ),
  ])
  const importMap = new Map(imports.rows.map((row) => [row.dataset, row]))
  return DATASET_SPECS.map((spec) => ({
    dataset: spec.key,
    label: spec.label,
    rows: counts.rows.find((row) => row.dataset === spec.key)?.rows ?? 0,
    importedAt: importMap.get(spec.key)?.imported_at ?? null,
    periodStart: importMap.get(spec.key)?.period_start ?? null,
    periodEnd: importMap.get(spec.key)?.period_end ?? null,
  }))
}

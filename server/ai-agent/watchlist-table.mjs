/**
 * ASIN 表格导入的解析层（2026-09-15 新增）。
 *
 * 为什么单独一层：用户的 ASIN 数据天然是**表格**（Excel 里的 ASIN / 别名 / 备注列，通常还有表头），
 * 而原来的导入只认"一串 ASIN 文本"。把"表格 → 条目"的判断全放在这里，好处有三：
 *   1. 全是纯函数，列识别、表头判定、四分类都能直接单测，不需要起数据库；
 *   2. CSV 与 XLSX 只在 `readTableRowsFromBuffer` 一处分派，两条入口（上传文件 / 从 Excel 复制粘贴）
 *      之后走**完全相同**的解析与报错口径；
 *   3. 长度上限、行数上限由调用方注入（本文件不反向依赖 `my-asins.mjs`，
 *      避免领域层与解析层互相 import 形成环）。
 *
 * 与 `parseAsinList` 的关系：ASIN 的合法性判定**必须**复用 `extractAsin`，
 * 本层只负责"从表格里找出 ASIN 在哪一列、别的列是什么"，不重写识别规则。
 */
import { decodeCsvBuffer, parseCsv } from './csv.mjs'
import { extractAsin } from '../competitor-analysis.mjs'

/** 解析层自己的错误类型：由路由层统一映射为 400（不与清单领域错误混在一个类里）。 */
export class WatchlistTableError extends Error {
  constructor(message, { code = 'table_invalid' } = {}) {
    super(message)
    this.name = 'WatchlistTableError'
    this.code = code
  }
}

/** 单次导入的行数上限（与清单容量上限一致：一次导入即可填满一个清单）。 */
export const MAX_TABLE_ROWS = 5000

/** 支持的文件扩展名；`.xls`（Excel 2003）主流库都不解析，明确拒绝而不是假装支持。 */
export const TABLE_FILE_EXTENSIONS = ['.csv', '.txt', '.xlsx']

/** 表头归一化：去空白、去全角括号内容、转小写，便于中英文表头同一套规则匹配。 */
function normalizeHeaderCell(cell) {
  return String(cell ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/[\s\u3000]/g, '')
    .toLowerCase()
}

const ASIN_HEADER_EXACT = new Set(['asin', 'asins', '商品asin', '亚马逊asin', '子asin', '父asin'])
const ASIN_HEADER_FUZZY = ['asin', '商品编码', '亚马逊标准识别号']
const ALIAS_HEADERS = ['别名', 'alias', '商品别名', '商品名称', '品名', '名称']
const NOTE_HEADERS = ['备注', 'note', 'notes', 'remark', 'remarks', '说明', '注释']
/**
 * 站点列的表头（2026-09-18 新增：站点从清单下沉到每条 ASIN）。
 *
 * 站点必须能跟着表格一起导进来 —— 否则用户从"我的 ASIN"导出、改完再导入时，
 * 整批 ASIN 会被落到默认站点上，数字随之取错站点。
 */
const MARKETPLACE_HEADERS = [
  '站点',
  '站点代码',
  'marketplace',
  'market',
  '国家',
  '国家代码',
  '站点国家',
]

/** 站点值的宽松归一化表：`us` / `美国` / `美国站` / `美国US` 都认。 */
const MARKETPLACE_ALIASES = {
  us: 'US',
  usa: 'US',
  美国: 'US',
  美: 'US',
  uk: 'UK',
  gb: 'UK',
  英国: 'UK',
  de: 'DE',
  德国: 'DE',
  fr: 'FR',
  法国: 'FR',
  it: 'IT',
  意大利: 'IT',
  es: 'ES',
  西班牙: 'ES',
  jp: 'JP',
  日本: 'JP',
  ca: 'CA',
  加拿大: 'CA',
  mx: 'MX',
  墨西哥: 'MX',
  au: 'AU',
  澳大利亚: 'AU',
  澳洲: 'AU',
}

/**
 * 把表格里读到的站点值归一化成站点代码；**不认识一律返回 null**（由调用方计入 invalid）。
 *
 * 不猜：站点决定取数口径，把 `XX` 猜成 `US` 会给出一个看起来正常、实际取错站点的数字。
 */
export function normalizeMarketplaceValue(raw) {
  const text = String(raw ?? '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/[\s\u3000]/g, '')
    .replace(/站$/, '')
    .toLowerCase()
  if (!text) return null
  const direct = MARKETPLACE_ALIASES[text]
  if (direct) return direct
  // `美国us` 这种"中文名 + 代码"的写法：去掉结尾的两位代码再查一次
  return MARKETPLACE_ALIASES[text.replace(/[a-z]{2}$/, '')] ?? null
}

/**
 * 按表头识别列位置。
 *
 * 优先级刻意分明：**精确匹配 > 包含匹配**。否则 `ASIN别名` 这种列会被
 * 模糊匹配先撞上 ASIN 列，把别名当成商品编码导进来（脏数据比报错更难发现）。
 *
 * @returns {{ asin: number|null, marketplace: number|null, alias: number|null, note: number|null }}
 */
export function detectColumnMapping(headerCells = []) {
  const normalized = headerCells.map(normalizeHeaderCell)
  const mapping = { asin: null, marketplace: null, alias: null, note: null }

  normalized.forEach((cell, index) => {
    if (mapping.asin === null && ASIN_HEADER_EXACT.has(cell)) mapping.asin = index
  })
  if (mapping.asin === null) {
    normalized.forEach((cell, index) => {
      if (mapping.asin !== null || !cell) return
      if (ASIN_HEADER_FUZZY.some((keyword) => cell.includes(keyword))) mapping.asin = index
    })
  }
  normalized.forEach((cell, index) => {
    if (index === mapping.asin || !cell) return
    if (mapping.marketplace === null && MARKETPLACE_HEADERS.includes(cell)) {
      mapping.marketplace = index
    } else if (mapping.alias === null && ALIAS_HEADERS.includes(cell)) mapping.alias = index
    else if (mapping.note === null && NOTE_HEADERS.includes(cell)) mapping.note = index
  })

  return mapping
}

/**
 * 首行是不是表头。
 *
 * 判据只有一条：**这一行有没有合法 ASIN**——表头行天然没有商品编码，
 * 而无表头的表格第一行就是 ASIN。
 *
 * 2026-09-18 踩过的坑：这里曾先看"单元格文本像不像表头"（`detectColumnMapping` 的模糊匹配），
 * 于是 `B0MYASIN01` 这种**本身含 "asin" 子串**的合法 ASIN 被判成表头，
 * 整行数据被当成列名吃掉、条目数变成 0。ASIN 里出现 asin 字样完全正常，
 * 因此判定必须"先认值、再认字样"。
 *
 * 表头写成「商品」「编码」这类不含 asin 字样的词也能工作：那同样没有合法 ASIN。
 */
export function looksLikeHeaderRow(cells = []) {
  const values = cells.map((cell) => String(cell ?? '').trim()).filter(Boolean)
  if (values.length === 0) return false
  return !values.some((value) => extractAsin(value))
}

/** 空行（整行都是空白）不算数据行，也不该被算作"无法识别"。 */
function isEmptyRow(cells) {
  return !(cells ?? []).some((cell) => String(cell ?? '').trim() !== '')
}

/** 单元格取值：日期等非文本类型统一转字符串，避免 `String(new Date())` 带出英文时区串。 */
function cellText(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)
  }
  return String(value).trim()
}

function clipText(value, max) {
  const text = cellText(value)
  if (!text) return null
  return text.length > max ? text.slice(0, max) : text
}

/**
 * 把二维表格解析成条目（纯函数，也是唯一一处"四分类"来源）。
 *
 * @param {Array<Array<unknown>>} rows 原始行（含可能的表头行）
 * @param {{ maxRows?: number, maxAliasLength?: number, maxNoteLength?: number, defaultMarketplace?: string }} limits
 * @returns {{
 *   mapping: { asin: number|null, marketplace: number|null, alias: number|null, note: number|null },
 *   headerRow: number|null,
 *   columns: string[],
 *   entries: Array<{ asin: string, marketplace: string, alias: string|null, note: string|null, line: number }>,
 *   invalid: Array<{ line: number, value: string }>,
 *   repeated: Array<{ line: number, asin: string, marketplace: string }>,
 *   emptyRows: number
 * }}
 */
export function analyzeTableRows(rows, limits = {}) {
  const {
    maxRows = MAX_TABLE_ROWS,
    maxAliasLength = 120,
    maxNoteLength = 300,
    defaultMarketplace = 'US',
  } = limits

  const rawRows = (rows ?? []).map((cells) => (Array.isArray(cells) ? cells : [cells]))
  const dataRows = rawRows.filter((cells) => !isEmptyRow(cells))
  const emptyRows = rawRows.length - dataRows.length
  if (dataRows.length === 0) {
    throw new WatchlistTableError('表格里没有可导入的数据行（只读到空行）。')
  }

  const firstRow = dataRows[0]
  const hasHeader = looksLikeHeaderRow(firstRow)
  /*
   * 无表头时的列推断刻意保守：**只有恰好两列**才推断第 2 列的含义。
   * 先看它是不是"整列都是站点"（"ASIN + 站点"是最常见的两列形态之一），是站点就按站点；
   * 否则按"ASIN + 名称"当别名。三列及以上不猜 —— 第 2 列可能是价格、负责人、上架时间，
   * 猜错等于把无关数据写进备注，而这类脏数据要用户自己在页面上一条条清。
   * 预览界面会如实显示这次识别到的是哪一列，不对就补个表头再传一次。
   */
  const twoColumnMarketplace =
    !hasHeader &&
    firstRow.length === 2 &&
    dataRows.every((cells) => normalizeMarketplaceValue(cellText(cells[1])) !== null)
  const mapping = hasHeader
    ? detectColumnMapping(firstRow)
    : twoColumnMarketplace
      ? { asin: 0, marketplace: 1, alias: null, note: null }
      : { asin: 0, marketplace: null, alias: firstRow.length === 2 ? 1 : null, note: null }

  if (mapping.asin === null) {
    const headerText = firstRow.map((cell) => cellText(cell)).filter(Boolean)
    throw new WatchlistTableError(
      `没有在表头里找到 ASIN 列（当前表头：${
        headerText.length > 0 ? headerText.join('、') : '（空）'
      }）。请把 ASIN 列命名为 ASIN，或把该列放到第一列。`
    )
  }

  const bodyRows = hasHeader ? dataRows.slice(1) : dataRows
  // 行号按"用户在 Excel 里看到的行号"给：含表头，便于直接回表里核对
  const lineNumberOf = (index) => (hasHeader ? index + 2 : index + 1)

  if (bodyRows.length > maxRows) {
    throw new WatchlistTableError(
      `表格共 ${bodyRows.length} 行数据，单次最多导入 ${maxRows} 行。请拆成多个文件分批导入。`
    )
  }

  const entries = []
  const invalid = []
  const repeated = []
  const seen = new Map()

  bodyRows.forEach((cells, index) => {
    const line = lineNumberOf(index)
    const rawAsin = cellText(cells[mapping.asin])
    const asin = extractAsin(rawAsin)
    if (!asin) {
      invalid.push({ line, value: rawAsin })
      return
    }
    /*
     * 站点列的三种情况分开处理，都不猜：
     * - 没有站点列 → 用本次导入的默认站点；
     * - 有站点列但这一格是空的 → 同样落到默认站点（用户填了表，只是漏了这一格）；
     * - 有值但不认识 → **整行进 invalid**（不静默改成默认站点：站点决定取数口径，
     *   悄悄换一个站点会得到一个看起来正常、实际取错站点的数字）。
     */
    const rawSite = mapping.marketplace === null ? '' : cellText(cells[mapping.marketplace])
    const marketplace =
      mapping.marketplace === null || !rawSite
        ? defaultMarketplace
        : normalizeMarketplaceValue(rawSite)
    if (!marketplace) {
      invalid.push({
        line,
        value: `${rawAsin}（站点「${rawSite}」不在支持范围内）`,
      })
      return
    }
    /*
     * 去重键是 `(asin, 站点)`：同一个 ASIN 出现在两个站点是两条合法数据，
     * 按 ASIN 判定重复会静默丢掉另一个站点。
     */
    const key = `${asin}::${marketplace}`
    if (seen.has(key)) {
      repeated.push({ line, asin, marketplace, firstLine: seen.get(key) })
      return
    }
    seen.set(key, line)
    entries.push({
      asin,
      marketplace,
      alias: mapping.alias === null ? null : clipText(cells[mapping.alias], maxAliasLength),
      note: mapping.note === null ? null : clipText(cells[mapping.note], maxNoteLength),
      line,
    })
  })

  return {
    mapping,
    headerRow: hasHeader ? 1 : null,
    columns: hasHeader ? firstRow.map((cell) => cellText(cell)) : [],
    entries,
    invalid,
    repeated,
    emptyRows,
  }
}

/**
 * 解析"粘贴进来的表格文本"。
 *
 * 返回 `null` 表示这不像表格（单列纯 ASIN 文本）—— 调用方应回退到原有的
 * `parseAsinList` 路径，保证"粘一串 ASIN"这个老用法行为完全不变。
 *
 * Excel 复制出来的是 **TSV**（制表符分隔），而用户从别处复制的可能是逗号分隔，
 * 因此先看有没有制表符，没有再按 CSV 规则切。
 */
export function parseTableText(raw, limits = {}) {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n')
  if (!text.trim()) return null

  const lines = text.split('\n')
  const hasTab = lines.some((line) => line.includes('\t'))
  let rows
  if (hasTab) {
    rows = lines.map((line) => line.split('\t'))
  } else if (lines.some((line) => line.includes(','))) {
    rows = parseCsv(text)
  } else {
    return null
  }

  const filled = rows.filter((cells) =>
    cells.some((cell) => String(cell ?? '').trim() !== '')
  )
  const maxColumns = filled.reduce((max, cells) => Math.max(max, cells.length), 0)
  /*
   * 判定"这到底是不是表格"，两条通道都要能站住脚：
   *
   * 1. **首行像表头且不止一列**：`ASIN,别名` 这种最典型的表格；
   * 2. **每行列数一致，且至少有一个单元格不是 ASIN**：无表头的表格（第一列 ASIN + 第二列别名）。
   *
   * 反过来，下面这些**都不是表格**，必须回退到按文本解析（否则会丢数据或误报）：
   *   - `B0AAAAAAAA, B0BBBBBBBB`（一行里逗号隔开的两个 ASIN，列数 2 但没有第二行）；
   *   - `B0AAAAAAAA,B0BBBBBBBB\nB0CCCCCCCC,B0DDDDDDDD`（每个格子都是 ASIN —— 用户就是想要 4 个商品，
   *     按表格只取第一列会**静默丢掉一半**）；
   *   - `B0AAAAAAAA, B0BBBBBBBB\nB0CCCCCCCC、夏季款水杯`（列数不一致，是自由文本）。
   */
  const firstRowIsHeader = looksLikeHeaderRow(rows.find((cells) => cells.length > 0) ?? [])
  const uniformColumns = new Set(filled.map((cells) => cells.length)).size === 1
  const hasNonAsinCell = filled.some((cells) =>
    cells.some((cell) => !extractAsin(String(cell ?? '').trim()))
  )
  const isTable =
    maxColumns >= 2 &&
    filled.length >= 2 &&
    (firstRowIsHeader || (uniformColumns && hasNonAsinCell))
  if (!isTable) return null

  return analyzeTableRows(rows, limits)
}

/**
 * 从上传的文件缓冲区里读出二维表格。
 *
 * CSV 走项目既有的 `decodeCsvBuffer`（UTF-8 失败回退 GBK —— 中文 Excel 导出的 CSV 默认就是 GBK，
 * 不做这步会整列乱码）；XLSX 用 `read-excel-file`，**动态 import**：
 * 它只在真的有人导表格时才加载，不拖慢服务启动。
 */
export async function readTableRowsFromBuffer({ buffer, fileName = '' }) {
  const name = String(fileName ?? '').toLowerCase()
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? '')
  if (bytes.length === 0) throw new WatchlistTableError('文件是空的，没有读到任何内容。')

  if (name.endsWith('.xlsx')) {
    let readSheet
    try {
      // 用 `readSheet`（单表）而不是 default（多表数组）：我们只导第一个工作表，
      // default 会返回 `[{ sheet, data }]`，多一层解包只会多一处出错的地方。
      ;({ readSheet } = await import('read-excel-file/node'))
    } catch {
      throw new WatchlistTableError('服务器无法解析 Excel 文件，请改为导出 CSV 后上传。')
    }
    let rows
    try {
      rows = await readSheet(bytes)
    } catch {
      throw new WatchlistTableError(
        '这个 Excel 文件读不出来（可能已损坏，或是老的 .xls 格式）。请在 Excel 里另存为 .xlsx 或 CSV 后重试。'
      )
    }
    return { rows, format: 'xlsx' }
  }

  if (name.endsWith('.xls')) {
    throw new WatchlistTableError(
      '不支持老的 .xls 格式，请在 Excel 里另存为 .xlsx 或 CSV 后重试。'
    )
  }

  const { text, encoding, hadReplacement } = decodeCsvBuffer(bytes)
  if (hadReplacement && encoding === 'utf8') {
    throw new WatchlistTableError('文件编码无法识别，请另存为 UTF-8 或 GBK 编码的 CSV 后重试。')
  }
  const rows = parseCsv(text)
  return { rows, format: 'csv', encoding }
}

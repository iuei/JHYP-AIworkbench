/**
 * 产品开发的表格导入解析层（纯函数为主）。
 *
 * 与 ASIN 清单的 `watchlist-table.mjs` 的关系，是本文件最需要说清的一件事：
 *
 * - **复用**它的 `readTableRowsFromBuffer`（文件缓冲区 → 二维行）与 `WatchlistTableError`。
 *   CSV/XLSX 分派、UTF-8 失败回退 GBK、`.xls` 明确拒绝，这些是**与业务无关的通用能力**，
 *   重写一遍只会多一处会漂移的实现。
 * - **不复用**它的 `detectColumnMapping` / `analyzeTableRows` / `looksLikeHeaderRow` /
 *   `parseTableText`。这四个都直接或间接调用 `extractAsin`，是 **ASIN 专用口径** ——
 *   拿它们解析产品开发表会把"产品名称"列判成"识别不到 ASIN"，进而整行丢弃或错位。
 *   本模块需要的是"表头 → 字段"的映射，字段集合与 ASIN 清单完全不同（价格、评分、类目…），
 *   所以自己实现一套，只借用通用的读写能力。
 *
 * 两条沿用自 ASIN 清单的教训（都是踩过的坑）：
 * 1. **无表头时只认第 1 列**，其余列不猜不写。猜错等于把无关数据写进字段，而这类脏数据
 *    要用户自己在页面上一条条清。
 * 2. **能识别的值就写，识别不了的值必须报出来**（`invalid` 带行号与原因），不得静默丢弃或
 *    静默替换成默认值 —— 站点落错会让对比取到另一个站点的报表，产生的是一份错误的结论。
 */
import { extractAsin } from './competitor-analysis.mjs'
import { parseCsv } from './ai-agent/csv.mjs'
import {
  WatchlistTableError,
  readTableRowsFromBuffer,
} from './ai-agent/watchlist-table.mjs'
import {
  DEFAULT_MARKETPLACE,
  MARKETPLACE_LABELS,
  // 站点枚举与 my-asins.mjs 共用一份（本模块只借它的白名单与中文标签）
  MY_ASIN_MARKETPLACES as WATCHLIST_MARKETPLACES,
} from './ai-agent/my-asins.mjs'

/**
 * 候选阶段枚举与中文标签。
 *
 * 定义在本文件（解析层）而不是领域层 `product-dev.mjs`，是为了保持**单向依赖**：
 * 领域层要调用解析层做导入，若解析层反过来导入领域层的枚举就形成循环。
 * 解析层本来就需要这组值来识别"阶段"列的填写内容，领域层再 re-export 给路由与前端。
 */
export const STAGES = ['candidate', 'researching', 'approved', 'rejected']

export const STAGE_LABELS = {
  candidate: '候选',
  researching: '调研中',
  approved: '已立项',
  rejected: '已放弃',
}

/** 单次导入的行数上限。与 ASIN 清单的 5000 不同：候选品的调研量级远小于在售 ASIN 集合。 */
export const MAX_IMPORT_ROWS = 2000

/** 支持的文件扩展名（与 ASIN 清单一致，`.xls` 由 `readTableRowsFromBuffer` 明确拒绝）。 */
export const PRODUCT_DEV_TABLE_EXTENSIONS = ['.csv', '.txt', '.xlsx']

/**
 * 表头别名表：**左侧是落库字段名，右侧是用户可能写的表头**（全部小写、去空白后比对）。
 *
 * 顺序即优先级：一个表头同时命中多个字段时取先出现的那个字段（"售价"既像 `target_price`
 * 又像无关列的情况不存在，但"名称"与"产品名称"会同时命中 `product_name`，取到哪一列都正确）。
 */
const HEADER_ALIASES = {
  product_name: [
    '产品名称',
    '产品名',
    '商品名称',
    '商品名',
    '品名',
    '名称',
    '标题',
    'productname',
    'product name',
    'name',
    'title',
  ],
  asin: ['asin', 'asin码', '亚马逊asin', '子asin'],
  category: ['类目', '分类', '品类', '类别', 'category'],
  target_price: ['目标售价', '目标价', '售价', '价格', '单价', 'targetprice', 'target price', 'price'],
  marketplace: ['站点', '国家', '市场', 'marketplace', 'site'],
  stage: ['阶段', '状态', 'stage', 'status'],
  note: ['备注', '说明', '注释', 'note', 'remark'],
}

/** 进 `attributes` 的固定字段（其余列也进 attributes，键就是表头原文）。 */
const FIXED_FIELDS = Object.keys(HEADER_ALIASES)

/** 表头单元格归一化：去全角空格与不可见空白、转小写，便于别名比对。 */
function normalizeHeaderCell(cell) {
  return String(cell ?? '')
    .replace(/[\u3000\u00a0]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** 单元格取值：Date 统一转 `YYYY-MM-DD` 字符串，避免 `String(new Date())` 带出英文时区串。 */
function cellText(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10)
  }
  return String(value).trim()
}

function isEmptyRow(cells) {
  return !(cells ?? []).some((cell) => cellText(cell) !== '')
}

function clipText(value, max) {
  const text = cellText(value)
  return text.length > max ? text.slice(0, max) : text
}

/**
 * 价格解析。
 *
 * 只接受"一个数字"（允许前后有货币符号、千分位逗号与空白）。**区间、文字、多个数字一律返回
 * `null`** —— 例如 `12.99-15.99`、`约10刀`、`$9.99/$12.99`。这些值无法在不猜测的前提下
 * 变成一个可用于对比的数字，而猜错会直接污染价格对比；如实留空并在预览里显示原值更安全。
 */
export function parsePriceCell(raw) {
  const text = cellText(raw)
  if (!text) return null
  const cleaned = text.replace(/[¥$€£,\s]/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  // NUMERIC(14,2)：超过上限会让插入直接报错，这里先挡下来并如实返回 null
  return value > 99999999999 ? null : Math.round(value * 100) / 100
}

/** 价格是否"看起来该能解析却解析不出来"——用于预览里给出更准确的提示。 */
function looksLikePrice(raw) {
  return /[0-9]/.test(cellText(raw))
}

/**
 * 站点解析：两位代码直接用；中文标签（美国、日本）按 `MARKETPLACE_LABELS` 反查。
 *
 * 空值返回 `null`（由调用方回落到默认站点）；**非空但认不出来返回 `undefined`** ——
 * 两者必须区分：前者是"用户没填"，后者是"用户填了但我不认识"。后者若静默回落默认站点，
 * 会让一批本该落到 JP 的候选落进 US，之后所有指标都取自错误的站点。
 */
export function parseMarketplaceCell(raw) {
  const text = cellText(raw)
  if (!text) return null
  const upper = text.toUpperCase()
  if (WATCHLIST_MARKETPLACES.includes(upper)) return upper
  const labelEntry = Object.entries(MARKETPLACE_LABELS).find(
    ([, label]) => label === text || `${label}站` === text
  )
  if (labelEntry) return labelEntry[0]
  return undefined
}

/**
 * 阶段解析：中文标签或英文枚举。认不出来返回 `undefined`（同站点，不静默回落）。
 */
export function parseStageCell(raw) {
  const text = cellText(raw)
  if (!text) return null
  const lower = text.toLowerCase()
  if (STAGES.includes(lower)) return lower
  const labelEntry = Object.entries(STAGE_LABELS).find(([, label]) => label === text)
  return labelEntry ? labelEntry[0] : undefined
}

/**
 * 表头 → 列下标映射。
 *
 * `extras` 是"没有匹配到固定字段"的列，它们全部进 `attributes`，键用表头原文
 * （保留用户自己的叫法，如「月销量」「评分」）—— 这正是 attributes 存在的意义：
 * 数据源还没定，用户表里出现什么维度就存什么维度。
 */
export function detectProductDevColumns(headerCells = []) {
  const mapping = {}
  for (const field of FIXED_FIELDS) mapping[field] = null
  const normalized = headerCells.map(normalizeHeaderCell)
  const usedIndexes = new Set()

  for (const field of FIXED_FIELDS) {
    const index = normalized.findIndex(
      (cell, i) => cell && !usedIndexes.has(i) && HEADER_ALIASES[field].includes(cell)
    )
    if (index >= 0) {
      mapping[field] = index
      usedIndexes.add(index)
    }
  }

  const extras = []
  normalized.forEach((cell, index) => {
    if (usedIndexes.has(index)) return
    if (!cell) return
    extras.push({ index, key: cellText(headerCells[index]) })
  })

  return { ...mapping, extras }
}

/**
 * 首行是不是表头。
 *
 * 判据：至少有一个单元格命中固定字段别名。**不看"有没有多列"** —— 用户直接粘的
 * 两列数据（产品名 + 价格）没有表头，按表头解析会把第一行数据当成列名吃掉。
 */
export function looksLikeProductDevHeader(cells = []) {
  const normalized = cells.map(normalizeHeaderCell).filter(Boolean)
  if (normalized.length === 0) return false
  return normalized.some((cell) =>
    FIXED_FIELDS.some((field) => HEADER_ALIASES[field].includes(cell))
  )
}

/** 判重键：有 ASIN 按 ASIN，没有则按"站点 + 名称"（同站点同名视为同一个候选）。 */
function dedupeKey(entry) {
  if (entry.asin) return `asin:${entry.marketplace}:${entry.asin}`
  return `name:${entry.marketplace}:${entry.product_name.toLowerCase()}`
}

function entryLabel(entry) {
  return entry.asin || entry.product_name || '（空）'
}

/**
 * 把二维表格解析成候选产品条目（纯函数，也是**唯一一处四分类来源**）。
 *
 * @param {Array<Array<unknown>>} rows 原始行（含可能的表头行）
 * @param {{ maxRows?: number, knownKeys?: Set<string> }} limits
 *   `knownKeys` 是池里已有的判重键集合，用于把 `duplicated` 与 `repeated` 分开
 * @returns {{
 *   mapping: object, headerRow: number|null, headerRecognized: boolean,
 *   columns: string[], extraColumns: string[],
 *   entries: Array<object>, invalid: Array<{line:number,value:string,reason:string}>,
 *   repeated: Array<{line:number,label:string}>, emptyRows: number
 * }}
 */
export function parseProductDevRows(rows, limits = {}) {
  const { maxRows = MAX_IMPORT_ROWS, knownKeys = new Set() } = limits

  const rawRows = (rows ?? []).map((cells) => (Array.isArray(cells) ? cells : [cells]))
  /*
   * 过滤空行时**带着原始行号一起走**。
   *
   * 早先的写法是先 `filter` 再按过滤后的下标推算行号（`index + 2`），表格中间只要有一个空行，
   * 其后所有行的行号都会**整体前移** —— 而 `invalid` 里的行号是给用户"回 Excel 里核对"用的，
   * 指错行比不给行号更费时间。这里改成在过滤前就把 1-based 的原始行号绑在行上。
   */
  const dataRows = rawRows
    .map((cells, index) => ({ cells, line: index + 1 }))
    .filter((item) => !isEmptyRow(item.cells))
  const emptyRows = rawRows.length - dataRows.length
  if (dataRows.length === 0) {
    throw new WatchlistTableError('表格里没有可导入的数据行（只读到空行）。')
  }

  const firstRow = dataRows[0].cells
  const headerRecognized = looksLikeProductDevHeader(firstRow)
  const bodyRows = headerRecognized ? dataRows.slice(1) : dataRows

  /*
   * 无表头时**只认第 1 列**：是 ASIN 就当 ASIN，否则当产品名称；第 2 列及以后不猜不写。
   * 产品开发表的第 2 列可能是价格、评分、月销、负责人 —— 猜错就是把无关数据写成价格，
   * 而价格会直接进入对比结论。宁可少读，也不写脏数据（预览里会明确提示这一限制）。
   */
  const mapping = headerRecognized
    ? detectProductDevColumns(firstRow)
    : {
        product_name: null,
        asin: 0,
        category: null,
        target_price: null,
        marketplace: null,
        stage: null,
        note: null,
        extras: [],
      }

  if (bodyRows.length > maxRows) {
    throw new WatchlistTableError(
      `表格共 ${bodyRows.length} 行数据，单次最多导入 ${maxRows} 行。请拆成多个文件分批导入。`
    )
  }

  const entries = []
  const invalid = []
  const repeated = []
  const seen = new Map()

  /** 取值：表头模式下按列下标取；无表头模式下只有第 1 列（它可能是 ASIN 也可能是名称）。 */
  const valueAt = (cells, index) => (index === null || index === undefined ? '' : cellText(cells[index]))

  bodyRows.forEach((item) => {
    const cells = item.cells
    // 原始行号：用户在 Excel 里看到的就是这个数字
    const line = item.line

    let asin = null
    let productName = ''

    if (headerRecognized) {
      const rawAsin = valueAt(cells, mapping.asin)
      asin = rawAsin ? extractAsin(rawAsin) : null
      productName = clipText(valueAt(cells, mapping.product_name), 300)
      // ASIN 列写了东西但认不出来：不算致命（可能用户把链接写错了），记下来供人工核对，
      // 但**不因此丢整行** —— 产品名称还在，候选本身仍然有价值。
      if (rawAsin && !asin) {
        invalid.push({
          line,
          value: rawAsin,
          reason: `ASIN 列「${rawAsin}」无法识别，该行已按无 ASIN 导入`,
        })
      }
    } else {
      const raw = cellText(cells[0])
      const detected = raw ? extractAsin(raw) : null
      if (detected) asin = detected
      else productName = clipText(raw, 300)
    }

    if (!asin && !productName) {
      invalid.push({ line, value: cellText(cells[0]), reason: '这一行没有可识别的产品名称或 ASIN' })
      return
    }

    // 站点：空 → 默认；填了但认不出来 → 整行拒绝（不能静默落到默认站点）
    const rawMarketplace = valueAt(cells, mapping.marketplace)
    const parsedMarketplace = headerRecognized ? parseMarketplaceCell(rawMarketplace) : null
    if (parsedMarketplace === undefined) {
      invalid.push({
        line,
        value: rawMarketplace,
        reason: `站点「${rawMarketplace}」无法识别，可选：${WATCHLIST_MARKETPLACES.join('、')}`,
      })
      return
    }
    const marketplace = parsedMarketplace ?? DEFAULT_MARKETPLACE

    // 阶段：空 → 默认候选；填了但认不出来 → 整行拒绝（同站点口径）
    const rawStage = valueAt(cells, mapping.stage)
    const parsedStage = headerRecognized ? parseStageCell(rawStage) : null
    if (parsedStage === undefined) {
      invalid.push({
        line,
        value: rawStage,
        reason: `阶段「${rawStage}」无法识别，可选：${Object.values(STAGE_LABELS).join('、')}`,
      })
      return
    }

    const rawPrice = valueAt(cells, mapping.target_price)
    const targetPrice = headerRecognized ? parsePriceCell(rawPrice) : null

    // 附加维度：表头模式下取所有未被固定字段占用的列；无表头模式下不猜
    const attributes = {}
    if (headerRecognized) {
      for (const extra of mapping.extras) {
        const text = clipText(valueAt(cells, extra.index), 300)
        if (text) attributes[extra.key] = text
      }
    }

    const entry = {
      line,
      marketplace,
      asin,
      product_name: productName,
      category: headerRecognized ? clipText(valueAt(cells, mapping.category), 60) : '',
      target_price: targetPrice,
      // 价格列有数字但解析不出来 → 如实告诉用户这一行没能读到价格，而不是留个静默的空
      price_unparsed:
        headerRecognized && targetPrice === null && looksLikePrice(rawPrice)
          ? clipText(rawPrice, 60)
          : null,
      stage: parsedStage ?? 'candidate',
      note: headerRecognized ? clipText(valueAt(cells, mapping.note), 300) : null,
      attributes,
      source: 'import',
    }

    const key = dedupeKey(entry)
    if (seen.has(key)) {
      // 本次表格内重复：用户自己粘重了，与"库里已有"必须分开说
      repeated.push({ line, label: entryLabel(entry) })
      return
    }
    seen.set(key, line)

    if (knownKeys.has(key)) {
      // 库里已有：由领域层转成 duplicated（解析层只负责判断，不负责查库）
      entry.duplicated = true
    }

    entries.push(entry)
  })

  return {
    mapping,
    headerRow: headerRecognized ? 1 : null,
    headerRecognized,
    columns: (headerRecognized ? firstRow : dataRows[0].cells).map(cellText),
    extraColumns: headerRecognized ? mapping.extras.map((item) => item.key) : [],
    entries,
    invalid,
    repeated,
    emptyRows,
  }
}

/**
 * 解析粘贴的文本。
 *
 * 返回 `null` 表示"这不是表格"（调用方应回退到**文本模式**：一行一个产品名称或 ASIN）。
 * 判定故意保守：有制表符（从 Excel 复制必然带），或首行命中表头别名，才算表格。
 * 逗号分隔的多行文本**不算表格** —— `水杯A, 水杯B` 这种是用户想加两个产品名，
 * 按表格解析只会取到第一列，静默丢掉后面全部。
 */
export function parseProductDevTableText(raw, limits = {}) {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n')
  if (!text.trim()) return null

  // 保留空行：行号是给用户"回自己粘的内容里核对"用的，先过滤会让后面的行号整体前移
  const lines = text.split('\n')
  const nonEmpty = lines.filter((line) => line.trim() !== '')
  if (nonEmpty.length === 0) return null

  const hasTab = nonEmpty.some((line) => line.includes('\t'))
  let rows
  if (hasTab) {
    rows = lines.map((line) => line.split('\t'))
  } else if (looksLikeProductDevHeader(parseCsv(nonEmpty[0])[0] ?? [])) {
    // 首行是表头且用逗号分隔：按 CSV 解析整段
    rows = parseCsv(text)
  } else {
    return null
  }

  if (rows.every((cells) => cells.length < 2)) return null
  return parseProductDevRows(rows, limits)
}

/**
 * 文本模式：一行一个候选（ASIN 或产品名称）。返回与表格模式同形的条目数组。
 *
 * 判重与校验口径与表格模式保持一致，只是没有表头与附加列。
 */
export function parseProductDevTextLines(raw, { maxRows = MAX_IMPORT_ROWS, knownKeys = new Set() } = {}) {
  // 与表格模式同理：空行参与行号计数，否则 `invalid` 指的行号会与用户看到的不一致
  const lines = String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((text, index) => ({ text: text.trim(), line: index + 1 }))
    .filter((item) => item.text !== '')

  if (lines.length === 0) {
    throw new WatchlistTableError('没有读到任何内容。')
  }
  if (lines.length > maxRows) {
    throw new WatchlistTableError(
      `共 ${lines.length} 行，单次最多导入 ${maxRows} 行。请分批导入。`,
    )
  }

  const entries = []
  const invalid = []
  const repeated = []
  const seen = new Set()

  lines.forEach((item) => {
    const line = item.text
    const lineNo = item.line
    const asin = extractAsin(line)
    const entry = {
      line: lineNo,
      marketplace: DEFAULT_MARKETPLACE,
      asin,
      product_name: asin ? '' : clipText(line, 300),
      category: '',
      target_price: null,
      price_unparsed: null,
      stage: 'candidate',
      note: null,
      attributes: {},
      source: 'import',
    }
    if (!asin && !entry.product_name) {
      invalid.push({ line: lineNo, value: line, reason: '没有可识别的产品名称或 ASIN' })
      return
    }
    const key = dedupeKey(entry)
    if (seen.has(key)) {
      repeated.push({ line: lineNo, label: entryLabel(entry) })
      return
    }
    seen.add(key)
    if (knownKeys.has(key)) entry.duplicated = true
    entries.push(entry)
  })

  return {
    mapping: null,
    headerRow: null,
    headerRecognized: false,
    columns: [],
    extraColumns: [],
    entries,
    invalid,
    repeated,
    emptyRows: 0,
  }
}

export { WatchlistTableError, readTableRowsFromBuffer }

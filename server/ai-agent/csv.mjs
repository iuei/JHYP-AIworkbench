/**
 * CSV 解析与编码（零依赖）。
 *
 * 为什么自己写：需求文档 Q6（Excel/文档解析库选型）尚未确认，
 * 而 Amazon 报表与业务报告都能导出 CSV，先用零依赖方案把通道打通；
 * `.xlsx` 二进制格式待确认解析库后再在同一导入通道上扩展。
 *
 * 必须处理的现实问题（都是中文用户的常见坑）：
 * 1. 中文版 Excel 另存 CSV 默认是 **GBK** 编码，直接按 UTF-8 读会得到乱码；
 * 2. 字段可能被双引号包裹，内部含逗号、换行、转义的双引号；
 * 3. 行尾可能是 CRLF；文件头可能带 BOM；
 * 4. 数据行字段数与表头不一致（漏填或多写逗号），必须能被识别而不是静默错位。
 */
import { TEXT_ENCODINGS } from './encoding.mjs'

export class CsvParseError extends Error {}

/** 解析 CSV 文本为二维数组（保留空字段，丢弃纯空行）。 */
export function parseCsv(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
      continue
    }
    if (char === ',') {
      row.push(field)
      field = ''
      continue
    }
    if (char === '\r') {
      // CRLF / CR 都当作行结束
      if (input[index + 1] === '\n') index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    field += char
  }

  row.push(field)
  rows.push(row)

  // 丢弃完全空白的行（末尾换行会产生一行空）
  return rows.filter((line) => line.some((cell) => String(cell).trim() !== ''))
}

/** 解析为对象数组；表头做 trim，重复表头会报错（避免列被静默覆盖）。 */
export function parseCsvToObjects(text) {
  const rows = parseCsv(text)
  if (rows.length === 0) return { columns: [], records: [] }

  const columns = rows[0].map((cell) => String(cell).trim())
  const duplicates = columns.filter((name, index) => name && columns.indexOf(name) !== index)
  if (duplicates.length > 0) {
    throw new CsvParseError(`表头存在重复列名：${[...new Set(duplicates)].join('、')}`)
  }

  const records = rows.slice(1).map((line, index) => {
    const record = { __line: index + 2 }
    columns.forEach((name, columnIndex) => {
      record[name] = line[columnIndex] === undefined ? '' : String(line[columnIndex]).trim()
    })
    record.__cellCount = line.length
    return record
  })

  return { columns, records }
}

/**
 * 按 UTF-8 解码；出现替换字符（U+FFFD）时判定为非 UTF-8，回退 GBK 重试。
 * 这是中文 Excel 导出 CSV 的必要处理，不做会出现整列乱码。
 */
export function decodeCsvBuffer(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? '')
  if (bytes.length === 0) return { text: '', encoding: 'utf8', hadReplacement: false }

  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const hadReplacement = utf8.includes('\uFFFD')
  if (!hadReplacement) return { text: utf8, encoding: 'utf8', hadReplacement: false }

  for (const encoding of TEXT_ENCODINGS) {
    try {
      const decoded = new TextDecoder(encoding, { fatal: false }).decode(bytes)
      if (!decoded.includes('\uFFFD')) {
        return { text: decoded, encoding, hadReplacement: true }
      }
    } catch {
      // 环境不支持该编码时跳过
    }
  }
  return { text: utf8, encoding: 'utf8', hadReplacement: true }
}

/** 生成 CSV 文本；带 BOM 便于 Excel 直接打开中文不乱码。 */
export function toCsv(columns, rows, { bom = true } = {}) {
  const escape = (value) => {
    if (value === null || value === undefined) return ''
    let text = typeof value === 'object' ? JSON.stringify(value) : String(value)
    // Excel/Sheets 会把这些前缀解释为公式；导出数据可能来自员工可编辑内容。
    if (/^\s*[=+\-@]/.test(text)) text = `'${text}`
    if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`
    return text
  }
  const header = columns.map((column) => escape(column.label ?? column.key)).join(',')
  const body = rows.map((row) =>
    columns.map((column) => escape(column.value ? column.value(row) : row[column.key])).join(',')
  )
  const text = [header, ...body].join('\r\n')
  return bom ? `\uFEFF${text}\r\n` : `${text}\r\n`
}

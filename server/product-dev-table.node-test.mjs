import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_IMPORT_ROWS,
  WatchlistTableError,
  detectProductDevColumns,
  looksLikeProductDevHeader,
  parseMarketplaceCell,
  parsePriceCell,
  parseProductDevRows,
  parseProductDevTableText,
  parseProductDevTextLines,
  parseStageCell,
} from './product-dev-table.mjs'

/* ---------- 单元格解析 ---------- */

test('parsePriceCell 接受带货币符号与千分位的单个数字', () => {
  assert.equal(parsePriceCell('19.99'), 19.99)
  assert.equal(parsePriceCell('$19.99'), 19.99)
  assert.equal(parsePriceCell('¥ 1,299.00'), 1299)
  assert.equal(parsePriceCell('  8  '), 8)
  assert.equal(parsePriceCell(12.5), 12.5)
})

test('parsePriceCell 对无法确定的输入返回 null，绝不猜', () => {
  // 价格区间、文字描述、多个数字都不能在不猜测的前提下变成一个数字
  assert.equal(parsePriceCell('12.99-15.99'), null, '价格区间')
  assert.equal(parsePriceCell('约10刀'), null, '中文描述')
  assert.equal(parsePriceCell('$9.99/$12.99'), null, '多个价格')
  assert.equal(parsePriceCell('-5'), null, '负数')
  assert.equal(parsePriceCell(''), null)
  assert.equal(parsePriceCell(null), null)
  assert.equal(parsePriceCell(undefined), null)
})

test('parsePriceCell 的四舍五入与上限与 NUMERIC(14,2) 对齐', () => {
  assert.equal(parsePriceCell('19.999'), 20)
  assert.equal(parsePriceCell('999999999999'), null, '超出可存储范围')
})

test('parseMarketplaceCell 认两位代码与中文标签', () => {
  assert.equal(parseMarketplaceCell('US'), 'US')
  assert.equal(parseMarketplaceCell('us'), 'US')
  assert.equal(parseMarketplaceCell('美国'), 'US')
  assert.equal(parseMarketplaceCell('日本站'), 'JP')
})

test('parseMarketplaceCell 区分「没填」与「填了但不认识」', () => {
  // 空值回落默认站点是允许的；填了认不出来必须由调用方拒绝（否则数据会落进错误站点）
  assert.equal(parseMarketplaceCell(''), null)
  assert.equal(parseMarketplaceCell(null), null)
  assert.equal(parseMarketplaceCell('火星站'), undefined)
  assert.equal(parseMarketplaceCell('USA'), undefined)
})

test('parseStageCell 认中文标签与英文枚举，认不出来返回 undefined', () => {
  assert.equal(parseStageCell('candidate'), 'candidate')
  assert.equal(parseStageCell('调研中'), 'researching')
  assert.equal(parseStageCell('已立项'), 'approved')
  assert.equal(parseStageCell(''), null)
  assert.equal(parseStageCell('随便看看'), undefined)
})

/* ---------- 表头识别 ---------- */

test('detectProductDevColumns 识别中英文表头并收集附加列', () => {
  const mapping = detectProductDevColumns([
    '产品名称',
    'ASIN',
    '类目',
    '目标售价',
    '站点',
    '阶段',
    '备注',
    '评分',
    '评论数',
  ])
  assert.equal(mapping.product_name, 0)
  assert.equal(mapping.asin, 1)
  assert.equal(mapping.category, 2)
  assert.equal(mapping.target_price, 3)
  assert.equal(mapping.marketplace, 4)
  assert.equal(mapping.stage, 5)
  assert.equal(mapping.note, 6)
  assert.deepEqual(
    mapping.extras.map((item) => item.key),
    ['评分', '评论数'],
    '没匹配到固定字段的列进附加维度，且保留用户自己的叫法'
  )
})

test('detectProductDevColumns 英文表头同样可用', () => {
  const mapping = detectProductDevColumns(['Product Name', 'ASIN', 'price', 'Category'])
  assert.equal(mapping.product_name, 0)
  assert.equal(mapping.asin, 1)
  assert.equal(mapping.target_price, 2)
  assert.equal(mapping.category, 3)
})

test('一个表头不会同时占两列（列下标不重复使用）', () => {
  const mapping = detectProductDevColumns(['名称', '名称'])
  assert.equal(mapping.product_name, 0)
  assert.deepEqual(
    mapping.extras.map((item) => item.index),
    [1],
    '第二列同名表头只能落到附加维度，不能把第 1 列顶掉'
  )
})

test('looksLikeProductDevHeader 只认命中字段别名的首行', () => {
  assert.equal(looksLikeProductDevHeader(['产品名称', '目标售价']), true)
  assert.equal(looksLikeProductDevHeader(['便携榨汁杯', '19.99']), false, '纯数据行不是表头')
  assert.equal(looksLikeProductDevHeader([]), false)
})

/* ---------- 表格解析 ---------- */

const HEADER = ['产品名称', 'ASIN', '类目', '目标售价', '站点', '阶段', '备注', '评分']

test('parseProductDevRows 解析带表头的完整表格', () => {
  const parsed = parseProductDevRows([
    HEADER,
    ['便携榨汁杯', 'B0SAMPLE01', '厨房小家电', '$19.99', 'US', '候选', '看评论区痛点', '4.3'],
  ])

  assert.equal(parsed.headerRecognized, true)
  assert.equal(parsed.headerRow, 1)
  assert.deepEqual(parsed.extraColumns, ['评分'])
  assert.equal(parsed.entries.length, 1)

  const entry = parsed.entries[0]
  assert.equal(entry.line, 2, '行号含表头，便于直接回 Excel 里核对')
  assert.equal(entry.marketplace, 'US')
  assert.equal(entry.asin, 'B0SAMPLE01')
  assert.equal(entry.product_name, '便携榨汁杯')
  assert.equal(entry.category, '厨房小家电')
  assert.equal(entry.target_price, 19.99)
  assert.equal(entry.stage, 'candidate')
  assert.equal(entry.note, '看评论区痛点')
  assert.deepEqual(entry.attributes, { 评分: '4.3' }, '附加列进 attributes，值一律字符串')
  assert.equal(entry.source, 'import')
})

test('parseProductDevRows 允许只有产品名称、没有 ASIN（未上架的候选）', () => {
  const parsed = parseProductDevRows([HEADER, ['硅胶折叠水壶', '', '户外', '', '', '', '', '']])
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.entries[0].asin, null)
  assert.equal(parsed.entries[0].product_name, '硅胶折叠水壶')
  assert.equal(parsed.entries[0].target_price, null)
})

test('parseProductDevRows 无表头时只认第 1 列，第 2 列起不猜不写', () => {
  const parsed = parseProductDevRows([['B0SAMPLE01', '19.99', '厨房小家电']])
  assert.equal(parsed.headerRecognized, false)
  const entry = parsed.entries[0]
  assert.equal(entry.asin, 'B0SAMPLE01')
  assert.equal(entry.product_name, '', '第 1 列是 ASIN 就不当名称')
  assert.equal(entry.target_price, null, '第 2 列可能是价格也可能是别的，猜错就是脏数据')
  assert.equal(entry.category, '')
  assert.deepEqual(entry.attributes, {})
})

test('parseProductDevRows 无表头时第 1 列不是 ASIN 就作为产品名称', () => {
  const parsed = parseProductDevRows([['便携榨汁杯'], ['硅胶折叠水壶']])
  assert.equal(parsed.entries.length, 2)
  assert.equal(parsed.entries[0].product_name, '便携榨汁杯')
  assert.equal(parsed.entries[0].asin, null)
})

test('parseProductDevRows 本次表格内重复记为 repeated', () => {
  const parsed = parseProductDevRows([
    HEADER,
    ['榨汁杯', 'B0SAMPLE01', '', '', 'US', '', '', ''],
    ['榨汁杯', 'B0SAMPLE01', '', '', 'US', '', '', ''],
  ])
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.repeated.length, 1)
  assert.equal(parsed.repeated[0].line, 3)
  assert.equal(parsed.repeated[0].label, 'B0SAMPLE01')
})

test('parseProductDevRows 池里已有记为 duplicated，且不混进 repeated', () => {
  const known = new Set(['asin:US:B0SAMPLE01'])
  const parsed = parseProductDevRows(
    [HEADER, ['榨汁杯', 'B0SAMPLE01', '', '', 'US', '', '', '']],
    { knownKeys: known }
  )
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.entries[0].duplicated, true)
  assert.equal(parsed.repeated.length, 0, '「库里已有」与「本次粘重了」必须分开')
})

test('parseProductDevRows 把无法识别的行放进 invalid 并给出行号与原因', () => {
  const parsed = parseProductDevRows([
    HEADER,
    ['', '', '', '', '', '', '', ''],
    ['榨汁杯', 'https://www.amazon.com/s?k=blender', '', '', 'US', '', '', ''],
    ['水壶', '', '', '', '火星站', '', '', ''],
    ['水壶', '', '', '', 'US', '随便看看', '', ''],
  ])

  // 第 2 行整行空白 → 直接跳过（emptyRows 统计）
  assert.equal(parsed.emptyRows, 1)
  assert.equal(parsed.entries.length, 1, '只有第 3 行的「榨汁杯」可用')

  // ASIN 写错不丢整行：名称还在，候选仍然有价值，但要如实报出来
  const asinIssue = parsed.invalid.find((item) => item.line === 3)
  assert.ok(asinIssue, 'ASIN 列无法识别要有提示')
  assert.match(asinIssue.reason, /无法识别/)

  // 站点认不出来 → 整行拒绝（静默回落默认站点会让数据落进错误的站点）
  const siteIssue = parsed.invalid.find((item) => item.line === 4)
  assert.ok(siteIssue)
  assert.match(siteIssue.reason, /站点/)

  // 阶段认不出来 → 整行拒绝
  const stageIssue = parsed.invalid.find((item) => item.line === 5)
  assert.ok(stageIssue)
  assert.match(stageIssue.reason, /阶段/)
})

test('表格中间有空行时，invalid 的行号仍与 Excel 里看到的一致（回归）', () => {
  const parsed = parseProductDevRows([
    HEADER,
    ['榨汁杯', 'B0SAMPLE01', '', '', 'US', '', '', ''],
    ['', '', '', '', '', '', '', ''],
    ['水壶', 'B0SAMPLE02', '', '', '火星站', '', '', ''],
  ])
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.emptyRows, 1)
  const issue = parsed.invalid.find((item) => item.value === '火星站')
  assert.ok(issue)
  // 早先的实现先过滤空行、再按过滤后的下标推算行号，会把这一行报成第 3 行，用户回表里核对时找不到
  assert.equal(issue.line, 4, '空行被过滤后行号不能前移')
})

test('parseProductDevRows 的价格列有内容但读不出数字时单独记下来', () => {
  const parsed = parseProductDevRows([HEADER, ['榨汁杯', '', '', '12.99-15.99', 'US', '', '', '']])
  const entry = parsed.entries[0]
  assert.equal(entry.target_price, null)
  assert.equal(entry.price_unparsed, '12.99-15.99')
})

test('parseProductDevRows 超过单次行数上限时抛错而不是截断', () => {
  const rows = [HEADER]
  for (let i = 0; i < MAX_IMPORT_ROWS + 1; i += 1) {
    rows.push([`产品${i}`, '', '', '', 'US', '', '', ''])
  }
  assert.throws(() => parseProductDevRows(rows), WatchlistTableError)
})

test('parseProductDevRows 空表抛错', () => {
  assert.throws(() => parseProductDevRows([['', '', '']]), WatchlistTableError)
  assert.throws(() => parseProductDevRows([]), WatchlistTableError)
})

test('无表头且名称按站点判重：同名同站点算重复，换站点不算', () => {
  const parsed = parseProductDevRows([['榨汁杯'], ['榨汁杯']])
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.repeated.length, 1)
})

/* ---------- 文本入口 ---------- */

test('parseProductDevTableText 认制表符表格（从 Excel 直接复制）', () => {
  const parsed = parseProductDevTableText('产品名称\t目标售价\n榨汁杯\t19.99')
  assert.ok(parsed)
  assert.equal(parsed.headerRecognized, true)
  assert.equal(parsed.entries.length, 1)
  assert.equal(parsed.entries[0].target_price, 19.99)
})

test('parseProductDevTableText 认逗号分隔且首行是表头的表格', () => {
  const parsed = parseProductDevTableText('产品名称,ASIN\n榨汁杯,B0SAMPLE01')
  assert.ok(parsed)
  assert.equal(parsed.entries[0].asin, 'B0SAMPLE01')
})

test('parseProductDevTableText 对逗号分隔的多值文本返回 null（那不是表格）', () => {
  // 「水壶A, 水壶B」是用户想加两个产品，按表格解析只会取第一列、静默丢掉后面
  assert.equal(parseProductDevTableText('水壶A, 水壶B'), null)
  assert.equal(parseProductDevTableText(''), null)
  assert.equal(parseProductDevTableText('   '), null)
})

test('parseProductDevTextLines 一行一个，ASIN 与名称都认', () => {
  const parsed = parseProductDevTextLines('B0SAMPLE01\n便携榨汁杯\n\nB0SAMPLE02')
  assert.equal(parsed.entries.length, 3, '空行不计入')
  assert.equal(parsed.entries[0].asin, 'B0SAMPLE01')
  assert.equal(parsed.entries[0].product_name, '')
  assert.equal(parsed.entries[1].product_name, '便携榨汁杯')
  assert.equal(parsed.entries[1].asin, null)
  assert.equal(parsed.entries[2].asin, 'B0SAMPLE02')
})

test('parseProductDevTextLines 同样分四类并尊重 knownKeys', () => {
  const parsed = parseProductDevTextLines('B0SAMPLE01\nB0SAMPLE01\n水壶', {
    knownKeys: new Set(['asin:US:B0SAMPLE02']),
  })
  assert.equal(parsed.entries.length, 2)
  assert.equal(parsed.repeated.length, 1)
})

test('parseProductDevTextLines 超限抛错而不是截断', () => {
  const text = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `产品${i}`).join('\n')
  assert.throws(() => parseProductDevTextLines(text), WatchlistTableError)
})

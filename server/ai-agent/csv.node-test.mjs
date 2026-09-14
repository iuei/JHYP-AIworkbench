import assert from 'node:assert/strict'
import test from 'node:test'
import { CsvParseError, decodeCsvBuffer, parseCsv, parseCsvToObjects, toCsv } from './csv.mjs'
import { supportsEncoding } from './encoding.mjs'

test('parseCsv 解析基本表格并丢弃空行', () => {
  const rows = parseCsv('日期,ASIN,花费\n2026-08-01,B001,12.5\n\n2026-08-02,B001,13\r\n')
  assert.deepEqual(rows, [
    ['日期', 'ASIN', '花费'],
    ['2026-08-01', 'B001', '12.5'],
    ['2026-08-02', 'B001', '13'],
  ])
})

test('parseCsv 处理引号包裹的逗号、换行与转义双引号', () => {
  const text = '活动,备注\n"夏季,促销","第一行\n第二行"\n"他说""你好""",普通'
  const rows = parseCsv(text)
  assert.equal(rows[1][0], '夏季,促销')
  assert.equal(rows[1][1], '第一行\n第二行')
  assert.equal(rows[2][0], '他说"你好"')
  assert.equal(rows[2][1], '普通')
})

test('parseCsv 去掉 BOM 并保留空字段位置', () => {
  const rows = parseCsv('\uFEFFa,b,c\n1,,3\n')
  assert.deepEqual(rows[0], ['a', 'b', 'c'])
  assert.deepEqual(rows[1], ['1', '', '3'])
})

test('parseCsvToObjects 保留原始行号用于失败行定位', () => {
  const { columns, records } = parseCsvToObjects('a,b\n1,2\n3,4\n')
  assert.deepEqual(columns, ['a', 'b'])
  assert.equal(records[0].__line, 2)
  assert.equal(records[1].__line, 3)
  assert.equal(records[1].a, '3')
})

test('parseCsvToObjects 对重复表头报错（避免列被静默覆盖）', () => {
  assert.throws(() => parseCsvToObjects('a,a\n1,2\n'), CsvParseError)
  assert.throws(() => parseCsvToObjects('a,a\n1,2\n'), /重复列名/)
})

test('parseCsvToObjects 处理空文件与仅有表头的文件', () => {
  assert.deepEqual(parseCsvToObjects(''), { columns: [], records: [] })
  const onlyHeader = parseCsvToObjects('a,b\n')
  assert.deepEqual(onlyHeader.columns, ['a', 'b'])
  assert.deepEqual(onlyHeader.records, [])
})

test('parseCsvToObjects 记录每行实际字段数，便于发现漏填', () => {
  const { records } = parseCsvToObjects('a,b,c\n1,2\n')
  assert.equal(records[0].__cellCount, 2)
})

test('decodeCsvBuffer 直接解码 UTF-8', () => {
  const { text, encoding, hadReplacement } = decodeCsvBuffer(
    Buffer.from('日期,花费\n2026-08-01,12.5\n', 'utf8')
  )
  assert.equal(encoding, 'utf8')
  assert.equal(hadReplacement, false)
  assert.ok(text.includes('日期,花费'))
})

test('decodeCsvBuffer 对 GBK 编码的文件回退正确解码（中文 Excel 导出的常见情况）', () => {
  if (!supportsEncoding('gb18030') && !supportsEncoding('gbk')) {
    // 环境缺少该编码支持时跳过，不算失败
    return
  }
  // 用 Node 内置编码能力构造 GBK 字节：先取 GBK 不可直接编码，改用固定字节序列
  // "日期" 的 GBK 编码为 C8 D5 C6 DA
  const gbkBytes = Buffer.from([0xc8, 0xd5, 0xc6, 0xda, 0x2c, 0x31, 0x0a])
  const result = decodeCsvBuffer(gbkBytes)
  assert.equal(result.hadReplacement, true)
  assert.ok(
    result.encoding === 'gb18030' || result.encoding === 'gbk',
    `实际回退到 ${result.encoding}`
  )
  assert.ok(result.text.startsWith('日期'), `实际解码结果：${result.text}`)
  assert.ok(!result.text.includes('\uFFFD'))
})

test('decodeCsvBuffer 处理空 buffer', () => {
  const result = decodeCsvBuffer(Buffer.alloc(0))
  assert.equal(result.text, '')
  assert.equal(result.encoding, 'utf8')
})

test('toCsv 生成带 BOM 的文本并对特殊字符转义', () => {
  const csv = toCsv(
    [{ key: 'title', label: '标题' }, { key: 'note', label: '备注' }],
    [{ title: '含,逗号', note: '含"引号"' }]
  )
  assert.ok(csv.startsWith('\uFEFF'))
  assert.ok(csv.includes('标题,备注'))
  assert.ok(csv.includes('"含,逗号"'))
  assert.ok(csv.includes('"含""引号"""'))
})

test('toCsv 支持自定义取值函数并正确处理空值', () => {
  const csv = toCsv(
    [{ label: 'ID', value: (row) => row.id }, { label: '空', key: 'missing' }],
    [{ id: 7 }]
  )
  assert.ok(csv.includes('ID,空'))
  assert.ok(csv.includes('7,'))
})

test('toCsv 与 parseCsv 往返一致', () => {
  const rows = [
    { name: '中文,带逗号', value: '多行\n文本' },
    { name: '普通', value: 'plain' },
  ]
  const csv = toCsv([{ key: 'name', label: 'name' }, { key: 'value', label: 'value' }], rows)
  const parsed = parseCsv(csv)
  assert.deepEqual(parsed[0], ['name', 'value'])
  assert.deepEqual(parsed[1], ['中文,带逗号', '多行\n文本'])
  assert.deepEqual(parsed[2], ['普通', 'plain'])
})

/**
 * ASIN 表格解析层单测（2026-09-15 建立，2026-09-18 增加站点列）。
 *
 * 全部是纯函数 + 自造缓冲区，不碰数据库、不碰网络：表格导入最容易出错的正是
 * "列认错了""行号对不上""超限静默丢数据"这三类，而这些都不需要真实环境就能钉住。
 *
 * 2026-09-18：站点从清单下沉到每条 ASIN，解析层的映射与条目都多了一个 `marketplace`；
 * 站点值不认识时**整行进 invalid**（不静默改用默认站点）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_TABLE_ROWS,
  WatchlistTableError,
  analyzeTableRows,
  detectColumnMapping,
  looksLikeHeaderRow,
  normalizeMarketplaceValue,
  parseTableText,
  readTableRowsFromBuffer,
} from './watchlist-table.mjs'
import { makeXlsxBuffer } from './xlsx-fixture.mjs'

/* ---------- 列识别 ---------- */

test('detectColumnMapping 认中英文表头', () => {
  assert.deepEqual(detectColumnMapping(['ASIN', '别名', '备注']), {
    asin: 0,
    marketplace: null,
    alias: 1,
    note: 2,
  })
  assert.deepEqual(detectColumnMapping(['商品编码', '商品名称', '说明']), {
    asin: 0,
    marketplace: null,
    alias: 1,
    note: 2,
  })
  assert.deepEqual(detectColumnMapping(['asin', 'alias', 'note']), {
    asin: 0,
    marketplace: null,
    alias: 1,
    note: 2,
  })
})

test('detectColumnMapping 认站点列（站点 / 国家 / marketplace 都行）', () => {
  assert.deepEqual(detectColumnMapping(['ASIN', '站点', '别名', '备注']), {
    asin: 0,
    marketplace: 1,
    alias: 2,
    note: 3,
  })
  assert.deepEqual(detectColumnMapping(['ASIN', '国家', '备注']).marketplace, 1)
  assert.deepEqual(detectColumnMapping(['asin', 'marketplace']).marketplace, 1)
  // 别名列表里的「商品名称」不能被站点列抢走
  assert.equal(detectColumnMapping(['ASIN', '商品名称']).alias, 1)
})

test('detectColumnMapping 精确匹配优先：ASIN别名 不会抢占 ASIN 列', () => {
  // 若按"包含 asin 即命中"先扫，index 0 会被当成 ASIN 列，整列别名会被当作商品编码导入
  assert.deepEqual(detectColumnMapping(['ASIN别名', 'ASIN']), {
    asin: 1,
    marketplace: null,
    alias: null,
    note: null,
  })
})

test('detectColumnMapping 忽略括号注释与空白', () => {
  assert.deepEqual(detectColumnMapping(['ASIN（亚马逊编码）', ' 备注 ']), {
    asin: 0,
    marketplace: null,
    alias: null,
    note: 1,
  })
})

test('detectColumnMapping 识别不到 ASIN 列时返回 null', () => {
  assert.equal(detectColumnMapping(['商品', '价格']).asin, null)
})

test('looksLikeHeaderRow 以"这行有没有像 ASIN 的值"判定，不依赖 asin 字样', () => {
  assert.equal(looksLikeHeaderRow(['ASIN', '别名']), true)
  assert.equal(looksLikeHeaderRow(['商品', '价格']), true) // 没有合法 ASIN → 视为表头
  assert.equal(looksLikeHeaderRow(['B0AAAAAAAA', '主力款']), false)
})

test('looksLikeHeaderRow 不把"本身含 asin 子串"的合法 ASIN 当成表头', () => {
  // 踩过的坑：B0MYASIN01 里含 "asin"，曾被模糊表头匹配吃掉整行数据
  assert.equal(looksLikeHeaderRow(['B0MYASIN01', 'B0MYASIN02']), false)
  assert.equal(looksLikeHeaderRow(['B0MYASIN01', '主力款']), false)
})

test('parseTableText 对"含 asin 子串的 ASIN + 自由文本"仍回退到文本解析', () => {
  // 第一行是逗号分隔的两个 ASIN、第二行是顿号分隔的自由文本：列数不一致 → 不是表格
  assert.equal(parseTableText('B0MYASIN01, B0MYASIN02\nB0MYASIN01、夏季款水杯'), null)
})

/* ---------- 站点值归一化 ---------- */

test('normalizeMarketplaceValue 认代码、中文名与"中文名+代码"', () => {
  assert.equal(normalizeMarketplaceValue('us'), 'US')
  assert.equal(normalizeMarketplaceValue(' 美国 '), 'US')
  assert.equal(normalizeMarketplaceValue('美国站'), 'US')
  assert.equal(normalizeMarketplaceValue('美国US'), 'US')
  assert.equal(normalizeMarketplaceValue('德国'), 'DE')
  assert.equal(normalizeMarketplaceValue('澳洲'), 'AU')
})

test('normalizeMarketplaceValue 不认识的值返回 null（不猜站点）', () => {
  assert.equal(normalizeMarketplaceValue('火星'), null)
  assert.equal(normalizeMarketplaceValue('XX'), null)
  assert.equal(normalizeMarketplaceValue(''), null)
})

/* ---------- 行解析与四分类 ---------- */

test('analyzeTableRows 把站点/别名/备注一起带出来，并按 Excel 行号报告问题行', () => {
  const result = analyzeTableRows([
    ['ASIN', '站点', '别名', '备注'],
    ['B0AAAAAAAA', 'US', '主力款', '测试备注'],
    ['b0bbbbbbbb', '德国', '', ''],
    ['B0AAAAAAAA', 'US', '重复行', ''],
    ['乱码值', 'US', '', ''],
    ['', '', '', ''],
  ])

  assert.deepEqual(result.mapping, { asin: 0, marketplace: 1, alias: 2, note: 3 })
  assert.equal(result.headerRow, 1)
  assert.deepEqual(result.entries, [
    {
      asin: 'B0AAAAAAAA',
      marketplace: 'US',
      alias: '主力款',
      note: '测试备注',
      line: 2,
    },
    { asin: 'B0BBBBBBBB', marketplace: 'DE', alias: null, note: null, line: 3 },
  ])
  assert.deepEqual(result.invalid, [{ line: 5, value: '乱码值' }])
  assert.deepEqual(result.repeated, [
    { line: 4, asin: 'B0AAAAAAAA', marketplace: 'US', firstLine: 2 },
  ])
  assert.equal(result.emptyRows, 1)
})

test('analyzeTableRows 没有站点列时落到 defaultMarketplace', () => {
  const result = analyzeTableRows([['ASIN', '别名'], ['B0AAAAAAAA', '主力款']], {
    defaultMarketplace: 'JP',
  })
  assert.equal(result.entries[0].marketplace, 'JP')
})

test('analyzeTableRows 站点列空值落到 defaultMarketplace，非法值整行拒绝', () => {
  const result = analyzeTableRows(
    [
      ['ASIN', '站点', '别名'],
      ['B0AAAAAAAA', '', '空站点走默认'],
      ['B0BBBBBBBB', '火星', '非法站点'],
      ['B0CCCCCCCC', 'UK', '正常'],
    ],
    { defaultMarketplace: 'US' }
  )
  assert.deepEqual(
    result.entries.map((entry) => [entry.asin, entry.marketplace]),
    [
      ['B0AAAAAAAA', 'US'],
      ['B0CCCCCCCC', 'UK'],
    ]
  )
  assert.equal(result.invalid.length, 1)
  assert.equal(result.invalid[0].line, 3)
  assert.match(result.invalid[0].value, /火星/)
})

test('analyzeTableRows 同一个 ASIN 的两个站点不算重复', () => {
  const result = analyzeTableRows([
    ['ASIN', '站点'],
    ['B0AAAAAAAA', 'US'],
    ['B0AAAAAAAA', 'DE'],
  ])
  assert.deepEqual(
    result.entries.map((entry) => entry.marketplace),
    ['US', 'DE']
  )
  assert.equal(result.repeated.length, 0)
})

test('analyzeTableRows 无表头时把第一列当 ASIN，且行号从 1 开始', () => {
  const result = analyzeTableRows([['B0AAAAAAAA'], ['B0BBBBBBBB']])
  assert.equal(result.headerRow, null)
  assert.deepEqual(
    result.entries.map((entry) => entry.line),
    [1, 2]
  )
})

test('analyzeTableRows 兼容商品链接与大小写', () => {
  const result = analyzeTableRows([
    ['ASIN'],
    ['https://www.amazon.com/dp/B0AAAAAAAA?ref=x'],
    ['b0bbbbbbbb'],
  ])
  assert.deepEqual(
    result.entries.map((entry) => entry.asin),
    ['B0AAAAAAAA', 'B0BBBBBBBB']
  )
})

test('analyzeTableRows 截断超长别名/备注，而不是整行拒绝', () => {
  const result = analyzeTableRows([['ASIN', '别名'], ['B0AAAAAAAA', 'x'.repeat(300)]], {
    maxAliasLength: 10,
  })
  assert.equal(result.entries[0].alias.length, 10)
})

test('analyzeTableRows 只有空行时报错', () => {
  assert.throws(() => analyzeTableRows([[''], ['  ']]), WatchlistTableError)
})

test('analyzeTableRows 找不到 ASIN 列时把当前表头回给用户', () => {
  assert.throws(
    () => analyzeTableRows([['商品', '价格'], ['水杯', '19.9']]),
    (error) => error instanceof WatchlistTableError && error.message.includes('商品')
  )
})

test('analyzeTableRows 超过行数上限时报错并说清行数', () => {
  const rows = [['ASIN']]
  for (let index = 0; index <= MAX_TABLE_ROWS; index += 1) {
    rows.push([`B0${String(index).padStart(8, '0')}`])
  }
  assert.throws(
    () => analyzeTableRows(rows),
    (error) =>
      error instanceof WatchlistTableError && error.message.includes(String(MAX_TABLE_ROWS))
  )
})

/* ---------- 文本粘贴（Excel 复制 = TSV） ---------- */

test('parseTableText 解析 Excel 复制出来的 TSV（含表头与站点列）', () => {
  const result = parseTableText('ASIN\t站点\t别名\t备注\nB0AAAAAAAA\tUS\t主力款\t\n')
  assert.deepEqual(result.mapping, { asin: 0, marketplace: 1, alias: 2, note: 3 })
  assert.deepEqual(result.entries, [
    { asin: 'B0AAAAAAAA', marketplace: 'US', alias: '主力款', note: null, line: 2 },
  ])
})

test('parseTableText 解析逗号分隔的 CSV 文本', () => {
  const result = parseTableText('ASIN,别名\nB0AAAAAAAA,主力款\nB0BBBBBBBB,')
  assert.equal(result.entries.length, 2)
  assert.equal(result.entries[1].asin, 'B0BBBBBBBB')
})

test('parseTableText 对单列纯 ASIN 文本返回 null（回退到原有粘贴路径）', () => {
  assert.equal(parseTableText('B0AAAAAAAA\nB0BBBBBBBB'), null)
  assert.equal(parseTableText('B0AAAAAAAA, B0BBBBBBBB'), null)
  assert.equal(parseTableText(''), null)
})

test('parseTableText 对"多行、逗号分隔、但每格都是 ASIN"的文本返回 null', () => {
  // 用户想要的是 4 个商品：按表格解析只取第一列会静默丢掉一半
  assert.equal(parseTableText('B0AAAAAAAA,B0BBBBBBBB\nB0CCCCCCCC,B0DDDDDDDD'), null)
  // 列数不一致（第二行是顿号分隔的自由文本）同样不是表格
  assert.equal(parseTableText('B0AAAAAAAA, B0BBBBBBBB\nB0CCCCCCCC、夏季款水杯'), null)
})

test('parseTableText 认"无表头但每行固定多列"的表格', () => {
  const result = parseTableText('B0AAAAAAAA,主力款\nB0BBBBBBBB,新款')
  assert.notEqual(result, null)
  assert.deepEqual(
    result.entries.map((entry) => [entry.asin, entry.alias]),
    [
      ['B0AAAAAAAA', '主力款'],
      ['B0BBBBBBBB', '新款'],
    ]
  )
})

test('parseTableText 无表头两列且整列都是站点时，第 2 列按站点解析', () => {
  const result = parseTableText('B0AAAAAAAA,US\nB0BBBBBBBB,德国')
  assert.notEqual(result, null)
  assert.deepEqual(
    result.entries.map((entry) => [entry.asin, entry.marketplace]),
    [
      ['B0AAAAAAAA', 'US'],
      ['B0BBBBBBBB', 'DE'],
    ]
  )
})

test('无表头且三列以上时只认第一列，不猜第 2 列是什么', () => {
  // 第 2 列可能是价格 / 负责人 / 上架时间：猜错等于把无关数据写进备注，用户还得逐条清理
  const result = analyzeTableRows([
    ['B0AAAAAAAA', '19.9', '张三'],
    ['B0BBBBBBBB', '29.9', '李四'],
  ])
  assert.deepEqual(result.mapping, {
    asin: 0,
    marketplace: null,
    alias: null,
    note: null,
  })
  assert.equal(result.entries[0].alias, null)
})

/* ---------- 文件缓冲区分派 ---------- */

test('readTableRowsFromBuffer 解析 UTF-8 CSV', async () => {
  const { rows, format } = await readTableRowsFromBuffer({
    buffer: Buffer.from('ASIN,站点,别名\nB0AAAAAAAA,US,主力款\n', 'utf8'),
    fileName: 'list.csv',
  })
  assert.equal(format, 'csv')
  assert.equal(rows[0][2], '别名')
})

test('readTableRowsFromBuffer 对 GBK 编码的中文 CSV 回退解码（中文 Excel 默认导出格式）', () => {
  // "别名" 的 GBK 字节是 B1 F0 C3 FB；不做事后回退就会整列乱码
  const gbk = Buffer.concat([
    Buffer.from('ASIN,', 'ascii'),
    Buffer.from([0xb1, 0xf0, 0xc3, 0xfb]),
    Buffer.from('\nB0AAAAAAAA,', 'ascii'),
    Buffer.from([0xd6, 0xf7, 0xc1, 0xa6, 0xbf, 0xee]), // 主力款
    Buffer.from('\nB0BBBBBBBB,\n', 'ascii'),
  ])
  return readTableRowsFromBuffer({ buffer: gbk, fileName: 'list.csv' }).then(
    ({ rows, encoding }) => {
      assert.equal(rows[0][1], '别名')
      assert.equal(rows[1][1], '主力款')
      assert.notEqual(encoding, 'utf8')
    }
  )
})

test('readTableRowsFromBuffer 明确拒绝 .xls 与空文件', async () => {
  await assert.rejects(
    () => readTableRowsFromBuffer({ buffer: Buffer.from('x'), fileName: 'old.xls' }),
    (error) => error instanceof WatchlistTableError && error.message.includes('.xls')
  )
  await assert.rejects(
    () => readTableRowsFromBuffer({ buffer: Buffer.alloc(0), fileName: 'empty.csv' }),
    WatchlistTableError
  )
})

test('readTableRowsFromBuffer 能读 xlsx（自造最小工作簿）', async () => {
  const { rows, format } = await readTableRowsFromBuffer({
    buffer: makeXlsxBuffer([
      ['ASIN', '别名'],
      ['B0AAAAAAAA', '主力款'],
      ['B0BBBBBBBB', ''],
    ]),
    fileName: 'list.xlsx',
  })
  assert.equal(format, 'xlsx')
  assert.deepEqual(rows[0], ['ASIN', '别名'])
  assert.deepEqual(rows[1], ['B0AAAAAAAA', '主力款'])
  assert.equal(rows[2][1], null)
})

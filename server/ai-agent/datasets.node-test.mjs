import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DATASET_SPECS,
  datasetRowColumns,
  datasetRowOrder,
  datasetRowSelectList,
  datasetSearchColumns,
  datasetTemplate,
  findDatasetSpec,
  normalizeMarketplace,
  parseDatasetBuffer,
  parseDateValue,
  parseDecimalValue,
  parseIntValue,
  resolveColumns,
} from './datasets.mjs'

const ADS = findDatasetSpec('amazon_ads_daily')
const INVENTORY = findDatasetSpec('inventory_snapshot')

const ADS_HEADER = '日期,ASIN,广告活动,站点,曝光,点击,花费,订单,销售额,ACoS'
const adsRow = (date, spend, sales, extra = {}) =>
  [
    date,
    'B0TEST1234',
    extra.campaign ?? 'SP-自动',
    extra.marketplace ?? 'US',
    extra.impressions ?? 1000,
    extra.clicks ?? 10,
    spend,
    extra.orders ?? 2,
    sales,
    extra.acos ?? '',
  ].join(',')

function bufferOf(text) {
  return Buffer.from(text, 'utf8')
}

/* ---------- 取值解析 ---------- */

test('parseDateValue 支持 ISO、斜杠、中文日期与 Excel 序列号', () => {
  assert.equal(parseDateValue('2026-09-01'), '2026-09-01')
  assert.equal(parseDateValue('2026/9/1'), '2026-09-01')
  assert.equal(parseDateValue('09/01/2026'), '2026-09-01')
  assert.equal(parseDateValue('2026年9月1日'), '2026-09-01')
  // Excel 1900 日期系统的序列号：45901 = 2025-09-01 附近，只校验能被解析为合法日期
  assert.match(parseDateValue('45000'), /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(parseDateValue(''), null)
  assert.equal(parseDateValue('不是日期'), null)
  assert.equal(parseDateValue('2026-13-45'), null)
})

test('parseIntValue / parseDecimalValue 容忍千分位、货币符号、百分号', () => {
  assert.equal(parseIntValue('1,234'), 1234)
  assert.equal(parseIntValue('¥1,234'), 1234)
  assert.equal(parseIntValue('12.6'), 13)
  assert.equal(parseIntValue('', { fallback: 0 }), 0)
  assert.equal(parseIntValue('abc'), null)

  assert.equal(parseDecimalValue('1,234.56'), 1234.56)
  assert.equal(parseDecimalValue('$12.50'), 12.5)
  assert.equal(parseDecimalValue('25.30%'), 25.3)
  assert.equal(parseDecimalValue('−3.5'), -3.5)
  assert.equal(parseDecimalValue('', { fallback: 0 }), 0)
})

test('normalizeMarketplace 把中文站点名归一化为站点代码', () => {
  assert.equal(normalizeMarketplace('美国站'), 'US')
  assert.equal(normalizeMarketplace('英国'), 'UK')
  assert.equal(normalizeMarketplace('德国站'), 'DE')
  assert.equal(normalizeMarketplace('us'), 'US')
  assert.equal(normalizeMarketplace(''), 'US')
  assert.equal(normalizeMarketplace('火星站'), '火星站'.toUpperCase().slice(0, 10))
})

/* ---------- 列名映射 ---------- */

test('resolveColumns 用中文模板表头命中全部列', () => {
  const { mapping, missing, ignored } = resolveColumns(ADS, ADS_HEADER.split(','))
  assert.deepEqual(missing, [])
  assert.deepEqual(ignored, [])
  assert.equal(mapping.stat_date, '日期')
  assert.equal(mapping.asin, 'ASIN')
  assert.equal(mapping.spend, '花费')
})

test('resolveColumns 接受英文别名（Amazon 后台导出）', () => {
  const { mapping, missing } = resolveColumns(ADS, [
    'Date',
    'ASIN',
    'Campaign Name',
    'Marketplace',
    'Impressions',
    'Clicks',
    'Spend',
    'Orders',
    'Sales',
    'ACOS',
  ])
  assert.deepEqual(missing, [])
  assert.equal(mapping.stat_date, 'Date')
  assert.equal(mapping.campaign, 'Campaign Name')
  assert.equal(mapping.acos, 'ACOS')
})

test('resolveColumns 报出缺失的必填列并列出被忽略的多余列', () => {
  const { missing, ignored } = resolveColumns(ADS, ['日期', '广告活动', '花费', '广告组标记'])
  assert.deepEqual(missing.sort(), ['ASIN'])
  assert.deepEqual(ignored, ['广告组标记'])
})

/* ---------- 整批校验 ---------- */

test('parseDatasetBuffer 缺必填列时整批拒绝并提示使用模板', () => {
  const result = parseDatasetBuffer(ADS, bufferOf(`日期,花费\n2026-09-01,10\n`))
  assert.equal(result.ok, false)
  assert.match(result.error, /缺少必填列：ASIN/)
  assert.match(result.error, /模板/)
})

test('parseDatasetBuffer 正常解析并按日期给出数据周期', () => {
  const csv = [ADS_HEADER, adsRow('2026-09-03', '12.5', '100'), adsRow('2026-09-01', '10', '80')].join(
    '\n'
  )
  const result = parseDatasetBuffer(ADS, bufferOf(csv))
  assert.equal(result.ok, true)
  assert.equal(result.rowCount, 2)
  assert.deepEqual(result.period, { start: '2026-09-01', end: '2026-09-03' })
  assert.equal(result.records[0].spend, 12.5)
  assert.equal(result.records[0].asin, 'B0TEST1234')
  assert.equal(result.records[0].marketplace, 'US')
  assert.equal(result.ignoredColumns.length, 0)
})

test('parseDatasetBuffer 对必填列空值的行整批拒绝并给出失败行号', () => {
  const csv = [
    ADS_HEADER,
    adsRow('2026-09-01', '10', '80'),
    '2026-09-02,,SP-自动,US,1000,10,11,2,90,',
  ].join('\n')
  const result = parseDatasetBuffer(ADS, bufferOf(csv))
  assert.equal(result.ok, false)
  assert.match(result.error, /1 行数据有问题/)
  assert.equal(result.rowErrors[0].line, 3)
  assert.equal(result.rowErrors[0].column, 'ASIN')
})

test('parseDatasetBuffer 在 onRowError=skip 时跳过坏行并保留好行', () => {
  const csv = [
    ADS_HEADER,
    adsRow('2026-09-01', '10', '80'),
    '2026-09-02,,SP-自动,US,1000,10,11,2,90,',
  ].join('\n')
  const result = parseDatasetBuffer(ADS, bufferOf(csv), { onRowError: 'skip' })
  assert.equal(result.ok, true)
  assert.equal(result.rowCount, 1)
  assert.equal(result.skippedRows, 1)
})

test('parseDatasetBuffer 对可选数值列空值使用默认值，不判为失败', () => {
  const csv = [
    ADS_HEADER,
    '2026-09-01,B0TEST1234,SP-自动,US,,,10,,80,',
  ].join('\n')
  const result = parseDatasetBuffer(ADS, bufferOf(csv))
  assert.equal(result.ok, true)
  assert.equal(result.records[0].impressions, 0)
  assert.equal(result.records[0].clicks, 0)
  assert.equal(result.records[0].orders, 0)
  assert.equal(result.records[0].acos, null)
})

test('parseDatasetBuffer 拒绝空文件、只有表头、重复表头', () => {
  assert.match(parseDatasetBuffer(ADS, Buffer.alloc(0)).error, /为空/)
  assert.match(parseDatasetBuffer(ADS, bufferOf('日期,ASIN\n')).error, /只有表头/)
  assert.match(parseDatasetBuffer(ADS, bufferOf('日期,日期\n2026-09-01,2026-09-02\n')).error, /重复列名/)
})

test('parseDatasetBuffer 对超大文件与超量行数给出明确提示', () => {
  const big = Buffer.alloc(8 * 1024 * 1024 + 1, 0x61)
  assert.match(parseDatasetBuffer(ADS, big).error, /上限/)
})

test('parseDatasetBuffer 支持只有 SKU 与数量必填的库存数据集', () => {
  const csv = ['SKU,可用库存,仓库', 'KT-JH-001-BK,320,美国仓'].join('\n')
  const result = parseDatasetBuffer(INVENTORY, bufferOf(csv))
  assert.equal(result.ok, true)
  assert.equal(result.records[0].sku, 'KT-JH-001-BK')
  assert.equal(result.records[0].available, 320)
  assert.equal(result.records[0].in_transit, 0)
  assert.equal(result.records[0].warehouse, '美国仓')
})

/* ---------- 模板 ---------- */

test('datasetTemplate 生成含中文表头与示例行的模板', () => {
  const csv = datasetTemplate(ADS)
  const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n')
  assert.equal(lines[0], ADS_HEADER)
  assert.equal(lines.length, 2, '模板应只有表头与一行示例')
  // 模板必须能被自己的解析器接受，否则用户会导入失败
  const parsed = parseDatasetBuffer(ADS, Buffer.from(csv, 'utf8'))
  assert.equal(parsed.ok, true, parsed.error)
})

test('每个数据集模板都能被自己的解析器接受', () => {
  for (const spec of DATASET_SPECS) {
    const csv = datasetTemplate(spec)
    const parsed = parseDatasetBuffer(spec, Buffer.from(csv, 'utf8'))
    assert.equal(parsed.ok, true, `${spec.key}: ${parsed.error}`)
  }
})

test('数据集规格自身完整：表名、日期列与列定义齐全', () => {
  assert.ok(DATASET_SPECS.length >= 4)
  for (const spec of DATASET_SPECS) {
    assert.ok(spec.table, spec.key)
    if (spec.dateColumn) {
      assert.ok(
        spec.columns.some((item) => item.key === spec.dateColumn),
        `${spec.key} 的 dateColumn(${spec.dateColumn}) 必须出现在列定义中`
      )
    }
    for (const item of spec.columns) {
      assert.ok(item.label && item.key && item.type, `${spec.key} 列定义不完整`)
      assert.ok(item.aliases.length >= 2, `${spec.key}.${item.key} 缺少别名`)
    }
  }
})

/* ---------- 行详情（数据源卡片点开查看） ---------- */

test('datasetRowColumns = 模板列 + 附加列，且不改动规格自身', () => {
  const inventory = findDatasetSpec('inventory_snapshot')
  const columns = datasetRowColumns(inventory)
  assert.ok(columns.some((item) => item.key === 'sku'))
  // 快照时点不在导入模板里（由 DB 默认值填充），但行详情必须看得到，否则分不清批次
  assert.ok(columns.some((item) => item.key === 'snapshot_at' && item.label === '快照时间'))
  assert.equal(
    inventory.columns.some((item) => item.key === 'snapshot_at'),
    false,
    '规格不应被污染'
  )

  // 无附加列的数据集原样返回模板列
  const ads = findDatasetSpec('amazon_ads_daily')
  assert.deepEqual(
    datasetRowColumns(ads).map((item) => item.key),
    ads.columns.map((item) => item.key)
  )
  assert.equal(datasetRowColumns(null).length, 0)
})

test('datasetSearchColumns 只收文本类列，排除数值列', () => {
  const ads = findDatasetSpec('amazon_ads_daily')
  const searchable = datasetSearchColumns(ads)
  for (const key of ['asin', 'campaign', 'marketplace', 'stat_date']) {
    assert.ok(searchable.includes(key), `${key} 应可搜索`)
  }
  // 数值列不参与搜索：`spend::text ILIKE '%1%'` 几乎命中全部行，且必然全表扫描
  for (const key of ['spend', 'clicks', 'impressions', 'orders', 'sales', 'acos']) {
    assert.equal(searchable.includes(key), false, `${key} 不应参与搜索`)
  }
})

test('datasetRowOrder 对可空时间列加 NULLS LAST，快照表按主键倒序', () => {
  // order_snapshot.ordered_at 允许为空：默认 DESC 会把空行排在第一页最前面
  assert.equal(
    datasetRowOrder(findDatasetSpec('order_snapshot')),
    'ordered_at DESC NULLS LAST, id DESC'
  )
  assert.equal(datasetRowOrder(findDatasetSpec('inventory_snapshot')), 'id DESC')
  assert.equal(datasetRowOrder(null), 'id DESC')
})

test('datasetRowSelectList 把日期/时间列取成文本，避免时区串味', () => {
  const select = datasetRowSelectList(findDatasetSpec('amazon_ads_daily'))
  assert.ok(select.startsWith('id, '))
  // TEMPSTAMP 交给 pg 会解析成 Date 再按 UTC 序列化，东八区核对时会差 8 小时
  assert.ok(select.includes(`to_char(stat_date, 'YYYY-MM-DD') AS stat_date`))

  const inventory = datasetRowSelectList(findDatasetSpec('inventory_snapshot'))
  assert.ok(inventory.includes(`to_char(snapshot_at, 'YYYY-MM-DD HH24:MI:SS') AS snapshot_at`))
  assert.ok(inventory.includes('available'))

  const master = datasetRowSelectList(findDatasetSpec('product_master'))
  assert.ok(master.includes('product_name'))
  assert.equal(master.includes('to_char'), false, '无日期列的数据集不应出现 to_char')
})

test('快照类数据集（无周期列）覆盖导入应整表替换，而不是合并', () => {
  // 这是实测踩到的坑：库存快照导 5 行只进 3 行，因为旧快照的行与 UNIQUE(sku, warehouse) 冲突被跳过，
  // 而"覆盖"没有删除任何行。规格上必须能区分"有周期"与"无周期"两类数据集的覆盖语义。
  const inventorySpec = findDatasetSpec('inventory_snapshot')
  assert.equal(inventorySpec.periodColumn, null, '库存快照没有周期列')
  const adsSpec = findDatasetSpec('amazon_ads_daily')
  assert.equal(adsSpec.periodColumn, 'stat_date', '广告日报按 stat_date 覆盖周期')
})

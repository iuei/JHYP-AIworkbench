/**
 * 生成模拟业务报表（CSV），用于端到端验证与演示。
 *
 * 数据是**人为设计**的，目的是让归因有明确答案、可逐步复核：
 *   ASIN B0SAMPLE01 / 美国站
 *   2026-06 ~ 2026-07：花费 100/天，广告销售额 500/天 → ACoS 20%
 *   2026-08        ：花费 130/天，广告销售额 400/天 → ACoS 32.5%
 *   → ACoS 上升 12.5 个百分点，服务端分解应为：
 *        花费效应 = (130-100)/500*100 = 6.0
 *        销售额效应 = (130/400 - 130/500)*100 = 6.5
 *     主因 = 销售额下滑（略强于花费上涨）
 *   2025-08 同期：花费 90/天，广告销售额 550/天 → ACoS 16.36%（用于同比）
 *
 * 用法：node server/ai-agent/eval/make-sample-data.mjs
 * 产出：server/ai-agent/eval/fixtures/data/*.csv
 * 说明：GBK 编码回退由 csv.node-test.mjs 用固定字节用例验证，此处不重复造样例。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { toCsv } from '../csv.mjs'
import { DATASET_SPECS, findDatasetSpec } from '../datasets.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(HERE, 'fixtures', 'data')

const ASIN = 'B0SAMPLE01'
const ASIN_BAD = 'B0SAMPLE02'
const SKU = 'KT-JH-001-BK'

/** 确定性伪随机（避免每次生成结果不同，便于复核与回归）。 */
function seeded(seed) {
  let value = seed
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648
    return value / 2147483648
  }
}

function daysOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function dateOf(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** 生成某个月的广告日报：spend/sales 为目标日均值的 ±5% 抖动。 */
function adsRowsFor({ year, month, dailySpend, dailySales, asin = ASIN, campaign = 'SP-自动-主推' }) {
  const random = seeded(year * 100 + month)
  const rows = []
  for (let day = 1; day <= daysOfMonth(year, month); day += 1) {
    const jitter = () => 0.95 + random() * 0.1
    const spend = Number((dailySpend * jitter()).toFixed(2))
    const sales = Number((dailySales * jitter()).toFixed(2))
    const impressions = Math.round(18000 * jitter())
    const clicks = Math.round(impressions * (0.0055 * jitter()))
    const orders = Math.round((sales / 42) * jitter())
    rows.push({
      stat_date: dateOf(year, month, day),
      asin,
      campaign,
      marketplace: 'US',
      impressions,
      clicks,
      spend,
      orders,
      sales,
      acos: Number(((spend / sales) * 100).toFixed(2)),
    })
  }
  return rows
}

function salesRowsFor({ year, month, dailyUnits, dailySales, asin = ASIN }) {
  const random = seeded(year * 200 + month)
  const rows = []
  for (let day = 1; day <= daysOfMonth(year, month); day += 1) {
    const jitter = () => 0.9 + random() * 0.2
    rows.push({
      stat_date: dateOf(year, month, day),
      asin,
      marketplace: 'US',
      units: Math.round(dailyUnits * jitter()),
      sales: Number((dailySales * jitter()).toFixed(2)),
      returns: Math.round(dailyUnits * 0.03 * jitter()),
    })
  }
  return rows
}

function columnsOf(specKey, rows) {
  const spec = findDatasetSpec(specKey)
  return spec.columns.map((item) => ({
    label: item.label,
    value: (row) => (row[item.key] === null || row[item.key] === undefined ? '' : row[item.key]),
  }))
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })

  const ads = [
    // 去年同期（供同比）
    ...adsRowsFor({ year: 2025, month: 8, dailySpend: 90, dailySales: 550 }),
    // 本期
    ...adsRowsFor({ year: 2026, month: 6, dailySpend: 100, dailySales: 500 }),
    ...adsRowsFor({ year: 2026, month: 7, dailySpend: 100, dailySales: 500 }),
    ...adsRowsFor({ year: 2026, month: 8, dailySpend: 130, dailySales: 400 }),
    // 第二个 ASIN：8 月明显恶化（ACoS 超过 35% 预警线、转化率跌破 7%），用于验证异常扫描能把它挑出来
    ...adsRowsFor({ year: 2026, month: 6, dailySpend: 60, dailySales: 300, asin: ASIN_BAD, campaign: 'SP-手动-长尾' }),
    ...adsRowsFor({ year: 2026, month: 7, dailySpend: 60, dailySales: 300, asin: ASIN_BAD, campaign: 'SP-手动-长尾' }),
    ...adsRowsFor({ year: 2026, month: 8, dailySpend: 80, dailySales: 220, asin: ASIN_BAD, campaign: 'SP-手动-长尾' }),
  ]
  const sales = [
    ...salesRowsFor({ year: 2025, month: 8, dailyUnits: 14, dailySales: 620 }),
    ...salesRowsFor({ year: 2026, month: 6, dailyUnits: 12, dailySales: 560 }),
    ...salesRowsFor({ year: 2026, month: 7, dailyUnits: 12, dailySales: 560 }),
    ...salesRowsFor({ year: 2026, month: 8, dailyUnits: 9, dailySales: 470 }),
    ...salesRowsFor({ year: 2026, month: 6, dailyUnits: 7, dailySales: 330, asin: ASIN_BAD }),
    ...salesRowsFor({ year: 2026, month: 7, dailyUnits: 7, dailySales: 330, asin: ASIN_BAD }),
    ...salesRowsFor({ year: 2026, month: 8, dailyUnits: 4, dailySales: 240, asin: ASIN_BAD }),
  ]
  const inventory = [
    // 备货充足
    { sku: SKU, warehouse: '美国仓', available: 320, in_transit: 500, reserved: 45 },
    { sku: SKU, warehouse: '加拿大仓', available: 80, in_transit: 0, reserved: 6 },
    // 快断货：可用库存低
    { sku: 'KT-JH-002-BK', warehouse: '美国仓', available: 12, in_transit: 0, reserved: 3 },
    // 滞销：库存大但近期无订单
    { sku: 'OD-JH-007-WH', warehouse: '美国仓', available: 600, in_transit: 0, reserved: 0 },
    // 无销量样本：库存有、订单快照里完全没出现
    { sku: 'HM-JH-011-S', warehouse: '美国仓', available: 150, in_transit: 20, reserved: 0 },
  ]
  // 产品主数据：把库存的 SKU 与销售的 ASIN 关联起来，使可售天数能基于完整销售历史计算
  const productMaster = [
    { sku: SKU, asin: ASIN, marketplace: 'US', product_name: '便携搅拌杯 黑色', category: '厨房小家电', status: '在售' },
    { sku: 'KT-JH-002-BK', asin: ASIN_BAD, marketplace: 'US', product_name: '便携搅拌杯 白色', category: '厨房小家电', status: '在售' },
    // 故意不登记 OD-JH-007-WH 与 HM-JH-011-S：用于验证"未登记产品主数据"时如实提示
  ]

  const orders = [
    { order_no: '112-0000001-0000001', sku: SKU, quantity: 2, status: '已发货', ordered_at: '2026-08-30 10:12:00' },
    { order_no: '112-0000006-0000006', sku: 'KT-JH-002-BK', quantity: 1, status: '已发货', ordered_at: '2026-08-31 11:00:00' },
    { order_no: '112-0000007-0000007', sku: 'KT-JH-002-BK', quantity: 2, status: '待发货', ordered_at: '2026-08-31 12:30:00' },
    { order_no: '112-0000002-0000002', sku: SKU, quantity: 1, status: '已发货', ordered_at: '2026-08-30 18:40:00' },
    { order_no: '112-0000003-0000003', sku: SKU, quantity: 3, status: '待发货', ordered_at: '2026-08-31 09:05:00' },
    { order_no: '112-0000004-0000004', sku: SKU, quantity: 1, status: '已退款', ordered_at: '2026-08-29 21:33:00' },
    { order_no: '112-0000005-0000005', sku: SKU, quantity: 2, status: '待发货', ordered_at: '2026-08-31 15:20:00' },
  ]

  const files = [
    { name: 'amazon_ads_daily.csv', spec: 'amazon_ads_daily', rows: ads },
    { name: 'amazon_sales_daily.csv', spec: 'amazon_sales_daily', rows: sales },
    { name: 'inventory_snapshot.csv', spec: 'inventory_snapshot', rows: inventory },
    { name: 'product_master.csv', spec: 'product_master', rows: productMaster },
    { name: 'order_snapshot.csv', spec: 'order_snapshot', rows: orders },
  ]

  for (const file of files) {
    const csv = toCsv(columnsOf(file.spec, file.rows), file.rows)
    await writeFile(path.join(OUT_DIR, file.name), csv, 'utf8')
    process.stdout.write(`${file.name}: ${file.rows.length} 行\n`)
  }

  process.stdout.write(
    `\n产品主数据：登记 ${productMaster.length} 条映射（另有 2 个 SKU 故意不登记，用于验证"未登记"提示）\n`
  )
  process.stdout.write(`\n设计好的归因答案：\n`)
  process.stdout.write('  ACoS 20% → 32.5%（+12.5 个百分点）\n')
  process.stdout.write('  花费效应 +6.0，销售额效应 +6.5，主因 = 销售额下滑\n')
  process.stdout.write(`\n产出目录：${OUT_DIR}\n`)
}

await main()

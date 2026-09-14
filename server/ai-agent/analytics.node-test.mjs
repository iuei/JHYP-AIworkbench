import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analyzeAdsPerformance,
  analyzeInventoryHealth,
  computeSalesVelocity,
  computeSalesVelocityFromSales,
  mergeAdAndBusinessSummary,
  mergeVelocitySources,
  periodDays,
  resolveVelocityWindow,
  rankAsins,
  scanAsinAnomalies,
  buildTrendSeries,
  comparePeriods,
  decomposeAcosChange,
  filterByDate,
  judgeAnomalies,
  previousPeriod,
  samePeriodLastYear,
  summarizeAds,
  summarizeSales,
} from './analytics.mjs'

const adsRow = (date, { spend, sales, clicks = 10, impressions = 1000, orders = 2 }) => ({
  stat_date: date,
  spend,
  sales,
  clicks,
  impressions,
  orders,
})

/* ---------- 汇总 ---------- */

test('summarizeAds 汇总指标并用 spend/sales 重算 ACoS', () => {
  const summary = summarizeAds([
    adsRow('2026-08-01', { spend: 100, sales: 400 }),
    adsRow('2026-08-02', { spend: 100, sales: 600 }),
  ])
  assert.equal(summary.days, 2)
  assert.equal(summary.spend, 200)
  assert.equal(summary.sales, 1000)
  assert.equal(summary.acos, 20)
  assert.equal(summary.ctr, 1)
  assert.equal(summary.cvr, 20)
  assert.equal(summary.cpc, 10)
  assert.equal(summary.aov, 250)
})

test('summarizeAds 不平均行级 ACoS（行级平均会给出误导结论）', () => {
  // 行级 ACoS 分别是 50% 与 5%，算术平均 27.5%；但真实 ACoS 是 200/1000=20%
  const summary = summarizeAds([
    { ...adsRow('2026-08-01', { spend: 100, sales: 200 }), acos: 50 },
    { ...adsRow('2026-08-02', { spend: 100, sales: 800 }), acos: 5 },
  ])
  assert.equal(summary.acos, 20)
})

test('summarizeAds 除零时返回 null 而不是 NaN/Infinity', () => {
  const summary = summarizeAds([{ stat_date: '2026-08-01', spend: 0, sales: 0, clicks: 0, impressions: 0, orders: 0 }])
  assert.equal(summary.acos, null)
  assert.equal(summary.ctr, null)
  assert.equal(summary.cvr, null)
  assert.equal(summary.cpc, null)
  assert.equal(summary.aov, null)
})

test('summarizeAds / summarizeSales 对空输入返回零值结构', () => {
  const ads = summarizeAds([])
  assert.equal(ads.days, 0)
  assert.equal(ads.spend, 0)
  assert.equal(ads.acos, null)
  const sales = summarizeSales([])
  assert.equal(sales.units, 0)
  assert.equal(sales.returnRate, null)
})

test('summarizeSales 计算退货率与客单价', () => {
  const summary = summarizeSales([{ units: 100, sales: 2000, returns: 5 }])
  assert.equal(summary.returnRate, 5)
  assert.equal(summary.unitPrice, 20)
})

/* ---------- 区间 ---------- */

test('filterByDate 按闭区间过滤并忽略空日期行', () => {
  const rows = [
    adsRow('2026-07-31', { spend: 1, sales: 1 }),
    adsRow('2026-08-01', { spend: 1, sales: 1 }),
    adsRow('2026-08-31', { spend: 1, sales: 1 }),
    adsRow('2026-09-01', { spend: 1, sales: 1 }),
    { stat_date: null, spend: 1, sales: 1 },
  ]
  const filtered = filterByDate(rows, { startDate: '2026-08-01', endDate: '2026-08-31' })
  assert.equal(filtered.length, 2)
})

test('previousPeriod 给出等长的紧邻上一期', () => {
  assert.deepEqual(previousPeriod('2026-08-01', '2026-08-31'), {
    startDate: '2026-07-01',
    endDate: '2026-07-31',
    days: 31,
  })
  assert.deepEqual(previousPeriod('2026-08-01', '2026-08-07'), {
    startDate: '2026-07-25',
    endDate: '2026-07-31',
    days: 7,
  })
  assert.equal(previousPeriod('2026-09-01', '2026-08-01'), null)
})

test('samePeriodLastYear 处理普通年份与 2 月 29 日', () => {
  assert.deepEqual(samePeriodLastYear('2026-08-01', '2026-08-31'), {
    startDate: '2025-08-01',
    endDate: '2025-08-31',
  })
  // 2024 是闰年，倒退到 2023 时 2/29 应退到 2/28
  assert.deepEqual(samePeriodLastYear('2024-02-29', '2024-03-31'), {
    startDate: '2023-02-28',
    endDate: '2023-03-31',
  })
})

/* ---------- 对比 ---------- */

test('comparePeriods 给出绝对差与百分比变化', () => {
  const { metrics, notes } = comparePeriods(
    { spend: 120, sales: 400, acos: 30 },
    { spend: 100, sales: 500, acos: 20 }
  )
  assert.equal(metrics.spend.delta, 20)
  assert.equal(metrics.spend.deltaPct, 20)
  assert.equal(metrics.sales.delta, -100)
  assert.equal(metrics.sales.deltaPct, -20)
  assert.equal(metrics.acos.delta, 10)
  assert.equal(metrics.acos.deltaPct, 50)
  assert.deepEqual(notes, [])
})

test('comparePeriods 在上期缺失或为 0 时不给百分比并说明原因', () => {
  const missing = comparePeriods({ spend: 120 }, null)
  assert.equal(missing.metrics.spend.deltaPct, null)
  assert.ok(missing.notes.some((note) => note.includes('缺少对比期数据')))

  const zeroBase = comparePeriods({ spend: 120 }, { spend: 0 })
  assert.equal(zeroBase.metrics.spend.delta, 120)
  assert.equal(zeroBase.metrics.spend.deltaPct, null, '上期为 0 时不得给出"增长 ∞%"')
})

/* ---------- ACoS 驱动分解 ---------- */

test('decomposeAcosChange 的两项效应相加恰好等于总变化', () => {
  const current = { spend: 1300, sales: 4000, acos: 32.5 }
  const previous = { spend: 1000, sales: 5000, acos: 20 }
  const result = decomposeAcosChange(current, previous)
  assert.equal(result.ok, true)
  assert.equal(result.totalDelta, 12.5)
  assert.equal(result.spendEffect, 6)
  assert.equal(result.salesEffect, 6.5)
  assert.equal(result.residual, 0, '分解必须是精确的，残差为 0')
  assert.equal(result.dominantFactor, 'sales')
  assert.match(result.dominantLabel, /销售额/)
})

test('decomposeAcosChange 识别花费驱动的情形', () => {
  const result = decomposeAcosChange(
    { spend: 2000, sales: 5000, acos: 40 },
    { spend: 1000, sales: 5000, acos: 20 }
  )
  assert.equal(result.ok, true)
  assert.equal(result.spendEffect, 20)
  assert.equal(result.salesEffect, 0)
  assert.equal(result.dominantFactor, 'spend')
})

test('decomposeAcosChange 在数据不足或销售额为 0 时明确说明无法分解', () => {
  assert.match(decomposeAcosChange(null, { spend: 1, sales: 1 }).reason, /缺少对比期/)
  assert.match(
    decomposeAcosChange({ spend: 10, sales: 0 }, { spend: 10, sales: 100 }).reason,
    /销售额为 0/
  )
  assert.match(
    decomposeAcosChange({ spend: null, sales: 100 }, { spend: 10, sales: 100 }).reason,
    /关键指标缺失/
  )
})

test('decomposeAcosChange 对 ACoS 基本持平的情形不硬找一个主因', () => {
  const result = decomposeAcosChange(
    { spend: 1000, sales: 5000, acos: 20 },
    { spend: 1000, sales: 5000, acos: 20 }
  )
  assert.equal(result.totalDelta, 0)
  assert.equal(result.dominantFactor, null)
  assert.match(result.dominantLabel, /持平/)
})

/* ---------- 异常判定 ---------- */

test('judgeAnomalies 按 PRD 阈值判定异常', () => {
  const anomalies = judgeAnomalies({ acos: 42, cvr: 5, ctr: 0.5 })
  assert.deepEqual(
    anomalies.map((item) => item.metric).sort(),
    ['acos', 'cvr']
  )
  const acosAnomaly = anomalies.find((item) => item.metric === 'acos')
  assert.equal(acosAnomaly.threshold, 35)
  assert.equal(acosAnomaly.direction, 'above')
})

test('judgeAnomalies 对空值不判异常（缺数据不等于异常）', () => {
  assert.deepEqual(judgeAnomalies({ acos: null, cvr: null, ctr: null }), [])
  assert.deepEqual(judgeAnomalies(null), [])
})

test('judgeAnomalies 在指标正常时返回空数组', () => {
  assert.deepEqual(judgeAnomalies({ acos: 25, cvr: 12, ctr: 0.6 }), [])
})

/* ---------- 趋势序列 ---------- */

test('buildTrendSeries 按日对齐广告与销售数据并计算日 ACoS', () => {
  const series = buildTrendSeries(
    [adsRow('2026-08-02', { spend: 50, sales: 200 }), adsRow('2026-08-01', { spend: 100, sales: 400 })],
    [{ stat_date: '2026-08-01', units: 20, returns: 1 }]
  )
  assert.deepEqual(
    series.map((item) => item.date),
    ['2026-08-01', '2026-08-02']
  )
  assert.equal(series[0].acos, 25)
  assert.equal(series[0].units, 20)
  assert.equal(series[0].hasSalesReport, true)
  // 缺销售报告的日期用 null 占位而不是补 0，避免图表出现"销量为 0"的假象
  assert.equal(series[1].units, null)
  assert.equal(series[1].hasSalesReport, false)
})

test('buildTrendSeries 对纯销售数据也能出序列', () => {
  const series = buildTrendSeries([], [{ stat_date: '2026-08-05', units: 3, returns: 0 }])
  assert.equal(series.length, 1)
  assert.equal(series[0].units, 3)
  assert.equal(series[0].spend, 0)
  assert.equal(series[0].acos, null)
})

/* ---------- 端到端组装 ---------- */

test('analyzeAdsPerformance 组装出周期、对比、分解、异常与趋势', () => {
  // 广告销售额（200+200=400）与业务销售额（800）刻意取不同值：
  // 早期版本两者恰好相等，掩盖了「业务销售额覆盖广告销售额」的口径缺陷。
  const adsRows = [
    adsRow('2026-07-10', { spend: 100, sales: 200 }),
    adsRow('2026-08-10', { spend: 130, sales: 200 }),
    adsRow('2026-08-11', { spend: 130, sales: 200 }),
  ]
  const salesRows = [{ stat_date: '2026-08-10', units: 40, sales: 800, returns: 2 }]
  const analysis = analyzeAdsPerformance({
    adsRows,
    salesRows,
    startDate: '2026-08-10',
    endDate: '2026-08-11',
    previousAdsRows: filterByDate(adsRows, { startDate: '2026-07-10', endDate: '2026-07-10' }),
  })

  assert.equal(analysis.period.days, 2)
  assert.equal(analysis.period.rowCount, 2, 'rowCount 单独保留用于汇总的行数')
  assert.equal(analysis.current.spend, 260)
  assert.equal(analysis.current.sales, 400, 'sales 必须是广告销售额')
  assert.equal(analysis.current.businessSales, 800, 'businessSales 必须是业务销售额')
  assert.equal(analysis.current.acos, 65, 'ACoS 按广告销售额计算：260/400')
  assert.equal(
    analysis.comparison.metrics.sales.current,
    400,
    '对比块同样只能比较广告销售额，否则环比口径与卡片不一致'
  )
  assert.ok(analysis.comparison.metrics.spend.deltaPct > 0)
  assert.equal(analysis.decomposition.ok, true)
  assert.equal(analysis.trend.length, 2)
  assert.equal(analysis.anomalies.length, 1, 'ACoS 65 超过 35 预警线，应判为异常')
  assert.equal(analysis.anomalies[0].metric, 'acos')
})

test('periodDays 给出区间自然天数，而不是参与汇总的行数', () => {
  assert.equal(periodDays('2026-08-10', '2026-08-11'), 2)
  assert.equal(periodDays('2026-08-01', '2026-08-31'), 31)
  assert.equal(periodDays('2026-02-27', '2026-03-01'), 3, '跨月按日历计算')
  assert.equal(periodDays('不是日期', '2026-03-01'), null)
})

test('mergeAdAndBusinessSummary 保留广告与业务两个销售额口径', () => {
  const merged = mergeAdAndBusinessSummary(
    { sales: 400, spend: 260, days: 5 },
    { sales: 800, units: 40 }
  )
  assert.equal(merged.sales, 400, '广告销售额不被覆盖')
  assert.equal(merged.businessSales, 800)
  assert.equal(merged.units, 40)
  assert.equal(merged.days, 5, '行数字段不受影响，异常判定仍依赖它')
  assert.equal(mergeAdAndBusinessSummary(null, { sales: 1 }), null)
  const adsOnly = mergeAdAndBusinessSummary({ sales: 10 }, null)
  assert.equal(adsOnly.sales, 10)
  assert.equal(adsOnly.businessSales, undefined, '没有业务报告时不伪造业务销售额')
})

test('analyzeAdsPerformance 在没有任何数据时给出可见的空结果而不是报错', () => {
  const analysis = analyzeAdsPerformance({
    adsRows: [],
    salesRows: [],
    startDate: '2026-08-01',
    endDate: '2026-08-31',
  })
  assert.equal(analysis.current.spend, 0)
  assert.equal(analysis.current.acos, null)
  assert.equal(analysis.trend.length, 0)
  assert.equal(analysis.decomposition.ok, false)
})

/* ---------- M-B：库存健康度 ---------- */

test('computeSalesVelocity 按订单快照算样本日均销量并标记低置信度', () => {
  const velocity = computeSalesVelocity([
    { sku: 'A', quantity: 2, ordered_at: '2026-08-01' },
    { sku: 'A', quantity: 3, ordered_at: '2026-08-10' },
    { sku: 'B', quantity: 5, ordered_at: '2026-08-01' },
  ])
  const a = velocity.get('A')
  assert.equal(a.quantity, 5)
  assert.equal(a.orderCount, 2)
  assert.equal(a.sampleDays, 10, '8/1 到 8/10 共 10 天')
  assert.equal(a.dailyAverage, 0.5)
  assert.equal(a.lowConfidence, false)

  // 样本只有 1-2 天时日均销量极不稳定，必须标记
  assert.equal(velocity.get('B').lowConfidence, true)
})

test('analyzeInventoryHealth 用日均销量算可售天数并给出补货建议', () => {
  const velocity = computeSalesVelocity([
    { sku: 'FAST', quantity: 140, ordered_at: '2026-08-01' },
    { sku: 'FAST', quantity: 0, ordered_at: '2026-08-10' },
  ])
  const health = analyzeInventoryHealth({
    inventoryRows: [
      { sku: 'FAST', warehouse: '美国仓', available: 100, in_transit: 50, reserved: 5 },
    ],
    velocity,
  })
  const item = health.items[0]
  assert.equal(item.dailySales, 14)
  assert.equal(item.daysOfSupply, 7.1)
  assert.equal(item.risk, 'stockout')
  // 目标 45 天：45*14 - 100 - 50 = 480
  assert.equal(item.suggestedReorder, 480)
  assert.equal(health.summary.stockoutCount, 1)
})

test('analyzeInventoryHealth 对积压、滞销、健康分别判定', () => {
  const velocity = computeSalesVelocity([
    { sku: 'SLOW', quantity: 0, ordered_at: '2026-08-01' },
    { sku: 'SLOW', quantity: 0, ordered_at: '2026-08-10' },
    { sku: 'OVER', quantity: 10, ordered_at: '2026-08-01' },
    { sku: 'OVER', quantity: 0, ordered_at: '2026-08-10' },
    { sku: 'OK', quantity: 50, ordered_at: '2026-08-01' },
    { sku: 'OK', quantity: 0, ordered_at: '2026-08-10' },
  ])
  const health = analyzeInventoryHealth({
    inventoryRows: [
      { sku: 'SLOW', warehouse: '美国仓', available: 200, in_transit: 0, reserved: 0 },
      { sku: 'OVER', warehouse: '美国仓', available: 1000, in_transit: 0, reserved: 0 },
      { sku: 'OK', warehouse: '美国仓', available: 300, in_transit: 0, reserved: 0 },
    ],
    velocity,
  })
  const bySku = Object.fromEntries(health.items.map((item) => [item.sku, item]))
  assert.equal(bySku.SLOW.risk, 'slow_moving')
  assert.equal(bySku.SLOW.daysOfSupply, null, '无销量时不给出可售天数')
  assert.equal(bySku.OVER.risk, 'overstock', '1000/(10/10)=1000 天，属积压')
  assert.equal(bySku.OK.risk, 'healthy', '300/(50/10)=60 天，属健康')
})

test('analyzeInventoryHealth 样本不足时不下"积压/滞销"结论（避免误导清库存）', () => {
  // 3 天样本里没有订单，不足以说明长期滞销；样例里实测踩到过"3 天样本 → 判定积压"
  const velocity = computeSalesVelocity([
    { sku: 'SHORT', quantity: 1, ordered_at: '2026-08-30' },
    { sku: 'SHORT', quantity: 2, ordered_at: '2026-08-31' },
  ])
  const health = analyzeInventoryHealth({
    inventoryRows: [{ sku: 'SHORT', warehouse: '美国仓', available: 600, in_transit: 0, reserved: 0 }],
    velocity,
  })
  const item = health.items[0]
  assert.equal(item.risk, 'insufficient_sample')
  assert.equal(item.lowConfidence, true)
  // 8/30 与 8/31 共 2 天样本、合计 3 件 → 日均 1.5 → 600 / 1.5 = 400 天
  assert.equal(item.dailySales, 1.5)
  assert.equal(item.daysOfSupply, 400, '可售天数仍如实给出，但要标记样本不足')
  assert.equal(item.suggestedReorder, 0)
  assert.equal(health.summary.insufficientSampleCount, 1)
})

test('analyzeInventoryHealth 样本不足时"断货"仍按保守告警处理', () => {
  const velocity = computeSalesVelocity([
    { sku: 'SHORT', quantity: 10, ordered_at: '2026-08-30' },
    { sku: 'SHORT', quantity: 0, ordered_at: '2026-08-31' },
  ])
  const health = analyzeInventoryHealth({
    inventoryRows: [{ sku: 'SHORT', warehouse: '美国仓', available: 10, in_transit: 0, reserved: 0 }],
    velocity,
  })
  assert.equal(health.items[0].risk, 'stockout', '库存告急时宁可误报也不漏报')
  assert.equal(health.items[0].suggestedReorder > 0, true)
})

test('analyzeInventoryHealth 缺销量样本时标记 unknown 而不是猜', () => {
  const health = analyzeInventoryHealth({
    inventoryRows: [{ sku: 'NODATA', warehouse: '美国仓', available: 500, in_transit: 0, reserved: 0 }],
    velocity: new Map(),
  })
  assert.equal(health.items[0].risk, 'unknown')
  assert.equal(health.items[0].daysOfSupply, null)
  assert.equal(health.items[0].suggestedReorder, 0)
  assert.equal(health.summary.unknownCount, 1)
})

test('analyzeInventoryHealth 按风险排序：断货在前、健康在后', () => {
  const velocity = computeSalesVelocity([
    { sku: 'FAST', quantity: 100, ordered_at: '2026-08-01' },
    { sku: 'FAST', quantity: 0, ordered_at: '2026-08-10' },
    { sku: 'OK', quantity: 50, ordered_at: '2026-08-01' },
    { sku: 'OK', quantity: 0, ordered_at: '2026-08-10' },
  ])
  const health = analyzeInventoryHealth({
    inventoryRows: [
      { sku: 'OK', warehouse: '美国仓', available: 300, in_transit: 0, reserved: 0 },
      { sku: 'FAST', warehouse: '美国仓', available: 10, in_transit: 0, reserved: 0 },
    ],
    velocity,
  })
  assert.equal(health.items[0].sku, 'FAST')
  assert.equal(health.items.at(-1).sku, 'OK')
})

/* ---------- M-B：多 ASIN 异常扫描 ---------- */

const asinSummary = (overrides = {}) => ({
  spend: 1000,
  sales: 5000,
  acos: 20,
  clicks: 1000,
  impressions: 100000,
  orders: 100,
  cvr: 10,
  ctr: 1,
  ...overrides,
})

test('scanAsinAnomalies 按严重度排序并给出信号', () => {
  const current = new Map([
    ['B0GOOD', asinSummary()],
    ['B0BAD', asinSummary({ acos: 42, cvr: 5 })],
    ['B0WORSE', asinSummary({ acos: 26, cvr: 8 })],
  ])
  const previous = new Map([
    ['B0GOOD', asinSummary()],
    ['B0BAD', asinSummary({ acos: 20, cvr: 10 })],
    // ACoS 从 10 涨到 26：涨幅 160% 触发趋势信号
    ['B0WORSE', asinSummary({ acos: 10, cvr: 10 })],
  ])
  const scan = scanAsinAnomalies({ currentByAsin: current, previousByAsin: previous })
  assert.equal(scan.items[0].asin, 'B0BAD', '同时超 ACoS 与转化率预警线，严重度最高')
  assert.equal(scan.items[0].risk, 'high')
  const worse = scan.items.find((item) => item.asin === 'B0WORSE')
  assert.ok(worse.signals.some((signal) => signal.label === 'ACoS 环比上升'))
  assert.equal(worse.risk, 'medium')
  assert.equal(scan.summary.asinCount, 3)
  assert.equal(scan.summary.highCount, 1)
})

test('scanAsinAnomalies 对没有对比期的 ASIN 也能给出阈值判定', () => {
  const scan = scanAsinAnomalies({
    currentByAsin: new Map([['B0ONLY', asinSummary({ acos: 40 })]]),
  })
  assert.equal(scan.items[0].signals.some((signal) => signal.type === 'threshold'), true)
  assert.equal(scan.items[0].comparison.acos.delta, null, '缺少对比期时不给环比差值')
  assert.equal(scan.items[0].comparison.acos.deltaPct, null)
})

test('scanAsinAnomalies 识别"花费上涨但销售额下滑"', () => {
  const scan = scanAsinAnomalies({
    currentByAsin: new Map([['B0X', asinSummary({ spend: 1500, sales: 4000 })]]),
    previousByAsin: new Map([['B0X', asinSummary({ spend: 1000, sales: 5000 })]]),
  })
  assert.ok(scan.items[0].signals.some((signal) => signal.label === '花费上涨但销售额下滑'))
})

test('rankAsins 按指标排名并可取最差或最好', () => {
  const current = new Map([
    ['B0A', asinSummary({ acos: 30 })],
    ['B0B', asinSummary({ acos: 12 })],
    ['B0C', asinSummary({ acos: null })],
  ])
  assert.deepEqual(
    rankAsins(current, 'acos').map((item) => item.asin),
    ['B0B', 'B0A'],
    '升序且过滤空值'
  )
  assert.equal(rankAsins(current, 'acos', { ascending: false })[0].asin, 'B0A')
  assert.equal(rankAsins(current, 'acos', { limit: 1 }).length, 1)
})

/* ---------- M-D：基于销售报告的销量速度 ---------- */

test('resolveVelocityWindow 以数据自身最后一天为锚点，而不是"今天"', () => {
  const rows = [
    { stat_date: '2026-08-01', units: 1 },
    { stat_date: '2026-08-31', units: 1 },
    { stat_date: '2026-07-15', units: 1 },
  ]
  const window = resolveVelocityWindow(rows, 30)
  assert.equal(window.end, '2026-08-31')
  assert.equal(window.start, '2026-08-02')
  assert.equal(window.days, 30)
  // 窗口是 8/02 ~ 8/31：8/01 已在窗口之外、7/15 更早，只有 8/31 落在窗口内
  assert.equal(window.coveredDates.size, 1)
  assert.equal(resolveVelocityWindow([], 30), null)
})

test('computeSalesVelocityFromSales 按 SKU→ASIN 映射算窗口内日均销量', () => {
  const salesRows = [
    { stat_date: '2026-08-01', asin: 'A1', marketplace: 'US', units: 10 },
    { stat_date: '2026-08-02', asin: 'A1', marketplace: 'US', units: 20 },
    { stat_date: '2026-08-01', asin: 'A2', marketplace: 'US', units: 5 },
    { stat_date: '2026-08-02', asin: 'A2', marketplace: 'US', units: 5 },
  ]
  const mapping = new Map([
    ['SKU-A', [{ asin: 'A1', marketplace: 'US' }]],
    ['SKU-B', [{ asin: 'A2', marketplace: 'US' }]],
  ])
  const velocity = computeSalesVelocityFromSales({ salesRows, mapping, windowDays: 30 })
  const a = velocity.get('SKU-A')
  assert.equal(a.units, 30)
  assert.equal(a.days, 2)
  assert.equal(a.dailyAverage, 15)
  assert.equal(a.source, 'sales_report')
  assert.equal(a.hasCoverage, true)
  assert.deepEqual(a.asins, ['A1'])
  assert.equal(velocity.get('SKU-B').dailyAverage, 5)
})

test('computeSalesVelocityFromSales 汇总一个 SKU 的多个站点/ASIN', () => {
  const salesRows = [
    { stat_date: '2026-08-01', asin: 'A1', marketplace: 'US', units: 10 },
    { stat_date: '2026-08-01', asin: 'A9', marketplace: 'UK', units: 4 },
  ]
  const mapping = new Map([
    ['SKU-A', [{ asin: 'A1', marketplace: 'US' }, { asin: 'A9', marketplace: 'UK' }]],
  ])
  const velocity = computeSalesVelocityFromSales({ salesRows, mapping, windowDays: 30 })
  assert.equal(velocity.get('SKU-A').units, 14)
  assert.deepEqual(velocity.get('SKU-A').asins.sort(), ['A1', 'A9'])
})

test('computeSalesVelocityFromSales 区分"窗口内无销量"与"报表没覆盖"', () => {
  const salesRows = [{ stat_date: '2026-08-01', asin: 'A1', marketplace: 'US', units: 10 }]
  const mapping = new Map([
    ['SKU-COVERED', [{ asin: 'A1', marketplace: 'US' }]],
    ['SKU-MISSING', [{ asin: 'A-NOT-IN-REPORT', marketplace: 'US' }]],
  ])
  const velocity = computeSalesVelocityFromSales({ salesRows, mapping, windowDays: 30 })
  assert.equal(velocity.get('SKU-COVERED').days, 1)
  assert.equal(velocity.get('SKU-COVERED').hasCoverage, true)
  // 报表里根本没有这个 ASIN：不能断言"卖不出去"，只能标记未覆盖
  assert.equal(velocity.get('SKU-MISSING').hasCoverage, false)
  assert.equal(velocity.get('SKU-MISSING').dailyAverage, null)
})

test('mergeVelocitySources 优先销售报告，缺失时回退订单快照并标注来源', () => {
  const salesVelocity = new Map([
    [
      'SKU-A',
      {
        sku: 'SKU-A',
        units: 300,
        days: 30,
        dailyAverage: 10,
        lowConfidence: false,
        hasCoverage: true,
        source: 'sales_report',
      },
    ],
    [
      'SKU-B',
      {
        sku: 'SKU-B',
        units: 0,
        days: 0,
        dailyAverage: null,
        lowConfidence: true,
        hasCoverage: false,
        source: 'sales_report',
      },
    ],
  ])
  const orderVelocity = new Map([
    ['SKU-B', { sku: 'SKU-B', units: 3, days: 2, dailyAverage: 1.5, lowConfidence: true }],
    ['SKU-C', { sku: 'SKU-C', units: 5, days: 3, dailyAverage: 1.67, lowConfidence: true }],
  ])
  const merged = mergeVelocitySources({ salesVelocity, orderVelocity })
  assert.equal(merged.get('SKU-A').source, 'sales_report')
  assert.equal(merged.get('SKU-A').lowConfidence, false)
  assert.equal(merged.get('SKU-B').source, 'order_snapshot', '销售报告未覆盖时回退')
  assert.equal(merged.get('SKU-B').dailyAverage, 1.5)
  assert.equal(merged.get('SKU-C').source, 'order_snapshot')
})

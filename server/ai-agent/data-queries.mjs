/**
 * 业务数据查询与工具载荷组装。
 *
 * 分层：本文件负责「查数据 + 算分析 + 组装表格/图表」，tools.mjs 只负责注册、参数校验与执行前二次校验。
 *
 * 两条硬规则：
 * 1. 所有数字都来自 SQL 与 analytics.mjs 的确定性计算，模型只做表达；
 * 2. 数据集没有数据时明确告知"暂无数据，请先导入"，绝不返回空结果让模型去猜。
 */
import { query } from '../db.mjs'
import {
  DEFAULT_VELOCITY_WINDOW_DAYS,
  INVENTORY_THRESHOLDS,
  analyzeAdsPerformance,
  comparePeriods,
  computeSalesVelocityFromSales,
  mergeVelocitySources,
  resolveVelocityWindow,
  analyzeInventoryHealth,
  computeSalesVelocity,
  filterByDate,
  mergeAdAndBusinessSummary,
  periodDays,
  previousPeriod,
  rankAsins,
  samePeriodLastYear,
  scanAsinAnomalies,
  summarizeAds,
  summarizeSales,
} from './analytics.mjs'
import { datasetFreshnessOf } from './datasets.mjs'

export const MAX_MODEL_ROWS = 120
export const MAX_TABLE_ROWS = 30
/**
 * 表格块在"给人看"的路径上允许的行数上限（2026-09-15）。
 *
 * 与 `MAX_TABLE_ROWS` 分开的理由：`MAX_TABLE_ROWS = 30` 是**给模型看**的预算，
 * 页面「一键分析」的明细表却需要完整清单（分页展示 + 导出），
 * 两者用同一个常量时，清单一旦超过 30 个 ASIN，页面就只能看到前 30 行且没有任何补救入口。
 * 取值与单清单上限一致，避免再多一个需要同步的数字。
 */
export const MAX_DETAIL_ROWS = 5000

const round = (value, digits = 2) => {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null
  const factor = 10 ** digits
  return Math.round(Number(value) * factor) / factor
}

/* ---------- 数据查询 ---------- */

export async function queryAdsDaily({ asin, marketplace, startDate, endDate }) {
  const { rows } = await query(
    `SELECT stat_date, asin, marketplace, campaign, impressions, clicks, spend, orders, sales, acos
       FROM amazon_ads_daily
      WHERE asin = $1 AND marketplace = $2 AND stat_date BETWEEN $3 AND $4
      ORDER BY stat_date ASC, campaign ASC`,
    [asin, marketplace, startDate, endDate]
  )
  return rows.map((row) => ({
    ...row,
    stat_date: dateOnly(row.stat_date),
    spend: Number(row.spend),
    sales: Number(row.sales),
    acos: row.acos === null ? null : Number(row.acos),
  }))
}

export async function querySalesDaily({ asin, marketplace, startDate, endDate }) {
  const { rows } = await query(
    `SELECT stat_date, asin, marketplace, units, sales, returns
       FROM amazon_sales_daily
      WHERE asin = $1 AND marketplace = $2 AND stat_date BETWEEN $3 AND $4
      ORDER BY stat_date ASC`,
    [asin, marketplace, startDate, endDate]
  )
  return rows.map((row) => ({
    ...row,
    stat_date: dateOnly(row.stat_date),
    sales: Number(row.sales),
  }))
}

/** 按站点+区间取全部 ASIN 的广告数据（用于异常扫描与全站聚合）。 */
export async function queryAdsDailyByMarketplace({ marketplace, startDate, endDate, limit = 20000 }) {
  const { rows } = await query(
    // 取"最近"的 N 行。
    // `ORDER BY stat_date ASC LIMIT N` 在触顶时丢掉的是**最新**日期 —— 分析会停留在旧数据上，
    // 而异常扫描与全站聚合正是靠这批数据下结论。改成 DESC 取最近窗口，返回前 reverse 回升序。
    `SELECT stat_date, asin, marketplace, campaign, impressions, clicks, spend, orders, sales, acos
       FROM amazon_ads_daily
      WHERE marketplace = $1 AND stat_date BETWEEN $2 AND $3
      ORDER BY stat_date DESC
      LIMIT $4`,
    [marketplace, startDate, endDate, limit]
  )
  return rows.reverse().map((row) => ({
    ...row,
    stat_date: dateOnly(row.stat_date),
    spend: Number(row.spend),
    sales: Number(row.sales),
    acos: row.acos === null ? null : Number(row.acos),
  }))
}

/** 按站点+区间取全部 ASIN 的销售数据。 */
export async function querySalesDailyByMarketplace({ marketplace, startDate, endDate, limit = 20000 }) {
  const { rows } = await query(
    // 同 queryAdsDailyByMarketplace：触顶时优先保最近的数据
    `SELECT stat_date, asin, marketplace, units, sales, returns
       FROM amazon_sales_daily
      WHERE marketplace = $1 AND stat_date BETWEEN $2 AND $3
      ORDER BY stat_date DESC
      LIMIT $4`,
    [marketplace, startDate, endDate, limit]
  )
  return rows.reverse().map((row) => ({ ...row, stat_date: dateOnly(row.stat_date), sales: Number(row.sales) }))
}

/** 全部库存行（库存风险分析用）。 */
export async function queryInventoryAll({ limit = 5000 } = {}) {
  const { rows } = await query(
    `SELECT sku, warehouse, available, in_transit, reserved, snapshot_at
       FROM inventory_snapshot
      ORDER BY sku ASC, warehouse ASC
      LIMIT $1`,
    [limit]
  )
  return rows
}

/** 产品主数据映射：SKU → 渠道列表（asin + marketplace）。 */
export async function queryProductMaster({ limit = 20000 } = {}) {
  const { rows } = await query(
    `SELECT sku, asin, marketplace, product_name, category, status
       FROM product_master
      ORDER BY sku ASC
      LIMIT $1`,
    [limit]
  )
  return rows
}

/**
 * 把产品主数据行转成 SKU → 渠道列表 的映射。
 * 一个 SKU 可能对应多个站点/ASIN，因此值是数组。
 */
export function buildSkuChannelMap(productRows) {
  const map = new Map()
  for (const row of Array.isArray(productRows) ? productRows : []) {
    if (!row?.sku || !row?.asin) continue
    const list = map.get(row.sku) ?? []
    list.push({ asin: row.asin, marketplace: row.marketplace ?? 'US' })
    map.set(row.sku, list)
  }
  return map
}

/** 按 ASIN 集合取销售报告行（用于算真实销量速度）。 */
export async function querySalesForVelocity({ windowStart, windowEnd, limit = 50000 } = {}) {
  const { rows } = await query(
    // 同 queryAdsDailyByMarketplace：触顶时优先保最近的数据
    `SELECT stat_date, asin, marketplace, units
       FROM amazon_sales_daily
      WHERE ($1::date IS NULL OR stat_date >= $1)
        AND ($2::date IS NULL OR stat_date <= $2)
      ORDER BY stat_date DESC
      LIMIT $3`,
    [windowStart ?? null, windowEnd ?? null, limit]
  )
  return rows.reverse().map((row) => ({ ...row, stat_date: dateOnly(row.stat_date), units: Number(row.units) }))
}

/** 销售报告里最新的日期（用于确定销量统计窗口的锚点）。 */
export async function queryLatestSalesDate() {
  const { rows } = await query('SELECT MAX(stat_date) AS latest FROM amazon_sales_daily')
  return dateOnly(rows[0]?.latest) ?? null
}

/** 近期订单（用于估算样本日均销量）。 */
export async function queryRecentOrders({ limit = 5000 } = {}) {
  const { rows } = await query(
    `SELECT order_no, sku, quantity, status, ordered_at
       FROM order_snapshot
      ORDER BY ordered_at DESC NULLS LAST
      LIMIT $1`,
    [limit]
  )
  return rows
}

export async function queryInventory({ sku }) {
  const { rows } = await query(
    `SELECT sku, warehouse, available, in_transit, reserved, snapshot_at, imported_at
       FROM inventory_snapshot
      WHERE sku = $1
      ORDER BY warehouse ASC`,
    [sku]
  )
  return rows
}

export async function queryOrders({ sku, status = null, limit = 20 }) {
  const { rows } = await query(
    `SELECT order_no, sku, quantity, status, ordered_at, imported_at
       FROM order_snapshot
      WHERE sku = $1 AND ($2::text IS NULL OR status = $2)
      ORDER BY ordered_at DESC NULLS LAST
      LIMIT $3`,
    [sku, status, limit]
  )
  return rows
}

function dateOnly(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

/* ---------- 结构化块 ---------- */

export function buildTableBlock({
  title,
  columns,
  rows,
  note = null,
  dataset = null,
  /**
   * 可选的分组表头（`[{ label, span }]`，只描述除首列以外的列）。
   * 用途：一张表里并列两套同构字段时（「按日对比」里本品与竞品各 7 个指标），
   * 把归属提到第一行，而不是在每列标签里重复。
   * 不传时为 `null` —— 渲染层按"没有分组"处理，行为与改动前完全一致。
   */
  groups = null,
  maxRows = MAX_TABLE_ROWS,
  /**
   * 原始总行数。默认取 `rows.length`；当调用方**在构造块之前已经截断过行**时
   * 必须显式传入，否则界面会显示「共 100 条、未截断」，把真实总量（例如 500 条）说小。
   */
  totalRows = null,
}) {
  const visible = rows.slice(0, maxRows)
  const total = Number.isInteger(totalRows) ? totalRows : rows.length
  return {
    kind: 'table',
    title,
    dataset,
    columns,
    groups,
    rows: visible,
    totalRows: total,
    truncated: total > visible.length,
    note,
  }
}

export function buildMetricsBlock({ title, items, note = null }) {
  return { kind: 'metrics', title, items, note }
}

export function buildChartBlock({ title, chartType, xKey, series, data, note = null }) {
  return { kind: 'chart', title, chartType, xKey, series, data, note }
}

const NUMBER_FORMAT = { minimumFractionDigits: 0, maximumFractionDigits: 2 }

/** 把分析结果转成对比指标卡片（环比/同比一眼可见）。 */
export function buildComparisonBlock(comparison, { title, label }) {
  const LABELS = {
    spend: '广告花费',
    sales: '广告销售额',
    acos: 'ACoS',
    clicks: '点击',
    impressions: '曝光',
    orders: '订单',
    cvr: '转化率',
    ctr: '点击率',
    cpc: 'CPC',
    aov: '客单价',
    units: '销量',
  }
  const items = Object.entries(comparison.metrics)
    .filter(([key]) => LABELS[key])
    .map(([key, value]) => ({
      key,
      label: LABELS[key],
      current: value.current,
      previous: value.previous,
      delta: value.delta,
      deltaPct: value.deltaPct,
    }))
  return buildMetricsBlock({
    title: title ?? `${label}对比`,
    items,
    note: comparison.notes.length > 0 ? comparison.notes.join('；') : null,
  })
}

/* ---------- 工具载荷：Amazon 广告与销售表现 ---------- */

/**
 * 合并广告与销售数据到按日一行，供表格与趋势图共用。
 * 两个来源的日期不一定完全对齐，缺失一侧时用 null 占位而不是补 0。
 */
export function mergeDailyRows(adsRows, salesRows) {
  const byDate = new Map()
  for (const row of adsRows) {
    byDate.set(row.stat_date, {
      date: row.stat_date,
      impressions: row.impressions,
      clicks: row.clicks,
      spend: round(row.spend),
      orders: row.orders,
      sales: round(row.sales),
      acos: row.acos ?? round(row.sales > 0 ? (row.spend / row.sales) * 100 : null),
      units: null,
      returns: null,
    })
  }
  for (const row of salesRows) {
    const entry = byDate.get(row.stat_date) ?? {
      date: row.stat_date,
      impressions: null,
      clicks: null,
      spend: null,
      orders: null,
      sales: null,
      acos: null,
    }
    entry.units = row.units
    entry.returns = row.returns
    entry.businessSales = round(row.sales)
    byDate.set(row.stat_date, entry)
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

export async function amazonPerformancePayload({ asin, marketplace = 'US', startDate, endDate, compareWith = 'previous_period', detailLimit = MAX_TABLE_ROWS }) {
  const [adsRows, salesRows] = await Promise.all([
    queryAdsDaily({ asin, marketplace, startDate, endDate }),
    querySalesDaily({ asin, marketplace, startDate, endDate }),
  ])

  const [adsFreshness, salesFreshness] = await Promise.all([
    datasetFreshnessOf('amazon_ads_daily'),
    datasetFreshnessOf('amazon_sales_daily'),
  ])
  const dataFreshness = combineFreshness([adsFreshness, salesFreshness])

  if (adsRows.length === 0 && salesRows.length === 0) {
    const hints = []
    if (adsFreshness.rows === 0) hints.push('Amazon 广告日报')
    if (salesFreshness.rows === 0) hints.push('Amazon 业务报告')
    return {
      ok: true,
      empty: true,
      rows: [],
      rowCount: 0,
      summary:
        hints.length > 0
          ? `数据集尚未导入：${hints.join('、')}。当前没有 ${asin}（${marketplace}）在 ${startDate} 至 ${endDate} 的数据，请先到「AI 助手 → 数据源与导入」上传报表。`
          : `没有查到 ${asin}（${marketplace}）在 ${startDate} 至 ${endDate} 的数据。该区间内可能没有投放或没有销售，请确认 ASIN、站点与日期区间是否正确。`,
      citations: [
        datasetCitation(adsFreshness),
        datasetCitation(salesFreshness),
      ],
      dataFreshness,
      blocks: [],
    }
  }

  // 对比期数据
  let comparisonRows = null
  let comparisonLabel = null
  let comparisonPeriod = null
  if (compareWith === 'previous_period') {
    comparisonPeriod = previousPeriod(startDate, endDate)
    comparisonLabel = '环比（上一等长区间）'
  } else if (compareWith === 'last_year') {
    comparisonPeriod = samePeriodLastYear(startDate, endDate)
    comparisonLabel = '同比（去年同期）'
  }

  if (comparisonPeriod) {
    const [previousAds, previousSales] = await Promise.all([
      queryAdsDaily({
        asin,
        marketplace,
        startDate: comparisonPeriod.startDate,
        endDate: comparisonPeriod.endDate,
      }),
      querySalesDaily({
        asin,
        marketplace,
        startDate: comparisonPeriod.startDate,
        endDate: comparisonPeriod.endDate,
      }),
    ])
    if (previousAds.length > 0 || previousSales.length > 0) {
      comparisonRows = { adsRows: previousAds, salesRows: previousSales }
    }
  }

  const analysis = analyzeAdsPerformance({
    adsRows,
    salesRows,
    startDate,
    endDate,
    previousAdsRows: comparisonRows?.adsRows ?? null,
    previousSalesRows: comparisonRows?.salesRows ?? null,
  })

  const dailyRows = mergeDailyRows(adsRows, salesRows)
  const blocks = [
    buildMetricsBlock({
      title: '期间汇总',
      items: summaryItems(analysis.current),
      note: `统计区间 ${startDate} ~ ${endDate}（${analysis.period.days} 天）`,
    }),
    buildTableBlock({
      title: '按日明细',
      dataset: 'amazon_ads_daily',
      columns: [
        { key: 'date', label: '日期' },
        { key: 'impressions', label: '曝光', align: 'right' },
        { key: 'clicks', label: '点击', align: 'right' },
        { key: 'spend', label: '花费', align: 'right' },
        { key: 'orders', label: '广告订单', align: 'right' },
        { key: 'sales', label: '广告销售额', align: 'right' },
        { key: 'acos', label: 'ACoS(%)', align: 'right' },
        { key: 'units', label: '销量', align: 'right' },
      ],
      rows: dailyRows,
      maxRows: detailLimit === null ? MAX_DETAIL_ROWS : detailLimit,
      totalRows: dailyRows.length,
      note:
        dailyRows.some((row) => row.units === null)
          ? '销量列缺失的日期说明业务报告未覆盖该日期，不代表销量为 0。'
          : null,
    }),
    buildChartBlock({
      title: 'ACoS 与花费趋势',
      chartType: 'line',
      xKey: 'date',
      series: [
        { key: 'acos', label: 'ACoS(%)', kind: 'line' },
        { key: 'spend', label: '花费', kind: 'line' },
        { key: 'sales', label: '广告销售额', kind: 'line' },
      ],
      data: analysis.trend,
      note: '数据来自人工导出的报表，非实时数据。',
    }),
  ]

  if (comparisonRows && comparisonLabel) {
    blocks.splice(1, 0, buildComparisonBlock(analysis.comparison, { title: comparisonLabel }))
  }

  return {
    ok: true,
    empty: false,
    rows: dailyRows.slice(0, MAX_MODEL_ROWS),
    rowCount: dailyRows.length,
    truncated: dailyRows.length > MAX_MODEL_ROWS,
    summary: buildAmazonSummary({ asin, marketplace, analysis, comparisonLabel, dataFreshness }),
    analysis,
    citations: [datasetCitation(adsFreshness), datasetCitation(salesFreshness)],
    dataFreshness,
    blocks,
  }
}

function summaryItems(summary) {
  return [
    { key: 'spend', label: '广告花费', value: summary.spend, unit: '' },
    { key: 'sales', label: '广告销售额', value: summary.sales, unit: '' },
    { key: 'acos', label: 'ACoS', value: summary.acos, unit: '%' },
    { key: 'clicks', label: '点击', value: summary.clicks, unit: '' },
    { key: 'ctr', label: '点击率', value: summary.ctr, unit: '%' },
    { key: 'cvr', label: '转化率', value: summary.cvr, unit: '%' },
    { key: 'cpc', label: 'CPC', value: summary.cpc, unit: '' },
    { key: 'units', label: '总销量', value: summary.units, unit: '' },
  ]
}

/** 生成喂给模型的"事实清单"：所有数字都来自服务端计算结果。 */
function buildAmazonSummary({ asin, marketplace, analysis, comparisonLabel, dataFreshness }) {
  const current = analysis.current
  const lines = [
    `ASIN ${asin} · 站点 ${marketplace} · 区间 ${analysis.period.startDate} ~ ${analysis.period.endDate}（${analysis.period.days} 天）`,
    `期间汇总：广告花费 ${current.spend}，广告销售额 ${current.sales}，ACoS ${current.acos ?? '无'}%，点击 ${current.clicks}，曝光 ${current.impressions}，广告订单 ${current.orders}，点击率 ${current.ctr ?? '无'}%，转化率 ${current.cvr ?? '无'}%，CPC ${current.cpc ?? '无'}`,
  ]
  if (current.units !== null && current.units !== undefined) {
    lines.push(
      `业务报告：总销量 ${current.units}，销售额 ${current.sales_total ?? current.businessSales ?? '见对比块'}，退货 ${current.returns ?? 0}，退货率 ${current.returnRate ?? '无'}%`
    )
  }

  if (comparisonLabel && analysis.comparison.notes.length === 0) {
    const m = analysis.comparison.metrics
    const change = (key, label) => {
      const item = m[key]
      if (!item || item.delta === null) return null
      const pct = item.deltaPct === null ? '上期为 0，无法计算百分比' : `${item.deltaPct > 0 ? '+' : ''}${item.deltaPct}%`
      return `${label} ${item.previous} → ${item.current}（${item.delta > 0 ? '+' : ''}${item.delta}，${pct}）`
    }
    const changes = [
      change('acos', 'ACoS'),
      change('spend', '花费'),
      change('sales', '广告销售额'),
      change('cvr', '转化率'),
      change('ctr', '点击率'),
    ].filter(Boolean)
    lines.push(`${comparisonLabel}：${changes.join('；')}`)
  } else if (analysis.comparison.notes.length > 0) {
    lines.push(`对比：${analysis.comparison.notes.join('；')}`)
  }

  const decomposition = analysis.decomposition
  if (decomposition.ok) {
    lines.push(
      `ACoS 变化驱动分解（服务端精确计算，两部分相加等于总变化 ${decomposition.totalDelta} 个百分点）：花费效应 ${decomposition.spendEffect} 个百分点；销售额效应 ${decomposition.salesEffect} 个百分点。主因：${decomposition.dominantLabel}`
    )
  } else {
    lines.push(`ACoS 变化分解：${decomposition.reason}`)
  }

  if (analysis.anomalies.length > 0) {
    lines.push(
      `触发预警线：${analysis.anomalies
        .map((item) => `${item.label} ${item.value}（${item.direction === 'above' ? '高于' : '低于'}阈值 ${item.threshold}）`)
        .join('；')}`
    )
  } else {
    lines.push('未触发任一预警线（ACoS>35%、转化率<7%、点击率<0.25%）')
  }

  lines.push(`数据时效：${freshnessSentence(dataFreshness)}`)
  lines.push(
    '以上数字均由系统计算得出，回答时必须直接引用这些数字，不得自行估算或改动；若某项显示"无"，说明缺少对应数据，请如实说明缺少什么，不要推测。回答末尾必须声明数据来源与数据截至时间。'
  )
  return lines.join('\n')
}

/* ---------- 工具载荷：库存与订单 ---------- */

export async function inventoryOrdersPayload({ sku, includeOrders = true, orderStatus = null, limit = 20 }) {
  const [inventoryRows, orderRows, inventoryFreshness, orderFreshness] = await Promise.all([
    queryInventory({ sku }),
    includeOrders ? queryOrders({ sku, status: orderStatus, limit }) : Promise.resolve([]),
    datasetFreshnessOf('inventory_snapshot'),
    datasetFreshnessOf('order_snapshot'),
  ])
  const dataFreshness = combineFreshness(
    includeOrders ? [inventoryFreshness, orderFreshness] : [inventoryFreshness]
  )

  if (inventoryRows.length === 0 && orderRows.length === 0) {
    const hints = []
    if (inventoryFreshness.rows === 0) hints.push('库存快照')
    if (includeOrders && orderFreshness.rows === 0) hints.push('订单快照')
    return {
      ok: true,
      empty: true,
      rows: [],
      rowCount: 0,
      summary:
        hints.length > 0
          ? `数据集尚未导入：${hints.join('、')}。当前没有 ${sku} 的库存与订单数据，请先到「AI 助手 → 数据源与导入」上传报表。`
          : `没有查到 ${sku} 的库存与订单记录，请确认 SKU 是否正确。`,
      citations: [
        datasetCitation(inventoryFreshness),
        ...(includeOrders ? [datasetCitation(orderFreshness)] : []),
      ],
      dataFreshness,
      blocks: [],
    }
  }

  const totalAvailable = inventoryRows.reduce((total, row) => total + Number(row.available ?? 0), 0)
  const totalInTransit = inventoryRows.reduce((total, row) => total + Number(row.in_transit ?? 0), 0)
  const totalReserved = inventoryRows.reduce((total, row) => total + Number(row.reserved ?? 0), 0)

  const blocks = [
    buildMetricsBlock({
      title: '库存汇总',
      items: [
        { key: 'available', label: '可用库存', value: totalAvailable, unit: '' },
        { key: 'in_transit', label: '在途', value: totalInTransit, unit: '' },
        { key: 'reserved', label: '占用', value: totalReserved, unit: '' },
        { key: 'warehouses', label: '仓库数', value: inventoryRows.length, unit: '' },
      ],
      note: `SKU ${sku}`,
    }),
    buildTableBlock({
      title: '分仓库存',
      dataset: 'inventory_snapshot',
      columns: [
        { key: 'warehouse', label: '仓库' },
        { key: 'available', label: '可用库存', align: 'right' },
        { key: 'in_transit', label: '在途', align: 'right' },
        { key: 'reserved', label: '占用', align: 'right' },
      ],
      rows: inventoryRows,
    }),
  ]

  if (includeOrders && orderRows.length > 0) {
    blocks.push(
      buildTableBlock({
        title: '最近订单',
        dataset: 'order_snapshot',
        columns: [
          { key: 'order_no', label: '订单号' },
          { key: 'quantity', label: '数量', align: 'right' },
          { key: 'status', label: '状态' },
          { key: 'ordered_at', label: '下单时间' },
        ],
        rows: orderRows.map((row) => ({ ...row, ordered_at: formatTimestamp(row.ordered_at) })),
        note: orderStatus ? `已按状态筛选：${orderStatus}` : null,
      })
    )
  }

  const summaryLines = [
    `SKU ${sku}：可用库存 ${totalAvailable}${inventoryRows.length ? `（分布在 ${inventoryRows.length} 个仓库）` : ''}，在途 ${totalInTransit}，占用 ${totalReserved}。`,
  ]
  if (includeOrders) {
    summaryLines.push(
      orderRows.length > 0
        ? `订单：返回最近 ${orderRows.length} 条${orderStatus ? `（状态 = ${orderStatus}）` : ''}，示例：${orderRows
            .slice(0, 3)
            .map((row) => `${row.order_no}（${row.quantity} 件，${row.status || '状态未知'}）`)
            .join('、')}`
        : `订单：没有查到${orderStatus ? `状态为「${orderStatus}」的` : ''}订单记录。`
    )
  }
  summaryLines.push(`数据时效：${freshnessSentence(dataFreshness)}`)
  summaryLines.push('以上数字由系统计算得出，回答时必须直接引用，不得自行估算或改动。')

  const modelRows = [
    ...inventoryRows.map((row) => ({
      type: 'inventory',
      warehouse: row.warehouse,
      available: row.available,
      in_transit: row.in_transit,
      reserved: row.reserved,
    })),
    ...orderRows.map((row) => ({
      type: 'order',
      order_no: row.order_no,
      quantity: row.quantity,
      status: row.status,
      ordered_at: formatTimestamp(row.ordered_at),
    })),
  ]

  return {
    ok: true,
    empty: false,
    rows: modelRows.slice(0, MAX_MODEL_ROWS),
    rowCount: modelRows.length,
    summary: summaryLines.join('\n'),
    citations: [
      datasetCitation(inventoryFreshness),
      ...(includeOrders ? [datasetCitation(orderFreshness)] : []),
    ],
    dataFreshness,
    blocks,
  }
}

/**
 * TIMESTAMPTZ → 'YYYY-MM-DD HH:mm:ss'（**本地时区**）。
 *
 * 不能用 `toISOString()`：TIMESTAMPTZ 是绝对时刻，按 UTC 输出会让东八区用户看到
 * 早 8 小时的时间（09:30 下单显示成 01:30），而且与界面其它本地时间口径不一致。
 */
function formatTimestamp(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 19)
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/* ---------- 时效与引用 ---------- */

/**
 * 合并多个数据集的时效：数据只有和"最旧的那个来源"一样新。
 * 取最旧而非最新，避免给人"数据很新"的错觉。
 */
export function combineFreshness(items) {
  const list = items.filter(Boolean)
  const oldest = list.reduce((acc, item) => {
    if (!item.importedAt) return acc ?? item
    if (!acc?.importedAt) return item
    return new Date(item.importedAt) < new Date(acc.importedAt) ? item : acc
  }, null)
  return {
    dataset: list.map((item) => item.dataset).join('+'),
    label: list.map((item) => item.label).join('、'),
    importedAt: oldest?.importedAt ?? null,
    periodEnd: list.reduce(
      (acc, item) => (item.periodEnd && (!acc || item.periodEnd > acc) ? item.periodEnd : acc),
      null
    ),
    datasets: list.map((item) => ({
      dataset: item.dataset,
      label: item.label,
      importedAt: item.importedAt ?? null,
      rows: item.rows ?? 0,
    })),
    note: buildFreshnessNote(list, oldest),
  }
}

/** 时效文案：导入时间与数据覆盖区间都写清楚，避免"导入时间很新但数据其实到上个月"的误读。 */
function buildFreshnessNote(list, oldest) {
  const periodEnd = list
    .map((item) => item.periodEnd)
    .filter(Boolean)
    .sort()
    .at(-1)
  const parts = ['数据来自人工导出的报表，为准实时数据，非实时数据。']
  if (periodEnd) parts.push(`报表数据覆盖至 ${periodEnd}。`)
  if (oldest?.importedAt) parts.push(`最旧来源导入于 ${String(oldest.importedAt).slice(0, 10)}。`)
  return parts.join('')
}

/** 统计既没有销售报告口径、也没有订单快照口径的 SKU 数（通常是产品主数据没登记）。 */
function skinnerUnmapped(skuChannels, items) {
  return items.filter((item) => !skuChannels.has(item.sku) && item.dailySales === null).length
}

/** 统一的时效句子：来源 + 数据覆盖至 + 导入时间 + 非实时声明。 */
export function freshnessSentence(freshness) {
  const parts = [`来源 ${freshness?.label ?? '未知'}`]
  if (freshness?.periodEnd) parts.push(`数据覆盖至 ${String(freshness.periodEnd).slice(0, 10)}`)
  parts.push(
    `导入于 ${freshness?.importedAt ? String(freshness.importedAt).slice(0, 10) : '未知'}`
  )
  parts.push('人工导出后导入，非实时数据')
  return parts.join('，')
}

/** 数据集引用（出现在引用来源里，与文档引用视觉区分）。 */
export function datasetCitation(freshness) {
  return {
    kind: 'dataset',
    dataset: freshness?.dataset ?? 'unknown',
    title: freshness?.label ?? freshness?.dataset ?? '数据集',
    importedAt: freshness?.importedAt ?? null,
    periodEnd: freshness?.periodEnd ?? null,
    rowCount: freshness?.rows ?? 0,
    updatedAt: freshness?.importedAt ?? null,
    sourceType: 'dataset',
  }
}

export { filterByDate, summarizeAds, summarizeSales, previousPeriod, samePeriodLastYear }


/* ---------- 工具载荷：全站表现（不指定 ASIN） ---------- */

export async function marketplacePerformancePayload({ marketplace = 'US', startDate, endDate, compareWith = 'previous_period' }) {
  const [adsRows, salesRows] = await Promise.all([
    queryAdsDailyByMarketplace({ marketplace, startDate, endDate }),
    querySalesDailyByMarketplace({ marketplace, startDate, endDate }),
  ])

  const [adsFreshness, salesFreshness] = await Promise.all([
    datasetFreshnessOf('amazon_ads_daily'),
    datasetFreshnessOf('amazon_sales_daily'),
  ])
  const dataFreshness = combineFreshness([adsFreshness, salesFreshness])

  if (adsRows.length === 0 && salesRows.length === 0) {
    return {
      ok: true,
      empty: true,
      rows: [],
      rowCount: 0,
      summary: `没有查到站点 ${marketplace} 在 ${startDate} 至 ${endDate} 的广告或销售数据。请确认站点与日期区间，或先到「AI 助手 → 数据源与导入」上传报表。`,
      citations: [datasetCitation(adsFreshness), datasetCitation(salesFreshness)],
      dataFreshness,
      blocks: [],
    }
  }

  const current = summarizeAds(adsRows)
  const currentSales = summarizeSales(salesRows)

  // 按 ASIN 汇总并排名，回答"哪个 ASIN 最差"这类问题
  const asinGroups = new Map()
  for (const row of adsRows) {
    const list = asinGroups.get(row.asin) ?? []
    list.push(row)
    asinGroups.set(row.asin, list)
  }
  const perAsin = new Map()
  for (const [asin, rows] of asinGroups) perAsin.set(asin, summarizeAds(rows))

  const comparisonPeriod = compareWith === 'previous_period' ? previousPeriod(startDate, endDate) : null
  let previous = null
  if (comparisonPeriod) {
    const previousAds = await queryAdsDailyByMarketplace({
      marketplace,
      startDate: comparisonPeriod.startDate,
      endDate: comparisonPeriod.endDate,
    })
    if (previousAds.length > 0) previous = summarizeAds(previousAds)
  }

  const worstByAcos = rankAsins(perAsin, 'acos', { ascending: false, limit: 10 })
  const bestByAcos = rankAsins(perAsin, 'acos', { ascending: true, limit: 10 })
  const analysis = {
    period: { startDate, endDate, days: periodDays(startDate, endDate), rowCount: current.days },
    current: mergeAdAndBusinessSummary(current, currentSales),
    comparison: comparePeriods(mergeAdAndBusinessSummary(current, currentSales), previous),
    perAsinCount: perAsin.size,
    worstByAcos,
    bestByAcos,
  }

  const rows = [...perAsin.entries()]
    .map(([asin, summary]) => ({ asin, ...summary }))
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))

  const blocks = [
    buildMetricsBlock({
      title: `${marketplace} 站整体汇总`,
      items: summaryItems(mergeAdAndBusinessSummary(current, currentSales)),
      note: `统计区间 ${startDate} ~ ${endDate}（${periodDays(startDate, endDate)} 天），覆盖 ${perAsin.size} 个 ASIN`,
    }),
  ]
  if (previous) {
    blocks.push(buildComparisonBlock(analysis.comparison, { title: '环比（上一等长区间）' }))
  }
  blocks.push(
    buildTableBlock({
      title: '按 ASIN 汇总（按花费降序）',
      dataset: 'amazon_ads_daily',
      columns: [
        { key: 'asin', label: 'ASIN' },
        { key: 'spend', label: '花费', align: 'right' },
        { key: 'sales', label: '广告销售额', align: 'right' },
        { key: 'acos', label: 'ACoS(%)', align: 'right' },
        { key: 'orders', label: '订单', align: 'right' },
        { key: 'cvr', label: '转化率(%)', align: 'right' },
        { key: 'ctr', label: '点击率(%)', align: 'right' },
      ],
      rows,
    }),
    buildChartBlock({
      title: '各 ASIN 花费（Top 15）',
      chartType: 'bar',
      xKey: 'asin',
      series: [{ key: 'spend', label: '花费', kind: 'bar' }],
      data: rows.slice(0, 15),
      note: '用于快速定位花费集中的 ASIN。',
    })
  )

  const summaryLines = [
    `站点 ${marketplace} · 区间 ${startDate} ~ ${endDate}（${periodDays(startDate, endDate)} 天）· 覆盖 ${perAsin.size} 个 ASIN`,
    `整体：广告花费 ${current.spend}，广告销售额 ${current.sales}，ACoS ${current.acos ?? '无'}%，点击 ${current.clicks}，曝光 ${current.impressions}，订单 ${current.orders}，转化率 ${current.cvr ?? '无'}%，点击率 ${current.ctr ?? '无'}%`,
  ]
  if (previous) {
    const m = analysis.comparison.metrics
    const change = (key, label) => {
      const item = m[key]
      if (!item || item.delta === null) return null
      const pct = item.deltaPct === null ? '上期为 0' : `${item.deltaPct > 0 ? '+' : ''}${item.deltaPct}%`
      return `${label} ${item.previous} → ${item.current}（${pct}）`
    }
    summaryLines.push(
      `环比：${[change('acos', 'ACoS'), change('spend', '花费'), change('sales', '广告销售额'), change('cvr', '转化率')].filter(Boolean).join('；')}`
    )
  }
  if (worstByAcos.length > 0) {
    summaryLines.push(
      `ACoS 最高的 ASIN：${worstByAcos.slice(0, 5).map((item) => `${item.asin}(${item.value}%)`).join('、')}`
    )
  }
  if (bestByAcos.length > 0) {
    summaryLines.push(
      `ACoS 最低的 ASIN：${bestByAcos.slice(0, 5).map((item) => `${item.asin}(${item.value}%)`).join('、')}`
    )
  }
  summaryLines.push(`数据时效：${freshnessSentence(dataFreshness)}`)
  summaryLines.push('以上数字均由系统计算得出，回答时必须直接引用，不得自行估算或改动。')

  return {
    ok: true,
    empty: false,
    rows: rows.slice(0, MAX_MODEL_ROWS),
    rowCount: rows.length,
    truncated: rows.length > MAX_MODEL_ROWS,
    summary: summaryLines.join('\n'),
    analysis,
    citations: [datasetCitation(adsFreshness), datasetCitation(salesFreshness)],
    dataFreshness,
    blocks,
  }
}

/* ---------- 工具载荷：多 ASIN 异常扫描 ---------- */

export async function anomalyScanPayload({ marketplace = 'US', startDate, endDate, minSeverity = 'medium' }) {
  const [adsRows, salesRows] = await Promise.all([
    queryAdsDailyByMarketplace({ marketplace, startDate, endDate }),
    querySalesDailyByMarketplace({ marketplace, startDate, endDate }),
  ])
  const [adsFreshness, salesFreshness] = await Promise.all([
    datasetFreshnessOf('amazon_ads_daily'),
    datasetFreshnessOf('amazon_sales_daily'),
  ])
  const dataFreshness = combineFreshness([adsFreshness, salesFreshness])

  if (adsRows.length === 0 && salesRows.length === 0) {
    return {
      ok: true,
      empty: true,
      rows: [],
      rowCount: 0,
      summary: `没有查到站点 ${marketplace} 在 ${startDate} 至 ${endDate} 的数据，无法扫描异常。请确认站点与日期区间，或先导入报表。`,
      citations: [datasetCitation(adsFreshness), datasetCitation(salesFreshness)],
      dataFreshness,
      blocks: [],
    }
  }

  const period = previousPeriod(startDate, endDate)
  const previousAdsRows = period
    ? await queryAdsDailyByMarketplace({ marketplace, startDate: period.startDate, endDate: period.endDate })
    : []

  const groupByAsin = (rows) => {
    const map = new Map()
    for (const row of rows) {
      const list = map.get(row.asin) ?? []
      list.push(row)
      map.set(row.asin, list)
    }
    return new Map([...map.entries()].map(([asin, list]) => [asin, summarizeAds(list)]))
  }

  const currentByAsin = groupByAsin(adsRows)
  const previousByAsin = groupByAsin(previousAdsRows)
  const scan = scanAsinAnomalies({ currentByAsin, previousByAsin })

  const minRank = minSeverity === 'high' ? 2 : 1
  const riskRank = { high: 2, medium: 1, normal: 0 }
  const flagged = scan.items.filter((item) => riskRank[item.risk] >= minRank)

  const rows = scan.items.map((item) => ({
    asin: item.asin,
    risk: item.risk === 'high' ? '高风险' : item.risk === 'medium' ? '需关注' : '正常',
    severity: item.severity,
    acos: item.current.acos,
    acosPrev: item.previous?.acos ?? null,
    acosDelta: item.comparison.acos?.delta ?? null,
    cvr: item.current.cvr,
    cvrDelta: item.comparison.cvr?.delta ?? null,
    spend: item.current.spend,
    sales: item.current.sales,
    signals: item.signals.map((signal) => signal.label).join('、'),
  }))

  const blocks = [
    buildMetricsBlock({
      title: '扫描结果',
      items: [
        { key: 'asinCount', label: '扫描 ASIN 数', value: scan.summary.asinCount, unit: '' },
        { key: 'highCount', label: '高风险', value: scan.summary.highCount, unit: '' },
        { key: 'mediumCount', label: '需关注', value: scan.summary.mediumCount, unit: '' },
        { key: 'normalCount', label: '正常', value: scan.summary.normalCount, unit: '' },
      ],
      note: `区间 ${startDate} ~ ${endDate}，对比 ${period?.startDate ?? '—'} ~ ${period?.endDate ?? '—'}`,
    }),
    buildTableBlock({
      title: '异常清单（按严重度排序）',
      dataset: 'amazon_ads_daily',
      columns: [
        { key: 'asin', label: 'ASIN' },
        { key: 'risk', label: '判定' },
        { key: 'severity', label: '严重度', align: 'right' },
        { key: 'acos', label: 'ACoS(%)', align: 'right' },
        { key: 'acosDelta', label: 'ACoS 环比', align: 'right' },
        { key: 'cvr', label: '转化率(%)', align: 'right' },
        { key: 'spend', label: '花费', align: 'right' },
        { key: 'signals', label: '命中信号' },
      ],
      rows,
    }),
  ]

  if (rows.length > 1) {
    blocks.push(
      buildChartBlock({
        title: '各 ASIN ACoS 对比',
        chartType: 'bar',
        xKey: 'asin',
        series: [{ key: 'acos', label: 'ACoS(%)', kind: 'bar' }],
        data: rows
          .filter((row) => row.acos !== null)
          .sort((a, b) => b.acos - a.acos)
          .slice(0, 15),
        note: '红色区间对应 ACoS 预警线 35%。',
      })
    )
  }

  const summaryLines = [
    `站点 ${marketplace} · 区间 ${startDate} ~ ${endDate} · 扫描 ${scan.summary.asinCount} 个 ASIN`,
    `判定结果：高风险 ${scan.summary.highCount} 个，需关注 ${scan.summary.mediumCount} 个，正常 ${scan.summary.normalCount} 个`,
  ]
  if (flagged.length > 0) {
    summaryLines.push(
      `异常明细（最多列 10 个）：${flagged
        .slice(0, 10)
        .map(
          (item) =>
            `${item.asin}[${item.risk === 'high' ? '高风险' : '需关注'}] ACoS ${item.current.acos ?? '无'}%（环比 ${
              item.comparison.acos?.delta === null || item.comparison.acos?.delta === undefined
                ? '无对比'
                : `${item.comparison.acos.delta > 0 ? '+' : ''}${item.comparison.acos.delta} 个百分点`
            }）；信号：${item.signals.map((signal) => signal.label).join('、') || '无'}`
        )
        .join(' | ')}`
    )
  } else {
    summaryLines.push('本次扫描未发现需要关注的异常项。')
  }
  summaryLines.push(
    `预警线：ACoS > 35%、转化率 < 7%、点击率 < 0.25%；趋势信号：ACoS 环比涨幅 > 20%、转化率跌幅 > 20%、花费上涨 > 30% 且销售额下滑`
  )
  summaryLines.push(`数据时效：${freshnessSentence(dataFreshness)}`)
  summaryLines.push('以上判定与数字均由系统计算得出，回答时必须直接引用，不得自行估算或改动。')

  return {
    ok: true,
    empty: false,
    rows: rows.slice(0, MAX_MODEL_ROWS),
    rowCount: rows.length,
    summary: summaryLines.join('\n'),
    analysis: { period: { startDate, endDate }, previousPeriod: period, scan: scan.summary, flagged: flagged.slice(0, 20) },
    citations: [datasetCitation(adsFreshness), datasetCitation(salesFreshness)],
    dataFreshness,
    blocks,
  }
}

/* ---------- 工具载荷：库存风险 ---------- */

export async function inventoryRiskPayload({
  sku = null,
  thresholds = INVENTORY_THRESHOLDS,
  velocityWindowDays = DEFAULT_VELOCITY_WINDOW_DAYS,
}) {
  const [inventoryRows, orderRows, productRows, inventoryFreshness, orderFreshness, salesFreshness] =
    await Promise.all([
      queryInventoryAll(),
      queryRecentOrders(),
      queryProductMaster(),
      datasetFreshnessOf('inventory_snapshot'),
      datasetFreshnessOf('order_snapshot'),
      datasetFreshnessOf('amazon_sales_daily'),
    ])
  const dataFreshness = combineFreshness([inventoryFreshness, orderFreshness, salesFreshness])

  if (inventoryRows.length === 0) {
    return {
      ok: true,
      empty: true,
      rows: [],
      rowCount: 0,
      summary: '库存快照数据集尚未导入数据，无法做库存风险分析。请先到「AI 助手 → 数据源与导入」上传库存报表。',
      citations: [datasetCitation(inventoryFreshness), datasetCitation(orderFreshness)],
      dataFreshness,
      blocks: [],
    }
  }

  // 两种销量口径：优先产品主数据 + 销售报告（完整历史），缺失时回退订单快照（近期切片，低置信度）
  const skuChannels = buildSkuChannelMap(productRows)
  const latestSalesDate = await queryLatestSalesDate()
  let salesVelocity = new Map()
  let velocityWindow = null
  if (skuChannels.size > 0 && latestSalesDate) {
    const windowDays = Math.max(7, Math.min(Number(velocityWindowDays) || DEFAULT_VELOCITY_WINDOW_DAYS, 180))
    velocityWindow = resolveVelocityWindow([{ stat_date: latestSalesDate }], windowDays)
    const salesRows = await querySalesForVelocity({
      windowStart: velocityWindow?.start ?? null,
      windowEnd: velocityWindow?.end ?? null,
    })
    salesVelocity = computeSalesVelocityFromSales({ salesRows, mapping: skuChannels, windowDays })
  }
  const orderVelocity = computeSalesVelocity(orderRows)
  const velocity = mergeVelocitySources({ salesVelocity, orderVelocity })
  const scopedRows = sku ? inventoryRows.filter((row) => row.sku === sku) : inventoryRows
  if (scopedRows.length === 0) {
    return {
      ok: true,
      empty: true,
      rows: [],
      rowCount: 0,
      summary: `没有查到 SKU ${sku} 的库存记录，请确认 SKU 是否正确。`,
      citations: [datasetCitation(inventoryFreshness), datasetCitation(orderFreshness)],
      dataFreshness,
      blocks: [],
    }
  }

  const health = analyzeInventoryHealth({ inventoryRows: scopedRows, velocity, thresholds })
  const rows = health.items.map((item) => ({
    sku: item.sku,
    available: item.available,
    inTransit: item.inTransit,
    reserved: item.reserved,
    dailySales: item.dailySales,
    daysOfSupply: item.daysOfSupply,
    velocitySource:
      item.velocitySource === 'sales_report'
        ? '销售报告'
        : item.velocitySource === 'order_snapshot'
          ? '订单快照'
          : '无',
    risk:
      ({
      stockout: '断货风险',
      overstock: '积压',
      slow_moving: '滞销',
      insufficient_sample: '样本不足',
      unknown: '缺销量数据',
      healthy: '健康',
    })[item.risk] ?? item.risk,
    suggestedReorder: item.suggestedReorder,
  }))

  const blocks = [
    buildMetricsBlock({
      title: '库存风险概览',
      items: [
        { key: 'skuCount', label: 'SKU 数', value: health.summary.skuCount, unit: '' },
        { key: 'available', label: '可用库存合计', value: health.summary.totalAvailable, unit: '' },
        { key: 'inTransit', label: '在途合计', value: health.summary.totalInTransit, unit: '' },
        { key: 'stockout', label: '断货风险', value: health.summary.stockoutCount, unit: '' },
        { key: 'slow', label: '滞销', value: health.summary.slowMovingCount, unit: '' },
        { key: 'over', label: '积压', value: health.summary.overstockCount, unit: '' },
        { key: 'insufficient', label: '样本不足', value: health.summary.insufficientSampleCount, unit: '' },
        { key: 'unknown', label: '缺销量数据', value: health.summary.unknownCount, unit: '' },
      ],
      note: `阈值：可售天数 < ${thresholds.stockoutDays} 天判为断货风险，> ${thresholds.overstockDays} 天判为积压；补货目标 ${thresholds.targetDays} 天`,
    }),
    buildTableBlock({
      title: 'SKU 风险明细',
      dataset: 'inventory_snapshot',
      columns: [
        { key: 'sku', label: 'SKU' },
        { key: 'available', label: '可用', align: 'right' },
        { key: 'inTransit', label: '在途', align: 'right' },
        { key: 'reserved', label: '占用', align: 'right' },
        { key: 'dailySales', label: '日均销量', align: 'right' },
        { key: 'daysOfSupply', label: '可售天数', align: 'right' },
        { key: 'velocitySource', label: '销量口径' },
        { key: 'risk', label: '判定' },
        { key: 'suggestedReorder', label: '建议补货', align: 'right' },
      ],
      rows,
      note: [
        health.summary.unknownCount > 0
          ? `${health.summary.unknownCount} 个 SKU 在订单快照里没有销量记录，无法测算可售天数，已标记为「缺销量数据」而不是按 0 处理。`
          : null,
        health.summary.insufficientSampleCount > 0
          ? `${health.summary.insufficientSampleCount} 个 SKU 的销量样本不足 7 天，不足以判定滞销或积压，已标记为「样本不足」。`
          : null,
      ]
        .filter(Boolean)
        .join(' ') || null,
    }),
  ]

  const sample = health.items.find((item) => item.velocitySample)?.velocitySample ?? null
  const salesBasedCount = health.items.filter((item) => item.velocitySource === 'sales_report').length
  const orderBasedCount = health.items.filter((item) => item.velocitySource === 'order_snapshot').length
  const summaryLines = [
    `库存风险分析（阈值：断货 < ${thresholds.stockoutDays} 天、积压 > ${thresholds.overstockDays} 天、补货目标 ${thresholds.targetDays} 天）`,
    `共 ${health.summary.skuCount} 个 SKU，可用库存合计 ${health.summary.totalAvailable}，在途合计 ${health.summary.totalInTransit}`,
    `断货风险 ${health.summary.stockoutCount} 个，滞销 ${health.summary.slowMovingCount} 个，积压 ${health.summary.overstockCount} 个，样本不足 ${health.summary.insufficientSampleCount} 个，缺销量数据 ${health.summary.unknownCount} 个`,
  ]
  const risky = health.items.filter((item) => item.risk !== 'healthy').slice(0, 10)
  if (risky.length > 0) {
    summaryLines.push(
      `明细（最多列 10 个）：${risky
        .map(
          (item) =>
            `${item.sku} 可用 ${item.available} 在途 ${item.inTransit}，日均销量 ${item.dailySales ?? '无'}${
              item.velocitySource === 'order_snapshot' ? '（订单快照估算，样本短）' : ''
            }，可售天数 ${
              item.daysOfSupply ?? '无法测算'
            }，判定 ${
              {
                stockout: '断货风险',
                overstock: '积压',
                slow_moving: '滞销',
                insufficient_sample: '样本不足',
                unknown: '缺销量数据',
                healthy: '健康',
              }[item.risk]
            }${item.suggestedReorder > 0 ? `，建议补货 ${item.suggestedReorder}` : ''}`
        )
        .join(' | ')}`
    )
  }
  if (salesBasedCount > 0 && velocityWindow) {
    summaryLines.push(
      `销量口径：${salesBasedCount} 个 SKU 用「产品主数据 → 销售报告」计算，统计窗口 ${velocityWindow.start} ~ ${velocityWindow.end}（${velocityWindow.days} 天），属完整销售历史，可售天数与滞销判定可采信`
    )
  }
  if (orderBasedCount > 0) {
    summaryLines.push(
      `${orderBasedCount} 个 SKU 因缺少产品主数据映射或销售报告未覆盖，回退用订单快照估算（近期切片，样本短、置信度低），回答中必须如实说明这一口径差异`
    )
  }
  if (skinnerUnmapped(skuChannels, health.items) > 0) {
    summaryLines.push(
      `另有 ${skinnerUnmapped(skuChannels, health.items)} 个 SKU 未在「产品主数据」中登记，无法关联销售数据；建议先补产品主数据再评估`
    )
  }
  if (salesBasedCount === 0 && orderBasedCount === 0) {
    summaryLines.push('没有任何可用销量样本，可售天数无法测算；回答时必须说明这一限制，不得推测。')
  }
  void sample
  summaryLines.push(`数据时效：${freshnessSentence(dataFreshness)}`)
  summaryLines.push('以上数字均由系统计算得出，回答时必须直接引用，不得自行估算或改动。')

  return {
    ok: true,
    empty: false,
    rows: rows.slice(0, MAX_MODEL_ROWS),
    rowCount: rows.length,
    summary: summaryLines.join('\n'),
    analysis: { thresholds, summary: health.summary, items: health.items.slice(0, 50) },
    citations: [datasetCitation(inventoryFreshness), datasetCitation(orderFreshness)],
    dataFreshness,
    blocks,
  }
}

/* ---------- 工具载荷：指定 ASIN 集合（ASIN 清单） ---------- */

/**
 * 某站点广告/销售数据的最新日期（清单分析的窗口锚点）。
 *
 * 用数据最新日期而非"今天"做锚点：报表是人工导出的，可能滞后数天，
 * 以今天为终点会取到一个大半为空的区间，看起来像"清单里没有数据"。
 */
export async function queryLatestAmazonDate({ marketplace = 'US' } = {}) {
  const { rows } = await query(
    `SELECT GREATEST(
              (SELECT MAX(stat_date) FROM amazon_ads_daily WHERE marketplace = $1),
              (SELECT MAX(stat_date) FROM amazon_sales_daily WHERE marketplace = $1)
            ) AS latest`,
    [marketplace]
  )
  return dateOnly(rows[0]?.latest) ?? null
}

/**
 * 全站点的最新报表日期（2026-09-18 新增，「我的 ASIN」多站点区间锚点）。
 *
 * 一个账号的 ASIN 列表可以横跨多个站点，而"近 30 天"对一个列表只能有一个区间 ——
 * 若按各站点自己的最新日期分别取，每行数字的区间都不同，页面上的日期文案就没法写，
 * 用户也无法横向比较。统一用所有站点里最新的那一天做终点，某个站点报表滞后时
 * 表现为"该站点覆盖少"（页面上会如实给出有数据 / 无数据的条数），而不是悄悄换个区间。
 */
export async function queryLatestAmazonDateAcrossMarketplaces() {
  const { rows } = await query(
    `SELECT GREATEST(
              (SELECT MAX(stat_date) FROM amazon_ads_daily),
              (SELECT MAX(stat_date) FROM amazon_sales_daily)
            ) AS latest`
  )
  return dateOnly(rows[0]?.latest) ?? null
}

/** 按 ASIN 集合 + 站点取广告日报（清单分析的取数入口，命中 (asin, marketplace, stat_date) 索引）。 */
export async function queryAdsDailyByAsins({ asins, marketplace, startDate, endDate, limit = 20000 }) {
  if (!Array.isArray(asins) || asins.length === 0) return []
  const { rows } = await query(
    // 同 queryAdsDailyByMarketplace：触顶时优先保最近的数据
    `SELECT stat_date, asin, marketplace, campaign, impressions, clicks, spend, orders, sales, acos
       FROM amazon_ads_daily
      WHERE asin = ANY($1::text[]) AND marketplace = $2 AND stat_date BETWEEN $3 AND $4
      ORDER BY stat_date DESC
      LIMIT $5`,
    [asins, marketplace, startDate, endDate, limit]
  )
  return rows.reverse().map((row) => ({
    ...row,
    stat_date: dateOnly(row.stat_date),
    spend: Number(row.spend),
    sales: Number(row.sales),
    acos: row.acos === null ? null : Number(row.acos),
  }))
}

/** 按 ASIN 集合 + 站点取业务报告（销量口径）。 */
export async function querySalesDailyByAsins({ asins, marketplace, startDate, endDate, limit = 20000 }) {
  if (!Array.isArray(asins) || asins.length === 0) return []
  const { rows } = await query(
    `SELECT stat_date, asin, marketplace, units, sales, returns
       FROM amazon_sales_daily
      WHERE asin = ANY($1::text[]) AND marketplace = $2 AND stat_date BETWEEN $3 AND $4
      ORDER BY stat_date DESC
      LIMIT $5`,
    [asins, marketplace, startDate, endDate, limit]
  )
  return rows.reverse().map((row) => ({ ...row, stat_date: dateOnly(row.stat_date), sales: Number(row.sales) }))
}

const RISK_LABELS = { high: '高风险', medium: '需关注', normal: '正常' }

/**
 * ASIN 清单分析载荷：对**用户指定的这一批 ASIN**做汇总、排行与异常扫描。
 *
 * 与 `marketplacePerformancePayload`（全站）的区别：范围由用户给的 ASIN 集合决定，
 * 回答的是"我这批货怎么样"，而不是"整个站点怎么样"。
 *
 * 三条硬规则：
 * 1. **清单里的每个 ASIN 都要出现在结果里**——没有数据的那些以「无数据」行出现，
 *    不能因为 join 不上就悄悄消失（运营会以为清单漏了 ASIN）。
 * 2. **不把"报表没覆盖"说成"没卖出去"**：无广告/无销售记录一律标注为"无数据"，
 *    并在摘要里明确列出，绝不折算成 0 参与结论。
 * 3. 所有判定与数字来自 `analytics.mjs`（与全站扫描同一套阈值与算法），模型只负责表达。
 */
/**
 * 覆盖情况由"合并后的字段里有没有广告 / 销售数字"推导（2026-09-18）。
 *
 * 人工录入时不要求用户自己选"广告+销售 / 仅广告 / …"：他填了哪几项，
 * 事实就是哪几项 —— 让人手选一个由数字本身决定的东西，只会多一个填错的机会。
 */
export function deriveCoverageFromRow(row) {
  const hasAds = row.spend !== null || row.adSales !== null || row.orders !== null
  const hasSales = row.units !== null || row.businessSales !== null
  if (hasAds && hasSales) return '广告+销售'
  if (hasAds) return '仅广告'
  if (hasSales) return '仅销售'
  return '无数据'
}

/**
 * 把人工录入的指标合并进报表行（**手工值优先，未填的字段沿用报表**）。
 *
 * 页面（`myAsinMetricsPayload`）与 AI 工具都走这一处合并，因此"页面一个说法、
 * AI 一个说法"在这条链路上不可能发生。
 *
 * `manual` 标记会跟着行一起回传：页面据此在单元格上标「手工」，
 * 工具据此在回答里说明哪些数字不是报表来的。
 */
export function applyManualOverrides(rows, overridesByAsin) {
  if (!overridesByAsin || overridesByAsin.size === 0) return rows
  return rows.map((row) => {
    const manual = overridesByAsin.get(row.asin)
    if (!manual) return row
    const pick = (key, fallback) => {
      const value = manual[key]
      return value === null || value === undefined ? fallback : value
    }
    const next = {
      ...row,
      spend: pick('spend', row.spend),
      adSales: pick('adSales', row.adSales),
      orders: pick('orders', row.orders),
      acos: pick('acos', row.acos),
      units: pick('units', row.units),
      businessSales: pick('businessSales', row.businessSales),
      manual: true,
    }
    next.coverage = deriveCoverageFromRow(next)
    return next
  })
}

/** 合计口径：有人工值时必须**从合并后的行重算**，否则会出现"明细 800、合计 300"的自相矛盾。 */
function totalsFromRows(rows, kind) {
  const sum = (key) =>
    rows.reduce((total, row) => total + (typeof row[key] === 'number' ? row[key] : 0), 0)
  if (kind === 'ads') {
    const spend = sum('spend')
    const sales = sum('adSales')
    return {
      spend,
      sales,
      orders: sum('orders'),
      acos: sales > 0 ? Math.round((spend / sales) * 10000) / 100 : null,
    }
  }
  return { units: sum('units'), sales: sum('businessSales') }
}

export async function asinSetPerformancePayload({
  asins = [],
  marketplace = 'US',
  startDate,
  endDate,
  compareWith = 'previous_period',
  aliasByAsin = {},
  /*
   * 明细行数上限（2026-09-15 新增）。
   *
   * 默认 `MAX_TABLE_ROWS`（30）= 给模型看的预算，**工具路径零改动即保持现状**。
   * 页面「一键分析」显式传 `null` 表示"要全量" —— 清单上限提到 5000 后，
   * 明细分页与导出都必须拿到完整的行，否则用户永远看不到第 31 行之后的东西。
   */
  detailLimit = MAX_TABLE_ROWS,
  /*
   * 人工录入的指标（2026-09-18 新增）：`Map<asin, { spend, adSales, orders, acos, units, businessSales }>`，
   * 只作用于本站点（调用方按站点分组时已把站内 ASIN 归好）。
   */
  overridesByAsin = null,
}) {
  const detailMax = detailLimit === null ? MAX_DETAIL_ROWS : detailLimit
  const requested = [...new Set((asins ?? []).map((asin) => String(asin ?? '').trim().toUpperCase()))].filter(
    Boolean
  )

  const [adsRows, salesRows] = await Promise.all([
    queryAdsDailyByAsins({ asins: requested, marketplace, startDate, endDate }),
    querySalesDailyByAsins({ asins: requested, marketplace, startDate, endDate }),
  ])
  const [adsFreshness, salesFreshness] = await Promise.all([
    datasetFreshnessOf('amazon_ads_daily'),
    datasetFreshnessOf('amazon_sales_daily'),
  ])
  const dataFreshness = combineFreshness([adsFreshness, salesFreshness])
  const citations = [datasetCitation(adsFreshness), datasetCitation(salesFreshness)]

  const periodLabel = `站点 ${marketplace} · 区间 ${startDate} ~ ${endDate}（${periodDays(startDate, endDate)} 天）`

  // 只有人工录入值时也不能走"没有数据"分支：那会让页面在"报表未导入、全靠手填"时显示空表
  const hasManualOverrides = Boolean(overridesByAsin && overridesByAsin.size > 0)
  if (adsRows.length === 0 && salesRows.length === 0 && !hasManualOverrides) {
    const hint =
      requested.length === 0
        ? '清单里还没有 ASIN。'
        : `清单里的 ${requested.length} 个 ASIN 在 ${startDate} 至 ${endDate} 没有任何广告或销售记录。`
    return {
      ok: true,
      empty: true,
      rows: [],
      rowCount: 0,
      summary: `${periodLabel}\n${hint}\n可能原因：该区间没有投放/没有销售、站点选错，或这些 ASIN 的报表尚未导入。请确认后重试。`,
      citations,
      dataFreshness,
      blocks: [],
      analysis: { period: { startDate, endDate }, asinCount: requested.length, covered: 0, uncovered: requested },
    }
  }

  const groupByAsin = (rows) => {
    const map = new Map()
    for (const row of rows) {
      const list = map.get(row.asin) ?? []
      list.push(row)
      map.set(row.asin, list)
    }
    return map
  }

  const adsByAsin = groupByAsin(adsRows)
  const salesByAsin = groupByAsin(salesRows)
  const currentByAsin = new Map([...adsByAsin.entries()].map(([asin, list]) => [asin, summarizeAds(list)]))

  const compareMode = ['previous_period', 'last_year', 'none'].includes(compareWith)
    ? compareWith
    : 'previous_period'
  const comparisonLabel =
    compareMode === 'last_year' ? '同比（去年同期）' : compareMode === 'none' ? null : '环比（上一等长区间）'

  let previousByAsin = new Map()
  let previousSummary = null
  if (compareMode !== 'none') {
    const range = compareMode === 'last_year' ? samePeriodLastYear(startDate, endDate) : previousPeriod(startDate, endDate)
    const previousAdsRows = range
      ? await queryAdsDailyByAsins({
          asins: requested,
          marketplace,
          startDate: range.startDate,
          endDate: range.endDate,
        })
      : []
    previousByAsin = new Map(
      [...groupByAsin(previousAdsRows).entries()].map(([asin, list]) => [asin, summarizeAds(list)])
    )
    if (previousAdsRows.length > 0) previousSummary = summarizeAds(previousAdsRows)
  }

  const scan = scanAsinAnomalies({ currentByAsin, previousByAsin })

  // 覆盖率：清单请求的 ASIN 里，哪些在报表中完全找不到（**人工录入过的算"有数据"**）
  const adsCovered = new Set(adsRows.map((row) => row.asin))
  const salesCovered = new Set(salesRows.map((row) => row.asin))
  const manualCovered = new Set(overridesByAsin ? [...overridesByAsin.keys()] : [])
  const uncovered = requested.filter(
    (asin) => !adsCovered.has(asin) && !salesCovered.has(asin) && !manualCovered.has(asin)
  )

  const riskOf = new Map(scan.items.map((item) => [item.asin, item]))
  const hasAlias = Object.values(aliasByAsin ?? {}).some((value) => Boolean(value))

  const reportRows = requested.map((asin) => {
    const ads = currentByAsin.get(asin) ?? null
    const sales = salesByAsin.has(asin) ? summarizeSales(salesByAsin.get(asin)) : null
    const risk = riskOf.get(asin)
    const hasAds = adsCovered.has(asin)
    const hasSales = salesCovered.has(asin)
    return {
      asin,
      ...(hasAlias ? { alias: aliasByAsin?.[asin] ?? null } : {}),
      coverage: hasAds && hasSales ? '广告+销售' : hasAds ? '仅广告' : hasSales ? '仅销售' : '无数据',
      risk: hasAds ? RISK_LABELS[risk?.risk ?? 'normal'] : '无数据',
      severity: risk?.severity ?? null,
      spend: ads?.spend ?? null,
      adSales: ads?.sales ?? null,
      acos: ads?.acos ?? null,
      acosDelta: risk?.comparison?.acos?.delta ?? null,
      orders: ads?.orders ?? null,
      cvr: ads?.cvr ?? null,
      ctr: ads?.ctr ?? null,
      units: sales?.units ?? null,
      businessSales: sales?.sales ?? null,
      signals: (risk?.signals ?? []).map((signal) => signal.label).join('、'),
    }
  })

  /*
   * 人工录入的指标优先（2026-09-18）：合并只在这一处做，页面与 AI 工具因此共用同一套口径。
   * 合并后的合计必须一并重算 —— 明细是人工数字、汇总还是报表数字的话，两处对不上就会被当成数据错误。
   * `clicks` / `impressions` / `ctr` / `cvr` 没有人工入口，仍取报表值。
   */
  const rows = applyManualOverrides(reportRows, overridesByAsin)
  const manualPresent = rows.some((row) => row.manual)
  const current = manualPresent
    ? { ...summarizeAds(adsRows), ...totalsFromRows(rows, 'ads') }
    : summarizeAds(adsRows)
  const currentSales = manualPresent
    ? { ...summarizeSales(salesRows), ...totalsFromRows(rows, 'sales') }
    : summarizeSales(salesRows)

  const flagged = rows.filter((row) => row.risk === '高风险' || row.risk === '需关注')
  const withAcos = rows.filter((row) => row.acos !== null)
  const worstByAcos = rankAsins(currentByAsin, 'acos', { ascending: false, limit: 5 })

  const metricsItems = [
    { key: 'asinCount', label: '清单 ASIN 数', value: requested.length, unit: '' },
    { key: 'covered', label: '有数据', value: requested.length - uncovered.length, unit: '' },
    { key: 'uncovered', label: '无数据', value: uncovered.length, unit: '' },
    ...summaryItems(mergeAdAndBusinessSummary(current, currentSales)).filter((item) =>
      ['spend', 'sales', 'acos', 'orders', 'cvr'].includes(item.key)
    ),
  ]

  const blocks = [
    buildMetricsBlock({ title: '清单整体汇总', items: metricsItems, note: periodLabel }),
  ]

  const comparison = previousSummary
    ? comparePeriods(mergeAdAndBusinessSummary(current, currentSales), previousSummary)
    : null
  if (comparison && comparisonLabel) {
    blocks.push(buildComparisonBlock(comparison, { title: comparisonLabel }))
  }

  blocks.push(
    buildTableBlock({
      title: '清单内各 ASIN 表现（按花费降序）',
      dataset: 'amazon_ads_daily',
      columns: [
        ...(hasAlias ? [{ key: 'alias', label: '备注' }] : []),
        { key: 'asin', label: 'ASIN' },
        { key: 'coverage', label: '数据覆盖' },
        { key: 'risk', label: '判定' },
        { key: 'spend', label: '花费', align: 'right' },
        { key: 'adSales', label: '广告销售额', align: 'right' },
        { key: 'acos', label: 'ACoS(%)', align: 'right' },
        { key: 'orders', label: '广告订单', align: 'right' },
        { key: 'cvr', label: '转化率(%)', align: 'right' },
        { key: 'units', label: '销量', align: 'right' },
      ],
      rows: [...rows].sort((a, b) => (b.spend ?? -1) - (a.spend ?? -1)),
      maxRows: detailMax,
      note: [
        uncovered.length > 0
          ? `「无数据」表示这些 ASIN 在该区间与站点没有任何报表记录，不代表销量为 0。`
          : null,
        rows.length > detailMax
          ? `清单共 ${rows.length} 个 ASIN，此处只列出花费最高的 ${detailMax} 个（完整清单请在「我的 ASIN」页查看）。`
          : null,
      ]
        .filter(Boolean)
        .join(' '),
    })
  )

  if (withAcos.length > 1) {
    blocks.push(
      buildChartBlock({
        title: '清单内各 ASIN ACoS 对比',
        chartType: 'bar',
        xKey: 'asin',
        series: [{ key: 'acos', label: 'ACoS(%)', kind: 'bar' }],
        data: [...withAcos].sort((a, b) => b.acos - a.acos).slice(0, 15),
        note: '红色区间对应 ACoS 预警线 35%。',
      })
    )
  }

  if (flagged.length > 0) {
    blocks.push(
      buildTableBlock({
        title: '需要处理的 ASIN（按严重度排序）',
        dataset: 'amazon_ads_daily',
        columns: [
          { key: 'asin', label: 'ASIN' },
          { key: 'risk', label: '判定' },
          { key: 'severity', label: '严重度', align: 'right' },
          { key: 'acos', label: 'ACoS(%)', align: 'right' },
          { key: 'acosDelta', label: 'ACoS 环比', align: 'right' },
          { key: 'spend', label: '花费', align: 'right' },
          { key: 'signals', label: '命中信号' },
        ],
        rows: [...flagged].sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0)),
        maxRows: detailMax,
        note:
          flagged.length > detailMax
            ? `共 ${flagged.length} 个需要处理，此处按严重度列出前 ${detailMax} 个。`
            : null,
      })
    )
  }

  const summaryLines = [
    `${periodLabel} · 清单 ${requested.length} 个 ASIN（有数据 ${requested.length - uncovered.length} 个，无数据 ${uncovered.length} 个）`,
    `整体：广告花费 ${current.spend}，广告销售额 ${current.sales}，ACoS ${current.acos ?? '无'}%，点击 ${current.clicks}，曝光 ${current.impressions}，广告订单 ${current.orders}，点击率 ${current.ctr ?? '无'}%，转化率 ${current.cvr ?? '无'}%`,
  ]
  if (currentSales) {
    summaryLines.push(
      `业务报告：总销量 ${currentSales.units}，销售额 ${currentSales.sales}，退货 ${currentSales.returns}，退货率 ${currentSales.returnRate ?? '无'}%`
    )
  }
  if (comparison && comparisonLabel && comparison.notes.length === 0) {
    const m = comparison.metrics
    const change = (key, label) => {
      const item = m[key]
      if (!item || item.delta === null) return null
      const pct = item.deltaPct === null ? '上期为 0' : `${item.deltaPct > 0 ? '+' : ''}${item.deltaPct}%`
      return `${label} ${item.previous} → ${item.current}（${pct}）`
    }
    summaryLines.push(
      `${comparisonLabel}：${[change('acos', 'ACoS'), change('spend', '花费'), change('sales', '广告销售额'), change('cvr', '转化率')]
        .filter(Boolean)
        .join('；')}`
    )
  }
  summaryLines.push(
    `判定结果：高风险 ${scan.summary.highCount} 个，需关注 ${scan.summary.mediumCount} 个，正常 ${scan.summary.normalCount} 个`
  )
  if (worstByAcos.length > 0) {
    summaryLines.push(`清单内 ACoS 最高：${worstByAcos.map((item) => `${item.asin}(${item.value}%)`).join('、')}`)
  }
  if (flagged.length > 0) {
    summaryLines.push(
      `需要处理（最多列 10 个）：${flagged
        .slice(0, 10)
        .map(
          (row) =>
            `${row.asin}[${row.risk}] ACoS ${row.acos ?? '无'}%（环比 ${
              row.acosDelta === null || row.acosDelta === undefined ? '无对比' : `${row.acosDelta > 0 ? '+' : ''}${row.acosDelta} 个百分点`
            }）；信号：${row.signals || '无'}`
        )
        .join(' | ')}`
    )
  } else {
    summaryLines.push('清单内未发现需要关注的异常项。')
  }
  if (rows.length > detailMax) {
    summaryLines.push(
      `明细表只列出前 ${detailMax} 个 ASIN（清单共 ${rows.length} 个）；需要完整清单时提示用户到「AI 助手 → 我的 ASIN」页查看或导出。`
    )
  }
  summaryLines.push(
    uncovered.length > 0
      ? `无数据的 ASIN（${uncovered.length} 个）：${uncovered.slice(0, 20).join('、')}${uncovered.length > 20 ? ' 等' : ''}。这些 ASIN 在区间内没有任何报表记录，不代表销量为 0，回答时必须如实说明。`
      : '清单内所有 ASIN 都有报表记录。'
  )
  summaryLines.push(
    '预警线：ACoS > 35%、转化率 < 7%、点击率 < 0.25%；趋势信号：ACoS 环比涨幅 > 20%、转化率跌幅 > 20%、花费上涨 > 30% 且销售额下滑'
  )
  summaryLines.push(`数据时效：${freshnessSentence(dataFreshness)}`)
  const manualAsins = rows.filter((row) => row.manual).map((row) => row.asin)
  if (manualAsins.length > 0) {
    summaryLines.push(
      `其中 ${manualAsins.length} 个 ASIN 的指标是**人工录入**（优先于报表，通常是报表未导入或需要修正）：${manualAsins
        .slice(0, 20)
        .join('、')}${manualAsins.length > 20 ? ' 等' : ''}。回答时必须说明这些数字来自人工录入，不得描述成报表统计结果。`
    )
  }
  summaryLines.push('以上判定与数字均由系统计算得出，回答时必须直接引用，不得自行估算或改动。')

  return {
    ok: true,
    empty: false,
    rows: rows.slice(0, MAX_MODEL_ROWS),
    /*
     * 全量明细行（2026-09-18 新增）。
     *
     * 「我的 ASIN」数据表要按区间展示每个 ASIN 的指标，而 `rows` 这一份是**给模型看的
     * 预算**（`MAX_MODEL_ROWS = 120`）——拿它当页面数据源，第 121 个之后的 ASIN 永远没有数字。
     * 因此只在调用方显式要求全量（`detailLimit === null`，即页面路径）时回传这一份；
     * 工具路径拿不到该字段，AI 上下文的开销零变化。
     */
    ...(detailLimit === null ? { detailRows: rows } : {}),
    rowCount: rows.length,
    truncated: rows.length > MAX_MODEL_ROWS,
    summary: summaryLines.join('\n'),
    analysis: {
      period: { startDate, endDate, days: periodDays(startDate, endDate) },
      previousPeriod: compareMode === 'none' ? null : (compareMode === 'last_year' ? samePeriodLastYear(startDate, endDate) : previousPeriod(startDate, endDate)),
      asinCount: requested.length,
      covered: requested.length - uncovered.length,
      uncovered,
      current: mergeAdAndBusinessSummary(current, currentSales),
      comparison,
      scan: scan.summary,
      flagged: flagged.slice(0, 20),
      manualAsins,
    },
    citations,
    dataFreshness,
    blocks,
  }
}

/**
 * 「我的 ASIN」多站点指标载荷（2026-09-18 新增）。
 *
 * 站点从清单下沉到每条 ASIN 之后，一个账号的列表里可能同时有 US 与 DE 的商品，
 * 而 `asinSetPerformancePayload` 一次只认一个站点（日报按 `(asin, marketplace)` 存储）。
 * 这里按站点分组、复用**同一个** payload 逐组取数，再合并成页面能直接消费的形状。
 *
 * **为什么不出跨站点的合计**：不同站点的货币不同（USD / EUR / JPY…），
 * 把 US 的花费与 DE 的销售额相加得到的数字没有含义；一旦界面给了一个"总花费"，
 * 就一定会有人拿它做决策。因此顶层 `summary` 只保留"条数 / 覆盖数"这类与货币无关的计数，
 * 金额与 ACoS 一律留在 `groups` 里按站点分开放。
 *
 * 行里补上 `marketplace`：页面要按 `(asin, 站点)` 与清单条目连接，
 * 单靠 ASIN 无法区分同一款商品在两个站点的两行。
 */
export async function myAsinMetricsPayload({
  items = [],
  startDate,
  endDate,
  /**
   * 人工录入的指标：`Map<itemId, { spend, adSales, orders, acos, units, businessSales }>`。
   *
   * 按**条目 id** 索引（不是 ASIN）：用户改了 ASIN 或站点后，这条记录的手工值仍然跟着它
   * —— 那通常是"编码写错了纠正一下"，不该把手填的数字一起丢掉。
   */
  overridesByItemId = null,
}) {
  const byMarketplace = new Map()
  for (const item of items ?? []) {
    const site = String(item?.marketplace ?? 'US').toUpperCase()
    const list = byMarketplace.get(site) ?? []
    list.push(item)
    byMarketplace.set(site, list)
  }

  const groups = await Promise.all(
    [...byMarketplace.entries()].map(async ([marketplace, list]) => {
      const aliasByAsin = {}
      for (const item of list) {
        if (item?.alias) aliasByAsin[item.asin] = item.alias
      }
      // 人工录入值按 ASIN 归到本站点这一组（同站内 ASIN 唯一，不会串行）
      const overridesByAsin = new Map()
      if (overridesByItemId) {
        for (const item of list) {
          const manual = overridesByItemId.get(item.id)
          if (manual) overridesByAsin.set(item.asin, manual)
        }
      }
      const payload = await asinSetPerformancePayload({
        asins: list.map((item) => item.asin),
        marketplace,
        startDate,
        endDate,
        // 表格回答的是"这个区间现在什么样"；趋势与对比交给 AI 对话
        compareWith: 'none',
        aliasByAsin,
        // 页面要全量行（表格分页与导出都基于它），不能沿用给模型看的预算
        detailLimit: null,
        overridesByAsin,
      })
      const analysis = payload.analysis ?? {}
      return {
        marketplace,
        asinCount: analysis.asinCount ?? list.length,
        covered: analysis.covered ?? 0,
        uncovered: (analysis.uncovered ?? []).length,
        summary: { ...(analysis.current ?? {}) },
        rows: (payload.detailRows ?? []).map((row) => ({ ...row, marketplace })),
        dataFreshness: payload.dataFreshness ?? null,
      }
    })
  )

  /*
   * 按调用方给的 items 顺序还原行序：页面按"加入时间"或用户点的排序消费这份数据，
   * 而分组取数天然会打乱顺序（站点之间并行返回）。
   */
  const byKey = new Map()
  for (const group of groups) {
    for (const row of group.rows) byKey.set(`${row.asin}::${group.marketplace}`, row)
  }
  const rows = (items ?? [])
    .map((item) =>
      byKey.get(
        `${String(item?.asin ?? '').toUpperCase()}::${String(item?.marketplace ?? 'US').toUpperCase()}`
      )
    )
    .filter(Boolean)

  // 数据时效取最晚的一份：多站点下"报表最新到哪一天"由最靠前的那个站点决定
  const freshness =
    groups
      .map((group) => group.dataFreshness)
      .filter(Boolean)
      .sort((a, b) => String(b.periodEnd ?? '').localeCompare(String(a.periodEnd ?? '')))[0] ??
    null

  return {
    period: {
      startDate,
      endDate,
      days: periodDays(startDate, endDate),
    },
    groups: groups.map(({ dataFreshness: _dataFreshness, ...rest }) => rest),
    rows,
    summary: {
      asinCount: (items ?? []).length,
      covered: groups.reduce((sum, group) => sum + group.covered, 0),
      uncovered: groups.reduce((sum, group) => sum + group.uncovered, 0),
      marketplaces: groups.map((group) => group.marketplace),
    },
    dataFreshness: freshness,
  }
}

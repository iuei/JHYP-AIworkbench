/**
 * 经营分析计算（纯函数，全部由服务端算，模型只负责表达）。
 *
 * 为什么必须服务端算：A2 验收要求"归因主因与人工结论一致"，而让语言模型做算术等于允许编造数字，
 * 与已确立的"失败不编造"原则冲突。这里每个指标、每个驱动因子都可复算、可复核。
 *
 * 约定：
 * - 百分比类指标统一以"百分数数值"表示（ACoS 25.3 表示 25.3%），与数据集存储口径一致；
 * - 除零一律返回 null，绝不返回 NaN / Infinity；
 * - 缺少对比期数据时返回 null 并在 `notes` 里说明原因，由回答如实转述而不是猜。
 */

export const round = (value, digits = 2) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const safeDivide = (numerator, denominator, { scale = 1 } = {}) => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null
  return (numerator / denominator) * scale
}

const toNumber = (value) => {
  if (value === null || value === undefined) return 0
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

/** 按日期区间过滤行（闭区间，YYYY-MM-DD 字符串比较即可）。 */
export function filterByDate(rows, { startDate = null, endDate = null, dateField = 'stat_date' } = {}) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const value = normalizeDate(row?.[dateField])
    if (!value) return false
    if (startDate && value < startDate) return false
    if (endDate && value > endDate) return false
    return true
  })
}

function normalizeDate(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const text = String(value)
  return text.length >= 10 ? text.slice(0, 10) : text
}

/** 广告指标汇总。 */
export function summarizeAds(rows) {
  const list = Array.isArray(rows) ? rows : []
  const totals = list.reduce(
    (acc, row) => ({
      impressions: acc.impressions + toNumber(row.impressions),
      clicks: acc.clicks + toNumber(row.clicks),
      spend: acc.spend + toNumber(row.spend),
      orders: acc.orders + toNumber(row.orders),
      sales: acc.sales + toNumber(row.sales),
      days: acc.days + 1,
    }),
    { impressions: 0, clicks: 0, spend: 0, orders: 0, sales: 0, days: 0 }
  )

  // 汇总 ACoS 一律用 spend/sales 重算，不平均行级 ACoS（行级平均会给出误导性结论）
  const acos = safeDivide(totals.spend, totals.sales, { scale: 100 })
  return {
    days: totals.days,
    impressions: totals.impressions,
    clicks: totals.clicks,
    spend: round(totals.spend),
    orders: totals.orders,
    sales: round(totals.sales),
    acos: round(acos),
    ctr: round(safeDivide(totals.clicks, totals.impressions, { scale: 100 }), 3),
    cvr: round(safeDivide(totals.orders, totals.clicks, { scale: 100 }), 2),
    cpc: round(safeDivide(totals.spend, totals.clicks), 2),
    cpa: round(safeDivide(totals.spend, totals.orders), 2),
    aov: round(safeDivide(totals.sales, totals.orders), 2),
    /** 行级 ACoS 缺失时由服务端补齐，供明细表展示 */
    hasRowLevelAcos: list.some((row) => row.acos !== null && row.acos !== undefined),
  }
}

/** 销售指标汇总。 */
export function summarizeSales(rows) {
  const list = Array.isArray(rows) ? rows : []
  const totals = list.reduce(
    (acc, row) => ({
      units: acc.units + toNumber(row.units),
      sales: acc.sales + toNumber(row.sales),
      returns: acc.returns + toNumber(row.returns),
    }),
    { units: 0, sales: 0, returns: 0 }
  )
  return {
    units: totals.units,
    sales: round(totals.sales),
    returns: totals.returns,
    returnRate: round(safeDivide(totals.returns, totals.units, { scale: 100 }), 2),
    /** 客单价按"销售额/销量"给出，只有销量与销售额同时存在时才有意义 */
    unitPrice: round(safeDivide(totals.sales, totals.units), 2),
  }
}

/**
 * 合并「广告汇总」与「业务报告汇总」，且**不让业务销售额覆盖广告销售额**。
 *
 * 为什么需要它：`summarizeAds` 与 `summarizeSales` 都返回 `sales`，
 * 直接 `{ ...ad, ...business }` 会让 `sales` 变成业务销售额，而展示层（标签「广告销售额」）、
 * ACoS 与喂给模型的事实清单都是按**广告口径**引用 `sales` 的 ——
 * 结果是 spend / sales / ACoS 三个数字口径互相冲突（实测示例：花费 5000、广告销售额 20000、
 * 业务销售额 60000，却展示「广告销售额 60000、ACoS 25%」，真实 ACoS 应为 8.3%）。
 *
 * 因此这里显式保留两个口径：`sales` = 广告销售额，`businessSales` = 业务销售额。
 * 对比块（comparePeriods）也必须走这个函数，否则环比同样错配口径。
 */
export function mergeAdAndBusinessSummary(adSummary, salesSummary = null) {
  if (!adSummary) return null
  const merged = { ...adSummary, ...(salesSummary ?? {}) }
  merged.sales = adSummary.sales
  if (salesSummary) merged.businessSales = salesSummary.sales
  return merged
}

/**
 * 区间的自然天数（含首尾）。
 *
 * 不能用 `summarizeAds().days` 代替：那个字段统计的是**参与汇总的行数**，
 * 单 ASIN 30 天 × 5 个 campaign 会得到 150，而区间仍是 30 天。
 */
export function periodDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  return Math.round((end - start) / 86400000) + 1
}

/** 计算紧邻的上一期（等长区间）。 */
export function previousPeriod(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null
  const days = Math.round((end - start) / 86400000) + 1
  const previousEnd = new Date(start.getTime() - 86400000)
  const previousStart = new Date(previousEnd.getTime() - (days - 1) * 86400000)
  return {
    startDate: previousStart.toISOString().slice(0, 10),
    endDate: previousEnd.toISOString().slice(0, 10),
    days,
  }
}

/** 计算去年同期（起止各减一年，处理 2/29）。 */
export function samePeriodLastYear(startDate, endDate) {
  const shift = (value) => {
    const date = new Date(`${value}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return null
    const month = date.getUTCMonth()
    const day = date.getUTCDate()
    const target = new Date(Date.UTC(date.getUTCFullYear() - 1, month, day))
    // 2/29 落到非闰年时退到 2/28
    if (target.getUTCMonth() !== month) {
      return new Date(Date.UTC(date.getUTCFullYear() - 1, month + 1, 0))
        .toISOString()
        .slice(0, 10)
    }
    return target.toISOString().slice(0, 10)
  }
  const start = shift(startDate)
  const end = shift(endDate)
  if (!start || !end) return null
  return { startDate: start, endDate: end }
}

const COMPARABLE_METRICS = [
  'impressions',
  'clicks',
  'spend',
  'orders',
  'sales',
  'units',
  'returns',
  'acos',
  'ctr',
  'cvr',
  'cpc',
  'aov',
]

/**
 * 对比两期指标：给出每项的当前值、上期值、绝对差与百分比变化。
 * 上期缺失或为 0 时 deltaPct 返回 null，并写明原因，避免出现"增长 ∞%"这类误导性结论。
 */
export function comparePeriods(current, previous, { metrics = COMPARABLE_METRICS } = {}) {
  if (!current) return { metrics: {}, notes: ['当前期没有数据'] }
  const notes = []
  if (!previous) notes.push('缺少对比期数据，无法给出环比/同比变化')

  const result = {}
  for (const metric of metrics) {
    if (!Object.hasOwn(current, metric)) continue
    const currentValue = current[metric]
    const previousValue = previous ? previous[metric] : null
    if (currentValue === null || currentValue === undefined) {
      result[metric] = {
        current: null,
        previous: previousValue ?? null,
        delta: null,
        deltaPct: null,
      }
      continue
    }
    if (previousValue === null || previousValue === undefined) {
      result[metric] = { current: currentValue, previous: null, delta: null, deltaPct: null }
      continue
    }
    const delta = round(currentValue - previousValue)
    const deltaPct =
      previousValue === 0 ? null : round(((currentValue - previousValue) / Math.abs(previousValue)) * 100)
    result[metric] = { current: currentValue, previous: previousValue, delta, deltaPct }
  }

  return { metrics: result, notes }
}

/**
 * ACoS 变化的两因素分解（顺序分解法，两部分相加**恰好**等于总变化）：
 *   ΔACoS = 花费效应 + 销售额效应
 *   花费效应 = (spend_c - spend_p) / sales_p        —— 只看花费变动带来的影响
 *   销售额效应 = spend_c/sales_c - spend_c/sales_p   —— 在花费已变化的基础上看销售额变动
 * 这样得出的"主因"可复算，回答里可以直接引用，而不是让模型猜。
 */
export function decomposeAcosChange(current, previous) {
  if (!current || !previous) {
    return { ok: false, reason: '缺少对比期数据，无法分解' }
  }
  const { spend: spendC, sales: salesC, acos: acosC } = current
  const { spend: spendP, sales: salesP, acos: acosP } = previous
  if (![spendC, salesC, spendP, salesP].every((value) => Number.isFinite(value))) {
    return { ok: false, reason: '关键指标缺失（花费或销售额），无法分解' }
  }
  if (salesC === 0 || salesP === 0) {
    return { ok: false, reason: '销售额为 0，ACoS 无意义，无法分解' }
  }

  const totalDelta = round(acosC - acosP)
  const spendEffect = round(((spendC - spendP) / salesP) * 100)
  const salesEffect = round((spendC / salesC - spendC / salesP) * 100)
  const residual = round(totalDelta - (spendEffect + salesEffect))

  const absolute = [
    { factor: 'spend', effect: spendEffect, label: '广告花费变化' },
    { factor: 'sales', effect: salesEffect, label: '广告销售额变化' },
  ].sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))

  const dominant = absolute[0]
  return {
    ok: true,
    totalDelta,
    spendEffect,
    salesEffect,
    residual,
    /** 主因：绝对值更大的那一项；两者都接近 0 时说明 ACoS 基本没变 */
    dominantFactor: Math.abs(dominant.effect) < 0.01 ? null : dominant.factor,
    dominantLabel: Math.abs(dominant.effect) < 0.01 ? 'ACoS 基本持平' : dominant.label,
    ranked: absolute,
  }
}

/** PRD 场景二给出的预警线。 */
export const DEFAULT_THRESHOLDS = {
  acos: { warning: 35, direction: 'above', label: 'ACoS' },
  cvr: { warning: 7, direction: 'below', label: '转化率' },
  ctr: { warning: 0.25, direction: 'below', label: '点击率' },
}

/** 按阈值判定异常项；空值不判异常（缺少数据不等于异常）。 */
export function judgeAnomalies(summary, thresholds = DEFAULT_THRESHOLDS) {
  if (!summary) return []
  const anomalies = []
  for (const [metric, rule] of Object.entries(thresholds)) {
    const value = summary[metric]
    if (value === null || value === undefined) continue
    const breached = rule.direction === 'above' ? value > rule.warning : value < rule.warning
    if (breached) {
      anomalies.push({
        metric,
        label: rule.label,
        value,
        threshold: rule.warning,
        direction: rule.direction,
      })
    }
  }
  return anomalies
}

/**
 * 生成按日趋势序列，供回答卡片画趋势图。
 * 广告与销售数据按日期对齐；任一来源缺失的日期用 null 占位（图表断点比补 0 更诚实）。
 */
export function buildTrendSeries(adsRows, salesRows = []) {
  const byDate = new Map()
  const ensure = (date) => {
    if (!byDate.has(date)) {
      byDate.set(date, {
        date,
        impressions: 0,
        clicks: 0,
        spend: 0,
        orders: 0,
        sales: 0,
        units: null,
        returns: null,
      })
    }
    return byDate.get(date)
  }

  for (const row of Array.isArray(adsRows) ? adsRows : []) {
    const date = normalizeDate(row.stat_date)
    if (!date) continue
    const entry = ensure(date)
    entry.impressions += toNumber(row.impressions)
    entry.clicks += toNumber(row.clicks)
    entry.spend += toNumber(row.spend)
    entry.orders += toNumber(row.orders)
    entry.sales += toNumber(row.sales)
  }

  const salesDates = new Set()
  for (const row of Array.isArray(salesRows) ? salesRows : []) {
    const date = normalizeDate(row.stat_date)
    if (!date) continue
    salesDates.add(date)
    const entry = ensure(date)
    entry.units = (entry.units ?? 0) + toNumber(row.units)
    entry.returns = (entry.returns ?? 0) + toNumber(row.returns)
  }

  return [...byDate.values()]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((entry) => ({
      ...entry,
      spend: round(entry.spend),
      sales: round(entry.sales),
      // 日 ACoS 由服务端算，避免前端或模型各算一遍导致口径不一致
      acos: round(safeDivide(entry.spend, entry.sales, { scale: 100 })),
      ctr: round(safeDivide(entry.clicks, entry.impressions, { scale: 100 }), 3),
      hasSalesReport: salesDates.has(entry.date),
    }))
}

/** 组装完整的广告表现分析结果（工具返回值的主体）。 */
export function analyzeAdsPerformance({ adsRows, salesRows = [], startDate, endDate, previousAdsRows = null, previousSalesRows = null }) {
  const current = summarizeAds(filterByDate(adsRows, { startDate, endDate }))
  const currentSales = summarizeSales(filterByDate(salesRows, { startDate, endDate }))
  const previous = previousAdsRows ? summarizeAds(previousAdsRows) : null
  const previousSales = previousSalesRows ? summarizeSales(previousSalesRows) : null

  // 广告订单占比：广告订单 / 总销量，只有拿到业务报告时才有意义
  const adOrderShare =
    currentSales.units > 0 ? round((current.orders / currentSales.units) * 100, 2) : null

  const merged = { ...mergeAdAndBusinessSummary(current, currentSales), adOrderShare }
  const comparison = comparePeriods(
    mergeAdAndBusinessSummary(current, currentSales),
    previous ? mergeAdAndBusinessSummary(previous, previousSales) : null
  )
  const decomposition = previous ? decomposeAcosChange(current, previous) : { ok: false, reason: '缺少对比期数据，无法分解' }
  const anomalies = judgeAnomalies(merged)

  return {
    period: { startDate, endDate, days: periodDays(startDate, endDate), rowCount: current.days },
    current: merged,
    comparison,
    decomposition,
    anomalies,
    trend: buildTrendSeries(
      filterByDate(adsRows, { startDate, endDate }),
      filterByDate(salesRows, { startDate, endDate })
    ),
  }
}

/* ---------- M-B：主动分析 ---------- */

/** 库存与销售的健康度阈值（可被工具参数覆盖）。 */
export const INVENTORY_THRESHOLDS = {
  /** 可售天数低于该值判定为断货风险 */
  stockoutDays: 14,
  /** 可售天数高于该值判定为积压 */
  overstockDays: 90,
  /** 补货目标可售天数（旺季口径） */
  targetDays: 45,
}

/**
 * 按 SKU 计算日均销量（来自订单快照）。
 *
 * 说明：订单快照是**近期订单的切片**，不是完整销售历史，因此这里给出的是"样本日均销量"，
 * 回答里必须如实说明样本区间与天数，不能让用户误以为是长期平均值。
 */
export function computeSalesVelocity(orderRows) {
  const bySku = new Map()
  for (const row of Array.isArray(orderRows) ? orderRows : []) {
    const sku = row?.sku
    if (!sku) continue
    const entry = bySku.get(sku) ?? { sku, quantity: 0, orderCount: 0, dates: [] }
    entry.quantity += toNumber(row.quantity)
    entry.orderCount += 1
    const date = normalizeDate(row.ordered_at)
    if (date) entry.dates.push(date)
    bySku.set(sku, entry)
  }

  const result = new Map()
  for (const [sku, entry] of bySku) {
    const dates = entry.dates.sort()
    const first = dates[0] ?? null
    const last = dates.at(-1) ?? null
    const spanDays =
      first && last
        ? Math.max(1, Math.round((new Date(`${last}T00:00:00Z`) - new Date(`${first}T00:00:00Z`)) / 86400000) + 1)
        : 1
    result.set(sku, {
      sku,
      quantity: entry.quantity,
      orderCount: entry.orderCount,
      sampleStart: first,
      sampleEnd: last,
      sampleDays: spanDays,
      // 样本区间只有 1-2 天时，日均销量极不稳定，标记为低置信度
      dailyAverage: round(entry.quantity / spanDays, 2),
      lowConfidence: spanDays < 7,
    })
  }
  return result
}

/**
 * 库存健康度分析：可售天数、断货风险、积压与滞销判定、建议补货量。
 *
 * 缺销量数据时**不做推测**：daysOfSupply 返回 null，风险标记为 unknown，
 * 回答必须说明"缺少销量样本，无法测算可售天数"。
 */
export function analyzeInventoryHealth({ inventoryRows, velocity, thresholds = INVENTORY_THRESHOLDS }) {
  const bySku = new Map()
  for (const row of Array.isArray(inventoryRows) ? inventoryRows : []) {
    const sku = row?.sku
    if (!sku) continue
    const entry = bySku.get(sku) ?? {
      sku,
      available: 0,
      inTransit: 0,
      reserved: 0,
      warehouses: 0,
      details: [],
    }
    entry.available += toNumber(row.available)
    entry.inTransit += toNumber(row.in_transit)
    entry.reserved += toNumber(row.reserved)
    entry.warehouses += 1
    entry.details.push({
      warehouse: row.warehouse ?? '',
      available: toNumber(row.available),
      inTransit: toNumber(row.in_transit),
      reserved: toNumber(row.reserved),
    })
    bySku.set(sku, entry)
  }

  const items = []
  for (const [sku, entry] of bySku) {
    const sample = velocity?.get?.(sku) ?? null
    const dailyAverage = sample?.dailyAverage ?? null
    const daysOfSupply =
      dailyAverage && dailyAverage > 0 ? round(entry.available / dailyAverage, 1) : null

    // 判定顺序与置信度处理：
    // - 没有销量样本 → unknown（不猜）
    // - 样本不足 7 天 → 只能用于"可能断货"这种保守告警；判定"积压/滞销"需要长期需求证据，
    //   用几天样本说"积压"会误导运营去清库存，因此降级为 insufficient_sample
    let risk = 'healthy'
    const lowConfidence = Boolean(sample?.lowConfidence)
    if (dailyAverage === null) risk = 'unknown'
    else if (dailyAverage === 0) {
      risk = entry.available > 0 ? (lowConfidence ? 'insufficient_sample' : 'slow_moving') : 'healthy'
    } else if (daysOfSupply < thresholds.stockoutDays) {
      risk = 'stockout'
    } else if (daysOfSupply > thresholds.overstockDays) {
      risk = lowConfidence ? 'insufficient_sample' : 'overstock'
    }

    // 建议补货量：补到目标可售天数；在途量计入已补部分
    const suggestedReorder =
      risk === 'stockout' && dailyAverage > 0
        ? Math.max(0, Math.ceil(thresholds.targetDays * dailyAverage - entry.available - entry.inTransit))
        : 0

    items.push({
      sku,
      available: entry.available,
      inTransit: entry.inTransit,
      reserved: entry.reserved,
      warehouses: entry.warehouses,
      dailySales: dailyAverage,
      daysOfSupply,
      risk,
      lowConfidence,
      suggestedReorder,
      // 销量口径来源：sales_report（完整销售历史）/ order_snapshot（近期切片，低置信度）
      velocitySource: sample?.source ?? null,
      velocitySample: sample
        ? {
            start: sample.sampleStart,
            end: sample.sampleEnd,
            days: sample.days ?? sample.sampleDays,
            lowConfidence: sample.lowConfidence,
          }
        : null,
      details: entry.details,
    })
  }

  const RISK_RANK = {
    stockout: 0,
    slow_moving: 1,
    overstock: 2,
    insufficient_sample: 3,
    unknown: 4,
    healthy: 5,
  }
  items.sort((a, b) => {
    const rank = RISK_RANK[a.risk] - RISK_RANK[b.risk]
    if (rank !== 0) return rank
    if (a.daysOfSupply === null || b.daysOfSupply === null) return 0
    return a.daysOfSupply - b.daysOfSupply
  })

  return {
    thresholds,
    items,
    summary: {
      skuCount: items.length,
      totalAvailable: items.reduce((total, item) => total + item.available, 0),
      totalInTransit: items.reduce((total, item) => total + item.inTransit, 0),
      stockoutCount: items.filter((item) => item.risk === 'stockout').length,
      slowMovingCount: items.filter((item) => item.risk === 'slow_moving').length,
      overstockCount: items.filter((item) => item.risk === 'overstock').length,
      insufficientSampleCount: items.filter((item) => item.risk === 'insufficient_sample').length,
      unknownCount: items.filter((item) => item.risk === 'unknown').length,
    },
  }
}

/**
 * 多 ASIN 异常扫描：把"哪个 ASIN 出了问题"变成一张可排序的清单。
 *
 * severity 是各异常项权重的累加，用于排序而不是冒充精确评分：
 *   ACoS 超预警线 +2；转化率低于预警线 +2；ACoS 环比涨幅 >20% +1；
 *   转化率跌幅 >20% +1；花费上涨 >30% 且销售额下滑 +1。
 * 分档：0 = normal；1-3 = medium（有信号，值得看一眼）；≥4 = high（已越警戒线，需处理）。
 * 这样"ACoS 涨了一倍多"这类趋势异常不会被判成 normal。
 */
export function scanAsinAnomalies({ currentByAsin, previousByAsin = new Map(), thresholds = DEFAULT_THRESHOLDS }) {
  const items = []
  for (const [asin, current] of currentByAsin) {
    const previous = previousByAsin.get?.(asin) ?? null
    const comparison = comparePeriods(current, previous)
    const anomalies = judgeAnomalies(current, thresholds)
    const signals = [...anomalies.map((item) => ({ type: 'threshold', ...item }))]
    let severity = anomalies.length * 2

    const acosDeltaPct = comparison.metrics.acos?.deltaPct ?? null
    if (acosDeltaPct !== null && acosDeltaPct > 20) {
      signals.push({ type: 'trend', label: 'ACoS 环比上升', value: acosDeltaPct, threshold: 20, direction: 'above' })
      severity += 1
    }
    const cvrDeltaPct = comparison.metrics.cvr?.deltaPct ?? null
    if (cvrDeltaPct !== null && cvrDeltaPct < -20) {
      signals.push({ type: 'trend', label: '转化率环比下降', value: cvrDeltaPct, threshold: -20, direction: 'below' })
      severity += 1
    }
    const spendDeltaPct = comparison.metrics.spend?.deltaPct ?? null
    const salesDeltaPct = comparison.metrics.sales?.deltaPct ?? null
    if (spendDeltaPct !== null && spendDeltaPct > 30 && salesDeltaPct !== null && salesDeltaPct < 0) {
      signals.push({
        type: 'trend',
        label: '花费上涨但销售额下滑',
        value: spendDeltaPct,
        threshold: 30,
        direction: 'above',
      })
      severity += 1
    }

    items.push({
      asin,
      severity,
      risk: severity >= 4 ? 'high' : severity >= 1 ? 'medium' : 'normal',
      current,
      previous,
      comparison: comparison.metrics,
      signals,
    })
  }

  items.sort((a, b) => b.severity - a.severity || (b.current.spend ?? 0) - (a.current.spend ?? 0))
  return {
    thresholds,
    items,
    summary: {
      asinCount: items.length,
      highCount: items.filter((item) => item.risk === 'high').length,
      mediumCount: items.filter((item) => item.risk === 'medium').length,
      normalCount: items.filter((item) => item.risk === 'normal').length,
    },
  }
}

/** 按指定指标给 ASIN 排名（升序=越小越好，用于"哪个最差"这类问题）。 */
export function rankAsins(currentByAsin, metric, { ascending = true, limit = 10 } = {}) {
  return [...currentByAsin.entries()]
    .map(([asin, summary]) => ({ asin, value: summary[metric] ?? null, summary }))
    .filter((item) => item.value !== null && item.value !== undefined)
    .sort((a, b) => (ascending ? a.value - b.value : b.value - a.value))
    .slice(0, limit)
}

/* ---------- M-D：基于销售报告的销量速度（替代订单快照的短样本） ---------- */

export const DEFAULT_VELOCITY_WINDOW_DAYS = 30

/**
 * 确定销量统计窗口。
 *
 * **锚点是数据自身的最后一天，不是"今天"**：报表本来就是人工导出的滞后数据，
 * 用今天做锚点会得到一个没有数据的空窗口。
 */
export function resolveVelocityWindow(salesRows, windowDays = DEFAULT_VELOCITY_WINDOW_DAYS) {
  const dates = (Array.isArray(salesRows) ? salesRows : [])
    .map((row) => normalizeDate(row?.stat_date))
    .filter(Boolean)
    .sort()
  if (dates.length === 0) return null
  const end = dates.at(-1)
  const days = Math.max(1, Math.min(Number(windowDays) || DEFAULT_VELOCITY_WINDOW_DAYS, 365))
  const startDate = new Date(`${end}T00:00:00Z`)
  startDate.setUTCDate(startDate.getUTCDate() - (days - 1))
  const start = startDate.toISOString().slice(0, 10)
  return { start, end, days, coveredDates: new Set(dates.filter((date) => date >= start && date <= end)) }
}

/**
 * 按 SKU 计算销量速度：SKU →（产品主数据映射）→ ASIN 的销售报告。
 *
 * 与 `computeSalesVelocity`（订单快照）的区别：这是完整销售历史，窗口可指定（默认 30 天），
 * 因此"窗口内无销量 + 有库存"可以作为**可靠的滞销信号**，不再受"样本不足"限制。
 *
 * @param {object} input
 * @param {Array} input.salesRows  amazon_sales_daily 行
 * @param {Map<string, Array<{asin: string, marketplace: string}>>} input.mapping SKU → 渠道列表
 * @param {number} input.windowDays 统计窗口天数
 * @returns {Map<string, {units, days, dailyAverage, sampleStart, sampleEnd, lowConfidence, source, asins, hasCoverage}>}
 */
export function computeSalesVelocityFromSales({ salesRows, mapping, windowDays = DEFAULT_VELOCITY_WINDOW_DAYS }) {
  const result = new Map()
  const window = resolveVelocityWindow(salesRows, windowDays)
  if (!window || !mapping || mapping.size === 0) return result

  const rows = (Array.isArray(salesRows) ? salesRows : []).filter((row) => {
    const date = normalizeDate(row?.stat_date)
    return date && date >= window.start && date <= window.end
  })

  // 按 (asin, marketplace) 聚合，避免同一 ASIN 被多个 SKU 重复计算时相互污染
  const byChannel = new Map()
  for (const row of rows) {
    const key = `${row.asin}::${row.marketplace ?? 'US'}`
    const entry = byChannel.get(key) ?? { units: 0, dates: new Set() }
    entry.units += toNumber(row.units)
    entry.dates.add(normalizeDate(row.stat_date))
    byChannel.set(key, entry)
  }

  for (const [sku, channels] of mapping) {
    const list = Array.isArray(channels) ? channels : []
    let units = 0
    const dates = new Set()
    const asins = []
    for (const channel of list) {
      const key = `${channel.asin}::${channel.marketplace ?? 'US'}`
      const entry = byChannel.get(key)
      asins.push(channel.asin)
      if (!entry) continue
      units += entry.units
      for (const date of entry.dates) dates.add(date)
    }
    const days = dates.size
    if (days === 0) {
      // 窗口内该 SKU 的 ASIN 完全没有销售记录：无法区分"没卖出去"与"报表没覆盖"，
      // 标记 hasCoverage=false 由调用方决定是否回退到其他口径
      result.set(sku, {
        sku,
        units: 0,
        days: 0,
        dailyAverage: null,
        sampleStart: window.start,
        sampleEnd: window.end,
        lowConfidence: true,
        hasCoverage: false,
        source: 'sales_report',
        asins: [...new Set(asins)],
      })
      continue
    }
    result.set(sku, {
      sku,
      units,
      days,
      dailyAverage: round(units / days, 2),
      sampleStart: [...dates].sort()[0],
      sampleEnd: [...dates].sort().at(-1),
      lowConfidence: days < 7,
      hasCoverage: true,
      source: 'sales_report',
      asins: [...new Set(asins)],
    })
  }
  return result
}

/**
 * 合并两种销量口径：优先用销售报告（完整历史），缺失时回退订单快照（短样本，低置信度）。
 * 返回 Map<sku, velocity>，每项带 source 便于回答里如实说明口径。
 */
export function mergeVelocitySources({ salesVelocity, orderVelocity }) {
  const merged = new Map()
  const keys = new Set([...(salesVelocity?.keys?.() ?? []), ...(orderVelocity?.keys?.() ?? [])])
  for (const sku of keys) {
    const fromSales = salesVelocity?.get?.(sku)
    const fromOrders = orderVelocity?.get?.(sku)
    if (fromSales && fromSales.hasCoverage) {
      merged.set(sku, fromSales)
      continue
    }
    if (fromOrders) {
      merged.set(sku, {
        ...fromOrders,
        hasCoverage: true,
        source: 'order_snapshot',
        // 订单快照是近期切片，样本天然偏短
        lowConfidence: true,
      })
      continue
    }
    if (fromSales) merged.set(sku, fromSales)
  }
  return merged
}

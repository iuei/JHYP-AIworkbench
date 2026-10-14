/** 服务端 `combineFreshness` 的合并结果（与竞品分析同一条载荷链路，结构一致）。 */
export interface DataFreshness {
  label: string
  importedAt: string | null
  periodEnd: string | null
  note: string
}

/** 支持的站点（与服务端 `my-asins.mjs` 的 `MY_ASIN_MARKETPLACES` 一一对应）。 */
export const MARKETPLACES = [
  'US',
  'UK',
  'DE',
  'FR',
  'IT',
  'ES',
  'JP',
  'CA',
  'MX',
  'AU',
] as const

export type Marketplace = (typeof MARKETPLACES)[number]

export const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  US: '美国 US',
  UK: '英国 UK',
  DE: '德国 DE',
  FR: '法国 FR',
  IT: '意大利 IT',
  ES: '西班牙 ES',
  JP: '日本 JP',
  CA: '加拿大 CA',
  MX: '墨西哥 MX',
  AU: '澳大利亚 AU',
}

/**
 * 「我的 ASIN」里的一条记录。
 *
 * **站点挂在条目上**（2026-09-18 起没有清单这一层）：同一个 ASIN 在 US 与 DE
 * 是两条独立记录，指标也按各自的站点取数 —— 不同站点货币不同，永远不合算。
 */
export interface MyAsinItem {
  id: number
  asin: string
  marketplace: string
  alias: string | null
  note: string | null
  createdAt: string
  updatedAt: string
}

/**
 * 批量导入结果。
 *
 * 四类分别报告，不能合并成一个数字：`duplicated`（列表里已有同一 ASIN + 站点）、
 * `repeated`（本次输入内部重复）、`invalid`（无法识别）对用户要做的动作完全不同。
 */
export interface ImportOutcome {
  added: Array<{ id: number; asin: string; marketplace: string }>
  duplicated: string[]
  repeated: string[]
  invalid: string[]
  itemCount: number
}

/** 表格导入时对"哪一列是什么"的识别结果（服务端 `watchlist-table.mjs` 判定）。 */
export interface MyAsinTableMapping {
  asin: number | null
  marketplace: number | null
  alias: number | null
  note: number | null
}

/** 表格导入的解析摘要：预览与正式导入共用同一份结构。 */
export interface MyAsinTableImportSummary {
  format: 'csv' | 'xlsx'
  encoding: string | null
  /** 表格里没写站点（或该格为空）时的落点，由用户在预览界面选定。 */
  defaultMarketplace: string
  /** 表头原文（无表头时为空数组）。 */
  columns: string[]
  mapping: MyAsinTableMapping
  headerRow: number | null
  /** 表格里识别到的合法 ASIN 数。 */
  entries: number
  /** 无法识别的行（回表核对用行号）。 */
  invalid: Array<{ line: number; value: string }>
  /** 表格内部重复出现的 `(ASIN, 站点)`。 */
  repeated: Array<{ line: number; asin: string; firstLine: number }>
  /** 列表里已有的 ASIN + 站点。 */
  duplicated: string[]
  /** 将要写入的前 5 条（含站点/别名/备注），用于让用户确认"导进来的确实是这些"。 */
  willAdd: Array<{
    asin: string
    marketplace: string
    alias: string | null
    note: string | null
  }>
  addCount: number
  /** 当前条目数。 */
  itemCount: number
  capacity: number
  overflow: boolean
  overflowBy: number
}

export interface MyAsinTableImportResult {
  dryRun: boolean
  summary: MyAsinTableImportSummary
  added: Array<{ asin: string; marketplace: string }>
  itemCount?: number
}

/* ─────────────── 区间指标（页面数据表的数据源） ─────────────── */

/**
 * 单个 ASIN 在一个统计区间内的指标行。
 *
 * 字段名直接来自服务端 `asinSetPerformancePayload` 的明细行，**不做重命名**：
 * 两个容易混的键必须分清 —— `adSales` 是广告销售额、`businessSales` 是业务报告销售额。
 *
 * 全部指标都可能为 `null`：该 ASIN 在这个区间可能没有广告记录、没有销售记录，
 * 或完全没有数据（此时 `coverage === '无数据'`）。`null` 表示"没有这条数据"，
 * **不是 0**，展示时必须保留这个区别。
 */
export interface MyAsinMetricRow {
  asin: string
  marketplace: string
  alias?: string | null
  /** 广告+销售 / 仅广告 / 仅销售 / 无数据 */
  coverage: string
  risk: string
  severity: number | null
  spend: number | null
  adSales: number | null
  acos: number | null
  acosDelta: number | null
  orders: number | null
  cvr: number | null
  ctr: number | null
  units: number | null
  businessSales: number | null
  signals: string
  /**
   * 这一行的指标里有**人工录入**值（优先于报表），页面据此标「手工」。
   * 服务端在 `applyManualOverrides` 里打标，页面与 AI 工具看到的是同一个标记。
   */
  manual?: boolean
}

/**
 * 人工录入的区间指标（6 个数字）。
 *
 * `null` = 这一项没有人工值（用报表的）；**只有全部为 null 时才是"清除"**。
 * 「数据覆盖」不在这里 —— 它由填了哪几项自动推导。
 */
export interface ManualMetricInput {
  spend: number | null
  adSales: number | null
  orders: number | null
  acos: number | null
  units: number | null
  businessSales: number | null
}

/**
 * 单站点汇总（服务端 `mergeAdAndBusinessSummary` 的结果）。
 *
 * 同样注意 `sales`（广告销售额）与 `businessSales`（销售额）的区别。
 */
export interface MyAsinSummary {
  spend?: number
  sales?: number
  businessSales?: number
  acos?: number | null
  orders?: number
  units?: number
  clicks?: number
  impressions?: number
  ctr?: number | null
  cvr?: number | null
}

/** 一个站点的指标分组。**金额与 ACoS 只在组内，跨站点没有合计**。 */
export interface MyAsinMetricsGroup {
  marketplace: string
  asinCount: number
  covered: number
  uncovered: number
  summary: MyAsinSummary
  rows: MyAsinMetricRow[]
}

export interface MyAsinMetricsPeriod {
  startDate: string
  endDate: string
  days: number
  windowDays: number
  customRange: boolean
}

export interface MyAsinMetricsResult {
  period: MyAsinMetricsPeriod
  groups: MyAsinMetricsGroup[]
  rows: MyAsinMetricRow[]
  /** 与货币无关的计数（条数 / 覆盖数 / 站点）；金额一律看 `groups`。 */
  summary: {
    asinCount: number
    covered: number
    uncovered: number
    marketplaces: string[]
  }
  dataFreshness: DataFreshness | null
}

/**
 * 指标查询条件：预设天数与自定义区间**互斥**（与服务端 `resolveWindow` 同一口径）。
 *
 * 用联合类型而不是"都可选"的对象：后者能表达出"两个都传"这种服务端会拒绝的输入，
 * 把一个非法状态留在类型里，迟早会有人构造出来。
 */
export type MetricsQuery =
  | { windowDays: number }
  | { startDate: string; endDate: string }

/**
 * 表格/卡片的渲染行：条目 + 该条目的指标。
 *
 * `metrics` 为 `null` 有两种情况，展示上都不该当成 0：
 * ① 指标还没拉回来（首次加载 / 切换区间中）；② 服务端没有为该 ASIN 返回行。
 */
export interface MyAsinTableRow extends MyAsinItem {
  metrics: MyAsinMetricRow | null
}

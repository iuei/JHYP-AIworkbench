import type { AnswerBlock } from '@/features/ai-agent/types'

/**
 * 竞品分析的前端类型。
 *
 * 与 `server/competitor-analysis.mjs` 的返回结构一一对应；数字全部由服务端算好，
 * 前端只负责展示，不做任何二次计算（否则同一套数字会出现两种口径）。
 */

export type FindingLevel = 'high' | 'medium' | 'low' | 'info'

/**
 * 结论的来源口径。
 * - `local`：来自本公司导入的报表（广告日报、业务报告、库存快照）——真实经营数据；
 * - `public`：来自卖家精灵第三方公开数据（估算）。
 * 两者**不能混算**，界面上必须分组展示，用户要能一眼看出结论是谁说的。
 */
export type FindingScope = 'local' | 'public'

/**
 * 一条结论的**结构化处置方案**（服务端 `finding-fixes.mjs` 按诊断码生成）。
 *
 * 用户口径（2026-09-17）：「需立即处理没有任何交互，继续处理是处理什么、如何处理、
 * 去哪里处理都没有」。因此 `what` 说清处理对象，`links` 给系统内**真实可达**的入口，
 * `offSystem` 是只能去亚马逊后台或线下做的事（界面标「系统外」）。
 * 老快照没有这个字段 → 前端回退到 `action` 的文字建议。
 */
export interface FindingFix {
  /** 处理什么：一句话说清处置对象（哪个 ASIN / SKU / 类目）。 */
  what: string
  /** 系统内入口：`to` 是站内真实路由；`adminOnly` 的入口对普通员工不渲染。 */
  links: Array<{
    label: string
    to: string
    params?: Record<string, string | number | undefined>
    adminOnly?: boolean
  }>
  /** 系统外步骤（卖家后台 / 广告后台 / 采购），界面会标「系统外」。 */
  offSystem: string[]
}

/**
 * 处置台账状态（与 `server/finding-dispositions.mjs` 的 `DISPOSITION_STATUSES` 一一对应）。
 *
 * - `open`：被打回过（标记过已处理 / 曾核验通过，但本次分析仍命中）；
 * - `claimed`：用户已点「标记已处理」，**待下次分析核验**；
 * - `verified`：下次分析里该结论不再命中 → 系统判定确实解决了；
 * - `ignored`：用户选择「不处理」并填了原因 —— 终局，系统不再自动改动。
 *
 * 没有台账行时 `Finding.disposition` 为 `null`，界面按「待处理」渲染。
 */
export type FindingDispositionStatus = 'open' | 'claimed' | 'verified' | 'ignored'

/** 一条结论的处置状态（服务端 `attachDispositions` 附在每条结论上）。 */
export interface FindingDisposition {
  status: FindingDispositionStatus
  /** 用户填的说明（`ignored` 必填原因）。 */
  note: string | null
  claimedAt: string | null
  verifiedAt: string | null
  /** 被打回的次数（跨多轮标记累计）。 */
  reopenCount: number
  /** 打回时本次仍命中的事实描述，用于"你标记过已处理，但数据仍是这样"。 */
  verifyDetail: string | null
  lastSeenAt: string | null
  updatedAt: string | null
}

/** 一条确定性结论：detail 是事实，action 是建议动作，evidence 是可复算的数字证据。 */
export interface Finding {
  level: FindingLevel
  title: string
  detail: string
  action: string | null
  evidence: string[]
  scope?: FindingScope
  /** 结构化归属；老快照没有时由详情页回退到证据文本匹配。 */
  targetAsins?: string[]
  /** 稳定的诊断码（如 `acos_up` / `stockout_risk`），用于映射处置方案；老快照没有。 */
  code?: string | null
  /** 结构化处置方案；没有时前端只显示 `action` 的文字建议。 */
  fix?: FindingFix | null
  /** 处置目标（服务端派生的稳定标识，当前是 ASIN）；没有它这条结论不可销账。 */
  dispositionTarget?: string | null
  /** 当前处置状态；`null` 表示没有台账行（待处理）。 */
  disposition?: FindingDisposition | null
  /**
   * 老快照（处置功能上线前落库）的**手动销账**标记。
   *
   * `true` 表示这条结论原本没有诊断码，服务端给它派生了记录内位置键 `legacy:<index>` ——
   * 它可以销账（否则首页「需处理的分析」里的历史 high 记录永远无法标记），
   * 但**不参与下次分析的自动核验**（新分析里不可能出现这个键，硬核验会变成假销账）。
   */
  legacy?: boolean
}

/** 可勾选的公开数据维度（与 `server/competitor-public.mjs` 的 `PUBLIC_DIMENSIONS` 对应）。 */
export type PublicDimension = 'public' | 'traffic' | 'reviews'
/** 单个 ASIN 的公开商品属性（缺失一律为 null，界面显示「—」）。 */
export interface PublicProductRow {
  asin: string
  role: 'subject' | 'competitor'
  roleLabel: string
  hasData: boolean
  title: string | null
  brand: string | null
  price: number | null
  rating: number | null
  ratings: number | null
  bsrRank: number | null
  bsrLabel: string | null
  sellers: number | null
  fulfillment: string | null
  lqs: number | null
  nodeLabelPath: string | null
  imageUrl: string | null
  availableDate: string | null
  listedDays: number | null
}

export interface PublicDataError {
  dimension: string
  asin: string | null
  message: string
}

/** 本次分析用到的公开数据（卖家精灵）——含额度消耗与失败降级信息。 */
export interface PublicData {
  dimensions: PublicDimension[]
  dimensionLabels: string[]
  ttlHours: number
  /** 预估调用次数（按勾选维度与 ASIN 数算） */
  estimatedCalls: number
  /** 实际发起的外部调用次数（命中缓存的计入 cacheHits，不消耗额度） */
  calls: number
  cacheHits: number
  errors: PublicDataError[]
  rows: PublicProductRow[]
  /** 在卖家精灵里查到数据的 ASIN 数（其余为未收录） */
  productCount: number
  fetchedAt: string
}

export interface ComparisonRow {
  asin: string
  role: 'subject' | 'competitor'
  roleLabel: string
  hasData: boolean
  emptyReason: string | null
  impressions: number | null
  clicks: number | null
  spend: number | null
  sales: number | null
  orders: number | null
  acos: number | null
  ctr: number | null
  cvr: number | null
  cpc: number | null
  units: number | null
}

export interface ComparisonRank {
  rank: number | null
  total: number
  best: { asin: string; value: number } | null
}

export interface ComparisonSummary {
  enabled: boolean
  subject: ComparisonRow | null
  competitors: ComparisonRow[]
  comparedCount: number
  missingCount: number
  competitorAverages: {
    spend: number | null
    sales: number | null
    acos: number | null
    cvr: number | null
    cpc: number | null
  }
  acosRank: ComparisonRank
  cvrRank: ComparisonRank
}

export interface ComparisonBlock {
  enabled: boolean
  rows: ComparisonRow[]
  summary: ComparisonSummary
  blocks: AnswerBlock[]
  /** 数据口径限制说明（第三方竞品 ASIN 不在报表内就查不到数据）。 */
  note: string
}

export type InventoryRisk =
  | 'stockout'
  | 'overstock'
  | 'slow_moving'
  | 'insufficient_sample'
  | 'unknown'
  | 'healthy'

export interface InventoryItem {
  sku: string
  available: number
  inTransit: number
  reserved: number
  dailySales: number | null
  daysOfSupply: number | null
  risk: InventoryRisk
  suggestedReorder: number
  velocitySource: 'sales_report' | 'order_snapshot' | null
}

export interface InventoryResult {
  mapped: boolean
  asin: string
  marketplace: string
  skus?: string[]
  items: InventoryItem[]
  note: string | null
  velocityWindow?: { start: string; end: string; days: number } | null
}

export interface AsinAvailability {
  asin: string
  marketplaces: { marketplace: string; latest: string }[]
  hasData: boolean
  latest: string | null
  defaultMarketplace: string | null
}

/** 服务端 `combineFreshness` 的合并结果（对象，不是数组）。 */
export interface DataFreshness {
  label: string
  importedAt: string | null
  periodEnd: string | null
  note: string
  datasets?: { dataset: string; label: string; importedAt: string | null; rows: number }[]
}

export interface CompetitorAnalysisResult {
  inputType: 'ASIN'
  inputValue: string
  asin: string
  asins: string[]
  primaryAsin: string
  competitorAsins: string[]
  marketplace: string
  marketplaceSource: 'request' | 'auto' | 'fallback'
  startDate: string
  endDate: string
  windowDays: number
  compareWith: 'previous_period' | 'last_year' | 'none'
  compareLabel: string | null
  customRange: boolean
  empty: boolean
  rowCount: number
  /** 服务端给模型的事实清单（页面不直接展示，保留以便排查）。 */
  summary: string
  headline: string
  findings: Finding[]
  findingLevel: FindingLevel
  comparison: ComparisonBlock
  inventory: InventoryResult
  blocks: AnswerBlock[]
  citations: unknown[]
  dataFreshness: DataFreshness | null
  availability: AsinAvailability[]
  /** 竞品公开数据（卖家精灵第三方数据，与上面所有自家口径的数字分开） */
  publicData?: PublicData
  /** 落库后的记录 id 与时间（来自历史快照时同样存在）。 */
  analysisId?: number
  createdAt?: string
}

export interface HistoryItem {
  id: number
  inputType: string
  inputValue: string
  asins: string[]
  marketplace: string | null
  startDate: string | null
  endDate: string | null
  windowDays: number | null
  compareWith: string | null
  headline: string | null
  level: FindingLevel | null
  findingCount: number
  /**
   * 未销账的问题条数与最高级别（**列表与首页都用这个口径**）。
   *
   * 与 `level` / `findingCount` 的区别：那两个是**那一次分析的快照判定**（历史事实，不会被
   * 后来的销账改写，快照与详情页仍以它为准）；`openLevel` / `openFindingCount` 是
   * **当下还需要处理什么**（扣掉已销账 / 已核验 / 已忽略）。
   *
   * 2026-09-17 修正：**列表的"判定"列也用未销账口径** —— 用户实测反馈
   * 「在分析结果页标记为已处理后历史分析为什么还是展示需立即处理」。
   * 原先列表显示快照判定，销账后仍红字"需立即处理"，使用者会认为标记没生效。
   *
   * 老记录（没有 `finding_keys`，理论上迁移 203 已回填）缺这些字段时前端回退到
   * `level` / `findingCount`。
   */
  openFindingCount?: number
  openLevel?: FindingLevel | null
  /**
   * **已销账的待办条数**（不含 `info` 级）。
   *
   * 列表用它显示「已销账 N 条」—— 让用户看到自己的操作生效了，而不是以为记录被改写。
   */
  clearedFindingCount?: number
  hasSnapshot: boolean
  createdAt: string | null
}

/** 分析表单提交值（由页面转成 `AnalysisParams`）。 */
export interface AnalysisFormValues {
  inputValue: string
  marketplace: string | null
  windowDays: number | null
  startDate: string | null
  endDate: string | null
  compareWith: 'previous_period' | 'last_year' | 'none'
  /** 要一并拉取的竞品公开数据维度（不勾则不消耗卖家精灵额度）。 */
  dimensions: PublicDimension[]
  /** 强制忽略缓存重新拉取公开数据。 */
  refreshPublic?: boolean
}

import type { AnswerBlock } from '@/features/ai-agent/types'
import { isPublicProductTableBlock } from './product-view'
import type {
  AsinAvailability,
  ComparisonRow,
  CompetitorAnalysisResult,
  Finding,
  InventoryResult,
  PublicProductRow,
} from './types'

/**
 * 单个 ASIN（本品或某个竞品）的详情抽取。
 *
 * **数据源只有一个：已经落库的分析快照**（`GET /api/competitor-analyses/:id`）。
 * 为什么不在详情页重新取数：卖家精灵**按调用次数计费**（见 `docs/modules/竞品分析.md` 的额度章节），
 * 只是点开一张卡片就再花两次调用是不可接受的；而且详情页要显示的是"这次分析看到了什么"，
 * 重新取数会让同一批 ASIN 在主页面与详情页出现两套数字。
 *
 * 因此本文件是**纯函数**，只做筛选与整形，不做任何计算：
 * 服务端已经算好的数字（价格、排名、趋势、词频）一律原样搬运，前端不改口径。
 */

export interface AsinDetail {
  asin: string
  role: 'subject' | 'competitor'
  roleLabel: string
  primaryAsin: string
  marketplace: string
  startDate: string
  endDate: string
  windowDays: number
  /** 该 ASIN 的公开商品属性（卖家精灵）。未勾选公开数据维度、或卖家精灵未收录时为 null。 */
  product: PublicProductRow | null
  /** 该 ASIN 在自家报表里的横向对比行（第三方竞品通常没有数据，行仍在但 `hasData` 为 false）。 */
  comparison: ComparisonRow | null
  /** 库存与可售天数：只对本品做（竞品通常不在产品主数据里）。 */
  inventory: InventoryResult | null
  /** 该 ASIN 在各站点的数据可用情况，用于"换个站点可能有数据"的提示。 */
  availability: AsinAvailability | null
  /** 与该 ASIN 相关的公开数据块（已过滤，过滤后为空的块被丢弃）。 */
  blocks: AnswerBlock[]
  /** 证据里点名到该 ASIN 的结论。 */
  findings: Finding[]
}

/** 该 ASIN 是否属于这次分析（本品或任一竞品）。 */
export function hasAsin(
  result: CompetitorAnalysisResult,
  asin: string
): boolean {
  return (result.asins ?? []).some(
    (item) => item.toUpperCase() === asin.toUpperCase()
  )
}

/**
 * 从快照里抽取某个 ASIN 的详情。
 *
 * ASIN 不属于这次分析（手改 URL、把别的分析的 ASIN 拼进来）时返回 null ——
 * 调用方据此显示"这个 ASIN 不在这次分析里"，而不是渲染一页空数据。
 */
export function selectAsinDetail(
  result: CompetitorAnalysisResult,
  asin: string
): AsinDetail | null {
  const normalized = String(asin ?? '')
    .trim()
    .toUpperCase()
  if (!normalized || !hasAsin(result, normalized)) return null

  const primaryAsin = (result.primaryAsin ?? result.asin ?? '').toUpperCase()
  const isSubject = normalized === primaryAsin
  const product =
    (result.publicData?.rows ?? []).find(
      (row) => row.asin.toUpperCase() === normalized
    ) ?? null

  return {
    asin: normalized,
    role: isSubject ? 'subject' : 'competitor',
    roleLabel: isSubject ? '本品' : '竞品',
    primaryAsin,
    marketplace: result.marketplace,
    startDate: result.startDate,
    endDate: result.endDate,
    windowDays: result.windowDays,
    product,
    comparison:
      (result.comparison?.rows ?? []).find(
        (row) => row.asin.toUpperCase() === normalized
      ) ?? null,
    // 库存只对本品做：竞品不在「产品主数据」里，服务端的 inventory 也只算本品
    inventory: isSubject ? (result.inventory ?? null) : null,
    availability:
      (result.availability ?? []).find(
        (item) => item.asin.toUpperCase() === normalized
      ) ?? null,
    blocks: filterBlocksForAsin(result.blocks ?? [], normalized),
    findings: (result.findings ?? []).filter((finding) =>
      findingMentionsAsin(finding, normalized)
    ),
  }
}

/**
 * 把 `blocks` 收敛成"只属于这个 ASIN"的块。
 *
 * 判据全部来自**结构化字段**，不匹配标题文案：
 * - 表格：行里的 `asin` 字段（流量词表、差评高频词表都带）；
 * - 图表：`series[].key` 就是 ASIN（月销量趋势对比图）；
 * - 指标：`items[].key` 形如 `total-<ASIN>` / `natural-<ASIN>` / `avgStar-<ASIN>`。
 *
 * 没有 ASIN 标识的块（自家报表的期间汇总、环比、组内对比图，以及"本品 vs 竞品均值"）
 * 一律不进详情页 —— 它们是**组级**信息，放进单 ASIN 页面会被误读成"这个 ASIN 的数字"。
 */
export function filterBlocksForAsin(
  blocks: AnswerBlock[],
  asin: string
): AnswerBlock[] {
  const result: AnswerBlock[] = []
  for (const block of blocks) {
    const filtered = filterBlockForAsin(block, asin)
    if (filtered) result.push(filtered)
  }
  return result
}

function filterBlockForAsin(
  block: AnswerBlock,
  asin: string
): AnswerBlock | null {
  // 「商品公开数据对比」不在这里出现：详情页顶部的概览卡已经逐项列出了这些属性，
  // 再过滤成一行表格是同一份数据的第二遍渲染（实测确实会重复出现）。
  // 它的行里也带 `asin` 字段，不显式排除就会被下面前两条规则收进来。
  if (isPublicProductTableBlock(block)) return null

  if (block.kind === 'table') {
    const rows = (block.rows ?? []).filter(
      (row) => asinOf(row) === asin.toUpperCase()
    )
    if (rows.length === 0) return null
    return {
      ...block,
      // 整块只剩一个 ASIN 时，这一列不再提供任何信息，去掉它把宽度让给关键词/高频词
      columns: (block.columns ?? []).filter((column) => column.key !== 'asin'),
      rows,
      totalRows: rows.length,
      truncated: false,
    }
  }

  if (block.kind === 'chart') {
    const series = (block.series ?? []).filter(
      (item) => item.key.toUpperCase() === asin.toUpperCase()
    )
    if (series.length === 0) return null
    const xKey = block.xKey ?? 'month'
    // 用 series 里**实际的** key 取数：它可能与传入的 asin 大小写不同，
    // 若这里换成传入值当键，图表会整条画不出来（recharts 按 series.key 找列）。
    const seriesKey = series[0].key
    return {
      ...block,
      series: series.map((item) => ({ ...item, label: `${asin}（本次分析）` })),
      data: (block.data ?? []).map((row) => ({
        [xKey]: row[xKey],
        [seriesKey]: row[seriesKey],
      })),
    }
  }

  if (block.kind === 'metrics') {
    const suffix = `-${asin.toUpperCase()}`
    const items = (block.items ?? []).filter((item) =>
      (item.key ?? '').toUpperCase().endsWith(suffix)
    )
    if (items.length === 0) return null
    return { ...block, items }
  }

  return null
}

/** 行/序列里承载 ASIN 的字段名（服务端统一用 `asin`）。 */
function asinOf(row: Record<string, unknown>): string {
  return String(row?.asin ?? '').toUpperCase()
}

const REGEXP_ESCAPE = /[.*+?^${}()|[\]\\]/g

/**
 * 结论是否点名了这个 ASIN。
 *
 * 结论本身**没有** ASIN 字段（服务端按"组"产出结论，个别结论只针对某一个 ASIN），
 * 所以这里按证据文本做词边界匹配 —— 词边界不可省：`B0ABCDEFGH` 会被 `B0ABCDEFGHI` 误命中。
 * 命中不了的结论不进详情页（宁可少显示，也不把组级结论摊给单个 ASIN 冒领）。
 */
function findingMentionsAsin(finding: Finding, asin: string): boolean {
  if (Array.isArray(finding.targetAsins)) {
    return finding.targetAsins.some(
      (target) => target.toUpperCase() === asin.toUpperCase()
    )
  }
  const pattern = new RegExp(
    `\\b${asin.replace(REGEXP_ESCAPE, '\\$&')}\\b`,
    'i'
  )
  const texts = [
    finding.title,
    finding.detail,
    finding.action ?? '',
    ...(finding.evidence ?? []),
  ]
  return texts.some((text) => pattern.test(String(text ?? '')))
}

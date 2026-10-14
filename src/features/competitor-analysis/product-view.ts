import type { AnswerBlock } from '@/features/ai-agent/types'
import type { ComparisonRow, PublicProductRow } from './types'

/**
 * 「商品公开数据对比」块在 `blocks` 里的**结构化识别**。
 *
 * 背景（2026-09-16）：这一块此前只由 `AnswerBlocks` 渲染成一张表，商品主图（服务端早已返回
 * `imageUrl`）没有任何露出，也无法点进单个竞品。现在它被摘出来，交给
 * 「卡片（默认，可点进竞品详情页）/ 表格」两种视图渲染 —— 摘出来就必须先能**认出**它。
 *
 * 两条判据，缺一不可：
 * 1. `dataset === PRODUCT_TABLE_DATASET`（服务端 `buildPublicProductBlock` 打的数据源标记）；
 * 2. 兜底：列键与服务端 `PUBLIC_COLUMNS` 完全一致 —— **2026-09-16 之前落库的历史快照没有
 *    `dataset` 字段**，只认标记会让老记录在卡片视图下丢掉整张表。
 *
 * 刻意不用 `title` 匹配：标题是给人看的文案，改一个字就会让识别静默失效，
 * 而失效的表现是"表格不见了"，排查成本极高。
 */
export const PRODUCT_TABLE_DATASET = 'sellersprite_products'

/** 与服务端 `server/sellersprite-blocks.mjs` 的 `PUBLIC_COLUMNS` 顺序、键名逐项对应。 */
export const PUBLIC_PRODUCT_COLUMN_KEYS = [
  'roleLabel',
  'asin',
  'brand',
  'price',
  'rating',
  'ratings',
  'bsrRank',
  'sellers',
  'fulfillment',
  'availableDate',
] as const

export function isPublicProductTableBlock(block: AnswerBlock): boolean {
  if (block.kind !== 'table') return false
  if (block.dataset === PRODUCT_TABLE_DATASET) return true
  const keys = block.columns?.map((column) => column.key)
  if (!keys || keys.length !== PUBLIC_PRODUCT_COLUMN_KEYS.length) return false
  return keys.every((key, index) => key === PUBLIC_PRODUCT_COLUMN_KEYS[index])
}

export type SplitPublicProductBlocks = {
  /** 商品公开数据对比块之前的块（原顺序不变）。 */
  before: AnswerBlock[]
  /** 商品公开数据对比块本身；没有该块时为 null（例如本次分析没勾选公开数据维度）。 */
  product: AnswerBlock | null
  /** 该块之后的块（原顺序不变）。 */
  after: AnswerBlock[]
}

/**
 * 把 `blocks` 在商品公开数据对比块处切成三段。
 *
 * 只切**第一处**：同名块在一次分析里只会出现一次，出现第二次说明上游结构变了 ——
 * 那时把它留在 `after` 里照常渲染，好过悄悄吞掉一块数据。
 */
export function splitPublicProductBlocks(
  blocks: AnswerBlock[]
): SplitPublicProductBlocks {
  const index = blocks.findIndex(isPublicProductTableBlock)
  if (index < 0) return { before: blocks, product: null, after: [] }
  return {
    before: blocks.slice(0, index),
    product: blocks[index],
    after: blocks.slice(index + 1),
  }
}

/**
 * 把商品公开数据表**转置**成「一行一个属性、一列一个 ASIN」，与「ASIN 横向对比」同一读法。
 *
 * 用户口径（2026-09-17）：「竞品和本品的对比都参考按日对比（本品 VS 竞品）排版方式」——
 * 「按日对比」是"每个 ASIN 一组列 + 一组一个颜色"，本表原本是"一行一个 ASIN、属性横铺"，
 * 与「ASIN 横向对比」一样没法逐属性并排看本品与竞品，因此做同样的展示层重排：
 * 转置后 `价格 / 评分 / BSR…` 每个属性独占一行，本品与竞品的值**紧挨着**，
 * 并由列上的 `tone` 给出与「按日对比」一致的归属配色（本品 = `chart-1`、竞品依次 `chart-2…`）。
 *
 * 与 `comparison-table.ts` 的转置同纪律：**只重排、一个数字都不算**（缺失一律 `null` 交给渲染层显示「—」），
 * 因此对已落库的历史快照立刻生效。认不出来就原样返回，不做部分转置。
 */
export function transposeProductTable(block: AnswerBlock): AnswerBlock {
  const columns = block.columns ?? []
  const rows = block.rows ?? []
  if (!isPublicProductTableBlock(block) || rows.length === 0) return block

  const metricColumns = columns.filter(
    (column) => column.key !== 'asin' && column.key !== 'roleLabel'
  )
  const series = rows
    .map((row) => {
      const asin = String(row.asin ?? '').trim()
      const role = String(row.roleLabel ?? '').trim()
      return { key: asin, label: role ? `${asin}（${role}）` : asin, row }
    })
    .filter((item) => item.key.length > 0)

  if (metricColumns.length === 0 || series.length === 0) return block

  return {
    ...block,
    columns: [
      { key: 'metric', label: '属性' },
      ...series.map((item, index) => ({
        key: item.key,
        label: item.label,
        tone: (index % 5) + 1,
      })),
    ],
    rows: metricColumns.map((metric) => {
      const line: Record<string, unknown> = { metric: metric.label }
      for (const item of series) {
        // 卖家精灵缺失的字段一律保持 null，「—」由渲染层负责（绝不在前端折算成 0）
        line[item.key] = item.row[metric.key] ?? null
      }
      return line
    }),
    totalRows: metricColumns.length,
    truncated: false,
  }
}

/** 一张卡片所需要的数据。 */
export interface ProductViewItem {
  asin: string
  role: 'subject' | 'competitor'
  roleLabel: string
  /** 卖家精灵公开属性；未收录或本次没取公开数据时为 null。 */
  product: PublicProductRow | null
  /** 该 ASIN 在自家报表里的行；第三方竞品通常 `hasData` 为 false。 */
  comparison: ComparisonRow | null
}

/**
 * 把本次分析的 ASIN 全集合整成卡片数据。
 *
 * **以 `asins` 为全集**，不是以 `publicData.rows` 为全集：卖家精灵会漏收录（实测 `B08N5WRWNW`
 * 的价格/BSR/评分全为 null），漏收录不等于"这个 ASIN 不参与本次分析" —— 卡片照样要出现，
 * 只是图与属性显示「未收录」，点进去还能看到自家报表那一侧的数据。
 */
export function buildProductViewItems({
  asins,
  primaryAsin,
  rows,
  comparisonRows,
}: {
  asins: string[]
  primaryAsin: string
  rows: PublicProductRow[]
  comparisonRows: ComparisonRow[]
}): ProductViewItem[] {
  const primary = String(primaryAsin ?? '').toUpperCase()
  return asins.map((asin) => {
    const upper = asin.toUpperCase()
    return {
      asin,
      role: upper === primary ? 'subject' : 'competitor',
      roleLabel: upper === primary ? '本品' : '竞品',
      product:
        rows.find((row) => row.asin.toUpperCase() === upper) ?? null,
      comparison:
        comparisonRows.find((row) => row.asin.toUpperCase() === upper) ?? null,
    }
  })
}

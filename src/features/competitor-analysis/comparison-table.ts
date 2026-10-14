import type { AnswerBlock } from '@/features/ai-agent/types'

/**
 * 把「ASIN 横向对比」表**转置**：一行一个指标，一列一个 ASIN。
 *
 * 用户口径（2026-09-16）：「数据明细内的本品竞品的数据对比…对比起来不方便，我需要一一对应本品跟竞品」。
 * 服务端给的表是**一行一个 ASIN、指标横铺**（`COMPARISON_COLUMNS`：ASIN / 角色 / 广告花费 / 广告销售额 /
 * ACoS / 点击 / 转化率 / CPC / 广告订单 / 销量）—— 要比"本品与竞品的花费差多少"得左右来回扫两行，
 * 中间隔着 8 个单元格。转置后每个指标独占一行，本品与竞品的值**紧挨着**，一眼可比。
 *
 * **为什么放在前端做**：这只是**展示层重排，一个数字都不算**（本文件不做任何加减乘除），
 * 而且能立刻对**已落库的历史快照**生效 —— 若改服务端生成逻辑，只有新分析是新形态，
 * 用户当前正在看的那条记录仍是旧样子，两种形态并存反而更难理解。
 */

/** 与服务端 `server/competitor-analysis.mjs` 的 `COMPARISON_COLUMNS` 逐项对应（顺序、键名一致）。 */
export const COMPARISON_COLUMN_KEYS = [
  'asin',
  'roleLabel',
  'spend',
  'sales',
  'acos',
  'clicks',
  'cvr',
  'cpc',
  'orders',
  'units',
] as const

/** 该表块的数据源标记（服务端 `buildComparisonBlocks` 打的）。 */
export const COMPARISON_TABLE_DATASET = 'amazon_ads_daily'

/**
 * 认出「ASIN 横向对比」块。
 *
 * 两条判据：`dataset` 标记优先；**列键与 `COMPARISON_COLUMNS` 逐项一致**兜底 ——
 * 2026-09-16 之前落库的历史快照里，数据源标记在部分块上并不存在（商品表就实测过）。
 * 用列结构而不是标题文案：标题是给人看的，改一个字识别就静默失效。
 *
 * 注意判据要够严：AI 助手的回答里也有 `dataset: 'amazon_ads_daily'` 的表（期间汇总等），
 * 靠"列键逐项一致"才不会误伤它们（本模块只在竞品明细页调用，天然也只作用于本页）。
 */
export function isComparisonTableBlock(block: AnswerBlock): boolean {
  if (block.kind !== 'table') return false
  const keys = block.columns?.map((column) => column.key)
  if (!keys || keys.length !== COMPARISON_COLUMN_KEYS.length) return false
  return keys.every((key, index) => key === COMPARISON_COLUMN_KEYS[index])
}

/**
 * 转置该表：列变成 `指标 | <本品 ASIN>（本品） | <竞品 ASIN>（竞品）…`，行变成各指标。
 *
 * 认不出来就**原样返回**（不做部分转置）：宁可保持服务端形态，也不要让半张表错位。
 */
export function transposeComparisonTable(block: AnswerBlock): AnswerBlock {
  const columns = block.columns ?? []
  const rows = block.rows ?? []
  if (!isComparisonTableBlock(block) || rows.length === 0) return block

  const metricColumns = columns.filter(
    (column) => column.key !== 'asin' && column.key !== 'roleLabel'
  )

  // 每个 ASIN 一列：key 用 ASIN（唯一），表头带角色，读表时不必再回头找"哪个是本品"
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
      { key: 'metric', label: '指标' },
      ...series.map((item, index) => ({
        key: item.key,
        label: item.label,
        align: 'right' as const,
        /*
         * 每个 ASIN 一档主题分类色（本品 = `chart-1`、竞品依次 `chart-2…`，越界回落到无色）。
         * 用户口径（2026-09-17）：「竞品和本品的对比都参考按日对比（本品 VS 竞品）排版方式」——
         * 「按日对比」靠"一组列一个颜色"区分归属，这里沿用同一套档位约定：
         * 渲染层（`answer-blocks.tsx`）只把 `tone` 映射成静态类名，不改任何数字。
         */
        tone: (index % 5) + 1,
      })),
    ],
    rows: metricColumns.map((metric) => {
      const line: Record<string, unknown> = { metric: metric.label }
      for (const item of series) {
        // 缺失一律给 null，由渲染层显示「—」（绝不在前端折算成 0）
        line[item.key] = item.row[metric.key] ?? null
      }
      return line
    }),
    totalRows: metricColumns.length,
    truncated: false,
  }
}

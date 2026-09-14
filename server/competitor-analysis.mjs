/**
 * 竞品分析：把单个 ASIN 的真实广告与销售表现算出来。
 *
 * 设计约束（为什么这样写）：
 * 1. 数字全部来自 SQL 与 `analytics.mjs` 的确定性计算 —— 直接复用 AI 助手
 *    `query_amazon_performance` 工具的同一条载荷链路（`amazonPerformancePayload`），
 *    不再返回与输入无关的固定结论。历史实现无论输入什么都返回同一组
 *    「portable blender / 电池续航不足」之类的写死文案，属于用假数据掩盖未实现功能。
 * 2. **只支持 ASIN 维度**：现有四个数据集（广告日报、业务报告、库存快照、产品主数据）里
 *    没有品牌、店铺、关键词、评论与图片字段。这些维度的结论没有数据源，因此这里
 *    对不支持的输入明确报错，而不是编一份看起来专业的分析给用户做决策。
 * 3. 站点与统计区间由服务端按「该 ASIN 实际有数据的站点与最新日期」推导，
 *    否则用户不选站点、区间取默认值时会永远查不到数据。
 */
import { query } from './db.mjs'
import { amazonPerformancePayload } from './ai-agent/data-queries.mjs'

/** 输入不合法（返回 400 而不是 500）。 */
export class CompetitorInputError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CompetitorInputError'
  }
}

/**
 * 支持的输入维度。
 * 品牌名 / 店铺链接当前没有对应数据源（需要 Amazon 品牌分析或 SP-API），不在此列。
 */
export const SUPPORTED_INPUT_TYPES = ['ASIN']

/** 分析窗口：以该 ASIN 最新数据日期为终点，向前取的默认天数。 */
export const DEFAULT_WINDOW_DAYS = 30

const ASIN_LENGTH = 10

/**
 * 从输入中识别 ASIN。
 *
 * 支持两种写法：直接输入的 10 位 ASIN，以及粘贴的亚马逊商品链接（`/dp/`、`/d/`、`/gp/product/`）。
 * 不做「任意 10 位字母数字片段」的模糊提取 —— 那会把链接里的无关片段当成 ASIN，
 * 反而制造出更难排查的错数据。
 */
export function extractAsin(raw) {
  const text = String(raw ?? '')
    .trim()
    .toUpperCase()
  if (!text) return null

  const fromUrl = text.match(/\/(?:DP|D|GP\/PRODUCT)\/([A-Z0-9]{10})/)
  if (fromUrl) return fromUrl[1]

  return new RegExp(`^[A-Z0-9]{${ASIN_LENGTH}}$`).test(text) ? text : null
}

/** 校验并归一化请求体，不合法时抛 `CompetitorInputError`。 */
export function parseCompetitorInput(body) {
  const inputType = String(body?.inputType ?? '')
    .trim()
    .toUpperCase()
  const inputValue = String(body?.inputValue ?? '').trim()

  if (!inputType) throw new CompetitorInputError('请选择分析维度。')
  if (!SUPPORTED_INPUT_TYPES.includes(inputType)) {
    throw new CompetitorInputError(
      `当前数据源只支持按 ASIN 分析，「${inputType}」维度需要接入 Amazon 品牌分析或 SP-API，尚未接入。`
    )
  }
  if (!inputValue) throw new CompetitorInputError('请输入要分析的 ASIN。')
  // competitor_analyses.input_value 是 VARCHAR(200)：先校验长度，避免数据库报 22001 变成 500。
  if (inputValue.length > 200) throw new CompetitorInputError('输入内容过长（最多 200 个字符）。')

  const asin = extractAsin(inputValue)
  if (!asin) {
    throw new CompetitorInputError(
      '没有识别出有效的 ASIN。请输入 10 位 ASIN（例如 B0XXXXXXXX），或粘贴亚马逊商品链接。'
    )
  }

  return { inputType: 'ASIN', asin }
}

/** 纯 UTC 日期位移，避免本地时区把日期推来推去。 */
export function shiftDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return isoDate
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const TARGET_SQL = `
  SELECT marketplace, MAX(stat_date)::text AS latest
    FROM (
      SELECT marketplace, stat_date FROM amazon_ads_daily WHERE asin = $1
      UNION ALL
      SELECT marketplace, stat_date FROM amazon_sales_daily WHERE asin = $1
    ) AS t
   GROUP BY marketplace
   ORDER BY latest DESC, marketplace ASC
   LIMIT 1`

/**
 * 找到该 ASIN 实际有数据的站点与最新数据日期。
 *
 * 日期刻意用 `::text` 取回：pg 会把 DATE 列转成本地时区午夜的 Date 对象，
 * 再经 `toISOString()` 会整体前移一天（东八区必现）。这里直接要字符串，绕开该链路。
 * 没有任何数据时回退到「US + 最近 30 天」，由载荷层给出「请先导入报表」的明确提示。
 */
export async function resolveAnalysisTarget(asin) {
  const { rows } = await query(TARGET_SQL, [asin])
  const hit = rows[0]
  const endDate = hit?.latest ?? new Date().toISOString().slice(0, 10)

  return {
    marketplace: hit?.marketplace ?? 'US',
    endDate,
    startDate: shiftDays(endDate, -(DEFAULT_WINDOW_DAYS - 1)),
    hasData: Boolean(hit),
  }
}

/**
 * 执行一次竞品分析。
 *
 * 返回结构直接沿用工具载荷（blocks / citations / dataFreshness），
 * 前端复用 AI 助手的 `AnswerBlocks` 渲染，避免同一套数字出现两种展示口径。
 */
export async function analyzeCompetitor(input) {
  const { inputType, asin } = parseCompetitorInput(input)
  const target = await resolveAnalysisTarget(asin)

  const payload = await amazonPerformancePayload({
    asin,
    marketplace: target.marketplace,
    startDate: target.startDate,
    endDate: target.endDate,
    compareWith: 'previous_period',
  })

  return {
    inputType,
    inputValue: asin,
    asin,
    marketplace: target.marketplace,
    startDate: target.startDate,
    endDate: target.endDate,
    windowDays: DEFAULT_WINDOW_DAYS,
    empty: Boolean(payload.empty),
    rowCount: payload.rowCount ?? 0,
    summary: payload.summary ?? '',
    blocks: payload.blocks ?? [],
    citations: payload.citations ?? [],
    // 注意：这是 `combineFreshness` 的**对象**结构（含 datasets / periodEnd / note），不是数组。
    dataFreshness: payload.dataFreshness ?? null,
  }
}

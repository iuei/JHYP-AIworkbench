/**
 * 「在对话里调取竞品分析记录」—— AI 工具 `query_competitor_analysis` 的载荷层。
 *
 * 用户口径（2026-09-17）：「添加功能 竞品分析记录跟 AI 会话时也可以调取」。
 * 经选项确认两条口径：
 * 1. **返回「结论 + 关键数据块」** —— 横向对比表与商品公开数据表进 `blocks`（前端渲染给用户看）；
 *    图表 / 流量词 / 评论痛点等大块**不进**，只在 `summary` 里给文字要点；
 * 2. **只读历史记录，绝不在对话里触发新的分析** —— 卖家精灵按调用次数计费，
 *    对话顺手触发一次全维度分析会真实花钱，所以这个工具**没有任何"重新分析"的路径**。
 *
 * 数据来源是 `competitor_analyses.result` 快照 —— 页面「分析结果」读的同一份，
 * 因此对话里看到的数字与页面完全一致（不会因为今天的数据变了而对不上）。
 * 记录归属由 `competitor-analysis.mjs` 的读取函数在 SQL 里按 `user_id` 过滤（越权当不存在）。
 *
 * ⚠️ **模型只看到 `summary` / `rows` / `analysis`**（`orchestrator.mjs` 把 `blocks` 压成
 * `viewSummary`，只告诉模型"有哪些块"，避免块里的表格重复占用上下文）。
 * 因此凡是希望模型能说出口的数字，都必须进 `summary` 或 `rows` —— 只塞进 `blocks` 里模型看不到。
 */
import {
  getCompetitorAnalysis,
  listCompetitorAnalyses,
  toHistoryItem,
} from '../competitor-analysis.mjs'
import { buildTableBlock } from './data-queries.mjs'

/** 一次回答里最多列几条记录（`listCompetitorAnalyses` 自身上限 50）。 */
const MAX_LIST = 20
const DEFAULT_LIST = 5
/** 按 ASIN 定位时向前翻多少条摘要：最近一次分析未必包含这个 ASIN（与详情页回落同一做法）。 */
const LOOKBACK = 50
/** 关键块的渲染行数上限（前端渲染 + 模型都不需要一百行）。 */
const KEY_BLOCK_ROWS = 20

const LEVEL_LABELS = {
  high: '需立即处理',
  medium: '需关注',
  low: '低风险',
  info: '提示',
}
/** 与服务端 `FINDING_WEIGHTS` / 前端 `findings-panel.tsx` 同一套严重度语义，只用于展示排序。 */
const LEVEL_WEIGHT = { high: 3, medium: 2, low: 1, info: 0 }

/** 「ASIN 横向对比」的列键（与 `comparison-table.ts` 的 `COMPARISON_COLUMN_KEYS` 同口径）。 */
const COMPARISON_KEYS = [
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
]
/** 「商品公开数据对比（卖家精灵）」的列键（与 `product-view.ts` 同口径）。 */
const PRODUCT_KEYS = [
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
]

function keysOf(block) {
  return (block?.columns ?? []).map((column) => column.key)
}

function sameKeys(keys, expected) {
  return (
    Array.isArray(keys) &&
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index])
  )
}

/** 识别「ASIN 横向对比」块：`dataset` 标记优先，列键兜底（历史快照可能没有标记）。 */
function isComparisonBlock(block) {
  if (block?.kind !== 'table') return false
  if (block.dataset === 'amazon_ads_daily' && sameKeys(keysOf(block), COMPARISON_KEYS)) {
    return true
  }
  return sameKeys(keysOf(block), COMPARISON_KEYS)
}

/** 识别「商品公开数据对比」块（列键判据，不认标题文案）。 */
function isProductBlock(block) {
  if (block?.kind !== 'table') return false
  return (
    block.dataset === 'sellersprite_products' ||
    sameKeys(keysOf(block), PRODUCT_KEYS)
  )
}

function asinsOf(row) {
  const list = Array.isArray(row?.asins) ? row.asins : []
  return list.map((item) => String(item ?? '').trim().toUpperCase()).filter(Boolean)
}

function text(value) {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed.length > 0 ? trimmed : null
}

function numberText(value, suffix = '') {
  if (value === null || value === undefined || value === '') return '—'
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return `${value}${suffix}`
  return `${numeric}${suffix}`
}

/** 结论 → 给模型看的扁平行（`rows`）。 */
export function findingsRows(findings = []) {
  return [...(findings ?? [])]
    .map((finding, index) => ({ finding, index }))
    .sort(
      (left, right) =>
        (LEVEL_WEIGHT[right.finding?.level] ?? 0) -
          (LEVEL_WEIGHT[left.finding?.level] ?? 0) || left.index - right.index
    )
    .map(({ finding }) => ({
      level: finding?.level ?? 'info',
      levelLabel: LEVEL_LABELS[finding?.level] ?? String(finding?.level ?? '提示'),
      scope: finding?.scope === 'public' ? '卖家精灵公开数据' : '自家经营数据',
      title: text(finding?.title) ?? '',
      detail: text(finding?.detail) ?? '',
      action: text(finding?.action) ?? '',
      evidenceCount: Array.isArray(finding?.evidence) ? finding.evidence.length : 0,
    }))
}

/** 结论 → 表格块（用户在对话里直接看得到的一张表）。 */
export function findingsTableBlock(findings = []) {
  const rows = findingsRows(findings)
  if (rows.length === 0) return null
  return buildTableBlock({
    title: `结论与建议（${rows.length} 条，按严重度排序）`,
    columns: [
      { key: 'levelLabel', label: '判定' },
      { key: 'scope', label: '来源' },
      { key: 'title', label: '结论' },
      { key: 'detail', label: '事实' },
      { key: 'action', label: '建议动作' },
    ],
    rows,
    maxRows: 40,
    note: '结论由服务端按预警线与数据规则算出，与「分析结果」页展示的完全一致。',
  })
}

/** 关键指标行（本品 vs 竞品，来自自家报表的「ASIN 横向对比」块）。 */
export function comparisonMetricRows(blocks = []) {
  const block = (blocks ?? []).find(isComparisonBlock)
  if (!block) return []
  return (block.rows ?? []).map((row) => ({
    asin: text(row?.asin) ?? '',
    role: text(row?.roleLabel) ?? '',
    spend: row?.spend ?? null,
    sales: row?.sales ?? null,
    acos: row?.acos ?? null,
    cvr: row?.cvr ?? null,
    clicks: row?.clicks ?? null,
    orders: row?.orders ?? null,
    units: row?.units ?? null,
  }))
}

/** 公开属性行（卖家精灵第三方估算数据）。 */
export function publicMetricRows(blocks = []) {
  const block = (blocks ?? []).find(isProductBlock)
  if (!block) return []
  return (block.rows ?? []).map((row) => ({
    asin: text(row?.asin) ?? '',
    role: text(row?.roleLabel) ?? '',
    brand: text(row?.brand) ?? null,
    price: row?.price ?? null,
    rating: row?.rating ?? null,
    ratings: row?.ratings ?? null,
    bsrRank: row?.bsrRank ?? null,
    sellers: row?.sellers ?? null,
  }))
}

/**
 * 进 `blocks` 的块：**结论表 + 横向对比表 + 商品公开数据表**，其余（图表 / 流量词 / 评论痛点）
 * 一律不进 —— 它们在页面上本来就是"长块"，塞进回答既撑爆渲染也挤占上下文，
 * 需要看的时候回「分析结果」页。
 */
export function pickKeyBlocks(snapshotBlocks = [], findings = []) {
  const blocks = []
  const findingsBlock = findingsTableBlock(findings)
  if (findingsBlock) blocks.push(findingsBlock)
  for (const block of snapshotBlocks ?? []) {
    if (isComparisonBlock(block) || isProductBlock(block)) {
      blocks.push({ ...block, rows: (block.rows ?? []).slice(0, KEY_BLOCK_ROWS) })
    }
  }
  return blocks
}

function periodLine(record) {
  const days = record.window_days ? `${record.window_days} 天` : '区间未知'
  const range =
    record.start_date && record.end_date
      ? `${record.start_date} ~ ${record.end_date}`
      : '区间未记录'
  const compare =
    record.compare_with === 'last_year'
      ? '同比去年同期'
      : record.compare_with === 'none'
        ? '不做对比'
        : '环比（上一等长区间）'
  return `${record.marketplace ?? '站点未知'} 站 · ${range}（${days}）· ${compare}`
}

function asinLine(record) {
  const list = Array.isArray(record.asins) ? record.asins : []
  if (list.length > 0) return list.join('、')
  return text(record.input_value) ?? '未记录 ASIN'
}

/** 单条记录的摘要（给模型组织回答用；凡是希望模型说出口的数字都要写在这里）。 */
export function buildRecordSummary({ record, snapshot }) {
  const findings = findingsRows(snapshot?.findings ?? [])
  const comparison = comparisonMetricRows(snapshot?.blocks ?? [])
  const products = publicMetricRows(snapshot?.blocks ?? [])
  const lines = []

  lines.push(
    `竞品分析记录 #${record.id} · ${asinLine(record)} · ${periodLine(record)}`
  )
  lines.push(
    `落库时间 ${record.created_at ? new Date(record.created_at).toISOString() : '未知'} —— ` +
      '**这是当时保存的结果快照：本次调取不重新取数、不调用卖家精灵、不消耗任何额度**，数字与「竞品分析 → 分析结果」页完全一致。'
  )
  if (snapshot?.headline) lines.push(`一句话结论：${snapshot.headline}`)
  lines.push(
    `判定：${LEVEL_LABELS[record.level] ?? text(record.level) ?? '未记录'} · 结论 ${findings.length} 条`
  )

  if (comparison.length > 0) {
    lines.push('关键指标（自家报表：广告日报 / 业务报告）：')
    for (const row of comparison) {
      lines.push(
        `- ${row.asin}${row.role ? `（${row.role}）` : ''}：` +
          `广告花费 ${numberText(row.spend)}、广告销售额 ${numberText(row.sales)}、` +
          `ACoS ${numberText(row.acos, '%')}、转化率 ${numberText(row.cvr, '%')}、` +
          `点击 ${numberText(row.clicks)}、广告订单 ${numberText(row.orders)}、销量 ${numberText(row.units)}`
      )
    }
  }
  if (products.length > 0) {
    lines.push('公开属性（卖家精灵第三方估算，**与上面那组口径不同、请勿相加**）：')
    for (const row of products) {
      lines.push(
        `- ${row.asin}${row.role ? `（${row.role}）` : ''}：` +
          `品牌 ${row.brand ?? '—'}、价格 ${numberText(row.price)}、评分 ${numberText(row.rating)}、` +
          `评分数 ${numberText(row.ratings)}、BSR ${numberText(row.bsrRank)}、卖家数 ${numberText(row.sellers)}`
      )
    }
  }

  if (findings.length > 0) {
    lines.push('结论明细（可直接引用，不要改写数字）：')
    findings.forEach((row, index) => {
      lines.push(
        `${index + 1}. [${row.levelLabel}｜${row.scope}] ${row.title}` +
          `${row.detail ? ` —— ${row.detail}` : ''}` +
          `${row.action ? ` 建议：${row.action}` : ''}` +
          `${row.evidenceCount > 0 ? `（依据 ${row.evidenceCount} 条）` : ''}`
      )
    })
  }

  if (!snapshot) {
    lines.push(
      '⚠️ 这条记录没有保存结果快照（早期记录可能如此），因此只有参数与头部信息，' +
        '需要完整结论请重新分析一次（那会消耗卖家精灵额度，需用户在页面上确认）。'
    )
  }
  return lines.join('\n')
}

/** 列表摘要（用户没指定具体哪一次时）。 */
export function buildListSummary(items) {
  const lines = ['最近的竞品分析记录（按时间倒序）：']
  items.forEach((item, index) => {
    lines.push(
      `${index + 1}. #${item.id} · ${item.asins.join('、') || '未记录 ASIN'} · ` +
        `${item.marketplace ?? '站点未知'} 站 · ` +
        `${item.startDate ?? '?'} ~ ${item.endDate ?? '?'}（${item.windowDays ?? '?'} 天）· ` +
        `判定 ${LEVEL_LABELS[item.level] ?? '未记录'} · 结论 ${item.findingCount} 条` +
        `${item.createdAt ? ` · ${new Date(item.createdAt).toISOString()}` : ''}` +
        `${item.hasSnapshot ? '' : '（无快照）'}`
    )
    if (item.headline) lines.push(`   头条：${item.headline}`)
  })
  lines.push(
    '要看某一次的完整结论与数字，请告诉我记录号（例如 #78）或 ASIN；' +
      `当前共 ${items.length} 条，可列出最近 ${MAX_LIST} 条。`
  )
  return lines.join('\n')
}

function listBlock(items) {
  if (items.length === 0) return []
  return [
    buildTableBlock({
      title: `最近的竞品分析记录（${items.length} 条）`,
      columns: [
        { key: 'id', label: '记录', align: 'right' },
        { key: 'asins', label: 'ASIN' },
        { key: 'marketplace', label: '站点' },
        { key: 'range', label: '统计区间' },
        { key: 'levelLabel', label: '判定' },
        { key: 'findingCount', label: '结论数', align: 'right' },
        { key: 'headline', label: '一句话结论' },
        { key: 'createdAt', label: '分析时间' },
      ],
      rows: items.map((item) => ({
        id: `#${item.id}`,
        asins: item.asins.join('、') || '—',
        marketplace: item.marketplace ?? '—',
        range: `${item.startDate ?? '—'} ~ ${item.endDate ?? '—'}（${item.windowDays ?? '—'} 天）`,
        levelLabel: LEVEL_LABELS[item.level] ?? '—',
        findingCount: item.findingCount ?? 0,
        headline: item.headline ?? '—',
        createdAt: item.createdAt
          ? new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })
          : '—',
      })),
      maxRows: MAX_LIST,
      note: '点「分析结果」页可以看每次分析的全部数据明细。',
    }),
  ]
}

/** 统一的降级载荷：说清楚"为什么没有"，并给出下一步能做什么。 */
function emptyPayload({ summary, analysis = null, blocks = [] }) {
  return {
    ok: true,
    empty: true,
    rows: [],
    rowCount: 0,
    truncated: false,
    summary,
    citations: [],
    dataFreshness: null,
    analysis,
    blocks,
  }
}

/**
 * 组装工具载荷。
 *
 * - 传 `analysisId`：取那一次（越权 / 不存在都当查不到，与页面 404 同口径）；
 * - 传 `asin`：取**包含该 ASIN 的最近一次**（最近一次分析未必包含它，所以要向前翻摘要）；
 * - 都不传：列出最近几次，让用户挑一次细看。
 */
export async function competitorAnalysisPayload({
  userId,
  analysisId = null,
  asin = null,
  limit = DEFAULT_LIST,
}) {
  if (!userId) {
    return emptyPayload({
      summary: '当前会话没有用户身份，无法调取竞品分析记录。',
    })
  }

  if (analysisId) {
    const record = await getCompetitorAnalysis(userId, analysisId)
    if (!record) {
      return emptyPayload({
        summary:
          `没有找到记录 #${analysisId}（分析记录只属于本人，看不到他人的记录）。` +
          '不带记录号再问一次，我可以列出你最近的几次竞品分析。',
        analysis: { requestedAnalysisId: Number(analysisId) || null },
      })
    }
    return payloadFromRecord(record)
  }

  const keyword = text(asin)?.toUpperCase() ?? null
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIST, 1), MAX_LIST)
  const list = await listCompetitorAnalyses(userId, keyword ? LOOKBACK : safeLimit)

  if (list.length === 0) {
    return emptyPayload({
      summary:
        '当前账号还没有任何竞品分析记录。到「竞品分析 → 分析」页输入 ASIN 跑一次，' +
        '结果会自动保存，之后在对话里就能调取（对话调取不会消耗卖家精灵额度）。',
    })
  }

  if (keyword) {
    const hit = list.find((row) => asinsOf(row).includes(keyword))
    if (!hit) {
      return emptyPayload({
        summary:
          `最近的 ${list.length} 次竞品分析里都没有 ${keyword}。` +
          `可以换成"最近一次竞品分析"来问，或到「竞品分析」页对这个 ASIN 跑一次（那会消耗卖家精灵额度）。`,
        analysis: { requestedAsin: keyword, scanned: list.length },
        // 显式只传 row：`Array.map` 会把下标当第二个参数传进去，而第二个参数是 dispositions
        blocks: listBlock(
          list.slice(0, DEFAULT_LIST).map((row) => toHistoryItem(row))
        ),
      })
    }
    // 列表接口不返回快照，命中后再取一次单条（同样只读）
    const record = await getCompetitorAnalysis(userId, hit.id)
    if (!record) {
      return emptyPayload({
        summary: `记录 #${hit.id} 已经不在了（可能被删除），请重新确认要看哪一次。`,
        analysis: { requestedAsin: keyword },
      })
    }
    return payloadFromRecord(record, { matchedBy: 'asin' })
  }

  // 同上：显式只传 row，别让 `Array.map` 的下标混进 dispositions
  const items = list.map((row) => toHistoryItem(row))
  return {
    ok: true,
    empty: false,
    rows: items,
    rowCount: items.length,
    truncated: false,
    summary: buildListSummary(items),
    citations: [],
    dataFreshness: null,
    analysis: { listed: items.length, requestedLimit: safeLimit },
    blocks: listBlock(items),
  }
}

/** 单条记录 → 载荷（含快照时的完整结论与关键数据块）。 */
function payloadFromRecord(record, { matchedBy = 'analysisId' } = {}) {
  const snapshot = record.result ?? null
  const findings = snapshot?.findings ?? []
  const rows = findingsRows(findings)
  return {
    ok: true,
    empty: false,
    rows,
    rowCount: rows.length,
    truncated: false,
    summary: buildRecordSummary({ record, snapshot }),
    /*
     * 快照里没有可复用的 dataset citation（它是分析当时算的），因此不给引用项；
     * 数据来源写在 summary 与每个块的 note 里，不编造来源标记。
     */
    citations: [],
    dataFreshness: snapshot?.dataFreshness ?? null,
    analysis: {
      matchedBy,
      analysisId: record.id,
      asins: Array.isArray(record.asins) ? record.asins : [],
      marketplace: record.marketplace ?? null,
      startDate: record.start_date ?? null,
      endDate: record.end_date ?? null,
      windowDays: record.window_days ?? null,
      compareWith: record.compare_with ?? null,
      level: record.level ?? null,
      findingCount: record.finding_count ?? rows.length,
      createdAt: record.created_at ?? null,
      hasSnapshot: Boolean(snapshot),
    },
    blocks: pickKeyBlocks(snapshot?.blocks ?? [], findings),
  }
}

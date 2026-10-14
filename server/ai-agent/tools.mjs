/**
 * 工具注册表与执行器（需求文档 §6.6）。
 *
 * 执行前二次校验（§3.3 层②）三件事，任何一步不过即拒绝并写审计：
 *   1. 工具白名单：工具名必须存在于「已注册给该用户的工具列表」中
 *      （模型幻觉出的工具名会在这里被拦下）
 *   2. 权限：canUseTool(user, tool) —— 统一走 permissions.mjs
 *   3. 参数：schema 校验 + 枚举白名单 + 长度/区间护栏
 *
 * 状态约定：层② 的任何一步不通过都落 status = 'blocked'（§6.4 步骤 7），
 * 同时用 reason 区分是权限拦截还是参数非法，避免审计台把两者混为一谈。
 */
import { recordAudit, summarizeValue } from './audit.mjs'
import { query } from '../db.mjs'
import {
  KnowledgeValidationError,
  deactivateDocument,
  findDocumentById,
  knowledgeFreshness,
  rebuildKnowledgeIndex,
  searchKnowledge,
} from './knowledge.mjs'
import {
  amazonPerformancePayload,
  anomalyScanPayload,
  asinSetPerformancePayload,
  buildTableBlock,
  combineFreshness,
  datasetCitation,
  inventoryOrdersPayload,
  inventoryRiskPayload,
  marketplacePerformancePayload,
} from './data-queries.mjs'
import { listMyAsinMetricOverrides, listMyAsins } from './my-asins.mjs'
// 统计区间解析（与页面同一套默认窗口）：`query_my_asins` 的日期可选，缺省必须与页面口径一致
import { resolveWindow } from './my-asin-routes.mjs'
import { extractAsin } from '../competitor-analysis.mjs'
import { competitorAnalysisPayload } from './competitor-history.mjs'
import { datasetFreshnessOf } from './datasets.mjs'
import { loadSettings } from './knowledge.mjs'
import { executeMcpTool, resolveMcpConfig, shapeMcpToolResult, toRemoteToolName } from './mcp.mjs'
import { BLOCKED_MESSAGE, canUseTool, registerableTools } from './permissions.mjs'
import { TOOL_CONTRACTS, findToolContract } from './tool-contracts.mjs'

export { BLOCKED_MESSAGE }

export const GUARDRAILS = {
  MAX_STRING: 200,
  MAX_ROWS: 2000,
  MAX_DATE_RANGE_DAYS: 366,
  DEFAULT_TIMEOUT_MS: 10000,
}

/**
 * MCP 工具的外层超时。比内置工具的 10s 宽：卖家精灵要走公网外呼，
 * 且其自身在 15s 内不响应时是"静默超时"（实测），这里给足余量再兜底。
 */
const MCP_CALL_TIMEOUT_MS = 60000

export const REJECT_REASON = {
  notRegistered: 'not_registered',
  forbidden: 'forbidden',
  /**
   * 工具已启用、也注册给了该用户，但**当前进程没有它的执行实现**（2026-09-17 新增）。
   *
   * 为什么单独一个原因码：典型场景是"代码已合并但服务没重启" —— 原先它与 `not_registered`
   * 共用，被编排层统一成"当前账号无权查询该数据"，用户会一直往权限方向排查（真实踩到）。
   * 它与权限无关，必须能被分辨。
   */
  notImplemented: 'not_implemented',
  invalidParams: 'invalid_params',
  executionError: 'execution_error',
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * `query_my_asins` 回给模型的清单明细上限（条）。
 *
 * 清单可能上千条，全塞进 summary 会让每次问答的输入 token 失控；这里按站点截断，
 * 超出部分只给数量并指向页面（结构化全量仍在 `rows` / 清单表格里）。
 */
const MY_ASIN_ROSTER_LIMIT = 200

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function typeMatches(type, value) {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'integer':
      return Number.isInteger(value)
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isPlainObject(value)
    default:
      return true
  }
}

/**
 * JSON Schema 子集校验：type / required / enum / maxLength / minimum / maximum /
 * additionalProperties。参数护栏统一在此收口，工具实现里不再重复判断。
 */
export function validateParams(schema, params = {}) {
  if (!isPlainObject(schema)) {
    return { ok: false, error: '工具参数 schema 缺失。' }
  }
  if (!isPlainObject(params)) {
    return { ok: false, error: '工具参数必须是对象。' }
  }
  const properties = isPlainObject(schema.properties) ? schema.properties : {}
  const required = Array.isArray(schema.required) ? schema.required : []
  const value = {}

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(params)) {
      if (!Object.hasOwn(properties, key)) {
        return { ok: false, error: `不支持的参数：${key}` }
      }
    }
  }

  for (const key of Object.keys(properties)) {
    const rule = properties[key] ?? {}
    const provided = params[key]
    if (provided === undefined || provided === null) {
      if (required.includes(key)) {
        return { ok: false, error: `缺少必填参数：${key}` }
      }
      continue
    }
    if (!typeMatches(rule.type, provided)) {
      return { ok: false, error: `参数 ${key} 的类型应为 ${rule.type}` }
    }
    // 枚举白名单对字符串与数值同样生效，必须先于类型分支判断
    if (Array.isArray(rule.enum) && !rule.enum.includes(provided)) {
      return {
        ok: false,
        error: `参数 ${key} 的取值必须是 ${rule.enum.join(' / ')} 之一`,
      }
    }
    if (typeof provided === 'string') {
      const trimmed = provided.trim()
      if (!trimmed) {
        if (required.includes(key)) {
          return { ok: false, error: `参数 ${key} 不能为空` }
        }
        continue
      }
      const maxLength = Number.isInteger(rule.maxLength)
        ? rule.maxLength
        : GUARDRAILS.MAX_STRING
      if (trimmed.length > maxLength) {
        return { ok: false, error: `参数 ${key} 超过 ${maxLength} 个字符上限` }
      }
      value[key] = trimmed
      continue
    }
    if (typeof provided === 'number') {
      if (Number.isInteger(rule.minimum) && provided < rule.minimum) {
        return { ok: false, error: `参数 ${key} 不能小于 ${rule.minimum}` }
      }
      if (Number.isInteger(rule.maximum) && provided > rule.maximum) {
        return { ok: false, error: `参数 ${key} 不能大于 ${rule.maximum}` }
      }
    }
    value[key] = provided
  }

  return { ok: true, value }
}

/**
 * 日期区间护栏：区间上限 366 天，防止全表扫描。
 * startDate / endDate 需要成对出现。
 */
export function assertDateRange(startDate, endDate, { maxDays = GUARDRAILS.MAX_DATE_RANGE_DAYS } = {}) {
  if (startDate === undefined && endDate === undefined) return { ok: true }
  if (!DATE_PATTERN.test(String(startDate ?? '')) || !DATE_PATTERN.test(String(endDate ?? ''))) {
    return { ok: false, error: '日期参数必须是 YYYY-MM-DD 格式，且需要同时提供开始与结束日期。' }
  }
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, error: '日期参数无效。' }
  }
  if (end.getTime() < start.getTime()) {
    return { ok: false, error: '结束日期不能早于开始日期。' }
  }
  const days = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1
  if (days > maxDays) {
    return { ok: false, error: `日期区间不能超过 ${maxDays} 天，请缩小范围后重试。` }
  }
  return { ok: true, days }
}

/** 截断超量返回，并在摘要里如实说明被截断。 */
export function truncateRows(rows, max = GUARDRAILS.MAX_ROWS) {
  if (!Array.isArray(rows)) return { rows: [], truncated: false, total: 0 }
  if (rows.length <= max) return { rows, truncated: false, total: rows.length }
  return { rows: rows.slice(0, max), truncated: true, total: rows.length }
}

/**
 * 把知识检索结果转成引用条目（引用面板与出口收敛共用的数据源）。
 *
 * `score` 是检索层算出的片段得分（覆盖率与命中数主导、trgm 相似度次之，见 `knowledge.mjs` 的排序）：
 * 出口层 `orchestrator.selectTopDocumentCitations()` 靠它挑出「最准确的一篇」，前端不展示这个数字。
 * `submitter` 只在员工经验类文档上有值，供右栏引用面板标注提报人——**正文不再写出处元数据**，
 * 提报人信息只能从这里到界面（见 `prompt.mjs` 第 4 条与 `providers/demo.mjs`）。
 */
export function buildDocumentCitations(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    kind: 'document',
    documentId: row.documentId,
    title: row.title,
    sourceType: row.sourceType,
    docVersion: row.docVersion,
    chunkIndex: row.chunkIndex,
    updatedAt: row.updatedAt,
    submitter: row.submitter,
    score: row.score,
    snippet: summarizeValue(row.snippet, 200),
  }))
}

/** 工具实现。每个 execute 必须返回带 dataFreshness 的结果（声明条依赖它）。 */
const EXECUTORS = {
  async search_knowledge(params, ctx) {
    const result = await searchKnowledge({
      user: ctx.user,
      searchText: params.query,
      topK: params.topK ?? ctx.retrievalTopK ?? 5,
      sourceType: params.sourceType ?? 'all',
    })
    const { rows, truncated, total } = truncateRows(result.rows)
    const latestUpdatedAt = rows.reduce((latest, row) => {
      const value = row.updatedAt ? new Date(row.updatedAt).getTime() : 0
      return value > latest ? value : latest
    }, 0)

    return {
      rows,
      rowCount: rows.length,
      truncated,
      totalRows: total,
      empty: rows.length === 0,
      summary:
        rows.length === 0
          ? `未检索到与「${params.query}」相关的知识片段`
          : `检索到 ${rows.length} 个相关片段，来自 ${new Set(rows.map((row) => row.title)).size} 篇文档`,
      dataFreshness: {
        ...result.dataFreshness,
        importedAt: latestUpdatedAt ? new Date(latestUpdatedAt).toISOString() : result.dataFreshness.importedAt,
      },
      citations: buildDocumentCitations(rows),
    }
  },

  async query_amazon_performance(params, ctx) {
    // 不传 asin 表示全站聚合（回答"整体怎么样""哪个 ASIN 最差"）
    const payload = params.asin
      ? await amazonPerformancePayload({
          asin: params.asin,
          marketplace: params.marketplace ?? 'US',
          startDate: params.startDate,
          endDate: params.endDate,
          compareWith: params.compareWith ?? 'previous_period',
        })
      : await marketplacePerformancePayload({
          marketplace: params.marketplace ?? 'US',
          startDate: params.startDate,
          endDate: params.endDate,
          compareWith: params.compareWith ?? 'previous_period',
        })
    return {
      rows: payload.rows,
      rowCount: payload.rowCount,
      truncated: payload.truncated,
      empty: payload.empty,
      summary: payload.summary,
      citations: payload.citations,
      dataFreshness: payload.dataFreshness,
      analysis: payload.analysis ?? null,
      blocks: payload.blocks ?? [],
    }
  },

  async query_inventory_orders(params, ctx) {
    const payload = await inventoryOrdersPayload({
      sku: params.sku,
      includeOrders: params.includeOrders ?? true,
      orderStatus: params.orderStatus ?? null,
      limit: params.limit ?? 20,
    })
    return {
      rows: payload.rows,
      rowCount: payload.rowCount,
      empty: payload.empty,
      summary: payload.summary,
      citations: payload.citations,
      dataFreshness: payload.dataFreshness,
      blocks: payload.blocks ?? [],
    }
  },

  async scan_amazon_anomalies(params, ctx) {
    const payload = await anomalyScanPayload({
      marketplace: params.marketplace ?? 'US',
      startDate: params.startDate,
      endDate: params.endDate,
      minSeverity: params.minSeverity ?? 'medium',
    })
    return toolResultFromPayload(payload)
  },

  async analyze_inventory_risk(params, ctx) {
    const payload = await inventoryRiskPayload({
      sku: params.sku ?? null,
      velocityWindowDays: params.velocityWindowDays,
    })
    return toolResultFromPayload(payload)
  },

  /**
   * 竞品分析记录调取（2026-09-17，用户口径「竞品分析记录跟 AI 会话时也可以调取」）。
   *
   * **只读已落库的快照**：不重新分析、不调用卖家精灵 —— 卖家精灵按调用次数计费，
   * 对话里顺手触发一次全维度分析（5 个 ASIN ≈ 22 次调用）会真实花钱，
   * 因此这里刻意**不提供任何"重新分析"参数**。归属由读取函数在 SQL 里按 `user_id` 过滤。
   *
   * 载荷组装与"关键数字必须进 summary/rows"的原因见 `competitor-history.mjs` 的文件头注释。
   */
  async query_competitor_analysis(params, ctx) {
    const payload = await competitorAnalysisPayload({
      userId: ctx.user?.id ?? null,
      analysisId: params.analysisId ?? null,
      asin: params.asin ?? null,
      limit: params.limit ?? undefined,
    })
    return toolResultFromPayload(payload)
  },

  /**
   * 「我的 ASIN」分析：范围由**当前账号的 ASIN 列表**决定，而不是全站。
   *
   * 站点从清单下沉到条目之后，一次调用可能横跨多个站点，因此这里按站点分组、
   * 逐组复用 `asinSetPerformancePayload`（与页面同一套计算），再把各站点的块与摘要拼起来。
   *
   * **绝不跨站点求和**：不同站点的货币不同（USD / EUR / JPY…），把 US 的花费与 DE 的
   * 销售额相加得到的数字没有含义，而模型一旦看到它就会引用它。因此摘要里逐站点陈述，
   * 并要求模型回答时同样分站点。
   */
  async query_my_asins(params, ctx) {
    const userId = ctx.user?.id ?? null
    const all = await listMyAsins({ userId })

    /*
     * 统计区间**可选**（2026-09-18 修「列出我的 ASIN 列表」报"权限不足"）：
     * 用户只问"有哪些 ASIN / 列出清单"时天然没有日期，此前 schema 把 startDate/endDate 定为必填，
     * 模型不带日期调用就得到 `invalid_params`，编排层又把这个参数问题当成权限问题回了
     * 「当前账号无权查询该数据」。现在缺省走**与页面同一个默认窗口**
     * （`resolveWindow`：以最新可用报表日期为锚的近 30 天），页面与 AI 的口径不会漂移。
     */
    const window = await resolveWindow({
      startDate: params.startDate,
      endDate: params.endDate,
    })

    const [adsFreshness, salesFreshness] = await Promise.all([
      datasetFreshnessOf('amazon_ads_daily'),
      datasetFreshnessOf('amazon_sales_daily'),
    ])
    const dataFreshness = combineFreshness([adsFreshness, salesFreshness])
    const citations = [datasetCitation(adsFreshness), datasetCitation(salesFreshness)]

    if (all.length === 0) {
      return {
        rows: [],
        rowCount: 0,
        empty: true,
        citations,
        dataFreshness,
        blocks: [],
        summary:
          '当前账号的「我的 ASIN」列表还是空的（没有任何可分析的商品）。请提示用户先到「我的 ASIN」页用「添加 ASIN」或 Excel 模板导入商品；若用户只是想问某个 ASIN，请改用 query_amazon_performance。回答时必须如实说明列表为空，不得编造商品或数字。',
      }
    }

    const siteFilter = params.marketplace ? String(params.marketplace).toUpperCase() : null
    const wantedAsins = Array.isArray(params.asins)
      ? new Set(params.asins.map((asin) => extractAsin(String(asin ?? ''))).filter(Boolean))
      : null

    const selected = all.filter((item) => {
      if (siteFilter && item.marketplace !== siteFilter) return false
      if (wantedAsins && !wantedAsins.has(item.asin)) return false
      return true
    })

    if (selected.length === 0) {
      const sites = [...new Set(all.map((item) => item.marketplace))]
      const message = wantedAsins
        ? `指定的 ASIN 不在「我的 ASIN」列表里（${[...wantedAsins].join('、')}）。当前列表共 ${all.length} 个 ASIN，覆盖站点：${sites.join('、')}。`
        : `「我的 ASIN」里没有站点 ${siteFilter} 的商品。当前列表覆盖站点：${sites.join('、')}。`
      return {
        rows: [],
        rowCount: 0,
        empty: true,
        citations,
        dataFreshness,
        blocks: [],
        summary: `${message}\n回答时必须如实说明这一情况，不得编造这些 ASIN 的数据。`,
      }
    }

    const grouped = new Map()
    for (const item of selected) {
      const list = grouped.get(item.marketplace) ?? []
      list.push(item)
      grouped.set(item.marketplace, list)
    }

    /*
     * 人工录入的区间指标（2026-09-18）：与页面读同一张表、并在
     * `asinSetPerformancePayload` 里走**同一处合并**，因此"页面上显示的数字"与
     * "AI 说出来的数字"不会分叉；回答里会说明哪些来自人工录入。
     */
    const overridesByItemId = await listMyAsinMetricOverrides({
      userId,
      // 同样用解析后的区间：人工指标要求"具体起止日期"，缺省时必须落到默认窗口的具体日期上
      startDate: window.startDate,
      endDate: window.endDate,
    })

    const blocks = []
    const rows = []
    const summaryParts = []
    let anyData = false

    for (const [marketplace, list] of grouped) {
      const aliasByAsin = {}
      const overridesByAsin = new Map()
      for (const item of list) {
        if (item.alias) aliasByAsin[item.asin] = item.alias
        const manual = overridesByItemId.get(item.id)
        if (manual) overridesByAsin.set(item.asin, manual)
      }
      const payload = await asinSetPerformancePayload({
        asins: list.map((item) => item.asin),
        marketplace,
        // 用 `resolveWindow` 解析出的区间：显式给了就用给的，没给就是与页面一致的默认窗口
        startDate: window.startDate,
        endDate: window.endDate,
        compareWith: params.compareWith ?? 'previous_period',
        aliasByAsin,
        overridesByAsin,
      })
      const result = toolResultFromPayload(payload)
      if (!payload.empty) anyData = true
      summaryParts.push(`站点 ${marketplace}（${list.length} 个 ASIN）\n${result.summary}`)
      for (const block of result.blocks ?? []) blocks.push(withSiteLabel(block, marketplace))
      for (const row of result.rows ?? []) rows.push({ marketplace, ...row })
    }

    /*
     * 清单明细必须回到模型手里（2026-09-18 修「让 AI 列出我的 ASIN 列表」答不出来）：
     * 此前 summary 只有数量与站点分布，模型只能回"工具未返回具体编码，我无法逐个列出" ——
     * 用户拿不到清单，而这种自述措辞又会被权限护栏误判（见 prompt.mjs 的 stripProductWording）。
     * 这里按站点一行列出（紧凑、对 token 友好）；超过上限时截断并指向页面。
     */
    const rosterLines = []
    let rosterShown = 0
    for (const [marketplace, list] of grouped) {
      const labels = []
      for (const item of list) {
        if (rosterShown >= MY_ASIN_ROSTER_LIMIT) break
        rosterShown += 1
        labels.push(item.alias ? `${item.asin}（${item.alias}）` : item.asin)
      }
      rosterLines.push(`- ${marketplace}（${list.length} 个）：${labels.join('、')}`)
    }
    const rosterTail =
      selected.length > rosterShown
        ? `\n（清单较大，以上只列前 ${rosterShown} 条、共 ${selected.length} 条；完整清单见「我的 ASIN」页面。）`
        : ''

    const header = [
      `「我的 ASIN」共 ${selected.length} 个 ASIN，覆盖 ${grouped.size} 个站点：${[...grouped.keys()].join('、')}。`,
      '**站点之间不能相加**：不同站点的货币不同，金额、ACoS 等必须按站点分别陈述，不得给出跨站点的合计。',
      `清单明细（用户要清单时逐条列出 ASIN 编码，不要只说数量）：\n${rosterLines.join('\n')}${rosterTail}`,
    ].join('\n')

    return {
      rows,
      rowCount: rows.length,
      empty: !anyData,
      summary: `${header}\n\n${summaryParts.join('\n\n')}`,
      citations,
      dataFreshness,
      // 清单表放最前：它是"有哪些 ASIN"的答案本体，各站点的指标块排在其后
      blocks: [
        buildTableBlock({
          title: '我的 ASIN 清单',
          columns: [
            { key: 'marketplace', label: '站点' },
            { key: 'asin', label: 'ASIN' },
            { key: 'alias', label: '别名' },
          ],
          rows: selected.map((item) => ({
            marketplace: item.marketplace,
            asin: item.asin,
            alias: item.alias ?? '',
          })),
        }),
        ...blocks,
      ],
    }
  },

  async rebuild_knowledge_index(_params, ctx) {
    const result = await rebuildKnowledgeIndex()
    return {
      rows: [result],
      rowCount: 1,
      empty: false,
      summary: `索引重建完成：生效文档 ${result.documents} 篇，切片 ${result.chunks} 个`,
      dataFreshness: await knowledgeFreshness(ctx.user),
      citations: [],
    }
  },

  async deactivate_document(params, ctx) {
    const before = await findDocumentById(params.documentId)
    if (!before) {
      throw new KnowledgeValidationError(`文档不存在：${params.documentId}`)
    }
    if (before.status !== 'active') {
      return {
        rows: [{ id: before.id, title: before.title, status: before.status }],
        rowCount: 1,
        empty: false,
        summary: `文档「${before.title}」当前状态为已下线，无需重复操作`,
        dataFreshness: await knowledgeFreshness(ctx.user),
        citations: [],
      }
    }
    const result = await deactivateDocument({ documentId: params.documentId, actorId: ctx.user?.id })
    await recordAudit({
      actorId: ctx.user?.id ?? null,
      action: 'doc_offline',
      targetType: 'ai_document',
      targetId: params.documentId,
      detail: {
        title: result.title,
        reason: params.reason ?? '',
        via: 'tool:deactivate_document',
        chunkCount: result.chunk_count,
      },
      ip: ctx.ip ?? null,
    })
    return {
      rows: [{ id: result.id, title: result.title, status: 'inactive', chunkCount: result.chunk_count }],
      rowCount: 1,
      empty: false,
      summary: `文档「${result.title}」已下线，其 ${result.chunk_count} 个切片不再被检索引用`,
      dataFreshness: await knowledgeFreshness(ctx.user),
      citations: [],
    }
  },
}

/** 数据类工具的载荷 → 工具结果（字段完全一致，抽出来避免每处重复搬运）。 */
function toolResultFromPayload(payload) {
  return {
    rows: payload.rows ?? [],
    rowCount: payload.rowCount ?? 0,
    truncated: payload.truncated,
    empty: payload.empty,
    summary: payload.summary,
    citations: payload.citations ?? [],
    dataFreshness: payload.dataFreshness ?? null,
    analysis: payload.analysis ?? null,
    blocks: payload.blocks ?? [],
  }
}

/**
 * 给某个站点的结果块打上站点前缀，并补一列「站点」。
 *
 * 多站点的结果放在同一个回答里时，"清单整体汇总""清单内各 ASIN 表现"这类标题会出现多次 ——
 * 不标站点就分不清哪个块属于哪个站点；明细表补一列站点，用户才能对上自己列表里的行。
 */
function withSiteLabel(block, marketplace) {
  if (!isPlainObject(block)) return block
  const next = { ...block, title: `${marketplace} · ${block.title ?? '分析结果'}` }
  if (Array.isArray(block.columns) && Array.isArray(block.rows)) {
    next.columns = [{ key: 'marketplace', label: '站点' }, ...block.columns]
    next.rows = block.rows.map((row) => ({ marketplace, ...row }))
  }
  return next
}

/** 工具定义（契约 + 实现），仅用于测试与文档；是否可注册由 permissions 决定。 */
export function listToolDefinitions() {
  return TOOL_CONTRACTS.map((contract) => ({
    ...contract,
    execute: EXECUTORS[contract.name],
  }))
}

export function hasExecutor(name) {
  return typeof EXECUTORS[name] === 'function'
}

/** 从数据库读取已启用的工具行（含 MCP 同步进来的远端工具）。 */
export async function loadEnabledTools() {
  const { rows } = await query(
    `SELECT id, name, description, params_schema, required_role, enabled, source, remote_name
       FROM ai_tools WHERE enabled = true ORDER BY name`
  )
  return rows
}

/** ① 工具注册裁剪：返回该用户可用的工具行（数据库 + 启用 + 权限）。 */
export async function loadRegisteredTools(user, enabledTools = null) {
  return registerableTools(user, enabledTools ?? await loadEnabledTools())
}

/** 转成 OpenAI Function Calling 的 tools 结构（参数 schema 以代码内契约为准）。 */
export function toolDefinitionsToOpenAi(tools) {
  return (Array.isArray(tools) ? tools : [])
    .map((tool) => {
      const contract = findToolContract(tool.name)
      const parameters = contract?.paramsSchema ?? tool.params_schema ?? {
        type: 'object',
        properties: {},
      }
      return {
        type: 'function',
        function: {
          name: tool.name,
          description: contract?.description ?? tool.description ?? '',
          parameters,
        },
      }
    })
    .filter((tool) => Boolean(tool.function.name))
}

function rejection({ reason, message, toolName, latencyMs, params }) {
  return {
    status: 'blocked',
    reason,
    error: message,
    toolName,
    rows: [],
    rowCount: 0,
    summary: '',
    citations: [],
    dataFreshness: null,
    latencyMs,
    params,
  }
}

/**
 * 执行一个工具调用。
 *
 * @param {object} input
 * @param {object} input.user        当前用户（含 role / status）
 * @param {Array}  input.registeredTools 已注册给该用户的工具行（层① 的产物）
 * @param {string} input.toolName    模型请求的工具名
 * @param {object} input.params      模型给出的参数
 * @param {object} input.ctx         执行上下文 { conversationId, messageId, retrievalTopK, ip }
 */
export async function executeTool({ user, registeredTools = [], toolName, params = {}, ctx = {} }) {
  const started = Date.now()
  const latency = () => Date.now() - started

  const registered = registeredTools.find((tool) => tool.name === toolName)
  if (!registered) {
    // 工具未注册给该用户：可能是模型幻觉，也可能是权限裁剪的结果，两者都必须拦下
    const contract = findToolContract(toolName)
    const permissionDenied = contract ? !canUseTool(user, contract) : false
    return rejection({
      reason: permissionDenied ? REJECT_REASON.forbidden : REJECT_REASON.notRegistered,
      message: permissionDenied
        ? BLOCKED_MESSAGE
        : `工具 ${toolName} 不在当前可用列表中，已拒绝执行。`,
      toolName,
      latencyMs: latency(),
      params,
    })
  }

  // 层② 校验 2：即使已注册，执行前再校验一次权限（防越权参数与并发改权限）
  if (!canUseTool(user, registered)) {
    return rejection({
      reason: REJECT_REASON.forbidden,
      message: BLOCKED_MESSAGE,
      toolName,
      latencyMs: latency(),
      params,
    })
  }

  // MCP（卖家精灵）工具：参数 schema 用同步入库的远端 schema，执行转发给 MCP 服务。
  // 白名单、权限、二次校验、审计都已经在上面走过同一套路径，这里只补"参数校验 + 转发 + 结果整形"。
  if (registered.source === 'mcp') {
    return await executeMcpRegisteredTool({ registered, toolName, params, latency })
  }

  const contract = findToolContract(toolName)
  if (!contract || !hasExecutor(toolName)) {
    return rejection({
      reason: REJECT_REASON.notImplemented,
      message: `工具 ${toolName} 尚未实现，已拒绝执行。`,
      toolName,
      latencyMs: latency(),
      params,
    })
  }

  // 层② 校验 3：参数 schema + 护栏
  const validation = validateParams(contract.paramsSchema, params)
  if (!validation.ok) {
    return rejection({
      reason: REJECT_REASON.invalidParams,
      message: validation.error,
      toolName,
      latencyMs: latency(),
      params,
    })
  }
  const dateRange = assertDateRange(validation.value.startDate, validation.value.endDate)
  if (!dateRange.ok) {
    return rejection({
      reason: REJECT_REASON.invalidParams,
      message: dateRange.error,
      toolName,
      latencyMs: latency(),
      params: validation.value,
    })
  }

  try {
    const result = await withTimeout(
      EXECUTORS[toolName](validation.value, { ...ctx, user }),
      ctx.timeoutMs ?? GUARDRAILS.DEFAULT_TIMEOUT_MS,
      `工具 ${toolName} 执行超时`
    )
    const { rows, truncated, total } = truncateRows(result.rows ?? [])
    return {
      status: 'ok',
      reason: 'ok',
      toolName,
      params: validation.value,
      rows,
      rowCount: rows.length,
      totalRows: total,
      truncated,
      empty: Boolean(result.empty),
      // 数据类工具的分析结论与结构化块原样透传：
      // 分析结果由服务端算出（analytics.mjs），模型只负责表达
      summary: summarizeValue(result.summary ?? '', 1200),
      citations: result.citations ?? [],
      dataFreshness: result.dataFreshness ?? null,
      analysis: result.analysis ?? null,
      blocks: Array.isArray(result.blocks) ? result.blocks : [],
      latencyMs: latency(),
    }
  } catch (error) {
    return {
      status: 'error',
      reason: REJECT_REASON.executionError,
      toolName,
      params: validation.value,
      error: summarizeValue(error?.message ?? '工具执行失败', 300),
      rows: [],
      rowCount: 0,
      summary: '',
      citations: [],
      dataFreshness: null,
      latencyMs: latency(),
    }
  }
}

/**
 * 执行一个 MCP（卖家精灵）工具。
 *
 * 与内置工具的区别只有三点：参数 schema 来自同步入库的远端 schema、执行体是 HTTP 转发、
 * 结果是第三方 JSON 需要整形；**返回结构必须与内置工具完全一致**——编排层、审计台、
 * 前端渲染都不该知道"这个工具来自 MCP"。
 */
async function executeMcpRegisteredTool({ registered, toolName, params, latency }) {
  const validation = validateParams(registered.params_schema ?? {}, params)
  if (!validation.ok) {
    return rejection({
      reason: REJECT_REASON.invalidParams,
      message: validation.error,
      toolName,
      latencyMs: latency(),
      params,
    })
  }
  const settings = await loadSettings()
  const config = resolveMcpConfig(settings)
  const remoteName = registered.remote_name
    ?? toRemoteToolName(config.prefix, toolName)
  if (!remoteName) {
    return rejection({
      reason: REJECT_REASON.notRegistered,
      message: `工具 ${toolName} 缺少远端映射，已拒绝执行。`,
      toolName,
      latencyMs: latency(),
      params: validation.value,
    })
  }
  if (!config.enabled) {
    return rejection({
      reason: REJECT_REASON.forbidden,
      message: '卖家精灵 MCP 已停用，请先在「模型与配置」中启用。',
      toolName,
      latencyMs: latency(),
      params: validation.value,
    })
  }

  try {
    const result = await withTimeout(
      executeMcpTool({
        row: settings,
        remoteName,
        params: validation.value,
      }),
      MCP_CALL_TIMEOUT_MS,
      `卖家精灵工具 ${toolName} 执行超时`
    )
    const shaped = shapeMcpToolResult({
      remoteName,
      result,
      description: registered.description,
    })
    const { rows, truncated, total } = truncateRows(shaped.rows)
    return {
      status: 'ok',
      reason: 'ok',
      toolName,
      params: validation.value,
      rows,
      rowCount: rows.length,
      totalRows: total,
      truncated,
      empty: Boolean(shaped.empty) || rows.length === 0,
      summary: summarizeValue(shaped.summary ?? '', 1200),
      citations: [],
      // 卖家精灵是**实时查询**，不是本地导入的报表：没有"数据截至"可声明，
      // 因此不带 dataFreshness（前端也就不会给它套上"准实时非实时"的话术）。
      dataFreshness: null,
      analysis: null,
      blocks: Array.isArray(shaped.blocks) ? shaped.blocks : [],
      latencyMs: latency(),
    }
  } catch (error) {
    return {
      status: 'error',
      reason: REJECT_REASON.executionError,
      toolName,
      params: validation.value,
      error: summarizeValue(error?.message ?? '卖家精灵工具执行失败', 300),
      rows: [],
      rowCount: 0,
      summary: '',
      citations: [],
      dataFreshness: null,
      latencyMs: latency(),
    }
  }
}

/** 查询超时保护（需求文档 §6.6：所有查询强制带超时）。 */
export async function withTimeout(promise, timeoutMs, message = '查询超时') {  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

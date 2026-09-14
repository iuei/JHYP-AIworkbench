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
  inventoryOrdersPayload,
  inventoryRiskPayload,
  marketplacePerformancePayload,
} from './data-queries.mjs'
import { BLOCKED_MESSAGE, canUseTool, registerableTools } from './permissions.mjs'
import { TOOL_CONTRACTS, findToolContract } from './tool-contracts.mjs'

export { BLOCKED_MESSAGE }

export const GUARDRAILS = {
  MAX_STRING: 200,
  MAX_ROWS: 2000,
  MAX_DATE_RANGE_DAYS: 366,
  DEFAULT_TIMEOUT_MS: 10000,
}

export const REJECT_REASON = {
  notRegistered: 'not_registered',
  forbidden: 'forbidden',
  invalidParams: 'invalid_params',
  executionError: 'execution_error',
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 24 * 60 * 60 * 1000

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
      citations: rows.map((row) => ({
        kind: 'document',
        documentId: row.documentId,
        title: row.title,
        sourceType: row.sourceType,
        docVersion: row.docVersion,
        chunkIndex: row.chunkIndex,
        updatedAt: row.updatedAt,
        submitter: row.submitter,
        snippet: summarizeValue(row.snippet, 200),
      })),
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

/** 从数据库读取已启用的工具行。 */
export async function loadEnabledTools() {
  const { rows } = await query(
    `SELECT id, name, description, params_schema, required_role, enabled
       FROM ai_tools WHERE enabled = true ORDER BY name`
  )
  return rows
}

/** ① 工具注册裁剪：返回该用户可用的工具行（数据库 + 启用 + 权限）。 */
export async function loadRegisteredTools(user) {
  return registerableTools(user, await loadEnabledTools())
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

  const contract = findToolContract(toolName)
  if (!contract || !hasExecutor(toolName)) {
    return rejection({
      reason: REJECT_REASON.notRegistered,
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

/** 查询超时保护（需求文档 §6.6：所有查询强制带超时）。 */
export async function withTimeout(promise, timeoutMs, message = '查询超时') {
  let timer
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

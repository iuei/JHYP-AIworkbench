/**
 * 编排层（需求文档 §6.4）。
 *
 * 一次问答的完整链路，审计在**本层强制发生**，前端与模型都无法绕过：
 *   提问落库 → 上下文组装 → ① 工具注册裁剪 → 调模型 → ② 执行前二次校验
 *   → 执行工具（③ 检索范围过滤在工具内部）→ 结果回灌模型 → 流式输出
 *   → 回答与引用落库 → 收尾审计
 *
 * 每一步工具调用都会先写 ai_runs(pending)，再写终态（ok / blocked / error），
 * 因此"被拦截"与"执行失败"同样留痕——被拒绝的请求审计价值最高。
 */
import { startRun as defaultStartRun, finishRun as defaultFinishRun, recordAudit as defaultRecordAudit } from './audit.mjs'
import * as repo from './conversations.mjs'
import { loadSettings } from './knowledge.mjs'
import {
  BLOCKED_ANSWER,
  MODEL_ERROR_ANSWER,
  NO_RESULT_ANSWER,
  TURN_LIMIT_ANSWER,
  buildDegradedAnswer,
  buildMessages,
  buildSystemPrompt,
  detectInjectionSignals,
  enforcePermissionWording,
  ensureFreshnessDeclaration,
  toolFailureAnswer,
  wrapReferenceData,
} from './prompt.mjs'
import {
  executeTool as defaultExecuteTool,
  loadEnabledTools as defaultLoadEnabledTools,
  loadRegisteredTools as defaultLoadRegisteredTools,
  toolDefinitionsToOpenAi,
} from './tools.mjs'
import { describeProvider, resolveProvider as defaultResolveProvider } from './providers/index.mjs'
import { deriveTitle } from './conversations.mjs'
import { datasetCoverageSummary } from './datasets.mjs'

export const MAX_QUESTION_LENGTH = 2000
export const MAX_TOOL_ROUNDS = 2

export const CHAT_STATUS = {
  ok: 'ok',
  blocked: 'blocked',
  error: 'error',
}

export const EVENT = {
  meta: 'meta',
  status: 'status',
  reset: 'reset',
  delta: 'delta',
  done: 'done',
  error: 'error',
}

export const ERROR_CODE = {
  emptyQuestion: 'empty_question',
  modelUnavailable: 'model_unavailable',
  internal: 'internal',
}

export const TOOL_LABELS = {
  search_knowledge: '检索知识库',
  rebuild_knowledge_index: '重建知识索引',
  deactivate_document: '下线知识文档',
}

export function toolLabel(toolName) {
  return TOOL_LABELS[toolName] ?? toolName
}

export class OrchestratorError extends Error {
  constructor(message, code = ERROR_CODE.internal) {
    super(message)
    this.code = code
  }
}

const defaultDeps = {
  repo,
  loadSettings,
  loadRegisteredTools: defaultLoadRegisteredTools,
  loadEnabledTools: defaultLoadEnabledTools,
  executeTool: defaultExecuteTool,
  startRun: defaultStartRun,
  finishRun: defaultFinishRun,
  recordAudit: defaultRecordAudit,
  resolveProvider: defaultResolveProvider,
  loadDatasetCoverage: datasetCoverageSummary,
}

/**
 * 执行一次问答。
 *
 * @param {object} input
 * @param {object} input.user            当前用户
 * @param {number|null} input.conversationId 续聊的会话；为空则新建
 * @param {string} input.content         提问原文
 * @param {string|null} input.ip         来源 IP（写入审计）
 * @param {Function} input.onEvent       事件回调，接收 { type, data }
 * @param {AbortSignal} input.signal     停止生成信号
 * @param {object} overrides             依赖覆盖（仅供测试注入假实现）
 */
export async function runChat(
  { user, conversationId = null, content, ip = null, onEvent = () => {}, signal } = {},
  overrides = {}
) {
  const deps = { ...defaultDeps, ...overrides }
  const emit = (type, data = {}) => {
    onEvent({ type, ...data })
  }
  const startedAt = Date.now()

  const question = String(content ?? '').replace(/\s+/g, ' ').trim()
  if (!question) {
    throw new OrchestratorError('提问内容不能为空。', ERROR_CODE.emptyQuestion)
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    throw new OrchestratorError(
      `提问内容不能超过 ${MAX_QUESTION_LENGTH} 个字符。`,
      ERROR_CODE.emptyQuestion
    )
  }

  const settings = await deps.loadSettings()
  const provider = deps.resolveProvider({ settings })
  const providerInfo = describeProvider(provider)
  const maxTurns = settings?.max_turns_per_conversation ?? 20
  const retrievalTopK = settings?.retrieval_top_k ?? 5

  // ── 步骤 3：会话与提问落库（审计①）
  const conversation = await deps.repo.ensureConversation({
    userId: user.id,
    conversationId,
    title: deriveTitle(question),
  })
  const previousTurns = await deps.repo.countAssistantTurns(conversation.id)
  const history = previousTurns > 0 ? await deps.repo.loadHistory({ conversationId: conversation.id, limit: 10 }) : []
  const userMessage = await deps.repo.appendMessage({
    conversationId: conversation.id,
    role: 'user',
    content: question,
  })

  emit(EVENT.meta, {
    data: {
      conversationId: conversation.id,
      messageId: userMessage.id,
      question,
      provider: providerInfo,
      maxTurns,
      turn: previousTurns + 1,
    },
  })

  // 轮次上限：超出给出明确提示，不消耗模型调用
  if (previousTurns >= maxTurns) {
    const answer = TURN_LIMIT_ANSWER
    emit(EVENT.delta, { data: { text: answer } })
    const assistantMessage = await deps.repo.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: answer,
      status: CHAT_STATUS.error,
      provider: provider.name,
      model: provider.model,
      latencyMs: Date.now() - startedAt,
    })
    const payload = {
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      status: CHAT_STATUS.error,
      code: 'turn_limit',
      answer,
      citations: [],
      toolRuns: [],
      provider: providerInfo,
      latencyMs: Date.now() - startedAt,
    }
    emit(EVENT.done, { data: payload })
    return payload
  }

  // ── 步骤 4：组装上下文；★ 工具注册裁剪（层①）
  const registeredTools = await deps.loadRegisteredTools(user)
  // 全量工具名用于识别"模型点名了用户无权使用的工具"（权限探测防护）
  const allToolNames = (await deps.loadEnabledTools()).map((tool) => tool.name)
  const openAiTools = toolDefinitionsToOpenAi(registeredTools)
  // 当前日期 + 数据覆盖范围必须进提示词：否则模型无法把"上个月"这类相对时间换算成区间
  const datasetCoverage = await deps.loadDatasetCoverage()
  const systemPrompt = buildSystemPrompt({
    user,
    runtime: { today: new Date().toISOString().slice(0, 10), datasetCoverage },
  })
  const baseMessages = buildMessages({ systemPrompt, history, question })

  emit(EVENT.meta, {
    data: { registeredTools: registeredTools.map((tool) => tool.name) },
  })

  const toolRuns = []
  let citations = []
  const freshnessList = []
  /** 回答卡片的结构化数据块（表格 / 图表 / 指标卡），由工具返回、原样落库供前端渲染 */
  const answerBlocks = []
  let status = CHAT_STATUS.ok
  let injectionSignals = []
  let blockedTool = null
  let failedTool = null
  let tokensIn = 0
  let tokensOut = 0
  let referenceRows = []

  const streamDelta = (text) => emit(EVENT.delta, { data: { text } })

  // ── 步骤 5：调用模型（Function Calling）
  let completion
  try {
    emit(EVENT.status, {
      data: { step: 'think', state: 'running', label: '正在理解问题…' },
    })
    completion = await provider.complete({
      messages: baseMessages,
      tools: openAiTools,
      signal,
      onDelta: streamDelta,
    })
  } catch (error) {
    return await finishWithModelError(error)
  }

  let messages = baseMessages
  let rounds = 0
  /**
   * 关键：必须先接住第一轮模型返回的内容。
   * 模型不一定每轮都调工具（问候语、元问题、判断无需检索时都会直接作答），
   * 早期版本只在工具循环内赋值 answer，导致这类回答被丢弃并误报「AI 服务暂不可用」。
   */
  let answer = String(completion.content ?? '')

  /**
   * 当前 `completion` 的 token 是否已经计入。
   *
   * 循环内每一轮进入时都会先累加该轮 completion 的 token；若这一轮因为「工具被拦截 / 执行失败」
   * 而 break，completion 不会再被重新赋值，于是循环末尾的收尾累加会把同一轮的量**再计一遍**，
   * 使 `ai_messages` 与审计台的用量偏高。这个标志让收尾累加只处理"还没计过"的那一次。
   */
  let completionCounted = false

  while (Array.isArray(completion.toolCalls) && completion.toolCalls.length > 0 && rounds < MAX_TOOL_ROUNDS) {
    rounds += 1
    tokensIn += Number(completion.tokensIn ?? 0)
    tokensOut += Number(completion.tokensOut ?? 0)
    completionCounted = true

    // 模型先吐了内容又要调工具：让前端丢弃已流式显示的那段，避免半成品留在气泡里
    emit(EVENT.reset, { data: { reason: 'tool_call' } })

    const roundResults = []
    for (const call of completion.toolCalls) {
      const toolName = String(call?.name ?? '')
      const params = call?.arguments ?? {}
      emit(EVENT.status, {
        data: {
          step: 'tools',
          state: 'running',
          toolName,
          label: `正在${toolLabel(toolName)}…`,
        },
      })

      // ── 步骤 6：[审计②] 先落 pending，保证拦截与失败同样留痕
      const runId = await deps.startRun({
        messageId: userMessage.id,
        userId: user.id,
        toolName,
        params,
      })

      // ── 步骤 7：执行前二次校验 + 步骤 8：执行工具
      const result = await deps.executeTool({
        user,
        registeredTools,
        toolName,
        params,
        ctx: { conversationId: conversation.id, messageId: userMessage.id, retrievalTopK, ip },
      })

      // ── 步骤 10 的一部分：工具调用终态（成功 / 被拦截 / 失败）
      await deps.finishRun(runId, {
        status: result.status,
        resultSummary: result.status === 'ok' ? result.summary : result.error,
        rowCount: result.rowCount ?? null,
        error: result.status === 'ok' ? null : result.error,
        latencyMs: result.latencyMs ?? null,
      })

      const run = {
        id: runId,
        toolName,
        params: result.params ?? params,
        status: result.status,
        summary: result.summary ?? '',
        error: result.error ?? null,
        rowCount: result.rowCount ?? 0,
        latencyMs: result.latencyMs ?? null,
      }
      toolRuns.push(run)
      emit(EVENT.status, {
        data: {
          step: 'tools',
          state: result.status === 'ok' ? 'done' : 'failed',
          toolName,
          label:
            result.status === 'ok'
              ? `✓ 已${toolLabel(toolName)}`
              : `✕ ${toolLabel(toolName)}失败`,
          summary: result.summary ?? '',
        },
      })

      if (result.status === 'blocked') {
        blockedTool = toolName
        // 拦截也是审计事件：单独留管理动作日志，审计台「拦截记录」视图直接可查
        await deps.recordAudit({
          actorId: user.id,
          action: 'tool_blocked',
          targetType: 'ai_tool',
          targetId: toolName,
          detail: {
            reason: result.reason,
            params: result.params ?? params,
            conversationId: conversation.id,
            messageId: userMessage.id,
          },
          ip,
        })
        break
      }

      if (result.status === 'error') {
        failedTool = { toolName, error: result.error }
        break
      }

      const rows = Array.isArray(result.rows) ? result.rows : []
      referenceRows.push(...rows)
      // 多轮工具调用会重复返回同一批片段：先去重再累计，
      // 否则引用面板出现重复条目，前端以「文档-切片」为 key 时还会触发 React 重复 key 警告
      citations = dedupeCitations([...citations, ...(result.citations ?? [])])
      if (result.dataFreshness) freshnessList.push(result.dataFreshness)
      if (Array.isArray(result.blocks) && result.blocks.length > 0) {
        answerBlocks.push(...result.blocks)
      }
      roundResults.push({
        toolName,
        status: result.status,
        summary: result.summary,
        rows,
        rowCount: result.rowCount,
        truncated: Boolean(result.truncated),
        dataFreshness: result.dataFreshness,
        // 服务端算出的分析结论：模型据此组织回答，不得自己重算或改写数字
        analysis: result.analysis ?? null,
        // 结构化块只把"有哪些块"告知模型，实际数据由前端渲染，避免重复占用上下文
        viewSummary: Array.isArray(result.blocks) && result.blocks.length > 0
          ? result.blocks.map((block) => ({ kind: block.kind, title: block.title, rows: block.rows?.length ?? block.items?.length ?? 0 }))
          : null,
        // 演示 provider 需要它来判断来源；真实模型也会看到，属于事实元信息
        sourceTypeHint: rows[0]?.sourceType ?? null,
      })
    }

    if (blockedTool || failedTool) break

    // ── 步骤 9：结果回灌模型（含数据时效元信息）
    messages = [
      ...baseMessages,
      { role: 'assistant', content: completion.content ?? '', tool_calls: toOpenAiToolCalls(completion.toolCalls) },
      ...roundResults.map((result, index) => ({
        role: 'tool',
        tool_call_id: completion.toolCalls[index]?.id ?? `call_${index}`,
        content: JSON.stringify(result),
      })),
    ]

    // 只有知识片段（带 snippet 字段）才包装成不可信数据块；
    // 数据类工具的行是结构化业务数据，走工具消息 JSON，不当作文档引用处理
    const knowledgeRows = roundResults
      .flatMap((result) => result.rows)
      .filter((row) => row && typeof row.snippet === 'string')
    const referenceData = wrapReferenceData(knowledgeRows)
    const messagesWithReference = referenceData
      ? [
          messages[0],
          {
            role: 'system',
            content: referenceData,
          },
          ...messages.slice(1),
        ]
      : messages

    try {
      emit(EVENT.status, {
        data: { step: 'answer', state: 'running', label: '正在汇总结论…' },
      })
      completion = await provider.complete({
        messages: messagesWithReference,
        tools: openAiTools,
        signal,
        onDelta: streamDelta,
      })
      answer = completion.content || answer
      // 新一轮的 completion 尚未计过 token：交给收尾逻辑（若循环到此结束）或下一轮循环处理
      completionCounted = false
    } catch (error) {
      return await finishWithModelError(error)
    }
  }

  if (!completionCounted) {
    tokensIn += Number(completion?.tokensIn ?? 0)
    tokensOut += Number(completion?.tokensOut ?? 0)
  }

  // ── 失败路径：拦截优先，其次工具失败；都不编造数据
  if (blockedTool) {
    status = CHAT_STATUS.blocked
    answer = BLOCKED_ANSWER
    // 前端可能已经收到模型的半成品文本，先让它清空再显示统一文案
    emit(EVENT.reset, { data: { reason: 'blocked' } })
    streamDelta(answer)
  } else if (failedTool) {
    status = CHAT_STATUS.error
    emit(EVENT.reset, { data: { reason: 'tool_error' } })
    answer = toolFailureAnswer(toolLabel(failedTool.toolName))
    streamDelta(answer)
  } else if (!answer) {
    const searchRun = toolRuns.find((run) => run.toolName === 'search_knowledge' && run.status === 'ok')
    if (searchRun && searchRun.rowCount === 0) {
      // 检索确实没有命中：明确回答未找到
      answer = NO_RESULT_ANSWER
      streamDelta(answer)
    } else if (referenceRows.length > 0) {
      // 检索有结果但模型没给出总结：按 §9 可用性要求降级返回原文，并明确提示降级状态
      answer = buildDegradedAnswer(referenceRows)
      streamDelta(answer)
    } else {
      status = CHAT_STATUS.error
      answer = MODEL_ERROR_ANSWER
      streamDelta(answer)
    }
  }

  // ── 服务端强制约束（不依赖模型自觉）
  if (status === CHAT_STATUS.ok && answer) {
    const wording = enforcePermissionWording(answer, {
      registeredToolNames: registeredTools.map((tool) => tool.name),
      allToolNames: allToolNames,
    })
    if (wording.replaced || wording.canonical) {
      status = CHAT_STATUS.blocked
      if (wording.replaced) {
        // 模型用自己的话描述工具/权限范围或直接拒绝：统一替换为固定文案
        answer = wording.answer
        emit(EVENT.reset, { data: { reason: 'permission_wording' } })
        streamDelta(answer)
      }
      // 无论文案是否被替换，越权请求都必须写「被拦截」审计（需求文档 §3.2）
      await deps.recordAudit({
        actorId: user.id,
        action: 'tool_blocked',
        targetType: 'ai_conversation',
        targetId: conversation.id,
        detail: {
          reason: wording.reason,
          replaced: wording.replaced,
          conversationId: conversation.id,
        },
        ip,
      })
    }
  }

  // 声明条兜底：基于导入类数据作答时必须声明数据来源与数据截至（需求文档 §5.1 固定展示）
  // 仅在"确实用到了引用文档"时追加声明条：未找到内容的回答加声明条纯属噪声
  if (status === CHAT_STATUS.ok && answer && citations.length > 0 && freshnessList.length > 0) {
    const freshness = dedupeFreshness(freshnessList)
    const declaration = ensureFreshnessDeclaration(answer, freshness, {
      scopeLabel: user.role === 'admin' ? '全部生效知识文档与业务数据' : '全体可见的生效知识文档',
    })
    if (declaration.appended) {
      answer = declaration.answer
      // 已流式输出过的内容无法收回，追加部分单独补发
      streamDelta(declaration.appendedText ?? '')
    }
  }

  // 注入痕迹留证（不改变回答，只记录）
  for (const row of referenceRows) {
    const signals = detectInjectionSignals(row.snippet ?? '')
    if (signals.length > 0) injectionSignals.push(...signals)
  }
  if (injectionSignals.length > 0) {
    await deps.recordAudit({
      actorId: user.id,
      action: 'injection_detected',
      targetType: 'ai_conversation',
      targetId: conversation.id,
      detail: {
        patterns: [...new Set(injectionSignals)].slice(0, 10),
        documentIds: [...new Set(referenceRows.map((row) => row.documentId).filter(Boolean))],
      },
      ip,
    })
  }

  const latencyMs = Date.now() - startedAt

  // ── 步骤 10：[审计④] 回答全文 + 引用 + 耗时 + token + 终态
  const assistantMessage = await deps.repo.appendMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: answer,
    status,
    provider: provider.name,
    model: provider.model,
    tokensIn,
    tokensOut,
    latencyMs,
    citations,
    // 被拦截 / 失败的回答不带数据块，避免展示与结论不符的表格
    blocks: status === CHAT_STATUS.ok ? answerBlocks : [],
  })

  const dataFreshness = dedupeFreshness(freshnessList)
  const payload = {
    conversationId: conversation.id,
    messageId: assistantMessage.id,
    status,
    answer,
    citations,
    blocks: status === CHAT_STATUS.ok ? answerBlocks : [],
    toolRuns,
    provider: providerInfo,
    latencyMs,
    tokensIn,
    tokensOut,
    dataFreshness,
    blocked: status === CHAT_STATUS.blocked,
  }
  emit(EVENT.status, { data: { step: 'answer', state: 'done', label: '✓ 已完成' } })
  emit(EVENT.done, { data: payload })
  return payload

  /**
   * 模型不可用/超时：明确报错，不编造答案（§5.1 失败处理）。
   * 用户主动停止生成时不写错误回答，只保留提问。
   */
  async function finishWithModelError(error) {
    const aborted = signal?.aborted || error?.name === 'AbortError'
    if (aborted) {
      const payload = {
        conversationId: conversation.id,
        messageId: null,
        status: 'aborted',
        answer: '',
        citations: [],
        toolRuns,
        provider: providerInfo,
        latencyMs: Date.now() - startedAt,
        aborted: true,
      }
      emit(EVENT.reset, { data: { reason: 'aborted' } })
      emit(EVENT.done, { data: payload })
      return payload
    }

    const message = MODEL_ERROR_ANSWER
    streamDelta(message)
    const assistantMessage = await deps.repo.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: message,
      status: CHAT_STATUS.error,
      provider: provider.name,
      model: provider.model,
      latencyMs: Date.now() - startedAt,
    })
    const detail = error?.message ?? '未知错误'
    emit(EVENT.error, { data: { message, detail, code: ERROR_CODE.modelUnavailable } })
    const payload = {
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      status: CHAT_STATUS.error,
      code: ERROR_CODE.modelUnavailable,
      answer: message,
      citations: [],
      toolRuns,
      provider: providerInfo,
      latencyMs: Date.now() - startedAt,
    }
    emit(EVENT.done, { data: payload })
    return payload
  }
}

function toOpenAiToolCalls(toolCalls) {
  return (toolCalls ?? []).map((call, index) => ({
    id: call?.id ?? `call_${index}`,
    type: 'function',
    function: {
      name: call?.name ?? '',
      arguments: JSON.stringify(call?.arguments ?? {}),
    },
  }))
}

/** 合并各工具返回的 dataFreshness，供回答卡片的声明条使用（按数据集去重）。 */
export function dedupeFreshness(list) {
  const seen = new Map()
  for (const item of Array.isArray(list) ? list : []) {
    if (!item) continue
    const key = item.dataset ?? item.label ?? 'unknown'
    const existing = seen.get(key)
    const existingAt = existing?.importedAt ? new Date(existing.importedAt).getTime() : 0
    const currentAt = item.importedAt ? new Date(item.importedAt).getTime() : 0
    if (!existing || currentAt > existingAt) seen.set(key, item)
  }
  return [...seen.values()]
}

/**
 * 合并多轮工具调用产生的引用，按「文档 + 切片」/「数据集 + 周期」去重。
 *
 * 为什么必须有：模型在一次问答里可能连续两轮调用 search_knowledge（不同措辞），
 * 两轮都会返回同一批片段；直接 push 会让回答卡片的「引用来源」出现重复条目，
 * 前端以 `文档-切片` 为 key 渲染时还会触发 React 重复 key 警告（实测出现过）。
 * 去重规则：同一片段只保留首次出现的位置，顺序不变。
 */
export function dedupeCitations(list) {
  const seen = new Set()
  const result = []
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object') continue
    const key =
      item.kind === 'dataset' || item.dataset
        ? `dataset:${item.dataset ?? ''}:${item.periodEnd ?? ''}`
        : item.documentId
          ? `document:${item.documentId}:${item.chunkIndex ?? 0}`
          : `title:${item.title ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

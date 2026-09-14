/**
 * 知识沉淀抽取（手动触发）。
 *
 * 三条不可动摇的规则（与 A9「失败不编造」验收口径一致）：
 *   1. 模型输出解析失败 → 抛错，由调用方降级为**原文草稿**（fallbackDraft），绝不猜测内容；
 *   2. 字段白名单：只接受技能契约里声明的字段，模型多给的键一律丢弃；
 *   3. 会话内容一律包进不可信数据块（同 prompt.mjs 的 <reference-data> 约定），
 *      内容里试图闭合数据块的标签会被转义，防止"会话内容逃逸成指令"。
 *
 * 自动沉淀（会话结束触发）下一轮实现：技能契约里 triggers.onConversationEnd 已预留为 false。
 */
import { query } from '../db.mjs'
import { loadHistory } from './conversations.mjs'

export class DistillParseError extends Error {}

export const CONVERSATION_TAG_OPEN = '<conversation-data>'
export const CONVERSATION_TAG_CLOSE = '</conversation-data>'

export const MIN_ANSWER_LENGTH = 20
export const MAX_TITLE_LENGTH = 40
const NOTE_TITLE_LIMIT = 200
export const FALLBACK_TITLE_SUFFIX = '（待补充）'

/**
 * 会话内容转义：把标签的尖括号换成全角，避免内容提前闭合数据块。
 * 与 prompt.mjs 的 escapeReferenceTags 同一思路，这里只处理会话数据块标签。
 */
function escapeConversationTags(text) {
  return String(text ?? '')
    .replaceAll(CONVERSATION_TAG_OPEN, '＜conversation-data＞')
    .replaceAll(CONVERSATION_TAG_CLOSE, '＜/conversation-data＞')
}

/** 会话是否值得沉淀：至少有一条成功的、有实质内容的回答。 */
export function shouldOfferDistill({ messages = [] } = {}) {
  const list = Array.isArray(messages) ? messages : []
  return list.some((message) => {
    if (!message || message.role !== 'assistant') return false
    if (message.status && message.status !== 'ok') return false
    return typeof message.content === 'string' && message.content.trim().length >= MIN_ANSWER_LENGTH
  })
}

export function buildDistillMessages({ messages = [], skill = {}, fields = [] } = {}) {
  const fieldLines = fields.map(
    (field) => `- ${field.key}（${field.label}）：${field.hint}${field.required ? '，必填' : ''}`
  )
  const systemPrompt = [
    String(skill.body ?? '').trim(),
    '',
    '本次需要整理的字段：',
    ...fieldLines,
  ].join('\n')

  const conversation = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
    .map((message) => {
      const speaker = message.role === 'user' ? '提问' : '回答'
      return `${speaker}：${escapeConversationTags(String(message.content ?? '').trim())}`
    })
    .filter((line) => line.trim().length > 0)
    .join('\n---\n')

  const userPrompt = [
    '下面是这次问答的完整内容，请据此整理经验条目：',
    `${CONVERSATION_TAG_OPEN}`,
    conversation,
    `${CONVERSATION_TAG_CLOSE}`,
  ].join('\n')

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]
}

/** 从模型输出里抠出 JSON：容忍 ```json 代码块与前后说明文字。 */
function extractJson(text) {
  const raw = String(text ?? '').trim()
  if (!raw) throw new DistillParseError('模型没有返回内容。')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new DistillParseError('模型输出中没有 JSON 对象。')
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    throw new DistillParseError('模型输出的 JSON 无法解析。')
  }
}

function asText(value, max) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

/** 成对引号：模型经常把原文引句包在引号里，核对前先脱掉这层包装。 */
const QUOTE_CHARS = new Set(['"', "'", '‘', '’', '“', '”', '「', '」', '『', '』', '《', '》', '〈', '〉'])

/**
 * 原文依据的规范化（用于逐字核对）。
 *
 * 只允许三类无信息损失的规整：统一换行（\r\n → \n）、去掉每行首尾空白、脱掉成对的中英文引号。
 * **不**做分词、标点归一或相似度匹配——审核人要靠这段原文判断可信度，
 * 一旦允许"差不多就算命中"，模型捏造的引句就能蒙混过关（违反 A9）。
 */
export function normalizeEvidenceText(value) {
  let text = String(value ?? '').replace(/\r\n?/g, '\n')
  text = text
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
  while (text.length >= 2 && QUOTE_CHARS.has(text[0]) && QUOTE_CHARS.has(text[text.length - 1])) {
    text = text.slice(1, -1).trim()
  }
  return text
}

/**
 * 原文依据是否真出自这次会话（纯函数，服务端校验，不依赖模型自觉）。
 *
 * 提示词已经要求 evidence 必须是会话原文，但真实模型会改写、拼接甚至编造；
 * 未经核对的引句会让审核人误以为"会话里就是这么说的"，因此这里逐字比对：
 * 规范化后的 evidence 必须是某条 user / assistant 消息的真实子串。
 */
export function isEvidenceFromConversation(evidence, messages = []) {
  const target = normalizeEvidenceText(evidence)
  if (!target) return false
  const list = Array.isArray(messages) ? messages : []
  return list.some((message) => {
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) return false
    const content = normalizeEvidenceText(message.content)
    return content.length > 0 && content.includes(target)
  })
}

/**
 * 解析抽取结果。
 * - 标题缺失时用首个非空字段兜底（否则整条经验会因为没标题而丢掉）；
 * - 字段与概述都为空视为"没有可沉淀的内容"，抛错让调用方走降级草稿。
 */
export function parseDistillResponse(text, fields = []) {
  const payload = extractJson(text)
  const allowedKeys = fields.map((field) => field.key)

  const parsedFields = {}
  const source = payload.fields && typeof payload.fields === 'object' && !Array.isArray(payload.fields) ? payload.fields : {}
  for (const key of allowedKeys) {
    const value = asText(source[key], 2000)
    if (value) parsedFields[key] = value
  }

  const summary = asText(payload.summary, 500)
  const evidence = asText(payload.evidence, 500)

  let title = asText(payload.title, MAX_TITLE_LENGTH)
  if (!title) {
    const firstValue = allowedKeys.map((key) => parsedFields[key]).find(Boolean) ?? ''
    title = firstValue.slice(0, MAX_TITLE_LENGTH)
  }
  if (!title) throw new DistillParseError('模型没有给出标题，也没有可用的字段内容。')
  if (Object.keys(parsedFields).length === 0 && !summary) {
    throw new DistillParseError('模型没有抽出任何可沉淀的内容。')
  }

  return { title, summary, evidence, fields: parsedFields }
}

/**
 * 降级草稿：模型不可用或解析失败时的兜底。
 *
 * 为什么不是"直接失败"：用户点「沉淀为知识」的意图明确，会话原文本身就有价值；
 * 这里只做**搬运**（把最后一条回答原文放进 evidence），一个字都不生成，
 * 并且标记 degraded = true，界面上明确提示"字段待补充"。
 */
export function fallbackDraft({ conversation = {}, messages = [] } = {}) {
  const list = Array.isArray(messages) ? messages : []
  const lastAnswer = [...list]
    .reverse()
    .find((message) => message?.role === 'assistant' && String(message.content ?? '').trim())
  const base = String(conversation.title ?? '').trim() || '未命名会话'
  const title = `${base.slice(0, NOTE_TITLE_LIMIT - FALLBACK_TITLE_SUFFIX.length)}${FALLBACK_TITLE_SUFFIX}`
  return {
    title,
    summary: '',
    evidence: asText(lastAnswer?.content, 500),
    fields: {},
    degraded: true,
    // 原文搬运自带出处，不存在"核对不过"的情况；显式给出字段让前端形状稳定
    evidenceRejected: false,
  }
}

/**
 * 抽取一次沉淀草稿（不落库，由接口层返回给用户确认后再保存）。
 *
 * 返回 { draft, parseError }：模型调用失败或解析失败时 draft 是降级草稿，
 * parseError 非空用于界面提示"自动整理失败，已放入原文，请手动补充字段"。
 *
 * 模型给出的 evidence 一律经 isEvidenceFromConversation 逐字核对：
 * 核对不通过就置空并标记 evidenceRejected（界面提示"原文依据待补充"），
 * 但**不**把整条草稿标成 degraded —— 字段是真的抽出来了，不该谎报整理失败。
 */
export async function extractDistillDraft({ conversationId, messages, provider, skill, fields }) {
  if (!provider) {
    return { draft: fallbackDraft({ conversation: { title: '' }, messages }), parseError: '模型未配置' }
  }
  let content = ''
  let tokensIn = 0
  let tokensOut = 0
  try {
    const result = await provider.complete({
      messages: buildDistillMessages({ messages, skill, fields }),
    })
    content = result?.content ?? ''
    tokensIn = result?.tokensIn ?? 0
    tokensOut = result?.tokensOut ?? 0
  } catch (error) {
    return {
      draft: fallbackDraft({ conversation: { title: '' }, messages }),
      parseError: error?.message ?? '模型调用失败',
    }
  }
  try {
    const parsed = parseDistillResponse(content, fields)
    return { draft: verifyDraftEvidence({ ...parsed, degraded: false }, messages), tokensIn, tokensOut }
  } catch (error) {
    if (!(error instanceof DistillParseError)) throw error
    return {
      draft: fallbackDraft({ conversation: { title: '' }, messages }),
      parseError: error.message,
      tokensIn,
      tokensOut,
    }
  }
}

/**
 * 核对草稿里的原文依据：找不到就把 evidence 清空并置 evidenceRejected。
 * 降级草稿（原文搬运）本身就来自会话，必然通过核对。
 */
export function verifyDraftEvidence(draft, messages = []) {
  const evidence = String(draft?.evidence ?? '')
  if (!evidence.trim()) return { ...draft, evidence, evidenceRejected: false }
  if (isEvidenceFromConversation(evidence, messages)) {
    return { ...draft, evidence, evidenceRejected: false }
  }
  return { ...draft, evidence: '', evidenceRejected: true }
}

/** 读取会话消息用于抽取（按账号校验归属，别人的会话读不到）。 */
export async function loadConversationMessages({ userId, conversationId, limit = 20 }) {
  const owned = await query('SELECT id, user_id, title FROM ai_conversations WHERE id = $1 AND user_id = $2', [
    conversationId,
    userId,
  ])
  const conversation = owned.rows[0]
  if (!conversation) return null
  const messages = await loadHistory({ conversationId, limit })
  return { conversation: { id: conversation.id, title: conversation.title }, messages }
}

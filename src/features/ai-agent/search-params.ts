/**
 * AI 助手的 URL 参数解析（首页深链用）。
 *
 * `conversationId` 让「最近对话」直接打开那个会话，`focus=composer` 让「问 AI」进场即聚焦输入框。
 * 脏值一律忽略并回落默认行为：落不到具体会话时就是普通的新对话入口，不报错、不白屏。
 */
export type AiAgentSearch = {
  /** 进入后直接选中的会话（首页「最近对话」深链）。 */
  conversationId?: number
  /** `composer`：进场即聚焦输入框（首页「问 AI」深链）。 */
  focus?: 'composer'
}

export function parseAiAgentSearch(
  search: Record<string, unknown>
): AiAgentSearch {
  const result: AiAgentSearch = {}

  const id = toPositiveInt(search.conversationId)
  if (id !== null) result.conversationId = id
  if (search.focus === 'composer') result.focus = 'composer'

  return result
}

/** 只接受正整数：0、负数、小数、空串与非数字字符串一律视为"没有这个参数"。 */
function toPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}

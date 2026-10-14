/**
 * 流式卡片与「已落库消息」的重叠判定（纯函数，便于单测）。
 *
 * ### 为什么需要它（2026-09-22 用户报「发送一条消息，有时会展示出两条」）
 *
 * `send()` 的收尾是 `await refresh(...)` **之后**才 `setStream(null)`；而 `refresh` 一旦让
 * React Query 把新消息写进缓存，`persisted` 里就同时包含了这一问一答 —— 于是**流式卡片**
 * 与**落库卡片**在同一帧里各渲染一份。是否看得见取决于 refetch 快慢，所以现象是"有时两条"。
 *
 * ### 判据为什么用消息 id，而不是问题文本
 *
 * 同一句话连问两次是完全正常的用法（"再问一遍""刚才那个再查一次"），按文本去重会把
 * 第二次的问答整块吞掉。服务端已经下发两个可靠 id：`meta.messageId`（用户消息）与
 * `done.messageId`（助手消息），因此这里只认 id。
 */
export type StreamMessageIds = {
  userMessageId?: number | null
  assistantMessageId?: number | null
}

export type StreamOverlap = {
  /** 本轮的用户消息已经在 `persisted` 里（不必再画乐观气泡） */
  questionPersisted: boolean
  /** 本轮的助手回答已经在 `persisted` 里（流式卡片已被它覆盖） */
  answerPersisted: boolean
  /** 一问一答**都**落库：流式块整体撤下，避免与落库卡片重复 */
  fullyPersisted: boolean
}

export function streamOverlapsPersisted(
  persistedIds: ReadonlySet<number>,
  stream: StreamMessageIds | null | undefined
): StreamOverlap {
  const questionPersisted =
    stream?.userMessageId != null && persistedIds.has(stream.userMessageId)
  const answerPersisted =
    stream?.assistantMessageId != null &&
    persistedIds.has(stream.assistantMessageId)
  return {
    questionPersisted,
    answerPersisted,
    /*
     * 必须两者齐全才撤下整个流式块：只落了用户消息时（模型还在生成 / 中途报错）
     * 撤下会把正在看的回答一起藏起来。
     */
    fullyPersisted: questionPersisted && answerPersisted,
  }
}

/**
 * `meta` 事件的合并规则：**字段没带就保持原值，不要覆盖成 undefined**。
 *
 * ### 为什么（2026-09-22 实测根因）
 *
 * 服务端每轮会发**两条** `meta`：第一条带 `conversationId` / `messageId` / `provider`，
 * 第二条只带 `registeredTools`（工具裁剪结果）。最初的写法是直接赋值
 * `userMessageId: event.data.messageId`，于是第二条 meta 把刚记下的用户消息 id
 * **覆盖成 undefined** —— `streamOverlapsPersisted()` 再也认不出"用户消息已落库"，
 * 乐观气泡与落库气泡就会同时渲染（实测：`SSE meta.userMessageId = undefined`，
 * 而库里该条 user 消息 id 是 1327；用户看到的就是"发送一条消息展示出两条"）。
 */
export type MetaPatchInput = {
  conversationId?: number | null
  messageId?: number | null
}

export type MetaPatchState = {
  conversationId: number | null
  userMessageId?: number | null
}

export function applyMetaPatch<S extends MetaPatchState>(
  previous: S,
  data: MetaPatchInput
): S {
  return {
    ...previous,
    conversationId: data.conversationId ?? previous.conversationId,
    userMessageId: data.messageId ?? previous.userMessageId,
  }
}

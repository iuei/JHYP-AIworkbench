import { describe, expect, it } from 'vitest'
import { applyMetaPatch, streamOverlapsPersisted } from './stream-merge'

/**
 * 流式卡片去重判据（2026-09-22 修「一条消息有时显示两条」）。
 *
 * 复现的是 `send()` 收尾的顺序：`await refresh()` 让 persisted 拿到新消息，而
 * `setStream(null)` 还没执行 —— 这一窗口里两张卡片会同时渲染。
 */
describe('streamOverlapsPersisted', () => {
  it('一问一答都落库时判为完全重叠（流式块必须撤下）', () => {
    const overlap = streamOverlapsPersisted(new Set([11, 12]), {
      userMessageId: 11,
      assistantMessageId: 12,
    })
    expect(overlap).toEqual({
      questionPersisted: true,
      answerPersisted: true,
      fullyPersisted: true,
    })
  })

  it('只落了用户消息时不算完全重叠（模型还在生成，撤下会把回答藏掉）', () => {
    const overlap = streamOverlapsPersisted(new Set([11]), {
      userMessageId: 11,
      assistantMessageId: 12,
    })
    expect(overlap.questionPersisted).toBe(true)
    expect(overlap.answerPersisted).toBe(false)
    expect(overlap.fullyPersisted).toBe(false)
  })

  it('一条都没落库（正在流式）时完全不重叠', () => {
    const overlap = streamOverlapsPersisted(new Set([9, 10]), {
      userMessageId: 11,
      assistantMessageId: 12,
    })
    expect(overlap.fullyPersisted).toBe(false)
    expect(overlap.questionPersisted).toBe(false)
    expect(overlap.answerPersisted).toBe(false)
  })

  it('id 缺失（中止 / 服务端没给 messageId）时不判定为重叠', () => {
    for (const stream of [
      { userMessageId: null, assistantMessageId: null },
      { userMessageId: undefined, assistantMessageId: undefined },
      // 中止的回答 messageId 为 null：不能因为"集合里恰好有别的消息"就撤下流式块
      { userMessageId: 11, assistantMessageId: null },
      null,
      undefined,
    ]) {
      const overlap = streamOverlapsPersisted(new Set([11, 12]), stream)
      expect(overlap.fullyPersisted).toBe(false)
    }
  })

  it('按 id 而不是按文本去重：同一句话连问两次时第二次仍会渲染', () => {
    // 第一次的问答（11/12）已落库；第二次刚发出（13），助手消息还没落库
    const overlap = streamOverlapsPersisted(new Set([11, 12]), {
      userMessageId: 13,
      assistantMessageId: null,
    })
    expect(overlap.questionPersisted).toBe(false)
    expect(overlap.fullyPersisted).toBe(false)
  })
})

/**
 * `meta` 合并规则（2026-09-22 实测根因）。
 *
 * 服务端每轮发**两条** meta：第一条带会话/消息 id，第二条只带 `registeredTools`。
 * 最初的写法是直接赋值，第二条把 `userMessageId` 覆盖成 undefined —— 于是
 * `streamOverlapsPersisted()` 认不出"用户消息已落库"，乐观气泡与落库气泡同时出现，
 * 用户看到"发送一条消息展示出两条"。实测：`SSE meta.userMessageId = undefined`，
 * 而库里 user 消息 id 是 1327。
 */
describe('applyMetaPatch', () => {
  it('第二条只带 registeredTools 的 meta 不会清空已记录的会话与用户消息 id', () => {
    const first = applyMetaPatch(
      { conversationId: null, userMessageId: null, question: 'x' },
      { conversationId: 7, messageId: 11 }
    )
    expect(first).toMatchObject({ conversationId: 7, userMessageId: 11 })

    const second = applyMetaPatch(first, {})
    expect(second.conversationId).toBe(7)
    expect(second.userMessageId).toBe(11)
  })

  it('字段为 null 同样不覆盖（缺省与显式 null 一视同仁）', () => {
    const patched = applyMetaPatch(
      { conversationId: 7, userMessageId: 11 },
      { conversationId: null, messageId: null }
    )
    expect(patched).toMatchObject({ conversationId: 7, userMessageId: 11 })
  })

  it('带上新值时正常更新（新会话从 null 变成服务端 id）', () => {
    const patched = applyMetaPatch(
      { conversationId: null, userMessageId: undefined },
      { conversationId: 9, messageId: 21 }
    )
    expect(patched.conversationId).toBe(9)
    expect(patched.userMessageId).toBe(21)
  })
})

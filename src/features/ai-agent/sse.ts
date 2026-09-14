/**
 * SSE 客户端。
 *
 * 需求文档 §6.2：流式接口不使用 axios 默认拦截器，需单独封装 SSE 客户端。
 * 这里用 fetch + ReadableStream 手工解析 SSE，支持 AbortSignal 停止生成。
 */
import { useAuthStore } from '@/stores/auth-store'
import type { Citation, ProviderInfo, StreamStep, ToolRun } from './types'

const BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787/api'

export interface ChatMetaPayload {
  conversationId: number
  messageId: number
  question?: string
  provider?: ProviderInfo
  maxTurns?: number
  turn?: number
  registeredTools?: string[]
}

export interface ChatStatusPayload {
  step: string
  state: 'running' | 'done' | 'failed'
  label: string
  toolName?: string
  summary?: string
}

export interface ChatDonePayload {
  blocks?: import('./types').AnswerBlock[]
  conversationId: number
  messageId: number | null
  status: 'ok' | 'blocked' | 'error' | 'aborted'
  code?: string
  answer: string
  citations: Citation[]
  toolRuns: ToolRun[]
  provider: ProviderInfo
  latencyMs: number
  tokensIn?: number
  tokensOut?: number
  dataFreshness?: Array<{
    dataset: string
    label?: string
    importedAt: string | null
  }>
  blocked?: boolean
  aborted?: boolean
}

export type ChatEvent =
  | { type: 'meta'; data: ChatMetaPayload }
  | { type: 'status'; data: ChatStatusPayload }
  | { type: 'reset'; data: { reason: string } }
  | { type: 'delta'; data: { text: string } }
  | { type: 'done'; data: ChatDonePayload }
  | { type: 'error'; data: { message: string; code?: string; detail?: string } }

export class ChatStreamError extends Error {}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

/** 把编排步骤事件转成可渲染的步骤条目。 */
export function toStreamStep(payload: ChatStatusPayload): StreamStep {
  return {
    key: `${payload.step}-${payload.toolName ?? 'general'}`,
    label: payload.label,
    state: payload.state,
    toolName: payload.toolName,
  }
}

/** 合并步骤：同一 key 由 running 更新为 done / failed，并保持顺序。 */
export function mergeStreamStep(
  steps: StreamStep[],
  next: StreamStep
): StreamStep[] {
  const index = steps.findIndex((step) => step.key === next.key)
  if (index === -1) return [...steps, next]
  const merged = [...steps]
  merged[index] = next
  return merged
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const text = await response.text()
    const parsed = JSON.parse(text) as { message?: string }
    return parsed.message ?? '请求失败，请稍后重试。'
  } catch {
    return '请求失败，请稍后重试。'
  }
}

export interface StreamChatOptions {
  conversationId: number | null
  content: string
  onEvent: (event: ChatEvent) => void
  signal?: AbortSignal
}

/** 发起一次流式问答，逐条回调 SSE 事件。 */
export async function streamChat({
  conversationId,
  content,
  onEvent,
  signal,
}: StreamChatOptions): Promise<void> {
  const token = useAuthStore.getState().auth.accessToken
  const response = await fetch(`${BASE_URL}/ai/chat`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ conversationId, content }),
    signal,
  })

  if (!response.ok) {
    throw new ChatStreamError(await readErrorMessage(response))
  }
  if (!response.body) {
    throw new ChatStreamError('服务端未返回流式响应，请稍后重试。')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload) continue
      try {
        onEvent(JSON.parse(payload) as ChatEvent)
      } catch {
        // 无法解析的帧直接跳过，避免单帧异常打断整条流
      }
    }
  }
}

/**
 * OpenAI 兼容协议的云模型适配器（需求文档 §8.3）。
 *
 * 所有模型调用只经过 providers/ 这一层，二期切换内网私有模型时只改这里与配置，
 * 不改编排层与业务代码。API Key 只从环境变量注入，不写入代码库。
 */

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'

function safeParseArguments(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 累积流式返回的 tool_calls 分片（arguments 是逐字拼接的）。 */
function accumulateToolCalls(target, deltas = []) {
  for (const delta of deltas) {
    const index = Number.isInteger(delta?.index) ? delta.index : target.length
    const entry = target[index] ?? { id: '', name: '', arguments: '' }
    if (delta?.id) entry.id = delta.id
    if (delta?.function?.name) entry.name += delta.function.name
    if (delta?.function?.arguments) entry.arguments += delta.function.arguments
    target[index] = entry
  }
}

/**
 * 解析 OpenAI 兼容的 SSE 流。
 * 返回 { content, toolCalls, tokensIn, tokensOut }。
 */
export async function parseOpenAiStream(body, onDelta) {
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let tokensIn = 0
  let tokensOut = 0
  const toolCallParts = []

  const handleLine = (line) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) return false
    const payload = trimmed.slice(5).trim()
    if (payload === '[DONE]') return true
    let chunk
    try {
      chunk = JSON.parse(payload)
    } catch {
      return false
    }
    if (chunk?.usage) {
      tokensIn = Number(chunk.usage.prompt_tokens ?? tokensIn)
      tokensOut = Number(chunk.usage.completion_tokens ?? tokensOut)
    }
    const delta = chunk?.choices?.[0]?.delta
    if (!delta) return false
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content
      if (typeof onDelta === 'function') onDelta(delta.content)
    }
    if (Array.isArray(delta.tool_calls)) accumulateToolCalls(toolCallParts, delta.tool_calls)
    return false
  }

  for await (const part of body) {
    buffer += decoder.decode(part, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (handleLine(line)) {
        return {
          content,
          toolCalls: finishToolCalls(toolCallParts),
          tokensIn,
          tokensOut,
        }
      }
    }
  }
  if (buffer) handleLine(buffer)

  return {
    content,
    toolCalls: finishToolCalls(toolCallParts),
    tokensIn,
    tokensOut,
  }
}

function finishToolCalls(parts) {
  return parts
    .filter(Boolean)
    .filter((part) => part.name)
    .map((part) => ({
      id: part.id || `call-${part.name}`,
      name: part.name,
      arguments: safeParseArguments(part.arguments),
    }))
}

/**
 * 创建真实 provider。
 * 必须支持 Function Calling（tools / tool_calls），否则编排层的工具循环无法工作。
 */
export function createOpenAiCompatibleProvider({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  model = 'deepseek-chat',
  temperature = 0.2,
  maxOutputTokens = 2048,
  timeoutMs = 60000,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) throw new Error('缺少模型 API Key，无法创建真实 provider。')
  if (typeof fetchImpl !== 'function') throw new Error('运行环境不支持 fetch。')

  const endpoint = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`

  return {
    name: 'openai-compatible',
    mode: 'live',
    model,
    async complete({ messages = [], tools = [], signal, onDelta } = {}) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const abort = () => controller.abort()
      if (signal) {
        if (signal.aborted) controller.abort()
        else signal.addEventListener('abort', abort, { once: true })
      }

      const body = {
        model,
        messages,
        temperature,
        max_tokens: maxOutputTokens,
        stream: true,
        stream_options: { include_usage: true },
      }
      if (Array.isArray(tools) && tools.length > 0) {
        body.tools = tools
        body.tool_choice = 'auto'
      }

      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        if (!response.ok) {
          const detail = await safeReadError(response)
          throw new Error(`模型服务返回 ${response.status}${detail ? `：${detail}` : ''}`)
        }
        if (!response.body) {
          throw new Error('模型服务未返回流式响应。')
        }
        return await parseOpenAiStream(response.body, onDelta)
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw new Error(signal?.aborted ? '已停止生成。' : '模型服务响应超时。')
        }
        throw error
      } finally {
        clearTimeout(timer)
        if (signal) signal.removeEventListener('abort', abort)
      }
    },
  }
}

async function safeReadError(response) {
  try {
    const text = await response.text()
    return text.slice(0, 300)
  } catch {
    return ''
  }
}

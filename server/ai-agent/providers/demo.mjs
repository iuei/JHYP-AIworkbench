/**
 * 演示 provider（无云模型 key 时使用）。
 *
 * 存在的意义：让「权限裁剪 → 工具调用 → 检索 → 回答带出处 → 审计」这条链路在**没有 API Key**
 * 的环境下也能完整跑通与验收，并且与真实 provider 走**完全相同**的编排/权限/审计代码路径。
 *
 * 必须明确的边界：
 * - 它不做任何模型推理，回答由检索结果按固定模板汇总生成；
 * - 所有产物都带 mode = 'demo' 标记，UI 与审计中必须明示，禁止把它当作模型效果验收依据；
 * - 它的"意图识别"是正则规则，不是语义理解。
 */
import { flattenSnippetText, NO_RESULT_ANSWER } from '../prompt.mjs'
import { BLOCKED_MESSAGE } from '../permissions.mjs'

export const DEMO_MODE = 'demo'

/**
 * 意图 → 工具映射。
 * 注意：这里刻意返回**意图对应的工具名**，即使该工具没被注册给当前用户
 * （例如普通用户问"帮我把文档 3 下线"）。这用于模拟"模型幻想出无权工具"的场景，
 * 由编排层的执行前二次校验拦下并写审计——这是 A5 越权拦截的演示与验收通路。
 */
export const DEMO_INTENTS = [
  {
    tool: 'rebuild_knowledge_index',
    pattern: /(重建|重做|刷新|更新|重新生成)[^。！？]{0,8}索引/,
    describe: '请求重建知识索引',
    args: () => ({}),
  },
  {
    tool: 'deactivate_document',
    // 必须带明确意图（把/将/请/帮我 + 文档 + 下线）或"下线文档 ID 3"，避免把
    // "文档过期后会被下线吗"这类普通提问误判成管理操作
    pattern:
      /(把|将|请|帮我|麻烦)[^。！？]{0,12}(文档|资料|制度|知识)[^。！？]{0,8}(下线|停用|下架|作废)|(把|将|请|帮我|麻烦)[^。！？]{0,12}(下线|停用|下架|作废)[^。！？]{0,8}(文档|资料|制度|知识)|(下线|停用|下架|作废)[^。！？]{0,10}(文档|资料|制度|知识)[^。！？]{0,6}\d+/,
    describe: '请求下线知识文档',
    args: (question) => {
      const matched = String(question).match(/\d+/)
      return matched ? { documentId: Number(matched[0]) } : {}
    },
  },
  {
    tool: 'search_knowledge',
    pattern: /[\s\S]*/,
    describe: '检索企业知识库',
    args: (question) => ({ query: String(question).trim().slice(0, 200) }),
  },
]

/** 按规则挑出本轮要调用的工具（可能返回未注册的工具名，交由层② 拦截）。 */
export function planDemoToolCall(question) {
  const text = String(question ?? '')
  for (const intent of DEMO_INTENTS) {
    if (intent.pattern.test(text)) {
      return { name: intent.tool, arguments: intent.args(text), intent: intent.describe }
    }
  }
  return null
}

function formatDate(value) {
  if (!value) return '未知'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '未知' : date.toISOString().slice(0, 10)
}

/** 从 role = 'tool' 的消息里还原工具结果（编排层写入的是 JSON 字符串）。 */
export function parseToolMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === 'tool')
    .map((message) => {
      try {
        return JSON.parse(message.content)
      } catch {
        return { status: 'error', error: '工具结果无法解析', toolName: 'unknown' }
      }
    })
}

function declarationsOf(results) {
  const freshness = results.map((result) => result.dataFreshness).find(Boolean)
  const source = freshness?.label ?? '企业知识库'
  const until = formatDate(freshness?.importedAt)
  // 措辞禁忌：回答正文里**不能**出现「工具 / 能力 / 权限」紧接「列表 / 清单 / 白名单 / 范围」的组合
  // —— 那正是 `prompt.mjs` 的权限泄露模式。命中后编排层会把整段回答替换成统一拦截文案，
  // 并且记一条 `tool_blocked` 审计：演示模式的正常问答与越权指标会一起失真。
  // 声明条本身由服务端在检测之后追加（`ensureFreshnessDeclaration`），这里只是演示用的等价表述。
  return `📊 数据来源：${source} · 🕐 数据截至 ${until} · 🔒 检索范围：仅覆盖当前账号可见的文档`
}

function composeFromSearch(result) {
  const rows = Array.isArray(result.rows) ? result.rows : []
  if (rows.length === 0) {
    return [
      '## 结论',
      '',
      NO_RESULT_ANSWER,
      '',
      '## 说明',
      '',
      '- 该问题在知识库现有文档中没有匹配内容，请确认是否已有对应制度或 SOP 文档。',
      '- 如需补充内容，可联系管理员上传。',
      '',
      '---',
      declarationsOf([result]),
    ].join('\n')
  }

  // 正文只列要点，不列引用清单与文档出处：依据统一由界面侧栏展示
  // （与提示词第 4 条、`orchestrator.selectTopDocumentCitations` 的口径一致）。
  // 用 `-` 而非 `1.`：检索片段是并列要点、不是执行步骤（骨架 F3）。
  const steps = rows.map((row) => {
    const snippet = flattenSnippetText(row.snippet, { maxChars: 160 })
    return `- ${snippet}`
  })

  return [
    '## 结论',
    '',
    `已从知识库检索到 ${rows.length} 个相关片段，要点如下。`,
    '',
    '## 说明',
    '',
    ...steps,
    '',
    '---',
    declarationsOf([result]),
  ].join('\n')
}

function composeFromAdminTool(result) {
  const rows = Array.isArray(result.rows) ? result.rows : []
  // 每个字段单独一行：原先把整行字段用「，」拼成一句，字段一多就成一条读不完的长句
  const detail = rows.length
    ? rows
        .map((row) =>
          Object.entries(row)
            .map(([key, value]) => `- ${key}：${value}`)
            .join('\n')
        )
        .join('\n')
    : '- （无返回明细）'
  return [
    '## 结论',
    '',
    result.summary || '操作已完成。',
    '',
    '## 说明',
    '',
    detail,
    '',
    '---',
    declarationsOf([result]),
  ].join('\n')
}

/** 汇总工具结果生成回答（演示模式，非模型推理）。 */
export function composeDemoAnswer(results, { roleLabel = '普通用户' } = {}) {
  if (!Array.isArray(results) || results.length === 0) {
    return [
      '## 结论',
      '',
      NO_RESULT_ANSWER,
      '',
      '---',
      // 同 declarationsOf：措辞不能构成权限泄露模式，否则回答会被编排层判成越权拦截
      `📊 数据来源：企业知识库 · 🕐 数据截至 未知 · 🔒 检索范围：${roleLabel}`,
    ].join('\n')
  }

  const blocked = results.find((result) => result.status === 'blocked')
  if (blocked) {
    return [
      `结论：${BLOCKED_MESSAGE}`,
      '',
      '如需查询该数据，请联系管理员开通相应权限。',
    ].join('\n')
  }

  const failed = results.find((result) => result.status === 'error')
  if (failed) {
    return [
      '## 结论',
      '',
      `查询「${failed.toolName ?? '数据'}」失败，未能获取可用结果，因此无法给出结论。`,
      '',
      '## 说明',
      '',
      `- 失败原因：${failed.error ?? '未知错误'}`,
      '- 请稍后重试；若持续失败请联系管理员。',
      '- 本次回答不包含任何推测数据。',
    ].join('\n')
  }

  const search = results.find((result) => result.toolName === 'search_knowledge')
  const body = search ? composeFromSearch(search) : composeFromAdminTool(results[0])
  // 演示模式提示从**开头移到末尾**：开头的位置已被 `## 结论` 占用 —— 骨架要求首段固定是结论，
  // 提示挂在开头会让演示模式与真实模式的第一屏结构不一致。卡片头部本来就有「演示模式」徽章，
  // 这条说明是补充说明而非唯一提示，放末尾不损失边界信息。
  return [
    body,
    '',
    '> 演示模式：当前环境未接入云模型，以上内容由知识库检索结果直接汇总生成，仅用于链路演示。',
  ].join('\n')
}

function chunkTextForStream(text, size = 40) {
  const chunks = []
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size))
  }
  return chunks
}

/**
 * 创建演示 provider。契约与真实 provider 完全一致，便于直接替换。
 * 注意：这里刻意不读取 tools 参数——权限裁剪发生在编排层，本 provider 只负责"像模型一样"发意图。
 */
export function createDemoProvider({ model = 'demo-rule-based' } = {}) {
  const emit = async (onDelta, content) => {
    if (typeof onDelta !== 'function') return
    for (const piece of chunkTextForStream(content)) {
      onDelta(piece)
    }
  }

  return {
    name: 'demo',
    mode: DEMO_MODE,
    model,
    async complete({ messages = [], onDelta } = {}) {
      const hasToolResult = messages.some((message) => message?.role === 'tool')

      // 第一轮：产出工具调用意图
      if (!hasToolResult) {
        const lastUser = [...messages].reverse().find((message) => message?.role === 'user')
        const plan = planDemoToolCall(lastUser?.content ?? '')
        if (!plan) {
          const content = '我没有理解这个问题，请补充一下要查询的业务内容。'
          await emit(onDelta, content)
          return { content, toolCalls: [], tokensIn: 0, tokensOut: 0 }
        }
        return {
          content: '',
          toolCalls: [{ id: 'demo-call-1', name: plan.name, arguments: plan.arguments }],
          tokensIn: 0,
          tokensOut: 0,
        }
      }

      // 第二轮：依据工具结果生成回答
      const results = parseToolMessages(messages)
      const content = composeDemoAnswer(results)
      await emit(onDelta, content)
      return { content, toolCalls: [], tokensIn: 0, tokensOut: content.length }
    },
  }
}

export { chunkTextForStream }

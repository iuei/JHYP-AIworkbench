import assert from 'node:assert/strict'
import test from 'node:test'
import { composeDemoAnswer, createDemoProvider, planDemoToolCall } from './demo.mjs'
import { KEY_SOURCE, PROVIDER_MODE, describeProvider, resolveModelConfig, resolveProvider } from './index.mjs'
import { deriveKey, encryptSecret } from '../secrets.mjs'
import { enforcePermissionWording } from '../prompt.mjs'
import { parseOpenAiStream } from './openai-compatible.mjs'

const settings = { model_name: 'deepseek-chat', temperature: 0.2, max_output_tokens: 1024, request_timeout_ms: 30000 }

test('未配置 API Key 时回退到演示 provider', () => {
  const provider = resolveProvider({ settings, env: {} })
  assert.equal(provider.mode, PROVIDER_MODE.demo)
  assert.equal(provider.name, 'demo')
  assert.deepEqual(describeProvider(provider), {
    name: 'demo',
    mode: 'demo',
    model: 'deepseek-chat#demo',
    demo: true,
  })
})

test('配置 API Key 时使用真实 provider', () => {
  const provider = resolveProvider({
    settings,
    env: { AI_MODEL_API_KEY: 'sk-test', AI_MODEL_NAME: 'deepseek-chat' },
  })
  assert.equal(provider.mode, PROVIDER_MODE.live)
  assert.equal(provider.name, 'openai-compatible')
  assert.equal(provider.model, 'deepseek-chat')
  assert.equal(describeProvider(provider).demo, false)
})

test('空字符串 key 不视为已配置', () => {
  const provider = resolveProvider({ settings, env: { AI_MODEL_API_KEY: '   ' } })
  assert.equal(provider.mode, PROVIDER_MODE.demo)
})

test('缺少 API Key 时创建真实 provider 会直接报错', async () => {
  const { createOpenAiCompatibleProvider } = await import('./openai-compatible.mjs')
  assert.throws(() => createOpenAiCompatibleProvider({ apiKey: '' }), /缺少模型 API Key/)
})

/* ---------- 后台配置（数据库）优先 ---------- */

const TEST_SECRET = 'unit-test-secret-value-32-chars'
const TEST_ENV = { JWT_SECRET: TEST_SECRET }
const storedCipher = encryptSecret('sk-from-database-abcdefghijklmnop', deriveKey(TEST_SECRET))

test('数据库中的密钥优先于环境变量，且标明来源为 database', () => {
  const provider = resolveProvider({
    settings: { model_api_key_cipher: storedCipher, model_name: 'deepseek-chat' },
    env: { ...TEST_ENV, AI_MODEL_API_KEY: 'sk-from-env' },
  })
  assert.equal(provider.mode, PROVIDER_MODE.live)
  const config = resolveModelConfig({
    settings: { model_api_key_cipher: storedCipher, model_name: 'deepseek-chat' },
    env: { ...TEST_ENV, AI_MODEL_API_KEY: 'sk-from-env' },
  })
  assert.equal(config.keySource, KEY_SOURCE.database)
  assert.equal(config.apiKey, 'sk-from-database-abcdefghijklmnop')
})

test('没有数据库密钥时回退环境变量，来源标明 environment', () => {
  const config = resolveModelConfig({ settings: {}, env: { AI_MODEL_API_KEY: 'sk-env-only' } })
  assert.equal(config.apiKey, 'sk-env-only')
  assert.equal(config.keySource, KEY_SOURCE.environment)
  assert.equal(config.keyInvalid, false)
})

test('两处都没有密钥时来源为 none，provider 为演示模式', () => {
  const config = resolveModelConfig({ settings: {}, env: {} })
  assert.equal(config.apiKey, null)
  assert.equal(config.keySource, KEY_SOURCE.none)
  assert.equal(resolveProvider({ settings: {}, env: {} }).mode, PROVIDER_MODE.demo)
})

test('force_demo 开关强制演示模式，但不影响已保存的密钥判定', () => {
  const settings = { model_api_key_cipher: storedCipher, force_demo: true }
  const provider = resolveProvider({ settings, env: TEST_ENV })
  assert.equal(provider.mode, PROVIDER_MODE.demo)
  const config = resolveModelConfig({ settings, env: TEST_ENV })
  assert.equal(config.apiKey, 'sk-from-database-abcdefghijklmnop')
  assert.equal(config.forceDemo, true)
})

test('密文解不开时标记 keyInvalid 并回退到环境变量/演示模式', () => {
  // 换过 secret 的情况：旧密文解不开
  const rotatedEnv = { JWT_SECRET: 'a-completely-different-secret-value' }
  const config = resolveModelConfig({ settings: { model_api_key_cipher: storedCipher }, env: rotatedEnv })
  assert.equal(config.apiKey, null)
  assert.equal(config.keyInvalid, true)
  assert.equal(config.keyConfigured, true)
  assert.equal(resolveProvider({ settings: { model_api_key_cipher: storedCipher }, env: rotatedEnv }).mode, PROVIDER_MODE.demo)
})

test('Base URL 与模型名同样优先取数据库配置', () => {
  const config = resolveModelConfig({
    settings: { model_base_url: 'https://internal.example.com/v1', model_name: 'qwen-max' },
    env: { AI_MODEL_BASE_URL: 'https://api.deepseek.com/v1', AI_MODEL_NAME: 'deepseek-chat' },
  })
  assert.equal(config.baseUrl, 'https://internal.example.com/v1')
  assert.equal(config.model, 'qwen-max')
})

test('数据库未配置时 Base URL 与环境变量回退到默认值', () => {
  const config = resolveModelConfig({ settings: {}, env: {} })
  assert.equal(config.baseUrl, 'https://api.deepseek.com/v1')
  assert.equal(config.model, 'deepseek-chat')
})

test('describeProvider 不泄露密钥与 Base URL', () => {
  const provider = resolveProvider({ settings: { model_api_key_cipher: storedCipher }, env: TEST_ENV })
  const described = describeProvider(provider)
  assert.deepEqual(Object.keys(described).sort(), ['demo', 'mode', 'model', 'name'])
  assert.ok(!JSON.stringify(described).includes('sk-'))
  assert.ok(!JSON.stringify(described).includes('api.deepseek'))
})

test('演示 provider 对普通问题请求知识检索', async () => {
  const provider = createDemoProvider()
  const result = await provider.complete({
    messages: [{ role: 'user', content: '亚马逊断货怎么补货？' }],
    tools: [{ type: 'function', function: { name: 'search_knowledge' } }],
  })
  assert.equal(result.toolCalls.length, 1)
  assert.equal(result.toolCalls[0].name, 'search_knowledge')
  assert.equal(result.toolCalls[0].arguments.query, '亚马逊断货怎么补货？')
})

test('演示 provider 对管理意图返回对应工具名（即使该工具未注册给当前用户）', () => {
  const plan = planDemoToolCall('帮我把文档 3 下线')
  assert.equal(plan.name, 'deactivate_document')
  assert.equal(plan.arguments.documentId, 3)

  assert.equal(planDemoToolCall('帮我重建一下知识索引').name, 'rebuild_knowledge_index')
  assert.equal(planDemoToolCall('帮我重建一下知识索引').arguments.documentId, undefined)
})

test('演示 provider 不把普通提问误判成管理操作', () => {
  assert.equal(planDemoToolCall('文档过期后会被下线吗？').name, 'search_knowledge')
  assert.equal(planDemoToolCall('索引是怎么重建的？').name, 'search_knowledge')
  assert.equal(planDemoToolCall('库存还剩多少？').name, 'search_knowledge')
})

test('演示 provider 第二轮依据工具结果生成带出处与声明条的回答', async () => {
  const provider = createDemoProvider()
  const toolPayload = JSON.stringify({
    toolName: 'search_knowledge',
    status: 'ok',
    summary: '检索到 1 个相关片段',
    rows: [
      {
        title: '亚马逊断货补货流程',
        sourceType: 'upload',
        updatedAt: '2026-09-01T02:00:00.000Z',
        snippet: '第一步：确认断货天数；第二步：联系供应链确认到货时间。',
      },
    ],
    dataFreshness: { label: '知识库', importedAt: '2026-09-01T02:00:00.000Z' },
  })
  const deltas = []
  const result = await provider.complete({
    messages: [
      { role: 'user', content: '亚马逊断货怎么补货？' },
      { role: 'assistant', content: '' },
      { role: 'tool', content: toolPayload },
    ],
    onDelta: (piece) => deltas.push(piece),
  })

  assert.ok(result.content.includes('亚马逊断货补货流程'))
  assert.ok(result.content.includes('人工上传文档'))
  assert.ok(result.content.includes('2026-09-01'))
  assert.ok(result.content.includes('📊 数据来源'))
  assert.ok(result.content.includes('🕐 数据截至'))
  assert.ok(result.content.includes('🔒 检索范围'), '声明条措辞不能构成权限泄露模式')
  assert.ok(result.content.includes('演示模式'))
  assert.equal(deltas.join(''), result.content)
  assert.deepEqual(result.toolCalls, [])
})

test('演示 provider 的回答不会被权限措辞检测误判成越权拦截', () => {
  // 回归：模板里一旦出现「权限/能力/工具 + 范围/列表/清单/白名单」的组合，就会命中
  // prompt.mjs 的权限泄露模式 —— 编排层会把整段回答替换成统一拦截文案，并记一条
  // tool_blocked 审计。结果是演示模式下正常问答全变成拦截文案、越权指标被污染。
  const answer = composeDemoAnswer([
    {
      toolName: 'search_knowledge',
      status: 'ok',
      rows: [
        {
          title: '亚马逊断货补货流程',
          snippet: '断货后先看可售天数，再决定补货量。',
          sourceType: 'upload',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      dataFreshness: { label: '企业知识库', importedAt: '2026-09-01T00:00:00.000Z' },
    },
  ])

  const verdict = enforcePermissionWording(answer, {
    registeredToolNames: ['search_knowledge'],
    allToolNames: ['search_knowledge', 'deactivate_document'],
  })

  assert.equal(verdict.replaced, false, '演示回答不应被判为权限泄露')
  assert.equal(verdict.canonical, false)
  assert.equal(verdict.answer, answer)
})

test('演示 provider 对空检索结果明确回答未找到，不编造流程', () => {
  const answer = composeDemoAnswer([
    {
      toolName: 'search_knowledge',
      status: 'ok',
      rows: [],
      summary: '未检索到相关片段',
      dataFreshness: { label: '知识库', importedAt: null },
    },
  ])
  assert.ok(answer.includes('知识库中未找到相关内容。'))
  assert.ok(answer.includes('📊 数据来源'))
})

test('演示 provider 对被拦截结果返回统一无权文案', () => {
  const answer = composeDemoAnswer([
    { toolName: 'deactivate_document', status: 'blocked', error: '当前账号无权查询该数据，请联系管理员。' },
  ])
  assert.ok(answer.includes('当前账号无权查询该数据，请联系管理员。'))
})

test('演示 provider 对失败结果明确说明失败且不含推测数据', () => {
  const answer = composeDemoAnswer([
    { toolName: 'search_knowledge', status: 'error', error: '检索超时' },
  ])
  assert.ok(answer.includes('失败'))
  assert.ok(answer.includes('检索超时'))
  assert.ok(answer.includes('不包含任何推测数据'))
})

test('演示 provider 员工经验标注提报人，与制度文档区分', async () => {
  const provider = createDemoProvider()
  const result = await provider.complete({
    messages: [
      {
        role: 'tool',
        content: JSON.stringify({
          toolName: 'search_knowledge',
          status: 'ok',
          rows: [
            {
              title: '旺季备货踩坑记录',
              sourceType: 'experience',
              submitter: '张三',
              updatedAt: '2026-08-20T00:00:00.000Z',
              snippet: '提前 45 天锁仓，避免爆仓。',
            },
          ],
          dataFreshness: { label: '知识库', importedAt: '2026-08-20T00:00:00.000Z' },
        }),
      },
    ],
  })
  assert.ok(result.content.includes('员工经验'))
  assert.ok(result.content.includes('提报人 张三'))
})

test('openai-compatible 解析流式内容与 tool_calls 分片', async () => {
  const frames = [
    'data: {"choices":[{"delta":{"content":"结论"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"：已找到"}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search_knowledge","arguments":"{\\"query\\":"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"补货\\"}"}}]}}]}\n\n',
    'data: {"usage":{"prompt_tokens":12,"completion_tokens":7},"choices":[]}\n\n',
    'data: [DONE]\n\n',
  ]
  const stream = (async function* generate() {
    for (const frame of frames) yield new TextEncoder().encode(frame)
  })()

  const deltas = []
  const result = await parseOpenAiStream(stream, (piece) => deltas.push(piece))

  assert.equal(result.content, '结论：已找到')
  assert.deepEqual(deltas, ['结论', '：已找到'])
  assert.equal(result.toolCalls.length, 1)
  assert.equal(result.toolCalls[0].name, 'search_knowledge')
  assert.deepEqual(result.toolCalls[0].arguments, { query: '补货' })
  assert.equal(result.tokensIn, 12)
  assert.equal(result.tokensOut, 7)
})

test('openai-compatible 对损坏的 tool 参数不抛错', async () => {
  const stream = (async function* generate() {
    yield new TextEncoder().encode(
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"search_knowledge","arguments":"{坏掉的"}}]}}]}\n\n'
    )
  })()
  const result = await parseOpenAiStream(stream)
  assert.deepEqual(result.toolCalls[0].arguments, {})
  assert.equal(result.content, '')
})

test('openai-compatible 真实 provider 解析 401 并给出可读错误', async () => {
  const { createOpenAiCompatibleProvider } = await import('./openai-compatible.mjs')
  const provider = createOpenAiCompatibleProvider({
    apiKey: 'sk-bad',
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      text: async () => '{"error":"invalid key"}',
    }),
  })
  await assert.rejects(
    () => provider.complete({ messages: [{ role: 'user', content: '你好' }] }),
    /模型服务返回 401/
  )
})

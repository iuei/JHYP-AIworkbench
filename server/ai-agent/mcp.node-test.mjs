/**
 * 卖家精灵 MCP 接入的单测。
 *
 * 重点覆盖三类**只在真实服务上才会暴露、且后果严重**的行为：
 * 1. 密钥无效时 MCP 不报 HTTP 错误（`secret_invalid` 伪工具 / `ERROR_UNAUTHORIZED` 被包成正常数据）——
 *    不特判就会被误判成"连接成功"，然后模型拿着错误码继续编结论；
 * 2. 第三方 schema 的归一化 —— 原样透传会让合法的模型调用被判成"参数非法"；
 * 3. 工具名映射与配置优先级 —— 映射一旦错位，模型调用的就是另一个工具。
 *
 * 全部用注入的假 fetch，不打真实网络。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MCP_PROTOCOL_VERSION,
  McpError,
  decodeJsonRpcPayload,
  detectAuthFailure,
  extractText,
  mcpCallTool,
  mcpListTools,
  mcpRequest,
} from './mcp-client.mjs'
import {
  DEFAULT_MCP_ENDPOINT,
  normalizeMcpPrefix,
  normalizeMcpSchema,
  normalizeMcpTool,
  parseMcpEndpoint,
  resolveMcpConfig,
  shapeMcpToolResult,
  splitEndpointSecret,
  syncMcpTools,
  testMcpConnection,
  toLocalToolName,
  toRemoteToolName,
} from './mcp.mjs'
import { deriveKey, encryptSecret } from './secrets.mjs'

const TEST_SECRET = 'unit-test-secret-value-32-chars'
const ENV = { JWT_SECRET: TEST_SECRET }

/** 构造一个返回固定 JSON-RPC 结果的假 fetch，并记录收到的请求。 */
function fakeFetch(payload, { status = 200, contentType = 'application/json', capture = [] } = {}) {
  const impl = async (url, init) => {
    capture.push({ url, init, body: JSON.parse(init.body) })
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => contentType },
      text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    }
  }
  impl.capture = capture
  return impl
}

const rpcResult = (result, id = 1) => ({ jsonrpc: '2.0', id, result })

/* ---------- 协议层 ---------- */

test('decodeJsonRpcPayload 解析普通 JSON 与 SSE 两种响应', () => {
  const json = decodeJsonRpcPayload('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')
  assert.equal(json.result.ok, true)

  // 服务端将来若切成 text/event-stream，客户端不能静默失败
  const sse = decodeJsonRpcPayload(
    'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[]}}\n\n',
    'text/event-stream'
  )
  assert.deepEqual(sse.result, { tools: [] })

  // 同一条 SSE 里夹带通知（无 result / error）时，必须取到真正的响应
  const mixed = decodeJsonRpcPayload(
    'data: {"jsonrpc":"2.0","method":"notifications/message"}\n\ndata: {"jsonrpc":"2.0","id":3,"result":{"a":1}}\n\n',
    'text/event-stream'
  )
  assert.deepEqual(mixed.result, { a: 1 })
})

test('decodeJsonRpcPayload 对空响应与非法 JSON 抛协议错误', () => {
  assert.throws(() => decodeJsonRpcPayload(''), McpError)
  assert.throws(() => decodeJsonRpcPayload('not json'), McpError)
})

test('mcpRequest 必须带 Accept: application/json, text/event-stream 与 secret-key 头', async () => {
  // 实测：卖家精灵缺少 Accept 的任一部分直接回 400，而 Node fetch 默认是 */*
  const fetchImpl = fakeFetch(rpcResult({ ok: true }))
  await mcpRequest({
    endpoint: DEFAULT_MCP_ENDPOINT,
    secretKey: 'sj-test-key',
    method: 'tools/list',
    fetchImpl,
  })
  const sent = fetchImpl.capture[0]
  assert.equal(sent.init.method, 'POST')
  assert.equal(sent.init.headers.accept, 'application/json, text/event-stream')
  assert.equal(sent.init.headers['secret-key'], 'sj-test-key')
  assert.equal(sent.body.method, 'tools/list')
})

test('mcpRequest 把 HTTP 401/403 归类为 auth，其它非 2xx 归类为 http', async () => {
  await assert.rejects(
    () => mcpRequest({ endpoint: DEFAULT_MCP_ENDPOINT, method: 'tools/list', fetchImpl: fakeFetch('nope', { status: 401 }) }),
    (error) => error.kind === 'auth' && error.status === 401
  )
  await assert.rejects(
    () => mcpRequest({ endpoint: DEFAULT_MCP_ENDPOINT, method: 'tools/list', fetchImpl: fakeFetch('bad accept', { status: 400 }) }),
    (error) => error.kind === 'http' && error.status === 400
  )
})

test('mcpRequest 拒绝超大响应体（未知方法会吐回完整 Java 堆栈）', async () => {
  const huge = 'x'.repeat(4_000_001)
  await assert.rejects(
    () => mcpRequest({ endpoint: DEFAULT_MCP_ENDPOINT, method: 'tools/list', fetchImpl: fakeFetch(huge) }),
    (error) => error.kind === 'protocol' && /过大/.test(error.message)
  )
})

test('mcpInitialize 使用 2025-06-18 协议版本', async () => {
  const fetchImpl = fakeFetch(
    rpcResult({ protocolVersion: MCP_PROTOCOL_VERSION, serverInfo: { name: 'sellersprite-mcp-server' } })
  )
  const { mcpInitialize, clearMcpHandshakeCache } = await import('./mcp-client.mjs')
  clearMcpHandshakeCache()
  const info = await mcpInitialize({
    endpoint: 'https://example.com/mcp',
    secretKey: 'k',
    fetchImpl,
    cacheKey: 'unit-test',
  })
  assert.equal(info.protocolVersion, MCP_PROTOCOL_VERSION)
  assert.equal(fetchImpl.capture[0].body.params.protocolVersion, MCP_PROTOCOL_VERSION)
})

/* ---------- 「假成功」的两种形态 ---------- */

test('mcpListTools 在有效密钥下**不**因为清单里含 secret_* 占位而误判（线上事故回归）', async () => {
  // 实测（2026-09-16）：卖家精灵在密钥完全有效时，清单里也始终混着
  // secret_invalid / secret_expired / secret_unauthorized / secret_no_remaining 四个占位条目。
  // 早期实现用「清单里出现 secret_invalid 就判密钥无效」，导致用户密钥有效却一直报"密钥不合法"。
  const fetchImpl = fakeFetch(
    rpcResult({
      tools: [
        { name: 'secret_expired', description: '密钥已过期', inputSchema: { type: 'object' } },
        { name: 'asin_detail', description: '商品详情', inputSchema: { type: 'object', properties: {} } },
        { name: 'keyword_miner', description: '关键词挖掘', inputSchema: { type: 'object', properties: {} } },
        { name: 'secret_invalid', description: '密钥不合法', inputSchema: { type: 'object' } },
        { name: 'secret_no_remaining', description: '次数已用完', inputSchema: { type: 'object' } },
      ],
    })
  )
  const tools = await mcpListTools({ endpoint: DEFAULT_MCP_ENDPOINT, secretKey: 'good', fetchImpl })
  assert.deepEqual(tools.map((tool) => tool.name), ['asin_detail', 'keyword_miner'])
})

test('mcpListTools 在只剩 secret_expired 时给出"已过期"这类可操作原因', async () => {
  const fetchImpl = fakeFetch(
    rpcResult({ tools: [{ name: 'secret_expired', description: '密钥已过期', inputSchema: { type: 'object' } }] })
  )
  await assert.rejects(
    () => mcpListTools({ endpoint: DEFAULT_MCP_ENDPOINT, secretKey: 'expired', fetchImpl }),
    (error) => error.kind === 'auth' && /过期/.test(error.message)
  )
})

test('normalizeMcpTool 不把 secret_* 占位条目注册成工具（描述是状态文本，模型调它必然失败）', () => {
  assert.equal(normalizeMcpTool({ name: 'secret_invalid', description: '密钥不合法' }, 'sellersprite'), null)
  assert.equal(normalizeMcpTool({ name: 'secret_no_remaining' }, 'sellersprite'), null)
  assert.ok(normalizeMcpTool({ name: 'asin_detail' }, 'sellersprite'))
})

test('mcpListTools 把「只有 secret_invalid」判定为密钥无效，而不是 1 个可用工具', async () => {
  // 实测：密钥错误时卖家精灵返回 200 + 单个伪工具，是接入时最容易误判成"连通成功"的形态
  const fetchImpl = fakeFetch(
    rpcResult({
      tools: [
        {
          name: 'secret_invalid',
          description: '密钥不合法',
          inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
        },
      ],
    })
  )
  await assert.rejects(
    () => mcpListTools({ endpoint: DEFAULT_MCP_ENDPOINT, secretKey: 'wrong', fetchImpl }),
    (error) => error.kind === 'auth' && /密钥/.test(error.message)
  )
})

test('detectAuthFailure 只认短的结构化错误，不误伤正常业务文本', () => {
  // 真实形态：带无效密钥调用工具时 isError=false，错误码被包成"正常数据"
  assert.equal(detectAuthFailure('{"code":"ERROR_UNAUTHORIZED","message":"未授权"}'), true)
  assert.equal(detectAuthFailure('{"message":"密钥不合法"}'), true)
  assert.equal(detectAuthFailure('ERROR_UNAUTHORIZED'), true)
  assert.equal(detectAuthFailure('{"code":"OK","data":[]}'), false)
  assert.equal(detectAuthFailure('买家在评论里说客服未授权就退款了，这是一条很长的正常评论内容…'.repeat(20)), false)
})

test('mcpCallTool 把 isError:false 的鉴权失败升级成错误，避免模型把错误码当业务数据', async () => {
  const fetchImpl = fakeFetch(
    rpcResult({
      content: [{ type: 'text', text: '{"code":"ERROR_UNAUTHORIZED","message":"未授权"}' }],
      isError: false,
    })
  )
  await assert.rejects(
    () => mcpCallTool({ endpoint: DEFAULT_MCP_ENDPOINT, secretKey: 'wrong', name: 'asin_detail', fetchImpl }),
    (error) => error.kind === 'auth'
  )
})

test('mcpCallTool 保留 isError:true 的服务端错误信息，正常返回则原样透传', async () => {
  const errorFetch = fakeFetch(
    rpcResult({ content: [{ type: 'text', text: '参数 marketplace 非法' }], isError: true })
  )
  await assert.rejects(
    () => mcpCallTool({ endpoint: DEFAULT_MCP_ENDPOINT, name: 'asin_detail', fetchImpl: errorFetch }),
    (error) => error.kind === 'server' && /marketplace/.test(error.message)
  )

  const okFetch = fakeFetch(rpcResult({ content: [{ type: 'text', text: '{"asin":"B0TEST"}' }], isError: false }))
  const result = await mcpCallTool({ endpoint: DEFAULT_MCP_ENDPOINT, name: 'asin_detail', fetchImpl: okFetch })
  assert.equal(extractText(result), '{"asin":"B0TEST"}')
})

/* ---------- schema 归一化 ---------- */

test('normalizeMcpSchema 把数组式 type 收敛成单一类型并过滤不支持的 required', () => {
  const schema = normalizeMcpSchema({
    type: 'object',
    properties: {
      marketplace: { type: ['string', 'null'], description: '站点', enum: ['US', 'JP'] },
      size: { type: 'integer', minimum: 1, maximum: 100 },
      ref: { $ref: '#/definitions/x' },
    },
    required: ['marketplace', 'notExists'],
  })
  assert.equal(schema.type, 'object')
  assert.equal(schema.properties.marketplace.type, undefined) // 有 enum 时不再争类型
  assert.deepEqual(schema.properties.marketplace.enum, ['US', 'JP'])
  assert.equal(schema.properties.size.type, 'integer')
  assert.deepEqual(schema.required, ['marketplace'])
  assert.equal(schema.additionalProperties, false)
})

test('normalizeMcpSchema 顶层不是 object 时退化成空对象 schema（宁可少校验也不拒掉合法调用）', () => {
  const schema = normalizeMcpSchema(null)
  assert.deepEqual(schema, { type: 'object', properties: {}, required: [], additionalProperties: false })
})

test('normalizeMcpTool 丢弃无法映射的工具名，并保留远端名', () => {
  const tool = normalizeMcpTool(
    { name: 'keyword_miner', description: '关键词挖掘', inputSchema: { type: 'object', properties: {} } },
    'sellersprite'
  )
  assert.equal(tool.localName, 'sellersprite__keyword_miner')
  assert.equal(tool.remoteName, 'keyword_miner')

  assert.equal(normalizeMcpTool({ name: '' }, 'sellersprite'), null)
  // 工具名过长（前缀 + 远端名 > 120）时整条丢弃，绝不截断——截断会让映射指向另一个工具
  assert.equal(normalizeMcpTool({ name: 'x'.repeat(120) }, 'sellersprite'), null)
})

/* ---------- 命名与配置 ---------- */

test('工具名前缀与本地/远端名互转', () => {
  assert.equal(normalizeMcpPrefix('SellerSprite'), 'sellersprite')
  assert.equal(normalizeMcpPrefix('ss'), 'ss')
  assert.equal(normalizeMcpPrefix('a'), null)
  assert.equal(normalizeMcpPrefix('1bad'), null)
  assert.equal(toLocalToolName('sellersprite', 'asin_detail'), 'sellersprite__asin_detail')
  assert.equal(toRemoteToolName('sellersprite', 'sellersprite__asin_detail'), 'asin_detail')
  // 非本前缀的工具名不得被当成远端名（否则内置工具名会被送去远端调用）
  assert.equal(toRemoteToolName('sellersprite', 'search_knowledge'), null)
})

test('parseMcpEndpoint 复用模型 Base URL 的同一套 SSRF 口径', () => {
  assert.equal(parseMcpEndpoint('https://mcp.sellersprite.com/mcp').ok, true)
  assert.equal(
    parseMcpEndpoint('https://mcp.sellersprite.com/mcp').value,
    'https://mcp.sellersprite.com/mcp'
  )
  for (const value of ['http://mcp.sellersprite.com/mcp', 'https://127.0.0.1/mcp', 'https://localhost/mcp', 'mcp.sellersprite.com/mcp']) {
    assert.equal(parseMcpEndpoint(value).ok, false, value)
  }
})

test('splitEndpointSecret 把 URL 里的密钥拆出来（官方"URL 直连"写法的防错）', () => {
  // 官方文档同时给了 `.../mcp?secret-key=xxx` 的写法，管理员很容易整条粘进端点框；
  // 服务端保存时会搬进加密列，端点回归标准值。
  assert.deepEqual(splitEndpointSecret('https://mcp.sellersprite.com/mcp?secret-key=abc123'), {
    endpoint: 'https://mcp.sellersprite.com/mcp',
    secret: 'abc123',
  })
  assert.deepEqual(splitEndpointSecret('https://mcp.sellersprite.com/mcp'), {
    endpoint: 'https://mcp.sellersprite.com/mcp',
    secret: null,
  })
  // 其它查询参数要保留（不能为了拆密钥把整个 query 丢掉）
  assert.equal(
    splitEndpointSecret('https://mcp.sellersprite.com/mcp?secret-key=k&v=2').endpoint,
    'https://mcp.sellersprite.com/mcp?v=2'
  )
  assert.equal(splitEndpointSecret('').secret, null)
  assert.equal(splitEndpointSecret('not a url').endpoint, 'not a url')
})

test('resolveMcpConfig 的优先级是 数据库 > 环境变量 > 未启用，且密钥只解密不回传', () => {
  const key = deriveKey(TEST_SECRET)
  const row = {
    mcp_enabled: true,
    mcp_endpoint: 'https://db.example.com/mcp',
    mcp_prefix: 'ss',
    mcp_timeout_ms: 12000,
    mcp_secret_cipher: encryptSecret('db-secret-key', key),
  }
  const config = resolveMcpConfig(row, { ...ENV, AI_MCP_ENDPOINT: 'https://env.example.com/mcp', AI_MCP_SECRET: 'env-secret' })
  assert.equal(config.endpoint, 'https://db.example.com/mcp')
  assert.equal(config.prefix, 'ss')
  assert.equal(config.timeoutMs, 12000)
  assert.equal(config.secretKey, 'db-secret-key')
  assert.equal(config.keySource, 'database')
  assert.equal(config.ready, true)

  // 库里没有密文时回落到环境变量
  const fallback = resolveMcpConfig({ mcp_enabled: true }, { ...ENV, AI_MCP_SECRET: 'env-secret' })
  assert.equal(fallback.keySource, 'environment')
  assert.equal(fallback.secretKey, 'env-secret')

  // 默认关闭：没配置过就不该把第三方工具塞给模型
  const off = resolveMcpConfig(null, ENV)
  assert.equal(off.enabled, false)
  assert.equal(off.ready, false)
  assert.equal(off.endpoint, DEFAULT_MCP_ENDPOINT)
})

test('resolveMcpConfig 对解不开的密文标记 keyInvalid，而不是抛错或当未配置', () => {
  const otherKey = deriveKey('another-secret-value-32-chars')
  const config = resolveMcpConfig(
    { mcp_enabled: true, mcp_secret_cipher: encryptSecret('secret', otherKey) },
    ENV
  )
  assert.equal(config.keyInvalid, true)
  assert.equal(config.keyConfigured, false)
  assert.equal(config.ready, false)
})

/* ---------- 结果整形 ---------- */

test('shapeMcpToolResult 把 JSON 数组整形成 rows + 表格块', () => {
  const shaped = shapeMcpToolResult({
    remoteName: 'keyword_miner',
    description: '关键词挖掘',
    result: {
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            { keyword: 'yoga mat', searchVolume: 12000 },
            { keyword: 'yoga mat thick', searchVolume: 800 },
          ]),
        },
      ],
    },
  })
  assert.equal(shaped.rows.length, 2)
  assert.deepEqual(shaped.rows[0], { keyword: 'yoga mat', searchVolume: 12000 })
  assert.equal(shaped.blocks.length, 1)
  assert.equal(shaped.blocks[0].kind, 'table')
  assert.equal(shaped.blocks[0].columns.length, 2)
})

test('shapeMcpToolResult 把「单条记录」也整形成 rows（产品类工具的真实形态）', () => {
  // 真实响应（实测 asin_detail，已脱敏）：不是数组，data 里是一条商品记录。
  // 早期实现只认数组 → 这类结果被标成 empty:true、模型只能读一段 JSON 文本。
  const shaped = shapeMcpToolResult({
    remoteName: 'asin_detail',
    result: {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            code: 'OK',
            message: '成功',
            data: { asin: 'B08N5WRWNW', brand: 'Apple', bsrRank: 12 },
          }),
        },
      ],
    },
  })
  assert.equal(shaped.empty, false)
  assert.equal(shaped.rows.length, 1)
  assert.deepEqual(shaped.rows[0], { asin: 'B08N5WRWNW', brand: 'Apple', bsrRank: 12 })
  assert.match(shaped.summary, /返回 1 条记录/)
})

test('shapeMcpToolResult 把包成"正常数据"的业务错误信封升级为错误', () => {
  // 卖家精灵失败时同样 isError:false，只有 code 能说明问题；不拦下来模型就会拿错误码当数据
  assert.throws(
    () =>
      shapeMcpToolResult({
        remoteName: 'keyword_miner',
        result: { content: [{ type: 'text', text: '{"code":"ERROR_PARAM","message":"参数 marketplace 非法"}' }] },
      }),
    (error) => /ERROR_PARAM/.test(error.message) && /marketplace/.test(error.message)
  )
  // 只有信封、没有 data 的正常成功响应不能被当成"一行数据"，也不该当成错误
  const ok = shapeMcpToolResult({
    remoteName: 'asin_detail',
    result: { content: [{ type: 'text', text: '{"code":"OK","message":"成功"}' }] },
  })
  assert.equal(ok.rows.length, 0)
  assert.match(ok.summary, /成功/)
})

test('shapeMcpToolResult 支持 {data:[...]} 包装结构，纯文本结果退化为摘要', () => {  const wrapped = shapeMcpToolResult({
    remoteName: 'market_research',
    result: { content: [{ type: 'text', text: '{"data":[{"brand":"A"}]}' }] },
  })
  assert.deepEqual(wrapped.rows, [{ brand: 'A' }])

  const text = shapeMcpToolResult({
    remoteName: 'asin_detail',
    result: { content: [{ type: 'text', text: '该 ASIN 近 30 天销量 120 件' }] },
  })
  assert.equal(text.rows.length, 0)
  assert.match(text.summary, /近 30 天销量/)
})

test('shapeMcpToolResult 裁剪列与行，避免第三方大结果打满模型上下文', () => {
  const row = Object.fromEntries(Array.from({ length: 40 }, (_v, i) => [`f${i}`, i]))
  const shaped = shapeMcpToolResult({
    remoteName: 'product_research',
    result: { content: [{ type: 'text', text: JSON.stringify(Array.from({ length: 500 }, () => ({ ...row }))) }] },
  })
  assert.equal(shaped.rows.length, 100)
  assert.equal(Object.keys(shaped.rows[0]).length, 20)
  assert.equal(shaped.blocks[0].totalRows, 500)
  assert.equal(shaped.blocks[0].truncated, true)
})

/* ---------- 连接测试与同步 ---------- */

test('testMcpConnection 在密钥无效时给出明确失败原因，不发"连接成功"', async () => {
  const fetchImpl = fakeFetch(
    rpcResult({ tools: [{ name: 'secret_invalid', description: '密钥不合法', inputSchema: { type: 'object' } }] })
  )
  const result = await testMcpConnection({ row: { mcp_enabled: true }, env: { ...ENV, AI_MCP_SECRET: 'wrong' }, fetchImpl })
  assert.equal(result.ok, false)
  assert.match(result.message, /密钥/)
  assert.equal(result.kind, 'auth')
})

test('testMcpConnection 成功时返回工具数量与清单预览', async () => {
  const fetchImpl = fakeFetch(
    rpcResult({
      tools: [
        { name: 'asin_detail', description: '商品详情' },
        { name: 'keyword_miner', description: '关键词挖掘' },
      ],
    })
  )
  const result = await testMcpConnection({ row: { mcp_enabled: true }, env: { ...ENV, AI_MCP_SECRET: 'ok' }, fetchImpl })
  assert.equal(result.ok, true)
  assert.equal(result.toolCount, 2)
  assert.deepEqual(result.remoteTools.map((tool) => tool.name), ['asin_detail', 'keyword_miner'])
})

test('testMcpConnection 在没有密钥时直接给出配置提示，不发起请求', async () => {
  const fetchImpl = fakeFetch(rpcResult({ tools: [] }))
  const result = await testMcpConnection({ row: { mcp_enabled: true }, env: ENV, fetchImpl })
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'config')
  assert.equal(fetchImpl.capture.length, 0)
})

test('syncMcpTools 在密钥无效时抛错，绝不把 secret_invalid 当成一个工具入库', async () => {
  const fetchImpl = fakeFetch(
    rpcResult({ tools: [{ name: 'secret_invalid', description: '密钥不合法', inputSchema: { type: 'object' } }] })
  )
  await assert.rejects(
    () => syncMcpTools({ row: { mcp_enabled: true }, env: { ...ENV, AI_MCP_SECRET: 'wrong' }, fetchImpl }),
    (error) => error.kind === 'auth'
  )
})

test('syncMcpTools 在远端返回空清单时抛错（通常是套餐未开通 MCP 权限）', async () => {
  const fetchImpl = fakeFetch(rpcResult({ tools: [] }))
  await assert.rejects(
    () => syncMcpTools({ row: { mcp_enabled: true }, env: { ...ENV, AI_MCP_SECRET: 'ok' }, fetchImpl }),
    /未返回任何可用工具/
  )
})

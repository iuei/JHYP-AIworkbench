import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApiKeyUpdate, parseSettingsPatch, serializeSettings } from './audit-routes.mjs'
import { deriveKey, encryptSecret, fingerprintSecret, maskSecret } from './secrets.mjs'

const TEST_SECRET = 'unit-test-secret-value-32-chars'
const ENV = { JWT_SECRET: TEST_SECRET }
const PLAINTEXT = 'sk-1234567890abcdefghijklmnopqrstuv'

/* ---------- 普通字段解析 ---------- */

test('parseSettingsPatch 接受 Base URL 并去掉末尾斜杠', () => {
  const result = parseSettingsPatch({ modelBaseUrl: 'https://api.deepseek.com/v1//' })
  assert.equal(result.ok, true)
  assert.equal(result.values.model_base_url, 'https://api.deepseek.com/v1')
})

test('parseSettingsPatch 拒绝非法 Base URL', () => {
  for (const value of ['api.deepseek.com', 'ftp://x.com', 'https://', 'javascript:alert(1)']) {
    const result = parseSettingsPatch({ modelBaseUrl: value })
    assert.equal(result.ok, false, value)
    assert.match(result.error, /http\(s\)/)
  }
})

test('parseSettingsPatch 只接受布尔型的强制演示开关', () => {
  assert.equal(parseSettingsPatch({ forceDemo: true }).values.force_demo, true)
  assert.equal(parseSettingsPatch({ forceDemo: false }).values.force_demo, false)
  const bad = parseSettingsPatch({ forceDemo: 'true' })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /布尔值/)
})

test('parseSettingsPatch 对空补丁报错', () => {
  assert.equal(parseSettingsPatch({}).ok, false)
  assert.equal(parseSettingsPatch({ unknownField: 1 }).ok, false)
})

/* ---------- 密钥处理 ---------- */

test('未传 modelApiKey 时保持原密钥不变', () => {
  const result = buildApiKeyUpdate({}, ENV)
  assert.equal(result.ok, true)
  assert.equal(result.action, 'unchanged')
  assert.deepEqual(result.values, {})
  assert.equal(result.audit, null)
})

test('传空字符串或 null 表示清除密钥', () => {
  for (const raw of ['', '   ', null]) {
    const result = buildApiKeyUpdate({ modelApiKey: raw }, ENV)
    assert.equal(result.action, 'clear')
    assert.equal(result.values.model_api_key_cipher, null)
    assert.equal(result.values.model_api_key_hint, null)
    assert.equal(result.values.model_api_key_fingerprint, null)
    assert.equal(result.audit.keyAction, 'clear')
  }
})

test('保存密钥时加密入库，掩码与指纹进入审计，明文绝不出现在返回值里', () => {
  const result = buildApiKeyUpdate({ modelApiKey: PLAINTEXT }, ENV)
  assert.equal(result.ok, true)
  assert.equal(result.action, 'set')
  assert.ok(result.values.model_api_key_cipher.split(':').length === 4)
  assert.equal(result.values.model_api_key_hint, maskSecret(PLAINTEXT))
  assert.equal(result.values.model_api_key_fingerprint, fingerprintSecret(PLAINTEXT))
  assert.equal(result.audit.keyHint, maskSecret(PLAINTEXT))
  assert.equal(result.audit.keyFingerprint, fingerprintSecret(PLAINTEXT))
  // 关键断言：整条返回值序列化后不含明文密钥
  assert.ok(!JSON.stringify(result).includes(PLAINTEXT))
})

test('密钥长度非法时拒绝', () => {
  assert.equal(buildApiKeyUpdate({ modelApiKey: 'short' }, ENV).ok, false)
  assert.equal(buildApiKeyUpdate({ modelApiKey: 'x'.repeat(401) }, ENV).ok, false)
  assert.equal(buildApiKeyUpdate({ modelApiKey: 123 }, ENV).ok, false)
})

test('缺少加密 secret 时给出可操作的错误提示，而不是静默明文存储', () => {
  const result = buildApiKeyUpdate({ modelApiKey: PLAINTEXT }, {})
  assert.equal(result.ok, false)
  assert.match(result.error, /AI_SETTINGS_SECRET/)
})

/* ---------- 序列化（不得泄露明文） ---------- */

const cipher = encryptSecret(PLAINTEXT, deriveKey(TEST_SECRET))

function settingsRow(overrides = {}) {
  return {
    model_provider: 'openai-compatible',
    model_name: 'deepseek-chat',
    model_base_url: 'https://api.deepseek.com/v1',
    force_demo: false,
    temperature: 0.2,
    max_output_tokens: 2048,
    max_turns_per_conversation: 20,
    retrieval_top_k: 5,
    request_timeout_ms: 60000,
    model_api_key_cipher: cipher,
    model_api_key_hint: maskSecret(PLAINTEXT),
    model_api_key_updated_at: '2026-09-10T00:00:00.000Z',
    updated_at: '2026-09-10T00:00:00.000Z',
    ...overrides,
  }
}

test('serializeSettings 回传掩码与实际生效模式，绝不回传明文或密文', () => {
  const serialized = serializeSettings(settingsRow(), { env: ENV })
  assert.equal(serialized.apiKeyConfigured, true)
  assert.equal(serialized.apiKeyHint, maskSecret(PLAINTEXT))
  assert.equal(serialized.effectiveMode, 'live')
  assert.equal(serialized.keySource, 'database')
  assert.equal(serialized.apiKeyInvalid, false)
  const text = JSON.stringify(serialized)
  assert.ok(!text.includes(PLAINTEXT), '不得回传明文密钥')
  assert.ok(!text.includes(cipher), '不得回传密文')
})

test('serializeSettings 在强制演示模式下仍如实报告 effectiveMode', () => {
  const serialized = serializeSettings(settingsRow({ force_demo: true }), { env: ENV })
  assert.equal(serialized.effectiveMode, 'demo')
  assert.equal(serialized.forceDemo, true)
  assert.equal(serialized.apiKeyConfigured, true, '密钥仍然保存着，只是没在用')
})

test('serializeSettings 在密钥解不开时标记 apiKeyInvalid', () => {
  const serialized = serializeSettings(settingsRow(), { env: { JWT_SECRET: 'rotated-secret-1234567890' } })
  assert.equal(serialized.apiKeyInvalid, true)
  assert.equal(serialized.effectiveMode, 'demo')
})

test('serializeSettings 未配置密钥时 mode 为 demo', () => {
  const serialized = serializeSettings(
    settingsRow({ model_api_key_cipher: null, model_api_key_hint: null }),
    { env: {} }
  )
  assert.equal(serialized.apiKeyConfigured, false)
  assert.equal(serialized.effectiveMode, 'demo')
  assert.equal(serialized.keySource, 'none')
})

test('serializeSettings 对空行返回 null', () => {
  assert.equal(serializeSettings(null), null)
})

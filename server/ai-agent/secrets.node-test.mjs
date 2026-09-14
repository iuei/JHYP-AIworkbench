import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import {
  CIPHER_VERSION,
  SecretConfigError,
  decryptSecret,
  deriveKey,
  encryptSecret,
  fingerprintSecret,
  maskSecret,
  readStoredApiKey,
  resolveSecretKey,
  safeEqual,
} from './secrets.mjs'

const SECRET = 'a-very-long-random-jwt-secret-value'
const ENV = { JWT_SECRET: SECRET }
const KEY = deriveKey(SECRET)
const API_KEY = 'sk-1234567890abcdefghijklmnopqrstuv'

test('resolveSecretKey 优先使用 AI_SETTINGS_SECRET，缺失时回退 JWT_SECRET', () => {
  assert.equal(resolveSecretKey(ENV).source, 'JWT_SECRET')
  const withDedicated = resolveSecretKey({ AI_SETTINGS_SECRET: 'dedicated-secret-32chars-long', JWT_SECRET: SECRET })
  assert.equal(withDedicated.source, 'AI_SETTINGS_SECRET')
  assert.notDeepEqual(withDedicated.key, KEY)
})

test('resolveSecretKey 对缺失或过短的 secret 明确报错，不静默降级', () => {
  assert.throws(() => resolveSecretKey({}), SecretConfigError)
  assert.throws(() => resolveSecretKey({ JWT_SECRET: 'short' }), SecretConfigError)
  assert.throws(() => deriveKey('short'), SecretConfigError)
})

test('derived key 固定为 32 字节且对同一 secret 稳定', () => {
  assert.equal(KEY.length, 32)
  assert.deepEqual(deriveKey(SECRET), KEY)
  assert.notDeepEqual(deriveKey(`${SECRET}x`), KEY)
  assert.notDeepEqual(deriveKey(SECRET, { salt: 'other' }), KEY)
})

test('加密后可解密，且密文格式为 v1:iv:tag:data', () => {
  const cipher = encryptSecret(API_KEY, KEY)
  assert.equal(cipher.split(':').length, 4)
  assert.ok(cipher.startsWith(`${CIPHER_VERSION}:`))
  assert.equal(decryptSecret(cipher, KEY), API_KEY)
  assert.ok(!cipher.includes(API_KEY), '密文不得包含明文')
})

test('相同明文两次加密得到不同密文（随机 IV）', () => {
  const first = encryptSecret(API_KEY, KEY)
  const second = encryptSecret(API_KEY, KEY)
  assert.notEqual(first, second)
  assert.equal(decryptSecret(first, KEY), API_KEY)
  assert.equal(decryptSecret(second, KEY), API_KEY)
})

test('密钥不匹配时解密返回 null 而不是乱码', () => {
  const cipher = encryptSecret(API_KEY, KEY)
  assert.equal(decryptSecret(cipher, deriveKey('another-secret-value-here')), null)
})

test('密文被篡改时 GCM 认证失败，返回 null', () => {
  const cipher = encryptSecret(API_KEY, KEY)
  const [version, iv, tag, data] = cipher.split(':')
  const tampered = [version, iv, tag, Buffer.from('x'.repeat(8)).toString('base64')].join(':')
  assert.equal(decryptSecret(tampered, KEY), null)
  assert.equal(decryptSecret([version, iv, 'AAAA', data].join(':'), KEY), null)
})

test('解密对空值与异常格式返回 null', () => {
  assert.equal(decryptSecret(null, KEY), null)
  assert.equal(decryptSecret('', KEY), null)
  assert.equal(decryptSecret('not-a-cipher', KEY), null)
  assert.equal(decryptSecret('v2:a:b:c', KEY), null)
  assert.equal(decryptSecret('v1:a:b:c', null), null)
})

test('加密拒绝空明文与非法密钥长度', () => {
  assert.throws(() => encryptSecret('   ', KEY), SecretConfigError)
  assert.throws(() => encryptSecret(API_KEY, Buffer.alloc(16)), SecretConfigError)
})

test('maskSecret 只暴露首尾，绝不暴露完整密钥', () => {
  const masked = maskSecret(API_KEY)
  assert.equal(masked, 'sk-1…stuv')
  assert.ok(!masked.includes(API_KEY))
  assert.equal(maskSecret('short'), '*****')
  assert.equal(maskSecret(''), '')
  assert.equal(maskSecret(null), '')
})

test('fingerprintSecret 稳定、不可反推，且不包含明文', () => {
  const fingerprint = fingerprintSecret(API_KEY)
  assert.equal(fingerprint.length, 16)
  assert.equal(fingerprint, fingerprintSecret(API_KEY))
  assert.notEqual(fingerprint, fingerprintSecret(`${API_KEY}x`))
  assert.equal(fingerprint, createHash('sha256').update(API_KEY).digest('hex').slice(0, 16))
  assert.equal(fingerprintSecret(''), '')
})

test('safeEqual 恒定时间比较', () => {
  assert.equal(safeEqual('abc', 'abc'), true)
  assert.equal(safeEqual('abc', 'abd'), false)
  assert.equal(safeEqual('abc', 'abcd'), false)
  assert.equal(safeEqual(null, ''), true)
})

test('readStoredApiKey 区分未配置 / 正常解密 / 解不开三种情况', () => {
  assert.deepEqual(readStoredApiKey(null, ENV), { apiKey: null, configured: false, invalid: false })

  const cipher = encryptSecret(API_KEY, KEY)
  assert.deepEqual(readStoredApiKey(cipher, ENV), { apiKey: API_KEY, configured: true, invalid: false })

  // 换了 secret 之后旧密文解不开：必须标记 invalid，让上层明确报"配置失效"
  const rotated = readStoredApiKey(cipher, { JWT_SECRET: 'rotated-secret-value-1234' })
  assert.equal(rotated.apiKey, null)
  assert.equal(rotated.configured, true)
  assert.equal(rotated.invalid, true)

  // 连 secret 都没配置时也算 invalid，但同样不抛错
  const noSecret = readStoredApiKey(cipher, {})
  assert.equal(noSecret.invalid, true)
})

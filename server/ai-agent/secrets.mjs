/**
 * 模型密钥的加密存储（后台可配置，需求文档 §8.3 的受控偏离）。
 *
 * 设计取舍：
 * - 需求文档原本要求「API Key 只走环境变量、不入库」。为支持管理员在后台自助配置，
 *   这里把密钥**加密后**落库，而不是明文入库：数据库备份、只读账号拿到的是密文。
 * - 加密密钥来自 `AI_SETTINGS_SECRET`；未配置时回退 `JWT_SECRET`，保证开箱即用。
 *   换服务器时需要一并带走该 secret，否则需在后台重填 Key（这一点必须写进运维交接）。
 * - 密文格式：`v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>`，AES-256-GCM 自带完整性校验，
 *   密文被篡改或密钥不匹配时解密返回 null（而不是抛错或返回乱码）。
 *
 * 三条不可违反的约束：
 * 1. **任何接口都不得回传明文**，只能回传掩码（maskSecret）；
 * 2. **审计日志只记掩码与指纹**，绝不记明文；
 * 3. 解密失败一律当作「未配置」处理，回退到演示模式，绝不静默用错密钥。
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const CIPHER_VERSION = 'v1'
export const SECRET_ENV_KEYS = ['AI_SETTINGS_SECRET', 'JWT_SECRET']
const MIN_SECRET_LENGTH = 8
const KEY_SALT = 'jhyp-ai-agent-settings'

export class SecretConfigError extends Error {}

/**
 * 从环境变量解析用于加密的密钥材料。
 * 依次尝试 AI_SETTINGS_SECRET → JWT_SECRET，都没有则抛错（不静默降级成明文存储）。
 */
export function resolveSecretKey(env = process.env) {
  for (const name of SECRET_ENV_KEYS) {
    const value = env?.[name]
    if (typeof value === 'string' && value.trim().length >= MIN_SECRET_LENGTH) {
      return { key: deriveKey(value.trim()), source: name }
    }
  }
  throw new SecretConfigError(
    `未配置 ${SECRET_ENV_KEYS.join(' 或 ')}（至少 ${MIN_SECRET_LENGTH} 位），无法加密保存模型密钥。`
  )
}

/** 把任意长度的 secret 派生成 32 字节 AES-256 密钥。 */
export function deriveKey(secret, { salt = KEY_SALT } = {}) {
  const value = String(secret ?? '')
  if (value.length < MIN_SECRET_LENGTH) {
    throw new SecretConfigError('加密密钥过短。')
  }
  return createHash('sha256').update(`${salt}:${value}`).digest()
}

/** 加密明文密钥，返回可入库的字符串。 */
export function encryptSecret(plaintext, key) {
  const value = String(plaintext ?? '').trim()
  if (!value) throw new SecretConfigError('待加密的密钥不能为空。')
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new SecretConfigError('加密密钥必须是 32 字节。')
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    CIPHER_VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':')
}

/**
 * 解密密文。返回明文；密文为空、格式不对、被篡改或密钥不匹配时返回 null。
 * 调用方必须把 null 当作「未配置」处理。
 */
export function decryptSecret(payload, key) {
  if (typeof payload !== 'string' || !payload.trim()) return null
  if (!Buffer.isBuffer(key) || key.length !== 32) return null
  const parts = payload.split(':')
  if (parts.length !== 4) return null
  const [version, ivB64, tagB64, dataB64] = parts
  if (version !== CIPHER_VERSION) return null
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ])
    return decrypted.toString('utf8')
  } catch {
    // GCM 认证失败：密钥换了或密文被改动
    return null
  }
}

/** 生成可安全回传前端的掩码：`sk-a…b1c2`。 */
export function maskSecret(plaintext) {
  const value = String(plaintext ?? '').trim()
  if (!value) return ''
  if (value.length <= 8) return `${'*'.repeat(value.length)}`
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

/** 生成用于审计比对的指纹（不可反推明文），同一密钥稳定。 */
export function fingerprintSecret(plaintext) {
  const value = String(plaintext ?? '').trim()
  if (!value) return ''
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

/** 恒定时间比较，用于比对指纹等敏感值，避免时序侧信道。 */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''))
  const right = Buffer.from(String(b ?? ''))
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * 读取数据库配置里的密钥：尝试解密，失败按未配置处理。
 * 返回 { apiKey, configured, invalid }，invalid 表示密文存在但解不开（通常是 secret 变了）。
 */
export function readStoredApiKey(cipherText, env = process.env) {
  if (!cipherText) return { apiKey: null, configured: false, invalid: false }
  let key
  try {
    key = resolveSecretKey(env).key
  } catch {
    return { apiKey: null, configured: true, invalid: true }
  }
  const apiKey = decryptSecret(cipherText, key)
  if (!apiKey) return { apiKey: null, configured: true, invalid: true }
  return { apiKey, configured: true, invalid: false }
}

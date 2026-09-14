/**
 * provider 选择层（需求文档 §8.3：所有模型调用只经过 providers/ 一层）。
 *
 * 配置优先级：**后台配置（数据库） > 环境变量 > 演示 provider**。
 * 数据库优先是为了让管理员在后台改完即生效、不需要重启服务；环境变量保留给本地开发与 CI。
 * `force_demo` 打开时强制走演示 provider（便于演示与培训，不影响已保存的密钥）。
 *
 * 密钥在数据库里是 AES-256-GCM 密文，解密只发生在本层，且返回值不带明文密钥。
 */
import { readStoredApiKey } from '../secrets.mjs'
import { createDemoProvider } from './demo.mjs'
import { createOpenAiCompatibleProvider } from './openai-compatible.mjs'

export const PROVIDER_MODE = { live: 'live', demo: 'demo' }

export const KEY_SOURCE = {
  database: 'database',
  environment: 'environment',
  none: 'none',
}

export const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'

/**
 * 解析实际生效的模型连接参数，并标明密钥来源。
 * 供 resolveProvider 与后台配置页共用——配置页需要知道"当前到底在用哪一份配置"。
 */
export function resolveModelConfig({ settings = {}, env = process.env } = {}) {
  const stored = readStoredApiKey(settings.model_api_key_cipher ?? null, env)
  const envKey = env?.AI_MODEL_API_KEY?.trim() || null

  const apiKey = stored.apiKey ?? envKey ?? null
  const keySource = stored.apiKey
    ? KEY_SOURCE.database
    : envKey
      ? KEY_SOURCE.environment
      : KEY_SOURCE.none

  const baseUrl =
    settings.model_base_url?.trim() || env?.AI_MODEL_BASE_URL?.trim() || DEFAULT_BASE_URL
  const model = settings.model_name?.trim() || env?.AI_MODEL_NAME?.trim() || 'deepseek-chat'
  const temperature = Number(env?.AI_MODEL_TEMPERATURE ?? settings.temperature ?? 0.2)
  const maxOutputTokens = Number(env?.AI_MODEL_MAX_TOKENS ?? settings.max_output_tokens ?? 2048)
  const timeoutMs = Number(env?.AI_MODEL_TIMEOUT_MS ?? settings.request_timeout_ms ?? 60000)

  return {
    apiKey,
    keySource,
    /**
     * 密文存在但解不开：通常是 AI_SETTINGS_SECRET / JWT_SECRET 被换过。
     * 必须显式暴露给管理员，否则会表现为"明明填了 Key 却还在演示模式"。
     */
    keyInvalid: stored.invalid,
    keyConfigured: stored.configured,
    keyHint: settings.model_api_key_hint ?? null,
    keyUpdatedAt: settings.model_api_key_updated_at ?? null,
    forceDemo: Boolean(settings.force_demo),
    baseUrl,
    model,
    temperature: Number.isFinite(temperature) ? temperature : 0.2,
    maxOutputTokens: Number.isFinite(maxOutputTokens) ? maxOutputTokens : 2048,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 60000,
  }
}

export function resolveProvider({ settings = {}, env = process.env } = {}) {
  const config = resolveModelConfig({ settings, env })

  if (config.forceDemo || !config.apiKey) {
    return createDemoProvider({ model: `${config.model}#demo` })
  }

  return createOpenAiCompatibleProvider({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    timeoutMs: config.timeoutMs,
  })
}

/** 供接口层返回给前端：模式、模型名与「是否为演示模式」。**不含密钥与 Base URL。** */
export function describeProvider(provider) {
  return {
    name: provider?.name ?? 'unknown',
    mode: provider?.mode ?? PROVIDER_MODE.demo,
    model: provider?.model ?? 'unknown',
    demo: (provider?.mode ?? PROVIDER_MODE.demo) === PROVIDER_MODE.demo,
  }
}

import axios from 'axios'
import { useAuthStore } from '@/stores/auth-store'

/**
 * 后端 API 基址（唯一来源）。
 *
 * 此前上传、导入、导出、模板下载、SSE 各自写了一遍同一段兜底字符串
 * （`import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787/api'`）：
 * 生产构建漏配该变量时，它们会**静默**把请求打到 localhost，故障极难定位。
 */
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787/api'

export const api = axios.create({ baseURL: API_BASE_URL })

export class ApiRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
}

export function handleUnauthorized() {
  useAuthStore.getState().auth.reset()
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event('auth:unauthorized'))
}

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().auth.accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/** 当前登录态的鉴权头，供需要裸 fetch 的场景（上传/导入/导出/流式）共用。 */
export function authHeaders(extra: Record<string, string> = {}) {
  const token = useAuthStore.getState().auth.accessToken
  return token ? { ...extra, authorization: `Bearer ${token}` } : extra
}

/** 拼出完整接口地址（SSE 这类需要 URL 而不是请求对象的场景）。 */
export function apiUrl(path: string) {
  return path.startsWith('http') ? path : `${API_BASE_URL}${path}`
}

/**
 * 裸 fetch 的统一出口：上传、导入、导出等需要拿到 Response 本身
 * （二进制、文本、流）的请求都走这里，不要在各处自己写 fetch。
 *
 * 直接写 fetch 的代价很具体：
 * 1. 401 不会触发全局登出跳转 —— `main.tsx` 的 QueryCache 只识别 `AxiosError`；
 * 2. 服务端非 2xx 一律返回 `{ message: '中文原因' }`，自己写就容易吞掉它，
 *    用户只看到"上传失败"而不知道是密码过期、文件格式不对还是权限不足。
 */
export async function rawRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: authHeaders(
      (init.headers as Record<string, string> | undefined) ?? {}
    ),
  })

  if (!response.ok) {
    const message = await response
      .json()
      .then((body) => (body as { message?: string } | null)?.message)
      .catch(() => null)
    if (response.status === 401) handleUnauthorized()
    throw new ApiRequestError(
      message ?? `请求失败（HTTP ${response.status}）`,
      response.status
    )
  }

  return response
}

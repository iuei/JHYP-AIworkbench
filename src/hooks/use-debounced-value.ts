import { useEffect, useState } from 'react'

/**
 * 把频繁变化的值延迟成稳定值（默认 300ms）。
 *
 * 用途：搜索框逐字输入时不要逐字打接口 —— 会话搜索、沉淀搜索都走服务端查询，
 * 直接用输入值会让"登录"两个字触发两次请求，且后到的旧响应可能覆盖新结果。
 *
 * 注意与 `useDeferredValue` 的区别：后者只是降低渲染优先级，并不会减少请求次数。
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}

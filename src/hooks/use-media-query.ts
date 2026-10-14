import * as React from 'react'

/**
 * 订阅一个 CSS 媒体查询的匹配状态（与 `useIsMobile` 同一套 `useSyncExternalStore` 写法）。
 *
 * 用于「布局里某个元素是否真的可见」这类判断：栏宽要在可见性变化时重新收敛，
 * 而 `clientWidth` 观察器在 `display: none` 时给不出有用信号。
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query]
  )

  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}

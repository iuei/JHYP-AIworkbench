import { getCookie, removeCookie, setCookie } from '@/lib/cookies'

/**
 * 对话工作台左栏（会话列表）宽度的用户偏好。
 *
 * 为什么要有这一层：对话页此前是把栏宽**写死在 class 里**（`w-64` / `2xl:w-72`），
 * 用户面对长会话标题只能忍受截断。现在宽度由用户自己定：拖动分隔条
 * （或键盘 `←/→`、`Home/End`，双击/`Enter` 恢复默认），选择写进 cookie 下次进来仍然生效。
 *
 * **右栏已取消（2026-09-15 按用户要求）**：回答依据不再由右栏承载，改为回答卡片内
 * 「查看依据」按钮按需展开，因此这里只剩一份宽度偏好、一根分隔条。
 * cookie 名与读取口径保持不变（旧值 `"256,320"` 仍能读出左栏宽度），
 * 避免用户的既有选择因为一次布局变更被清空。
 *
 * 全部逻辑都是纯函数（cookie 读写单独分开），这样"拖到极限时不能把中栏压没"
 * 这条规则可以被单测钉住，而不是靠人肉拖动试出来。
 */

export const PANE_WIDTH_COOKIE = 'ai_chat_pane_widths'
/** 用户偏好不是会话态数据，给足 180 天 */
export const PANE_WIDTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 180

/** 分隔条宽度：与改造前的 `gap-4`（16px）一致，视觉间距不变，同时就是拖拽热区 */
export const PANE_RESIZER_WIDTH = 16
/** 中栏消息区的最小可用宽度：拖到极限时优先保住它，宁可挡住继续拖 */
export const MIN_CENTER_WIDTH = 360
/** 键盘每次调整的步长（单指针替代方案之一） */
export const KEYBOARD_RESIZE_STEP = 16

/** 左栏宽度：`{ left }` 而不是裸数字，调用方不必关心"这是第几栏" */
export type PaneWidths = { left: number }

type PaneSpec = {
  min: number
  max: number
  /** 默认宽度（<2xl 视口） */
  base: number
  /** 2xl 及以上视口的默认宽度：保持改造前"大屏自动放宽"的手感 */
  wide: number
}

/** 左栏：会话标题常带日期与长主题 */
export const PANE_SPEC: PaneSpec = { min: 200, max: 420, base: 256, wide: 288 }

/** 断点查询串：与 chat-workbench 的 class（`lg`）保持同一阈值 */
export const LEFT_PANE_QUERY = '(min-width: 1024px)'
export const WIDE_VIEWPORT_QUERY = '(min-width: 1536px)'

export function clampPaneWidth(value: number): number {
  if (!Number.isFinite(value)) return PANE_SPEC.min
  return Math.min(PANE_SPEC.max, Math.max(PANE_SPEC.min, Math.round(value)))
}

/** 未持久化时的默认宽度：2xl 及以上沿用改造前的自动放宽值 */
export function defaultPaneWidths(isWideViewport: boolean): PaneWidths {
  return { left: isWideViewport ? PANE_SPEC.wide : PANE_SPEC.base }
}

/** 同步读取当前视口是否属于 2xl（用于首帧算默认值，不依赖 hook） */
export function isWideViewportNow(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia(WIDE_VIEWPORT_QUERY).matches
}

/**
 * cookie 值 → `{ left }`；非法一律返回 null（宁可用默认值，也不要半截配置）。
 *
 * 取消右栏前写入的是 `"256,320"`：这里只认第一段，旧偏好继续生效而不是被丢弃。
 */
export function parsePaneWidths(raw: string | undefined): PaneWidths | null {
  if (!raw) return null
  const [leftPart] = raw.split(',')
  const text = leftPart?.trim() ?? ''
  // 空串的 `Number('')` 是 0（合法数字），必须先挡掉，否则缺项会被当成"最小宽度"
  if (text === '') return null
  const left = Number(text)
  if (!Number.isFinite(left)) return null
  return { left: clampPaneWidth(left) }
}

export function serializePaneWidths(widths: PaneWidths): string {
  return String(clampPaneWidth(widths.left))
}

/** 读用户偏好：cookie 缺失或损坏时回落到给定的默认值 */
export function readPaneWidths(fallback: PaneWidths): PaneWidths {
  return parsePaneWidths(getCookie(PANE_WIDTH_COOKIE)) ?? fallback
}

export function writePaneWidths(widths: PaneWidths): void {
  setCookie(
    PANE_WIDTH_COOKIE,
    serializePaneWidths(widths),
    PANE_WIDTH_COOKIE_MAX_AGE
  )
}

export function clearPaneWidths(): void {
  removeCookie(PANE_WIDTH_COOKIE)
}

/**
 * 按容器宽度收敛左栏宽度，保证中栏至少 `MIN_CENTER_WIDTH`。
 *
 * 左栏隐藏（窄屏 `display: none`）时不占宽度、也不参与预算，
 * 否则窄屏下拖动会被看不见的左栏挡住。
 *
 * `containerWidth` 尚未测量（0 或非法）时原样返回——首帧不做限制，随后由观察器收敛。
 */
export function limitPaneWidths(
  widths: PaneWidths,
  options: { containerWidth: number; leftVisible: boolean }
): PaneWidths {
  const { containerWidth, leftVisible } = options
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return widths
  if (!leftVisible) return widths

  const budget = containerWidth - MIN_CENTER_WIDTH - PANE_RESIZER_WIDTH
  const next = Math.max(PANE_SPEC.min, Math.min(widths.left, budget))
  return { left: next }
}

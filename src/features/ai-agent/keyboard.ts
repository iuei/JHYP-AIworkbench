/**
 * 键盘事件的小工具（纯函数，便于单测）。
 */

type ComposingEventLike = {
  /** React 合成事件上的原生事件（`KeyboardEvent.isComposing` 在这里） */
  nativeEvent?: { isComposing?: boolean } | null
  /** 部分输入法在"组合结束的那一下"会把 isComposing 置回 false，但 keyCode 仍是 229 */
  keyCode?: number
}

/**
 * 该键盘事件是否处于**输入法组合中**（中文/日文打字时的拼音或候选词阶段）。
 *
 * 为什么必须有它（2026-09-18 用户报障「打字时只要回车就会直接发送内容」）：
 * 输入法打字时浏览器仍会把 `keydown` 交给页面，`key` 就是 `'Enter'`，
 * 而这一下回车的真实语义是"确认候选词"。聊天输入框此前直接 `preventDefault()` 并发送，
 * 于是中文用户敲完拼音一按回车就把半截内容发出去了（同时候选词也没法确认）。
 *
 * 两个判据都要看：
 * ① `nativeEvent.isComposing === true` —— 标准字段，组合期间恒为 true；
 * ② `keyCode === 229` —— 兼容"组合结束那一下 isComposing 已回落"的浏览器/输入法组合。
 *
 * 保守取值：字段缺失时返回 `false`（宁可发出去，也不要吞掉正常回车）。
 */
export function isImeComposing(event: ComposingEventLike): boolean {
  if (event?.nativeEvent?.isComposing === true) return true
  return event?.keyCode === 229
}

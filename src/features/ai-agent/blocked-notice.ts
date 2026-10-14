/**
 * 「本次回答被拦截」的提示文案（按原因分开）。
 *
 * 背景（2026-09-17 实测踩到）：`ai_messages.status = 'blocked'` 是一条笼统状态，
 * 至少有三类完全不同的来源，此前全部显示同一句"当前账号无权查询该数据，请联系管理员。"：
 *
 * | 原因 | 真实含义 | 该怎么办 |
 * | --- | --- | --- |
 * | `tool_unavailable` | 工具已启用、也注册给了该用户，但**当前后端进程没有它的实现**（代码合了没重启） | 重启后端；与权限无关 |
 * | `forbidden` | 确实没权限（账号停用 / 需要管理员角色） | 找管理员开通 |
 * | `wording:*` | 模型自己描述了工具范围或直接拒绝回答，被权限护栏替换成统一文案（需求 §5.1 要求正文统一） | 换个问法再试；与权限无关 |
 *
 * 正文**必须**保持统一（合规要求，见 `server/ai-agent/prompt.mjs` 的 `BLOCKED_ANSWER`），
 * 所以"分开"体现在**提示条文案**上：实时流与历史消息共用这里的同一份映射，不两处各写一遍。
 *
 * 纯函数模块（不含组件）——`react-refresh/only-export-components` 要求组件文件只导出组件。
 */

/** 明确原因 → 提示文案。 */
const NOTICE_TEXT: Record<string, string> = {
  tool_unavailable:
    '查询没有执行：所需工具当前不可用（未启用或未实现），与你的账号权限无关，请稍后重试。',
  // 2026-09-18 新增：参数不完整/格式不对此前被归到"无权"口径，把用户引向错误的排查方向
  invalid_params:
    '查询没有执行：请求的参数不完整或格式不正确（与账号权限无关）。请补充信息（如统计区间、站点或 ASIN）后重试。',
  forbidden: '当前账号无权查询该数据，请联系管理员。',
}

/** 没有细分原因（旧记录）时的兜底文案：与历史行为一致，不新增信息。 */
export const DEFAULT_BLOCKED_NOTICE = '当前账号无权查询该数据，请联系管理员。'

export function blockedNoticeText(reason?: string | null): string {
  if (!reason) return DEFAULT_BLOCKED_NOTICE
  const known = NOTICE_TEXT[reason]
  if (known) return known
  if (reason.startsWith('wording:')) {
    // 护栏拦下的是"模型的措辞"，不是用户的权限：换问法通常就能过
    return '本次回答被权限护栏拦下（模型自行描述了工具范围或直接拒绝，与账号权限无关），换个问法再试一次。'
  }
  return DEFAULT_BLOCKED_NOTICE
}

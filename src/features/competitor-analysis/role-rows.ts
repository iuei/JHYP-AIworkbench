import type { AnswerBlock } from '@/features/ai-agent/types'

/**
 * 给"一行一条记录、归属写在角色列里"的对比表补**行级归属色**。
 *
 * 用户口径（2026-09-17）：「竞品和本品的对比都参考按日对比（本品 VS 竞品）排版方式」，
 * 随后追问「TOP 流量词为什么没有同步调整」—— 这一族表和「ASIN 横向对比 / 商品公开数据对比」
 * 形状不同：它是**一行一个关键词（或一个差评高频词）**，归属由行内的 `role`（本品 / 竞品）给出，
 * 列上没法着色（同一列里混着两家），所以只能**整行铺一档淡色底**（与列 `tone` 同一块色板、
 * 同一档透明度）。渲染层支持 `__tone` 行元数据，见 `AnswerBlock.rows` 的类型说明。
 *
 * **为什么在前端算**：这只是展示层着色，**不涉及任何业务数字**；服务端形态不动，
 * 因此对已落库的历史快照立刻生效（老记录与新记录同貌）。
 *
 * 识别判据（刻意从严，且不认标题文案）：表格块、有行、**每行都同时带 `asin` 与 `role`**。
 * 认不出来就原样返回 —— 宁可不上色，也不要给不相干的表乱上色。
 * 注意本模块只在竞品分析结果页调用，AI 助手的表格不会被波及。
 */
const ROW_TONE_KEY = '__tone'

/** 行里取 ASIN：大小写、空白统一后再比，避免同一 ASIN 因写法不同被拆成两档色。 */
function asinOf(row: Record<string, unknown>): string {
  return String(row.asin ?? '')
    .trim()
    .toUpperCase()
}

export function applyRowTones(block: AnswerBlock): AnswerBlock {
  if (block.kind !== 'table') return block
  const rows = block.rows ?? []
  if (rows.length < 2) return block
  /*
   * 每行都要能定归属：`asin` + `role` 缺一个就整体放弃（半张表上色会比不上色更难读）。
   * 这里的 `role` 是服务端给的**角色文案**（"本品" / "竞品"），不是 `ComparisonRow.role` 那个枚举。
   */
  const ownsRole = rows.every(
    (row) =>
      String(row.asin ?? '').trim().length > 0 &&
      String(row.role ?? '').trim().length > 0
  )
  if (!ownsRole) return block

  // 档位按 ASIN 首次出现的顺序分配，但**本品永远排第一档**（与「按日对比」的 chart-1 对齐）
  const order: string[] = []
  for (const row of rows) {
    const key = asinOf(row)
    if (key && !order.includes(key)) order.push(key)
  }
  const subjectKey = rows
    .map((row) => ({ row, key: asinOf(row) }))
    .find((item) => String(item.row.role ?? '').includes('本品'))?.key
  if (subjectKey) {
    const position = order.indexOf(subjectKey)
    if (position > 0) {
      order.splice(position, 1)
      order.unshift(subjectKey)
    }
  }

  // 超过 5 个 ASIN 时循环用色（`toneClass` 只认 1~5，越界不加色）
  const toneByAsin = new Map(order.map((key, index) => [key, (index % 5) + 1]))

  return {
    ...block,
    rows: rows.map((row) => {
      const tone = toneByAsin.get(asinOf(row))
      return tone ? { ...row, [ROW_TONE_KEY]: tone } : row
    }),
  }
}

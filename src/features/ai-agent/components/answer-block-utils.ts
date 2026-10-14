import type { AnswerBlock } from '../types'

/** 多轮工具调用中完全相同的结构化块只渲染一次。 */
export function dedupeAnswerBlocks(blocks: AnswerBlock[]): AnswerBlock[] {
  const seen = new Set<string>()
  return blocks.filter((block) => {
    let key: string
    try {
      key = JSON.stringify(block)
    } catch {
      return true
    }
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

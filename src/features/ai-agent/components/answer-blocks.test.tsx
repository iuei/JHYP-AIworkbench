import '@/styles/index.css'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import type { AnswerBlock } from '../types'
import { dedupeAnswerBlocks } from './answer-block-utils'
import { AnswerBlocks } from './answer-blocks'

/**
 * 共享表格渲染的护栏（2026-09-17）。
 *
 * `answer-blocks.tsx` 是 **AI 助手回答卡片与竞品分析结果页共用**的渲染层：本轮为竞品分析的
 * TOP 流量词 / 差评高频词加了"行级归属色"（`row.original.__tone`），这里守住两条不变量：
 *
 * 1. **没有 `__tone` 的表与改动前完全一致** —— 单元格不带任何底色（AI 助手的表格不会因此变色）；
 * 2. 带 `__tone` 的行**只给这一行**上色，别的行不受影响。
 *
 * 类名断言用 `--chart-N` 生成的那几个静态类（`bg-chart-1/10` 等），不写死色值。
 */
const TABLE: AnswerBlock = {
  kind: 'table',
  title: '广告日报明细',
  columns: [
    { key: 'asin', label: 'ASIN' },
    { key: 'spend', label: '花费', align: 'right' },
  ],
  rows: [
    { asin: 'B0PRIMARY1', spend: 12 },
    { asin: 'B0COMPETI1', spend: 34 },
  ],
}

async function cellClassNames(screen: Awaited<ReturnType<typeof render>>) {
  const cells = screen.container.querySelectorAll('tbody td')
  return [...cells].map((cell) => cell.className)
}

describe('AnswerBlocks 表格的归属色', () => {
  it('完全相同的结构化块只渲染一次，不同数据仍然保留', () => {
    const duplicate = { ...TABLE, rows: [...TABLE.rows!] }
    const changed = { ...TABLE, rows: [{ asin: 'B0OTHER01', spend: 9 }] }
    expect(dedupeAnswerBlocks([TABLE, duplicate, changed])).toEqual([
      TABLE,
      changed,
    ])
  })

  it('没有 __tone 的表：单元格不带任何底色（AI 助手表格零影响）', async () => {
    const screen = await render(<AnswerBlocks blocks={[TABLE]} />)
    await expect.element(screen.getByText('广告日报明细')).toBeInTheDocument()

    const classes = await cellClassNames(screen)
    expect(classes.length).toBeGreaterThan(0)
    expect(classes.every((name) => !name.includes('bg-chart-'))).toBe(true)
  })

  it('带 __tone 的行只给该行铺色（列上没有 tone 时）', async () => {
    const toned: AnswerBlock = {
      ...TABLE,
      rows: [
        { ...TABLE.rows![0], __tone: 1 },
        { ...TABLE.rows![1], __tone: 2 },
      ],
    }
    const screen = await render(<AnswerBlocks blocks={[toned]} />)
    await expect.element(screen.getByText('广告日报明细')).toBeInTheDocument()

    const classes = await cellClassNames(screen)
    // 第一行 2 格取 chart-1、第二行 2 格取 chart-2
    expect(classes.filter((name) => name.includes('bg-chart-1')).length).toBe(2)
    expect(classes.filter((name) => name.includes('bg-chart-2')).length).toBe(2)
  })
})

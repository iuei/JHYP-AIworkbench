import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { ComparisonHistory } from './comparison-history'
import type { ComparisonHistoryItem } from '../types'

/**
 * 历史对比表格（2026-09-16 由右栏卡片改为整宽表格）。
 *
 * 为什么补组件测试：真实库里候选池是空的（`product_dev_candidates` 0 行），
 * 造一条对比记录要先建 2 个候选并写库 —— 为了验证"行怎么渲染"去污染用户数据不值得。
 * 组件测试直接喂 mock 数据，覆盖的正是端到端脚本覆盖不到的那一段。
 */
const items: ComparisonHistoryItem[] = [
  {
    id: 1,
    title: '春季新品对比',
    marketplace: 'US',
    candidateCount: 3,
    startDate: '2026-08-01',
    endDate: '2026-08-30',
    createdAt: '2026-09-01T10:00:00.000Z',
  },
  {
    id: 2,
    // 没起名字的记录：标题位应回落到"N 个候选对比"，而不是留空
    title: '',
    marketplace: 'DE',
    candidateCount: 2,
    startDate: '2026-08-05',
    endDate: '2026-08-25',
    createdAt: '2026-09-02T10:00:00.000Z',
  },
]

async function renderPanel(
  { activeId = null, list = items }: { activeId?: number | null; list?: ComparisonHistoryItem[] } = {}
) {
  const onSelect = vi.fn()
  const onDelete = vi.fn()
  const onRefresh = vi.fn()
  const { container } = await render(
    <ComparisonHistory
      activeId={activeId}
      items={list}
      loading={false}
      refreshing={false}
      onDelete={onDelete}
      onRefresh={onRefresh}
      onSelect={onSelect}
    />
  )
  return { container, onSelect, onDelete, onRefresh }
}

describe('ComparisonHistory', () => {
  it('以表格呈现，表头为对比 / 站点 / 候选数 / 区间 / 时间 / 操作', async () => {
    const { container } = await renderPanel()
    const headers = [...container.querySelectorAll('thead th')].map((cell) =>
      cell.textContent?.replace(/\s+/g, '')
    )
    expect(headers).toEqual(['对比', '站点', '候选数', '区间', '时间', '操作'])
  })

  it('每条记录渲染一行，未命名记录回落为「N 个候选对比」', async () => {
    const { container } = await renderPanel()
    const rows = container.querySelectorAll('[data-comparison-history]')
    expect(rows).toHaveLength(2)
    const text = container.textContent ?? ''
    expect(text).toContain('春季新品对比')
    expect(text).toContain('2 个候选对比')
    expect(text).toContain('DE 站')
    expect(text).toContain('2026-08-01 ~ 2026-08-30')
  })

  it('点「回看」把该条 id 交出去；删除按钮带可访问名', async () => {
    const { container, onSelect, onDelete } = await renderPanel()
    const reviewButtons = [...container.querySelectorAll('button')].filter(
      (button) => button.textContent?.trim() === '回看'
    )
    expect(reviewButtons).toHaveLength(2)
    reviewButtons[0].click()
    expect(onSelect).toHaveBeenCalledWith(1)

    const deleteButton = [...container.querySelectorAll('button')].find((button) =>
      button.getAttribute('aria-label')?.includes('的对比记录')
    )
    expect(deleteButton).toBeDefined()
    deleteButton?.click()
    expect(onDelete).toHaveBeenCalledWith(items[0])
  })

  it('当前回看的那条标为选中（data-state=selected）', async () => {
    const { container } = await renderPanel({ activeId: 2 })
    const rows = container.querySelectorAll('[data-comparison-history]')
    expect(rows[0].getAttribute('data-state')).toBeNull()
    expect(rows[1].getAttribute('data-state')).toBe('selected')
  })

  it('没有记录时给出空态说明，而不是一张空表', async () => {
    const { container } = await renderPanel({ list: [] })
    expect(container.querySelectorAll('[data-comparison-history]')).toHaveLength(0)
    expect(container.textContent).toContain(
      '还没有保存过对比。在「候选池」里勾选 2 个以上候选后即可发起对比。'
    )
  })
})

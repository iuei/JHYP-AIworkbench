import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import type { HistoryItem } from '../types'
import { HistoryLevelBadge } from './history-level-badge'

/**
 * 「历史列表里的判定徽章」的口径护栏（2026-09-17）。
 *
 * 守的是用户实测报上来的那一条：「在分析结果页标记为已处理后历史分析为什么还是展示需立即处理」——
 * 这一列必须用**未销账**口径（`openLevel`），否则用户销账后回到列表仍看到红字，只会认为标记没生效。
 *
 * 同时守住"部分销账"这个容易写错的边界：还有 high 没处理时**必须继续报 high**。
 */
function itemOf(overrides: Partial<HistoryItem>): HistoryItem {
  return {
    id: 1,
    inputType: 'ASIN',
    inputValue: 'B0SUBJECT1',
    asins: ['B0SUBJECT1'],
    marketplace: 'US',
    startDate: null,
    endDate: null,
    windowDays: 30,
    compareWith: 'previous_period',
    headline: null,
    level: 'high',
    findingCount: 3,
    hasSnapshot: true,
    createdAt: '2026-09-17T00:00:00.000Z',
    ...overrides,
  }
}

function text() {
  return document.body.textContent ?? ''
}

describe('HistoryLevelBadge', () => {
  it('销账后不再显示快照判定的「需立即处理」', async () => {
    await render(
      <HistoryLevelBadge
        item={itemOf({
          level: 'high',
          openLevel: 'info',
          openFindingCount: 0,
          clearedFindingCount: 3,
        })}
      />
    )

    expect(text()).toContain('提示')
    expect(text()).not.toContain('需立即处理')
  })

  it('有销账时补一句「已销账 N 条」，让用户看到自己的操作生效了', async () => {
    await render(
      <HistoryLevelBadge
        item={itemOf({
          level: 'high',
          openLevel: 'medium',
          openFindingCount: 1,
          clearedFindingCount: 2,
        })}
      />
    )

    expect(text()).toContain('需关注')
    expect(text()).toContain('已销账 2 条')
  })

  it('部分销账时仍按「未销账里的最高级别」报警（不许因为销了一条就压下去）', async () => {
    await render(
      <HistoryLevelBadge
        item={itemOf({
          level: 'high',
          openLevel: 'high',
          openFindingCount: 2,
          clearedFindingCount: 1,
        })}
      />
    )

    expect(text()).toContain('需立即处理')
    expect(text()).toContain('已销账 1 条')
  })

  it('没有销账时不显示「已销账」（不能用含 info 的总数减出正数）', async () => {
    await render(
      <HistoryLevelBadge
        item={itemOf({ level: 'medium', openLevel: 'medium', openFindingCount: 2, clearedFindingCount: 0 })}
      />
    )

    expect(text()).toContain('需关注')
    expect(text()).not.toContain('已销账')
  })

  it('缺 openLevel（老接口）时回退到快照判定，行为与改前一致', async () => {
    await render(<HistoryLevelBadge item={itemOf({ level: 'medium' })} />)

    expect(text()).toContain('需关注')
  })
})

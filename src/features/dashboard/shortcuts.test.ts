import { describe, expect, it } from 'vitest'
import {
  dashboardShortcuts,
  defaultShortcutIds,
  moveShortcut,
  normalizeShortcutIds,
  orderShortcuts,
  shiftShortcut,
} from './shortcuts'

/**
 * 历史版本保存过的入口：前三个是模板遗留的占位 ID，
 * `quick-navigation` 是 2026-09-15 随快捷导航模块一起删除的真实入口 ——
 * 两者都无对应路由，必须被 `normalizeShortcutIds` 丢弃。
 */
const retiredIds = ['project', 'listing', 'reviews', 'quick-navigation']

describe('dashboardShortcuts', () => {
  it('只保留有真实路由的常用入口', () => {
    expect(dashboardShortcuts.map((item) => item.id)).toEqual([
      'ai-chat',
      'competitor',
      'my-notes',
    ])
    for (const item of dashboardShortcuts) {
      expect(item.to).toBeTruthy()
      expect(item.title).toBeTruthy()
      expect(item.description).not.toBe('即将上线')
    }
  })

  it('不再包含已下线的入口', () => {
    const ids = dashboardShortcuts.map((item) => item.id)
    for (const retired of retiredIds) {
      expect(ids).not.toContain(retired)
    }
  })

  it('默认顺序与入口定义顺序一致', () => {
    expect(defaultShortcutIds).toEqual(dashboardShortcuts.map((item) => item.id))
  })
})

describe('normalizeShortcutIds', () => {
  it('没有保存顺序时返回默认顺序', () => {
    expect(normalizeShortcutIds([])).toEqual(defaultShortcutIds)
  })

  it('非数组输入也能返回默认顺序', () => {
    for (const input of [undefined, null, '', 'competitor', 0, {}]) {
      expect(normalizeShortcutIds(input)).toEqual(defaultShortcutIds)
    }
  })

  it('丢弃无法识别的 ID', () => {
    expect(normalizeShortcutIds(['competitor', 'unknown', 'ai-chat'])).toEqual([
      'competitor',
      'ai-chat',
      'my-notes',
    ])
  })

  it('丢弃重复 ID，保留首次出现的位置', () => {
    expect(
      normalizeShortcutIds(['my-notes', 'my-notes', 'competitor', 'my-notes'])
    ).toEqual(['my-notes', 'competitor', 'ai-chat'])
  })

  it('保留仍然有效的 ID 原有顺序，并把缺失入口按默认顺序追加', () => {
    expect(normalizeShortcutIds(['my-notes', 'ai-chat'])).toEqual([
      'my-notes',
      'ai-chat',
      'competitor',
    ])
  })

  it('兼容历史偏好：已下线的入口 ID 不会让首页只剩一个入口', () => {
    const normalized = normalizeShortcutIds([
      'competitor',
      'project',
      'listing',
      'reviews',
    ])

    expect(normalized).toEqual(['competitor', 'ai-chat', 'my-notes'])
    expect(normalized).toHaveLength(3)
  })

  it('兼容刚下线的快捷导航：保存过该 ID 的用户自动退回有效入口', () => {
    expect(
      normalizeShortcutIds(['quick-navigation', 'my-notes', 'ai-chat'])
    ).toEqual(['my-notes', 'ai-chat', 'competitor'])
  })

  it('结果恒为全部有效入口，且顺序稳定可复现', () => {
    const inputs = [
      [],
      ['competitor'],
      retiredIds,
      ['my-notes', 'my-notes', 'unknown'],
      ['quick-navigation', 'competitor', 'my-notes', 'ai-chat'],
    ]

    for (const input of inputs) {
      const first = normalizeShortcutIds(input)
      expect(first).toHaveLength(3)
      expect(new Set(first).size).toBe(3)
      expect(first).toEqual(normalizeShortcutIds(input))
      // 归一化是幂等的：已是有效顺序的输入不应被再次打乱。
      expect(normalizeShortcutIds(first)).toEqual(first)
    }
  })
})

describe('orderShortcuts', () => {
  it('把 ID 顺序映射回入口定义', () => {
    expect(orderShortcuts(['my-notes', 'competitor']).map((i) => i.id)).toEqual([
      'my-notes',
      'competitor',
      'ai-chat',
    ])
  })

  it('每个映射结果都能拿到渲染所需的字段', () => {
    for (const item of orderShortcuts(retiredIds)) {
      expect(item.title).toBeTruthy()
      expect(item.icon).toBeTruthy()
      expect(item.to).toBeTruthy()
    }
  })
})

describe('moveShortcut', () => {
  it('把入口移动到目标之前', () => {
    expect(moveShortcut(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual([
      'a',
      'd',
      'b',
      'c',
    ])
  })

  it('把入口移动到目标之后', () => {
    expect(moveShortcut(['a', 'b', 'c', 'd'], 'a', 'c', 'after')).toEqual([
      'b',
      'c',
      'a',
      'd',
    ])
  })

  it('未知 ID 或原地移动时保持原顺序', () => {
    expect(moveShortcut(['a', 'b'], 'x', 'b')).toEqual(['a', 'b'])
    expect(moveShortcut(['a', 'b'], 'a', 'x')).toEqual(['a', 'b'])
    expect(moveShortcut(['a', 'b'], 'a', 'a')).toEqual(['a', 'b'])
  })
})

describe('shiftShortcut', () => {
  it('相邻上移或下移一步', () => {
    expect(shiftShortcut(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c'])
    expect(shiftShortcut(['a', 'b', 'c'], 'b', 'down')).toEqual(['a', 'c', 'b'])
  })

  it('越界或未知 ID 时保持原顺序', () => {
    expect(shiftShortcut(['a', 'b', 'c'], 'a', 'up')).toEqual(['a', 'b', 'c'])
    expect(shiftShortcut(['a', 'b', 'c'], 'c', 'down')).toEqual(['a', 'b', 'c'])
    expect(shiftShortcut(['a', 'b', 'c'], 'x', 'up')).toEqual(['a', 'b', 'c'])
  })
})

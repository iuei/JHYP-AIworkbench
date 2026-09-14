import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultDashboardShortcutIds } from './dashboard-shortcuts.mjs'

test('首页默认快捷入口只包含有真实路由的四个入口', () => {
  assert.deepEqual(defaultDashboardShortcutIds, [
    'ai-chat',
    'quick-navigation',
    'competitor',
    'my-notes',
  ])
})

test('首页默认快捷入口不再包含已下线的占位 ID', () => {
  for (const retired of ['project', 'listing', 'reviews']) {
    assert.ok(
      !defaultDashboardShortcutIds.includes(retired),
      `默认顺序不应再包含已下线的占位入口 ${retired}`
    )
  }
})

test('首页默认快捷入口无重复且顺序稳定', () => {
  assert.equal(
    new Set(defaultDashboardShortcutIds).size,
    defaultDashboardShortcutIds.length
  )
  assert.equal(defaultDashboardShortcutIds.length, 4)
})

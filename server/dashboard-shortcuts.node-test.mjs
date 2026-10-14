import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultDashboardShortcutIds } from './dashboard-shortcuts.mjs'

test('首页默认快捷入口只包含有真实路由的入口', () => {
  assert.deepEqual(defaultDashboardShortcutIds, [
    'ai-chat',
    'competitor',
    'my-notes',
  ])
})

test('首页默认快捷入口不再包含已下线的 ID', () => {
  // quick-navigation 于 2026-09-15 随快捷导航模块一起删除，与前三个占位 ID 同类
  for (const retired of ['project', 'listing', 'reviews', 'quick-navigation']) {
    assert.ok(
      !defaultDashboardShortcutIds.includes(retired),
      `默认顺序不应再包含已下线的入口 ${retired}`
    )
  }
})

test('首页默认快捷入口无重复且顺序稳定', () => {
  assert.equal(
    new Set(defaultDashboardShortcutIds).size,
    defaultDashboardShortcutIds.length
  )
  assert.equal(defaultDashboardShortcutIds.length, 3)
})

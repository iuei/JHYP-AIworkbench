import assert from 'node:assert/strict'
import test from 'node:test'
import { announcementMigrations } from './announcement-migrations.mjs'
import {
  AnnouncementValidationError,
  isPendingForUser,
  MAX_BODY_LENGTH,
  MAX_TITLE_LENGTH,
  parseAnnouncementInput,
  parseAnnouncementStatus,
} from './announcements.mjs'

const validInput = {
  title: '系统维护通知',
  body: '本周六 22:00 停机维护。',
  displayMode: 'once',
  priority: 0,
  publishAt: null,
  expireAt: null,
}

test('announcement migrations use the free 300 range without duplicates', () => {
  const versions = announcementMigrations.map((migration) => migration.version)

  assert.ok(versions.length > 0)
  assert.equal(new Set(versions).size, versions.length, '版本号不能重复')
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b), '版本号必须递增排列')
  // 1 是快捷导航、2/3 是用户、100 起是 AI 助手、200 是竞品分析：复用任何一个号段
  // 都会被迁移器当成「已应用」静默跳过，表现成"迁移跑过了但表不存在"。
  assert.ok(
    versions.every((version) => version >= 300 && version < 400),
    '公告必须使用 300 号段'
  )
  assert.deepEqual(versions.slice(0, 2), [300, 301])
})

test('every announcement migration declares a name and an up function', () => {
  for (const migration of announcementMigrations) {
    assert.equal(typeof migration.name, 'string')
    assert.ok(migration.name.length > 0)
    assert.equal(typeof migration.up, 'function')
  }
})

test('parseAnnouncementInput trims text and defaults display mode to once', () => {
  const parsed = parseAnnouncementInput({
    title: '  系统维护通知  ',
    body: '  本周六 22:00 停机维护。  ',
  })

  assert.deepEqual(parsed, {
    title: '系统维护通知',
    body: '本周六 22:00 停机维护。',
    displayMode: 'once',
    priority: 0,
    publishAt: null,
    expireAt: null,
  })
})

test('parseAnnouncementInput rejects missing title or body', () => {
  assert.throws(
    () => parseAnnouncementInput({ ...validInput, title: '   ' }),
    AnnouncementValidationError
  )
  assert.throws(
    () => parseAnnouncementInput({ ...validInput, body: '   ' }),
    AnnouncementValidationError
  )
  assert.throws(
    () => parseAnnouncementInput({ ...validInput, title: undefined }),
    AnnouncementValidationError
  )
})

test('parseAnnouncementInput enforces length limits', () => {
  const longTitle = 'a'.repeat(MAX_TITLE_LENGTH + 1)
  const longBody = 'a'.repeat(MAX_BODY_LENGTH + 1)

  assert.throws(
    () => parseAnnouncementInput({ ...validInput, title: longTitle }),
    AnnouncementValidationError
  )
  assert.throws(
    () => parseAnnouncementInput({ ...validInput, body: longBody }),
    AnnouncementValidationError
  )
  // 边界值本身必须放行，否则"不超过 N 个字符"的文案就是错的
  assert.equal(
    parseAnnouncementInput({ ...validInput, title: 'a'.repeat(MAX_TITLE_LENGTH) })
      .title.length,
    MAX_TITLE_LENGTH
  )
})

test('parseAnnouncementInput rejects unknown display mode', () => {
  assert.throws(
    () => parseAnnouncementInput({ ...validInput, displayMode: 'sometimes' }),
    AnnouncementValidationError
  )
  assert.equal(
    parseAnnouncementInput({ ...validInput, displayMode: 'every_login' })
      .displayMode,
    'every_login'
  )
})

test('parseAnnouncementInput validates priority as an integer in range', () => {
  assert.throws(
    () => parseAnnouncementInput({ ...validInput, priority: 3.5 }),
    AnnouncementValidationError
  )
  assert.throws(
    () => parseAnnouncementInput({ ...validInput, priority: 101 }),
    AnnouncementValidationError
  )
  assert.throws(
    () => parseAnnouncementInput({ ...validInput, priority: 'high' }),
    AnnouncementValidationError
  )
  assert.equal(parseAnnouncementInput({ ...validInput, priority: -5 }).priority, -5)
})

test('parseAnnouncementInput normalizes schedule and rejects invalid windows', () => {
  const parsed = parseAnnouncementInput({
    ...validInput,
    publishAt: '2026-09-20T10:00:00+08:00',
    expireAt: '2026-09-30T10:00:00+08:00',
  })

  // 统一转成 UTC ISO：前端与数据库都能直接比较，不再各自解析一次
  assert.equal(parsed.publishAt, new Date('2026-09-20T10:00:00+08:00').toISOString())
  assert.equal(parsed.expireAt, new Date('2026-09-30T10:00:00+08:00').toISOString())

  // 空串与 undefined 都表示"不限制"，非法字符串必须报错而不是静默当作不限
  assert.equal(parseAnnouncementInput({ ...validInput, publishAt: '' }).publishAt, null)
  assert.throws(
    () => parseAnnouncementInput({ ...validInput, publishAt: '2026-13-45' }),
    AnnouncementValidationError
  )
  assert.throws(
    () =>
      parseAnnouncementInput({
        ...validInput,
        publishAt: '2026-09-30T10:00:00Z',
        expireAt: '2026-09-20T10:00:00Z',
      }),
    AnnouncementValidationError
  )
  assert.throws(
    () =>
      parseAnnouncementInput({
        ...validInput,
        publishAt: '2026-09-20T10:00:00Z',
        expireAt: '2026-09-20T10:00:00Z',
      }),
    AnnouncementValidationError
  )
})

test('parseAnnouncementStatus only accepts the three real statuses', () => {
  for (const status of ['draft', 'published', 'archived']) {
    assert.equal(parseAnnouncementStatus(status), status)
  }
  assert.throws(() => parseAnnouncementStatus('all'), AnnouncementValidationError)
  assert.throws(() => parseAnnouncementStatus(undefined), AnnouncementValidationError)
})

test('isPendingForUser: once stops after ack, every_login keeps popping', () => {
  // 「只弹一次」：点过确定（readAt 有值）就不再弹
  assert.equal(isPendingForUser({ displayMode: 'once', readAt: null }), true)
  assert.equal(isPendingForUser({ displayMode: 'once', readAt: new Date() }), false)

  // 「每次登录都弹」：已读记录只用于统计，不影响弹出
  assert.equal(isPendingForUser({ displayMode: 'every_login', readAt: null }), true)
  assert.equal(isPendingForUser({ displayMode: 'every_login', readAt: new Date() }), true)
})

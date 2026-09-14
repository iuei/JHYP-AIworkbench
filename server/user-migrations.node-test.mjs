import assert from 'node:assert/strict'
import test from 'node:test'
import { userMigrations } from './user-migrations.mjs'

test('user migrations use unique increasing versions inside the free range', () => {
  const versions = userMigrations.map((migration) => migration.version)

  assert.deepEqual(versions, [2])
  assert.equal(new Set(versions).size, versions.length)
  // 1 已被快捷导航占用、100 起属 AI 助手号段；复用号段会被迁移器当成"已应用"静默跳过。
  assert.ok(versions.every((version) => version > 1 && version < 100))
})

test('every user migration declares a name and an up function', () => {
  for (const migration of userMigrations) {
    assert.equal(typeof migration.name, 'string')
    assert.ok(migration.name.length > 0)
    assert.equal(typeof migration.up, 'function')
  }
})

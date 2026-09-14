import assert from 'node:assert/strict'
import test from 'node:test'
import { userMigrations } from './user-migrations.mjs'

test('user migrations use unique increasing versions inside the free range', () => {
  const versions = userMigrations.map((migration) => migration.version)

  // 不写死成某个具体列表：新增迁移是常态，把「当前只有 [2]」写成断言会让每次新增都失败
  // （交接文档记录过这类脆弱断言），这里只守住结构性质。
  assert.ok(versions.length > 0)
  assert.equal(new Set(versions).size, versions.length, '版本号不能重复')
  assert.deepEqual(versions, [...versions].sort((a, b) => a - b), '版本号必须递增排列')
  // 1 已被快捷导航占用、100 起属 AI 助手号段；复用号段会被迁移器当成"已应用"静默跳过。
  assert.ok(versions.every((version) => version > 1 && version < 100))
  // 已应用过的迁移不能从列表里删掉：已装库靠版本号判断是否应用过，删掉会让新库缺列。
  assert.deepEqual(versions.slice(0, 2), [2, 3])
})

test('every user migration declares a name and an up function', () => {
  for (const migration of userMigrations) {
    assert.equal(typeof migration.name, 'string')
    assert.ok(migration.name.length > 0)
    assert.equal(typeof migration.up, 'function')
  }
})

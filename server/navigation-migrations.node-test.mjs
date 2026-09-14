import assert from 'node:assert/strict'
import test from 'node:test'
import {
  navigationMigrations,
  quickNavigationSeed,
} from './navigation-migrations.mjs'

test('navigation migrations use unique increasing versions', () => {
  const versions = navigationMigrations.map((migration) => migration.version)
  assert.deepEqual(versions, [1])
  assert.equal(new Set(versions).size, versions.length)
})

test('quick navigation seed contains the complete reference page data', () => {
  const featured = quickNavigationSeed.find((group) => !group.category)
  const categories = quickNavigationSeed.filter((group) => group.category)
  const items = categories.flatMap((group) => group.items)
  const tags = new Set(items.flatMap((item) => item.tags ?? []))

  assert.equal(featured.items.length, 3)
  assert.equal(categories.length, 6)
  assert.equal(items.length, 13)
  assert.equal(tags.size, 22)
})


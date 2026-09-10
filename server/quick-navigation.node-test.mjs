import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assembleQuickNavigation,
  parseCategoryInput,
  parseNavigationItemInput,
  parseTagInput,
  QuickNavigationValidationError,
} from './quick-navigation.mjs'

test('assembleQuickNavigation returns sorted featured and categorized items', () => {
  const result = assembleQuickNavigation({
    categories: [
      { id: 2, name: '第二组', sort_order: 2 },
      { id: 1, name: '第一组', sort_order: 1 },
    ],
    items: [
      { id: 3, category_id: null, name: '置顶', url: 'https://a.test', description: '', placement: 'featured', sort_order: 0 },
      { id: 2, category_id: 1, name: '后项', url: 'https://b.test', description: '', placement: 'category', sort_order: 2 },
      { id: 1, category_id: 1, name: '前项', url: 'https://c.test', description: '', placement: 'category', sort_order: 1 },
    ],
    tags: [{ id: 5, name: '常用' }],
    itemTags: [{ item_id: 1, tag_id: 5, sort_order: 0 }],
  })

  assert.deepEqual(result.featuredItems.map((item) => item.name), ['置顶'])
  assert.deepEqual(result.categories.map((category) => category.name), [
    '第一组',
    '第二组',
  ])
  assert.deepEqual(result.categories[0].items.map((item) => item.name), [
    '前项',
    '后项',
  ])
  assert.deepEqual(result.categories[0].items[0].tags, [
    { id: 5, name: '常用' },
  ])
})

test('parseCategoryInput trims the name and accepts a non-negative order', () => {
  assert.deepEqual(parseCategoryInput({ name: ' 常用查询 ', sortOrder: 2 }), {
    name: '常用查询',
    sortOrder: 2,
  })
})

test('parseCategoryInput rejects an empty name and negative order', () => {
  assert.throws(
    () => parseCategoryInput({ name: '  ', sortOrder: 0 }),
    QuickNavigationValidationError
  )
  assert.throws(
    () => parseCategoryInput({ name: '常用查询', sortOrder: -1 }),
    QuickNavigationValidationError
  )
})

test('parseTagInput trims the tag name', () => {
  assert.deepEqual(parseTagInput({ name: ' 商标 ' }), { name: '商标' })
})

test('parseNavigationItemInput validates category placement and deduplicates tags', () => {
  assert.deepEqual(
    parseNavigationItemInput({
      name: ' 海关编码 ',
      url: 'https://example.com/path',
      description: ' 编码查询 ',
      placement: 'category',
      categoryId: 1,
      sortOrder: 3,
      tagIds: [2, 2, 3],
    }),
    {
      name: '海关编码',
      url: 'https://example.com/path',
      description: '编码查询',
      placement: 'category',
      categoryId: 1,
      sortOrder: 3,
      tagIds: [2, 3],
    }
  )
})

test('parseNavigationItemInput accepts a featured link without a category', () => {
  const result = parseNavigationItemInput({
    name: '积加 ERP',
    url: 'https://example.com',
    placement: 'featured',
  })
  assert.equal(result.categoryId, null)
  assert.equal(result.description, '')
  assert.equal(result.sortOrder, 0)
  assert.deepEqual(result.tagIds, [])
})

test('parseNavigationItemInput rejects unsafe URLs and invalid category placement', () => {
  assert.throws(
    () =>
      parseNavigationItemInput({
        name: '危险链接',
        url: 'javascript:alert(1)',
        placement: 'featured',
      }),
    QuickNavigationValidationError
  )
  assert.throws(
    () =>
      parseNavigationItemInput({
        name: '缺少分类',
        url: 'https://example.com',
        placement: 'category',
      }),
    QuickNavigationValidationError
  )
})

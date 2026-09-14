import { describe, expect, it } from 'vitest'
import { filterQuickNavigation } from './navigation-filter'
import type { QuickNavigationData } from './types'

const data: QuickNavigationData = {
  featuredItems: [
    {
      id: 9,
      categoryId: null,
      name: '积加 ERP',
      url: 'https://example.com/erp',
      description: '',
      placement: 'featured',
      sortOrder: 0,
      tags: [],
    },
  ],
  categories: [
    {
      id: 1,
      name: '常用查询',
      sortOrder: 0,
      items: [
        {
          id: 1,
          categoryId: 1,
          name: '美国商标查询入口',
          url: 'https://example.com/trademark',
          description: '美国官方商标检索平台',
          placement: 'category',
          sortOrder: 0,
          tags: [{ id: 1, name: '商标' }],
        },
        {
          id: 2,
          categoryId: 1,
          name: '海关编码',
          url: 'https://example.com/customs',
          description: '商品归类参考',
          placement: 'category',
          sortOrder: 1,
          tags: [{ id: 2, name: '报关' }],
        },
      ],
    },
  ],
  tags: [
    { id: 1, name: '商标' },
    { id: 2, name: '报关' },
  ],
}

describe('filterQuickNavigation', () => {
  it('keeps every item when the category name matches', () => {
    const result = filterQuickNavigation(data, '常用查询')
    expect(result.categories[0].items).toHaveLength(2)
  })

  it('filters items by name, description, or tag', () => {
    const result = filterQuickNavigation(data, '商标')
    expect(result.categories[0].items.map((item) => item.name)).toEqual([
      '美国商标查询入口',
    ])
  })

  it('filters featured items and removes empty category groups', () => {
    const result = filterQuickNavigation(data, 'ERP')
    expect(result.featuredItems.map((item) => item.name)).toEqual(['积加 ERP'])
    expect(result.categories).toEqual([])
  })
})


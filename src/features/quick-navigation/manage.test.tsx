import { describe, expect, it } from 'vitest'
import {
  createNavigationItemPayload,
  type NavigationItemDraft,
} from './navigation-form-model'

const baseDraft: NavigationItemDraft = {
  name: ' 海关编码 ',
  url: 'https://example.com',
  description: ' 商品归类 ',
  placement: 'category',
  categoryId: '3',
  sortOrder: '2',
  tagIds: [1, 2],
}

describe('createNavigationItemPayload', () => {
  it('normalizes a categorized navigation item', () => {
    expect(createNavigationItemPayload(baseDraft)).toEqual({
      name: '海关编码',
      url: 'https://example.com',
      description: '商品归类',
      placement: 'category',
      categoryId: 3,
      sortOrder: 2,
      tagIds: [1, 2],
    })
  })

  it('clears the category for a featured navigation item', () => {
    expect(
      createNavigationItemPayload({
        ...baseDraft,
        placement: 'featured',
      }).categoryId
    ).toBeNull()
  })
})

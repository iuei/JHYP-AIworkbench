export type NavigationItemDraft = {
  name: string
  url: string
  description: string
  placement: 'featured' | 'category'
  categoryId: string
  sortOrder: string
  tagIds: number[]
}

export const emptyNavigationItemDraft: NavigationItemDraft = {
  name: '',
  url: '',
  description: '',
  placement: 'category',
  categoryId: '',
  sortOrder: '0',
  tagIds: [],
}

export function createNavigationItemPayload(draft: NavigationItemDraft) {
  return {
    name: draft.name.trim(),
    url: draft.url.trim(),
    description: draft.description.trim(),
    placement: draft.placement,
    categoryId:
      draft.placement === 'category' ? Number(draft.categoryId) : null,
    sortOrder: Number(draft.sortOrder || 0),
    tagIds: draft.tagIds,
  }
}

export function canSubmitNavigationItem(draft: NavigationItemDraft) {
  const payload = createNavigationItemPayload(draft)
  try {
    const url = new URL(payload.url)
    return Boolean(
      payload.name &&
        ['http:', 'https:'].includes(url.protocol) &&
        Number.isInteger(payload.sortOrder) &&
        payload.sortOrder >= 0 &&
        (payload.placement === 'featured' ||
          (Number.isInteger(payload.categoryId) &&
            Number(payload.categoryId) > 0))
    )
  } catch {
    return false
  }
}


const placements = new Set(['featured', 'category'])

export class QuickNavigationValidationError extends Error {}

function requiredText(value, label, maxLength) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > maxLength) {
    throw new QuickNavigationValidationError(
      `${label}不能为空且不能超过 ${maxLength} 个字符。`
    )
  }
  return text
}

function nonNegativeInteger(value, label, fallback = 0) {
  const number = value === undefined ? fallback : value
  if (!Number.isInteger(number) || number < 0) {
    throw new QuickNavigationValidationError(`${label}必须是非负整数。`)
  }
  return number
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new QuickNavigationValidationError(`${label}参数无效。`)
  }
  return value
}

export function parseCategoryInput(input) {
  return {
    name: requiredText(input?.name, '分类名称', 80),
    sortOrder: nonNegativeInteger(input?.sortOrder, '分类排序'),
  }
}

export function parseTagInput(input) {
  return { name: requiredText(input?.name, '标签名称', 40) }
}

export function parseNavigationItemInput(input) {
  const name = requiredText(input?.name, '导航名称', 120)
  const url = requiredText(input?.url, '导航地址', 2048)
  let parsedUrl
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new QuickNavigationValidationError('导航地址格式无效。')
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new QuickNavigationValidationError('导航地址仅支持 HTTP 或 HTTPS。')
  }

  const description =
    typeof input?.description === 'string' ? input.description.trim() : ''
  if (description.length > 300) {
    throw new QuickNavigationValidationError('导航说明不能超过 300 个字符。')
  }

  const placement = input?.placement
  if (!placements.has(placement)) {
    throw new QuickNavigationValidationError('导航展示位置无效。')
  }

  let categoryId = null
  if (placement === 'category') {
    categoryId = positiveInteger(input?.categoryId, '分类')
  } else if (input?.categoryId !== undefined && input.categoryId !== null) {
    throw new QuickNavigationValidationError('置顶导航不能设置所属分类。')
  }

  const rawTagIds = input?.tagIds ?? []
  if (!Array.isArray(rawTagIds)) {
    throw new QuickNavigationValidationError('标签参数无效。')
  }
  const tagIds = [...new Set(rawTagIds.map((id) => positiveInteger(id, '标签')))]

  return {
    name,
    url,
    description,
    placement,
    categoryId,
    sortOrder: nonNegativeInteger(input?.sortOrder, '导航排序'),
    tagIds,
  }
}

export function assembleQuickNavigation({ categories, items, tags, itemTags }) {
  const tagById = new Map(tags.map((tag) => [tag.id, tag]))
  const tagsByItem = new Map()
  for (const relation of [...itemTags].sort(
    (left, right) => left.sort_order - right.sort_order
  )) {
    const tag = tagById.get(relation.tag_id)
    if (!tag) continue
    const current = tagsByItem.get(relation.item_id) ?? []
    current.push({ id: tag.id, name: tag.name })
    tagsByItem.set(relation.item_id, current)
  }

  const normalizedItems = items
    .map((item) => ({
      id: item.id,
      categoryId: item.category_id,
      name: item.name,
      url: item.url,
      description: item.description,
      placement: item.placement,
      sortOrder: item.sort_order,
      tags: tagsByItem.get(item.id) ?? [],
    }))
    .sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.id - right.id
    )

  return {
    featuredItems: normalizedItems.filter(
      (item) => item.placement === 'featured'
    ),
    categories: [...categories]
      .sort(
        (left, right) =>
          left.sort_order - right.sort_order || left.id - right.id
      )
      .map((category) => ({
        id: category.id,
        name: category.name,
        sortOrder: category.sort_order,
        items: normalizedItems.filter(
          (item) =>
            item.placement === 'category' &&
            item.categoryId === category.id
        ),
      })),
    tags: [...tags]
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
      .map((tag) => ({ id: tag.id, name: tag.name })),
  }
}

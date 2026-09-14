import type {
  NavigationItem,
  QuickNavigationData,
} from './types'

function itemMatches(item: NavigationItem, keyword: string) {
  return [
    item.name,
    item.description,
    ...item.tags.map((tag) => tag.name),
  ].some((value) => value.toLocaleLowerCase().includes(keyword))
}

export function filterQuickNavigation(
  data: QuickNavigationData,
  searchValue: string
): QuickNavigationData {
  const keyword = searchValue.trim().toLocaleLowerCase()
  if (!keyword) return data

  return {
    featuredItems: data.featuredItems.filter((item) =>
      itemMatches(item, keyword)
    ),
    categories: data.categories
      .map((category) => ({
        ...category,
        items: category.name.toLocaleLowerCase().includes(keyword)
          ? category.items
          : category.items.filter((item) => itemMatches(item, keyword)),
      }))
      .filter((category) => category.items.length > 0),
    tags: data.tags,
  }
}


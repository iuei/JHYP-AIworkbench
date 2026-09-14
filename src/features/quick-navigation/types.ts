export type NavigationTag = {
  id: number
  name: string
}

export type NavigationItem = {
  id: number
  categoryId: number | null
  name: string
  url: string
  description: string
  placement: 'featured' | 'category'
  sortOrder: number
  tags: NavigationTag[]
}

export type NavigationCategory = {
  id: number
  name: string
  sortOrder: number
  items: NavigationItem[]
}

export type QuickNavigationData = {
  featuredItems: NavigationItem[]
  categories: NavigationCategory[]
  tags: NavigationTag[]
}


import { useDeferredValue, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Search, Settings2, X } from 'lucide-react'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Main } from '@/components/layout/main'
import { navigationLoadErrorMessage } from './navigation-errors'
import { filterQuickNavigation } from './navigation-filter'
import type { QuickNavigationData } from './types'

function HighlightText({ text, keyword }: { text: string; keyword: string }) {
  const normalized = keyword.trim()
  if (!normalized) return text
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  return parts.map((part, index) =>
    part.toLocaleLowerCase() === normalized.toLocaleLowerCase() ? (
      <mark
        className='rounded-sm bg-primary/10 px-0.5 font-medium text-primary'
        key={`${part}-${index}`}
      >
        {part}
      </mark>
    ) : (
      part
    )
  )
}

function NavigationLoading() {
  return (
    <div className='space-y-6' aria-label='正在加载快捷导航'>
      {[0, 1].map((group) => (
        <div className='space-y-3' key={group}>
          <Skeleton className='h-5 w-32' />
          <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
            {[0, 1, 2, 3].map((card) => (
              <Skeleton className='h-[4.5rem] rounded-lg' key={card} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function QuickNavigation() {
  const [searchValue, setSearchValue] = useState('')
  const keyword = useDeferredValue(searchValue)
  const currentUser = useAuthStore((state) => state.auth.user)
  const isAdmin = currentUser?.role.includes('admin') ?? false
  const navigation = useQuery<QuickNavigationData>({
    queryKey: ['quick-navigation'],
    queryFn: async () => (await api.get('/quick-navigation')).data,
  })
  const filtered = useMemo(
    () =>
      navigation.data
        ? filterQuickNavigation(navigation.data, keyword)
        : undefined,
    [navigation.data, keyword]
  )
  const hasResults = Boolean(
    filtered &&
    (filtered.featuredItems.length > 0 || filtered.categories.length > 0)
  )

  return (
    <>
      <Main className='pb-8'>
        <div className='mx-auto w-full max-w-[1400px]'>
          <div className='mb-5 flex w-full flex-col gap-2 sm:flex-row sm:items-center'>
            <div className='relative min-w-0 flex-1 sm:max-w-md'>
              <Search className='absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
              <Input
                aria-label='搜索快捷导航'
                className='bg-muted/30 pr-9 pl-9 focus-visible:bg-background'
                placeholder='搜索系统、工具或标签...'
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
              />
              {searchValue && (
                <Button
                  aria-label='清空搜索'
                  className='absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground'
                  size='icon'
                  variant='ghost'
                  onClick={() => setSearchValue('')}
                >
                  <X />
                </Button>
              )}
            </div>
            {isAdmin && (
              <Button asChild variant='outline'>
                <Link to='/quick-navigation/manage'>
                  <Settings2 />
                  管理导航
                </Link>
              </Button>
            )}
          </div>

          {navigation.isLoading && <NavigationLoading />}
          {navigation.isError && (
            <div className='rounded-xl border border-dashed p-12 text-center'>
              <p className='font-medium'>快捷导航加载失败</p>
              <p className='mt-1 text-sm text-muted-foreground'>
                {navigationLoadErrorMessage(navigation.error)}
              </p>
              <Button
                className='mt-4'
                variant='outline'
                onClick={() => navigation.refetch()}
              >
                重新加载
              </Button>
            </div>
          )}

          {filtered && hasResults && (
            <div aria-label='快捷导航搜索结果' aria-live='polite'>
              {filtered.featuredItems.length > 0 && (
                <section className='mb-6' aria-labelledby='featured-title'>
                  <h2
                    className='mb-3 text-sm font-semibold text-muted-foreground'
                    id='featured-title'
                  >
                    常用入口
                  </h2>
                  <nav
                    aria-label='置顶快捷入口'
                    className='flex flex-wrap gap-2'
                  >
                    {filtered.featuredItems.map((item) => (
                      <a
                        className='group inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-2 text-sm font-medium transition-[border-color,background-color,color] hover:border-primary hover:bg-accent hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                        href={item.url}
                        key={item.id}
                        rel='noopener noreferrer'
                        target='_blank'
                      >
                        <HighlightText text={item.name} keyword={keyword} />
                        <ArrowUpRight className='size-3.5 text-muted-foreground transition-colors group-hover:text-primary' />
                      </a>
                    ))}
                  </nav>
                </section>
              )}

              <div className='space-y-7'>
                {filtered.categories.map((category) => (
                  <section key={category.id}>
                    <div className='mb-3 flex items-center gap-3'>
                      <h2 className='shrink-0 text-sm font-semibold'>
                        <HighlightText text={category.name} keyword={keyword} />
                      </h2>
                      <div className='h-px flex-1 bg-border' />
                    </div>
                    <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
                      {category.items.map((item) => (
                        <a
                          className='group flex min-h-[4.5rem] items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs transition-[border-color,box-shadow] hover:border-primary hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                          href={item.url}
                          key={item.id}
                          rel='noopener noreferrer'
                          target='_blank'
                        >
                          <div className='min-w-0'>
                            <h3 className='truncate font-medium text-card-foreground transition-colors group-hover:text-primary'>
                              <HighlightText
                                text={item.name}
                                keyword={keyword}
                              />
                            </h3>
                            {item.description && (
                              <p className='mt-0.5 truncate text-xs text-muted-foreground'>
                                <HighlightText
                                  text={item.description}
                                  keyword={keyword}
                                />
                              </p>
                            )}
                          </div>
                          <ArrowUpRight className='size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary' />
                        </a>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}

          {filtered && !hasResults && (
            <div className='rounded-xl border border-dashed py-14 text-center'>
              <Search className='mx-auto mb-3 size-8 text-muted-foreground/30' />
              <p className='font-medium'>未找到匹配的系统或工具</p>
              <p className='mt-1 text-sm text-muted-foreground'>
                尝试更换关键词，或清空搜索条件。
              </p>
            </div>
          )}
        </div>
      </Main>
    </>
  )
}

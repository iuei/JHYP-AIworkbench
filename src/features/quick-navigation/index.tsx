import { useDeferredValue, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowUpRight,
  Search,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth-store'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { filterQuickNavigation } from './navigation-filter'
import { navigationLoadErrorMessage } from './navigation-errors'
import { NavigationTag } from './navigation-tag'
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
    <div className='space-y-8' aria-label='正在加载快捷导航'>
      {[0, 1].map((group) => (
        <div className='space-y-4' key={group}>
          <Skeleton className='h-5 w-32' />
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
            {[0, 1, 2, 3].map((card) => (
              <Skeleton className='h-32 rounded-xl' key={card} />
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
      <Header fixed>
        <div className='me-auto font-medium'>快捷导航</div>
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='pb-12'>
        <div className='mx-auto w-full max-w-[1400px]'>
          <div className='mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between'>
            <div>
              <div className='mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground'>
                <Sparkles className='size-4' />
                Internal workflow
              </div>
              <h1 className='text-2xl font-bold tracking-tight'>快捷导航</h1>
              <p className='mt-1 text-sm text-muted-foreground'>
                集中访问核心业务系统、自动化工具与内部知识库。
              </p>
            </div>
            <div className='flex w-full flex-col gap-2 sm:flex-row lg:w-auto'>
              <div className='relative min-w-0 sm:w-80'>
                <Search className='absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
                <Input
                  aria-label='搜索快捷导航'
                  className='bg-muted/40 pr-9 pl-9 focus-visible:bg-background'
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
                <nav
                  aria-label='置顶快捷入口'
                  className='mb-10 flex flex-wrap justify-center gap-x-8 gap-y-3 rounded-xl border border-border/70 bg-muted/25 px-5 py-4'
                >
                  {filtered.featuredItems.map((item) => (
                    <a
                      className='group inline-flex items-center gap-1.5 font-medium text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-primary'
                      href={item.url}
                      key={item.id}
                      rel='noopener noreferrer'
                      target='_blank'
                    >
                      <HighlightText text={item.name} keyword={keyword} />
                      <ArrowUpRight className='size-3.5 opacity-50 transition-opacity group-hover:opacity-100' />
                    </a>
                  ))}
                </nav>
              )}

              <div className='space-y-10'>
                {filtered.categories.map((category) => (
                  <section key={category.id}>
                    <div className='mb-5 flex items-center gap-3'>
                      <h2 className='shrink-0 text-sm font-bold tracking-[0.14em] text-muted-foreground uppercase'>
                        <HighlightText
                          text={category.name}
                          keyword={keyword}
                        />
                      </h2>
                      <div className='h-px flex-1 bg-border' />
                    </div>
                    <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4'>
                      {category.items.map((item) => (
                        <a
                          className='group flex min-h-32 flex-col rounded-xl border bg-card p-5 shadow-xs transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                          href={item.url}
                          key={item.id}
                          rel='noopener noreferrer'
                          target='_blank'
                        >
                          <div className='mb-2 flex items-start justify-between gap-3'>
                            <h3 className='font-bold text-card-foreground transition-colors group-hover:text-primary'>
                              <HighlightText
                                text={item.name}
                                keyword={keyword}
                              />
                            </h3>
                            <ArrowUpRight className='mt-0.5 size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-primary' />
                          </div>
                          <p className='mb-4 line-clamp-2 text-sm leading-relaxed text-muted-foreground'>
                            <HighlightText
                              text={item.description}
                              keyword={keyword}
                            />
                          </p>
                          {item.tags.length > 0 && (
                            <div className='mt-auto flex flex-wrap gap-1.5'>
                              {item.tags.map((tag) => (
                                <NavigationTag
                                  key={tag.id}
                                  name={tag.name}
                                />
                              ))}
                            </div>
                          )}
                        </a>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}

          {filtered && !hasResults && (
            <div className='rounded-xl border border-dashed py-20 text-center'>
              <Search className='mx-auto mb-4 size-10 text-muted-foreground/30' />
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

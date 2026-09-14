import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { isAxiosError } from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ExternalLink,
  FolderKanban,
  Pencil,
  Plus,
  Tags,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { useAuthStore } from '@/stores/auth-store'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { HeaderSlot } from '@/components/layout/header-slot'
import { Main } from '@/components/layout/main'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  NavigationItemForm,
} from './navigation-form'
import {
  canSubmitNavigationItem,
  createNavigationItemPayload,
  emptyNavigationItemDraft,
  type NavigationItemDraft,
} from './navigation-form-model'
import { NavigationTag } from './navigation-tag'
import type {
  NavigationCategory,
  NavigationItem,
  NavigationTag as NavigationTagType,
  QuickNavigationData,
} from './types'

type CategoryEditor = {
  id: number | null
  name: string
  sortOrder: string
}

type TagEditor = {
  id: number | null
  name: string
}

type ItemEditor = {
  id: number | null
  draft: NavigationItemDraft
}

type DeleteTarget = {
  id: number
  kind: 'category' | 'item' | 'tag'
  name: string
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? fallback
  }
  return fallback
}

function itemDraft(item: NavigationItem): NavigationItemDraft {
  return {
    name: item.name,
    url: item.url,
    description: item.description,
    placement: item.placement,
    categoryId: item.categoryId ? String(item.categoryId) : '',
    sortOrder: String(item.sortOrder),
    tagIds: item.tags.map((tag) => tag.id),
  }
}

function ManagementHeader({
  description,
  icon: Icon,
  title,
  buttonText,
  onCreate,
}: {
  description: string
  icon: typeof FolderKanban
  title: string
  buttonText: string
  onCreate: () => void
}) {
  return (
    <div className='mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
      <div>
        <h2 className='flex items-center gap-2 font-semibold'>
          <Icon className='size-4 text-muted-foreground' />
          {title}
        </h2>
        <p className='mt-1 text-sm text-muted-foreground'>{description}</p>
      </div>
      <Button onClick={onCreate}>
        <Plus />
        {buttonText}
      </Button>
    </div>
  )
}

export function QuickNavigationManage() {
  const currentUser = useAuthStore((state) => state.auth.user)
  const isAdmin = currentUser?.role.includes('admin') ?? false
  const queryClient = useQueryClient()
  const [categoryEditor, setCategoryEditor] = useState<CategoryEditor | null>(
    null
  )
  const [tagEditor, setTagEditor] = useState<TagEditor | null>(null)
  const [itemEditor, setItemEditor] = useState<ItemEditor | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const navigation = useQuery<QuickNavigationData>({
    queryKey: ['quick-navigation'],
    enabled: isAdmin,
    queryFn: async () => (await api.get('/quick-navigation')).data,
  })
  const items = useMemo(
    () => [
      ...(navigation.data?.featuredItems ?? []),
      ...(navigation.data?.categories.flatMap((category) => category.items) ??
        []),
    ],
    [navigation.data]
  )

  async function refreshNavigation() {
    await queryClient.invalidateQueries({ queryKey: ['quick-navigation'] })
  }

  const saveCategory = useMutation({
    mutationFn: async (editor: CategoryEditor) => {
      const payload = {
        name: editor.name.trim(),
        sortOrder: Number(editor.sortOrder || 0),
      }
      return editor.id
        ? api.patch(`/navigation-categories/${editor.id}`, payload)
        : api.post('/navigation-categories', payload)
    },
    onSuccess: async () => {
      await refreshNavigation()
      setCategoryEditor(null)
      toast.success('分类已保存')
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, '分类保存失败，请重试')),
  })
  const saveTag = useMutation({
    mutationFn: async (editor: TagEditor) => {
      const payload = { name: editor.name.trim() }
      return editor.id
        ? api.patch(`/navigation-tags/${editor.id}`, payload)
        : api.post('/navigation-tags', payload)
    },
    onSuccess: async () => {
      await refreshNavigation()
      setTagEditor(null)
      toast.success('标签已保存')
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, '标签保存失败，请重试')),
  })
  const saveItem = useMutation({
    mutationFn: async (editor: ItemEditor) => {
      const payload = createNavigationItemPayload(editor.draft)
      return editor.id
        ? api.patch(`/navigation-items/${editor.id}`, payload)
        : api.post('/navigation-items', payload)
    },
    onSuccess: async () => {
      await refreshNavigation()
      setItemEditor(null)
      toast.success('导航项已保存')
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, '导航项保存失败，请重试')),
  })
  const remove = useMutation({
    mutationFn: async (target: DeleteTarget) => {
      const resource =
        target.kind === 'category'
          ? 'navigation-categories'
          : target.kind === 'tag'
            ? 'navigation-tags'
            : 'navigation-items'
      return api.delete(`/${resource}/${target.id}`)
    },
    onSuccess: async () => {
      await refreshNavigation()
      setDeleteTarget(null)
      toast.success('数据已删除')
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, '删除失败，请重试')),
  })

  if (!isAdmin) {
    return (
      <Main>
        <div className='rounded-xl border p-8 text-center'>
          <p className='font-medium'>该功能仅对管理员开放。</p>
          <Button asChild className='mt-4' variant='outline'>
            <Link to='/quick-navigation'>返回快捷导航</Link>
          </Button>
        </div>
      </Main>
    )
  }

  return (
    <>
      {/* 页面级操作（返回）注入顶栏，与页面名同一行；标题由路由 staticData 提供。 */}
      <HeaderSlot>
        <Button asChild aria-label='返回快捷导航' size='icon' variant='ghost'>
          <Link to='/quick-navigation'>
            <ArrowLeft />
          </Link>
        </Button>
      </HeaderSlot>
      <Main className='pb-8'>
        <div className='space-y-4'>
          {navigation.isLoading && (
            <div className='rounded-xl border p-8 text-sm text-muted-foreground'>
              正在加载导航数据…
            </div>
          )}
          {navigation.isError && (
            <div className='rounded-xl border border-dashed p-8 text-center'>
              <p className='font-medium'>导航数据加载失败</p>
              <Button
                className='mt-4'
                variant='outline'
                onClick={() => navigation.refetch()}
              >
                重新加载
              </Button>
            </div>
          )}

          {navigation.data && (
            <Tabs defaultValue='items'>
              <TabsList className='mb-4'>
                <TabsTrigger value='items'>导航项</TabsTrigger>
                <TabsTrigger value='categories'>分类</TabsTrigger>
                <TabsTrigger value='tags'>标签</TabsTrigger>
              </TabsList>

              <TabsContent value='items'>
                <ManagementHeader
                  buttonText='新增导航项'
                  description='维护顶部置顶链接与分类卡片。'
                  icon={ExternalLink}
                  title='导航项'
                  onCreate={() =>
                    setItemEditor({
                      id: null,
                      draft: {
                        ...emptyNavigationItemDraft,
                        categoryId: navigation.data.categories[0]
                          ? String(navigation.data.categories[0].id)
                          : '',
                      },
                    })
                  }
                />
                <div className='overflow-hidden rounded-lg border'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>导航项</TableHead>
                        <TableHead>位置</TableHead>
                        <TableHead>标签</TableHead>
                        <TableHead>排序</TableHead>
                        <TableHead className='text-right'>操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className='max-w-sm'>
                            <p className='font-medium'>{item.name}</p>
                            <p className='truncate text-xs text-muted-foreground'>
                              {item.url}
                            </p>
                          </TableCell>
                          <TableCell>
                            {item.placement === 'featured'
                              ? '顶部置顶'
                              : navigation.data.categories.find(
                                  (category) => category.id === item.categoryId
                                )?.name}
                          </TableCell>
                          <TableCell>
                            <div className='flex max-w-64 flex-wrap gap-1'>
                              {item.tags.map((tag) => (
                                <NavigationTag key={tag.id} name={tag.name} />
                              ))}
                              {item.tags.length === 0 && (
                                <span className='text-muted-foreground'>—</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{item.sortOrder}</TableCell>
                          <TableCell className='space-x-1 text-right whitespace-nowrap'>
                            <Button
                              aria-label={`编辑 ${item.name}`}
                              size='icon'
                              variant='ghost'
                              onClick={() =>
                                setItemEditor({
                                  id: item.id,
                                  draft: itemDraft(item),
                                })
                              }
                            >
                              <Pencil />
                            </Button>
                            <Button
                              aria-label={`删除 ${item.name}`}
                              size='icon'
                              variant='ghost'
                              onClick={() =>
                                setDeleteTarget({
                                  id: item.id,
                                  kind: 'item',
                                  name: item.name,
                                })
                              }
                            >
                              <Trash2 />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value='categories'>
                <ManagementHeader
                  buttonText='新增分类'
                  description='分类用于组织导航卡片，非空分类不能删除。'
                  icon={FolderKanban}
                  title='分类'
                  onCreate={() =>
                    setCategoryEditor({ id: null, name: '', sortOrder: '0' })
                  }
                />
                <CategoryTable
                  categories={navigation.data.categories}
                  onDelete={(category) =>
                    setDeleteTarget({
                      id: category.id,
                      kind: 'category',
                      name: category.name,
                    })
                  }
                  onEdit={(category) =>
                    setCategoryEditor({
                      id: category.id,
                      name: category.name,
                      sortOrder: String(category.sortOrder),
                    })
                  }
                />
              </TabsContent>

              <TabsContent value='tags'>
                <ManagementHeader
                  buttonText='新增标签'
                  description='标签可被多个导航项复用，删除后自动解除关联。'
                  icon={Tags}
                  title='标签'
                  onCreate={() => setTagEditor({ id: null, name: '' })}
                />
                <TagTable
                  items={items}
                  tags={navigation.data.tags}
                  onDelete={(tag) =>
                    setDeleteTarget({
                      id: tag.id,
                      kind: 'tag',
                      name: tag.name,
                    })
                  }
                  onEdit={(tag) => setTagEditor({ id: tag.id, name: tag.name })}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </Main>

      <Dialog
        open={Boolean(categoryEditor)}
        onOpenChange={(open) => !open && setCategoryEditor(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {categoryEditor?.id ? '编辑分类' : '新增分类'}
            </DialogTitle>
            <DialogDescription>设置分类名称及显示顺序。</DialogDescription>
          </DialogHeader>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='space-y-2 sm:col-span-2'>
              <Label htmlFor='category-name'>分类名称</Label>
              <Input
                id='category-name'
                maxLength={80}
                value={categoryEditor?.name ?? ''}
                onChange={(event) =>
                  categoryEditor &&
                  setCategoryEditor({
                    ...categoryEditor,
                    name: event.target.value,
                  })
                }
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='category-order'>显示顺序</Label>
              <Input
                id='category-order'
                min={0}
                type='number'
                value={categoryEditor?.sortOrder ?? '0'}
                onChange={(event) =>
                  categoryEditor &&
                  setCategoryEditor({
                    ...categoryEditor,
                    sortOrder: event.target.value,
                  })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setCategoryEditor(null)}>
              取消
            </Button>
            <Button
              disabled={
                !categoryEditor?.name.trim() || saveCategory.isPending
              }
              onClick={() => categoryEditor && saveCategory.mutate(categoryEditor)}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(tagEditor)}
        onOpenChange={(open) => !open && setTagEditor(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tagEditor?.id ? '编辑标签' : '新增标签'}</DialogTitle>
            <DialogDescription>标签名称在系统内不可重复。</DialogDescription>
          </DialogHeader>
          <div className='space-y-2'>
            <Label htmlFor='tag-name'>标签名称</Label>
            <Input
              id='tag-name'
              maxLength={40}
              value={tagEditor?.name ?? ''}
              onChange={(event) =>
                tagEditor &&
                setTagEditor({ ...tagEditor, name: event.target.value })
              }
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setTagEditor(null)}>
              取消
            </Button>
            <Button
              disabled={!tagEditor?.name.trim() || saveTag.isPending}
              onClick={() => tagEditor && saveTag.mutate(tagEditor)}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(itemEditor)}
        onOpenChange={(open) => !open && setItemEditor(null)}
      >
        <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>
              {itemEditor?.id ? '编辑导航项' : '新增导航项'}
            </DialogTitle>
            <DialogDescription>
              设置入口信息、展示位置、排序和多个标签。
            </DialogDescription>
          </DialogHeader>
          {itemEditor && navigation.data && (
            <NavigationItemForm
              categories={navigation.data.categories}
              formId='navigation-item-form'
              tags={navigation.data.tags}
              value={itemEditor.draft}
              onChange={(draft) => setItemEditor({ ...itemEditor, draft })}
              onSubmit={() => saveItem.mutate(itemEditor)}
            />
          )}
          <DialogFooter>
            <Button variant='outline' onClick={() => setItemEditor(null)}>
              取消
            </Button>
            <Button
              disabled={
                !itemEditor ||
                !canSubmitNavigationItem(itemEditor.draft) ||
                saveItem.isPending
              }
              form='navigation-item-form'
              type='submit'
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        destructive
        desc={
          deleteTarget?.kind === 'tag'
            ? '删除后，该标签会从所有导航项中移除。'
            : '删除后无法恢复，请确认该操作。'
        }
        isLoading={remove.isPending}
        open={Boolean(deleteTarget)}
        title={`删除“${deleteTarget?.name ?? ''}”？`}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        handleConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </>
  )
}

function CategoryTable({
  categories,
  onDelete,
  onEdit,
}: {
  categories: NavigationCategory[]
  onDelete: (category: NavigationCategory) => void
  onEdit: (category: NavigationCategory) => void
}) {
  return (
    <div className='overflow-hidden rounded-lg border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>分类名称</TableHead>
            <TableHead>导航项数量</TableHead>
            <TableHead>排序</TableHead>
            <TableHead className='text-right'>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {categories.map((category) => (
            <TableRow key={category.id}>
              <TableCell className='font-medium'>{category.name}</TableCell>
              <TableCell>{category.items.length}</TableCell>
              <TableCell>{category.sortOrder}</TableCell>
              <TableCell className='space-x-1 text-right'>
                <Button
                  aria-label={`编辑 ${category.name}`}
                  size='icon'
                  variant='ghost'
                  onClick={() => onEdit(category)}
                >
                  <Pencil />
                </Button>
                <Button
                  aria-label={`删除 ${category.name}`}
                  disabled={category.items.length > 0}
                  size='icon'
                  title={category.items.length ? '请先移除分类下的导航项' : undefined}
                  variant='ghost'
                  onClick={() => onDelete(category)}
                >
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function TagTable({
  items,
  tags,
  onDelete,
  onEdit,
}: {
  items: NavigationItem[]
  tags: NavigationTagType[]
  onDelete: (tag: NavigationTagType) => void
  onEdit: (tag: NavigationTagType) => void
}) {
  return (
    <div className='overflow-hidden rounded-lg border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>标签名称</TableHead>
            <TableHead>使用次数</TableHead>
            <TableHead className='text-right'>操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tags.map((tag) => (
            <TableRow key={tag.id}>
              <TableCell>
                <NavigationTag name={tag.name} />
              </TableCell>
              <TableCell>
                {items.filter((item) =>
                  item.tags.some((itemTag) => itemTag.id === tag.id)
                ).length}
              </TableCell>
              <TableCell className='space-x-1 text-right'>
                <Button
                  aria-label={`编辑 ${tag.name}`}
                  size='icon'
                  variant='ghost'
                  onClick={() => onEdit(tag)}
                >
                  <Pencil />
                </Button>
                <Button
                  aria-label={`删除 ${tag.name}`}
                  size='icon'
                  variant='ghost'
                  onClick={() => onDelete(tag)}
                >
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

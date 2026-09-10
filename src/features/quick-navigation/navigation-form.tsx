import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type {
  NavigationCategory,
  NavigationTag,
} from './types'
import type { NavigationItemDraft } from './navigation-form-model'

type NavigationItemFormProps = {
  categories: NavigationCategory[]
  formId: string
  tags: NavigationTag[]
  value: NavigationItemDraft
  onChange: (value: NavigationItemDraft) => void
  onSubmit: () => void
}

export function NavigationItemForm({
  categories,
  formId,
  tags,
  value,
  onChange,
  onSubmit,
}: NavigationItemFormProps) {
  function toggleTag(tagId: number, checked: boolean) {
    onChange({
      ...value,
      tagIds: checked
        ? [...value.tagIds, tagId]
        : value.tagIds.filter((id) => id !== tagId),
    })
  }

  return (
    <form
      className='space-y-4'
      id={formId}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='space-y-2 sm:col-span-2'>
          <Label htmlFor='navigation-name'>名称</Label>
          <Input
            id='navigation-name'
            maxLength={120}
            placeholder='例如：海关编码'
            value={value.name}
            onChange={(event) =>
              onChange({ ...value, name: event.target.value })
            }
          />
        </div>
        <div className='space-y-2 sm:col-span-2'>
          <Label htmlFor='navigation-url'>链接地址</Label>
          <Input
            id='navigation-url'
            inputMode='url'
            placeholder='https://example.com'
            value={value.url}
            onChange={(event) =>
              onChange({ ...value, url: event.target.value })
            }
          />
        </div>
        <div className='space-y-2 sm:col-span-2'>
          <Label htmlFor='navigation-description'>说明</Label>
          <Textarea
            id='navigation-description'
            maxLength={300}
            placeholder='简要说明这个入口的用途'
            rows={3}
            value={value.description}
            onChange={(event) =>
              onChange({ ...value, description: event.target.value })
            }
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='navigation-placement'>展示位置</Label>
          <Select
            value={value.placement}
            onValueChange={(placement) =>
              onChange({
                ...value,
                placement: placement as NavigationItemDraft['placement'],
                categoryId:
                  placement === 'featured' ? '' : value.categoryId,
              })
            }
          >
            <SelectTrigger id='navigation-placement' className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='category'>分类卡片</SelectItem>
              <SelectItem value='featured'>顶部置顶</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-2'>
          <Label htmlFor='navigation-category'>所属分类</Label>
          <Select
            disabled={value.placement === 'featured'}
            value={value.categoryId}
            onValueChange={(categoryId) =>
              onChange({ ...value, categoryId })
            }
          >
            <SelectTrigger id='navigation-category' className='w-full'>
              <SelectValue
                placeholder={
                  value.placement === 'featured' ? '置顶链接无需分类' : '选择分类'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.id} value={String(category.id)}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='space-y-2'>
          <Label htmlFor='navigation-order'>显示顺序</Label>
          <Input
            id='navigation-order'
            min={0}
            type='number'
            value={value.sortOrder}
            onChange={(event) =>
              onChange({ ...value, sortOrder: event.target.value })
            }
          />
        </div>
      </div>
      <fieldset className='space-y-2'>
        <legend className='text-sm font-medium'>标签</legend>
        <div className='grid max-h-40 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2'>
          {tags.map((tag) => (
            <label
              className='flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted'
              key={tag.id}
            >
              <Checkbox
                checked={value.tagIds.includes(tag.id)}
                onCheckedChange={(checked) =>
                  toggleTag(tag.id, checked === true)
                }
              />
              {tag.name}
            </label>
          ))}
          {tags.length === 0 && (
            <p className='text-sm text-muted-foreground'>请先创建标签。</p>
          )}
        </div>
      </fieldset>
    </form>
  )
}

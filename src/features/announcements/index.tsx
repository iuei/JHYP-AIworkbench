import { useState } from 'react'
import { Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import {
  TABLE_CELL_ACTIONS,
  TABLE_CELL_META,
  TABLE_CELL_NUMERIC,
  TABLE_CELL_TRUNCATE,
  TABLE_HEAD_ACTIONS,
  TABLE_HEAD_NUMERIC,
  TABLE_SEARCH_ICON,
  TABLE_SEARCH_INPUT,
} from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TableCell, TableHead, TableRow } from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTable } from '@/components/data-table'
import { ContentSection } from '@/features/settings/components/content-section'
import {
  announcementErrorMessage,
  useAnnouncementList,
  useDeleteAnnouncement,
  useSetAnnouncementStatus,
} from './api'
import { AnnouncementFormDialog } from './components/announcement-form-dialog'
import { describeSchedule, formatDateTime, scheduleState } from './format'
import {
  ANNOUNCEMENT_STATUS_LABELS,
  DISPLAY_MODE_LABELS,
  type Announcement,
  type AnnouncementStatus,
} from './types'

/**
 * 公告管理页（仅管理员）。
 *
 * 三条与需求直接相关的展示决策：
 * 1. **弹出方式**是每一行的显式列，不是藏在编辑弹窗里的字段 —— 管理员回看列表时
 *    最需要确认的就是"这条到底会不会反复打扰员工"；
 * 2. **生效状态**单独提示（未生效 / 已过期）：已发布但到点没生效的公告，
 *    从状态列看是"已发布"，员工却看不到，不标出来就只能靠管理员自己比对时间；
 * 3. **已读人数**直接显示：写「只弹一次」的公告，这个数字就是触达情况。
 */
export function AnnouncementsAdmin() {
  const currentUser = useAuthStore((state) => state.auth.user)
  const isAdmin = currentUser?.role.includes('admin') ?? false
  const [status, setStatus] = useState<AnnouncementStatus | 'all'>('all')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  /** 非 null 时挂载编辑弹窗；`announcement: null` 表示新建。 */
  const [formTarget, setFormTarget] = useState<{
    announcement: Announcement | null
  } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null)

  const list = useAnnouncementList({ status, keyword, page, pageSize })
  const setAnnouncementStatus = useSetAnnouncementStatus()
  const remove = useDeleteAnnouncement()

  const items = list.data?.items ?? []
  const total = list.data?.total ?? 0
  const hasFilters = keyword.trim().length > 0 || status !== 'all'

  if (!isAdmin) {
    return (
      <ContentSection>
        <Card>
          <CardContent className='p-6 text-sm text-muted-foreground'>
            你没有访问公告管理的权限。
          </CardContent>
        </Card>
      </ContentSection>
    )
  }

  return (
    <ContentSection>
      <DataTable
        columns={7}
        emptyText={
          hasFilters ? '未找到符合条件的公告' : '还没有公告，点右上角新建一条'
        }
        errorText='公告列表加载失败，请稍后重试。'
        isEmpty={items.length === 0}
        isError={list.isError}
        isLoading={list.isLoading}
        pagination={{
          page: list.data?.page ?? page,
          pageSize: list.data?.pageSize ?? pageSize,
          total,
          onPageChange: setPage,
          onPageSizeChange: (size) => {
            setPageSize(size)
            setPage(1)
          },
        }}
        toolbar={
          <div className='flex flex-col gap-3 lg:flex-row lg:items-center'>
            <div className='relative min-w-0 flex-1 lg:max-w-sm'>
              {/* 图标位置与内边距都走逻辑类（start-* / ps-*）：物理类在 RTL 下会错位 */}
              <Search className={TABLE_SEARCH_ICON} />
              <Input
                aria-label='搜索公告'
                className={TABLE_SEARCH_INPUT}
                placeholder='搜索公告标题或内容'
                value={keyword}
                onChange={(event) => {
                  setKeyword(event.target.value)
                  setPage(1)
                }}
              />
            </div>
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value as AnnouncementStatus | 'all')
                setPage(1)
              }}
            >
              <SelectTrigger aria-label='状态筛选' className='w-36'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部状态</SelectItem>
                <SelectItem value='draft'>草稿</SelectItem>
                <SelectItem value='published'>已发布</SelectItem>
                <SelectItem value='archived'>已归档</SelectItem>
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button
                variant='ghost'
                onClick={() => {
                  setKeyword('')
                  setStatus('all')
                  setPage(1)
                }}
              >
                <X />
                重置筛选
              </Button>
            )}
            <Button
              className='lg:ml-auto'
              onClick={() => setFormTarget({ announcement: null })}
            >
              <Plus />
              新建公告
            </Button>
          </div>
        }
        header={
          <TableRow>
            <TableHead>公告</TableHead>
            <TableHead>弹出方式</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>生效期</TableHead>
            <TableHead className={TABLE_HEAD_NUMERIC}>已读</TableHead>
            <TableHead>更新时间</TableHead>
            <TableHead className={TABLE_HEAD_ACTIONS}>操作</TableHead>
          </TableRow>
        }
      >
        {items.map((announcement) => {
          const schedule = scheduleState(
            announcement.publishAt,
            announcement.expireAt
          )
          return (
            <TableRow key={announcement.id}>
              <TableCell>
                <p className='font-medium'>{announcement.title}</p>
                <p className={cn(TABLE_CELL_TRUNCATE, 'text-muted-foreground')}>
                  {announcement.body.replace(/\s+/g, ' ')}
                </p>
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    announcement.displayMode === 'every_login'
                      ? 'default'
                      : 'secondary'
                  }
                >
                  {DISPLAY_MODE_LABELS[announcement.displayMode]}
                </Badge>
              </TableCell>
              <TableCell>
                <span>{ANNOUNCEMENT_STATUS_LABELS[announcement.status]}</span>
                {announcement.status === 'published' &&
                  schedule !== 'active' && (
                    <p className='text-xs text-muted-foreground'>
                      {schedule === 'scheduled'
                        ? '未到生效时间'
                        : '已过失效时间'}
                    </p>
                  )}
              </TableCell>
              <TableCell className={TABLE_CELL_META}>
                {describeSchedule(
                  announcement.publishAt,
                  announcement.expireAt
                )}
              </TableCell>
              <TableCell className={TABLE_CELL_NUMERIC}>
                {announcement.readCount}
              </TableCell>
              <TableCell className={TABLE_CELL_META}>
                {formatDateTime(announcement.updatedAt)}
              </TableCell>
              <TableCell className={cn(TABLE_CELL_ACTIONS, 'space-x-2')}>
                <Button
                  aria-label={`编辑 ${announcement.title}`}
                  size='sm'
                  variant='outline'
                  onClick={() => setFormTarget({ announcement })}
                >
                  <Pencil />
                  编辑
                </Button>
                <Button
                  aria-label={`${
                    announcement.status === 'published' ? '下线' : '发布'
                  } ${announcement.title}`}
                  disabled={setAnnouncementStatus.isPending}
                  size='sm'
                  variant={
                    announcement.status === 'published' ? 'outline' : 'default'
                  }
                  onClick={() =>
                    setAnnouncementStatus.mutate(
                      {
                        id: announcement.id,
                        status:
                          announcement.status === 'published'
                            ? 'draft'
                            : 'published',
                      },
                      {
                        onSuccess: () =>
                          toast.success(
                            announcement.status === 'published'
                              ? '公告已下线，员工不会再看到'
                              : '公告已发布，员工下次登录即可看到'
                          ),
                        onError: (error) =>
                          toast.error(
                            announcementErrorMessage(error, '操作失败，请重试')
                          ),
                      }
                    )
                  }
                >
                  {announcement.status === 'published' ? (
                    <>
                      <X />
                      下线
                    </>
                  ) : (
                    <>
                      <Upload />
                      发布
                    </>
                  )}
                </Button>
                <Button
                  aria-label={`删除 ${announcement.title}`}
                  size='sm'
                  variant='ghost'
                  onClick={() => setDeleteTarget(announcement)}
                >
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </DataTable>

      {formTarget && (
        <AnnouncementFormDialog
          announcement={formTarget.announcement}
          onClose={() => setFormTarget(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title='删除公告'
        desc={
          deleteTarget
            ? `确认删除公告「${deleteTarget.title}」？${
                deleteTarget.status === 'published'
                  ? '它已发布，删除后员工不会再看到。'
                  : ''
              }删除后不可恢复。`
            : ''
        }
        confirmText='删除'
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => {
          if (!deleteTarget) return
          remove.mutate(deleteTarget.id, {
            onSuccess: () => {
              toast.success('公告已删除')
              setDeleteTarget(null)
            },
            onError: (error) =>
              toast.error(announcementErrorMessage(error, '删除失败，请重试')),
          })
        }}
      />
    </ContentSection>
  )
}

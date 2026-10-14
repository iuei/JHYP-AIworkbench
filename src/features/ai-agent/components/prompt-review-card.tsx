import { Fragment, useState } from 'react'
import { Check, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  TABLE_CELL_ACTIONS,
  TABLE_CELL_META,
  TABLE_HEAD_ACTIONS,
} from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { useDistillPrompts, useReviewPrompt } from '../api/queries'
import {
  PROMPT_STATUS_LABELS,
  PROMPT_STATUS_VARIANTS,
  apiErrorMessage,
  formatTime,
} from '../format'
import type { AiPrompt } from '../types'
import { PromptRejectDialog } from './prompt-dialogs'

const STATUS_FILTERS = [
  { value: 'pending', label: '待审核' },
  { value: 'published', label: '已共享' },
  { value: 'rejected', label: '已驳回' },
]

/**
 * 提示词审核队列（「经验审核」页的**提示词**子视图）。
 *
 * 与沉淀审核的区别：沉淀通过后会**生成一篇知识库文档**，提示词通过后则是
 * **所有人对话里能 @ 到它**。两者都是"个人内容变成公司资产"，因此同样需要人工把关。
 *
 * 通过**不可由管理员撤回**（只有作者修改后才回到待审），所以这里加一次确认弹窗：
 * 误点一次就等于把未脱敏的内容推给全员。
 *
 * **2026-10-14 改成子视图（不再自己折叠）**：本卡片此前与沉淀表同屏纵向叠加，
 * 最坏情况是"两套表头 + 两套分页器 + 两套筛选控件"一起出现，而两边的状态筛选
 * `aria-label` 还都叫「按状态筛选」—— 在错误的队列里输入关键词，用户会得到
 * "没有结果"的错误结论。现在由「经验审核」页用选项卡**一次只渲染一个队列**，
 * 卡片自身不再套折叠层（外层已经表达了"现在看的是哪个队列"），
 * 但**待审计数仍要显示**：它由父页面从 `pendingTotal` 传入，常显在标题旁。
 */
/**
 * 每页条数（2026-09-16 由 10 提到 20）：队列此前每条一张卡片（正文 + 按钮约 100px 高），
 * 10 条已经要滚很久；改成表格行后一行约 40px，20 条的纵向占用还不到原来 10 条的一半。
 *
 * 导出给父页面用：指标条也要读 `pendingTotal`，参数与这里**逐字一致**才会命中同一条
 * React Query 缓存（参数不一致就会白拉一次列表）。
 */
export const REVIEW_PAGE_SIZE = 20

/**
 * 表格列数：名称 / 说明 / 提报人 / 状态 / 更新于 / 操作。
 * 必须与表头列数一致 —— 空态行、骨架行与展开行都靠它跨列。
 */
const REVIEW_COLUMNS = 6

export function PromptReviewCard({
  /**
   * 待审**总数**（与当前状态筛选无关，服务端单独算），由父页面查一次后传入。
   * 默认 0 只为让本组件可以独立渲染，父页面始终显式传入。
   */
  pendingTotal = 0,
}: {
  pendingTotal?: number
}) {
  const [status, setStatus] = useState('pending')
  const [keyword, setKeyword] = useState('')
  const debouncedKeyword = useDebouncedValue(keyword)
  const [rejecting, setRejecting] = useState<AiPrompt | null>(null)
  const [approving, setApproving] = useState<AiPrompt | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  // 待审队列随提报持续增长、服务端已改为分页返回（原来无 LIMIT 一次全给）
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(REVIEW_PAGE_SIZE)

  const prompts = useDistillPrompts({
    status,
    keyword: debouncedKeyword.trim() || undefined,
    page,
    pageSize,
  })
  const review = useReviewPrompt()

  const rows = prompts.data?.prompts ?? []
  const total = prompts.data?.total ?? 0

  /** 换了状态或关键词就回到第 1 页，否则会停在"第 3 页 + 1 条结果"上。 */
  function handleStatusChange(value: string) {
    setStatus(value)
    setPage(1)
  }

  function handleKeywordChange(value: string) {
    setKeyword(value)
    setPage(1)
  }

  return (
    <Card className='gap-4 py-4'>
      <CardHeader className='gap-1'>
        {/*
          说明并到标题行：卡片头少一行，表格再往上提约 20px。
          "驳回必须填写原因"已由驳回弹窗与按钮的必填校验承担，不再重复占位。
        */}
        <CardTitle className='flex flex-wrap items-center gap-2 text-base'>
          提示词审核
          {/* 待审计数常显：子视图切换后，"还有多少条待办"不能跟着折叠一起消失 */}
          {pendingTotal > 0 && (
            <Badge className='font-normal' variant='default'>
              {pendingTotal} 条待审
            </Badge>
          )}
          <span className='text-xs font-normal text-muted-foreground'>
            通过后全员可在对话中 @ 引用
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className='space-y-3'>
        <div className='flex flex-wrap items-center gap-2'>
          <Input
            aria-label='搜索提示词'
            className='w-full sm:w-64'
            placeholder='搜索名称或标题'
            value={keyword}
            onChange={(event) => handleKeywordChange(event.target.value)}
          />
          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger aria-label='按状态筛选提示词' className='w-36'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_FILTERS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/*
          2026-09-16：队列由"每条一张卡片"改为**表格**。
          理由与提示词广场一致 —— 名称 / 说明 / 提报人 / 状态 / 更新于本来就是可比字段，
          卡片把它们摊成三行、还得一路滚；表格能一眼按列扫完，一屏能看十几条待审。
          正文长，不铺在单元格里（会把行高撑成几百像素），用操作列的「展开全文」
          在**该行下方插一行**显示，能力与卡片视图完全等价。
        */}
        <DataTable
          columns={REVIEW_COLUMNS}
          density='compact'
          emptyText={
            status === 'pending'
              ? '当前没有待审提示词。'
              : '该状态下没有提示词。'
          }
          isEmpty={total === 0}
          isLoading={prompts.isLoading}
          pagination={{
            disabled: prompts.isFetching,
            page: prompts.data?.page ?? page,
            pageSize: prompts.data?.pageSize ?? pageSize,
            total,
            onPageChange: setPage,
            onPageSizeChange: (size) => {
              setPageSize(size)
              setPage(1)
            },
          }}
          header={
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>说明</TableHead>
              <TableHead className='w-32'>提报人</TableHead>
              <TableHead className='w-28'>状态</TableHead>
              <TableHead className='w-32'>更新于</TableHead>
              <TableHead className={cn('w-64', TABLE_HEAD_ACTIONS)}>
                操作
              </TableHead>
            </TableRow>
          }
        >
          {rows.map((prompt) => (
            <Fragment key={prompt.id}>
              <TableRow>
                <TableCell>
                  <span className='block font-medium'>{prompt.name}</span>
                  {prompt.tags.length > 0 && (
                    <div className='mt-1 flex flex-wrap items-center gap-1'>
                      {prompt.tags.map((tag) => (
                        <Badge
                          className='font-normal'
                          key={tag}
                          variant='outline'
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className={cn(TABLE_CELL_META, 'max-w-72')}>
                  {prompt.summary ? (
                    <span className='block truncate' title={prompt.summary}>
                      {prompt.summary}
                    </span>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {prompt.ownerLogin ?? '—'}
                </TableCell>
                <TableCell>
                  <Badge
                    className='font-normal'
                    variant={PROMPT_STATUS_VARIANTS[prompt.status] ?? 'outline'}
                  >
                    {PROMPT_STATUS_LABELS[prompt.status] ?? prompt.status}
                  </Badge>
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {formatTime(prompt.updatedAt)}
                </TableCell>
                <TableCell className={TABLE_CELL_ACTIONS}>
                  {/*
                    审核结论（通过 / 驳回）留在明面：它是本页唯一的高频动作。
                    其余条目只需读正文，故只给「展开全文」。
                  */}
                  <div className='flex items-center justify-end gap-0.5'>
                    <Button
                      className='h-7 px-2 text-xs'
                      size='sm'
                      variant='ghost'
                      onClick={() =>
                        setExpandedId((current) =>
                          current === prompt.id ? null : prompt.id
                        )
                      }
                    >
                      {expandedId === prompt.id ? '收起' : '展开全文'}
                    </Button>
                    {prompt.status === 'pending' && (
                      <>
                        <Button
                          className='h-7 gap-1 px-2 text-xs'
                          disabled={review.isPending}
                          size='sm'
                          variant='ghost'
                          onClick={() => setApproving(prompt)}
                        >
                          <Check className='size-3.5' />
                          通过
                        </Button>
                        <Button
                          className='h-7 gap-1 px-2 text-xs'
                          disabled={review.isPending}
                          size='sm'
                          variant='ghost'
                          onClick={() => setRejecting(prompt)}
                        >
                          <X className='size-3.5' />
                          驳回
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>

              {expandedId === prompt.id && (
                <TableRow>
                  <TableCell
                    className='bg-muted/30 py-3 whitespace-normal'
                    colSpan={REVIEW_COLUMNS}
                  >
                    <p className='text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap'>
                      {prompt.body}
                    </p>
                    {prompt.status === 'rejected' && prompt.reviewComment && (
                      <p className='mt-2 rounded-lg border border-dashed p-2 text-xs text-muted-foreground'>
                        驳回原因：{prompt.reviewComment}
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
        </DataTable>
      </CardContent>

      <ConfirmDialog
        confirmText='通过并共享'
        desc={`通过后「${approving?.name ?? ''}」会出现在所有人的对话 @ 列表里，且这一步无法撤回（需作者修改后重新审核）。`}
        open={Boolean(approving)}
        title='确认通过这条提示词'
        handleConfirm={() => {
          if (!approving) return
          review.mutate(
            { id: approving.id, decision: 'approve' },
            {
              onSuccess: () => {
                toast.success('已通过，已对全员可用')
                // 审核会让队列变短：留在原页码可能已经不存在（空列表 + 可翻页）
                setPage(1)
              },
              onError: (error) =>
                toast.error(apiErrorMessage(error, '通过失败，请稍后重试')),
            }
          )
          setApproving(null)
        }}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setApproving(null)
        }}
      />

      <PromptRejectDialog
        open={Boolean(rejecting)}
        prompt={rejecting}
        onReviewed={() => setPage(1)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setRejecting(null)
        }}
      />
    </Card>
  )
}

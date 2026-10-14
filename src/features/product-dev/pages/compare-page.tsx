import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DatePicker } from '@/components/date-picker'
import {
  deleteComparison,
  fetchComparisonHistory,
  fetchComparisonSnapshot,
  runComparison,
} from '../api'
import { ComparisonHistory } from '../components/comparison-history'
import { ComparisonPanel } from '../components/comparison-panel'
import { MAX_COMPARE_ITEMS } from '../constants'
import { useProductDev } from '../dev-context'
import {
  WINDOW_OPTIONS,
  apiErrorMessage,
  formatDateTime,
  toDateInputValue,
} from '../format'
import type { ComparisonHistoryItem } from '../types'

/**
 * 「产品开发 → 对比与历史」子页（2026-09-16 阶段 B 由单页页签改为独立路由）。
 *
 * 三件事同屏：选择哪些候选、跑对比（区间可自定义）、看结果与历史回看。
 * 选择集合与对比结果由 `ProductDevLayout` 经 context 提供 —— 它们要与候选池共享；
 * 本页自己的只有"待删除的历史记录"这一个瞬时状态。
 *
 * **历史回看不切页**（改前 `snapshot.onSuccess` 里有一句 `setView('compare')`）：
 * 历史与结果本来就在同一屏，拆路由后这句既无必要也无处可切。
 */
export function ProductDevComparePage() {
  const queryClient = useQueryClient()
  const {
    selectedList,
    removeSelected,
    windowKey,
    setWindowKey,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    result,
    setResult,
    fromHistory,
    setFromHistory,
    activeComparisonId,
    setActiveComparisonId,
  } = useProductDev()

  const [pendingComparisonDelete, setPendingComparisonDelete] =
    useState<ComparisonHistoryItem | null>(null)

  const history = useQuery({
    queryKey: ['product-dev-comparisons'],
    queryFn: () => fetchComparisonHistory(10),
  })

  const comparison = useMutation({
    mutationFn: runComparison,
    onSuccess: (data) => {
      setResult(data)
      setFromHistory(false)
      setActiveComparisonId(data.comparisonId ?? null)
      // 新记录已落库，刷新历史列表（不乐观插入：id 与时间都以服务端为准）
      void queryClient.invalidateQueries({ queryKey: ['product-dev-comparisons'] })
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error, '对比失败，请检查选择的候选与区间。'))
    },
  })

  const snapshot = useMutation({
    mutationFn: fetchComparisonSnapshot,
    onSuccess: (data, id) => {
      if (!data) {
        toast.error('这条记录没有可回看的结果快照。')
        return
      }
      setResult(data)
      setFromHistory(true)
      setActiveComparisonId(id)
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error, '回看这条对比失败，请稍后重试。'))
    },
  })

  const removeComparison = useMutation({
    mutationFn: (id: number) => deleteComparison(id),
    onSuccess: (_data, id) => {
      toast.success('对比记录已删除。')
      setPendingComparisonDelete(null)
      if (activeComparisonId === id) {
        setActiveComparisonId(null)
        setResult(null)
      }
      void queryClient.invalidateQueries({ queryKey: ['product-dev-comparisons'] })
    },
    onError: (error) => {
      toast.error(apiErrorMessage(error, '删除失败，请稍后重试。'))
    },
  })

  const isCustomWindow = windowKey === 'custom'
  const customReady = Boolean(startDate && endDate)
  const canCompare =
    selectedList.length >= 2 && (!isCustomWindow || customReady) && !comparison.isPending

  const mixedMarketplace = new Set(selectedList.map((item) => item.marketplace)).size > 1

  function handleCompare() {
    if (!canCompare) return
    comparison.mutate({
      candidateIds: selectedList.map((item) => item.id),
      windowDays: isCustomWindow ? null : Number(windowKey),
      startDate: isCustomWindow ? toDateInputValue(startDate) : null,
      endDate: isCustomWindow ? toDateInputValue(endDate) : null,
    })
  }

  return (
    <>
      {/*
        2026-09-16：「主栏 + 右侧 20rem 历史栏」改为**单栏**。
        历史对比已改成整宽数据表格并移到底部 —— 候选选择与对比结果因此拿回全部宽度，
        历史也不再被压进 320px 的侧栏里只显示四行摘要。
      */}
      <div className='space-y-6'>
        <div className='min-w-0 space-y-6'>
          <Card>
            <CardHeader className='gap-1'>
              <CardTitle className='text-base'>选择候选并对比</CardTitle>
              <CardDescription>
                一次对比 2–{MAX_COMPARE_ITEMS} 个候选，且必须属于同一站点
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-4'>
              {selectedList.length === 0 ? (
                <p className='text-sm text-muted-foreground'>
                  还没有选择候选。请回到「候选池」勾选 2 个以上候选后再来对比。
                </p>
              ) : (
                <div className='flex flex-wrap gap-2'>
                  {selectedList.map((item) => (
                    <Badge key={item.id} variant='outline' className='gap-1'>
                      {item.product_name || item.asin || `候选 #${item.id}`}
                      <span className='text-muted-foreground'>{item.marketplace}</span>
                      <button
                        type='button'
                        aria-label={`移除 ${
                          item.product_name || item.asin || `候选 #${item.id}`
                        }`}
                        onClick={() => removeSelected(item.id)}
                      >
                        <X aria-hidden='true' className='size-3' />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              {mixedMarketplace && (
                <p className='text-sm text-destructive'>
                  选中的候选横跨多个站点。广告与销售日报按站点分别存储，把不同站点的数字放在一起
                  对比会得到错误结论，请只保留同一站点的候选。
                </p>
              )}

              <div className='flex flex-wrap items-end gap-4'>
                <div className='space-y-2'>
                  <Label>统计区间</Label>
                  <Tabs value={windowKey} onValueChange={setWindowKey}>
                    <TabsList>
                      {WINDOW_OPTIONS.map((option) => (
                        <TabsTrigger key={option.value} value={option.value}>
                          {option.label}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </div>

                {isCustomWindow && (
                  <div className='flex flex-wrap items-end gap-3'>
                    <div className='space-y-2'>
                      <Label>开始日期</Label>
                      <DatePicker
                        selected={startDate}
                        onSelect={setStartDate}
                        placeholder='开始日期'
                      />
                    </div>
                    <div className='space-y-2'>
                      <Label>结束日期</Label>
                      <DatePicker
                        selected={endDate}
                        onSelect={setEndDate}
                        placeholder='结束日期'
                      />
                    </div>
                  </div>
                )}

                <Button
                  type='button'
                  disabled={!canCompare || mixedMarketplace}
                  onClick={handleCompare}
                >
                  {comparison.isPending ? '对比中…' : '开始对比'}
                </Button>
              </div>

              {isCustomWindow && !customReady && (
                <p className='text-xs text-muted-foreground'>
                  自定义区间需要同时选择开始与结束日期（最长 366 天）。
                </p>
              )}
              <p className='text-xs text-muted-foreground'>
                不指定区间时，以该站点报表数据的最新日期为终点向前取，避免因报表滞后而取到大部分为空的区间。
              </p>
            </CardContent>
          </Card>

          {comparison.isError && (
            <Card className='border-destructive/40'>
              <CardContent className='py-6'>
                <p className='text-sm text-destructive'>
                  {apiErrorMessage(comparison.error, '对比失败，请稍后重试。')}
                </p>
              </CardContent>
            </Card>
          )}

          {result ? (
            <ComparisonPanel result={result} fromHistory={fromHistory} />
          ) : (
            <Card>
              <CardHeader className='gap-1'>
                <CardTitle className='text-base'>还没有对比结果</CardTitle>
                <CardDescription>
                  勾选 2 个以上同站点候选后开始对比，结果会自动保存到下方「历史对比」
                </CardDescription>
              </CardHeader>
              {/*
                口径压成一行（2026-09-16，与竞品分析同一次清理）：空态页面上的主任务是"怎么开始"，
                此前这里并列了 4 条要点，把标题与操作指引推到了视野之外。
              */}
              <CardContent>
                <p className='text-xs text-muted-foreground'>
                  口径：人工录入字段与平台数据双轨展示；报表缺失一律显示「—」不用 0 代替；
                  本模块只呈现事实，不给「建议开发 / 不建议开发」的结论。
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <ComparisonHistory
          items={history.data ?? []}
          loading={history.isLoading}
          refreshing={history.isFetching}
          activeId={activeComparisonId}
          onSelect={(id) => snapshot.mutate(id)}
          onDelete={setPendingComparisonDelete}
          onRefresh={() => void history.refetch()}
        />
      </div>

      <ConfirmDialog
        open={Boolean(pendingComparisonDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingComparisonDelete(null)
        }}
        title='删除对比记录'
        desc={`确认删除 ${formatDateTime(
          pendingComparisonDelete?.createdAt
        )} 的对比快照吗？删除后无法恢复，需要重新对比。`}
        confirmText='删除'
        destructive
        isLoading={removeComparison.isPending}
        handleConfirm={() =>
          pendingComparisonDelete && removeComparison.mutate(pendingComparisonDelete.id)
        }
      />
    </>
  )
}

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Main } from '@/components/layout/main'
import {
  apiErrorMessage,
  fetchAnalysisHistory,
  runCompetitorAnalysis,
} from './api'
import { AnalysisForm } from './components/analysis-form'
import { HistoryPanel } from './components/history-panel'
import type { AnalysisFormValues } from './types'

/** 页面 props：路由参数由路由文件读出来传进来，本组件不依赖路由（便于独立渲染与测试）。 */
export interface CompetitorAnalysisProps {
  /** 深链参数：要打开哪一条分析（本页会转发到「分析结果」）。 */
  analysisId?: number
  /** 首页「新建分析」深链：进场即聚焦 ASIN 输入框。 */
  autoFocusAsin?: boolean
}

/**
 * 竞品分析页 —— **只放"要分析什么"与"分析过什么"**。
 *
 * 用户口径（2026-09-16）：「分析页面只保留需要分析数据的填充设置和分析历史，
 * 其他内容都放入到分析结果内」。因此本页只有两件事：
 * 1. 参数设置（表单；有结果时收成一行摘要，点「修改参数，重新分析」展开）；
 * 2. 历史分析（点「回看」打开那一次的分析结果）。
 *
 * 结果（判定 + 头条、结论与建议、全部数据块、口径声明）全部在
 * `/competitor-analysis/results`（分析结果页）。分析成功后**自动跳过去** ——
 * 这样"提交 → 读结论"仍然是一步，不必在本页再点一次入口。
 */
export function CompetitorAnalysis({
  analysisId,
  autoFocusAsin,
}: CompetitorAnalysisProps = {}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [lastValues, setLastValues] = useState<AnalysisFormValues | null>(null)

  const history = useQuery({
    queryKey: ['competitor-analyses'],
    queryFn: () => fetchAnalysisHistory(10),
  })

  const analysis = useMutation({
    mutationFn: runCompetitorAnalysis,
    onSuccess: (data) => {
      // 新记录已落库，刷新历史列表（不要乐观插入：id 与时间都以服务端为准）
      void queryClient.invalidateQueries({ queryKey: ['competitor-analyses'] })
      /*
       * 结果不在本页展示 → 直接打开「分析结果」页。
       * 用 push 而不是 replace：用户在结果页点「返回竞品分析」能回到这里，再改参数跑下一次。
       */
      void navigate({
        to: '/competitor-analysis/results',
        search: { analysisId: data.analysisId },
      })
    },
  })

  /*
   * 带 `analysisId` 进来（首页「最近分析 / 需处理」深链、旧收藏）时**直接转发到分析结果页**：
   * 本页已不渲染任何结果，留在参数页等于把用户丢在一个空页上。用 `replace`，免得"返回"又弹回来。
   */
  useEffect(() => {
    if (analysisId === undefined) return
    void navigate({
      to: '/competitor-analysis/results',
      search: { analysisId },
      replace: true,
    })
  }, [analysisId, navigate])

  function handleSubmit(values: AnalysisFormValues) {
    setLastValues(values)
    analysis.mutate(values)
  }

  return (
    <Main>
      {/*
        本页只有两件事（用户口径 2026-09-16：「分析页面只保留需要分析数据的填充设置和分析历史，
        其他内容都放入到分析结果内」）：
        1. **参数设置**：始终是完整表单 —— 本页不再承载结果，也就没有"有结果时收起来"的需要
           （摘要条与"本次分析已完成"卡因此一并删掉：分析成功会跳到结果页、组件卸载，
           它们永远不会显示，属于死代码）；
        2. **历史分析**：点「回看」打开那一次的分析结果。
      */}
      <AnalysisForm
        autoFocusAsin={autoFocusAsin === true}
        pending={analysis.isPending}
        onSubmit={handleSubmit}
      />

      {analysis.isError && (
        <Card className='mb-6 border-destructive/40'>
          <CardContent className='flex flex-col items-start gap-3 py-6'>
            <p className='text-sm text-destructive'>
              {apiErrorMessage(analysis.error, '分析失败，请稍后重试。')}
            </p>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={analysis.isPending || !lastValues}
              onClick={() => lastValues && analysis.mutate(lastValues)}
            >
              <RotateCcw aria-hidden='true' />
              重新分析
            </Button>
          </CardContent>
        </Card>
      )}

      <HistoryPanel
        activeId={null}
        items={history.data ?? []}
        loading={history.isLoading}
        refreshing={history.isFetching}
        onRefresh={() => void history.refetch()}
        onSelect={(id) =>
          // 回看 = 打开那一次的分析结果（用户口径：「点击回看时自动跳转到数据明细页」）
          void navigate({
            to: '/competitor-analysis/results',
            search: { analysisId: id },
          })
        }
      />
    </Main>
  )
}

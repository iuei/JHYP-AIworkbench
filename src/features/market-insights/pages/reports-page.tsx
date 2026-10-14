import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Clock3, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AnswerBlocks } from '@/features/ai-agent/components/answer-blocks'
import { fetchMarketInsightReport, fetchMarketInsightReports } from '@/features/product-dev/api'

/** 已保存报告的独立回看页；读取冻结快照，不触发第三方重新抓取。 */
export function MarketInsightReportsPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const reports = useQuery({
    queryKey: ['market-insights', 'reports', 'all'],
    queryFn: () => fetchMarketInsightReports({ limit: 50 }),
  })
  const detail = useMutation({ mutationFn: fetchMarketInsightReport })

  return (
    <div className='grid min-h-0 gap-6 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]'>
      <Card className='min-h-0'>
        <CardHeader className='gap-1'>
          <CardTitle className='text-base'>报告记录</CardTitle>
          <CardDescription>按保存时间回看市场调研结果，不会重新消耗调用额度。</CardDescription>
        </CardHeader>
        <CardContent>
          {reports.isPending && <p className='text-sm text-muted-foreground'>正在加载报告…</p>}
          {reports.isError && <p className='text-sm text-destructive'>报告列表加载失败，请稍后重试。</p>}
          {reports.data && reports.data.items.length === 0 && (
            <p className='text-sm text-muted-foreground'>暂时没有已保存的市场报告。</p>
          )}
          {reports.data && reports.data.items.length > 0 && (
            <ul className='divide-y rounded-lg border'>
              {reports.data.items.map((report) => (
                <li key={report.id}>
                  <button
                    type='button'
                    className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-muted/60 ${selectedId === report.id ? 'bg-muted' : ''}`}
                    onClick={() => {
                      setSelectedId(report.id)
                      detail.mutate(report.id)
                    }}
                  >
                    <span className='min-w-0'>
                      <span className='block truncate text-sm font-medium'>{report.scopeLabel || report.scopeKey}</span>
                      <span className='block truncate text-xs text-muted-foreground'>{report.headline || '暂无摘要'}</span>
                    </span>
                    <span className='flex shrink-0 items-center gap-1 text-xs text-muted-foreground'>
                      <Clock3 className='size-3.5' aria-hidden='true' />
                      {new Date(report.createdAt).toLocaleDateString('zh-CN')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className='min-h-0'>
        <CardHeader className='gap-1'>
          <CardTitle className='text-base'>冻结结果</CardTitle>
          <CardDescription>显示保存时的结论、依据和来源元数据。</CardDescription>
        </CardHeader>
        <CardContent>
          {detail.isPending && <Loader2 className='size-5 animate-spin text-muted-foreground' aria-label='正在加载报告' />}
          {detail.isError && <p className='text-sm text-destructive'>报告详情加载失败，请稍后重试。</p>}
          {detail.data && (
            <div className='space-y-4'>
              <div>
                <p className='text-lg font-semibold'>{detail.data.result.headline}</p>
                <p className='mt-1 text-sm text-muted-foreground'>
                  {detail.data.scopeLabel} · {detail.data.marketplace} · 抓取于{' '}
                  {detail.data.fetchedAt
                    ? new Date(detail.data.fetchedAt).toLocaleString('zh-CN')
                    : '时间未知'}
                </p>
              </div>
              {detail.data.result.findings.length > 0 && (
                <ul className='space-y-3'>
                  {detail.data.result.findings.map((finding, index) => (
                    <li key={`${finding.title}-${index}`} className='rounded-lg border p-3'>
                      <p className='text-sm font-medium'>{finding.title}</p>
                      <p className='mt-1 text-sm text-muted-foreground'>{finding.detail}</p>
                      {finding.action && <p className='mt-2 text-sm'>{finding.action}</p>}
                    </li>
                  ))}
                </ul>
              )}
              <AnswerBlocks blocks={detail.data.result.blocks} />
              <p className='text-xs text-muted-foreground'>
                调用 {detail.data.result.meta.calls} 次，缓存命中 {detail.data.result.meta.cacheHits} 次；
                估算字段和异常信息均保留在这份冻结快照中。
              </p>
              <p className='text-xs text-muted-foreground'>类目节点：{detail.data.result.nodeIdPath}；数据来源和缓存信息保留在报告快照中。</p>
            </div>
          )}
          {!detail.data && !detail.isPending && !detail.isError && (
            <p className='text-sm text-muted-foreground'>从左侧选择一份报告查看详情。</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

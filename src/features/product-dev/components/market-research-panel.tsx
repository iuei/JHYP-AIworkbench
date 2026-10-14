import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { isAxiosError } from 'axios'
import { Clock3, Lightbulb, Loader2, Search, Store } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AnswerBlocks } from '@/features/ai-agent/components/answer-blocks'
import {
  analyzeMarket,
  fetchMarketInsightReport,
  fetchMarketInsightReports,
  saveMarketInsightReport,
  searchMarketCategories,
} from '../api'
import type { MarketAnalysisResult, MarketCategory, MarketFinding } from '../types'

/** 站点选项（与卖家精灵收录范围一致；市场调研不需要"自动推导"——响应里没有 ASIN 可推导）。 */
const MARKETPLACES = [
  { value: 'US', label: '美国 US' },
  { value: 'UK', label: '英国 UK' },
  { value: 'DE', label: '德国 DE' },
  { value: 'FR', label: '法国 FR' },
  { value: 'IT', label: '意大利 IT' },
  { value: 'ES', label: '西班牙 ES' },
  { value: 'JP', label: '日本 JP' },
  { value: 'CA', label: '加拿大 CA' },
]

const LEVEL_LABELS: Record<MarketFinding['level'], string> = {
  high: '需立即处理',
  medium: '需关注',
  low: '低风险',
  info: '提示',
}

const LEVEL_VARIANTS: Record<
  MarketFinding['level'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  high: 'destructive',
  medium: 'default',
  low: 'secondary',
  info: 'outline',
}

function errorMessage(error: unknown, fallback: string) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? fallback
  }
  return fallback
}

/**
 * 市场调研：**以类目为单位**回答"这个类目值不值得进"。
 *
 * 为什么独立于竞品分析（2026-09-16 分页）：
 * 竞品分析的输入是 ASIN 列表、分析对象是"我和这几个竞品比差在哪"；
 * 这里不看任何单个 ASIN，只看类目本身 —— 输入、分析对象、使用时机（选品阶段往往还没 ASIN）都不同。
 *
 * 额度：类目搜索 1 次 + 市场结构 2 次卖家精灵调用，24 小时缓存与竞品分析共用同一张表。
 */
export function MarketResearchPanel({
  initialKeyword = null,
  initialMarketplace = 'US',
}: {
  initialKeyword?: string | null
  initialMarketplace?: string
}) {
  const [keyword, setKeyword] = useState(initialKeyword ?? '')
  const [marketplace, setMarketplace] = useState(initialMarketplace)
  const [categories, setCategories] = useState<MarketCategory[]>([])
  const [selected, setSelected] = useState<MarketCategory | null>(null)
  const [result, setResult] = useState<MarketAnalysisResult | null>(null)
  const [searchMeta, setSearchMeta] = useState<{ calls: number; cacheHits: number } | null>(null)
  const queryClient = useQueryClient()

  const reports = useQuery({
    queryKey: ['market-insights', 'reports', marketplace],
    queryFn: () => fetchMarketInsightReports({ marketplace, limit: 20 }),
  })

  const search = useMutation({
    mutationFn: searchMarketCategories,
    onSuccess: (data) => {
      setCategories(data.categories)
      setSearchMeta({ calls: data.meta.calls, cacheHits: data.meta.cacheHits })
      setSelected(null)
      setResult(null)
    },
  })

  const analyze = useMutation({
    mutationFn: analyzeMarket,
    onSuccess: (data) => setResult(data),
  })

  const saveReport = useMutation({
    mutationFn: saveMarketInsightReport,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['market-insights', 'reports'] })
    },
  })

  const loadReport = useMutation({
    mutationFn: fetchMarketInsightReport,
    onSuccess: (report) => {
      setMarketplace(report.marketplace)
      setResult(report.result)
      setKeyword(typeof report.filters.keyword === 'string' ? report.filters.keyword : '')
      setSelected({
        nodeIdPath: report.result.nodeIdPath,
        nodeId: null,
        label: report.scopeLabel,
        labelEn: report.scopeLabel,
        products: null,
      })
    },
  })

  const runSearch = (nextKeyword = keyword, nextMarketplace = marketplace) => {
    const text = nextKeyword.trim()
    if (!text) return
    search.mutate({ keyword: text, marketplace: nextMarketplace })
  }

  // 从竞品分析跳过来时带着类目关键词：进去就自动搜一次，省掉重复输入。
  // 用 ref 而不是 state 记录"已初始化"——在 effect 里 setState 会多一次级联渲染，
  // 而且会覆盖用户随后的主动输入（项目规则明确禁止 effect 里 setState）。
  const bootstrappedRef = useRef(false)
  useEffect(() => {
    if (bootstrappedRef.current || !initialKeyword?.trim()) return
    bootstrappedRef.current = true
    runSearch(initialKeyword, initialMarketplace)
    // runSearch 每次渲染都会重建，但它只依赖入参与稳定的 mutate，不必进依赖数组
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKeyword, initialMarketplace])

  const pickCategory = (category: MarketCategory) => {
    setSelected(category)
    setResult(null)
    analyze.mutate({
      marketplace,
      nodeIdPath: category.nodeIdPath,
      nodeLabel: category.labelEn ?? category.label,
    })
  }

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader className='gap-1'>
          <CardTitle className='text-base'>市场调研</CardTitle>
          <CardDescription>
            按品类词找到亚马逊类目，看这个市场的规模、集中度、价格带与新品机会。
            数据来自卖家精灵公开数据，用于判断"值不值得进"，与「对比与历史」里的候选品表现是两件事。
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <form
            className='flex flex-wrap items-end gap-3'
            onSubmit={(event) => {
              event.preventDefault()
              runSearch()
            }}
          >
            <div className='min-w-56 flex-1 space-y-2'>
              <Label htmlFor='market-keyword'>类目关键词</Label>
              <Input
                id='market-keyword'
                placeholder='例如 toilet paper、yoga mat、dog leash'
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
              />
            </div>
            <div className='w-40 space-y-2'>
              <Label>站点</Label>
              <Select value={marketplace} onValueChange={setMarketplace}>
                <SelectTrigger className='w-full' aria-label='站点'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETPLACES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type='submit' disabled={search.isPending || keyword.trim().length === 0}>
              {search.isPending ? <Loader2 className='animate-spin' /> : <Search aria-hidden='true' />}
              搜索类目
            </Button>
          </form>

          <p className='text-xs text-muted-foreground'>
            搜索类目 1 次调用 + 市场结构分析 2 次调用（卖家精灵按次数计费）；
            同一类目 24 小时内重复查看走缓存，不再消耗额度。
          </p>

          {search.isError && (
            <p className='text-sm text-destructive' role='alert'>
              {errorMessage(search.error, '类目搜索失败，请稍后重试。')}
            </p>
          )}

          {categories.length > 0 && (
            <div className='space-y-2'>
              <div className='flex flex-wrap items-center gap-2'>
                <Label>选择要调研的类目</Label>
                <span className='text-xs text-muted-foreground'>
                  共 {categories.length} 个候选
                  {searchMeta
                    ? ` · 本次调用 ${searchMeta.calls} 次（缓存命中 ${searchMeta.cacheHits} 次）`
                    : ''}
                </span>
              </div>
              <ul className='divide-y rounded-lg border'>
                {categories.map((category) => (
                  <li key={category.nodeIdPath}>
                    <button
                      type='button'
                      className={`flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted ${
                        selected?.nodeIdPath === category.nodeIdPath ? 'bg-muted' : ''
                      }`}
                      disabled={analyze.isPending}
                      onClick={() => pickCategory(category)}
                    >
                      <span className='min-w-0'>
                        <span className='block truncate font-medium'>{category.label}</span>
                        <span className='block truncate text-xs text-muted-foreground'>
                          {category.nodeIdPath}
                        </span>
                      </span>
                      <span className='shrink-0 text-xs text-muted-foreground'>
                        {category.products !== null ? `${category.products} 个在售` : '—'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analyze.isPending && (
            <p className='flex items-center gap-2 text-sm text-muted-foreground'>
              <Loader2 className='size-4 animate-spin' aria-hidden='true' />
              正在拉取类目市场数据…
            </p>
          )}
          {analyze.isError && (
            <p className='text-sm text-destructive' role='alert'>
              {errorMessage(analyze.error, '市场分析失败，请稍后重试。')}
            </p>
          )}
        </CardContent>
      </Card>

      {result && (
        <>
          <Card>
            <CardHeader className='gap-1'>
              <div className='flex flex-wrap items-start justify-between gap-3'>
                <div className='flex flex-wrap items-center gap-2'>
                  <CardTitle className='text-base'>
                    {result.nodeLabelLocale ?? result.nodeLabel ?? '该类目'}
                  </CardTitle>
                  <Badge variant={LEVEL_VARIANTS[result.findingLevel]}>
                    {LEVEL_LABELS[result.findingLevel]}
                  </Badge>
                  <Badge variant='outline'>{result.marketplace} 站</Badge>
                </div>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={saveReport.isPending}
                  onClick={() =>
                    saveReport.mutate({
                      marketplace: result.marketplace,
                      scopeKey: result.nodeIdPath,
                      scopeLabel: result.nodeLabelLocale ?? result.nodeLabel,
                      filters: { keyword: keyword.trim() },
                      result,
                    })
                  }
                >
                  {saveReport.isPending ? <Loader2 className='animate-spin' /> : null}
                  保存报告
                </Button>
              </div>
              <CardDescription>
                本次调用 {result.meta.calls} 次（缓存命中 {result.meta.cacheHits} 次，命中不计费）· 类目节点{' '}
                {result.nodeIdPath}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              {saveReport.isError && (
                <p className='text-sm text-destructive' role='alert'>
                  {errorMessage(saveReport.error, '报告保存失败，请稍后重试。')}
                </p>
              )}
              {saveReport.isSuccess && (
                <p className='text-sm text-emerald-600'>报告已保存，可在下方历史记录中回看。</p>
              )}
              <p className='text-sm'>{result.headline}</p>
              {result.meta.errors.length > 0 && (
                <p className='text-xs text-destructive'>
                  部分数据未取到：
                  {result.meta.errors.map((error) => error.message).join('；')}
                </p>
              )}
              {result.topAsins.length > 0 && (
                <p className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                  <Store className='size-3.5' aria-hidden='true' />
                  该市场 TOP 商品：
                  <Link
                    className='text-foreground underline underline-offset-2'
                    to='/competitor-analysis'
                    search={{ focus: 'asin' }}
                  >
                    把这批 ASIN 带到竞品分析对比
                  </Link>
                  <span className='font-mono'>{result.topAsins.join('、')}</span>
                </p>
              )}
            </CardContent>
          </Card>

          {result.findings.length > 0 && (
            <Card>
              <CardHeader className='gap-1'>
                <CardTitle className='text-base'>市场判断</CardTitle>
                <CardDescription>
                  由服务端按市场规模、集中度、新品结构与价格带的阈值算出，每条都带可复算依据
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className='space-y-3'>
                  {result.findings.map((finding, index) => (
                    <li
                      key={`${finding.title}-${index}`}
                      className={`rounded-lg border p-4 ${
                        finding.level === 'high' ? 'border-destructive/40' : 'border-border'
                      }`}
                    >
                      <div className='flex flex-wrap items-center gap-2'>
                        <Badge variant={LEVEL_VARIANTS[finding.level]}>
                          {LEVEL_LABELS[finding.level]}
                        </Badge>
                        <p className='text-sm font-medium'>{finding.title}</p>
                      </div>
                      <p className='mt-2 text-sm text-muted-foreground'>{finding.detail}</p>
                      {finding.action && (
                        <p className='mt-2 flex gap-2 rounded-md bg-muted px-3 py-2 text-sm'>
                          <Lightbulb className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
                          <span>{finding.action}</span>
                        </p>
                      )}
                      {finding.evidence.length > 0 && (
                        <p className='mt-2 text-xs text-muted-foreground'>
                          依据：{finding.evidence.join('；')}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <AnswerBlocks blocks={result.blocks} />
        </>
      )}

      {reports.data && reports.data.items.length > 0 && (
        <Card>
          <CardHeader className='gap-1'>
            <CardTitle className='text-base'>历史市场报告</CardTitle>
            <CardDescription>读取保存时的冻结结果，不会重新消耗卖家精灵调用额度。</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className='divide-y rounded-lg border'>
              {reports.data.items.map((report) => (
                <li key={report.id}>
                  <button
                    type='button'
                    className='flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-muted/60'
                    disabled={loadReport.isPending}
                    onClick={() => loadReport.mutate(report.id)}
                  >
                    <span className='min-w-0'>
                      <span className='block truncate text-sm font-medium'>
                        {report.scopeLabel || report.scopeKey}
                      </span>
                      <span className='block truncate text-xs text-muted-foreground'>
                        {report.headline || '暂无摘要'}
                      </span>
                    </span>
                    <span className='flex shrink-0 items-center gap-1 text-xs text-muted-foreground'>
                      <Clock3 className='size-3.5' aria-hidden='true' />
                      {new Date(report.createdAt).toLocaleString('zh-CN')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {loadReport.isError && (
              <p className='mt-2 text-sm text-destructive' role='alert'>
                {errorMessage(loadReport.error, '历史报告加载失败，请稍后重试。')}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!result && !analyze.isPending && categories.length === 0 && (
        <Card>
          <CardHeader className='gap-1'>
            <CardTitle className='text-base'>还没有调研结果</CardTitle>
            <CardDescription>输入品类词并选择站点，先从搜索结果里挑一个类目</CardDescription>
          </CardHeader>
          {/* 口径压成一行（2026-09-16，与竞品分析同一次清理）：空态只需要"怎么开始 + 会得到什么" */}
          <CardContent>
            <p className='text-xs text-muted-foreground'>
              结论由服务端按阈值算出、命中才产出，不编评语；选中类目后可把该市场的 TOP
              商品带到「竞品分析」逐个对比。
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

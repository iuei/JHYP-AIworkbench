import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Boxes, Store } from 'lucide-react'
import { TABLE_CELL_MONO, TABLE_EMPTY_VALUE } from '@/lib/table-styles'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { AnswerBlocks } from '@/features/ai-agent/components/answer-blocks'
import {
  apiErrorMessage,
  fetchAnalysisHistory,
  fetchAnalysisSnapshot,
} from '../api'
import { selectAsinDetail, type AsinDetail } from '../asin-detail'
import { formatDateTime, formatNumber } from '../format'
import type {
  ComparisonRow,
  CompetitorAnalysisResult,
  FindingLevel,
  InventoryRisk,
  PublicProductRow,
} from '../types'
import { FindingsPanel } from './findings-panel'
import { ProductImage } from './product-cards'
import { SnapshotShell, SnapshotStateCard } from './snapshot-shell'

/**
 * 竞品详情页（`/competitor-analysis/$asin`）。
 *
 * 从「商品公开数据」卡片点进来，页面只讲**一个** ASIN：公开属性（带主图）、月销量趋势、
 * 流量词、评论痛点、在自家报表里的表现、相关结论。
 *
 * **数据来自已经落库的分析快照**（`GET /api/competitor-analyses/:id`），不重新取数：
 * 卖家精灵按调用次数计费，点开一张卡片就再花两次调用不可接受；而且详情页要说的是
 * "这次分析看到了什么"，重新取数会让同一批 ASIN 在主页面与详情页出现两套数字。
 * 快照的筛选逻辑在 `asin-detail.ts`（纯函数，有单测）。
 */
export interface AsinDetailPageProps {
  asin: string
  /** 分析记录 id（URL 参数 `analysisId`）；缺了就只能提示用户从卡片进入。 */
  analysisId?: number
}

export function AsinDetailPage({ asin, analysisId }: AsinDetailPageProps) {
  const hasId = typeof analysisId === 'number'

  /*
   * 没有 URL 参数时（手改地址、旧收藏、从别处粘链接）**自动找最近一次包含这个 ASIN 的分析** ——
   * 与数据明细子页同一口径：页面打开就该有内容，而不是先给一句"缺少分析记录 id"。
   * 取 20 条摘要而不是 1 条：最近一次分析未必包含这个 ASIN（用户换过分析对象）。
   */
  const history = useQuery({
    queryKey: ['competitor-analysis-latest-for-asin', asin],
    queryFn: () => fetchAnalysisHistory(20),
    enabled: !hasId,
  })

  const fallbackItem =
    (history.data ?? []).find(
      (item) =>
        item.hasSnapshot &&
        item.asins.some((value) => value.toUpperCase() === asin.toUpperCase())
    ) ?? null
  /** 实际展示哪条记录：URL 参数优先，其次最近一次包含该 ASIN 的分析。 */
  const effectiveId = hasId ? analysisId : (fallbackItem?.id ?? null)

  const snapshot = useQuery({
    queryKey: ['competitor-analysis-snapshot', effectiveId ?? null],
    // 依赖只有 `effectiveId`（已在 queryKey 里）：不要引别的派生布尔量，
    // 否则会被 `@tanstack/query/exhaustive-deps` 判为"查询键没覆盖 queryFn 用到的输入"。
    queryFn: async () =>
      typeof effectiveId === 'number'
        ? fetchAnalysisSnapshot(effectiveId)
        : null,
    enabled: typeof effectiveId === 'number',
  })

  const result = snapshot.data ?? null
  const detail = result ? selectAsinDetail(result, asin) : null

  if (!hasId && history.isPending) {
    return (
      <SnapshotShell>
        <SnapshotStateCard
          description='正在找最近一次包含这个 ASIN 的分析…'
          title='加载中…'
        />
      </SnapshotShell>
    )
  }

  if (!hasId && effectiveId === null) {
    return (
      <SnapshotShell>
        <SnapshotStateCard
          description={`没有找到包含 ${asin} 的分析记录。先到「分析」页把这个 ASIN 输进去跑一次，之后从结果里的商品卡片就能点进这个页面。`}
          title='没有这个 ASIN 的分析记录'
        />
      </SnapshotShell>
    )
  }

  if (snapshot.isPending) {
    return (
      <SnapshotShell>
        <SnapshotStateCard
          description='正在读取这次分析的结果快照（不重新调用卖家精灵，不消耗额度）。'
          title='加载中…'
        />
      </SnapshotShell>
    )
  }

  if (snapshot.isError) {
    return (
      <SnapshotShell>
        <SnapshotStateCard
          description={apiErrorMessage(snapshot.error, '读取这条分析记录失败，请稍后重试。')}
          title='打不开这次分析'
        />
      </SnapshotShell>
    )
  }

  if (!result) {
    return (
      <SnapshotShell>
        <SnapshotStateCard
          description='这条分析记录没有保存结果快照（早期记录可能如此），因此看不到当时的明细。'
          title='没有可回看的快照'
        />
      </SnapshotShell>
    )
  }

  if (!detail) {
    return (
      <SnapshotShell>
        <SnapshotStateCard
          description={`${asin} 不属于这次分析（这次分析的是 ${result.asins.join('、')}）。ASIN 是拼在链接里的，手改 URL 就会走到这里。`}
          title='这个 ASIN 不在这次分析里'
        />
      </SnapshotShell>
    )
  }

  const others = result.asins.filter(
    (item) => item.toUpperCase() !== detail.asin.toUpperCase()
  )

  return (
    <SnapshotShell analysisId={effectiveId ?? undefined} subject={detail.asin}>
      {!hasId && (
        <Card>
          <CardContent className='py-3 text-sm text-muted-foreground'>
            未指定分析记录，这里自动打开<b>最近一次</b>包含 {detail.asin} 的分析（#
            {effectiveId}）。要指定某一次，从结果里的商品卡片点进来即可。
          </CardContent>
        </Card>
      )}

      <ProductOverviewCard detail={detail} createdAt={result.createdAt ?? null} />

      {detail.findings.length > 0 && (
        <FindingsPanel
          className=''
          description={`下面只列出证据里点名 ${detail.asin} 的结论（组级结论请回分析页查看）`}
          findings={detail.findings}
          level={highestLevel(detail.findings.map((finding) => finding.level))}
          /* 处置入口要能回到"打开它时的那次分析"，所以带上当前记录 id */
          linkContext={{ analysisId: effectiveId ?? undefined }}
        />
      )}

      {detail.blocks.length > 0 ? (
        <AnswerBlocks blocks={detail.blocks} />
      ) : (
        <Card>
          <CardHeader className='gap-1'>
            <CardTitle className='text-base'>公开数据明细</CardTitle>
            <CardDescription>
              本次分析没有取到这个 ASIN 的公开数据明细（可能是分析时没勾选「流量与关键词 /
              评论痛点」，或卖家精灵未收录）。
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {detail.comparison && <LocalPerformanceCard row={detail.comparison} />}

      {detail.inventory?.mapped && (detail.inventory.items?.length ?? 0) > 0 && (
        <InventoryCard detail={detail} />
      )}

      <SourceCard
        analysisId={analysisId}
        detail={detail}
        others={others}
        result={result}
      />
    </SnapshotShell>
  )
}

/** 商品概览：主图 + 公开属性。缺失一律显示「—」，绝不用 0 代替（卖家精灵并不收录所有 ASIN）。 */
function ProductOverviewCard({
  detail,
  createdAt,
}: {
  detail: AsinDetail
  createdAt: string | null
}) {
  const product = detail.product
  const attributes = productAttributes(product)

  return (
    <Card>
      <CardHeader className='gap-1'>
        <div className='flex flex-wrap items-center gap-2'>
          <CardTitle className='text-base'>
            <span className={TABLE_CELL_MONO}>{detail.asin}</span>
          </CardTitle>
          <Badge variant={detail.role === 'subject' ? 'default' : 'secondary'}>
            {detail.roleLabel}
          </Badge>
          <Badge variant='outline'>{detail.marketplace} 站</Badge>
          {createdAt && (
            <span className='text-xs text-muted-foreground'>
              分析于 {formatDateTime(createdAt)}
            </span>
          )}
        </div>
        <CardDescription>
          {product?.hasData
            ? '以下公开属性来自卖家精灵第三方估算数据；缺失显示「—」表示它未收录该字段'
            : '卖家精灵未收录这个 ASIN 的公开数据（或本次分析没有勾选「商品公开数据」维度）'}
        </CardDescription>
      </CardHeader>

      <CardContent className='grid gap-4 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)]'>
        <div className='aspect-square w-full overflow-hidden rounded-lg border bg-muted/30'>
          <ProductImage
            alt={`${detail.asin} 商品主图`}
            url={product?.imageUrl ?? null}
          />
        </div>

        <div className='min-w-0 space-y-3'>
          <div className='space-y-1'>
            <p className='text-sm font-medium'>
              {product?.title ?? '未取到商品标题'}
            </p>
            <p className='text-xs text-muted-foreground'>
              {product?.brand ?? TABLE_EMPTY_VALUE}
              {product?.nodeLabelPath ? ` · ${product.nodeLabelPath}` : ''}
            </p>
          </div>

          <dl className='grid grid-cols-2 gap-x-4 gap-y-2 text-sm lg:grid-cols-3'>
            {attributes.map((item) => (
              <div key={item.label} className='min-w-0'>
                <dt className='text-xs text-muted-foreground'>{item.label}</dt>
                <dd className='truncate font-medium tabular-nums' title={item.value}>
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>

          {detail.availability && !detail.availability.hasData && (
            <p className='text-xs text-muted-foreground'>
              这个 ASIN 在已导入的报表里没有数据；可用站点：
              {detail.availability.marketplaces.length > 0
                ? detail.availability.marketplaces
                    .map((item) => item.marketplace)
                    .join('、')
                : '无'}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function productAttributes(product: PublicProductRow | null) {
  if (!product) return []
  return [
    { label: '价格', value: formatPrice(product.price) },
    { label: '评分', value: formatNumber(product.rating) },
    { label: '评分数', value: formatNumber(product.ratings) },
    { label: 'BSR', value: formatNumber(product.bsrRank) },
    { label: 'BSR 类目', value: product.bsrLabel ?? TABLE_EMPTY_VALUE },
    { label: '卖家数', value: formatNumber(product.sellers) },
    { label: '配送', value: product.fulfillment ?? TABLE_EMPTY_VALUE },
    { label: 'LQS', value: formatNumber(product.lqs) },
    { label: '上架日期', value: product.availableDate ?? TABLE_EMPTY_VALUE },
    {
      label: '在售天数',
      value:
        product.listedDays === null || product.listedDays === undefined
          ? TABLE_EMPTY_VALUE
          : `${product.listedDays} 天`,
    },
  ]
}

/** 自家报表表现：第三方竞品通常不在这里，如实说明原因而不是留空白。 */
function LocalPerformanceCard({ row }: { row: ComparisonRow }) {
  const metrics = [
    { label: '曝光', value: formatNumber(row.impressions) },
    { label: '点击', value: formatNumber(row.clicks) },
    { label: '广告花费', value: formatNumber(row.spend) },
    { label: '广告销售额', value: formatNumber(row.sales) },
    { label: '订单', value: formatNumber(row.orders) },
    { label: '销量', value: formatNumber(row.units) },
    { label: 'ACoS', value: formatPercent(row.acos) },
    { label: '点击率', value: formatPercent(row.ctr) },
    { label: '转化率', value: formatPercent(row.cvr) },
    { label: 'CPC', value: formatNumber(row.cpc) },
  ]

  return (
    <Card>
      <CardHeader className='gap-1'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Store className='size-4' aria-hidden='true' />
          自家报表表现
        </CardTitle>
        <CardDescription>
          {row.hasData
            ? '来自本公司导入的广告日报与业务报告：这是真金白银的经营数据，与上面卖家精灵的公开数据口径不同，请勿相加'
            : (row.emptyReason ??
              '这个 ASIN 不在已导入的广告日报与业务报告里。第三方竞品通常如此——自家报表只覆盖本公司商品，这不代表它卖得不好')}
        </CardDescription>
      </CardHeader>
      {row.hasData && (
        <CardContent>
          <dl className='grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5'>
            {metrics.map((item) => (
              <div key={item.label} className='min-w-0'>
                <dt className='text-xs text-muted-foreground'>{item.label}</dt>
                <dd className='truncate font-medium tabular-nums' title={item.value}>
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      )}
    </Card>
  )
}

/** 库存与可售天数：只对本品做（竞品不在产品主数据里，服务端也不会带回）。 */
function InventoryCard({ detail }: { detail: AsinDetail }) {
  const items = detail.inventory?.items ?? []
  return (
    <Card>
      <CardHeader className='gap-1'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Boxes className='size-4' aria-hidden='true' />
          库存与可售天数
        </CardTitle>
        <CardDescription>
          {detail.inventory?.note ??
            '可售天数按本品的销量口径与库存快照计算；竞品没有这项数据（不在产品主数据里）'}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {items.map((item) => (
          <div key={item.sku} className='rounded-lg border p-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <span className={TABLE_CELL_MONO}>{item.sku}</span>
              <Badge variant={RISK_VARIANTS[item.risk] ?? 'outline'}>
                {RISK_LABELS[item.risk] ?? item.risk}
              </Badge>
            </div>
            <dl className='mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6'>
              {[
                { label: '可用', value: formatNumber(item.available) },
                { label: '在途', value: formatNumber(item.inTransit) },
                { label: '占用', value: formatNumber(item.reserved) },
                { label: '日均销量', value: formatNumber(item.dailySales) },
                { label: '可售天数', value: formatNumber(item.daysOfSupply) },
                { label: '建议补货', value: formatNumber(item.suggestedReorder) },
              ].map((entry) => (
                <div key={entry.label} className='min-w-0'>
                  <dt className='text-xs text-muted-foreground'>{entry.label}</dt>
                  <dd className='truncate font-medium tabular-nums'>{entry.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/** 口径与来源：把"这是哪一次分析、数据从哪来、花了多少额度"写清楚，并给出同批 ASIN 的切换入口。 */
function SourceCard({
  detail,
  others,
  result,
  analysisId,
}: {
  detail: AsinDetail
  others: string[]
  result: CompetitorAnalysisResult
  /**
   * 来自 URL 的**记录 id**，不要取 `result.analysisId` —— 快照本身没有这个字段
   * （它是 `GET /api/competitor-analyses/:id` 的读取方另外拼上去的），
   * 用它拼链接会生成一个丢掉 `analysisId` 的地址，切过去只会看到"缺少分析记录 id"。
   */
  analysisId?: number
}) {
  return (
    <Card>
      <CardHeader className='gap-1'>
        <CardTitle className='text-base'>数据来源与口径</CardTitle>
        <CardDescription>
          本页是 {detail.asin} 在一次分析快照里的切片，不重新调用卖家精灵（因此不会消耗额度）
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3 text-sm text-muted-foreground'>
        <ul className='space-y-1'>
          <li>
            分析区间 {detail.startDate} ~ {detail.endDate}（{detail.windowDays} 天）
            {result.compareLabel ? ` · ${result.compareLabel}` : ' · 不做对比'}
            {result.marketplaceSource === 'auto' ? ' · 站点按数据推导' : ''}
          </li>
          <li>
            本次分析对象：{result.asins.join('、')}（第一个为
            本品）；本品取自自家报表，竞品取自卖家精灵公开数据
          </li>
          <li>
            公开数据消耗：实际调用 {result.publicData?.calls ?? 0} 次，缓存命中{' '}
            {result.publicData?.cacheHits ?? 0} 次（命中不计费）
          </li>
        </ul>
        {others.length > 0 && (
          <div className='space-y-2'>
            <p className='text-sm text-foreground'>同一次分析里的其它 ASIN</p>
            <div className='flex flex-wrap gap-2'>
              {others.map((item) => (
                <Button asChild key={item} size='sm' variant='outline'>
                  <Link
                    params={{ asin: item }}
                    search={{ analysisId }}
                    to='/competitor-analysis/$asin'
                  >
                    {item}
                  </Link>
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const RISK_LABELS: Record<InventoryRisk, string> = {
  stockout: '断货风险',
  overstock: '积压',
  slow_moving: '滞销',
  insufficient_sample: '样本不足',
  unknown: '缺销量数据',
  healthy: '健康',
}

const RISK_VARIANTS: Record<
  InventoryRisk,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  stockout: 'destructive',
  overstock: 'default',
  slow_moving: 'secondary',
  insufficient_sample: 'outline',
  unknown: 'outline',
  healthy: 'outline',
}

const LEVEL_WEIGHT: Record<FindingLevel, number> = {
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
}

/** 子集自己的最高严重度：详情页只列该 ASIN 的结论，徽章不能沿用整组的分级。 */
function highestLevel(levels: FindingLevel[]): FindingLevel {
  return levels.reduce<FindingLevel>(
    (highest, level) =>
      LEVEL_WEIGHT[level] > LEVEL_WEIGHT[highest] ? level : highest,
    'info'
  )
}

function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return TABLE_EMPTY_VALUE
  return `$${formatNumber(value)}`
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return TABLE_EMPTY_VALUE
  return `${formatNumber(value)}%`
}

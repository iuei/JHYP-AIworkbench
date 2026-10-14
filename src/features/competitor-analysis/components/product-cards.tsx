import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ImageOff, LayoutGrid, Table2 } from 'lucide-react'
import { TABLE_CELL_MONO, TABLE_EMPTY_VALUE } from '@/lib/table-styles'
import { cn } from '@/lib/utils'
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
import type { AnswerBlock } from '@/features/ai-agent/types'
import { formatNumber } from '../format'
import { transposeProductTable, type ProductViewItem } from '../product-view'

/**
 * 商品数据的两种读法（卡片 / 表格）。
 *
 * 用户口径（2026-09-16）：「竞品分析的数据应该使用卡片展示，包含图片，点击卡片后跳转到单独页面，
 * 页面内是该竞品的详细内容」。
 *
 * - **卡片为默认视图**：一个 ASIN 一张卡，带卖家精灵主图（`publicData.rows[].imageUrl`，
 *   服务端一直在回传，此前没有任何地方展示），点整张卡进 `/competitor-analysis/$asin`；
 * - **表格保留为切换视图**：横比多个 ASIN 的价格 / 评分 / BSR 时表格仍然更好用，
 *   而且这一页此前刚按「内容优先用数据表格」的口径表格化过 —— 直接删掉表格是开倒车。
 *
 * 表格视图直接复用服务端生成的块（`tableBlock`），不另写一张表：
 * 同一份数据只有一处口径，列定义跟着服务端走。
 */

const CARD_GRID = 'grid auto-rows-fr gap-3 sm:grid-cols-2 2xl:grid-cols-3'

const LAYOUT_STORAGE_KEY = 'competitor-product-layout'

type ProductLayout = 'card' | 'table'

/** 读上次选择的展示方式，默认卡片。隐私模式禁用 storage、值被改坏都不该让页面挂掉。 */
function readStoredLayout(): ProductLayout {
  try {
    return localStorage.getItem(LAYOUT_STORAGE_KEY) === 'table'
      ? 'table'
      : 'card'
  } catch {
    return 'card'
  }
}

type ProductViewProps = {
  items: ProductViewItem[]
  /** 落库后的分析记录 id：卡片详情页靠它读同一次分析的快照。 */
  analysisId?: number
  /** 服务端生成的商品公开数据表块；没有（本次未取公开数据）时为 null。 */
  tableBlock: AnswerBlock | null
  /** 本次分析实际取到的公开数据维度文案，用于说明"为什么有些格子是 —"。 */
  dimensionLabels: string[]
}

export function ProductView({
  items,
  analysisId,
  tableBlock,
  dimensionLabels,
}: ProductViewProps) {
  const [layout, setLayout] = useState<ProductLayout>(readStoredLayout)

  function handleLayoutChange(next: ProductLayout) {
    setLayout(next)
    try {
      localStorage.setItem(LAYOUT_STORAGE_KEY, next)
    } catch {
      // 记不住偏好不影响本次使用
    }
  }

  const hasPublicData = items.some((item) => item.product?.hasData)

  return (
    <Card>
      <CardHeader className='gap-1'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <CardTitle className='text-base'>商品公开数据（卖家精灵）</CardTitle>
          <LayoutToggle layout={layout} onLayoutChange={handleLayoutChange} />
        </div>
        <CardDescription>
          {layout === 'card'
            ? '点卡片进入该竞品的详细页面（主图、公开属性、月销量趋势、流量词与评论痛点）'
            : '同一批数据的表格读法：横向比多个 ASIN 的价格 / 评分 / BSR 更直接'}
          {dimensionLabels.length > 0
            ? ` · 本次已取维度：${dimensionLabels.join('、')}`
            : ''}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {layout === 'card' ? (
          <div className={CARD_GRID}>
            {items.map((item) => (
              <ProductCard
                key={item.asin}
                analysisId={analysisId}
                item={item}
              />
            ))}
          </div>
        ) : tableBlock ? (
          /*
           * 转置后再渲染：一行一个属性、一列一个 ASIN，并带与「按日对比」一致的归属配色
           * （用户口径 2026-09-17：「竞品和本品的对比都参考按日对比排版方式」）。
           * `transposeProductTable` 只重排、不算数字，对已落库快照立即生效。
           */
          <AnswerBlocks blocks={[transposeProductTable(tableBlock)]} />
        ) : (
          <p className='text-sm text-muted-foreground'>
            本次分析没有取「商品公开数据」维度，因此没有可切换的表格。重新分析时勾选该维度即可。
          </p>
        )}
        {!hasPublicData && (
          <p className='mt-3 text-xs text-muted-foreground'>
            这一批 ASIN 在卖家精灵都没有收录信息，卡片只显示 ASIN
            本身；点进去仍可看到自家报表那一侧的数据。
          </p>
        )}
      </CardContent>
    </Card>
  )
}

type LayoutToggleProps = {
  layout: ProductLayout
  onLayoutChange: (layout: ProductLayout) => void
}

/**
 * 展示方式切换（卡片 / 表格）。
 *
 * 用 `aria-pressed` 的分段按钮而不是选项卡：这是"同一批数据的两种读法"，
 * 与提示词广场的 `LayoutToggle` 同一形态（那边是表格默认，这边是卡片默认，按各自的默认读法定）。
 */
function LayoutToggle({ layout, onLayoutChange }: LayoutToggleProps) {
  return (
    <div
      aria-label='展示方式'
      className='flex items-center rounded-lg border p-0.5'
      role='group'
    >
      <Button
        aria-pressed={layout === 'card'}
        className='h-8 gap-1.5 px-3'
        size='sm'
        variant={layout === 'card' ? 'secondary' : 'ghost'}
        onClick={() => onLayoutChange('card')}
      >
        <LayoutGrid className='size-3.5' aria-hidden='true' />
        卡片
      </Button>
      <Button
        aria-pressed={layout === 'table'}
        className='h-8 gap-1.5 px-3'
        size='sm'
        variant={layout === 'table' ? 'secondary' : 'ghost'}
        onClick={() => onLayoutChange('table')}
      >
        <Table2 className='size-3.5' aria-hidden='true' />
        表格
      </Button>
    </div>
  )
}

type ProductCardProps = {
  item: ProductViewItem
  analysisId?: number
}

/**
 * 单个 ASIN 的卡片。
 *
 * 整张卡就是一个链接（内部不再放按钮）：嵌套交互元素会让键盘用户在同一处按到两件事，
 * 而"点进详情"是这张卡唯一的动作。
 */
function ProductCard({ item, analysisId }: ProductCardProps) {
  const { product, comparison } = item
  const linkable = typeof analysisId === 'number'

  const body = (
    <>
      <div className='relative aspect-square w-full overflow-hidden rounded-lg border bg-muted/30'>
        <ProductImage
          alt={`${item.asin} 商品主图`}
          url={product?.imageUrl ?? null}
        />
        <Badge
          className='absolute start-2 top-2 font-normal'
          variant={item.role === 'subject' ? 'default' : 'secondary'}
        >
          {item.roleLabel}
        </Badge>
      </div>

      <div className='flex min-w-0 flex-1 flex-col gap-2'>
        <div className='space-y-1'>
          <p className={cn(TABLE_CELL_MONO, 'text-muted-foreground')}>
            {item.asin}
          </p>
          <p
            className='line-clamp-2 text-sm font-medium'
            title={product?.title ?? undefined}
          >
            {product?.title ?? (product ? '未提供标题' : '卖家精灵未收录该 ASIN')}
          </p>
          <p className='text-xs text-muted-foreground'>
            {product?.brand ?? TABLE_EMPTY_VALUE}
            {product?.listedDays !== null && product?.listedDays !== undefined
              ? ` · 上架 ${product.listedDays} 天`
              : ''}
          </p>
        </div>

        {/* 数字成对铺开：卡片本身是"扫一眼"的物件，不适合逐行读 */}
        <dl className='mt-auto grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs'>
          <Metric label='价格' value={formatPrice(product?.price)} />
          <Metric
            label='评分'
            value={
              product?.rating === null || product?.rating === undefined
                ? TABLE_EMPTY_VALUE
                : `${formatNumber(product.rating)}（${formatNumber(product.ratings)} 评分数）`
            }
          />
          <Metric label='BSR' value={formatNumber(product?.bsrRank)} />
          <Metric
            label='卖家数'
            value={formatNumber(product?.sellers)}
          />
        </dl>

        <p className='text-xs text-muted-foreground'>
          {comparison?.hasData
            ? `自家报表：ACoS ${formatPercent(comparison.acos)} · 花费 ${formatNumber(comparison.spend)}`
            : '自家报表：无记录（第三方竞品不在广告日报与业务报告里）'}
        </p>
      </div>
    </>
  )

  const baseClass =
    'flex h-full flex-col gap-3 rounded-xl border p-3 text-start transition-colors'

  if (!linkable) {
    return (
      <article
        className={cn(baseClass, 'opacity-80')}
        data-product-card={item.asin}
      >
        {body}
        <p className='text-xs text-muted-foreground'>
          本次分析没有落库记录，暂时打不开详情页。
        </p>
      </article>
    )
  }

  return (
    <Link
      aria-label={`查看 ${item.asin} 的详细内容`}
      className={cn(
        baseClass,
        'hover:border-foreground/25 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
      )}
      data-product-card={item.asin}
      params={{ asin: item.asin }}
      search={{ analysisId }}
      to='/competitor-analysis/$asin'
    >
      {body}
    </Link>
  )
}

/**
 * 主图。加载失败与"没有链接"走同一个占位：卖家精灵有时给的是失效图床。
 * 导出是因为竞品详情页要用同一套占位与 `object-contain`（白底主图不能裁切）。
 */
export function ProductImage({ url, alt }: { url: string | null; alt: string }) {
  const [failed, setFailed] = useState(false)

  if (!url || failed) {
    return (
      <div className='flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground'>
        <ImageOff className='size-6' aria-hidden='true' />
        <span className='text-xs'>无主图</span>
      </div>
    )
  }

  return (
    <img
      alt={alt}
      className='h-full w-full object-contain p-2'
      loading='lazy'
      src={url}
      onError={() => setFailed(true)}
    />
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className='min-w-0'>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='truncate font-medium tabular-nums' title={value}>
        {value}
      </dd>
    </div>
  )
}

/** 价格带币种符号；缺失一律显示「—」（绝不折算成 0）。 */
function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return TABLE_EMPTY_VALUE
  return `$${formatNumber(value)}`
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return TABLE_EMPTY_VALUE
  return `${formatNumber(value)}%`
}

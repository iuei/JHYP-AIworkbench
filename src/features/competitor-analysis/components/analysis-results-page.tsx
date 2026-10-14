import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeftRight, CalendarRange, Clock, ListChecks } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AnswerBlocks } from '@/features/ai-agent/components/answer-blocks'
import {
  apiErrorMessage,
  fetchAnalysisHistory,
  fetchAnalysisSnapshot,
} from '../api'
import {
  isComparisonTableBlock,
  transposeComparisonTable,
} from '../comparison-table'
import {
  FINDING_LEVEL_LABELS,
  FINDING_LEVEL_VARIANTS,
  formatDateTime,
} from '../format'
import {
  buildProductViewItems,
  splitPublicProductBlocks,
} from '../product-view'
import { applyRowTones } from '../role-rows'
import { FindingsSections } from './findings-panel'
import { ProductView } from './product-cards'
import { SnapshotShell, SnapshotStateCard } from './snapshot-shell'

/**
 * 分析结果页（`/competitor-analysis/results?analysisId=<id>`）。
 *
 * 用户口径（2026-09-16）：「数据明细应该修改为分析结果，分析页面的分析结果卡片移动到新名称为分析结果页面内，
 * 分析结果页面内包含数据明细。**分析页面只保留需要分析数据的填充设置和历史分析，其他内容都放入到分析结果内**」。
 *
 * 于是这一页承载**一次分析的全部产出**：
 * **顶部一张合并卡**（结论与建议 + 判定 + 这次分析是谁 + 区间基线 + 一句话结论 + 分组结论列表 +
 * 底部一行数据来源）→ 全部数据块（自家报表横向对比、库存联动、按日对比、商品卡片与公开数据、
 * 流量词、评论痛点）。分析页只留「参数设置 + 历史分析」。
 *
 * **顶部排版的三轮口径（2026-09-17，最终形态见这里）**：
 * ① 第一轮：正文一律 `max-w-3xl` 限宽（65~75 字符的舒适行宽）+ `leading-relaxed` + `text-pretty`,
 *    改前整段横跨 1256px 卡片全宽；徽章 `shrink-0 whitespace-nowrap`；结论条目**不做成内层卡片**
 *    （左侧 2px 竖条 + 缩进，见 `findings-panel.tsx` 的 `FindingItem`）。
 * ② 第二轮：删掉页面底部的「数据口径与未接入维度」卡（用户明确要求），
 *    `comparison.note` 页面上不再固定展示（服务端字段与快照不动）。
 * ③ 第三轮（**最终**）：把"结果头卡 + 结论与建议卡"**合并成一张卡**（用户选定「合并成一张卡：
 *    顶部只留一层」）—— 改前两张卡共 841px，判定徽章说两遍；现在卡内三层：卡头 → 一句话结论 +
 *    结论分组列表 → 卡片底部一行"数据来源与时效 + 公开数据调用次数"（用户选定「压成卡片底部一行小字」）。
 *
 * ⚠️ 脚本契约（改这块前必读）：`结论与建议`（`getByText(..., { exact: true })` 是四个脚本的
 * **结果页就绪信号**）、`统计区间`、`公开数据调用 N 次（缓存命中 M 次，不计费）。`
 * —— 三处文本必须保持原样，且后两处**整句留在同一个元素内**。
 * 只读检查与截图见 `verify-artifacts/check-competitor-findings-layout.mjs`。
 *
 * 与竞品详情页一样，本页**只读已落库快照**（`GET /api/competitor-analyses/:id`），
 * 不重新取数、不消耗卖家精灵额度；不带 `analysisId` 打开时自动回落最近一次分析。
 *
 * 块的顺序**沿用服务端给的顺序**（本品自家块 → 横向对比 → 库存 → 公开数据块），
 * 不再按标题文案重新分组：标题是给人看的文案，按它分类一旦被改动就会静默错位。
 */
export interface AnalysisResultsPageProps {
  analysisId?: number
}

export function AnalysisResultsPage({ analysisId }: AnalysisResultsPageProps) {
  const hasId = typeof analysisId === 'number'

  /*
   * 没有 URL 参数时（从侧边栏 / 顶栏「数据明细」直接进来）取**最近一次有快照的分析**：
   * 用户口径（2026-09-16）「为什么没有直接展示在子页面，且没有直接的子页面入口」——
   * 子页既然是导航里的独立入口，打开就该有内容，而不是一句"缺少分析记录 id"。
   *
   * 查询键刻意**不复用**主页的 `['competitor-analyses']`（那边 limit=10，
   * 同键会互相覆盖条数，交接文档里记过这个坑）。
   */
  const latest = useQuery({
    queryKey: ['competitor-analysis-latest'],
    queryFn: () => fetchAnalysisHistory(20),
    enabled: !hasId,
  })

  const latestItem =
    (latest.data ?? []).find((item) => item.hasSnapshot) ?? null
  /** 实际展示哪条记录：URL 参数优先，其次最近一次可回看的分析。 */
  const effectiveId = hasId ? analysisId : (latestItem?.id ?? null)

  const snapshot = useQuery({
    queryKey: ['competitor-analysis-snapshot', effectiveId ?? null],
    queryFn: async () =>
      typeof effectiveId === 'number'
        ? fetchAnalysisSnapshot(effectiveId)
        : null,
    enabled: typeof effectiveId === 'number',
  })

  const result = snapshot.data ?? null

  if (!hasId && latest.isPending) {
    return (
      <SnapshotShell>
        <SnapshotStateCard
          description='正在找最近一次可回看的分析…'
          title='加载中…'
        />
      </SnapshotShell>
    )
  }

  if (!hasId && latest.isError) {
    return (
      <SnapshotShell>
        <SnapshotStateCard
          description={apiErrorMessage(
            latest.error,
            '读取分析历史失败，请稍后重试。'
          )}
          title='读取分析历史失败'
        />
      </SnapshotShell>
    )
  }

  if (!hasId && effectiveId === null) {
    return (
      <SnapshotShell>
        <SnapshotStateCard
          description='还没有可回看的分析记录。先到「分析」页输入 ASIN 跑一次，结果会自动保存，之后这里就能直接看到那次的全部数据明细。'
          title='还没有分析记录'
        />
      </SnapshotShell>
    )
  }

  if (snapshot.isPending) {
    return (
      <SnapshotShell analysisId={effectiveId ?? undefined}>
        <SnapshotStateCard
          description='正在读取这次分析的结果快照（不重新调用卖家精灵，不消耗额度）。'
          title='加载中…'
        />
      </SnapshotShell>
    )
  }

  if (snapshot.isError) {
    return (
      <SnapshotShell analysisId={effectiveId ?? undefined}>
        <SnapshotStateCard
          description={apiErrorMessage(
            snapshot.error,
            '读取这条分析记录失败，请稍后重试。'
          )}
          title='打不开这次分析'
        />
      </SnapshotShell>
    )
  }

  if (!result) {
    return (
      <SnapshotShell analysisId={effectiveId ?? undefined}>
        <SnapshotStateCard
          description='这条分析记录没有保存结果快照（早期记录可能如此），因此看不到当时的明细。'
          title='没有可回看的快照'
        />
      </SnapshotShell>
    )
  }

  /*
   * 商品公开数据交给 `ProductView`（卡片默认 + 表格切换），与主页同一处理 ——
   * 用户口径（2026-09-16）「商品公开数据（卖家精灵）这个卡片也应该放进数据明细页」。
   * 摘块仍走结构化标记（见 `product-view.ts`），不按标题文案匹配。
   */
  const blocks = result.blocks ?? []
  const productSplit = splitPublicProductBlocks(blocks)
  /*
   * 「ASIN 横向对比」转置成"一行一个指标、一列一个 ASIN"（本品与竞品逐指标相邻），
   * 用户口径：「对比起来不方便，我需要一一对应本品跟竞品」。只重排、不算任何数字，
   * 因此对已落库的历史快照同样立即生效（见 `comparison-table.ts`）。
   */
  const beforeBlocks = productSplit.before.map((block) =>
    isComparisonTableBlock(block)
      ? transposeComparisonTable(block)
      : applyRowTones(block)
  )
  const productItems = buildProductViewItems({
    asins: result.asins ?? [],
    primaryAsin: result.primaryAsin ?? result.asin,
    rows: result.publicData?.rows ?? [],
    comparisonRows: result.comparison?.rows ?? [],
  })
  const missingProducts = result.publicData
    ? result.asins.length - result.publicData.productCount
    : 0

  /** 本品在卖家精灵里的类目名（取路径最后一段），只用于「去市场调研」的跳转关键词。 */
  const marketKeyword = (() => {
    const subject = (result.publicData?.rows ?? []).find(
      (row) => row.role === 'subject'
    )
    const path = subject?.nodeLabelPath
    if (!path) return null
    return path.split(':').filter(Boolean).pop() ?? null
  })()

  return (
    <SnapshotShell
      analysisId={effectiveId ?? undefined}
      subject={result.primaryAsin ?? result.asin}
    >
      {/*
        **顶部只有一张卡**（2026-09-17 用户口径：「合并成一张卡：顶部只留一层」）。
        改前是"结果头卡 + 结论与建议卡"两张：判定徽章说两遍，首屏（1080px）几乎被两张卡占满
        （实测两卡 841px + 页头 176px）。现在合成一张，卡内三层：
        ① 卡头（结论与建议 + 判定 + 计数 / 这次分析是谁 / 区间与基线）→ ② 一句话结论 + 分组结论列表
        → ③ 卡片底部一行"数据来源与时效 + 公开数据调用次数"。

        ⚠️ 三个文本节点的格式是脚本契约，别动：`结论与建议`（`exact: true` 定位）、`统计区间`、
        `公开数据调用 N 次（缓存命中 M 次，不计费）。`（`verify-competitor-public.mjs` 读其中的两个数字）。
      */}
      <Card>
        <CardHeader className='gap-2'>
          <div className='flex flex-wrap items-center gap-x-2 gap-y-1.5'>
            <CardTitle className='flex items-center gap-2 text-base'>
              <ListChecks className='size-4' aria-hidden='true' />
              结论与建议
            </CardTitle>
            <Badge
              className='shrink-0 whitespace-nowrap'
              variant={FINDING_LEVEL_VARIANTS[result.findingLevel]}
            >
              {FINDING_LEVEL_LABELS[result.findingLevel]}
            </Badge>
            <span className='shrink-0 text-xs whitespace-nowrap text-muted-foreground'>
              共 {result.findings.length} 条
            </span>
          </div>
          {/*
            第二行：这次分析是谁（ASIN 列表）+ 站点 + 自动回落提示。
            徽章一律 `shrink-0 whitespace-nowrap` —— 紧凑标签折行后会被读成两段信息。
          */}
          <div className='flex flex-wrap items-center gap-x-2 gap-y-1.5'>
            <span className='text-sm font-medium'>
              {result.asins.join('、')}
            </span>
            <Badge
              className='shrink-0 font-normal whitespace-nowrap'
              variant='secondary'
            >
              {result.marketplace} 站
            </Badge>
            {!hasId && (
              <Badge className='shrink-0 whitespace-nowrap' variant='outline'>
                自动打开最近一次 #{effectiveId}
              </Badge>
            )}
          </div>
          {/*
            第三行：区间 / 对比基线 / 分析时间。三者各自成组（图标 + 文案），
            宽度不够时整组折行而不是从中间断开。
          */}
          <div className='flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground'>
            <span className='inline-flex items-center gap-1.5'>
              <CalendarRange className='size-3.5' aria-hidden='true' />
              统计区间 {result.startDate} ~ {result.endDate}（
              {result.windowDays} 天）
            </span>
            <span className='inline-flex items-center gap-1.5'>
              <ArrowLeftRight className='size-3.5' aria-hidden='true' />
              {result.compareLabel ?? '不做对比'}
            </span>
            {result.createdAt && (
              <span className='inline-flex items-center gap-1.5'>
                <Clock className='size-3.5' aria-hidden='true' />
                分析于 {formatDateTime(result.createdAt)}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent className='space-y-5'>
          {/*
            一句话结论是这张卡的主视觉：用**左侧竖条引用**呈现 —— 与下面每条结论同一种视觉语言
            （"竖条 = 这是判断"），不再是一段和别处没区别的正文。
          */}
          <p className='max-w-3xl border-l-2 border-l-primary/60 pl-3 text-sm leading-relaxed font-medium text-pretty'>
            {result.headline}
          </p>

          {/*
            结论列表（分组 + 严重度排序 + 提示级折叠 + 依据折叠）由 `FindingsSections` 提供 ——
            它**不含卡片外壳**，外壳就是这张合并卡；竞品详情页仍用带壳的 `FindingsPanel`。
            `linkContext` 补上处置入口需要的上下文：分析记录 id（跳竞品详情/回看明细要用）
            与本品类目名（跳市场调研要用）—— 服务端生成入口时还没有这两样。
          */}
          <FindingsSections
            findings={result.findings}
            layout='decision-desk'
            linkContext={{
              analysisId: effectiveId ?? undefined,
              keyword: marketKeyword,
              marketplace: result.marketplace,
            }}
          />

          {/*
            卡片底部**一行小字**（用户选定：「压成卡片底部一行小字」）：
            数据来源与时效 + 公开数据调用次数 + 未收录提示，限宽 + `flex-wrap`（宽屏一行、窄屏折行）。
            ⚠️ `公开数据调用 N 次（缓存命中 M 次，不计费）。` 必须整句留在同一个 `<span>` 内 ——
            `verify-competitor-public.mjs` 按它读调用数与命中数。
          */}
          <div className='space-y-1 border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground'>
            <p className='flex max-w-3xl flex-wrap gap-x-3 gap-y-1'>
              {result.dataFreshness?.note && (
                <span className='text-pretty'>{result.dataFreshness.note}</span>
              )}
              {result.publicData && result.publicData.dimensions.length > 0 && (
                <span>
                  公开数据调用 {result.publicData.calls} 次（缓存命中{' '}
                  {result.publicData.cacheHits} 次，不计费）。
                </span>
              )}
              {missingProducts > 0 && (
                <span>
                  其中 {missingProducts} 个 ASIN
                  卖家精灵未收录，「—」不代表数值为 0。
                </span>
              )}
            </p>
            {marketKeyword && (
              <p className='max-w-3xl text-pretty'>
                想看本品所在类目的市场结构（规模、集中度、价格带、新品占比）？
                <Link
                  className='text-foreground underline underline-offset-2'
                  to='/product-dev/market'
                  search={{
                    keyword: marketKeyword,
                    marketplace: result.marketplace,
                  }}
                >
                  去市场调研查看「{marketKeyword}」
                </Link>
              </p>
            )}
            {result.publicData && result.publicData.errors.length > 0 && (
              <p className='max-w-3xl text-pretty text-destructive'>
                部分公开数据未取到：
                {result.publicData.errors
                  .map(
                    (error) =>
                      `${error.asin ?? error.dimension}：${error.message}`
                  )
                  .join('；')}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <AnswerBlocks blocks={beforeBlocks} />

      {productSplit.product &&
        (productItems.length > 0 ? (
          <ProductView
            analysisId={effectiveId ?? undefined}
            dimensionLabels={result.publicData?.dimensionLabels ?? []}
            items={productItems}
            tableBlock={productSplit.product}
          />
        ) : (
          <AnswerBlocks blocks={[productSplit.product]} />
        ))}

      <AnswerBlocks blocks={productSplit.after.map(applyRowTones)} />

      {/*
        ⚠️ 页面到此结束：底部的「数据口径与未接入维度」卡**已删除**。
        用户口径（2026-09-17，两次确认）：「数据口径与未接入维度确实需要删除。
        我要你优化最上方的几张卡片 分析结果页面的顶部结论与建议」——
        承载过 `comparison.note`（"同口径组内对比、不代表竞品整体策略"）与"已接入 / 仍未接入"两组清单。
        连带影响：这条 `comparison.note` 口径**页面上不再固定展示**（服务端仍返回、快照里仍在，
        AI 助手链路不受影响）；"自家与公开数据不可相加"仍写在每个公开数据块自己的 `note` 里。
        **不要再把该卡或未接入维度清单放回来** —— 那是用户的明确决定。
      */}
    </SnapshotShell>
  )
}

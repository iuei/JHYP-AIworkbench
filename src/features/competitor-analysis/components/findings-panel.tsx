import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleSlash,
  ClipboardCopy,
  Lightbulb,
  ListChecks,
  RotateCcw,
  Wrench,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { useAuthStore } from '@/stores/auth-store'
import { apiErrorMessage, clearFindingDisposition, setFindingDisposition } from '../api'
import { FINDING_LEVEL_LABELS, FINDING_LEVEL_VARIANTS, formatDateTime } from '../format'
import type {
  Finding,
  FindingDisposition,
  FindingDispositionStatus,
  FindingFix,
  FindingLevel,
} from '../types'

type FindingsPanelProps = {
  findings: Finding[]
  level: FindingLevel
  /** 处置入口需要的页面上下文（补 analysisId / 类目关键词）；不传时相关按钮不渲染。 */
  linkContext?: FindingsLinkContext
  /** 外层容器的间距由调用方决定；默认保留历史行为（底部 24px）。 */
  className?: string
  description?: string
}

/**
 * 结论列表本身（分组 + 严重度排序 + 提示级折叠），**不含卡片外壳**。
 *
 * 2026-09-17 抽出来的原因：分析结果页把"结果头卡 + 结论与建议"**合并成了一张卡**
 * （用户口径：「合并成一张卡：顶部只留一层」），结论列表要嵌进那张卡；
 * 而竞品详情页仍然是"一张独立的结论卡"。两处共用这份内容，只是外壳不同，
 * 因此外壳（`Card`）留在调用方，这里只导出内容。
 */
export function FindingsSections({
  findings,
  linkContext,
  maxItemsPerGroup,
  layout = 'list',
}: {
  findings: Finding[]
  /** 处置入口需要的页面上下文（补 `analysisId` / 类目关键词）；不传时相关按钮不渲染。 */
  linkContext?: FindingsLinkContext
  /** 结果页首屏只展示前几条；详情页不传则展示全部。 */
  maxItemsPerGroup?: number
  /** 结果页使用左右决策台；详情页保留传统纵向列表。 */
  layout?: 'list' | 'decision-desk'
}) {
  if (layout === 'decision-desk') {
    return <DecisionDesk findings={findings} linkContext={linkContext} />
  }

  const local = findings.filter((finding) => finding.scope !== 'public')
  const external = findings.filter((finding) => finding.scope === 'public')

  return (
    <>
      <FindingGroup
        title='自家经营数据'
        hint='来自已导入的广告日报 / 业务报告 / 库存快照，是本公司真实经营数据'
        items={local}
        linkContext={linkContext}
        maxItems={maxItemsPerGroup}
      />
      <FindingGroup
        title='卖家精灵公开数据'
        hint='来自卖家精灵第三方估算数据（跨店铺可对比），与上面那组口径不同，请勿直接相加'
        items={external}
        linkContext={linkContext}
        maxItems={maxItemsPerGroup}
      />
      {findings.length === 0 && (
        <p className='max-w-3xl text-sm leading-relaxed text-muted-foreground'>
          本次没有触发任何预警线。
        </p>
      )}
    </>
  )
}

/**
 * 结果页专用的决策台：左侧只做问题选择，右侧集中展示当前问题的诊断与处置。
 * 这样用户不会在同一张卡里同时阅读多条完整建议，也不会把“需立即处理”当成静态标签。
 */
function DecisionDesk({
  findings,
  linkContext,
}: {
  findings: Finding[]
  linkContext?: FindingsLinkContext
}) {
  const sorted = sortByLevel(findings)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const selectedEntry = sorted
    .map((finding, index) => ({ finding, key: `${finding.title}-${index}` }))
    .find((entry) => entry.key === selectedKey)
  const selected = selectedEntry?.finding ?? sorted.find((finding) => finding.level !== 'info') ?? sorted[0] ?? null
  const actionableCount = sorted.filter((finding) => finding.level !== 'info').length
  const local = sorted.filter((finding) => finding.scope !== 'public')
  const external = sorted.filter((finding) => finding.scope === 'public')

  if (!selected) {
    return (
      <p className='text-sm leading-relaxed text-muted-foreground'>
        本次没有触发任何预警线。
      </p>
    )
  }

  return (
    <div className='grid gap-4 lg:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)]'>
      <div className='min-w-0 space-y-3'>
        <div>
          <p className='text-sm font-semibold'>待处理问题</p>
          <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>
            {actionableCount > 0
              ? `${actionableCount} 项需要处理，选择一项查看具体方案。`
              : '当前没有需要处理的问题。'}
          </p>
        </div>
        <div className='space-y-4'>
          <DecisionFindingGroup
            title='自家经营数据'
            items={local}
            selected={selected}
            onSelect={setSelectedKey}
          />
          <DecisionFindingGroup
            title='卖家精灵公开数据'
            items={external}
            selected={selected}
            onSelect={setSelectedKey}
          />
        </div>
      </div>

      <DecisionFindingPane finding={selected} linkContext={linkContext} />
    </div>
  )
}

function DecisionFindingGroup({
  title,
  items,
  selected,
  onSelect,
}: {
  title: string
  items: Finding[]
  selected: Finding
  onSelect: (key: string) => void
}) {
  if (items.length === 0) return null
  return (
    <section className='space-y-2'>
      <div className='flex items-center gap-2 text-xs font-medium text-muted-foreground'>
        <span>{title}</span>
        <Badge className='font-normal' variant='outline'>
          {items.length}
        </Badge>
      </div>
      <div className='space-y-1'>
        {items.map((finding, index) => {
          const key = `${finding.title}-${index}`
          const active = finding === selected
          return (
            <button
              aria-pressed={active}
              className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                active
                  ? 'border-primary/60 bg-primary/5'
                  : 'border-transparent hover:border-border hover:bg-muted/50'
              }`}
              key={key}
              type='button'
              onClick={() => onSelect(key)}
            >
              <span className='flex items-start gap-2'>
                <Badge
                  className='mt-0.5 shrink-0 whitespace-nowrap text-[11px]'
                  variant={FINDING_LEVEL_VARIANTS[finding.level]}
                >
                  {FINDING_LEVEL_LABELS[finding.level]}
                </Badge>
                <span className='min-w-0 text-sm font-medium leading-relaxed text-pretty'>
                  {finding.title}
                </span>
              </span>
              <span className='mt-1 block truncate pl-[4.5rem] text-xs text-muted-foreground'>
                {finding.detail}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function DecisionFindingPane({
  finding,
  linkContext,
}: {
  finding: Finding
  linkContext?: FindingsLinkContext
}) {
  const [showEvidence, setShowEvidence] = useState(false)
  const actionable = finding.level === 'high' || finding.level === 'medium'
  return (
    <section className='min-w-0 rounded-md border bg-card p-4 sm:p-5'>
      <div className='flex flex-wrap items-start justify-between gap-2 border-b pb-4'>
        <div className='min-w-0'>
          <p className='text-xs text-muted-foreground'>当前查看的问题</p>
          <h3 className='mt-1 text-base font-semibold leading-relaxed text-pretty'>
            {finding.title}
          </h3>
        </div>
        <Badge className='shrink-0 whitespace-nowrap' variant={FINDING_LEVEL_VARIANTS[finding.level]}>
          {FINDING_LEVEL_LABELS[finding.level]}
        </Badge>
      </div>

      <div className='mt-4 space-y-4'>
        <div className='rounded-md bg-muted/40 px-3 py-2.5'>
          <p className='text-xs font-medium text-muted-foreground'>发生了什么</p>
          <p className='mt-1 text-sm leading-relaxed text-pretty'>{finding.detail}</p>
        </div>

        {finding.fix ? (
          <FindingFixBlock context={linkContext} fix={finding.fix} />
        ) : (
          <div className='space-y-2 rounded-md border border-border/60 px-3 py-2.5'>
            <p className='text-xs font-medium text-muted-foreground'>处理建议</p>
            <p className='text-sm leading-relaxed text-pretty'>
              {finding.action ?? '请查看相关结果，确认触发该提示的具体指标后再处理。'}
            </p>
            {(actionable || finding.action) && <FallbackFindingLink context={linkContext} />}
          </div>
        )}

        <FindingDispositionBlock context={linkContext} finding={finding} />

        {actionable && (
          <div className='flex gap-2 border-t pt-3 text-xs leading-relaxed text-muted-foreground'>
            <span className='shrink-0 font-medium text-foreground'>完成条件</span>
            <span>
              改完点「标记已处理」，系统会在你下一次分析时自动核验：指标不再命中该规则即判定已解决，
              仍然命中会打回并说明本次的实际情况。
            </span>
          </div>
        )}

        {finding.evidence.length > 0 && (
          <div className='border-t pt-2'>
            <Button
              aria-expanded={showEvidence}
              className='h-7 gap-1 px-1.5 text-xs text-muted-foreground'
              size='sm'
              variant='ghost'
              onClick={() => setShowEvidence((current) => !current)}
            >
              {showEvidence ? <ChevronDown className='size-3.5' aria-hidden='true' /> : <ChevronRight className='size-3.5' aria-hidden='true' />}
              {showEvidence ? '收起依据' : `查看依据 ${finding.evidence.length} 条`}
            </Button>
            {showEvidence && (
              <ul className='mt-1 space-y-1 text-xs leading-relaxed text-muted-foreground'>
                {finding.evidence.map((item, index) => (
                  <li key={`${item}-${index}`}>· {item}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * 结论与建议（**带卡片外壳**，竞品详情页用）。
 *
 * 每一条都由服务端规则算出（预警线 / 环比恶化 / 驱动分解 / 组内对比 / 库存阈值 /
 * 公开数据的价格·评分·评论量·趋势·市场结构），这里只做展示：
 * `detail` 是事实（带可复算数字），`action` 是建议动作，`evidence` 是依据。
 * 页面不生成任何自己的判断文案，避免出现"界面比服务端更懂业务"的口径分裂。
 *
 * **按来源分组展示**（2026-09-16）：自家报表的结论与卖家精灵公开数据的结论
 * 放在两个分组里 —— 前者是本公司真实经营数据，后者是第三方估算数据，
 * 混在一列里用户没法判断哪条能直接拍板。
 *
 * `description` 可覆盖：竞品详情页传的是**筛选后的子集**（只留证据里点名该 ASIN 的结论），
 * 说明文字必须跟着变，否则用户会以为"这个竞品只有一条结论"。
 *
 * **排版口径（2026-09-17）**：① 正文一律 `max-w-3xl`（768px，65~75 字符的舒适行宽）
 * + `leading-relaxed` + `text-pretty` —— 改前整段横跨 1256px 卡片全宽；
 * ② 分组头是带 `border-b` 的区带（标题 + 计数 + 说明）；③ 徽章 `shrink-0 whitespace-nowrap`；
 * ④ 条目**不做成内层卡片**（左侧 2px 竖条 + 缩进，见 `FindingItem`）。
 * 只读检查与截图：`verify-artifacts/check-competitor-findings-layout.mjs`。
 */
export function FindingsPanel({
  findings,
  level,
  className = 'mb-6',
  description = '以下结论由服务端按预警线与数据规则算出，数字均可在下方明细中复核',
  linkContext,
}: FindingsPanelProps) {
  return (
    <Card className={className}>
      <CardHeader className='gap-1.5'>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1.5'>
          <CardTitle className='flex items-center gap-2 text-base'>
            <ListChecks className='size-4' aria-hidden='true' />
            结论与建议
          </CardTitle>
          <Badge
            className='shrink-0 whitespace-nowrap'
            variant={FINDING_LEVEL_VARIANTS[level]}
          >
            {FINDING_LEVEL_LABELS[level]}
          </Badge>
          <span className='shrink-0 whitespace-nowrap text-xs text-muted-foreground'>
            共 {findings.length} 条
          </span>
        </div>
        {/* 限宽：说明文字不再横跨整张卡片，长句按 65~75 字符的舒适行宽折行 */}
        <CardDescription className='max-w-3xl leading-relaxed text-pretty'>
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-6'>
        <FindingsSections findings={findings} linkContext={linkContext} />
      </CardContent>
    </Card>
  )
}

/**
 * 严重度权重。与服务端 `FINDING_WEIGHTS` 的分级语义一致，**只用于排序展示**，
 * 不改任何数据、也不改 level 本身（前端不做口径计算）。
 */
const LEVEL_WEIGHT: Record<FindingLevel, number> = {
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
}

/**
 * 组内按严重度排序（稳定排序：同级保持服务端给的顺序）。
 *
 * 2026-09-16 加：此前组内按服务端合并顺序铺开，"需立即处理"可能排在"低风险"后面，
 * 而这一页的主任务是**先看要动手的那几条**。
 */
function sortByLevel(items: Finding[]): Finding[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        LEVEL_WEIGHT[right.item.level] - LEVEL_WEIGHT[left.item.level] ||
        left.index - right.index
    )
    .map((entry) => entry.item)
}

function FindingGroup({
  title,
  hint,
  items,
  linkContext,
  maxItems,
}: {
  title: string
  hint: string
  items: Finding[]
  linkContext?: FindingsLinkContext
  maxItems?: number
}) {
  const [showInfo, setShowInfo] = useState(false)
  const [showMore, setShowMore] = useState(false)
  if (items.length === 0) return null

  const sorted = sortByLevel(items)
  // `info` 是"没有命中问题、只作说明"的一档（例如"未收录"提示）。它仍然要能查到，
  // 但不该与"需立即处理"抢同一屏 —— 默认收起，显式展开。
  const actionable = sorted.filter((finding) => finding.level !== 'info')
  const infoItems = sorted.filter((finding) => finding.level === 'info')
  const visibleActionable =
    maxItems && !showMore ? actionable.slice(0, maxItems) : actionable
  const hiddenActionableCount = maxItems
    ? Math.max(0, actionable.length - maxItems)
    : 0

  return (
    <section className='space-y-3'>
      {/*
        分组头：标题 + 计数 + 说明合成一个"区带"，并用一条分隔线把它与上一组切开。
        改前只有「标题 + 徽章」一行紧接说明一行，两组之间没有任何视觉边界，
        整块读起来是一片连续文字。
      */}
      <div className='space-y-1 border-b border-border/60 pb-2'>
        <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
          <h3 className='text-sm font-semibold'>{title}</h3>
          <Badge
            className='shrink-0 whitespace-nowrap font-normal'
            variant='outline'
          >
            {items.length} 条
          </Badge>
        </div>
        <p className='max-w-3xl text-xs leading-relaxed text-muted-foreground text-pretty'>
          {hint}
        </p>
      </div>
      {actionable.length > 0 ? (
        <ul className='space-y-4'>
          {visibleActionable.map((finding, index) => (
            <FindingItem
                finding={finding}
                key={`${finding.title}-${index}`}
                linkContext={linkContext}
              />
          ))}
        </ul>
      ) : (
        <p className='max-w-3xl text-sm leading-relaxed text-muted-foreground'>
          这一组没有需要处理的问题。
        </p>
      )}

      {hiddenActionableCount > 0 && (
        <Button
          aria-expanded={showMore}
          className='h-7 gap-1 px-2 text-xs text-muted-foreground'
          size='sm'
          variant='ghost'
          onClick={() => setShowMore((current) => !current)}
        >
          {showMore ? (
            <ChevronDown className='size-3.5' aria-hidden='true' />
          ) : (
            <ChevronRight className='size-3.5' aria-hidden='true' />
          )}
          {showMore ? '收起结论' : `展开其余 ${hiddenActionableCount} 条`}
        </Button>
      )}

      {infoItems.length > 0 && (
        <div className='space-y-2'>
          <Button
            aria-expanded={showInfo}
            className='h-7 gap-1 px-2 text-xs text-muted-foreground'
            size='sm'
            variant='ghost'
            onClick={() => setShowInfo((current) => !current)}
          >
            {showInfo ? (
              <ChevronDown className='size-3.5' aria-hidden='true' />
            ) : (
              <ChevronRight className='size-3.5' aria-hidden='true' />
            )}
            提示级结论 {infoItems.length} 条
          </Button>
          {showInfo && (
            <ul className='space-y-4'>
              {infoItems.map((finding, index) => (
                <FindingItem
                finding={finding}
                key={`${finding.title}-${index}`}
                linkContext={linkContext}
              />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * 单条结论：徽章 + 标题 + 事实（detail）+ 建议动作（action）+ 依据（evidence，**默认折叠**）。
 *
 * 依据默认收起（2026-09-16，用户口径「主次分明」并选定这一档）：`evidence` 是可复算的原始数字，
 * 属于"要核对时再看"的层，直接铺开会把每条结论撑成 4~5 行（实测 3 条结论 540px）。
 * 判定 / 标题 / 事实 / 建议动作留在明面，依据一次点击即可展开，不牺牲可追溯性。
 */
/**
 * 结论的处置入口上下文。
 *
 * 服务端给的入口路径里**不含 `analysisId`**（分析当时还没落库、拿不到 id），也拿不到类目关键词
 * —— 因此由页面把当前上下文传进来，渲染时补上；补不上的入口**不渲染**（不给点进去查不到东西的按钮）。
 */
export interface FindingsLinkContext {
  analysisId?: number
  keyword?: string | null
  marketplace?: string | null
}

/**
 * 「处理什么 / 去哪里处理 / 怎么处理」——一条结论的处置方案（2026-09-17）。
 *
 * 用户口径：「需立即处理没有任何交互，继续处理是处理什么、如何处理、去哪里处理都没有」。
 * 三段固定：① 处理什么（`what`）；② 去哪里处理（`links` → 系统内真实路由的按钮，
 * `adminOnly` 的入口普通员工看不到）；③ 怎么处理（`offSystem` → 只能在亚马逊后台/线下做的步骤，
 * 明确标「系统外」，本系统负责发现与核对、不代替操作）。**不给假链接**。
 */
function FindingFixBlock({
  fix,
  context = {},
}: {
  fix: FindingFix
  context?: FindingsLinkContext
}) {
  const [showSteps, setShowSteps] = useState(false)
  const role = useAuthStore((state) => state.auth.user?.role ?? [])
  const isAdmin = role.includes('admin')
  const links = (fix.links ?? []).filter((link) => {
    if (link.adminOnly && !isAdmin) return false
    // 市场调研需要类目关键词：页面没算出关键词时不给这个按钮（点进去是空查询）
    if (link.to === '/product-dev/market' && !context.keyword) return false
    return true
  })
  const steps = fix.offSystem ?? []

  return (
    <div className='mt-3 max-w-3xl space-y-2.5 rounded-md border border-border/60 bg-muted/50 px-3 py-2.5'>
      {fix.what && (
        <p className='flex gap-2 text-sm leading-relaxed text-pretty'>
          <Wrench
            className='mt-0.5 size-4 shrink-0 text-muted-foreground'
            aria-hidden='true'
          />
          <span>
            <span className='font-medium'>处理什么：</span>
            {fix.what}
          </span>
        </p>
      )}

      {steps.length > 0 && (
        <div className='flex gap-2'>
          {/* 占位与上一行的图标同宽，让三段左对齐 */}
          <span className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
          <div className='min-w-0 space-y-1'>
            <Button
              aria-expanded={showSteps}
              className='h-7 gap-1 px-0 text-xs text-muted-foreground'
              size='sm'
              variant='ghost'
              onClick={() => setShowSteps((current) => !current)}
            >
              {showSteps ? (
                <ChevronDown className='size-3.5' aria-hidden='true' />
              ) : (
                <ChevronRight className='size-3.5' aria-hidden='true' />
              )}
              查看处理步骤
              <Badge
                className='ml-1.5 shrink-0 font-normal'
                variant='outline'
                title='这些步骤只能在亚马逊卖家后台 / 广告后台 / 线下完成，本系统负责发现与核对'
              >
                系统外
              </Badge>
            </Button>
            {showSteps && (
              <ol className='list-decimal space-y-1 pl-4 text-sm leading-relaxed text-pretty'>
                {steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}

      {links.length > 0 && (
        <div className='flex flex-wrap items-center gap-2'>
          <span className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
          <span className='text-xs font-medium text-muted-foreground'>
            去哪里处理：
          </span>
          {links.map((link) => (
            <FixLinkButton
              context={context}
              key={`${link.to}-${link.label}`}
              link={link}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** 处置状态的展示口径（标签 + 语义色，颜色只用主题变量）。 */
const DISPOSITION_LABELS: Record<FindingDispositionStatus, string> = {
  open: '仍命中',
  claimed: '待核验',
  verified: '已核验解决',
  ignored: '已忽略',
}

const DISPOSITION_VARIANTS: Record<
  FindingDispositionStatus,
  'secondary' | 'destructive' | 'outline'
> = {
  open: 'destructive',
  claimed: 'secondary',
  verified: 'secondary',
  ignored: 'outline',
}

/**
 * 处置闭环（2026-09-17）：把「需立即处理」从静态标签变成**有回执、可核验**的待办。
 *
 * 用户口径：「用户修改完成后回到系统调整为修改完成」。因此这里是**两段式**：
 * 用户点「标记已处理」只是**销账**（状态 `claimed`），真正的"已完成"由**下一次分析**判定
 * —— 该结论不再命中即 `verified`（已核验解决）；仍然命中会被自动打回，并在这里如实显示
 * 「本次仍命中的事实」。
 *
 * 为什么不直接"点一下就完成"：结论是每次分析用当期数据重算的，点一下只代表用户的话，
 * 不代表数据变了。有了核验，首页的「需立即处理」才敢跟着销账一起降下去。
 *
 * 四个按钮**都是真动作**：写台账（失败原因原样显示）、复制系统外步骤去贴群/工单、
 * 去任务中心让服务端后台跑。**没有一个是"点了没反应"的假按钮。**
 *
 * 只有服务端给了 `code` + `dispositionTarget` 的结论才可销账；老快照（09-17 之前）
 * 两者都没有，这里整块不渲染（那类结论仍走 `FindingFixBlock` 的文字建议回退）。
 */
function FindingDispositionBlock({
  finding,
  context = {},
}: {
  finding: Finding
  context?: FindingsLinkContext
}) {
  const analysisId = context.analysisId
  const code = finding.code
  const target = finding.dispositionTarget
  // 缺任何一个都组不出台账唯一键（服务端会按"不属于该次分析"拒绝），因此整块不渲染
  if (!analysisId || !code || !target) return null
  return (
    <DispositionActions
      analysisId={analysisId}
      code={code}
      disposition={finding.disposition ?? null}
      finding={finding}
      target={target}
    />
  )
}

function DispositionActions({
  analysisId,
  code,
  target,
  finding,
  disposition,
}: {
  analysisId: number
  code: string
  target: string
  finding: Finding
  disposition: FindingDisposition | null
}) {
  const queryClient = useQueryClient()
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // 复制成功的回执 2 秒后自动收掉（组件卸载时清掉计时器，避免对已卸载组件 setState）
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  /*
   * 标记成功后要把所有"看得到这条结论"的缓存都失效：结果页快照、最近一次分析、
   * 竞品详情页按 ASIN 的回落、竞品分析历史列表，以及首页那份 limit=20 的记录 ——
   * 少失效一个就会出现"这里已销账、那里还在报警"。
   */
  function invalidate() {
    for (const queryKey of [
      ['competitor-analysis-snapshot'],
      ['competitor-analysis-latest'],
      ['competitor-analysis-latest-for-asin'],
      ['competitor-analyses'],
      ['dashboard', 'recent-analyses'],
    ]) {
      void queryClient.invalidateQueries({ queryKey })
    }
  }

  const markClaimed = useMutation({
    mutationFn: () => setFindingDisposition({ analysisId, code, target, status: 'claimed' }),
    onSuccess: () => {
      setFeedback(null)
      invalidate()
    },
    onError: (error) => setFeedback(apiErrorMessage(error, '标记失败，请稍后重试。')),
  })

  const markIgnored = useMutation({
    mutationFn: () => setFindingDisposition({ analysisId, code, target, status: 'ignored', note }),
    onSuccess: () => {
      setNoteOpen(false)
      setNote('')
      setFeedback(null)
      invalidate()
    },
    onError: (error) => setFeedback(apiErrorMessage(error, '标记失败，请稍后重试。')),
  })

  const undo = useMutation({
    mutationFn: () => clearFindingDisposition({ analysisId, code, target }),
    onSuccess: () => {
      setFeedback(null)
      invalidate()
    },
    onError: (error) => setFeedback(apiErrorMessage(error, '撤销失败，请稍后重试。')),
  })

  const busy = markClaimed.isPending || markIgnored.isPending || undo.isPending
  const status = disposition?.status ?? null
  /** 已处理 / 已忽略 / 仍命中都还能再操作一次；只有"待核验"与"已核验"给的是不同动作。 */
  const pending = status === null || status === 'open'
  const steps = finding.fix?.offSystem ?? []

  async function copySteps() {
    const lines: string[] = []
    if (finding.fix?.what) lines.push(`处理什么：${finding.fix.what}`)
    if (steps.length > 0) lines.push(...steps.map((step, index) => `${index + 1}. ${step}`))
    if (lines.length === 0) lines.push(finding.action ?? finding.title)
    lines.push(`（来自竞品分析结论：${finding.title}）`)
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopied(true)
      setFeedback(null)
    } catch {
      // 剪贴板权限被拒不是"复制成功"，必须如实说，否则用户会去粘贴一段空的
      setFeedback('复制失败：浏览器拒绝了剪贴板访问，请手动选中文本复制。')
    }
  }

  return (
    <div
      className='mt-2 max-w-3xl space-y-2 rounded-md border border-border/60 px-3 py-2'
      data-finding-disposition
    >
      {/*
        老快照（处置功能上线前落库）的结论没有诊断码，服务端派生了记录内位置键 ——
        可以手动销账，但**不会**参与下次分析的自动核验。必须在按钮上方就说清楚，
        否则用户点完会以为"下次分析会替我确认"，而系统根本认不出这条结论。
      */}
      {finding.legacy && (
        <p className='text-xs leading-relaxed text-muted-foreground'>
          这条结论来自处置功能上线前的历史快照，没有诊断码：可以在这里手动销账，
          但系统不会在下次分析时自动核验它（想要自动核验，请用同参数重新分析一次）。
        </p>
      )}

      {disposition && <DispositionStatus disposition={disposition} />}

      {noteOpen ? (
        <div className='space-y-2'>
          <label
            className='block text-xs font-medium text-muted-foreground'
            htmlFor={`disposition-note-${code}-${target}`}
          >
            为什么这条不需要处理？会记进台账，之后系统不再核验也不再报警。
          </label>
          <Textarea
            className='min-h-16 text-sm'
            id={`disposition-note-${code}-${target}`}
            placeholder='例如：该 ASIN 本季已决定清库，不再投入广告预算'
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              data-finding-ignore-confirm
              disabled={!note.trim() || markIgnored.isPending}
              size='sm'
              variant='outline'
              onClick={() => markIgnored.mutate()}
            >
              {markIgnored.isPending ? '提交中…' : '确认不处理'}
            </Button>
            <Button
              size='sm'
              variant='ghost'
              onClick={() => {
                setNoteOpen(false)
                setNote('')
              }}
            >
              取消
            </Button>
          </div>
        </div>
      ) : (
        <div className='flex flex-wrap items-center gap-2'>
          {pending && (
            <Button
              data-finding-claim
              disabled={busy}
              size='sm'
              variant='outline'
              onClick={() => markClaimed.mutate()}
            >
              <CircleCheck aria-hidden='true' className='size-3.5' />
              {markClaimed.isPending ? '提交中…' : '标记已处理'}
            </Button>
          )}
          {pending && (
            <Button
              data-finding-ignore
              disabled={busy}
              size='sm'
              variant='ghost'
              onClick={() => setNoteOpen(true)}
            >
              <CircleSlash aria-hidden='true' className='size-3.5' />
              不处理
            </Button>
          )}
          <Button
            data-finding-copy
            disabled={busy}
            size='sm'
            variant='ghost'
            onClick={() => void copySteps()}
          >
            {copied ? (
              <Check aria-hidden='true' className='size-3.5' />
            ) : (
              <ClipboardCopy aria-hidden='true' className='size-3.5' />
            )}
            {copied ? '已复制' : '复制处理步骤'}
          </Button>
          {(status === 'claimed' || status === 'ignored') && (
            <Button
              data-finding-undo
              disabled={busy}
              size='sm'
              variant='ghost'
              onClick={() => undo.mutate()}
            >
              <RotateCcw aria-hidden='true' className='size-3.5' />
              撤销标记
            </Button>
          )}
        </div>
      )}

      {feedback && (
        <p className='text-xs leading-relaxed text-destructive' role='alert'>
          {feedback}
        </p>
      )}
    </div>
  )
}

/** 台账状态那一行：徽章 + 一句"这意味着什么"（口径必须写在界面上）。 */
function DispositionStatus({ disposition }: { disposition: FindingDisposition }) {
  const status = disposition.status
  return (
    <div className='space-y-1'>
      <div className='flex flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
        <Badge
          className='shrink-0 whitespace-nowrap'
          variant={DISPOSITION_VARIANTS[status]}
        >
          {DISPOSITION_LABELS[status]}
        </Badge>
        {status === 'claimed' && (
          <span className='text-muted-foreground'>
            你已标记处理完成{disposition.claimedAt ? `（${formatDateTime(disposition.claimedAt)}）` : ''}
            ，下一次分析会自动核验。
          </span>
        )}
        {status === 'verified' && (
          <span className='text-muted-foreground'>
            后续分析里这条结论没有再命中，系统判定已解决
            {disposition.verifiedAt ? `（${formatDateTime(disposition.verifiedAt)}）` : ''}。
          </span>
        )}
        {status === 'ignored' && (
          <span className='text-muted-foreground'>
            已选择不处理，系统不再核验这条{disposition.note ? `：${disposition.note}` : ''}
          </span>
        )}
        {status === 'open' && (
          <span className='text-muted-foreground'>
            你标记过已处理，但后续分析仍然命中
            {disposition.reopenCount > 1 ? `（第 ${disposition.reopenCount} 次）` : ''}。
          </span>
        )}
      </div>
      {status === 'open' && disposition.verifyDetail && (
        <p className='text-xs leading-relaxed text-destructive'>
          本次仍命中的事实：{disposition.verifyDetail}
        </p>
      )}
    </div>
  )
}

/**
 * 站内入口白名单：服务端给的是字符串路径，这里**按字面量路由**查表渲染。
 *
 * 两个作用：① TanStack 的 `Link` 类型要求字面量路径，动态字符串过不了类型检查；
 * ② **查不到就不渲染按钮** —— 服务端哪天写错一个路径，界面上不会出现一个点进去 404 的入口
 * （这是"不给假链接"这条口径的硬保证）。
 */
const FIX_ROUTES = {
  '/competitor-analysis': '/competitor-analysis',
  '/competitor-analysis/results': '/competitor-analysis/results',
  '/asin-watchlists/items': '/asin-watchlists/items',
  '/product-dev': '/product-dev',
  '/product-dev/market': '/product-dev/market',
  '/admin/ai/datasources': '/admin/ai/datasources',
} as const

/** 「去哪里处理」的一个入口按钮。 */
function FixLinkButton({
  link,
  context,
}: {
  link: FindingFix['links'][number]
  context: FindingsLinkContext
}) {
  const className = 'h-7 gap-1 px-2 text-xs'
  const label = (
    <>
      {link.label}
      <ArrowUpRight className='size-3.5' aria-hidden='true' />
    </>
  )

  // 竞品详情是站内唯一的动态路由：它的 `params` 与 `search` 都在这里显式给出
  if (link.to === '/competitor-analysis/$asin') {
    const asin = String(link.params?.asin ?? '')
    if (!asin) return null
    return (
      <Button asChild className={className} size='sm' variant='outline'>
        <Link
          params={{ asin }}
          search={context.analysisId ? { analysisId: context.analysisId } : {}}
          to='/competitor-analysis/$asin'
        >
          {label}
        </Link>
      </Button>
    )
  }

  const to = FIX_ROUTES[link.to as keyof typeof FIX_ROUTES]
  if (!to) return null

  const search =
    to === '/competitor-analysis/results' && context.analysisId
      ? { analysisId: context.analysisId }
      : to === '/product-dev/market'
        ? {
            keyword: context.keyword ?? undefined,
            marketplace: context.marketplace ?? undefined,
          }
        : {}

  return (
    <Button asChild className={className} size='sm' variant='outline'>
      <Link search={search} to={to}>
        {label}
      </Link>
    </Button>
  )
}

function FindingItem({
  finding,
  linkContext,
}: {
  finding: Finding
  /** 处置入口需要的页面上下文（补 analysisId / 类目关键词）。 */
  linkContext?: FindingsLinkContext
}) {
  const [showEvidence, setShowEvidence] = useState(false)
  return (
    /*
     * **不做成内层卡片**（2026-09-17，用户口径「多层级卡片布局不利于阅读」）：
     * 改前每条结论是 `rounded-lg border p-4` —— 外层「结论与建议」卡里再套一圈带边框的小卡，
     * 读起来是"卡片里还有卡片"。现在改成**左侧 2px 严重度竖条 + 缩进**（引用式列表）：
     * 一条结论的边界由竖条给出，`high` 用红竖条、其余用中性竖条，
     * 层级只剩"卡片 → 分组 → 条目（无边框）"。
     */
    <li
      className={`border-l-2 pl-4 ${
        finding.level === 'high' ? 'border-l-destructive' : 'border-l-border'
      }`}
    >
      {/*
        标题不再与徽章挤在同一基线：徽章 `shrink-0` 且不换行，标题按 65~75 字符
        的舒适行宽（`max-w-3xl`）折行，长标题不会把徽章挤成两行、也不会横跨整卡片。
      */}
      <div className='flex flex-wrap items-start gap-x-2 gap-y-1.5'>
        <Badge
          className='shrink-0 whitespace-nowrap'
          variant={FINDING_LEVEL_VARIANTS[finding.level]}
        >
          {FINDING_LEVEL_LABELS[finding.level]}
        </Badge>
        <p className='max-w-3xl text-sm font-medium leading-relaxed text-pretty'>
          {finding.title}
        </p>
      </div>
      <p className='mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground text-pretty'>
        {finding.detail}
      </p>
      {finding.fix ? (
        <FindingFixBlock context={linkContext} fix={finding.fix} />
      ) : (
        (finding.action || finding.level === 'high' || finding.level === 'medium') && (
          <div className='mt-3 max-w-3xl space-y-2 rounded-md border border-border/60 bg-muted/60 px-3 py-2'>
            <div className='flex gap-2'>
              <Lightbulb
                className='mt-0.5 size-4 shrink-0 text-muted-foreground'
                aria-hidden='true'
              />
              <p className='text-sm leading-relaxed text-pretty'>
                <span className='font-medium'>建议：</span>
                {finding.action ?? '请先查看相关结果，确认触发该提示的具体指标，再按明细中的数据处理。'}
              </p>
            </div>
            <div className='flex flex-wrap items-center gap-2 pl-6'>
              <FallbackFindingLink context={linkContext} />
              {(finding.level === 'high' || finding.level === 'medium') && (
                <span className='text-xs text-muted-foreground'>
                  改完点「标记已处理」，下一次分析会自动核验是否真的解决了。
                </span>
              )}
            </div>
          </div>
        )
      )}
      <FindingDispositionBlock context={linkContext} finding={finding} />
      {finding.evidence.length > 0 && (
        <div className='mt-2'>
          <Button
            aria-expanded={showEvidence}
            className='-ml-1.5 h-7 gap-1 px-1.5 text-xs text-muted-foreground'
            size='sm'
            variant='ghost'
            onClick={() => setShowEvidence((current) => !current)}
          >
            {showEvidence ? (
              <ChevronDown className='size-3.5' aria-hidden='true' />
            ) : (
              <ChevronRight className='size-3.5' aria-hidden='true' />
            )}
            依据 {finding.evidence.length} 条
          </Button>
          {showEvidence && (
            <ul className='mt-1 max-w-3xl space-y-1 text-xs leading-relaxed text-muted-foreground'>
              {finding.evidence.map((item, index) => (
                <li key={`${item}-${index}`}>· {item}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

/** 老快照没有结构化 fix 时仍提供一个真实可达的复核入口。 */
function FallbackFindingLink({
  context,
}: {
  context?: FindingsLinkContext
}) {
  const to = context?.analysisId
    ? '/competitor-analysis/results'
    : '/competitor-analysis'
  const search = context?.analysisId
    ? { analysisId: context.analysisId }
    : {}

  return (
    <Button asChild className='h-7 gap-1 px-2 text-xs' size='sm' variant='outline'>
      <Link search={search} to={to}>
        查看相关结果
        <ArrowUpRight className='size-3.5' aria-hidden='true' />
      </Link>
    </Button>
  )
}

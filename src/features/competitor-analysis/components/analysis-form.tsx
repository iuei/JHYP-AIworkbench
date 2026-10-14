import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { DatePicker } from '@/components/date-picker'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  COMPARE_OPTIONS,
  MARKETPLACE_OPTIONS,
  PUBLIC_DIMENSION_OPTIONS,
  WINDOW_OPTIONS,
  countAsins,
  estimatePublicCalls,
  toDateInputValue,
} from '../format'
import type { AnalysisFormValues, PublicDimension } from '../types'

type AnalysisFormProps = {
  pending: boolean
  onSubmit: (values: AnalysisFormValues) => void
  /** 从首页「新建分析」进来时为 true：进场即聚焦 ASIN 输入框。 */
  autoFocusAsin?: boolean
  /**
   * 提交按钮文案。默认是竞品分析页面的「开始分析」；
   * 任务中心在弹窗里复用这张表单时改成「提交任务」—— 用户在那一页的动作是"提交一个后台任务"，
   * 说成"分析"会让人以为要留在这一页等结果。
   */
  submitLabel?: string
  pendingLabel?: string
  /**
   * 调用次数上限：预估超过它时禁用提交并说明原因。
   * 任务中心用它守住「单任务上限」（卖家精灵按次计费），竞品分析页面不传 = 不设限。
   * 这是**界面提示**，真正的拦截仍在服务端（绕过前端直接打接口同样会被 400 拒绝）。
   */
  callLimit?: number
  /** 外层 Card 的类名（弹窗里传 `mb-0` 去掉底部间距）。 */
  className?: string
}

/**
 * 分析参数表单。
 *
 * ASIN 输入是**一个多行文本框**：一行一个（或逗号分隔），**第一个视为本品**，其余为对比对象 ——
 * 这个约定写在 Label 上，因为服务端就按输入顺序分组，前端不另立一套语义。
 *
 * 2026-09-16 曾按用户选择改成"本品一行 + 竞品可增删行"的角色化输入，同日**按用户要求撤回**
 * （用户口径：「输入框调整回之前那样 不使用逗号分割 使用换行分割即可」→ 确认回到单框，
 * 换行与逗号都照旧可用）。因此不要在这里重新引入角色化的输入结构。
 */
export function AnalysisForm({
  pending,
  onSubmit,
  autoFocusAsin = false,
  submitLabel = '开始分析',
  pendingLabel = '分析中…',
  callLimit,
  className,
}: AnalysisFormProps) {
  const asinRef = useRef<HTMLTextAreaElement>(null)
  const [asin, setAsin] = useState('')
  const [marketplace, setMarketplace] = useState('auto')
  const [windowKey, setWindowKey] = useState('30')
  const [startDate, setStartDate] = useState<Date | undefined>(undefined)
  const [endDate, setEndDate] = useState<Date | undefined>(undefined)
  const [compareWith, setCompareWith] = useState('previous_period')
  /**
   * 公开数据维度默认勾「商品公开数据」：它是"竞品分析能真正对比竞品"的前提
   * （本地报表里根本没有第三方 ASIN 的数据）。默认不勾其余三个维度 —— 它们各自要额外调用，
   * 且用户不一定每次都需要。首次拉取后 24 小时内走缓存，重复分析不消耗额度。
   */
  const [dimensions, setDimensions] = useState<PublicDimension[]>(['public'])
  const [refreshPublic, setRefreshPublic] = useState(false)
  /** 用户动过 ASIN 框之后才提示"请填写" —— 一进页面就顶着一行红字是噪音。 */
  const [asinTouched, setAsinTouched] = useState(false)

  const isCustom = windowKey === 'custom'
  const customReady = Boolean(startDate && endDate)
  const asinCount = countAsins(asin)
  /**
   * 额度按角色**分项**展示：卖家精灵按调用次数计费，用户有权在点「开始分析」前
   * 看清"本品花几次、竞品各花几次"，而不是只看一个总数。
   * 输入框仍是"第 1 个是本品"，所以本品恒为 1 个、其余算竞品；没填时按 1 个 ASIN 预估
   * （与改动前的预估口径一致，避免空表单显示 0 次）。
   */
  const estimatedCount = Math.max(1, asinCount)
  const callsPerAsin = estimatePublicCalls(dimensions, 1)
  const primaryCalls = callsPerAsin
  const competitorCount = estimatedCount - 1
  const estimatedCalls = estimatedCount * callsPerAsin
  const rangeError =
    isCustom && !customReady
      ? '自定义区间需要同时选择开始与结束日期（最长 366 天）。'
      : null
  const missingAsin = asin.trim().length === 0
  /** 超出调用上限（只有调用方传了 `callLimit` 才可能发生）。 */
  const overLimit = callLimit !== undefined && estimatedCalls > callLimit
  const canSubmit = !missingAsin && rangeError === null && !pending && !overLimit
  /** 按钮为什么点不动：把原因写出来（此前只是把按钮变灰，用户不知道还要改哪里）。 */
  const asinBlocker = missingAsin && asinTouched ? '请输入要分析的 ASIN。' : null
  const limitBlocker = overLimit
    ? `预估 ${estimatedCalls} 次卖家精灵调用，超过单任务上限 ${callLimit} 次。请减少 ASIN 数量或公开数据维度后再提交（可以分批提交）。`
    : null
  const disabledReason = pending ? null : (asinBlocker ?? rangeError ?? limitBlocker)

  // 首页「新建分析」深链进来时聚焦输入框：落页即可输入，不用再点一次
  useEffect(() => {
    if (autoFocusAsin) asinRef.current?.focus()
  }, [autoFocusAsin])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    onSubmit({
      inputValue: asin.trim(),
      marketplace: marketplace === 'auto' ? null : marketplace,
      windowDays: isCustom ? null : Number(windowKey),
      startDate: isCustom ? toDateInputValue(startDate) : null,
      endDate: isCustom ? toDateInputValue(endDate) : null,
      compareWith: compareWith as AnalysisFormValues['compareWith'],
      dimensions,
      refreshPublic,
    })
  }

  return (
    <Card className={cn('mb-6', className)}>
      <CardContent className='pt-6'>
        <form className='space-y-4' onSubmit={handleSubmit}>
          {/* ASIN 输入区（单框多值，第一个视为本品） */}
          <div className='space-y-2'>
            <Label htmlFor='competitor-asin'>
              ASIN（第一个视为本品，其余作为竞品对比）
            </Label>
            <Textarea
              id='competitor-asin'
              ref={asinRef}
              value={asin}
              onChange={(event) => {
                setAsin(event.target.value)
                setAsinTouched(true)
              }}
              placeholder={'例如：B0C1D2E3F4\nB0C5D6E7F8\n也可粘贴亚马逊商品链接'}
              rows={2}
              autoComplete='off'
              spellCheck={false}
            />
            <p className='text-xs text-muted-foreground'>
              多个 ASIN 一行一个（换行）或逗号、顿号分隔，最多 5 个；支持粘贴 /dp/、/d/、/gp/product/ 链接。
              {asinCount === 1 && (
                <> 当前只识别出 1 个 ASIN：本次只分析本品，结果里不会有对比对象。</>
              )}
            </p>
          </div>

          {/*
            站点 / 对比基线 / 统计区间**压缩到同一行**（用户口径：「站点 对比基线 统计区间
            缩减宽度并压缩到同一行」）：三者都是"选一次"的参数，此前统计区间被 `lg:col-span-3`
            顶到整行独占，一行只放下两个下拉，白占半屏。
            现在 `lg` 起一行三列，且**站点/对比基线按内容给足即止**（各 12rem，此前各自撑满
            1/3 的 380px 空框），统计区间吃掉剩余宽度 —— 6 个预设仍排得下。
            `lg` 以下单列堆叠（窄屏并排必然溢出），TabsList 保留 `flex-wrap` 兜底折行。
          */}
          <div className='grid gap-3 lg:grid-cols-[12rem_12rem_minmax(0,1fr)]'>
            {/*
              这里用基础 Select：早期封装的 SelectDropdown 把 SelectTrigger 包在 FormControl 里，
              依赖 react-hook-form 的 FormField 上下文，脱离 <Form> 使用会在渲染时抛
              「useFormContext(...) is null」并让整页白屏（UI 验证实测），该组件已删除。本页表单不需要 RHF
              的校验能力（校验口径统一由服务端给出中文原因），因此直接用受控 Select。
            */}
            <div className='space-y-2'>
              <Label>站点</Label>
              <Select value={marketplace} onValueChange={setMarketplace}>
                <SelectTrigger className='w-full' aria-label='站点'>
                  <SelectValue placeholder='选择站点' />
                </SelectTrigger>
                <SelectContent>
                  {MARKETPLACE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className='space-y-2'>
              <Label>对比基线</Label>
              <Select value={compareWith} onValueChange={setCompareWith}>
                <SelectTrigger className='w-full' aria-label='对比基线'>
                  <SelectValue placeholder='选择对比基线' />
                </SelectTrigger>
                <SelectContent>
                  {COMPARE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/*
              统计区间与另外两项同行（`minmax(0,1fr)` 吃掉剩余宽度），因此不再需要
              `col-span` 撑整行。`h-auto + flex-wrap + max-w-full` 保留：预设已有 6 个
              （2026-09-16 增加「半年 / 一年」），窗口一窄就折行，而不是把页面撑出横向滚动。
            */}
            <div className='space-y-2'>
              <Label>统计区间</Label>
              <Tabs value={windowKey} onValueChange={setWindowKey}>
                <TabsList className='h-auto max-w-full flex-wrap'>
                  {WINDOW_OPTIONS.map((option) => (
                    <TabsTrigger
                      key={option.value}
                      value={option.value}
                      className='h-8'
                    >
                      {option.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </div>

          {isCustom && (
            <div className='flex flex-wrap items-end gap-3'>
              <div className='space-y-2'>
                <Label>开始日期</Label>
                <DatePicker selected={startDate} onSelect={setStartDate} placeholder='开始日期' />
              </div>
              <div className='space-y-2'>
                <Label>结束日期</Label>
                <DatePicker selected={endDate} onSelect={setEndDate} placeholder='结束日期' />
              </div>
              {/*
                日期未选齐时**不在这里提醒**：原因统一显示在开始分析按钮下方
                （见 `disabledReason`），同一句话在页面上出现两遍反而让人怀疑是不是两件事。
              */}
            </div>
          )}

          <div className='space-y-2'>
            <Label>竞品公开数据（卖家精灵）</Label>
            {/*
              三个维度**压缩到同一行**（同一用户口径）：此前 `sm:grid-cols-2` 让第三个选项
              单独换行，且每张卡撑到半行宽 —— 一行三张卡、每张约 1/3 宽，扫一眼就能把三个
              维度和各自的额度含义看完。卡片变窄后内边距同步收紧（p-3 → p-2.5），
              `min-w-0` 保证 hint 文本在窄卡里正常换行而不是撑破卡片。
            */}
            <div className='grid gap-2 sm:grid-cols-3'>
              {PUBLIC_DIMENSION_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className='flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm'
                >
                  <Checkbox
                    className='mt-0.5 shrink-0'
                    checked={dimensions.includes(option.value)}
                    onCheckedChange={(checked) =>
                      setDimensions((current) =>
                        checked
                          ? [...current, option.value]
                          : current.filter((item) => item !== option.value)
                      )
                    }
                  />
                  <span className='min-w-0 space-y-0.5'>
                    <span className='block font-medium leading-tight'>{option.label}</span>
                    <span className='block text-xs leading-snug text-muted-foreground'>
                      {option.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {/*
              额度**分项**展示：只说一个总数的话，用户看不出"多加一个竞品要多花几次调用"。
              数字口径与 `estimatePublicCalls` 一致，真实消耗仍以结果里的 `publicData.calls` 为准。
            */}
            <p className='text-xs text-muted-foreground'>
              {dimensions.length === 0 ? (
                <>当前未勾选任何公开数据维度，本次分析不会消耗卖家精灵额度。</>
              ) : (
                <>
                  卖家精灵按<b>调用次数</b>计费：本品 <b>{primaryCalls}</b> 次
                  {competitorCount > 0 ? (
                    <>
                      {' '}
                      + 竞品 <b>{competitorCount}</b> 个 × <b>{callsPerAsin}</b> 次
                    </>
                  ) : null}{' '}
                  ＝ 预估 <b>{estimatedCalls}</b> 次调用；同一 ASIN 在 24 小时内已拉取过则走缓存、
                  <b>不消耗额度</b>（结果里会显示实际消耗）。
                </>
              )}
            </p>
            {dimensions.length > 0 && (
              <label className='flex cursor-pointer items-center gap-2 text-xs text-muted-foreground'>
                <Checkbox
                  checked={refreshPublic}
                  onCheckedChange={(checked) => setRefreshPublic(checked === true)}
                />
                忽略缓存重新拉取（用于确认最新数据，会正常消耗额度）
              </label>
            )}
          </div>

          <div className='space-y-2'>
            <div className='flex flex-wrap items-center gap-3'>
              <Button type='submit' disabled={!canSubmit}>
                <Search aria-hidden='true' />
                {pending ? pendingLabel : submitLabel}
              </Button>
              <p className='text-xs text-muted-foreground'>
                分析基于已导入的 Amazon 广告日报与业务报告，数据为人工导出后导入，非实时数据；
                未指定站点与区间时按本品最新数据自动推导。
              </p>
            </div>
            {/*
              按钮为什么不能点：此前只是把按钮变灰，用户不知道是本品没填、ASIN 写错还是日期没选齐。
              `data-form-blocker` 供端到端脚本断言"禁用时一定有原因文案"。
            */}
            {disabledReason && (
              <p className='text-xs text-destructive' data-form-blocker>
                {disabledReason}
              </p>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

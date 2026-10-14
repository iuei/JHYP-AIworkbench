import {
  CalendarRange,
  Download,
  FileSpreadsheet,
  Loader2,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import {
  TABLE_SEARCH_ICON,
  TABLE_SEARCH_INPUT,
} from '@/lib/table-styles'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DatePicker } from '@/components/date-picker'
import { LayoutToggle } from '@/features/ai-agent/components/layout-toggle'
import type { ListLayout } from '@/features/ai-agent/components/list-layout'
import { MARKETPLACE_OPTIONS, WINDOW_OPTIONS } from '../format'

type ItemToolbarProps = {
  keyword: string
  onKeywordChange: (value: string) => void
  /** 站点筛选：`'all'` 或站点代码（多站点下必需，否则 5000 条混在一起没法看） */
  marketplace: string
  onMarketplaceChange: (value: string) => void
  /** 当前列表里实际出现的站点（只列有数据的，不把 10 个站点全摆出来） */
  marketplaces: string[]
  windowKey: string
  onWindowKeyChange: (value: string) => void
  startDate: Date | undefined
  endDate: Date | undefined
  onStartDateChange: (date: Date | undefined) => void
  onEndDateChange: (date: Date | undefined) => void
  /** 服务端实际采用的区间与覆盖情况（由页面算好传入，工具条不做业务计算） */
  periodText: string | null
  /** 指标请求进行中：数字区此刻是上一个区间的值，必须让人看出来 */
  metricsLoading: boolean
  /** 当前筛选结果条数（导出与计数都以它为准，保证"导出 = 屏幕上看到的"） */
  filteredCount: number
  totalCount: number
  selectedCount: number
  onClearSelection: () => void
  onBulkRemove: () => void
  onExport: () => void
  /** 表格 / 卡片两种读法（偏好由页面持久化） */
  layout: ListLayout
  onLayoutChange: (layout: ListLayout) => void
  onAdd: () => void
  onImport: () => void
}

/**
 * 「我的 ASIN」工具条。
 *
 * 排布理由：
 * ① 第一行 = "我要看哪几条"：关键词、站点筛选、展示方式，右侧是三个动作
 *    （导出 / 从表格导入 / 添加 ASIN）；
 * ② 第二行 = "看的是哪段时间"：区间档位与自定义日期，右侧回报服务端实际采用的区间 ——
 *    指标是**区间相关**的，看不到区间就没法判断眼前的数字是什么；
 * ③ 批量操作条只在有选中时出现，不占常驻高度。
 *
 * 密度切换、维度筛选、表现筛选在 2026-09-18 按用户要求移除：
 * 密度是个人偏好（可由浏览器缩放替代），后两者是"清单维护"时代的产物，
 * 现在页面的职责是"看数据 + 维护条目"，筛选只留最常用的两个维度。
 */
export function ItemToolbar({
  keyword,
  onKeywordChange,
  marketplace,
  onMarketplaceChange,
  marketplaces,
  windowKey,
  onWindowKeyChange,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  periodText,
  metricsLoading,
  filteredCount,
  totalCount,
  selectedCount,
  onClearSelection,
  onBulkRemove,
  onExport,
  layout,
  onLayoutChange,
  onAdd,
  onImport,
}: ItemToolbarProps) {
  const isCustom = windowKey === 'custom'
  const siteOptions = MARKETPLACE_OPTIONS.filter((option) =>
    marketplaces.includes(option.value)
  )

  return (
    <div className='space-y-2'>
      <div className='flex flex-wrap items-center gap-2'>
        <div className='relative min-w-56 flex-1 sm:max-w-xs'>
          <Search className={TABLE_SEARCH_ICON} aria-hidden='true' />
          <Input
            aria-label='按 ASIN、别名或备注筛选'
            autoComplete='off'
            className={TABLE_SEARCH_INPUT}
            placeholder='按 ASIN / 别名 / 备注筛选'
            value={keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
          />
        </div>

        <Select value={marketplace} onValueChange={onMarketplaceChange}>
          <SelectTrigger aria-label='按站点筛选' className='h-9 w-36' size='sm'>
            <SelectValue placeholder='全部站点' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>全部站点</SelectItem>
            {siteOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 只在筛选真的筛掉了行时才报数：与分页器的「共 N 条」重复显示纯属噪音 */}
        {filteredCount !== totalCount && (
          <p className='text-xs text-muted-foreground tabular-nums'>
            筛出 {filteredCount} / {totalCount} 条
          </p>
        )}

        <div className='ms-auto flex flex-wrap items-center gap-2'>
          <LayoutToggle layout={layout} onLayoutChange={onLayoutChange} />
          <Button
            className='gap-2'
            disabled={filteredCount === 0}
            size='sm'
            type='button'
            variant='outline'
            onClick={onExport}
          >
            <Download aria-hidden='true' />
            导出 CSV
          </Button>
          <Button
            className='gap-2'
            size='sm'
            type='button'
            variant='outline'
            onClick={onImport}
          >
            <FileSpreadsheet aria-hidden='true' />
            从表格导入
          </Button>
          <Button className='gap-2' size='sm' type='button' onClick={onAdd}>
            <Plus aria-hidden='true' />
            添加 ASIN
          </Button>
        </div>
      </div>

      <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
        <div className='flex items-center gap-2'>
          <CalendarRange
            className='size-4 text-muted-foreground'
            aria-hidden='true'
          />
          <Label className='text-xs text-muted-foreground'>统计区间</Label>
          <Tabs value={windowKey} onValueChange={onWindowKeyChange}>
            <TabsList aria-label='统计区间'>
              {WINDOW_OPTIONS.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {isCustom && (
          <div className='flex flex-wrap items-center gap-2'>
            <DatePicker
              selected={startDate}
              onSelect={onStartDateChange}
              placeholder='开始日期'
            />
            <span className='text-xs text-muted-foreground'>至</span>
            <DatePicker
              selected={endDate}
              onSelect={onEndDateChange}
              placeholder='结束日期'
            />
          </div>
        )}

        <div className='ms-auto flex items-center gap-2'>
          {metricsLoading && (
            <span className='flex items-center gap-1 text-xs text-muted-foreground'>
              <Loader2 className='size-3.5 animate-spin' aria-hidden='true' />
              指标更新中…
            </span>
          )}
          {periodText && (
            <p className='text-xs text-muted-foreground tabular-nums'>
              {periodText}
            </p>
          )}
        </div>
      </div>

      {selectedCount > 0 && (
        <div className='flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-accent/50 px-3 py-2'>
          <p className='text-sm'>
            已选{' '}
            <span className='font-medium tabular-nums'>{selectedCount}</span> 条
            <span className='text-muted-foreground'>（只在当前页内选中）</span>
          </p>
          <div className='flex items-center gap-2'>
            <Button
              className='gap-1.5'
              size='sm'
              type='button'
              variant='ghost'
              onClick={onClearSelection}
            >
              <X aria-hidden='true' />
              取消选择
            </Button>
            <Button
              className='gap-1.5'
              size='sm'
              type='button'
              variant='destructive'
              onClick={onBulkRemove}
            >
              <Trash2 aria-hidden='true' />
              移除所选
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

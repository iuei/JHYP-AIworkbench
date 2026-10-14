import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable } from '@/components/data-table'
import { TableCell, TableHead, TableRow } from '@/components/ui/table'
import {
  TABLE_CELL_META,
  TABLE_CELL_NUMERIC,
  TABLE_CELL_TRUNCATE,
  TABLE_HEAD_NUMERIC,
} from '@/lib/table-styles'
import { COVERAGE_VARIANTS, formatDimensionValue } from '../format'
import type { ComparisonResult } from '../types'

type ComparisonPanelProps = {
  result: ComparisonResult
  fromHistory: boolean
}

/**
 * 对比结果展示。
 *
 * 两条硬约定：
 * 1. **前端不做任何口径计算**。指标、覆盖率、"无我方数据"的判定全部来自服务端
 *    （`buildComparison`），前端只负责按 `dimensions` 取值渲染。前端自己算一遍必然与服务端漂移，
 *    而用户看到的是两套数字。
 * 2. **人工录入列与我方报表列在视觉上必须能分开**。报表列的表头用弱化色并带 title 说明来源，
 *    因为用户填的价格和平台算出的花费是两种可信度完全不同的数据，混在一起看容易当成一回事。
 */
export function ComparisonPanel({ result, fromHistory }: ComparisonPanelProps) {
  const reportDimensionCount = result.dimensions.filter((d) => d.source === 'report').length
  const manualDimensionCount = result.dimensions.length - reportDimensionCount

  return (
    <>
      <Card>
        <CardHeader className='gap-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <CardTitle className='text-base'>
              {result.marketplaceLabel}站 · {result.candidateCount} 个候选
            </CardTitle>
            {fromHistory && (
              <Badge variant='outline'>
                历史快照 · {result.createdAt ? new Date(result.createdAt).toLocaleString('zh-CN', { hour12: false }) : '时间未知'}
              </Badge>
            )}
            {result.omittedDimensionCount > 0 && (
              <Badge variant='outline'>另有 {result.omittedDimensionCount} 个维度未展示</Badge>
            )}
          </div>
          <CardDescription>
            统计区间 {result.startDate} ~ {result.endDate}（{result.windowDays} 天）·{' '}
            {manualDimensionCount} 个人工录入维度 · {reportDimensionCount} 个我方报表维度
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-2'>
          <p className='text-sm'>{result.coverage.note}</p>
          {result.dataFreshness?.note && (
            <p className='text-xs text-muted-foreground'>{result.dataFreshness.note}</p>
          )}
        </CardContent>
      </Card>

      <DataTable
        columns={result.dimensions.length + 1}
        isEmpty={result.rows.length === 0}
        emptyText='这次对比没有可展示的候选行。'
        header={
          <TableRow>
            <TableHead>候选产品</TableHead>
            {result.dimensions.map((dimension) => (
              <TableHead
                key={dimension.key}
                className={
                  dimension.source === 'report'
                    ? `text-muted-foreground ${TABLE_HEAD_NUMERIC}`
                    : undefined
                }
                title={
                  dimension.source === 'report'
                    ? '来自本公司已导入的 Amazon 报表'
                    : '由使用者人工录入，平台不做校验与抓取'
                }
              >
                {dimension.label}
                {dimension.source === 'report' ? (
                  <span className='ml-1 text-[10px] font-normal'>报表</span>
                ) : null}
              </TableHead>
            ))}
          </TableRow>
        }
      >
        {result.rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className={TABLE_CELL_TRUNCATE} title={row.emptyReason ?? undefined}>
              <span className='font-medium'>{row.name}</span>
              <p className={`mt-0.5 ${TABLE_CELL_META}`}>
                {row.asin ?? '未填 ASIN'}
                {row.coverage === 'ok' ? null : (
                  <Badge variant={COVERAGE_VARIANTS[row.coverage]} className='ms-2'>
                    {row.coverageLabel}
                  </Badge>
                )}
              </p>
            </TableCell>
            {result.dimensions.map((dimension) => (
              <TableCell
                key={dimension.key}
                className={
                  dimension.source === 'report' ? TABLE_CELL_NUMERIC : undefined
                }
              >
                {formatDimensionValue(row.values[dimension.key], dimension.format)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </DataTable>

      <Card>
        <CardHeader className='gap-1'>
          <CardTitle className='text-base'>口径说明</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3 text-sm text-muted-foreground'>
          <p>{result.note}</p>
          <p>{result.conclusionNote}</p>
        </CardContent>
      </Card>
    </>
  )
}

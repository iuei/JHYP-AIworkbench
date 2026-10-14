import { useState } from 'react'
import {
  ChevronDown,
  Database,
  FileText,
  Lock,
  Sparkles,
  User2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate, SOURCE_LABELS } from '../format'
import type { Citation } from '../types'

const SOURCE_TYPE_LABELS: Record<string, string> = {
  ...SOURCE_LABELS,
  dataset: '数据集',
}
export function CitationList({ citations }: { citations: Citation[] }) {
  const [expanded, setExpanded] = useState<number[]>([])

  if (citations.length === 0) {
    return (
      <p className='text-sm text-muted-foreground'>本次回答没有引用文档。</p>
    )
  }

  return (
    <ul className='space-y-2'>
      {citations.map((citation, index) => {
        // 数据集引用（业务数据）与文档引用视觉区分：显示数据集名、行数与数据截至时间
        if (citation.kind === 'dataset') {
          return (
            <li
              className='rounded-lg border bg-muted/30 p-3'
              key={`dataset-${citation.dataset}-${index}`}
            >
              <div className='flex items-start gap-2'>
                <Database className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
                <div className='min-w-0 flex-1'>
                  <p className='truncate text-sm font-medium'>
                    {citation.title}
                  </p>
                  <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground'>
                    <Badge className='font-normal' variant='outline'>
                      数据集
                    </Badge>
                    <span>
                      数据截至{' '}
                      {formatDate(citation.importedAt ?? citation.updatedAt)}
                    </span>
                    {typeof citation.rowCount === 'number' && (
                      <span>当前 {citation.rowCount} 行</span>
                    )}
                  </div>
                  <p className='mt-1.5 text-xs text-muted-foreground'>
                    由人工导出报表导入，为准实时数据，非实时数据。
                  </p>
                </div>
              </div>
            </li>
          )
        }
        const isExperience = citation.sourceType === 'experience'
        const open = expanded.includes(index)
        // key 带下标兜底：服务端已按「文档-切片」去重，但历史数据里可能仍有重复引用，
        // 下标能保证 React key 唯一（否则引用列表可能被静默丢弃或重复渲染）
        const citationKey = `${index}-${citation.documentId ?? citation.dataset ?? 'ref'}-${citation.chunkIndex ?? 0}`
        return (
          <li
            className={cn(
              'rounded-lg border p-3',
              isExperience
                ? 'border-amber-500/40 bg-amber-500/5'
                : 'bg-muted/30'
            )}
            key={citationKey}
          >
            <div className='flex items-start gap-2'>
              <FileText className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
              <div className='min-w-0 flex-1'>
                <p className='truncate text-sm font-medium'>{citation.title}</p>
                <div className='mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground'>
                  <Badge
                    className='font-normal'
                    variant={isExperience ? 'secondary' : 'outline'}
                  >
                    {SOURCE_TYPE_LABELS[citation.sourceType] ?? '未知来源'}
                  </Badge>
                  <span>更新于 {formatDate(citation.updatedAt)}</span>
                  {citation.docVersion ? (
                    <span>版本 v{citation.docVersion}</span>
                  ) : null}
                  {isExperience && citation.submitter && (
                    <span className='inline-flex items-center gap-1'>
                      <User2 className='size-3' />
                      提报人 {citation.submitter}
                    </span>
                  )}
                </div>
                {isExperience && (
                  <p className='mt-1.5 text-xs text-amber-700 dark:text-amber-400'>
                    本条为员工个人经验，不代表公司制度。
                  </p>
                )}
                {citation.snippet && (
                  <div className='mt-2'>
                    <Button
                      className='h-7 px-2 text-xs'
                      size='sm'
                      variant='ghost'
                      onClick={() =>
                        setExpanded((prev) =>
                          prev.includes(index)
                            ? prev.filter((item) => item !== index)
                            : [...prev, index]
                        )
                      }
                    >
                      <ChevronDown
                        className={cn(
                          'size-3.5 transition-transform',
                          open && 'rotate-180'
                        )}
                      />
                      {open ? '收起原文片段' : '查看原文片段'}
                    </Button>
                    {open && (
                      /* 依据已移入回答卡片（2026-09-15 取消右栏）：片段里的长 URL / 无空格长串
                         同样会溢出被裁，必须允许任意位置断行 */
                      <p className='wrap-anywhere mt-1 rounded-md bg-background/70 p-2 text-xs whitespace-pre-wrap text-muted-foreground'>
                        {citation.snippet}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * 声明条（固定展示）：数据来源 · 数据截至 · 权限范围。
 * 数据截至取引用文档中最新的更新时间——知识库内容不是实时数据，必须明示。
 */
export function FreshnessBar({
  citations,
  scopeLabel = '当前账号可见的生效文档',
  className,
}: {
  citations: Citation[]
  scopeLabel?: string
  className?: string
}) {
  const latest = citations.reduce<string | null>((acc, citation) => {
    if (!citation.updatedAt) return acc
    if (!acc) return citation.updatedAt
    return new Date(citation.updatedAt) > new Date(acc)
      ? citation.updatedAt
      : acc
  }, null)
  const documentCitations = citations.filter(
    (citation) => citation.kind === 'document'
  )
  const datasetCitations = citations.filter(
    (citation) => citation.kind === 'dataset'
  )
  const documents = new Set(
    documentCitations.map(
      (citation) => citation.documentId ?? `title:${citation.title}`
    )
  ).size
  const datasets = [
    ...new Set(
      datasetCitations
        .map((citation) => citation.title || citation.dataset)
        .filter(Boolean)
    ),
  ]
  const sourceLabel = [
    documents > 0 ? `企业知识库（${documents} 篇文档）` : null,
    datasets.length > 0 ? `业务数据集（${datasets.join('、')}）` : null,
  ]
    .filter(Boolean)
    .join('、')

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground',
        className
      )}
    >
      <span className='inline-flex items-center gap-1'>
        <Sparkles className='size-3.5' />
        数据来源：
        {sourceLabel || '无外部数据'}
      </span>
      <span>🕐 数据截至 {formatDate(latest)}</span>
      <span className='inline-flex items-center gap-1'>
        <Lock className='size-3.5' />
        依据权限范围：{scopeLabel}
      </span>
    </div>
  )
}

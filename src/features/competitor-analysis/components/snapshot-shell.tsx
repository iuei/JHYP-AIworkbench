import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { TABLE_CELL_MONO } from '@/lib/table-styles'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Main } from '@/components/layout/main'

/**
 * 「读某一次分析快照」这类页面的公共外壳与状态卡。
 *
 * 用到它的页面（2026-09-16 起）：竞品详情页 `/competitor-analysis/$asin`
 * 与分析结果页 `/competitor-analysis/results`。两者都是**只读快照**的页面，
 * 都需要同一套"返回竞品分析 + 当前在看什么"的定位条，以及同一套异常态文案
 * （缺少 `analysisId` / 记录不存在 / 没有快照）。
 *
 * 抽出来是为了两页的口径一致：只改一处，不会出现"一个页面说'请从卡片进入'、
 * 另一个页面说别的"的情况。
 */
export function SnapshotShell({
  children,
  analysisId,
  subject,
}: {
  children: ReactNode
  /** 当前快照的记录 id；带上它返回时能回到同一次分析，而不是空白的表单页。 */
  analysisId?: number
  /** 右侧"当前查看"里显示的对象（竞品详情页传 ASIN）。 */
  subject?: string
}) {
  return (
    <Main>
      <div className='mb-4 flex flex-wrap items-center justify-between gap-2'>
        {/*
          **不带 `analysisId` 返回**：分析页现在只放"参数 + 历史"，收到 `analysisId` 会立刻转发回
          结果页（那是给首页深链用的）—— 带上它点返回就会被弹回来，形成来回跳的死循环（实测踩到）。
          `analysisId` 仍然用于右侧"当前查看…分析记录 #N"的显示。
        */}
        <Button asChild size='sm' variant='ghost'>
          <Link to='/competitor-analysis'>
            <ArrowLeft aria-hidden='true' />
            返回竞品分析
          </Link>
        </Button>
        {(subject || analysisId) && (
          <p className='text-xs text-muted-foreground'>
            {subject && (
              <>
                当前查看：<span className={TABLE_CELL_MONO}>{subject}</span>
              </>
            )}
            {analysisId ? ` · 分析记录 #${analysisId}` : ''}
          </p>
        )}
      </div>
      <div className='space-y-6'>{children}</div>
    </Main>
  )
}

/** 快照类页面的异常/空态卡：只说清楚"为什么打不开"和"该怎么办"。 */
export function SnapshotStateCard({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <Card>
      <CardHeader className='gap-1'>
        <CardTitle className='text-base'>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  )
}

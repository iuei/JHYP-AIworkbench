import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { RotateCcw, Search } from 'lucide-react'
import { api } from '@/api/client'
import { Main } from '@/components/layout/main'
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
import { AnswerBlocks } from '@/features/ai-agent/components/answer-blocks'
import type { AnswerBlock } from '@/features/ai-agent/types'

/**
 * `POST /competitor-analyses` 的 result 结构（与 `server/competitor-analysis.mjs` 一一对应）。
 *
 * 数字全部由服务端基于已导入的数据集算出，前端只负责展示 —— 不再出现
 * 「无论输入什么都返回同一组结论」的写死结果（历史实现即如此）。
 */
type CompetitorAnalysisResult = {
  inputType: 'ASIN'
  inputValue: string
  asin: string
  marketplace: string
  startDate: string
  endDate: string
  windowDays: number
  empty: boolean
  rowCount: number
  summary: string
  blocks: AnswerBlock[]
  /** 服务端 `combineFreshness` 的合并结果（对象，不是数组）。 */
  dataFreshness: DataFreshness | null
}

/**
 * 数据时效：服务端已生成好可读文案（覆盖至哪天、最旧来源何时导入、非实时声明），
 * 前端直接展示 `note`，避免自己再拼一遍口径不一致的说明。
 */
type DataFreshness = {
  label: string
  importedAt: string | null
  periodEnd: string | null
  note: string
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? fallback
  }
  return fallback
}

export function CompetitorAnalysis() {
  const [asin, setAsin] = useState('')

  const analysis = useMutation({
    mutationFn: async (value: string) => {
      const { data } = await api.post<{ result: CompetitorAnalysisResult }>(
        '/competitor-analyses',
        { inputType: 'ASIN', inputValue: value }
      )
      return data.result
    },
  })

  const result = analysis.data

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = asin.trim()
    if (!value) return
    analysis.mutate(value)
  }

  return (
    <Main>
      <Card className='mb-6'>
        <CardContent className='pt-6'>
          <form
            className='flex flex-col gap-3 sm:flex-row sm:items-end'
            onSubmit={onSubmit}
          >
            <div className='flex-1 space-y-2'>
              <Label htmlFor='competitor-asin'>ASIN</Label>
              <Input
                id='competitor-asin'
                value={asin}
                onChange={(event) => setAsin(event.target.value)}
                placeholder='例如：B0C1D2E3F4，也可粘贴亚马逊商品链接'
                autoComplete='off'
                spellCheck={false}
              />
            </div>
            <Button type='submit' disabled={!asin.trim() || analysis.isPending}>
              <Search aria-hidden='true' />
              {analysis.isPending ? '分析中…' : '开始分析'}
            </Button>
          </form>
          <p className='mt-3 text-xs text-muted-foreground'>
            分析基于已导入的 Amazon 广告日报与业务报告，统计区间取该 ASIN
            最新数据日期往前 30 天；数据为人工导出后导入，非实时数据。
          </p>
        </CardContent>
      </Card>

      {analysis.isError && (
        <Card className='mb-6 border-destructive/40'>
          <CardContent className='flex flex-col items-start gap-3 py-6'>
            <p className='text-sm text-destructive'>
              {apiErrorMessage(analysis.error, '分析失败，请稍后重试。')}
            </p>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={analysis.isPending || !asin.trim()}
              onClick={() => analysis.mutate(asin.trim())}
            >
              <RotateCcw aria-hidden='true' />
              重新分析
            </Button>
          </CardContent>
        </Card>
      )}

      {result && (
        <>
          <Card className='mb-6'>
            <CardHeader className='gap-1'>
              <CardTitle className='text-base'>
                {result.asin} · {result.marketplace} 站
              </CardTitle>
              <CardDescription>
                统计区间 {result.startDate} ~ {result.endDate}（近{' '}
                {result.windowDays} 天）
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              <p className='text-sm whitespace-pre-line text-muted-foreground'>
                {result.summary}
              </p>
              {result.dataFreshness?.note && (
                <p className='text-xs text-muted-foreground'>
                  {result.dataFreshness.note}
                </p>
              )}
            </CardContent>
          </Card>

          <AnswerBlocks blocks={result.blocks} />

          <Card className='mt-6'>
            <CardHeader className='gap-1'>
              <CardTitle className='text-base'>未接入的分析维度</CardTitle>
              <CardDescription>
                下列结论需要当前数据集之外的来源，因此不提供推测
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className='space-y-2 text-sm text-muted-foreground'>
                <li>关键词机会：需要 Amazon 品牌分析或搜索词报告</li>
                <li>Listing 结构与图片卖点：需要商品详情与图片数据</li>
                <li>评论痛点：需要评论数据</li>
                <li>品牌名与店铺维度：需要品牌分析或 SP-API 授权</li>
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </Main>
  )
}

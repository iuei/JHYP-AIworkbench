import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { BarChart3, Search } from 'lucide-react'
import { api } from '@/api/client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Result = { keywords: string[]; listing: string[]; imagePoints: string[]; reviewPainPoints: string[] }
export function CompetitorAnalysis() {
  const [inputType, setInputType] = useState('ASIN')
  const [inputValue, setInputValue] = useState('')
  const analysis = useMutation({ mutationFn: async () => (await api.post('/competitor-analyses', { inputType, inputValue })).data })
  const result: Result | undefined = analysis.data?.result
  return <><Header><div className='me-auto font-medium'>竞品分析</div><ThemeSwitch /><ProfileDropdown /></Header><Main>
    <div className='mb-6'><h1 className='text-2xl font-bold tracking-tight'>竞品与市场分析</h1><p className='text-sm text-muted-foreground'>支持 Amazon 美国站 ASIN、品牌名和店铺链接。分析结果为预置演示数据。</p></div>
    <Card className='mb-6'><CardContent className='flex flex-col gap-3 p-5 md:flex-row'><Select value={inputType} onValueChange={setInputType}><SelectTrigger className='md:w-40'><SelectValue /></SelectTrigger><SelectContent><SelectItem value='ASIN'>ASIN</SelectItem><SelectItem value='品牌名'>品牌名</SelectItem><SelectItem value='店铺链接'>店铺链接</SelectItem></SelectContent></Select><Input value={inputValue} onChange={(event) => setInputValue(event.target.value)} placeholder={inputType === 'ASIN' ? '例如：B0XXXXXXXX' : `请输入${inputType}`} /><Button disabled={!inputValue || analysis.isPending} onClick={() => analysis.mutate()}>{analysis.isPending ? '分析中…' : <><Search />开始分析</>}</Button></CardContent></Card>
    {result && <div className='grid gap-4 md:grid-cols-2'>{[['关键词机会', result.keywords], ['Listing 结构洞察', result.listing], ['图片卖点建议', result.imagePoints], ['评论痛点', result.reviewPainPoints]].map(([title, items]) => <Card key={title as string}><CardHeader><CardTitle className='flex items-center gap-2 text-base'><BarChart3 className='size-4 text-primary' />{title as string}</CardTitle></CardHeader><CardContent><ul className='space-y-2 text-sm text-muted-foreground'>{(items as string[]).map((item) => <li key={item}>• {item}</li>)}</ul></CardContent></Card>)}</div>}
  </Main></>
}

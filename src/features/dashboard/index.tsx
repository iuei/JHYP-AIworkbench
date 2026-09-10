import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { BarChart3, GripVertical, Image, PackageSearch, Star } from 'lucide-react'
import { api } from '@/api/client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const shortcuts = [
  { id: 'competitor', title: '竞品分析', description: 'ASIN、品牌与店铺解读', icon: BarChart3, to: '/competitor-analysis' },
  { id: 'project', title: '项目开发', description: '即将上线', icon: PackageSearch },
  { id: 'listing', title: 'Listing 打造', description: '即将上线', icon: Image },
  { id: 'reviews', title: '评论分析 Plus', description: '即将上线', icon: Star },
]

export function Dashboard() {
  const queryClient = useQueryClient()
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: async () => (await api.get('/dashboard')).data })
  const saveShortcuts = useMutation({ mutationFn: async (shortcutIds: string[]) => api.put('/dashboard/shortcuts', { shortcutIds }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dashboard'] }) })
  const data = dashboard.data
  const ordered = (data?.shortcutIds?.length ? data.shortcutIds : shortcuts.map((item) => item.id)).map((id: string) => shortcuts.find((item) => item.id === id)).filter(Boolean) as typeof shortcuts
  function drop(targetId: string) { if (!draggedId || draggedId === targetId) return; const ids = ordered.map((item) => item.id); const from = ids.indexOf(draggedId); const to = ids.indexOf(targetId); ids.splice(to, 0, ids.splice(from, 1)[0]); saveShortcuts.mutate(ids); setDraggedId(null) }
  return <><Header><Search className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header><Main>
    <div className='mb-6 space-y-1'><h1 className='text-2xl font-bold tracking-tight'>JHYP 智能工作台</h1><p className='text-sm text-muted-foreground'>用 AI 与自动化加速跨境电商运营工作。</p></div>
    <section className='mb-6'><div className='mb-3 flex items-center justify-between'><h2 className='font-semibold'>快捷功能</h2><span className='text-xs text-muted-foreground'>拖拽卡片可调整顺序</span></div><div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>{ordered.map((item) => <Card key={item.id} draggable onDragStart={() => setDraggedId(item.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => drop(item.id)} className='cursor-grab transition-shadow hover:shadow-md active:cursor-grabbing'><div className='relative'><GripVertical className='absolute right-4 top-4 size-4 text-muted-foreground' />{item.to ? <Link to={item.to} className='block'><Shortcut {...item} /></Link> : <Shortcut {...item} />}</div></Card>)}</div></section>
    <div className='grid gap-6 xl:grid-cols-2'><Card><CardHeader><CardTitle>正在进行的工作</CardTitle><CardDescription>未完成的操作可以从这里继续。</CardDescription></CardHeader><CardContent className='space-y-3'>{data?.workItems?.length ? data.workItems.map((item: { id: number; title: string; module: string; progress: number; route: string }) => <Link key={item.id} to={item.route} className='block rounded-lg border p-3 hover:bg-muted/50'><div className='flex justify-between'><div><p className='font-medium'>{item.title}</p><p className='text-sm text-muted-foreground'>{item.module}</p></div><Badge variant='secondary'>{item.progress}%</Badge></div><div className='mt-3 h-1.5 rounded-full bg-muted'><div className='h-full rounded-full bg-primary' style={{ width: `${item.progress}%` }} /></div></Link>) : <Empty text='暂无进行中的工作' />}</CardContent></Card>
    <Card><CardHeader><CardTitle>最近竞品分析</CardTitle><CardDescription>Amazon 美国站演示记录</CardDescription></CardHeader><CardContent className='space-y-3'>{data?.analyses?.length ? data.analyses.map((item: { id: number; input_value: string; input_type: string }) => <Link key={item.id} to='/competitor-analysis' className='block rounded-lg border p-3 hover:bg-muted/50'><p className='font-medium'>{item.input_value}</p><p className='text-sm text-muted-foreground'>{item.input_type}</p></Link>) : <Empty text='完成一次竞品分析后会显示在这里' />}</CardContent></Card></div>
  </Main></>
}
function Shortcut({ title, description, icon: Icon }: (typeof shortcuts)[number]) { return <><CardHeader><Icon className='mb-2 size-5 text-primary' /><CardTitle className='text-base'>{title}</CardTitle></CardHeader><CardContent><CardDescription>{description}</CardDescription></CardContent></> }
function Empty({ text }: { text: string }) { return <p className='py-8 text-center text-sm text-muted-foreground'>{text}</p> }

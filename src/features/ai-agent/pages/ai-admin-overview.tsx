import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  Database,
  FileWarning,
  ScrollText,
  Settings2,
  ShieldAlert,
  Sparkles,
  Upload,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useAiSettings,
  useAuditLogs,
  useDatasets,
  useDistillStats,
  useKnowledgeDocuments,
  useUsageStats,
} from '../api/queries'
import { PageShell } from '../components/page-shell'
import { formatDate, formatTime } from '../format'

/**
 * 「AI 治理」概览首页。
 *
 * 为什么需要它：治理面收缩到「设置 → AI 治理」后，需要一个**总览 + 横向入口**的落地页，
 * 否则进后台第一屏要么是知识库的长表格、要么是审计台的日志，既没有全局视角，
 * 宽屏下右侧也大片留白。这里用多列卡片铺满宽度，并把五个子页做成同级入口。
 */
const ENTRIES = [
  {
    to: '/admin/ai/knowledge',
    title: '知识库',
    icon: Database,
    desc: '文档治理：上传、有效期、下线、重建索引与纠错闭环',
  },
  {
    to: '/admin/ai/datasources',
    title: '数据源与导入',
    icon: Upload,
    desc: 'CSV 模板、导入校验与导入记录（准实时数据）',
  },
  {
    to: '/admin/ai/distill',
    title: '经验审核',
    icon: Sparkles,
    desc: '员工经验审核入库、导出，以及技能成本参数治理',
  },
  {
    to: '/admin/ai/settings',
    title: '模型与配置',
    icon: Settings2,
    desc: '模型接入、编排与成本护栏、工具开关与用量',
  },
  {
    to: '/admin/ai/audit',
    title: '审计台',
    icon: ScrollText,
    desc: '会话轨迹、工具调用、越权拦截与管理动作',
  },
] as const

export function AiAdminOverview() {
  const documents = useKnowledgeDocuments({ page: 1, pageSize: 1 })
  const datasets = useDatasets()
  const distill = useDistillStats()
  const usage = useUsageStats(14)
  const settings = useAiSettings()
  const blockedRuns = useAuditLogs({ action: 'tool_blocked', limit: 50 })
  const forbiddenLogs = useAuditLogs({ action: 'forbidden', limit: 50 })

  const totalAnswers = (usage.data ?? []).reduce(
    (sum, row) => sum + row.answers,
    0
  )
  const totalTokens = (usage.data ?? []).reduce(
    (sum, row) => sum + row.tokensIn + row.tokensOut,
    0
  )
  const datasetList = datasets.data?.datasets ?? []
  const importedDatasets = datasetList.filter((item) => item.rows > 0)
  const importTimes = datasetList
    .map((item) => item.lastImportAt)
    .filter((value): value is string => Boolean(value))
    .sort()
  const latestImport =
    importTimes.length > 0 ? importTimes[importTimes.length - 1] : null
  const blockedCount =
    (blockedRuns.data ?? []).length + (forbiddenLogs.data ?? []).length

  const stats = [
    {
      label: '知识文档',
      value: documents.isLoading ? null : (documents.data?.total ?? 0),
      hint: '生效中的公共知识',
    },
    {
      label: '数据集',
      value: datasets.isLoading
        ? null
        : `${importedDatasets.length}/${datasetList.length}`,
      hint: latestImport
        ? `最近导入 ${formatDate(latestImport)}`
        : '暂无导入记录',
    },
    {
      label: '待审核经验',
      value: distill.isLoading ? null : (distill.data?.pending ?? 0),
      hint: `累计 ${distill.data?.total ?? 0} 条 · 涉及 ${distill.data?.accounts ?? 0} 个账号`,
    },
    {
      label: '近 14 天用量',
      value: usage.isLoading ? null : totalAnswers,
      hint: `回答数 · token ${totalTokens.toLocaleString('zh-CN')}`,
    },
  ]

  return (
    <PageShell
    >
      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        {stats.map((item) => (
          <Card key={item.label}>
            <CardContent className='pt-4'>
              <p className='text-sm text-muted-foreground'>{item.label}</p>
              {item.value === null ? (
                <Skeleton className='mt-1 h-8 w-16' />
              ) : (
                <p className='text-2xl font-bold'>{item.value}</p>
              )}
              <p className='text-xs text-muted-foreground'>{item.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className='grid gap-4 xl:grid-cols-3'>
        <Card className='xl:col-span-2'>
          <CardHeader className='gap-1'>
            <CardTitle className='text-base'>治理入口</CardTitle>
            <CardDescription>
              五个子页与顶部导航同级，可直接横向切换。
            </CardDescription>
          </CardHeader>
          <CardContent className='grid gap-3 sm:grid-cols-2'>
            {ENTRIES.map((entry) => {
              const Icon = entry.icon
              return (
                <Link
                  className='group flex items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/50'
                  key={entry.to}
                  to={entry.to}
                >
                  <span className='mt-0.5 rounded-md bg-primary/10 p-1.5 text-primary'>
                    <Icon className='size-4' />
                  </span>
                  <span className='min-w-0 flex-1'>
                    <span className='flex items-center gap-1 text-sm font-medium'>
                      {entry.title}
                      <ArrowRight className='size-3.5 opacity-0 transition-opacity group-hover:opacity-100' />
                    </span>
                    <span className='mt-0.5 block text-xs text-muted-foreground'>
                      {entry.desc}
                    </span>
                  </span>
                </Link>
              )
            })}
          </CardContent>
        </Card>

        <div className='space-y-4'>
          <Card>
            <CardHeader className='gap-1'>
              <CardTitle className='text-base'>模型状态</CardTitle>
              <CardDescription>当前生效的模型与密钥来源。</CardDescription>
            </CardHeader>
            <CardContent className='space-y-2 text-sm'>
              {settings.isLoading ? (
                <Skeleton className='h-20 w-full' />
              ) : (
                <>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-muted-foreground'>模式</span>
                    <Badge
                      variant={
                        settings.data?.settings.effectiveMode === 'live'
                          ? 'secondary'
                          : 'outline'
                      }
                    >
                      {settings.data?.settings.effectiveMode === 'live'
                        ? '真实模型'
                        : '演示模式'}
                    </Badge>
                  </div>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-muted-foreground'>模型名</span>
                    <span className='truncate font-medium'>
                      {settings.data?.settings.modelName ?? '—'}
                    </span>
                  </div>
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-muted-foreground'>密钥来源</span>
                    <span>
                      {settings.data?.settings.keySource === 'database'
                        ? '后台配置'
                        : settings.data?.settings.keySource === 'environment'
                          ? '环境变量'
                          : '未配置'}
                    </span>
                  </div>
                  <Button asChild className='w-full gap-2' variant='outline'>
                    <Link to='/admin/ai/settings'>
                      <Settings2 className='size-4' />
                      去配置
                    </Link>
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className='gap-1'>
              <CardTitle className='flex items-center gap-2 text-base'>
                <FileWarning className='size-4' />
                合规信号
              </CardTitle>
              <CardDescription>
                越权与拦截记录是最有价值的审计信号。
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-2 text-sm'>
              <div className='flex items-center justify-between gap-2'>
                <span className='flex items-center gap-1.5 text-muted-foreground'>
                  <ShieldAlert className='size-3.5' />近 50 条内拦截
                </span>
                <span className='font-semibold'>{blockedCount}</span>
              </div>
              {blockedCount > 0 && (
                <p className='text-xs text-muted-foreground'>
                  最近一条：
                  {formatTime(
                    [...(blockedRuns.data ?? []), ...(forbiddenLogs.data ?? [])]
                      .map((row) => row.createdAt)
                      .sort()
                      .slice(-1)[0]
                  )}
                </p>
              )}
              <Button asChild className='w-full gap-2' variant='outline'>
                <Link to='/admin/ai/audit'>
                  <ScrollText className='size-4' />
                  查看审计台
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  )
}

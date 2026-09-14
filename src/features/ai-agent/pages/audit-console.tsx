import { useState } from 'react'
import { Download, ShieldAlert, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  useAuditConversations,
  useAuditLogs,
  useAuditRuns,
  useAuditTrace,
  useExportAudit,
} from '../api/queries'
import { PageShell } from '../components/page-shell'
import { formatTime } from '../format'

const ACTION_LABELS: Record<string, string> = {
  login: '登录',
  doc_upload: '知识上传',
  doc_offline: '文档下线',
  doc_online: '文档启用',
  doc_delete: '文档删除',
  reindex: '重建索引',
  audit_export: '审计导出',
  feedback: '纠错反馈',
  tool_blocked: '越权拦截',
  forbidden: '越权访问',
  injection_detected: '注入痕迹',
  tool_toggle: '工具开关',
  settings_update: '模型配置变更',
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function AuditConsole() {
  const [keyword, setKeyword] = useState('')
  const [runStatus, setRunStatus] = useState('all')
  const [logAction, setLogAction] = useState('all')
  const [traceId, setTraceId] = useState<number | null>(null)

  const filters = { keyword: keyword.trim() || undefined }
  const conversations = useAuditConversations(filters)
  const runs = useAuditRuns({
    ...filters,
    status: runStatus === 'all' ? undefined : runStatus,
  })
  const logs = useAuditLogs({
    ...filters,
    action: logAction === 'all' ? undefined : logAction,
  })
  const trace = useAuditTrace(traceId)
  const exportAudit = useExportAudit()

  const blockedRuns = (runs.data ?? []).filter(
    (run) => run.status === 'blocked'
  )
  const blockedLogs = (logs.data ?? []).filter(
    (log) => log.action === 'tool_blocked' || log.action === 'forbidden'
  )

  const runExport = (type: string) => {
    exportAudit.mutate(
      { type, params: filters },
      {
        onSuccess: (csv) => {
          downloadCsv(`ai-${type}-${Date.now()}.csv`, csv)
          toast.success('导出完成（导出动作已写入审计）')
        },
        onError: () => toast.error('导出失败，请稍后重试'),
      }
    )
  }

  return (
    <PageShell
    >
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          aria-label='按关键词搜索审计记录'
          className='w-full sm:w-72'
          placeholder='搜索提问内容、工具名或参数'
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <Button
          className='gap-2'
          disabled={exportAudit.isPending}
          variant='outline'
          onClick={() => runExport('runs')}
        >
          <Download />
          导出工具调用
        </Button>
        <Button
          className='gap-2'
          disabled={exportAudit.isPending}
          variant='outline'
          onClick={() => runExport('logs')}
        >
          <Download />
          导出管理动作
        </Button>
      </div>

      <div className='grid gap-3 sm:grid-cols-3'>
        <MetricCard label='工具调用记录' value={runs.data?.length ?? 0} />
        <MetricCard
          label='被拦截调用'
          value={blockedRuns.length}
          tone='warning'
        />
        <MetricCard
          label='越权与拦截事件'
          value={blockedLogs.length}
          tone='warning'
        />
      </div>

      <Tabs defaultValue='runs'>
        <TabsList>
          <TabsTrigger value='runs'>工具调用明细</TabsTrigger>
          <TabsTrigger value='blocked'>拦截记录</TabsTrigger>
          <TabsTrigger value='conversations'>会话轨迹</TabsTrigger>
          <TabsTrigger value='logs'>管理动作</TabsTrigger>
        </TabsList>

        <TabsContent value='runs'>
          <Card>
            <CardHeader className='flex-row items-center justify-between gap-2'>
              <div>
                <CardTitle className='text-base'>工具调用明细</CardTitle>
                <CardDescription>
                  包含成功、被拦截与失败的每一次调用。
                </CardDescription>
              </div>
              <Select value={runStatus} onValueChange={setRunStatus}>
                <SelectTrigger aria-label='按状态筛选' className='w-32'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>全部状态</SelectItem>
                  <SelectItem value='ok'>成功</SelectItem>
                  <SelectItem value='blocked'>被拦截</SelectItem>
                  <SelectItem value='error'>失败</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {runs.isLoading && <Skeleton className='h-40 w-full' />}
              <ScrollArea className='max-h-[520px]'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className='w-36'>时间</TableHead>
                      <TableHead className='w-32'>调用人</TableHead>
                      <TableHead className='w-48'>工具</TableHead>
                      <TableHead>参数</TableHead>
                      <TableHead>返回摘要</TableHead>
                      <TableHead className='w-20'>状态</TableHead>
                      <TableHead className='w-20'>耗时</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(runs.data ?? []).length === 0 && (
                      <TableRow>
                        <TableCell
                          className='text-muted-foreground'
                          colSpan={7}
                        >
                          没有匹配的调用记录。
                        </TableCell>
                      </TableRow>
                    )}
                    {(runs.data ?? []).map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className='text-xs'>
                          {formatTime(run.createdAt)}
                        </TableCell>
                        <TableCell className='text-xs'>
                          {run.user.name ?? run.user.login}
                        </TableCell>
                        <TableCell className='text-xs'>
                          <code>{run.toolName}</code>
                        </TableCell>
                        <TableCell className='max-w-64 text-xs break-all text-muted-foreground'>
                          {JSON.stringify(run.params)}
                        </TableCell>
                        <TableCell className='max-w-64 text-xs break-words text-muted-foreground'>
                          {run.error ?? run.summary ?? '—'}
                        </TableCell>
                        <TableCell>
                          <RunStatusBadge status={run.status} />
                        </TableCell>
                        <TableCell className='text-xs'>
                          {run.latencyMs ?? 0}ms
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='blocked'>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2 text-base'>
                <ShieldAlert className='size-4 text-destructive' />
                拦截记录
              </CardTitle>
              <CardDescription>
                被权限裁剪拦下的请求最有审计价值。拦截文案对用户统一，避免权限探测。
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              {blockedRuns.length === 0 && blockedLogs.length === 0 && (
                <p className='text-sm text-muted-foreground'>暂无拦截记录。</p>
              )}
              {blockedLogs.map((log) => (
                <div
                  className='rounded-lg border border-destructive/40 p-3'
                  key={log.id}
                >
                  <div className='flex flex-wrap items-center gap-2 text-xs'>
                    <Badge variant='destructive'>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </Badge>
                    <span className='text-muted-foreground'>
                      {log.actor?.name ?? log.actor?.login ?? '未知用户'} ·{' '}
                      {formatTime(log.createdAt)}
                    </span>
                    {log.targetId && (
                      <code className='text-muted-foreground'>
                        {log.targetId}
                      </code>
                    )}
                  </div>
                  <pre className='mt-2 overflow-x-auto rounded bg-muted/40 p-2 text-xs'>
                    {JSON.stringify(log.detail, null, 2)}
                  </pre>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='conversations'>
          <div className='grid gap-4 lg:grid-cols-[320px_1fr]'>
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>会话轨迹</CardTitle>
                <CardDescription>
                  点击查看完整问答与每一步工具调用。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className='max-h-[520px]'>
                  <ul className='space-y-1'>
                    {(conversations.data ?? []).map((item) => (
                      <li key={item.id}>
                        <button
                          className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                            traceId === item.id
                              ? 'bg-primary/10 text-primary'
                              : 'hover:bg-muted'
                          }`}
                          type='button'
                          onClick={() => setTraceId(item.id)}
                        >
                          <span className='block truncate'>{item.title}</span>
                          <span className='text-xs text-muted-foreground'>
                            {item.user.name ?? item.user.login} ·{' '}
                            {formatTime(item.createdAt)} · {item.messageCount}{' '}
                            条
                          </span>
                        </button>
                      </li>
                    ))}
                    {(conversations.data ?? []).length === 0 && (
                      <li className='px-2 text-sm text-muted-foreground'>
                        没有匹配的会话。
                      </li>
                    )}
                  </ul>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2 text-base'>
                  <Workflow className='size-4' />
                  完整轨迹
                </CardTitle>
                <CardDescription>
                  需求文档 §7.3：谁 · 何时 · 问什么 · 调用了哪些工具 · 返回什么
                  · 答了什么 · 引用哪些文档 · 耗时与 token · 是否被拦截。
                </CardDescription>
              </CardHeader>
              <CardContent>
                {traceId === null && (
                  <p className='text-sm text-muted-foreground'>
                    请选择左侧的一条会话。
                  </p>
                )}
                {trace.isLoading && <Skeleton className='h-40 w-full' />}
                {trace.data && (
                  <div className='space-y-3'>
                    {trace.data.messages.map((message) => (
                      <div className='rounded-lg border p-3' key={message.id}>
                        <div className='mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                          <Badge
                            variant={
                              message.role === 'user' ? 'outline' : 'secondary'
                            }
                          >
                            {message.role === 'user' ? '提问' : '回答'}
                          </Badge>
                          <span>{formatTime(message.createdAt)}</span>
                          {message.status !== 'ok' && (
                            <Badge variant='destructive'>
                              {message.status}
                            </Badge>
                          )}
                          {message.latencyMs !== null && (
                            <span>{message.latencyMs}ms</span>
                          )}
                          {message.tokensOut ? (
                            <span>{message.tokensOut} tokens</span>
                          ) : null}
                        </div>
                        <p className='text-sm whitespace-pre-wrap'>
                          {message.content}
                        </p>
                        {message.citations.length > 0 && (
                          <ul className='mt-2 space-y-1 text-xs text-muted-foreground'>
                            {message.citations.map((citation, index) => (
                              <li key={`${citation.documentId}-${index}`}>
                                引用：{citation.title} · v
                                {citation.docVersion ?? 1} ·{' '}
                                {citation.sourceType}
                              </li>
                            ))}
                          </ul>
                        )}
                        {message.role === 'user' &&
                          trace.data.runs
                            .filter((run) => run.messageId === message.id)
                            .map((run) => (
                              <div
                                className='mt-2 rounded bg-muted/40 p-2 text-xs text-muted-foreground'
                                key={run.id}
                              >
                                工具 {run.toolName} · {run.status} · 行数{' '}
                                {run.rowCount ?? 0} · {run.latencyMs ?? 0}ms
                                <div>参数：{JSON.stringify(run.params)}</div>
                                <div>
                                  返回：{run.error ?? run.summary ?? '—'}
                                </div>
                              </div>
                            ))}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value='logs'>
          <Card>
            <CardHeader className='flex-row items-center justify-between gap-2'>
              <div>
                <CardTitle className='text-base'>管理动作日志</CardTitle>
                <CardDescription>
                  登录、知识库变更、数据导入、审计导出等动作。
                </CardDescription>
              </div>
              <Select value={logAction} onValueChange={setLogAction}>
                <SelectTrigger aria-label='按动作筛选' className='w-36'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='all'>全部动作</SelectItem>
                  {Object.entries(ACTION_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              <ScrollArea className='max-h-[520px]'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className='w-36'>时间</TableHead>
                      <TableHead className='w-32'>操作人</TableHead>
                      <TableHead className='w-28'>动作</TableHead>
                      <TableHead className='w-32'>目标</TableHead>
                      <TableHead>详情</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(logs.data ?? []).length === 0 && (
                      <TableRow>
                        <TableCell
                          className='text-muted-foreground'
                          colSpan={5}
                        >
                          没有匹配的日志。
                        </TableCell>
                      </TableRow>
                    )}
                    {(logs.data ?? []).map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className='text-xs'>
                          {formatTime(log.createdAt)}
                        </TableCell>
                        <TableCell className='text-xs'>
                          {log.actor?.name ?? log.actor?.login ?? '系统'}
                        </TableCell>
                        <TableCell className='text-xs'>
                          {ACTION_LABELS[log.action] ?? log.action}
                        </TableCell>
                        <TableCell className='text-xs text-muted-foreground'>
                          {log.targetType ?? '—'}
                          {log.targetId ? ` #${log.targetId}` : ''}
                        </TableCell>
                        <TableCell className='max-w-80 text-xs break-all text-muted-foreground'>
                          {JSON.stringify(log.detail)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}

function RunStatusBadge({ status }: { status: string }) {
  if (status === 'ok') return <Badge variant='outline'>成功</Badge>
  if (status === 'blocked') return <Badge variant='destructive'>被拦截</Badge>
  if (status === 'error') return <Badge variant='destructive'>失败</Badge>
  return <Badge variant='secondary'>进行中</Badge>
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone?: 'warning'
}) {
  return (
    <Card>
      <CardContent className='p-4'>
        <p className='text-xs text-muted-foreground'>{label}</p>
        <p
          className={`mt-1 text-2xl font-semibold ${tone === 'warning' && value > 0 ? 'text-destructive' : ''}`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

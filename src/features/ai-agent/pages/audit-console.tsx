import { useState } from 'react'
import { Download, ShieldAlert, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import {
  TABLE_CELL_META,
  TABLE_CELL_MONO,
  TABLE_CELL_NUMERIC,
  TABLE_HEAD_NUMERIC,
} from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { TableCell, TableHead, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DataTable } from '@/components/data-table'
import { TablePagination } from '@/components/table-pagination'
import {
  useAuditConversations,
  useAuditLogs,
  useAuditRuns,
  useAuditTrace,
  useExportAudit,
} from '../api/queries'
import { MetricStrip } from '../components/metric-strip'
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
  dataset_export: '数据集导出',
  feedback: '纠错反馈',
  tool_blocked: '越权拦截',
  forbidden: '越权访问',
  injection_detected: '注入痕迹',
  tool_toggle: '工具开关',
  settings_update: '模型配置变更',
  /*
   * 账号类管理动作：服务端 `AUDIT_ACTIONS` 早就在记（注册 / 开通 / 改角色 / 启停 / 重置密码），
   * 但这里一直没有文案 —— 结果是审计台只能把 `user_create` 这类原文摊给管理员看，
   * 连按动作筛选都选不到（下拉就是这张表的键）。删除账号是不可逆动作，更不能只留英文原文。
   */
  user_register: '注册申请',
  user_create: '开通账号',
  user_update: '修改账号',
  user_status: '启停账号',
  user_reset_password: '重置密码',
  user_delete: '删除账号',
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
  /**
   * 三个审计视图各自独立分页。
   *
   * 共用一套 page 会让"切 tab 时页码串台"——在工具调用第 7 页切到管理动作，
   * 会直接落到管理动作的第 7 页（很可能超出其总页数），看起来像数据丢了。
   */
  const [runPage, setRunPage] = useState(1)
  const [runPageSize, setRunPageSize] = useState(20)
  const [logPage, setLogPage] = useState(1)
  const [logPageSize, setLogPageSize] = useState(20)
  const [conversationPage, setConversationPage] = useState(1)
  const [conversationPageSize, setConversationPageSize] = useState(20)

  const filters = { keyword: keyword.trim() || undefined }
  const conversations = useAuditConversations({
    ...filters,
    page: conversationPage,
    pageSize: conversationPageSize,
  })
  const runs = useAuditRuns({
    ...filters,
    status: runStatus === 'all' ? undefined : runStatus,
    page: runPage,
    pageSize: runPageSize,
  })
  const logs = useAuditLogs({
    ...filters,
    action: logAction === 'all' ? undefined : logAction,
    page: logPage,
    pageSize: logPageSize,
  })
  const trace = useAuditTrace(traceId)
  const exportAudit = useExportAudit()

  const runRows = runs.data?.runs ?? []
  const logRows = logs.data?.logs ?? []
  const conversationRows = conversations.data?.conversations ?? []

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
    <PageShell>
      <div className='flex flex-wrap items-center gap-2'>
        <Input
          aria-label='按关键词搜索审计记录'
          className='w-full sm:w-72'
          placeholder='搜索提问内容、工具名或参数'
          value={keyword}
          onChange={(event) => {
            setKeyword(event.target.value)
            // 关键词一变，旧页码很可能已越界：三个视图都回到第一页
            setRunPage(1)
            setLogPage(1)
            setConversationPage(1)
          }}
        />
        {/* 两个导出按钮并排占掉半行：它们是低频动作，合并成一个「导出」菜单，功能不变 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className='gap-2'
              disabled={exportAudit.isPending}
              variant='outline'
            >
              <Download />
              导出
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onSelect={() => runExport('runs')}>
              导出工具调用明细（CSV）
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => runExport('logs')}>
              导出管理动作日志（CSV）
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/*
        指标条取代三张统计卡（2026-09-15 简化）：本页的主体是四张审计表，
        指标只是"当前筛选下有多少条"的定位信息，不需要三张 100px 高的卡片。
        两个拦截类指标在大于 0 时仍标红（保留原有的告警语义）。
      */}
      <MetricStrip
        items={[
          {
            label: '工具调用记录',
            value: runs.isLoading ? null : (runs.data?.total ?? 0),
          },
          {
            label: '被拦截调用',
            value: runs.isLoading
              ? null
              : warnIfPositive(runs.data?.blockedTotal ?? 0),
          },
          {
            label: '越权与拦截事件',
            value: logs.isLoading
              ? null
              : warnIfPositive(logs.data?.blockedTotal ?? 0),
          },
        ]}
      />

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
              <Select
                value={runStatus}
                onValueChange={(value) => {
                  setRunStatus(value)
                  setRunPage(1)
                }}
              >
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
              <DataTable
                columns={7}
                emptyText='没有匹配的调用记录。'
                header={
                  <TableRow>
                    <TableHead className='w-36'>时间</TableHead>
                    <TableHead className='w-32'>调用人</TableHead>
                    <TableHead className='w-48'>工具</TableHead>
                    <TableHead>参数</TableHead>
                    <TableHead>返回摘要</TableHead>
                    <TableHead className='w-20'>状态</TableHead>
                    <TableHead className={cn('w-20', TABLE_HEAD_NUMERIC)}>
                      耗时
                    </TableHead>
                  </TableRow>
                }
                isEmpty={runRows.length === 0}
                isError={runs.isError}
                isLoading={runs.isLoading}
                pagination={{
                  disabled: runs.isFetching,
                  page: runs.data?.page ?? 1,
                  pageSize: runs.data?.pageSize ?? runPageSize,
                  total: runs.data?.total ?? 0,
                  onPageChange: setRunPage,
                  onPageSizeChange: (size) => {
                    setRunPageSize(size)
                    setRunPage(1)
                  },
                }}
              >
                {runRows.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className={TABLE_CELL_META}>
                      {formatTime(run.createdAt)}
                    </TableCell>
                    <TableCell className={TABLE_CELL_META}>
                      {run.user.name ?? run.user.login}
                    </TableCell>
                    <TableCell className={TABLE_CELL_MONO}>
                      <code>{run.toolName}</code>
                    </TableCell>
                    <TableCell className={cn(TABLE_CELL_META, 'max-w-64')}>
                      {/* 参数刻意用 `truncate` 而不是 `break-all`：整段 JSON 换行会把每行撑到 5~8 行高，
                          一页 20 条就是"一次能看两条"。完整内容仍在 title 里，鼠标悬停即可见。 */}
                      <span
                        className='block truncate'
                        title={JSON.stringify(run.params)}
                      >
                        {JSON.stringify(run.params)}
                      </span>
                    </TableCell>
                    <TableCell className={cn(TABLE_CELL_META, 'max-w-64')}>
                      <span
                        className='block truncate'
                        title={run.error ?? run.summary ?? ''}
                      >
                        {run.error ?? run.summary ?? '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <RunStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className={TABLE_CELL_NUMERIC}>
                      {run.latencyMs ?? 0}ms
                    </TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='blocked'>
          <BlockedPanel filters={filters} />
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
                    {conversationRows.map((item) => (
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
                    {conversationRows.length === 0 && (
                      <li className='px-2 text-sm text-muted-foreground'>
                        没有匹配的会话。
                      </li>
                    )}
                  </ul>
                </ScrollArea>
                {conversations.data && (
                  <TablePagination
                    className='mt-3'
                    disabled={conversations.isFetching}
                    page={conversations.data.page}
                    pageSize={conversations.data.pageSize}
                    total={conversations.data.total}
                    onPageChange={setConversationPage}
                    onPageSizeChange={(size) => {
                      setConversationPageSize(size)
                      setConversationPage(1)
                    }}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2 text-base'>
                  <Workflow className='size-4' />
                  完整轨迹
                </CardTitle>
                <CardDescription>
                  谁 · 何时 · 问什么 · 调用了哪些工具 · 返回什么 · 答了什么 ·
                  引用哪些文档 · 是否被拦截。
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
                  /*
                    轨迹改为卡片内滚动（2026-09-15 简化）：一次长会话（十几轮问答 +
                    每轮工具调用）此前会把整页拉到几千像素，左侧会话列表早已滚出视口，
                    想换一条会话得先滚回顶部。固定在 32rem 内滚动后，"选会话"始终可见。
                  */
                  <div className='max-h-[32rem] space-y-3 overflow-y-auto pe-1'>
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
              <Select
                value={logAction}
                onValueChange={(value) => {
                  setLogAction(value)
                  setLogPage(1)
                }}
              >
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
              <DataTable
                columns={5}
                emptyText='没有匹配的日志。'
                header={
                  <TableRow>
                    <TableHead className='w-36'>时间</TableHead>
                    <TableHead className='w-32'>操作人</TableHead>
                    <TableHead className='w-28'>动作</TableHead>
                    <TableHead className='w-32'>目标</TableHead>
                    <TableHead>详情</TableHead>
                  </TableRow>
                }
                isEmpty={logRows.length === 0}
                isError={logs.isError}
                isLoading={logs.isLoading}
                pagination={{
                  disabled: logs.isFetching,
                  page: logs.data?.page ?? 1,
                  pageSize: logs.data?.pageSize ?? logPageSize,
                  total: logs.data?.total ?? 0,
                  onPageChange: setLogPage,
                  onPageSizeChange: (size) => {
                    setLogPageSize(size)
                    setLogPage(1)
                  },
                }}
              >
                {logRows.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className={TABLE_CELL_META}>
                      {formatTime(log.createdAt)}
                    </TableCell>
                    <TableCell className={TABLE_CELL_META}>
                      {log.actor?.name ?? log.actor?.login ?? '系统'}
                    </TableCell>
                    <TableCell className='text-xs'>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </TableCell>
                    <TableCell className={TABLE_CELL_META}>
                      {log.targetType ?? '—'}
                      {log.targetId ? ` #${log.targetId}` : ''}
                    </TableCell>
                    <TableCell className={cn(TABLE_CELL_META, 'max-w-80')}>
                      <span
                        className='block truncate'
                        title={JSON.stringify(log.detail)}
                      >
                        {JSON.stringify(log.detail)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </DataTable>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}

/**
 * 拦截记录面板（独立组件）。
 *
 * 单独拆出来是为了让这两个查询**只在切到该 tab 时才发起**：放在 AuditConsole 顶层会
 * 和「工具调用明细」一起打请求，而审计台默认只显示一个 tab。
 *
 * 两张表都走服务端分页：拦截记录的价值就在于"能翻到具体那一次"，
 * 只给最近 N 条等于把历史留痕藏起来。
 */
function BlockedPanel({ filters }: { filters: { keyword?: string } }) {
  const [runPage, setRunPage] = useState(1)
  const [runPageSize, setRunPageSize] = useState(20)
  const [logPage, setLogPage] = useState(1)
  const [logPageSize, setLogPageSize] = useState(20)

  const blockedRuns = useAuditRuns({
    ...filters,
    status: 'blocked',
    page: runPage,
    pageSize: runPageSize,
  })
  const blockedLogs = useAuditLogs({
    ...filters,
    // 多动作合并筛选：越权访问与工具拦截对管理员是同一类事
    actions: 'tool_blocked,forbidden',
    page: logPage,
    pageSize: logPageSize,
  })

  const runRows = blockedRuns.data?.runs ?? []
  const logRows = blockedLogs.data?.logs ?? []

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            <ShieldAlert className='size-4 text-destructive' />
            被拦截的工具调用
          </CardTitle>
          <CardDescription>
            被权限裁剪拦下的请求最有审计价值。拦截文案对用户统一，避免权限探测。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={6}
            emptyText='没有匹配的拦截记录。'
            header={
              <TableRow>
                <TableHead className='w-36'>时间</TableHead>
                <TableHead className='w-32'>调用人</TableHead>
                <TableHead className='w-48'>工具</TableHead>
                <TableHead>参数</TableHead>
                <TableHead>拦截原因</TableHead>
                <TableHead className={cn('w-20', TABLE_HEAD_NUMERIC)}>
                  耗时
                </TableHead>
              </TableRow>
            }
            isEmpty={runRows.length === 0}
            isError={blockedRuns.isError}
            isLoading={blockedRuns.isLoading}
            pagination={{
              disabled: blockedRuns.isFetching,
              page: blockedRuns.data?.page ?? 1,
              pageSize: blockedRuns.data?.pageSize ?? runPageSize,
              total: blockedRuns.data?.total ?? 0,
              onPageChange: setRunPage,
              onPageSizeChange: (size) => {
                setRunPageSize(size)
                setRunPage(1)
              },
            }}
          >
            {runRows.map((run) => (
              <TableRow key={run.id}>
                <TableCell className={TABLE_CELL_META}>
                  {formatTime(run.createdAt)}
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {run.user.name ?? run.user.login}
                </TableCell>
                <TableCell className={TABLE_CELL_MONO}>
                  <code>{run.toolName}</code>
                </TableCell>
                <TableCell className={cn(TABLE_CELL_META, 'max-w-64')}>
                  <span
                    className='block truncate'
                    title={JSON.stringify(run.params)}
                  >
                    {JSON.stringify(run.params)}
                  </span>
                </TableCell>
                <TableCell className='max-w-64 text-xs text-destructive'>
                  <span
                    className='block truncate'
                    title={run.error ?? run.summary ?? ''}
                  >
                    {run.error ?? run.summary ?? '—'}
                  </span>
                </TableCell>
                <TableCell className={TABLE_CELL_NUMERIC}>
                  {run.latencyMs ?? 0}ms
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>越权与拦截事件</CardTitle>
          <CardDescription>
            越权访问、工具拦截与注入痕迹等管理动作级事件（tool_blocked /
            forbidden）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={5}
            emptyText='没有匹配的越权或拦截事件。'
            header={
              <TableRow>
                <TableHead className='w-36'>时间</TableHead>
                <TableHead className='w-32'>操作人</TableHead>
                <TableHead className='w-32'>动作</TableHead>
                <TableHead className='w-32'>目标</TableHead>
                <TableHead>详情</TableHead>
              </TableRow>
            }
            isEmpty={logRows.length === 0}
            isError={blockedLogs.isError}
            isLoading={blockedLogs.isLoading}
            pagination={{
              disabled: blockedLogs.isFetching,
              page: blockedLogs.data?.page ?? 1,
              pageSize: blockedLogs.data?.pageSize ?? logPageSize,
              total: blockedLogs.data?.total ?? 0,
              onPageChange: setLogPage,
              onPageSizeChange: (size) => {
                setLogPageSize(size)
                setLogPage(1)
              },
            }}
          >
            {logRows.map((log) => (
              <TableRow key={log.id}>
                <TableCell className={TABLE_CELL_META}>
                  {formatTime(log.createdAt)}
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {log.actor?.name ?? log.actor?.login ?? '未知用户'}
                </TableCell>
                <TableCell>
                  <Badge variant='destructive'>
                    {ACTION_LABELS[log.action] ?? log.action}
                  </Badge>
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {log.targetType ?? '—'}
                  {log.targetId ? ` #${log.targetId}` : ''}
                </TableCell>
                <TableCell className={cn(TABLE_CELL_META, 'max-w-96')}>
                  <span
                    className='block truncate'
                    title={JSON.stringify(log.detail)}
                  >
                    {JSON.stringify(log.detail)}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </DataTable>
        </CardContent>
      </Card>
    </div>
  )
}

function RunStatusBadge({ status }: { status: string }) {
  if (status === 'ok') return <Badge variant='outline'>成功</Badge>
  if (status === 'blocked') return <Badge variant='destructive'>被拦截</Badge>
  if (status === 'error') return <Badge variant='destructive'>失败</Badge>
  return <Badge variant='secondary'>进行中</Badge>
}

/** 拦截类指标大于 0 时标红：0 是常态，非 0 才是需要看的事（保留原统计卡的告警语义）。 */
function warnIfPositive(value: number) {
  return value > 0 ? <span className='text-destructive'>{value}</span> : value
}

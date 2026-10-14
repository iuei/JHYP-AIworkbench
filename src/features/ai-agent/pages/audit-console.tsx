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
import { useDebouncedValue } from '@/hooks/use-debounced-value'
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

/**
 * 审计动作中文口径。
 *
 * 这张表同时承担两件事：**「管理动作」表格的动作列文案**与**动作筛选下拉的数据源**。
 * 因此缺项不是"少一句翻译"——记录会把 `note_delete` 这类服务端常量直接摊给管理员，
 * 且下拉里根本选不到，等于这些动作在审计台**不可读、不可筛**。
 *
 * 必须与服务端 `AUDIT_ACTIONS`（`server/ai-agent/audit.mjs`）逐项对齐。
 * 2026-10-14 盘点：服务端 40 类，前端只有 20 类，缺的正是沉淀 / 提示词 / 公告 / 导入
 * 这批会改变公司资产的高危动作（含"删除沉淀""公告发布"）。
 */
const ACTION_LABELS: Record<string, string> = {
  // 登录
  login: '登录',
  // 知识库文档
  doc_upload: '知识上传',
  doc_offline: '文档下线',
  doc_online: '文档启用',
  doc_delete: '文档删除',
  reindex: '重建索引',
  // 数据接入与出境
  import: '数据导入',
  dataset_export: '数据集导出',
  audit_export: '审计导出',
  // 知识沉淀（员工经验）
  note_create: '新建沉淀',
  note_update: '修改沉淀',
  note_submit: '提报沉淀',
  note_review: '审核沉淀',
  note_archive: '归档沉淀',
  note_delete: '删除沉淀',
  note_export: '导出沉淀',
  note_distill: '生成经验',
  skill_config: '技能配置',
  // 提示词广场（通过后即全员可用，属公司资产准入）
  prompt_create: '新建提示词',
  prompt_update: '修改提示词',
  prompt_submit: '提报提示词',
  prompt_review: '审核提示词',
  prompt_delete: '删除提示词',
  // 公告（发布即面向全公司广播）
  announcement_create: '新建公告',
  announcement_update: '修改公告',
  announcement_publish: '公告上下线',
  announcement_delete: '删除公告',
  // 纠错反馈
  feedback: '纠错反馈',
  feedback_handled: '纠错处理',
  // 权限与风控
  tool_blocked: '越权拦截',
  forbidden: '越权访问',
  injection_detected: '注入痕迹',
  tool_toggle: '工具开关',
  settings_update: '模型配置变更',
  // 账号与凭据
  user_register: '注册申请',
  user_create: '开通账号',
  user_update: '修改账号',
  user_status: '启停账号',
  user_reset_password: '重置密码',
  user_delete: '删除账号',
}

/**
 * 每个视图的搜索字段由服务端决定，且**互不相同**：
 * 会话轨迹搜消息正文、工具调用搜工具名与参数、管理动作搜详情与目标 ID。
 * placeholder 必须跟着当前视图走 —— 在"管理动作"里按"搜索工具名"的提示去搜，
 * 只会得到空结果，而审计场景下"以为没有这条记录"是危险误判。
 */
const TAB_PLACEHOLDER: Record<string, string> = {
  runs: '搜索工具名或参数',
  blocked: '搜索工具名或参数',
  conversations: '搜索提问内容',
  logs: '搜索动作详情或目标',
}

type AuditTab =
  | 'runs'
  | 'blocked-runs'
  | 'blocked-logs'
  | 'conversations'
  | 'logs'
type ExportType = 'runs' | 'logs' | 'conversations'

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

/**
 * 把审计记录里的 JSON 压成一行键值摘要。
 *
 * 直接 `JSON.stringify` 的后果实测过：8 行里有 6 行详情一模一样
 * （`{"method":"GET","reason":"not_admin"}`），一列 40 个字符里 15 个是引号与花括号，
 * 真正有价值的"谁在反复探测哪个接口"被标点冲掉。压缩成 `method=GET · reason=not_admin`
 * 后同一屏能读到的信息量翻倍；完整原文仍在 `title` 里可查。
 */
function formatJsonSummary(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) {
    return value.length === 0 ? '—' : `[${value.length} 项]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return '—'
  return entries
    .map(([key, item]) => {
      if (item === null || item === undefined) return `${key}=—`
      if (typeof item === 'object') return `${key}=${JSON.stringify(item)}`
      return `${key}=${String(item)}`
    })
    .join(' · ')
}

export function AuditConsole() {
  const [tab, setTab] = useState<AuditTab>('runs')
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

  /*
   * 每次按键都触发 3 组带 count 的服务端查询，审计表体量大时输入明显卡顿。
   * 走全站共享的防抖 hook（对话工作台、数据源行详情等处同款），300ms。
   */
  const debouncedKeyword = useDebouncedValue(keyword)
  const filters = { keyword: debouncedKeyword.trim() || undefined }

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

  /**
   * 导出必须与列表共用同一组筛选。
   *
   * 此前只传了关键词：管理员在"工具调用明细"按「被拦截」筛完再导出，拿到的却是
   * **全量**记录的 CSV —— 而导出的 CSV 是要归档留证的，内容与屏幕不一致就是错的。
   * 服务端 `buildExport` 已支持 `status` / `action` / `keyword`，这里补齐。
   */
  const runExport = (type: ExportType) => {
    const params: Record<string, unknown> = { ...filters }
    if (type === 'runs' && runStatus !== 'all') params.status = runStatus
    if (type === 'logs' && logAction !== 'all') params.action = logAction
    exportAudit.mutate(
      { type, params },
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
          placeholder={TAB_PLACEHOLDER[tab]}
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
            <DropdownMenuItem onSelect={() => runExport('conversations')}>
              导出会话清单（CSV）
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/*
        指标条从 Tabs **外部**移到内部（2026-10-14）：
        原先它恒定显示"工具调用记录 / 被拦截调用 / 越权与拦截事件"三项，
        切到「会话轨迹」或「管理动作」后数字纹丝不动 —— 实测截图里会话轨迹视图
        顶部还挂着"工具调用记录 249"，而当前视图有多少条根本看不到。
        现在每个视图各带自己的口径，管理动作视图才有"共多少条"这个最基本的定位信息。
      */}
      <Tabs value={tab} onValueChange={(value) => setTab(value as AuditTab)}>
        <TabsList>
          <TabsTrigger value='runs'>工具调用明细</TabsTrigger>
          <TabsTrigger value='blocked-runs'>被拦截的工具调用</TabsTrigger>
          <TabsTrigger value='blocked-logs'>越权与拦截事件</TabsTrigger>
          <TabsTrigger value='conversations'>会话轨迹</TabsTrigger>
          <TabsTrigger value='logs'>管理动作</TabsTrigger>
        </TabsList>

        <TabsContent value='runs' className='space-y-3'>
          <MetricStrip
            items={[
              {
                label: '工具调用记录',
                value: runs.isLoading ? null : (runs.data?.total ?? 0),
                hint:
                  runStatus === 'all'
                    ? '全部状态'
                    : {
                        ok: '仅成功',
                        blocked: '仅被拦截',
                        error: '仅失败',
                        pending: '仅进行中',
                      }[runStatus],
              },
              {
                label: '被拦截调用',
                value: runs.isLoading
                  ? null
                  : warnIfPositive(runs.data?.blockedTotal ?? 0),
                hint: '全部账号',
              },
            ]}
          />
          <Card>
            <CardHeader className='flex-row items-center justify-between gap-2'>
              <div>
                <CardTitle className='text-base'>工具调用明细</CardTitle>
                <CardDescription>
                  含成功、被拦截、失败与进行中的每次调用。
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
                  {/*
                    服务端 RUN_STATUS 有 pending（进行中/卡住），此前下拉里没有它：
                    这类记录会出现在列表里却筛不出来，而"卡住没返回的调用"恰恰最该盯。
                  */}
                  <SelectItem value='pending'>进行中</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              <DataTable
                bordered={false}
                columns={7}
                density='compact'
                emptyText='没有匹配的调用记录。'
                header={
                  <TableRow>
                    <TableHead className='w-36'>时间</TableHead>
                    <TableHead className='w-24'>调用人</TableHead>
                    <TableHead className='w-44'>工具</TableHead>
                    <TableHead>调用参数</TableHead>
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
                    <TableCell className={cn(TABLE_CELL_META, 'tabular-nums')}>
                      {formatTime(run.createdAt)}
                    </TableCell>
                    <TableCell className={TABLE_CELL_META}>
                      {run.user.name ?? run.user.login}
                    </TableCell>
                    <TableCell className={TABLE_CELL_MONO}>
                      <code>{run.toolName}</code>
                    </TableCell>
                    <TableCell className={cn(TABLE_CELL_META, 'max-w-56')}>
                      {/* 参数刻意用 `truncate` 而不是 `break-all`：整段 JSON 换行会把每行撑到 5~8 行高，
                          一页 20 条就是"一次能看两条"。完整原文仍在 title 里。 */}
                      <span
                        className='block truncate'
                        title={JSON.stringify(run.params)}
                      >
                        {formatJsonSummary(run.params)}
                      </span>
                    </TableCell>
                    <TableCell className={cn(TABLE_CELL_META, 'max-w-72')}>
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

        {/*
          拦截记录的两个视角由「内层二级选项卡」拍平为**同级一级选项卡**（2026-10-14，
          按用户口径：三个治理页与经验审核保持同一骨架，不再有嵌套）。
          拍平后每个视角仍是独立组件，而 Radix 默认不渲染非激活的 TabsContent，
          因此各自的分页状态与查询依然只在切过去时才发生。
        */}
        <TabsContent value='blocked-runs'>
          {/* 关键词变化时重挂载，让分页回到第一页（否则改小结果集后可能停在越界页） */}
          <BlockedRunsPanel filters={filters} key={filters.keyword ?? 'all'} />
        </TabsContent>

        <TabsContent value='blocked-logs'>
          <BlockedLogsPanel filters={filters} key={filters.keyword ?? 'all'} />
        </TabsContent>

        <TabsContent value='conversations' className='space-y-3'>
          <MetricStrip
            items={[
              {
                label: '会话数',
                value: conversations.isLoading
                  ? null
                  : (conversations.data?.total ?? 0),
                hint: '当前关键词下',
              },
            ]}
          />
          <div className='grid gap-4 lg:grid-cols-[320px_1fr]'>
            <Card>
              <CardHeader>
                <CardTitle className='text-base'>会话轨迹</CardTitle>
                <CardDescription>点击查看完整问答与工具调用。</CardDescription>
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
                          {/* 标题是列表唯一的辨识信息，截断必须给 title 兜底：
                              实测两条会话都渲染成"亚马逊断货了怎么补货？流程是什么，有…"，无法区分 */}
                          <span className='block truncate' title={item.title}>
                            {item.title}
                          </span>
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
                  提问、每一步工具调用、回答与引用。
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
                                {/* 轨迹里也用同一套压缩口径：表格截断、轨迹全量展开会让同一条数据
                                    两处长不一样，用户无法建立预期 */}
                                <div title={JSON.stringify(run.params)}>
                                  参数：{formatJsonSummary(run.params)}
                                </div>
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

        <TabsContent value='logs' className='space-y-3'>
          <MetricStrip
            items={[
              {
                label: '管理动作',
                value: logs.isLoading ? null : (logs.data?.total ?? 0),
                hint:
                  logAction === 'all'
                    ? '全部动作'
                    : (ACTION_LABELS[logAction] ?? logAction),
              },
              {
                label: '越权与拦截事件',
                value: logs.isLoading
                  ? null
                  : warnIfPositive(logs.data?.blockedTotal ?? 0),
                hint: '越权访问 + 工具拦截',
              },
            ]}
          />
          <Card>
            <CardHeader className='flex-row items-center justify-between gap-2'>
              <div>
                <CardTitle className='text-base'>管理动作日志</CardTitle>
                <CardDescription>
                  账号、知识、沉淀、提示词、公告等 40 类管理动作。
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
                bordered={false}
                columns={5}
                density='compact'
                emptyText='没有匹配的日志。'
                header={
                  <TableRow>
                    <TableHead className='w-36'>时间</TableHead>
                    <TableHead className='w-24'>操作人</TableHead>
                    <TableHead className='w-32'>动作</TableHead>
                    <TableHead className='w-40'>目标</TableHead>
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
                    <TableCell className={cn(TABLE_CELL_META, 'tabular-nums')}>
                      {formatTime(log.createdAt)}
                    </TableCell>
                    <TableCell className={TABLE_CELL_META}>
                      {log.actor?.name ?? log.actor?.login ?? '系统'}
                    </TableCell>
                    <TableCell className='text-xs'>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </TableCell>
                    <TableCell className={cn(TABLE_CELL_META, 'truncate')}>
                      {log.targetType ?? '—'}
                      {log.targetId ? ` #${log.targetId}` : ''}
                    </TableCell>
                    <TableCell className={cn(TABLE_CELL_META, 'max-w-96')}>
                      <span
                        className='block truncate'
                        title={JSON.stringify(log.detail)}
                      >
                        {formatJsonSummary(log.detail)}
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
 * 「被拦截的工具调用」面板（2026-10-14 由 `BlockedPanel` 的内层选项卡拍平而来）。
 *
 * 拍平为一级选项卡后仍然**只在切到该 tab 时才发起查询**：Radix 默认不渲染非激活的
 * `TabsContent`，而查询 hook 就在本组件里，未激活时它压根不挂载。
 * 两张表的字段结构不同（工具调用视角 vs 审计日志视角），因此没有并成一张表。
 */
function BlockedRunsPanel({ filters }: { filters: { keyword?: string } }) {
  const [runPage, setRunPage] = useState(1)
  const [runPageSize, setRunPageSize] = useState(20)

  const blockedRuns = useAuditRuns({
    ...filters,
    status: 'blocked',
    page: runPage,
    pageSize: runPageSize,
  })
  const runRows = blockedRuns.data?.runs ?? []

  return (
    <div className='space-y-3'>
      <MetricStrip
        items={[
          {
            label: '被拦截的工具调用',
            value: blockedRuns.isLoading
              ? null
              : (blockedRuns.data?.total ?? 0),
            hint: '权限裁剪拦下',
          },
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            <ShieldAlert className='size-4 text-destructive' />
            被拦截的工具调用
          </CardTitle>
          <CardDescription>
            被权限裁剪拦下的请求最有审计价值；拦截文案对用户统一，避免权限探测。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            bordered={false}
            columns={6}
            density='compact'
            emptyText='没有匹配的拦截记录。'
            header={
              <TableRow>
                <TableHead className='w-36'>时间</TableHead>
                <TableHead className='w-24'>调用人</TableHead>
                <TableHead className='w-44'>工具</TableHead>
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
                <TableCell className={cn(TABLE_CELL_META, 'tabular-nums')}>
                  {formatTime(run.createdAt)}
                </TableCell>
                <TableCell className={TABLE_CELL_META}>
                  {run.user.name ?? run.user.login}
                </TableCell>
                <TableCell className={TABLE_CELL_MONO}>
                  <code>{run.toolName}</code>
                </TableCell>
                <TableCell className={cn(TABLE_CELL_META, 'max-w-56')}>
                  <span
                    className='block truncate'
                    title={JSON.stringify(run.params)}
                  >
                    {formatJsonSummary(run.params)}
                  </span>
                </TableCell>
                <TableCell className={cn(TABLE_CELL_META, 'max-w-72')}>
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
    </div>
  )
}

/** 「越权与拦截事件」面板（同由内层选项卡拍平而来，查询同样延迟到切过去时才发）。 */
function BlockedLogsPanel({ filters }: { filters: { keyword?: string } }) {
  const [logPage, setLogPage] = useState(1)
  const [logPageSize, setLogPageSize] = useState(20)

  const blockedLogs = useAuditLogs({
    ...filters,
    // 多动作合并筛选：越权访问与工具拦截对管理员是同一类事
    actions: 'tool_blocked,forbidden',
    page: logPage,
    pageSize: logPageSize,
  })
  const logRows = blockedLogs.data?.logs ?? []

  return (
    <div className='space-y-3'>
      <MetricStrip
        items={[
          {
            label: '越权与拦截事件',
            value: blockedLogs.isLoading
              ? null
              : (blockedLogs.data?.total ?? 0),
            hint: '越权访问 + 工具拦截',
          },
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>越权与拦截事件</CardTitle>
          <CardDescription>
            越权访问、工具拦截与注入痕迹等管理动作级事件。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            bordered={false}
            columns={5}
            density='compact'
            emptyText='没有匹配的越权或拦截事件。'
            header={
              <TableRow>
                <TableHead className='w-36'>时间</TableHead>
                <TableHead className='w-24'>操作人</TableHead>
                <TableHead className='w-32'>动作</TableHead>
                <TableHead className='w-40'>目标</TableHead>
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
                <TableCell className={cn(TABLE_CELL_META, 'tabular-nums')}>
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
                <TableCell className={cn(TABLE_CELL_META, 'truncate')}>
                  {log.targetType ?? '—'}
                  {log.targetId ? ` #${log.targetId}` : ''}
                </TableCell>
                <TableCell className={cn(TABLE_CELL_META, 'max-w-96')}>
                  <span
                    className='block truncate'
                    title={JSON.stringify(log.detail)}
                  >
                    {formatJsonSummary(log.detail)}
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
  if (status === 'pending') return <Badge variant='secondary'>进行中</Badge>
  return <Badge variant='secondary'>{status}</Badge>
}

/** 拦截类指标大于 0 时标红：0 是常态，非 0 才是需要看的事（保留原统计卡的告警语义）。 */
function warnIfPositive(value: number) {
  return value > 0 ? <span className='text-destructive'>{value}</span> : value
}

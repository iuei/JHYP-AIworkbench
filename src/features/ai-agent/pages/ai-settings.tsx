import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { TABLE_CELL_NUMERIC, TABLE_HEAD_NUMERIC } from '@/lib/table-styles'
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { TableCell, TableHead, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DataTable } from '@/components/data-table'
import {
  useAiSettings,
  useToggleTool,
  useUpdateAiSettings,
  useUsageStats,
} from '../api/queries'
import { McpCredentialsCard } from '../components/mcp-credentials-card'
import { ModelCredentialsCard } from '../components/model-credentials-card'
import { PageShell } from '../components/page-shell'
import { formatDate } from '../format'
import type { ToolInfo } from '../types'

/**
 * 「模型与配置」（管理员）：模型接入、卖家精灵 MCP、编排与成本护栏、工具开关、用量。
 *
 * 为什么从审计台的 tab 里搬出来：这些是**系统配置**（改密钥、改护栏、开关工具），
 * 而审计台的职责是"看历史"。混在一起的结果是新接手的管理员会去「设置」里找密钥却找不到。
 *
 * 信息层级（按用户反馈"内容过多、排版不合理"重整过一轮）：
 * - 每张卡只说属于自己的一件事，「模型名」只有一个可改入口（「模型接入」），
 *   护栏卡里改成只读回显 —— 此前两处都能改同一个字段、各带一个保存按钮，
 *   只改一处的人会以为改完了；
 * - "保存后即时生效、无需重启"全页只留一处，密钥加密口径只留一处完整说明；
 * - 五块内容按职责收进四个**页内平级选项卡**，一次只渲染一个（详见 PANELS 的注释）。
 */
const PANELS = {
  model: { label: '模型接入' },
  mcp: { label: '卖家精灵 MCP' },
  guard: { label: '护栏与工具' },
  usage: { label: '用量' },
} as const

type PanelKey = keyof typeof PANELS

/**
 * 页内四个子视图：**一次只渲染一个**（与「经验审核」同一骨架）。
 *
 * 改前是"卡片纵向堆叠"：模型接入、卖家精灵 MCP、护栏 + 用量（左右两列）、工具开关
 * 同屏叠加，首屏只能看到密钥卡，护栏与用量要滚过两张表单才够得着；而"护栏 + 用量"
 * 与"工具开关"拼成双列纯粹是为了消除单侧空白，两者在职责上并不同类。
 * 现在四个职责的入口形态统一：同一排选项卡，切换即达，同一时刻只有一个在场。
 *
 * 默认落在「模型接入」：改密钥/改模型名是本页最高频也最紧迫的动作，
 * 且与改前的渲染顺序（密钥卡在最前）一致，不改变既有的进入习惯。
 */
export function AiSettings() {
  const [panel, setPanel] = useState<PanelKey>('model')
  const settings = useAiSettings()
  const usage = useUsageStats(14)
  const updateSettings = useUpdateAiSettings()
  const toggleTool = useToggleTool()
  /** 卖家精灵工具可能有几十个，默认收起；工具开关的"启用数"在折叠行常显（折叠不藏信息）。 */
  const [mcpToolsOpen, setMcpToolsOpen] = useState(false)

  const tools = settings.data?.tools ?? []
  const mcpTools = tools.filter((tool) => tool.source === 'mcp')
  const builtinTools = tools.filter((tool) => tool.source !== 'mcp')
  const mcpEnabledCount = mcpTools.filter((tool) => tool.enabled).length
  const currentModelName = settings.data?.settings.modelName ?? ''

  const toggle = (name: string, enabled: boolean) =>
    toggleTool.mutate(
      { name, enabled },
      {
        onSuccess: () => toast.success('工具开关已更新'),
        onError: () => toast.error('更新失败'),
      }
    )

  return (
    <PageShell>
      {/*
        四个子视图用选项卡切换，**一次只渲染一个**（与「经验审核」同一骨架）。
        角标只放"不点开也该知道"的状态：MCP 工具的启用数常显在选项卡上 ——
        改前它是工具开关折叠行右侧的计数，收进子视图后不能因为别的子视图在场而消失。
      */}
      <Tabs
        value={panel}
        onValueChange={(value) => setPanel(value as PanelKey)}
      >
        <TabsList>
          {(Object.keys(PANELS) as PanelKey[]).map((key) => (
            <TabsTrigger className='gap-1.5' key={key} value={key}>
              {PANELS[key].label}
              {key === 'mcp' && mcpTools.length > 0 && (
                <Badge className='font-normal' variant='outline'>
                  已启用 {mcpEnabledCount}/{mcpTools.length}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value='model'>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>模型接入</CardTitle>
              <CardDescription>
                填写模型服务的 Base URL、模型名与 API Key，保存后
                <strong>即时生效、无需重启</strong>
                ；后台配置优先于服务器环境变量。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settings.isLoading && <Skeleton className='h-40 w-full' />}
              {settings.data && (
                <ModelCredentialsCard
                  secretsReady={settings.data.secretsReady ?? { ok: true }}
                  settings={settings.data.settings}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value='mcp'>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>
                卖家精灵 MCP（外部数据工具）
              </CardTitle>
              <CardDescription>
                接入后，亚马逊数据（ASIN
                详情、关键词、市场、商标等）会注册为模型工具，回答里可直接引用。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {settings.isLoading && <Skeleton className='h-40 w-full' />}
              {settings.data && (
                <McpCredentialsCard
                  secretsReady={settings.data.secretsReady ?? { ok: true }}
                  settings={settings.data.settings}
                  toolCounts={
                    settings.data.mcpTools ?? { total: 0, enabled: 0 }
                  }
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/*
          护栏是三项数值的短表单，工具开关是（内置 + 数十个 MCP）的长列表，两者职责不同类：
          改前把它们拼成左右两列只是为了消除单侧空白，结果矮的那列下方留出一大片空。
          现在两张卡各占整宽、纵向堆叠，工具开关里的"关掉会影响什么"也少折行。
        */}
        <TabsContent className='space-y-4' value='guard'>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>编排与成本护栏</CardTitle>
              <CardDescription>
                控制单轮对话的成本上限：轮次越多、检索片段越多，token 消耗越高。
              </CardDescription>
            </CardHeader>
            {/* 三项数值在宽屏并排、窄屏堆叠：卡片独占整宽后，数字输入框若继续拉满
                一行会宽得离谱（空得比护栏内容还显眼），栅格化后每格宽度与改前的左列相当 */}
            <CardContent className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
              {settings.isLoading && (
                <Skeleton className='h-32 w-full sm:col-span-2 lg:col-span-3' />
              )}
              {settings.data && (
                <>
                  {/* 模型名的唯一可改入口在「模型接入」卡，这里只读回显，避免两处各有一个保存按钮 */}
                  <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-dashed px-3 py-2 sm:col-span-2 lg:col-span-3'>
                    <span className='flex min-w-0 items-center gap-2'>
                      <span className='shrink-0 text-xs text-muted-foreground'>
                        模型名
                      </span>
                      <span
                        className='truncate text-sm font-medium'
                        title={currentModelName}
                      >
                        {currentModelName}
                      </span>
                    </span>
                    <span className='shrink-0 text-xs text-muted-foreground'>
                      在「模型接入」中修改
                    </span>
                  </div>
                  <SettingRow
                    key={`turns-${settings.data.settings.maxTurnsPerConversation}`}
                    label='单会话轮次上限'
                    value={String(
                      settings.data.settings.maxTurnsPerConversation
                    )}
                    onSave={(value) =>
                      updateSettings.mutate({
                        maxTurnsPerConversation: Number(value),
                      })
                    }
                  />
                  <SettingRow
                    key={`topk-${settings.data.settings.retrievalTopK}`}
                    label='检索 top-k'
                    value={String(settings.data.settings.retrievalTopK)}
                    onSave={(value) =>
                      updateSettings.mutate({ retrievalTopK: Number(value) })
                    }
                  />
                  <SettingRow
                    key={`timeout-${settings.data.settings.requestTimeoutMs}`}
                    label='请求超时 (ms)'
                    value={String(settings.data.settings.requestTimeoutMs)}
                    onSave={(value) =>
                      updateSettings.mutate({ requestTimeoutMs: Number(value) })
                    }
                  />
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='text-base'>工具开关</CardTitle>
              <CardDescription>
                停用后该工具对所有人都不再注册给模型（含管理员）。
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              {builtinTools.map((tool) => (
                <ToolSwitch key={tool.name} tool={tool} onToggle={toggle} />
              ))}

              {mcpTools.length > 0 && (
                <Collapsible open={mcpToolsOpen} onOpenChange={setMcpToolsOpen}>
                  <div className='border-t pt-3'>
                    <CollapsibleTrigger asChild>
                      <Button
                        aria-expanded={mcpToolsOpen}
                        className='h-auto w-full justify-between gap-2 px-0 py-1 text-xs text-muted-foreground hover:bg-transparent'
                        variant='ghost'
                      >
                        <span className='inline-flex items-center gap-1.5'>
                          <ChevronDown
                            className={cn(
                              'size-3.5 transition-transform',
                              mcpToolsOpen && 'rotate-180'
                            )}
                          />
                          卖家精灵 MCP 工具
                        </span>
                        {/* 折叠不藏信息：不点开也能看到有多少个在生效 */}
                        <span>
                          已启用 {mcpEnabledCount}/{mcpTools.length}
                        </span>
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className='space-y-3 pt-3'>
                      {mcpTools.map((tool) => (
                        <ToolSwitch
                          key={tool.name}
                          tool={tool}
                          onToggle={toggle}
                        />
                      ))}
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/*
          用量独立成一个子视图后，它不再需要"展开 / 收起明细"的折叠按钮 ——
          选项卡本身就是按需切换的入口，表格在该子视图内直接常显。
        */}
        <TabsContent value='usage'>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>近 14 天用量</CardTitle>
              <CardDescription>按天聚合的回答数与 token 消耗。</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={4}
                emptyText='暂无用量数据。'
                isEmpty={(usage.data ?? []).length === 0}
                isLoading={usage.isLoading}
                header={
                  <TableRow>
                    <TableHead>日期</TableHead>
                    <TableHead className={TABLE_HEAD_NUMERIC}>回答数</TableHead>
                    <TableHead className={TABLE_HEAD_NUMERIC}>
                      输入 token
                    </TableHead>
                    <TableHead className={TABLE_HEAD_NUMERIC}>
                      输出 token
                    </TableHead>
                  </TableRow>
                }
              >
                {(usage.data ?? []).map((row) => (
                  <TableRow key={row.day}>
                    <TableCell className='text-xs'>
                      {formatDate(row.day)}
                    </TableCell>
                    <TableCell className={TABLE_CELL_NUMERIC}>
                      {row.answers}
                    </TableCell>
                    <TableCell className={TABLE_CELL_NUMERIC}>
                      {row.tokensIn}
                    </TableCell>
                    <TableCell className={TABLE_CELL_NUMERIC}>
                      {row.tokensOut}
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
 * 内置工具的中文短名与"关掉它会影响什么"。
 *
 * 为什么不直接把 `tool.description` 铺在行里：那份描述是写给**模型**看的
 * （写满调用时机、参数边界、与其它工具的区分，最长的一条接近 400 字），
 * 贴进管理页等于把"一眼看懂"换成"再读一篇文档"。远端 MCP 工具没有本地文案，
 * 退化为描述首句（截断成一行展示，英文工具名与所需角色留在 title 上）。
 */
const TOOL_LABELS: Record<string, { label: string; impact: string }> = {
  search_knowledge: {
    label: '知识库检索',
    impact: '制度、流程、SOP、员工经验类问题将拿不到知识库内容',
  },
  rebuild_knowledge_index: {
    label: '重建知识索引',
    impact: '新上传的文档无法立即被检索到，需到知识库页手工重建',
  },
  deactivate_document: {
    label: '下线知识文档',
    impact: '对话里无法下线文档，需到知识库页操作',
  },
  query_amazon_performance: {
    label: '亚马逊广告与销售表现',
    impact: 'ACoS、广告效果、销量波动、同比环比类问题无法取数',
  },
  query_inventory_orders: {
    label: '库存与订单查询',
    impact: '库存数量、在途、占用与订单状态类问题无法取数',
  },
  scan_amazon_anomalies: {
    label: '全站异常扫描',
    impact: '「哪些 ASIN 出问题了」这类全站筛查无法执行',
  },
  analyze_inventory_risk: {
    label: '库存风险分析',
    impact: '断货 / 积压 / 滞销判定与补货建议无法给出',
  },
  query_my_asins: {
    label: '我的 ASIN 表现',
    impact: '「我负责的这批商品表现如何」无法取数',
  },
  query_competitor_analysis: {
    label: '调取竞品分析记录',
    impact: '对话无法调取已保存的竞品分析结论（本工具不消耗额度）',
  },
}

/** 取工具的中文文案；没有登记的工具（如远端同步进来的）用描述首句兜底。 */
function describeTool(tool: ToolInfo): { label: string; impact: string } {
  const known = TOOL_LABELS[tool.name]
  if (known) return known
  const [sentence = ''] = tool.description
    .replace(/\*\*/g, '')
    .split(/[。；;\n]/)
  return { label: sentence.trim() || tool.name, impact: '' }
}

/**
 * 单个工具开关。内置工具与 MCP 工具共用同一行渲染 —— 两者的"停用即不注册给模型"
 * 语义完全一致，差异只体现在来源标注上。
 *
 * 行内容只留"这是什么 + 关掉会怎样"：英文工具名与所需角色收进 title，
 * 「仅管理员」这类少数派角色用徽章常显（9 个内置工具里只有 2 个是管理员专属，
 * 每行都写一遍「所需角色」等于把最有价值的一行信息摊成噪音）。
 */
function ToolSwitch({
  tool,
  onToggle,
}: {
  tool: ToolInfo
  onToggle: (name: string, enabled: boolean) => void
}) {
  const { label, impact } = describeTool(tool)
  const roleText = tool.requiredRole === 'admin' ? '仅管理员可用' : '全员可用'
  const isAdminTool = tool.requiredRole === 'admin'

  return (
    <div
      className='flex items-center justify-between gap-3'
      title={`工具名：${tool.name} · 所需角色：${roleText}`}
    >
      <div className='min-w-0 space-y-0.5'>
        <p className='flex min-w-0 items-center gap-1.5 text-sm font-medium'>
          <span className='truncate'>{label}</span>
          {isAdminTool && (
            <Badge className='shrink-0 font-normal' variant='outline'>
              仅管理员
            </Badge>
          )}
          {tool.source === 'mcp' && (
            <Badge className='shrink-0 font-normal' variant='outline'>
              卖家精灵
            </Badge>
          )}
        </p>
        {impact && (
          <p className='truncate text-xs text-muted-foreground'>{impact}</p>
        )}
      </div>
      <Switch
        aria-label={`启用 ${label}`}
        checked={tool.enabled}
        onCheckedChange={(checked) => onToggle(tool.name, checked)}
      />
    </div>
  )
}

/** 单项配置编辑。调用方用 key 绑定当前值，值变化时重挂载，因而无需在 effect 中同步状态。 */
function SettingRow({
  label,
  value,
  onSave,
}: {
  label: string
  value: string
  onSave: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)

  return (
    <div className='flex items-end gap-2'>
      <div className='flex-1 space-y-1'>
        <label className='text-xs text-muted-foreground'>{label}</label>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      <Button
        disabled={draft === value || !draft.trim()}
        size='sm'
        variant='outline'
        onClick={() => onSave(draft.trim())}
      >
        保存
      </Button>
    </div>
  )
}

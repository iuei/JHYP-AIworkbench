import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { TABLE_CELL_NUMERIC, TABLE_HEAD_NUMERIC } from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
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
import { DataTable } from '@/components/data-table'
import { useAiSettings, useToggleTool, useUpdateAiSettings, useUsageStats } from '../api/queries'
import { McpCredentialsCard } from '../components/mcp-credentials-card'
import { ModelCredentialsCard } from '../components/model-credentials-card'
import { PageShell } from '../components/page-shell'
import { formatDate } from '../format'
import type { ToolInfo } from '../types'

/**
 * 「模型与配置」（管理员）：模型接入、编排与成本护栏、工具开关、用量。
 *
 * 为什么从审计台的 tab 里搬出来：这些是**系统配置**（改密钥、改护栏、开关工具），
 * 而审计台的职责是"看历史"。混在一起的结果是新接手的管理员会去「设置」里找密钥却找不到。
 */
export function AiSettings() {
  const settings = useAiSettings()
  const usage = useUsageStats(14)
  const updateSettings = useUpdateAiSettings()
  const toggleTool = useToggleTool()
  /** 用量明细默认收起：它是"偶尔看一眼"的分析信息，与上面的配置项不是一类内容。 */
  const [usageOpen, setUsageOpen] = useState(false)
  /** 卖家精灵工具可能有几十个，默认收起；工具开关的"启用数"在折叠行常显（折叠不藏信息）。 */
  const [mcpToolsOpen, setMcpToolsOpen] = useState(false)

  const tools = settings.data?.tools ?? []
  const mcpTools = tools.filter((tool) => tool.source === 'mcp')
  const builtinTools = tools.filter((tool) => tool.source !== 'mcp')
  const mcpEnabledCount = mcpTools.filter((tool) => tool.enabled).length

  return (
    <PageShell>
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>模型接入</CardTitle>
          <CardDescription>
            填写模型服务的 Base URL 与 API Key，保存后
            <strong>即时生效、无需重启</strong>
            ；优先级高于服务器环境变量。密钥加密存储，页面只显示掩码。
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

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>卖家精灵 MCP（外部数据工具）</CardTitle>
          <CardDescription>
            接入卖家精灵 MCP 后，亚马逊数据（ASIN 详情、关键词、市场、商标等）会作为工具注册给模型，
            回答里就能直接带出这些数据。密钥加密存储、只显示掩码；保存后
            <strong>即时生效、无需重启</strong>。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settings.isLoading && <Skeleton className='h-40 w-full' />}
          {settings.data && (
            <McpCredentialsCard
              secretsReady={settings.data.secretsReady ?? { ok: true }}
              settings={settings.data.settings}
              toolCounts={settings.data.mcpTools ?? { total: 0, enabled: 0 }}
            />
          )}
        </CardContent>
      </Card>

      <div className='grid gap-4 lg:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>编排与成本护栏</CardTitle>
            <CardDescription>
              单会话轮次上限、检索 top-k 等成本护栏在此调整，保存后立即生效。
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            {settings.isLoading && <Skeleton className='h-32 w-full' />}
            {settings.data && (
              <>
                <SettingRow
                  key={`model-name-${settings.data.settings.modelName}`}
                  label='模型名'
                  value={settings.data.settings.modelName}
                  onSave={(value) =>
                    updateSettings.mutate({ modelName: value })
                  }
                />
                <SettingRow
                  key={`turns-${settings.data.settings.maxTurnsPerConversation}`}
                  label='单会话轮次上限'
                  value={String(settings.data.settings.maxTurnsPerConversation)}
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
                <p className='text-xs text-muted-foreground'>
                  修改后立即对新会话生效；护栏调得越宽，单轮对话的 token
                  成本越高。
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <div className='space-y-4'>
          <Card>
            <CardHeader>
              <CardTitle className='text-base'>工具开关</CardTitle>
              <CardDescription>
                停用后该工具对所有人都不再注册给模型（含管理员）。
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              {builtinTools.map((tool) => (
                <ToolSwitch
                  key={tool.name}
                  tool={tool}
                  onToggle={(name, enabled) =>
                    toggleTool.mutate({ name, enabled }, {
                      onSuccess: () => toast.success('工具开关已更新'),
                      onError: () => toast.error('更新失败'),
                    })
                  }
                />
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
                          onToggle={(name, enabled) =>
                            toggleTool.mutate({ name, enabled }, {
                              onSuccess: () => toast.success('工具开关已更新'),
                              onError: () => toast.error('更新失败'),
                            })
                          }
                        />
                      ))}
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              )}
            </CardContent>
          </Card>

          <Collapsible open={usageOpen} onOpenChange={setUsageOpen}>
            <Card>
              <CardHeader className='gap-1'>
                <CardTitle className='text-base'>近 14 天用量</CardTitle>
                <CardDescription>
                  按天聚合的回答数与 token 消耗。
                </CardDescription>
                <CardAction>
                  {/* 用量是"偶尔看一眼"的分析数据，收起后两张配置卡可以并排完整呈现 */}
                  <CollapsibleTrigger asChild>
                    <Button
                      aria-expanded={usageOpen}
                      className='gap-1.5 px-2 text-xs text-muted-foreground'
                      size='sm'
                      variant='ghost'
                    >
                      <ChevronDown
                        className={cn(
                          'size-3.5 transition-transform',
                          usageOpen && 'rotate-180'
                        )}
                      />
                      {usageOpen ? '收起明细' : '展开明细'}
                    </Button>
                  </CollapsibleTrigger>
                </CardAction>
              </CardHeader>
              <CollapsibleContent>
                <CardContent>
                  <DataTable
                    columns={4}
                    emptyText='暂无用量数据。'
                    isEmpty={(usage.data ?? []).length === 0}
                    isLoading={usage.isLoading}
                    header={
                      <TableRow>
                        <TableHead>日期</TableHead>
                        <TableHead className={TABLE_HEAD_NUMERIC}>
                          回答数
                        </TableHead>
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
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
      </div>
    </PageShell>
  )
}

/**
 * 单个工具开关。内置工具与 MCP 工具共用同一行渲染 —— 两者的"停用即不注册给模型"
 * 语义完全一致，差异只体现在来源标注上。
 */
function ToolSwitch({
  tool,
  onToggle,
}: {
  tool: ToolInfo
  onToggle: (name: string, enabled: boolean) => void
}) {
  return (
    <div className='flex items-center justify-between gap-3'>
      <div className='min-w-0'>
        <p className='flex items-center gap-1.5 text-sm font-medium'>
          <code className='truncate'>{tool.name}</code>
          {tool.source === 'mcp' && (
            <Badge className='shrink-0 font-normal' variant='outline'>
              卖家精灵
            </Badge>
          )}
        </p>
        <p className='text-xs text-muted-foreground'>
          所需角色：
          {tool.requiredRole === 'admin' ? '管理员' : '普通用户'}
        </p>
      </div>
      <Switch
        aria-label={`启用 ${tool.name}`}
        checked={tool.enabled}
        onCheckedChange={(checked) => onToggle(tool.name, checked)}
      />
    </div>
  )
}

/** 单项配置编辑。调用方用 key 绑定当前值，值变化时重挂载，因而无需在 effect 中同步状态。 */
function SettingRow({  label,
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

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  useAiSettings,
  useToggleTool,
  useUpdateAiSettings,
  useUsageStats,
} from '../api/queries'
import { ModelCredentialsCard } from '../components/model-credentials-card'
import { PageShell } from '../components/page-shell'
import { formatDate } from '../format'

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

  return (
    <PageShell
    >
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
                  token 用量由 ai_messages 聚合，不额外建表。
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
                停用后该工具对所有人都不再注册给模型（权限裁剪层①直接生效）。
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              {(settings.data?.tools ?? []).map((tool) => (
                <div
                  className='flex items-center justify-between gap-3'
                  key={tool.name}
                >
                  <div className='min-w-0'>
                    <p className='text-sm font-medium'>
                      <code>{tool.name}</code>
                    </p>
                    <p className='text-xs text-muted-foreground'>
                      所需角色：
                      {tool.requiredRole === 'admin' ? '管理员' : '普通用户'}
                    </p>
                  </div>
                  <Switch
                    aria-label={`启用 ${tool.name}`}
                    checked={tool.enabled}
                    onCheckedChange={(checked) =>
                      toggleTool.mutate(
                        { name: tool.name, enabled: checked },
                        {
                          onSuccess: () => toast.success('工具开关已更新'),
                          onError: () => toast.error('更新失败'),
                        }
                      )
                    }
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className='text-base'>近 14 天用量</CardTitle>
              <CardDescription>按天聚合的回答数与 token 消耗。</CardDescription>
            </CardHeader>
            <CardContent>
              {(usage.data ?? []).length === 0 ? (
                <p className='text-sm text-muted-foreground'>暂无用量数据。</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>日期</TableHead>
                      <TableHead>回答数</TableHead>
                      <TableHead>输入 token</TableHead>
                      <TableHead>输出 token</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(usage.data ?? []).map((row) => (
                      <TableRow key={row.day}>
                        <TableCell className='text-xs'>
                          {formatDate(row.day)}
                        </TableCell>
                        <TableCell className='text-xs'>{row.answers}</TableCell>
                        <TableCell className='text-xs'>
                          {row.tokensIn}
                        </TableCell>
                        <TableCell className='text-xs'>
                          {row.tokensOut}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
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

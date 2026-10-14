import { useState } from 'react'
import {
  ChevronDown,
  KeyRound,
  Loader2,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  useSyncMcpTools,
  useTestMcpConnection,
  useUpdateAiSettings,
} from '../api/queries'
import { apiErrorMessage, formatTime } from '../format'
import { splitEndpointSecret } from '../mcp-endpoint'
import type { AiSettings } from '../types'

const KEY_SOURCE_LABELS: Record<string, string> = {
  database: '后台配置',
  environment: '环境变量',
  none: '未配置',
}

/**
 * 后端可能还是不带 MCP 字段的旧版本（前端先发布、API 未重启）。
 * 责任田文档记过同类事故：新增必返字段缺失会让整页白屏，因此这里一律走 `??` 兜底。
 */
const DEFAULT_ENDPOINT = 'https://mcp.sellersprite.com/mcp'
const DEFAULT_PREFIX = 'sellersprite'
const DEFAULT_TIMEOUT_MS = 30000

/**
 * 卖家精灵（SellerSprite）MCP 配置块。
 *
 * 为什么集成方式值得写在这里而不是只藏在代码里：密钥**不会**随工具同步一起生效，
 * 它有四步（填密钥 → 保存 → 测试 → 同步工具清单），任何一步漏掉的表现都是
 * 「配置看起来都对，但模型查不到数据」。界面因此把状态摊开：
 * 就绪与否、密钥掩码、已同步工具数各自独立可见。
 *
 * 安全与隐私口径与模型密钥完全一致：明文只在提交的那一次请求里存在，
 * 已保存的密钥只回显掩码，留空即"不修改"。
 */
export function McpCredentialsCard({
  settings,
  secretsReady,
  toolCounts,
}: {
  settings: AiSettings
  secretsReady: { ok: boolean; message?: string }
  toolCounts: { total: number; enabled: number }
}) {
  const [secret, setSecret] = useState('')
  const savedEndpoint = settings.mcpEndpoint ?? DEFAULT_ENDPOINT
  const savedPrefix = settings.mcpPrefix ?? DEFAULT_PREFIX
  const savedTimeoutMs = settings.mcpTimeoutMs ?? DEFAULT_TIMEOUT_MS
  const [endpoint, setEndpoint] = useState(savedEndpoint)
  const [prefix, setPrefix] = useState(savedPrefix)
  const [timeoutMs, setTimeoutMs] = useState(String(savedTimeoutMs))
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    message: string
  } | null>(null)

  const update = useUpdateAiSettings()
  const test = useTestMcpConnection()
  const sync = useSyncMcpTools()

  const secretDirty = secret.trim().length > 0
  const dirty =
    secretDirty ||
    endpoint.trim() !== savedEndpoint ||
    prefix.trim() !== savedPrefix ||
    Number(timeoutMs) !== savedTimeoutMs

  const save = (payload: Record<string, unknown>, successText: string) => {
    update.mutate(payload as never, {
      onSuccess: () => {
        toast.success(successText)
        setSecret('')
        setTestResult(null)
      },
      onError: (error) =>
        toast.error(apiErrorMessage(error, '保存失败，请稍后重试')),
    })
  }

  /** 保存前先把端点里的密钥搬到密钥框：用户在界面上要看得见这次搬运，否则会以为密钥被丢了。 */
  const saveWithEndpointSecret = () => {
    const split = splitEndpointSecret(endpoint)
    if (split) {
      setEndpoint(split.endpoint)
      setSecret(split.secret)
      toast.info('已把端点 URL 里的密钥移到下方「MCP 密钥」框，请保存')
      return
    }
    save(
      {
        mcpEndpoint: endpoint.trim(),
        mcpPrefix: prefix.trim(),
        mcpTimeoutMs: Number(timeoutMs),
        ...(secretDirty ? { mcpSecret: secret.trim() } : {}),
      },
      'MCP 配置已保存'
    )
  }

  const runTest = () => {
    setTestResult(null)
    // 端点里带着密钥时也照测（服务端两种取值都支持），但同样提示该把它填到密钥框
    const split = splitEndpointSecret(endpoint)
    if (split) {
      setEndpoint(split.endpoint)
      setSecret(secretDirty ? secret : split.secret)
      toast.info('已把端点 URL 里的密钥移到下方「MCP 密钥」框')
    }
    test.mutate(
      {
        mcpEndpoint: split ? split.endpoint : endpoint.trim(),
        mcpSecret: secretDirty ? secret.trim() : split?.secret,
      },
      {
        onSuccess: (result) => {
          setTestResult({ ok: result.ok, message: result.message })
          if (result.ok) toast.success(result.message)
        },
        onError: (error) =>
          setTestResult({
            ok: false,
            message: apiErrorMessage(error, '测试失败'),
          }),
      }
    )
  }

  const runSync = () => {
    sync.mutate(undefined, {
      onSuccess: (result) => toast.success(result.message),
      onError: (error) =>
        toast.error(apiErrorMessage(error, '同步失败，请稍后重试')),
    })
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2 text-xs'>
        <span className='text-muted-foreground'>当前状态：</span>
        <Badge variant={settings.mcpReady ? 'secondary' : 'outline'}>
          {settings.mcpReady
            ? '已就绪'
            : settings.mcpEnabled
              ? '未就绪'
              : '未启用'}
        </Badge>
        <Badge className='font-normal' variant='outline'>
          密钥来源：
          {KEY_SOURCE_LABELS[settings.mcpKeySource ?? 'none'] ??
            settings.mcpKeySource}
        </Badge>
        {toolCounts.total > 0 && (
          <Badge className='font-normal' variant='outline'>
            已同步工具：{toolCounts.enabled}/{toolCounts.total} 启用
          </Badge>
        )}
        {settings.mcpSecretConfigured && (
          <span className='inline-flex items-center gap-1 text-muted-foreground'>
            <ShieldCheck className='size-3.5' />
            已保存 {settings.mcpSecretHint}
          </span>
        )}
      </div>

      {settings.mcpSecretInvalid && (
        <p
          className='flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive'
          role='alert'
        >
          <ShieldAlert className='mt-0.5 size-3.5 shrink-0' />
          已保存的 MCP 密钥无法解密（通常是服务器的 AI_SETTINGS_SECRET /
          JWT_SECRET 变更过）。请重新填写一次密钥。
        </p>
      )}

      {!secretsReady.ok && (
        <p className='rounded-lg border border-dashed p-3 text-xs text-muted-foreground'>
          未配置加密密钥，暂不能保存 MCP 密钥：{secretsReady.message}
          <br />
          请在服务器 .env 中设置 <code>AI_SETTINGS_SECRET</code>（或复用{' '}
          <code>JWT_SECRET</code>）后重启 API。
        </p>
      )}

      <div className='space-y-2'>
        <Label htmlFor='mcp-endpoint'>MCP 端点</Label>
        <Input
          id='mcp-endpoint'
          placeholder='https://mcp.sellersprite.com/mcp'
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
        />
        <p className='text-xs text-muted-foreground'>
          卖家精灵的 Streamable HTTP 地址（POST 接口，结尾不要加斜杠，带斜杠会
          404）。
        </p>
      </div>

      <div className='space-y-2'>
        <Label htmlFor='mcp-secret'>MCP 密钥</Label>
        <Input
          autoComplete='off'
          id='mcp-secret'
          placeholder={
            settings.mcpSecretConfigured
              ? `已保存 ${settings.mcpSecretHint}，留空则不修改`
              : '填入卖家精灵开放平台的密钥'
          }
          type='password'
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
        />
        <p className='flex items-start gap-1.5 text-xs text-muted-foreground'>
          <KeyRound className='mt-0.5 size-3.5 shrink-0' />
          在卖家精灵开放平台「我的密钥」创建（MCP 密钥与 API Key
          是两套，别拿错）；密钥加密存储、只显示掩码。
        </p>
      </div>

      {/* 关键差异放在按钮**之前**：此前这段在按钮组下方，用户点完才看到"还差一步" */}
      <p className='text-xs text-muted-foreground'>
        「测试连接」只验证密钥与端点；工具要能被模型调用，必须再点「同步工具」。
      </p>

      <div className='flex flex-wrap items-center gap-2'>
        <Button
          disabled={!dirty || update.isPending}
          onClick={saveWithEndpointSecret}
        >
          {update.isPending && <Loader2 className='animate-spin' />}
          保存配置
        </Button>
        <Button
          disabled={test.isPending}
          title='只验证密钥与端点是否可用：不发业务请求、不消耗卖家精灵额度、不写库。'
          variant='outline'
          onClick={runTest}
        >
          {test.isPending ? <Loader2 className='animate-spin' /> : <PlugZap />}
          测试连接
        </Button>
        <Button
          disabled={sync.isPending}
          title='把远端工具清单写入工具注册表：远端已下线的工具会被移除，你在「工具开关」里的启停设置不受影响。'
          variant='outline'
          onClick={runSync}
        >
          {sync.isPending ? (
            <Loader2 className='animate-spin' />
          ) : (
            <RefreshCw />
          )}
          同步工具
        </Button>
        {settings.mcpSecretConfigured && (
          <Button
            className='text-destructive'
            disabled={update.isPending}
            variant='ghost'
            onClick={() => save({ mcpSecret: null }, '已清除 MCP 密钥')}
          >
            清除密钥
          </Button>
        )}
      </div>

      {testResult && (
        <p
          className={cn(
            'rounded-lg border p-3 text-xs',
            testResult.ok
              ? 'border-primary/40 bg-primary/5 text-foreground'
              : 'border-destructive/40 bg-destructive/5 text-destructive'
          )}
          role='status'
        >
          {testResult.message}
        </p>
      )}

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button
            aria-expanded={advancedOpen}
            className='h-auto w-full justify-between gap-2 px-0 py-2 text-xs text-muted-foreground hover:bg-transparent'
            variant='ghost'
          >
            <span className='inline-flex items-center gap-1.5'>
              <ChevronDown
                className={cn(
                  'size-3.5 transition-transform',
                  advancedOpen && 'rotate-180'
                )}
              />
              高级设置
            </span>
            {/* 折叠不藏信息：不点开也能看到当前生效值 */}
            <span className='truncate'>
              前缀 {savedPrefix} · 超时 {Math.round(savedTimeoutMs / 1000)}s
            </span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className='space-y-3 pt-2'>
          <div className='space-y-2'>
            <Label htmlFor='mcp-prefix'>工具名前缀</Label>
            <Input
              id='mcp-prefix'
              value={prefix}
              onChange={(event) => setPrefix(event.target.value)}
            />
            <p className='text-xs text-muted-foreground'>
              远端工具会以 <code>{savedPrefix}__工具名</code>{' '}
              的形式注册，避免与内置工具重名。<b>改前缀后必须重新同步工具</b>
              ，否则旧工具名会失效。
            </p>
          </div>
          <div className='space-y-2'>
            <Label htmlFor='mcp-timeout'>单次调用超时 (ms)</Label>
            <Input
              id='mcp-timeout'
              value={timeoutMs}
              onChange={(event) => setTimeoutMs(event.target.value)}
            />
            <p className='text-xs text-muted-foreground'>
              取值范围 3000-120000。卖家精灵的额度按<b>HTTP 请求次数</b>
              计费，一次问答里模型可能连续调用多次，建议只启用常用的工具以同时降低额度消耗与上下文长度。
            </p>
          </div>
          {settings.mcpSyncedAt && (
            <p className='text-xs text-muted-foreground'>
              上次同步工具清单：{formatTime(settings.mcpSyncedAt)}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>

      <div className='flex items-center justify-between gap-3 border-t pt-4'>
        <div>
          <p className='text-sm font-medium'>启用卖家精灵 MCP</p>
          <p className='text-xs text-muted-foreground'>
            关闭后已同步的卖家精灵工具对所有人都不再注册给模型（含管理员），
            配置与工具开关都保留，重新打开即恢复。
          </p>
        </div>
        <Switch
          aria-label='启用卖家精灵 MCP'
          checked={settings.mcpEnabled}
          onCheckedChange={(checked) =>
            save(
              { mcpEnabled: checked },
              checked ? '已启用卖家精灵 MCP' : '已停用卖家精灵 MCP'
            )
          }
        />
      </div>

      <p className='text-xs text-muted-foreground'>
        注意：卖家精灵《密钥使用规范》约定 MCP
        授权「个人使用」，并限制同一密钥被多主体、
        多客户端共享。请按其最新条款使用（如需多人共享，官方指引是改用 API
        服务）。
      </p>
    </div>
  )
}

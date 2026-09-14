import { useState } from 'react'
import {
  KeyRound,
  Loader2,
  PlugZap,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useSaveModelCredentials, useTestModelConnection } from '../api/queries'
import type { AiSettings } from '../types'

const KEY_SOURCE_LABELS: Record<string, string> = {
  database: '后台配置',
  environment: '环境变量',
  none: '未配置',
}

/**
 * 模型凭据配置块。
 *
 * 安全约束（前端侧）：
 * - 已保存的密钥只显示掩码，输入框永远不回填明文；
 * - 留空表示"不修改"，要清除必须显式点「清除密钥」；
 * - 「测试连接」可用尚未保存的候选参数先测后存，避免存错配置再回滚。
 */
export function ModelCredentialsCard({
  settings,
  secretsReady,
}: {
  settings: AiSettings
  secretsReady: { ok: boolean; message?: string }
}) {
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(settings.modelBaseUrl)
  const [modelName, setModelName] = useState(settings.modelName)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    message: string
  } | null>(null)

  const save = useSaveModelCredentials()
  const test = useTestModelConnection()

  const keyDirty = apiKey.trim().length > 0
  const dirty =
    keyDirty ||
    baseUrl.trim() !== settings.modelBaseUrl ||
    modelName.trim() !== settings.modelName

  const runTest = () => {
    setTestResult(null)
    test.mutate(
      {
        modelApiKey: keyDirty ? apiKey.trim() : undefined,
        modelBaseUrl: baseUrl.trim(),
        modelName: modelName.trim(),
      },
      {
        onSuccess: (result) => {
          setTestResult({ ok: result.ok, message: result.message })
          if (result.ok) toast.success(result.message)
        },
        onError: (error) => {
          const message = error instanceof Error ? error.message : '测试失败'
          setTestResult({ ok: false, message })
        },
      }
    )
  }

  const submit = (payload: {
    modelApiKey?: string | null
    modelBaseUrl?: string
    modelName?: string
    forceDemo?: boolean
  }) => {
    save.mutate(payload, {
      onSuccess: () => {
        toast.success('配置已保存并即时生效，无需重启服务')
        setApiKey('')
        setTestResult(null)
      },
      onError: (error) =>
        toast.error(
          error instanceof Error ? error.message : '保存失败，请稍后重试'
        ),
    })
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2 text-xs'>
        <span className='text-muted-foreground'>当前生效模式：</span>
        <Badge
          variant={settings.effectiveMode === 'live' ? 'secondary' : 'outline'}
        >
          {settings.effectiveMode === 'live' ? '真实模型' : '演示模式'}
        </Badge>
        <Badge className='font-normal' variant='outline'>
          密钥来源：
          {KEY_SOURCE_LABELS[settings.keySource] ?? settings.keySource}
        </Badge>
        {settings.apiKeyConfigured && (
          <span className='inline-flex items-center gap-1 text-muted-foreground'>
            <ShieldCheck className='size-3.5' />
            已保存 {settings.apiKeyHint}
          </span>
        )}
      </div>

      {settings.apiKeyInvalid && (
        <p
          className='flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive'
          role='alert'
        >
          <ShieldAlert className='mt-0.5 size-3.5 shrink-0' />
          已保存的密钥无法解密（通常是服务器的 AI_SETTINGS_SECRET / JWT_SECRET
          变更过）。 请重新填写一次 API Key。
        </p>
      )}

      {!secretsReady.ok && (
        <p className='rounded-lg border border-dashed p-3 text-xs text-muted-foreground'>
          未配置加密密钥，暂不能保存 API Key：{secretsReady.message}
          <br />
          请在服务器 .env 中设置 <code>AI_SETTINGS_SECRET</code>（或复用{' '}
          <code>JWT_SECRET</code>）后重启 API。
        </p>
      )}

      <div className='space-y-2'>
        <Label htmlFor='model-base-url'>Base URL</Label>
        <Input
          id='model-base-url'
          placeholder='https://api.deepseek.com/v1'
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
        <p className='text-xs text-muted-foreground'>
          OpenAI 兼容协议地址，一般以 <code>/v1</code> 结尾（代码会自动补{' '}
          <code>/chat/completions</code>）。
        </p>
      </div>

      <div className='space-y-2'>
        <Label htmlFor='model-name'>模型名</Label>
        <Input
          id='model-name'
          placeholder='deepseek-chat'
          value={modelName}
          onChange={(event) => setModelName(event.target.value)}
        />
      </div>

      <div className='space-y-2'>
        <Label htmlFor='model-api-key'>API Key</Label>
        <Input
          autoComplete='off'
          id='model-api-key'
          placeholder={
            settings.apiKeyConfigured
              ? `已保存 ${settings.apiKeyHint}，留空则不修改`
              : '填入模型服务的 API Key'
          }
          type='password'
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <p className='flex items-start gap-1.5 text-xs text-muted-foreground'>
          <KeyRound className='mt-0.5 size-3.5 shrink-0' />
          密钥以 AES-256-GCM
          加密后存储，保存后仅显示首尾掩码；接口不会回传明文，审计也只记录掩码与指纹。
        </p>
      </div>

      <div className='flex flex-wrap items-center gap-2'>
        <Button
          disabled={!dirty || save.isPending}
          onClick={() =>
            submit({
              modelApiKey: keyDirty ? apiKey.trim() : undefined,
              modelBaseUrl: baseUrl.trim(),
              modelName: modelName.trim(),
            })
          }
        >
          {save.isPending && <Loader2 className='animate-spin' />}
          保存模型配置
        </Button>
        <Button disabled={test.isPending} variant='outline' onClick={runTest}>
          {test.isPending ? <Loader2 className='animate-spin' /> : <PlugZap />}
          测试连接
        </Button>
        {settings.apiKeyConfigured && (
          <Button
            className='text-destructive'
            disabled={save.isPending}
            variant='ghost'
            onClick={() => submit({ modelApiKey: null })}
          >
            清除密钥
          </Button>
        )}
      </div>

      {testResult && (
        <p
          className={`rounded-lg border p-3 text-xs ${
            testResult.ok
              ? 'border-primary/40 bg-primary/5 text-foreground'
              : 'border-destructive/40 bg-destructive/5 text-destructive'
          }`}
          role='status'
        >
          {testResult.message}
        </p>
      )}

      <div className='flex items-center justify-between gap-3 border-t pt-4'>
        <div>
          <p className='text-sm font-medium'>强制演示模式</p>
          <p className='text-xs text-muted-foreground'>
            打开后所有问答都走演示
            provider（回答由检索结果直接汇总），用于培训与演示；
            已保存的密钥不受影响，关掉即恢复真实模型。
          </p>
        </div>
        <Switch
          aria-label='强制演示模式开关'
          checked={settings.forceDemo}
          onCheckedChange={(checked) => submit({ forceDemo: checked })}
        />
      </div>
    </div>
  )
}

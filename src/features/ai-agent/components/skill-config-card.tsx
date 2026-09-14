import { useState } from 'react'
import { CheckCircle2, Loader2, Lock, Save, Sparkles } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useMySkill, useSaveMySkill } from '../api/queries'
import { NOTE_TRIGGER_LABELS } from '../format'
import type { UserSkillState } from '../types'

/**
 * 「知识沉淀」技能配置卡（员工视角）。
 *
 * 分工（已确认的产品口径）：
 *   - **员工只能开关**：要不要用 AI 帮自己整理经验是个人意愿；
 *   - **触发方式 / 每日 AI 整理上限 / 字段集合由管理员统一设置**：这三项是成本与合规参数，
 *     交给员工自调等于没有成本控制（实测员工可以把上限调到 200 绕过限制）；
 *   - 手工新建沉淀不受开关与配额限制（不消耗模型）。
 */
export function SkillConfigCard() {
  const skill = useMySkill()

  if (skill.isLoading) return <Skeleton className='h-40 w-full' />
  if (skill.isError || !skill.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className='text-base'>知识沉淀技能</CardTitle>
          <CardDescription>技能配置加载失败，请刷新页面重试。</CardDescription>
        </CardHeader>
      </Card>
    )
  }
  // key 用服务端版本标识：保存后服务端数据变化即重新挂载，无需在 effect 里同步 state
  return (
    <SkillConfigForm
      key={String(skill.data.updatedAt ?? 'new')}
      state={skill.data}
    />
  )
}

function SkillConfigForm({ state }: { state: UserSkillState }) {
  const save = useSaveMySkill()
  const [enabled, setEnabled] = useState(state.config.enabled)

  const definition = state.skill
  // 兜底：服务端未下发 policy（例如前后端版本不一致）时退回用有效配置渲染，
  // 不能让整页白屏 —— 缺一个展示字段不该毁掉员工的知识沉淀入口
  const policy = state.policy ?? {
    triggerMode: state.config.triggerMode,
    dailyQuota: state.config.dailyQuota,
    fieldKeys: state.config.fieldKeys,
  }
  const fields = definition.fieldSchema ?? []
  const activeFields =
    policy.fieldKeys.length === 0
      ? fields
      : fields.filter((field) => policy.fieldKeys.includes(field.key))

  const submit = () => {
    save.mutate(
      { enabled },
      {
        onSuccess: () => toast.success('技能配置已保存'),
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : '保存失败，请稍后重试'
          ),
      }
    )
  }

  return (
    <Card>
      <CardHeader className='gap-1'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Sparkles className='size-4' />
          {definition.displayName} 技能
          <Badge variant='outline'>v{definition.version}</Badge>
          {enabled ? (
            <Badge className='gap-1' variant='secondary'>
              <CheckCircle2 className='size-3' />
              已开启
            </Badge>
          ) : (
            <Badge variant='outline'>已关闭</Badge>
          )}
        </CardTitle>
        <CardDescription>{definition.description}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {!definition.enabled && (
          <p className='rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground'>
            该技能已被管理员全局停用，暂时无法使用。
          </p>
        )}

        <div className='flex items-start justify-between gap-4 rounded-md border p-3'>
          <div className='space-y-1'>
            <Label htmlFor='distill-enabled'>启用知识沉淀</Label>
            <p className='text-xs text-muted-foreground'>
              开启后可用 AI
              从会话中整理经验条目。手工新建沉淀不受此开关限制（不消耗模型）。
            </p>
          </div>
          <Switch
            checked={enabled}
            disabled={!definition.enabled}
            id='distill-enabled'
            onCheckedChange={setEnabled}
          />
        </div>

        <div className='rounded-md border bg-muted/30 p-3'>
          <p className='mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground'>
            <Lock className='size-3.5' />
            以下参数由管理员统一设置，账号不可修改
          </p>
          <dl className='grid gap-3 sm:grid-cols-3'>
            <div>
              <dt className='text-xs text-muted-foreground'>触发方式</dt>
              <dd className='text-sm'>
                {NOTE_TRIGGER_LABELS[policy.triggerMode] ?? policy.triggerMode}
              </dd>
            </div>
            <div>
              <dt className='text-xs text-muted-foreground'>
                每日 AI 整理上限
              </dt>
              <dd className='text-sm'>
                {policy.dailyQuota === 0 ? '不限制' : `${policy.dailyQuota} 次`}
              </dd>
            </div>
            <div>
              <dt className='text-xs text-muted-foreground'>整理字段</dt>
              <dd className='text-sm'>
                {policy.fieldKeys.length === 0
                  ? '全部字段'
                  : activeFields.map((field) => field.label).join('、')}
              </dd>
            </div>
          </dl>
          <p className='mt-2 text-xs text-muted-foreground'>
            配额只统计「AI 整理」次数，手工新建不计入。需要调整请联系管理员。
          </p>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          <Button className='gap-2' disabled={save.isPending} onClick={submit}>
            {save.isPending ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <Save className='size-4' />
            )}
            保存
          </Button>
          <span className='text-xs text-muted-foreground'>
            只作用于你自己的账号，配置变更会写入审计。
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

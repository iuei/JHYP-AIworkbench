import { useState } from 'react'
import { Loader2, Save, Users } from 'lucide-react'
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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useUpdateGlobalSkill } from '../api/queries'
import type {
  NoteAccountStat,
  SkillAccountRow,
  SkillBrief,
  SkillPolicy,
  SkillTriggerMode,
} from '../types'

type Props = {
  skill: SkillBrief
  accounts: SkillAccountRow[]
  byAccount: NoteAccountStat[]
  onFilterAccount: (userId: number) => void
}

/**
 * 「技能治理」卡（管理员）：全局开关 + 成本参数策略 + 账号启用情况。
 *
 * 这些参数**由管理员统一设置、员工只读**：每日 AI 整理上限、触发方式与整理字段属于成本与合规参数，
 * 交给员工自调等于没有成本控制。员工侧只能开关技能。
 *
 * 本地状态从服务端数据初始化，靠调用方用 `key` 在服务端数据变化后重挂载来刷新，
 * 因此不需要在 effect 里同步 props。
 */
export function SkillPolicyCard({
  skill,
  accounts,
  byAccount,
  onFilterAccount,
}: Props) {
  const updateSkill = useUpdateGlobalSkill()
  const [policy, setPolicy] = useState<SkillPolicy>(
    skill.policy ?? {
      triggerMode: 'manual',
      dailyQuota: 20,
      fieldKeys: [],
    }
  )

  const fields = skill.fieldSchema ?? []

  const toggleField = (key: string, checked: boolean) => {
    setPolicy((current) => ({
      ...current,
      fieldKeys: checked
        ? [...new Set([...current.fieldKeys, key])]
        : current.fieldKeys.filter((item) => item !== key),
    }))
  }

  const runGlobalToggle = (enabled: boolean) => {
    updateSkill.mutate(
      { name: skill.name, enabled },
      {
        onSuccess: () =>
          toast.success(enabled ? '技能已全局启用' : '技能已全局停用'),
        onError: (error) =>
          toast.error(
            error instanceof Error ? error.message : '操作失败，请稍后重试'
          ),
      }
    )
  }

  const savePolicy = () => {
    updateSkill.mutate(
      { name: skill.name, policy },
      {
        onSuccess: () => toast.success('技能参数已保存，对全部账号立即生效'),
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
          <Users className='size-4' />
          技能治理（全局参数 + 账号启用情况）
        </CardTitle>
        <CardDescription>
          触发方式、每日 AI
          整理上限与整理字段由管理员统一设置，对所有账号立即生效；员工只能开关技能。
          {skill.description}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='flex items-center justify-between gap-4 rounded-md border p-3'>
          <div className='space-y-1'>
            <Label htmlFor='global-skill'>
              全局启用「{skill.displayName}」
            </Label>
            <p className='text-xs text-muted-foreground'>
              停用后所有账号都无法用 AI
              整理沉淀（手工新建不受影响）。配置变更写入审计。
            </p>
          </div>
          <Switch
            checked={skill.enabled}
            disabled={updateSkill.isPending}
            id='global-skill'
            onCheckedChange={runGlobalToggle}
          />
        </div>

        <div className='grid gap-4 rounded-md border p-3 sm:grid-cols-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='skill-trigger'>触发方式</Label>
            <Select
              value={policy.triggerMode}
              onValueChange={(value) =>
                setPolicy((current) => ({
                  ...current,
                  triggerMode: value as SkillTriggerMode,
                }))
              }
            >
              <SelectTrigger className='w-full' id='skill-trigger'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='manual'>仅手动</SelectItem>
                <SelectItem value='auto'>
                  自动 + 手动（自动下一轮上线）
                </SelectItem>
                <SelectItem value='both'>
                  自动 + 手动（自动下一轮上线）
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className='space-y-1.5'>
            <Label htmlFor='skill-quota'>每日 AI 整理上限</Label>
            <Input
              id='skill-quota'
              max={200}
              min={0}
              type='number'
              value={policy.dailyQuota}
              onChange={(event) =>
                setPolicy((current) => ({
                  ...current,
                  dailyQuota: Number(event.target.value),
                }))
              }
            />
            <p className='text-xs text-muted-foreground'>
              0 表示不限制；只统计 AI 整理次数，手工新建不计入。
            </p>
          </div>

          <div className='space-y-1.5'>
            <Label>整理字段</Label>
            <div className='flex flex-wrap gap-1'>
              {fields.map((field) => {
                const checked = policy.fieldKeys.includes(field.key)
                return (
                  <Button
                    aria-pressed={checked}
                    key={field.key}
                    size='sm'
                    type='button'
                    variant={checked ? 'default' : 'outline'}
                    onClick={() => toggleField(field.key, !checked)}
                  >
                    {field.label}
                  </Button>
                )
              })}
            </div>
            <p className='text-xs text-muted-foreground'>
              不选表示全部字段都要整理。
            </p>
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          <Button
            className='gap-2'
            disabled={updateSkill.isPending}
            onClick={savePolicy}
          >
            {updateSkill.isPending ? (
              <Loader2 className='size-4 animate-spin' />
            ) : (
              <Save className='size-4' />
            )}
            保存技能参数
          </Button>
          <span className='text-xs text-muted-foreground'>
            保存会写入审计；员工侧只读展示这些参数。
          </span>
        </div>

        <div className='space-y-2'>
          <p className='text-xs font-medium text-muted-foreground'>
            账号启用情况
          </p>
          <div className='flex flex-wrap gap-2'>
            {accounts.length === 0 ? (
              <p className='text-sm text-muted-foreground'>
                还没有账号配置过这个技能（技能默认关闭，由员工自行开启）。
              </p>
            ) : (
              accounts.map((item) => (
                <Badge
                  key={item.userId}
                  variant={item.enabled ? 'default' : 'outline'}
                >
                  {item.name || item.login}
                  {item.enabled ? ' · 已开启' : ' · 未开启'}
                </Badge>
              ))
            )}
          </div>

          {byAccount.length > 0 && (
            <div className='space-y-1'>
              <p className='text-xs font-medium text-muted-foreground'>
                按账号统计（点击筛选下方列表）
              </p>
              <div className='flex flex-wrap gap-2'>
                {byAccount.map((item) => (
                  <button
                    className='rounded-md border px-2 py-1 text-xs hover:bg-muted'
                    key={item.userId}
                    type='button'
                    onClick={() => onFilterAccount(item.userId)}
                  >
                    {item.name || item.login}：{item.total} 条（待审{' '}
                    {item.pending}）
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

import { useState } from 'react'
import { ChevronDown, Loader2, Save, Users } from 'lucide-react'
import { toast } from 'sonner'
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
 * 布局（2026-09-15 简化）：只有"全局启用"常显 —— 它是这张卡唯一的日常动作；
 * 参数表单、保存按钮与两张账号清单收进折叠区，因为它们是"配置一次、长期不动"的内容，
 * 原先常显时整卡近 500px，把下方的沉淀审核队列（真正的日常任务）挤到首屏之外。
 * **折叠不等于藏信息**：当前生效的触发方式 / 每日上限 / 字段数常显在折叠行右侧，
 * 不展开也能确认参数现状。
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
  const [detailsOpen, setDetailsOpen] = useState(false)

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

  const summary = [
    policy.triggerMode === 'manual' ? '仅手动' : '自动 + 手动',
    policy.dailyQuota === 0 ? '每日不限' : `每日上限 ${policy.dailyQuota}`,
    policy.fieldKeys.length === 0
      ? '整理全部字段'
      : `整理 ${policy.fieldKeys.length} 个字段`,
  ].join(' · ')

  return (
    <Card className='gap-4 py-4'>
      <CardHeader className='gap-1'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <Users className='size-4' />
          技能治理
        </CardTitle>
        <CardDescription>
          参数由管理员统一设置、对所有账号立即生效；员工只能开关技能。
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-2'>
        {/*
          全局开关不再套一层带边框的说明块：那圈边框、内边距与两行副说明占了 70px，
          而这一行只有"一个开关"这个事实。停用后果放在折叠区里说明。
        */}
        <div className='flex items-center justify-between gap-4'>
          <Label htmlFor='global-skill'>全局启用「{skill.displayName}」</Label>
          <Switch
            checked={skill.enabled}
            disabled={updateSkill.isPending}
            id='global-skill'
            onCheckedChange={runGlobalToggle}
          />
        </div>

        <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <CollapsibleTrigger asChild>
              <Button
                className='gap-1.5 px-2 text-xs text-muted-foreground'
                size='sm'
                variant='ghost'
              >
                <ChevronDown
                  className={cn(
                    'size-3.5 transition-transform',
                    detailsOpen && 'rotate-180'
                  )}
                />
                {detailsOpen ? '收起参数与账号明细' : '展开参数与账号明细'}
              </Button>
            </CollapsibleTrigger>
            <span className='text-xs text-muted-foreground'>{summary}</span>
          </div>

          <CollapsibleContent className='space-y-4 pt-3'>
            <p className='text-xs text-muted-foreground'>
              停用后所有账号都无法用 AI
              整理沉淀（手工新建不受影响）；参数与开关的变更都会写入审计。
              {skill.description ? ` ${skill.description}` : ''}
            </p>

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
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  )
}

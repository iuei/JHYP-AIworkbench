import { useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useMySkill, useSaveMySkill } from '../api/queries'
import type { UserSkillState } from '../types'

/**
 * 唯一的说明文案（用户指定口径）：说清"开关管什么、不管什么"。
 * 手工新建不消耗模型、不受此开关限制 —— 这一句必须在，否则开关关掉后
 * 用户会以为连手工沉淀也不能用了。
 */
const DISTILL_TOGGLE_HINT =
  '开启后可用 AI 从会话中整理经验条目。手工新建沉淀不受此开关限制（不消耗模型）。'

/**
 * 「知识沉淀」技能开关（员工视角）。
 *
 * **2026-09-16 精简**（用户："顶部这个板块意义不大直接删除 只保留〈说明〉这条信息以及开关即可"）：
 * 原先这张卡是"技能名 + 版本徽章 + 已开启徽章 + 技能描述 + 只读参数区（触发方式 / 每日上限 /
 * 整理字段）+ 保存按钮 + 三行说明"，一屏内容里只有**一个开关**是员工能操作的东西，
 * 其余要么是管理员参数的回显（员工改不了）、要么是解释文案的重复。删到只剩一句说明与开关。
 *
 * 连带的一处行为调整：**开关改为即改即存**（`onCheckedChange` 直接提交）——
 * 保存按钮随参数区一起删掉后，"改了不保存"就没有出口了，留着按钮反而多一步。
 * 提交失败会把开关**回滚**回原状态并提示原因：这类二元设置最怕"界面显示已开启、
 * 服务端其实没存下"，下次整理失败时用户无从判断。
 *
 * 分工不变：触发方式 / 每日上限 / 字段集合仍由管理员在「经验审核 → 技能治理」统一设置。
 */
export function SkillConfigCard() {
  const skill = useMySkill()

  if (skill.isLoading) return <Skeleton className='h-16 w-full' />
  if (skill.isError || !skill.data) {
    return (
      <Card className='py-4'>
        <CardContent className='text-sm text-muted-foreground'>
          知识沉淀技能配置加载失败，请刷新页面重试。
        </CardContent>
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
  // 管理员可以全局停用该技能：此时开关必须禁用，否则员工点了也存不进去
  const globallyDisabled = !state.skill.enabled

  const toggle = (next: boolean) => {
    setEnabled(next)
    save.mutate(
      { enabled: next },
      {
        onSuccess: () =>
          toast.success(next ? '已开启知识沉淀技能' : '已关闭知识沉淀技能'),
        onError: (error) => {
          setEnabled(!next)
          toast.error(
            error instanceof Error ? error.message : '保存失败，请稍后重试'
          )
        },
      }
    )
  }

  return (
    <Card className='gap-4 py-4'>
      <CardContent className='space-y-2'>
        <div className='flex items-center justify-between gap-4'>
          <Label
            className='text-sm font-normal text-muted-foreground'
            htmlFor='distill-enabled'
          >
            {DISTILL_TOGGLE_HINT}
          </Label>
          <Switch
            checked={enabled}
            disabled={globallyDisabled || save.isPending}
            id='distill-enabled'
            onCheckedChange={toggle}
          />
        </div>
        {globallyDisabled && (
          <p className='text-xs text-muted-foreground'>
            该技能已被管理员全局停用，暂时无法开启；需要开启请联系管理员。
          </p>
        )}
      </CardContent>
    </Card>
  )
}

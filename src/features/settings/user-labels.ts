/**
 * 角色中文名统一在这里维护。
 *
 * 用户管理页和用户信息页都要展示角色，此前只有用户管理页本地维护一份映射，
 * 新增只读展示时必须共用，避免两处文案漂移。
 * 未知角色回退原值，而不是显示空白或编造名称。
 */
const roleLabels: Record<string, string> = {
  admin: '管理员',
  operator: '普通运营人员',
}

export function roleLabel(role: string) {
  return roleLabels[role] ?? role
}

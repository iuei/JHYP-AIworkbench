import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AI_AGENT_MIGRATION_BASE_VERSION,
  aiAgentMigrations,
  assertNoDuplicateExperienceSourceRefs,
  defaultAiSettings,
} from './migrations.mjs'
import { BUILTIN_SKILLS, DISTILL_FIELDS, DISTILL_SKILL_NAME } from './skill-contracts.mjs'
import { TOOL_CONTRACTS, findToolContract } from './tool-contracts.mjs'

test('AI 迁移版本号从 100 起，避免与快捷导航迁移的 version 1 冲突', () => {
  assert.ok(AI_AGENT_MIGRATION_BASE_VERSION >= 100)
  for (const migration of aiAgentMigrations) {
    assert.ok(
      migration.version >= AI_AGENT_MIGRATION_BASE_VERSION,
      `迁移 ${migration.name} 版本号 ${migration.version} 小于起始版本`
    )
  }
})

test('AI 迁移版本号唯一且每项都有 up 函数与名称', () => {
  const versions = aiAgentMigrations.map((migration) => migration.version)
  assert.equal(new Set(versions).size, versions.length)
  for (const migration of aiAgentMigrations) {
    assert.equal(typeof migration.up, 'function')
    assert.ok(migration.name.length > 0)
  }
})

test('迁移顺序不变量：先建表、再写种子，后续迁移版本严格递增', () => {
  const names = aiAgentMigrations.map((migration) => migration.name)
  // 只钉不变量而不钉完整列表，避免每加一个增量迁移就要改测试
  assert.equal(names[0], 'create_ai_agent_schema')
  assert.equal(names[1], 'seed_ai_tools_and_settings')
  for (let index = 1; index < aiAgentMigrations.length; index += 1) {
    assert.ok(
      aiAgentMigrations[index].version > aiAgentMigrations[index - 1].version,
      `迁移 ${names[index]} 的版本号必须大于前一个`
    )
  }
  assert.ok(names.includes('add_model_credentials_to_settings'))
  assert.ok(names.includes('add_message_blocks'))
  assert.ok(names.includes('reseed_data_query_tools'))
})

test('每个工具契约都声明角色、描述与参数 schema，禁止无权限声明的工具', () => {
  assert.ok(TOOL_CONTRACTS.length > 0)
  for (const tool of TOOL_CONTRACTS) {
    assert.ok(tool.name.length > 0, '工具必须有名称')
    assert.ok(tool.description.length > 0, `${tool.name} 必须有描述`)
    assert.ok(
      tool.requiredRole === 'user' || tool.requiredRole === 'admin',
      `${tool.name} 的 requiredRole 只能是 user 或 admin`
    )
    assert.equal(typeof tool.paramsSchema, 'object')
    assert.equal(tool.paramsSchema.type, 'object')
    assert.ok(Array.isArray(tool.paramsSchema.required))
    assert.ok(Array.isArray(tool.auditFields))
  }
})

test('一期工具清单包含检索工具与两个管理员工具', () => {
  assert.equal(findToolContract('search_knowledge')?.requiredRole, 'user')
  assert.equal(findToolContract('rebuild_knowledge_index')?.requiredRole, 'admin')
  assert.equal(findToolContract('deactivate_document')?.requiredRole, 'admin')
  assert.equal(findToolContract('not_a_tool'), null)
})

test('工具名唯一', () => {
  const names = TOOL_CONTRACTS.map((tool) => tool.name)
  assert.equal(new Set(names).size, names.length)
})

test('默认配置锁定编排与成本护栏', () => {
  assert.equal(defaultAiSettings.maxTurnsPerConversation, 20)
  assert.ok(defaultAiSettings.retrievalTopK > 0 && defaultAiSettings.retrievalTopK <= 10)
  assert.ok(defaultAiSettings.requestTimeoutMs > 0)
})

test('知识沉淀迁移就位：先建表再写技能种子', () => {
  const names = aiAgentMigrations.map((migration) => migration.name)
  const schemaIndex = names.indexOf('create_knowledge_distill_schema')
  const seedIndex = names.indexOf('seed_knowledge_distill_skill')
  assert.ok(schemaIndex >= 0, '缺少知识沉淀建表迁移')
  assert.ok(seedIndex > schemaIndex, '技能种子必须排在建表之后')
  // 105 已被 reseed_proactive_analysis_tools 占用，新迁移从 106 起
  assert.equal(aiAgentMigrations[schemaIndex].version, AI_AGENT_MIGRATION_BASE_VERSION + 6)
  assert.equal(aiAgentMigrations[seedIndex].version, AI_AGENT_MIGRATION_BASE_VERSION + 7)
})

test('内置「知识沉淀」技能契约锁定名称与七个字段', () => {
  assert.equal(DISTILL_SKILL_NAME, 'knowledge-distill')
  assert.equal(BUILTIN_SKILLS.length, 1)
  const skill = BUILTIN_SKILLS[0]
  assert.equal(skill.name, DISTILL_SKILL_NAME)
  assert.ok(skill.displayName.length > 0)
  // description 描述「何时使用」，与 SKILL.md 生态的约定一致
  assert.ok(skill.description.length > 10)
  assert.deepEqual(
    skill.fieldSchema.map((field) => field.key),
    ['scenario', 'background', 'approach', 'result', 'pitfalls', 'applicability']
  )
  assert.deepEqual(skill.fieldSchema, DISTILL_FIELDS)
  for (const field of skill.fieldSchema) {
    assert.ok(field.label.length > 0)
    assert.ok(field.hint.length > 0)
    assert.equal(field.required, true)
  }
})

test('内置技能默认不自动触发：自动沉淀下一轮才实现', () => {
  const skill = BUILTIN_SKILLS[0]
  assert.equal(skill.triggers.manual, true)
  assert.equal(skill.triggers.onConversationEnd, false)
  assert.ok(skill.body.includes('JSON'), '技能正文必须要求模型输出 JSON')
})

test('沉淀可信度字段迁移就位：provenance 与 evidence 单独补一个迁移', () => {
  const names = aiAgentMigrations.map((migration) => migration.name)
  const index = names.indexOf('add_note_provenance_and_evidence')
  assert.ok(index >= 0, '缺少 provenance / evidence 补列迁移')
  // 106 已应用过，不能再改它，只能新增迁移补列
  assert.equal(aiAgentMigrations[index].version, AI_AGENT_MIGRATION_BASE_VERSION + 8)
  // 原断言是"补列迁移必须排在最后"，但并行开发会继续追加更高版本的迁移，这个假设不成立；
  // 真正要守住的是"该迁移存在且版本为 108、整体版本号递增"，因此改为校验递增性。
  const versions = aiAgentMigrations.map((migration) => migration.version)
  assert.deepEqual(
    versions,
    [...versions].sort((a, b) => a - b),
    '迁移版本号必须严格递增'
  )
})

test('技能正文要求模型给出原文依据，禁止只给结论', () => {
  const skill = BUILTIN_SKILLS[0]
  assert.ok(skill.body.includes('evidence'), '正文必须要求输出 evidence 原文引句')
})

test('沉淀加固迁移：存在重复 experience source_ref 时中止并给出修复提示，不自动删数据', () => {
  assert.doesNotThrow(() => assertNoDuplicateExperienceSourceRefs([]))
  assert.doesNotThrow(() => assertNoDuplicateExperienceSourceRefs())
  assert.throws(
    () =>
      assertNoDuplicateExperienceSourceRefs([
        { source_ref: 'note:12', total: 2, ids: [61, 88] },
      ]),
    /迁移中止[\s\S]*note:12[\s\S]*不要直接删数据/
  )
})

test('沉淀加固迁移：注册在技能策略之后，版本号严格递增且名称唯一', () => {
  const hardening = aiAgentMigrations.find((migration) => migration.name === 'harden_knowledge_distill')
  assert.ok(hardening, '必须注册 harden_knowledge_distill 迁移')
  const policy = aiAgentMigrations.find((migration) => migration.name === 'add_skill_policy')
  assert.ok(hardening.version > policy.version)
})

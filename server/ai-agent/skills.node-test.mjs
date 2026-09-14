import assert from 'node:assert/strict'
import test from 'node:test'
import { DISTILL_FIELDS, DISTILL_SKILL_NAME } from './skill-contracts.mjs'
import {
  SkillValidationError,
  assertEditableSkillPatch,
  normalizeSkillPolicy,
  normalizeUserSkillConfig,
  parseSkillFrontmatter,
  renderSkillMarkdown,
  resolveDistillFields,
} from './skills.mjs'

test('parseSkillFrontmatter 解析 name/description/version', () => {
  const markdown = [
    '---',
    'name: knowledge-distill',
    'description: 把一次问答整理成结构化经验',
    'version: 1.0.0',
    '---',
    '',
    '正文第一行',
    '正文第二行',
  ].join('\n')
  const { frontmatter, body } = parseSkillFrontmatter(markdown)
  assert.equal(frontmatter.name, 'knowledge-distill')
  assert.equal(frontmatter.description, '把一次问答整理成结构化经验')
  // 1.0.0 不是合法数字，必须保持字符串
  assert.equal(frontmatter.version, '1.0.0')
  assert.equal(body, '正文第一行\n正文第二行')
})

test('parseSkillFrontmatter 对没有 frontmatter 的文本返回空对象与原文本', () => {
  const { frontmatter, body } = parseSkillFrontmatter('# 只有正文\n内容')
  assert.deepEqual(frontmatter, {})
  assert.equal(body, '# 只有正文\n内容')
})

test('parseSkillFrontmatter 识别布尔、数字与数组标量', () => {
  const markdown = [
    '---',
    'manual: true',
    'minTurns: 2',
    'tags: [alpha, beta]',
    'quoted: "带引号的值"',
    '---',
    '正文',
  ].join('\n')
  const { frontmatter } = parseSkillFrontmatter(markdown)
  assert.equal(frontmatter.manual, true)
  assert.equal(frontmatter.minTurns, 2)
  assert.deepEqual(frontmatter.tags, ['alpha', 'beta'])
  assert.equal(frontmatter.quoted, '带引号的值')
})

test('renderSkillMarkdown 的输出能被 parseSkillFrontmatter 原样解析回来', () => {
  const markdown = renderSkillMarkdown({
    name: DISTILL_SKILL_NAME,
    displayName: '知识沉淀',
    description: '何时使用：一次问答产生了可复用的做法',
    version: '1.0.0',
    body: '规则一\n规则二',
    triggers: { manual: true, onConversationEnd: false, minTurns: 2 },
  })
  const { frontmatter, body } = parseSkillFrontmatter(markdown)
  assert.equal(frontmatter.name, DISTILL_SKILL_NAME)
  assert.equal(frontmatter.displayName, '知识沉淀')
  assert.equal(frontmatter.version, '1.0.0')
  assert.deepEqual(frontmatter.triggers, { manual: true, onConversationEnd: false, minTurns: 2 })
  assert.equal(body, '规则一\n规则二')
})

test('normalizeUserSkillConfig 默认关闭沉淀技能', () => {
  const config = normalizeUserSkillConfig({})
  assert.equal(config.enabled, false)
  assert.equal(config.triggerMode, 'manual')
  assert.equal(config.defaultVisibility, 'private')
  assert.equal(config.dailyQuota, 20)
  assert.deepEqual(config.fieldKeys, [])
})

test('normalizeUserSkillConfig 拒绝非法触发方式', () => {
  assert.throws(() => normalizeUserSkillConfig({ triggerMode: 'auto-on-idle' }), SkillValidationError)
})

test('normalizeUserSkillConfig 拒绝非法默认可见性', () => {
  assert.throws(() => normalizeUserSkillConfig({ defaultVisibility: 'public' }), SkillValidationError)
})

test('normalizeUserSkillConfig 把配额夹取到 0..200，小数回退默认值', () => {
  assert.equal(normalizeUserSkillConfig({ dailyQuota: -5 }).dailyQuota, 0)
  assert.equal(normalizeUserSkillConfig({ dailyQuota: 999 }).dailyQuota, 200)
  assert.equal(normalizeUserSkillConfig({ dailyQuota: 1.5 }).dailyQuota, 20)
  assert.equal(normalizeUserSkillConfig({ dailyQuota: '30' }).dailyQuota, 30)
})

test('normalizeUserSkillConfig 的字段选择去重并丢弃非字符串', () => {
  const config = normalizeUserSkillConfig({
    fieldKeys: ['approach', 'approach', '', null, 7, 'result'],
  })
  assert.deepEqual(config.fieldKeys, ['approach', 'result'])
})

test('resolveDistillFields 未配置字段时返回全部沉淀字段', () => {
  const fields = resolveDistillFields({ fieldSchema: DISTILL_FIELDS }, { fieldKeys: [] })
  assert.deepEqual(fields, DISTILL_FIELDS)
})

test('resolveDistillFields 按契约顺序返回子集，忽略不存在的 key', () => {
  const fields = resolveDistillFields(
    { fieldSchema: DISTILL_FIELDS },
    { fieldKeys: ['result', 'scenario', 'not-a-field'] }
  )
  assert.deepEqual(
    fields.map((field) => field.key),
    ['scenario', 'result']
  )
})

test('resolveDistillFields 在技能没有字段契约时返回空数组，不抛错', () => {
  assert.deepEqual(resolveDistillFields({ fieldSchema: null }, { fieldKeys: ['scenario'] }), [])
})

test('normalizeSkillPolicy 校验触发方式、每日上限与字段集合', () => {
  const policy = normalizeSkillPolicy({ triggerMode: 'both', dailyQuota: 30, fieldKeys: ['approach'] })
  assert.deepEqual(policy, { triggerMode: 'both', dailyQuota: 30, fieldKeys: ['approach'] })
  assert.throws(() => normalizeSkillPolicy({ triggerMode: 'idle' }), SkillValidationError)
  assert.deepEqual(normalizeSkillPolicy({ dailyQuota: 999 }).dailyQuota, 200)
  assert.deepEqual(normalizeSkillPolicy({ dailyQuota: -1 }).dailyQuota, 0)
  assert.deepEqual(normalizeSkillPolicy({ fieldKeys: ['a', 'a', 7, ''] }).fieldKeys, ['a'])
  assert.equal(normalizeSkillPolicy({}).triggerMode, 'manual')
})

test('员工只能改开关：其余技能参数由管理员锁定', () => {
  // 只带 enabled 的补丁允许
  assert.deepEqual(assertEditableSkillPatch({ enabled: true }), { enabled: true })
  assert.deepEqual(assertEditableSkillPatch({}), {})
  // 带任何被锁定的参数一律拒绝，且不允许静默忽略
  for (const key of ['triggerMode', 'dailyQuota', 'fieldKeys', 'defaultVisibility', 'policy']) {
    assert.throws(
      () => assertEditableSkillPatch({ enabled: true, [key]: 'x' }),
      SkillValidationError,
      `${key} 应当被拒绝`
    )
  }
})

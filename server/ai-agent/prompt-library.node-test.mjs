/**
 * 提示词广场领域层单测（纯函数，不依赖数据库）。
 *
 * 覆盖重点：
 * 1. 校验边界（名称/标题/正文/标签/关键字）；
 * 2. 名称不允许 `@`——`@名称` 是调用入口，名称自带 `@` 会让触发范围无法预期；
 * 3. 正文保留换行——提问模板常是多行，折叠空白会毁掉用户排版；
 * 4. **状态流转全矩阵**：这是本模块最关键的安全边界，
 *    审核通过必须只有管理员能做，任何"作者自己就能把状态推到 published"的漏洞都在这里拦。
 *
 * 注：数据库层（唯一索引冲突、越权 404、审计落库）不在单测范围，走端到端验证。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_BODY_LENGTH,
  MAX_KEYWORD_LENGTH,
  MAX_NAME_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  MAX_TITLE_LENGTH,
  PROMPT_STATUS,
  PromptConflictError,
  PromptValidationError,
  assertTransition,
  canTransition,
  normalizeBody,
  normalizeKeyword,
  normalizeName,
  normalizePromptInput,
  normalizeTags,
  optionalSummary,
  optionalTitle,
  serializePrompt,
} from './prompt-library.mjs'

/* ---------- 名称 ---------- */

test('normalizeName 去掉首尾空白并把内部换行压成单空格', () => {
  assert.equal(normalizeName('  ACoS 归因  '), 'ACoS 归因')
  assert.equal(normalizeName('ACoS\n归因'), 'ACoS 归因')
})

test('normalizeName 拒绝空名与超长名', () => {
  assert.throws(() => normalizeName('   '), PromptValidationError)
  assert.throws(() => normalizeName(null), PromptValidationError)
  assert.throws(() => normalizeName('名'.repeat(MAX_NAME_LENGTH + 1)), PromptValidationError)
  assert.equal(normalizeName('名'.repeat(MAX_NAME_LENGTH)).length, MAX_NAME_LENGTH)
})

test('normalizeName 拒绝含 @ 的名称（@ 是调用入口，名称不能再带 @）', () => {
  assert.throws(() => normalizeName('@ACoS'), PromptValidationError)
  assert.throws(() => normalizeName('ACoS@分析'), PromptValidationError)
  // 没有任何例外：只要出现 @ 就拒绝，避免名称看起来像另一个 @ 引用
  assert.throws(() => normalizeName('邮箱 a@b 的写法'), PromptValidationError)
})

/* ---------- 正文 ---------- */

test('normalizeBody 保留内部换行（提问模板常是多行），只去首尾空白', () => {
  assert.equal(normalizeBody('\n  第一行\n第二行  \n'), '第一行\n第二行')
})

test('normalizeBody 拒绝空正文与超长正文', () => {
  assert.throws(() => normalizeBody('   '), PromptValidationError)
  assert.throws(
    () => normalizeBody('正'.repeat(MAX_BODY_LENGTH + 1)),
    PromptValidationError
  )
  assert.equal(normalizeBody('正'.repeat(MAX_BODY_LENGTH)).length, MAX_BODY_LENGTH)
})

/* ---------- 说明与标签 ---------- */

test('optionalSummary：未传返回 undefined（不改动），空串归一为空串', () => {
  assert.equal(optionalSummary(undefined), undefined)
  assert.equal(optionalSummary('   '), '')
})

test('optionalSummary 折叠空白并拒绝超长', () => {
  assert.equal(optionalSummary(' 查  库存 '), '查 库存')
  assert.throws(
    () => optionalSummary('说'.repeat(MAX_SUMMARY_LENGTH + 1)),
    PromptValidationError
  )
})

test('normalizeTags 去空、按大小写不敏感去重且保序', () => {
  assert.deepEqual(normalizeTags(['广告', '广告', 'ACoS', 'acos', '  ']), ['广告', 'ACoS'])
})

test('normalizeTags：未传返回 undefined（表示不改动），非数组按空数组处理', () => {
  assert.equal(normalizeTags(undefined), undefined)
  assert.deepEqual(normalizeTags(null), [])
  assert.deepEqual(normalizeTags('广告'), [])
})

test('normalizeTags 拒绝单个超长标签与超量标签', () => {
  assert.throws(() => normalizeTags(['标'.repeat(MAX_TAG_LENGTH + 1)]), PromptValidationError)
  const tooMany = Array.from({ length: MAX_TAGS + 1 }, (_, index) => `t${index}`)
  assert.throws(() => normalizeTags(tooMany), PromptValidationError)
  assert.equal(normalizeTags(tooMany.slice(0, MAX_TAGS)).length, MAX_TAGS)
})

/* ---------- 组合入参 ---------- */

test('normalizePromptInput 归一化完整入参，tags 缺省为空数组', () => {
  const fields = normalizePromptInput({
    name: '  ACoS 归因 ',
    title: ' ACoS 异常归因 ',
    body: ' 帮我看下 ACoS 为什么涨 \n并给出主因 ',
    summary: ' 广告效率排查 ',
  })
  assert.deepEqual(fields, {
    name: 'ACoS 归因',
    title: 'ACoS 异常归因',
    body: '帮我看下 ACoS 为什么涨 \n并给出主因',
    summary: '广告效率排查',
    tags: [],
  })
})

test('normalizePromptInput 缺名称/正文时一律报错', () => {
  assert.throws(() => normalizePromptInput({ title: 't', body: 'b' }), PromptValidationError)
  assert.throws(() => normalizePromptInput({ name: 'n', title: 't' }), PromptValidationError)
})

test('normalizePromptInput 允许缺标题（字段 2026-09-15 已下线，与名称重复）', () => {
  const fields = normalizePromptInput({ name: 'ACoS 归因', body: '帮我看下 ACoS 为什么涨' })
  assert.equal(fields.title, '')
})

test('optionalTitle 仍校验长度：旧调用方传超长标题要报错而不是被静默截断', () => {
  assert.equal(optionalTitle('  库存查询  '), '库存查询')
  assert.equal(optionalTitle(undefined), '')
  assert.throws(() => optionalTitle('标'.repeat(MAX_TITLE_LENGTH + 1)), PromptValidationError)
})

/* ---------- 搜索关键字 ---------- */

test('normalizeKeyword 折叠空白，空值表示不过滤', () => {
  assert.equal(normalizeKeyword('  ACoS  归因 '), 'ACoS 归因')
  assert.equal(normalizeKeyword(undefined), '')
  assert.equal(normalizeKeyword('   '), '')
})

test('normalizeKeyword 拒绝超长搜索词', () => {
  assert.throws(
    () => normalizeKeyword('k'.repeat(MAX_KEYWORD_LENGTH + 1)),
    PromptValidationError
  )
})

/* ---------- 状态流转（关键安全边界） ---------- */

test('作者本人可以提报（private/rejected → pending）', () => {
  assert.equal(canTransition(PROMPT_STATUS.private, PROMPT_STATUS.pending), true)
  assert.equal(canTransition(PROMPT_STATUS.rejected, PROMPT_STATUS.pending), true)
  assert.doesNotThrow(() =>
    assertTransition(PROMPT_STATUS.private, PROMPT_STATUS.pending)
  )
})

test('作者本人不能直接发布：pending → published 只有管理员可以', () => {
  assert.equal(
    canTransition(PROMPT_STATUS.pending, PROMPT_STATUS.published, { isAdmin: false }),
    false
  )
  assert.equal(
    canTransition(PROMPT_STATUS.pending, PROMPT_STATUS.published, { isAdmin: true }),
    true
  )
  assert.throws(
    () =>
      assertTransition(PROMPT_STATUS.pending, PROMPT_STATUS.published, { isAdmin: false }),
    PromptConflictError
  )
})

test('private → published 无路可走（哪怕管理员也不能跳过待审）', () => {
  assert.equal(
    canTransition(PROMPT_STATUS.private, PROMPT_STATUS.published, { isAdmin: true }),
    false
  )
  assert.throws(
    () =>
      assertTransition(PROMPT_STATUS.private, PROMPT_STATUS.published, { isAdmin: true }),
    PromptConflictError
  )
})

test('驳回只有管理员可以，且 pending → rejected 不走 owner 通道', () => {
  assert.equal(
    canTransition(PROMPT_STATUS.pending, PROMPT_STATUS.rejected, { isAdmin: false }),
    false
  )
  assert.equal(
    canTransition(PROMPT_STATUS.pending, PROMPT_STATUS.rejected, { isAdmin: true }),
    true
  )
})

test('撤回提报：pending → private 本人可做', () => {
  assert.equal(canTransition(PROMPT_STATUS.pending, PROMPT_STATUS.private), true)
})

test('已共享条目修改后回待审：published → pending 允许', () => {
  assert.equal(canTransition(PROMPT_STATUS.published, PROMPT_STATUS.pending), true)
})

test('已驳回条目不能直接重新发布，必须先回到待审', () => {
  assert.equal(
    canTransition(PROMPT_STATUS.rejected, PROMPT_STATUS.published, { isAdmin: true }),
    false
  )
})

test('未知状态与自环一律拒绝（不静默通过）', () => {
  assert.equal(canTransition('archived', PROMPT_STATUS.pending), false)
  assert.equal(canTransition(undefined, PROMPT_STATUS.pending), false)
  assert.equal(canTransition(PROMPT_STATUS.private, PROMPT_STATUS.private), false)
  assert.throws(
    () => assertTransition(PROMPT_STATUS.private, PROMPT_STATUS.private),
    PromptConflictError
  )
})

test('非法流转的报错文案包含起止状态的人话标签', () => {
  assert.throws(
    () => assertTransition(PROMPT_STATUS.private, PROMPT_STATUS.published, { isAdmin: true }),
    /私有.*已共享/
  )
})

/* ---------- 序列化 ---------- */

test('serializePrompt 映射字段并把计数转成数字', () => {
  const row = {
    id: 7,
    owner_user_id: 3,
    name: 'ACoS 归因',
    title: 'ACoS 异常归因',
    body: '正文',
    summary: '说明',
    tags: ['广告'],
    status: 'published',
    usage_count: '12',
    review_comment: null,
    reviewed_at: null,
    created_at: '2026-09-15T00:00:00.000Z',
    updated_at: '2026-09-15T01:00:00.000Z',
    owner_login: 'zhangsan',
  }
  const prompt = serializePrompt(row, { userId: 3 })
  assert.equal(prompt.usageCount, 12)
  assert.equal(prompt.isOwner, true)
  assert.equal(prompt.ownerLogin, 'zhangsan')
  assert.deepEqual(prompt.tags, ['广告'])
  // 标题已下线：库里仍有该列与历史值，但接口不再返回（前端也就不会再展示重复的两行）
  assert.equal(prompt.title, undefined)
})

test('serializePrompt 在非本人条目上 isOwner 为 false，空字段有默认值', () => {
  const prompt = serializePrompt(
    { id: 8, owner_user_id: 4, name: 'n', title: 't', body: 'b', status: 'published' },
    { userId: 3 }
  )
  assert.equal(prompt.isOwner, false)
  assert.equal(prompt.summary, '')
  assert.deepEqual(prompt.tags, [])
  assert.equal(prompt.usageCount, 0)
})

test('serializePrompt 传 null 返回 null（调用方直接透传 404 分支）', () => {
  assert.equal(serializePrompt(null), null)
})

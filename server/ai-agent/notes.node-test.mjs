import assert from 'node:assert/strict'
import test from 'node:test'
import { DISTILL_FIELDS } from './skill-contracts.mjs'
import {
  NOTE_STATUS,
  NoteValidationError,
  assertOwnerAction,
  assertTransition,
  canTransition,
  deriveProvenance,
  isQuotaReached,
  mergeNoteFields,
  normalizeNoteInput,
  normalizeTags,
  noteToMarkdown,
  notesToCsv,
  notesToMarkdown,
} from './notes.mjs'
import { parseSkillFrontmatter } from './skills.mjs'

test('normalizeTags 去空白、去空值、去重并限制数量', () => {
  const tags = normalizeTags([' 补货 ', '补货', '', '   ', null, 7, '库存'])
  assert.deepEqual(tags, ['补货', '库存'])
})

test('normalizeTags 截断超长标签，且截断后再去重', () => {
  const long = 'a'.repeat(30)
  const tags = normalizeTags([long, `${'a'.repeat(20)}bbbbbbbbbb`])
  assert.equal(tags.length, 1)
  assert.equal(tags[0].length, 20)
})

test('normalizeTags 最多保留 10 个标签，非数组输入返回空数组', () => {
  const tags = normalizeTags(Array.from({ length: 15 }, (_, index) => `tag${index}`))
  assert.equal(tags.length, 10)
  assert.deepEqual(normalizeTags(null), [])
  assert.deepEqual(normalizeTags('补货'), [])
})

test('normalizeNoteInput 要求标题非空且不超过 200 字', () => {
  assert.throws(() => normalizeNoteInput({ title: '   ' }), NoteValidationError)
  assert.throws(() => normalizeNoteInput({ title: 'a'.repeat(201) }), NoteValidationError)
  assert.equal(normalizeNoteInput({ title: ' 补货流程 ' }).title, '补货流程')
})

test('normalizeNoteInput 只保留字符串字段值并剔除空值', () => {
  const input = normalizeNoteInput({
    title: '标题',
    fields: { scenario: ' 断货场景 ', background: '', approach: 42, result: null },
  })
  assert.deepEqual(input.fields, { scenario: '断货场景' })
})

test('normalizeNoteInput 拒绝非对象的字段集合', () => {
  assert.throws(() => normalizeNoteInput({ title: '标题', fields: '不是对象' }), NoteValidationError)
})

test('normalizeNoteInput 截断摘要与原文引句', () => {
  const input = normalizeNoteInput({
    title: '标题',
    summary: 's'.repeat(600),
    evidence: 'e'.repeat(600),
  })
  assert.equal(input.summary.length, 500)
  assert.equal(input.evidence.length, 500)
})

test('normalizeNoteInput 的 provenance 只允许 user_stated 与 inferred，默认 user_stated', () => {
  assert.equal(normalizeNoteInput({ title: '标题' }).provenance, 'user_stated')
  assert.equal(normalizeNoteInput({ title: '标题', provenance: 'inferred' }).provenance, 'inferred')
  assert.throws(() => normalizeNoteInput({ title: '标题', provenance: 'guessed' }), NoteValidationError)
})

test('mergeNoteFields 用非空新值覆盖，空值保留原值', () => {
  const result = mergeNoteFields(
    { scenario: '旧场景', approach: '旧做法', result: '' },
    { scenario: '', approach: '新做法', pitfalls: '新增的坑' }
  )
  assert.deepEqual(result.fields, {
    scenario: '旧场景',
    approach: '新做法',
    result: '',
    pitfalls: '新增的坑',
  })
  assert.deepEqual(result.changedKeys.sort(), ['approach', 'pitfalls'])
})

test('mergeNoteFields 在没有任何变化时返回空 changedKeys', () => {
  const result = mergeNoteFields({ scenario: '甲' }, { scenario: '甲', background: '' })
  assert.deepEqual(result.changedKeys, [])
})

test('状态机：本人可提交审核、可归档，管理员才能审核通过或驳回', () => {
  assert.equal(canTransition(NOTE_STATUS.private, NOTE_STATUS.pending, { isAdmin: false }), true)
  assert.equal(canTransition(NOTE_STATUS.pending, NOTE_STATUS.published, { isAdmin: true }), true)
  assert.equal(canTransition(NOTE_STATUS.pending, NOTE_STATUS.rejected, { isAdmin: true }), true)
  assert.equal(canTransition(NOTE_STATUS.private, NOTE_STATUS.archived, { isAdmin: false }), true)
  assert.equal(canTransition(NOTE_STATUS.rejected, NOTE_STATUS.private, { isAdmin: false }), true)
})

test('状态机：本人不能越过审核直接发布，管理员也不能把私有草稿直接变已发布', () => {
  assert.equal(canTransition(NOTE_STATUS.pending, NOTE_STATUS.published, { isAdmin: false }), false)
  assert.equal(canTransition(NOTE_STATUS.private, NOTE_STATUS.published, { isAdmin: true }), false)
  assert.equal(canTransition(NOTE_STATUS.rejected, NOTE_STATUS.published, { isAdmin: true }), false)
})

test('状态机：同状态流转与未知状态一律拒绝', () => {
  assert.equal(canTransition(NOTE_STATUS.private, NOTE_STATUS.private, { isAdmin: true }), false)
  assert.equal(canTransition('draft', NOTE_STATUS.pending, { isAdmin: true }), false)
  assert.throws(() => assertTransition('draft', NOTE_STATUS.pending, { isAdmin: true }), NoteValidationError)
})

test('状态机：已发布的沉淀只能由管理员归档', () => {
  assert.equal(canTransition(NOTE_STATUS.published, NOTE_STATUS.archived, { isAdmin: true }), true)
  assert.equal(canTransition(NOTE_STATUS.published, NOTE_STATUS.archived, { isAdmin: false }), false)
})

test('状态机：被驳回的条目可由本人修改后直接重新提交，但自己不能审核', () => {
  // 员工页面对「已驳回」条目一直有「提交审核」入口，这条边缺失会让按钮点了必然报错
  assert.equal(canTransition(NOTE_STATUS.rejected, NOTE_STATUS.pending, { isAdmin: false }), true)
  assert.equal(canTransition(NOTE_STATUS.rejected, NOTE_STATUS.pending, { isAdmin: true }), false)
  assert.equal(canTransition(NOTE_STATUS.rejected, NOTE_STATUS.published, { isAdmin: true }), false)
  assert.equal(canTransition(NOTE_STATUS.rejected, NOTE_STATUS.archived, { isAdmin: false }), true)
})

test('noteToMarkdown 输出带 frontmatter 的单条 Markdown，可被技能解析器复用', () => {
  const markdown = noteToMarkdown(
    {
      id: 12,
      title: '断货补货要走运营主管审批',
      status: NOTE_STATUS.published,
      owner_name: '张三',
      tags: ['补货', '库存'],
      summary: '补货申请必须经运营主管审批后再提交采购。',
      evidence: '“补货这块得运营主管点头才能报采购”',
      provenance: 'inferred',
      created_at: '2026-09-11T02:00:00.000Z',
      updated_at: '2026-09-11T03:00:00.000Z',
      conversation_id: 7,
      skill_name: 'knowledge-distill',
      fields: { scenario: '库存不足时', approach: '先报运营主管' },
    },
    { fields: DISTILL_FIELDS }
  )
  const { frontmatter, body } = parseSkillFrontmatter(markdown)
  assert.equal(frontmatter.id, 12)
  assert.equal(frontmatter.title, '断货补货要走运营主管审批')
  assert.equal(frontmatter.status, NOTE_STATUS.published)
  assert.equal(frontmatter.owner, '张三')
  assert.deepEqual(frontmatter.tags, ['补货', '库存'])
  assert.equal(frontmatter.conversationId, 7)
  assert.equal(frontmatter.provenance, 'inferred')
  assert.ok(body.includes('## 场景'))
  assert.ok(body.includes('先报运营主管'))
  // 没有值的字段不输出空标题，避免导出文件全是空章节
  assert.ok(!body.includes('## 结果'))
})

test('notesToMarkdown 导出多条时带文件头与分隔符，并包含全部条目', () => {
  const notes = [
    { id: 1, title: '第一条', status: NOTE_STATUS.private, tags: [], fields: { scenario: '甲' } },
    { id: 2, title: '第二条', status: NOTE_STATUS.pending, tags: [], fields: { result: '乙' } },
  ]
  const text = notesToMarkdown(notes, { fields: DISTILL_FIELDS })
  assert.ok(text.startsWith('<!-- 知识沉淀导出 -->'))
  // 分隔符必须与 frontmatter 的收尾 `---` 区分开，否则导出的文件无法再拆回单条
  assert.equal(text.split('\n\n---\n\n').length, 3)
  assert.ok(text.includes('第一条'))
  assert.ok(text.includes('第二条'))
})

test('notesToMarkdown 对空列表仍返回文件头', () => {
  const text = notesToMarkdown([], { fields: DISTILL_FIELDS })
  assert.ok(text.startsWith('<!-- 知识沉淀导出 -->'))
  assert.ok(!text.includes('第一条'))
})

test('notesToCsv 输出中文表头、结构化字段列，并转义逗号与引号', () => {
  const csv = notesToCsv(
    [
      {
        id: 1,
        title: '标题里有,逗号',
        status: NOTE_STATUS.private,
        owner_login: '16686400050',
        owner_name: '张三',
        tags: ['补货'],
        fields: { scenario: '含"引号"的场景' },
        created_at: '2026-09-11T02:00:00.000Z',
        updated_at: '2026-09-11T02:00:00.000Z',
      },
    ],
    { fields: DISTILL_FIELDS }
  )
  const [header, row] = csv.replace(/^\uFEFF/, '').trim().split('\r\n')
  assert.ok(csv.startsWith('\uFEFF'), 'CSV 必须带 BOM，否则 Excel 打开中文乱码')
  assert.equal(
    header,
    'ID,标题,状态,账号,标签,场景,背景,做法,结果,踩过的坑,适用条件,原文依据,来源可信度,来源会话,创建时间,更新时间'
  )
  assert.ok(row.includes('"标题里有,逗号"'))
  assert.ok(row.includes('""引号""'))
})

test('notesToCsv 用标签连接符而不是 JSON，便于 Excel 阅读', () => {
  const csv = notesToCsv([{ id: 1, title: '甲', tags: ['a', 'b'], fields: {} }], {
    fields: DISTILL_FIELDS,
  })
  assert.ok(csv.includes('a / b'))
})

test('isQuotaReached 只按 AI 整理次数判定，0 表示不限制', () => {
  assert.equal(isQuotaReached({ used: 4, limit: 5 }), false)
  assert.equal(isQuotaReached({ used: 5, limit: 5 }), true)
  assert.equal(isQuotaReached({ used: 6, limit: 5 }), true)
  // 0 = 关闭配额限制（界面上明确告知），不能理解成"一次都不许"
  assert.equal(isQuotaReached({ used: 999, limit: 0 }), false)
  assert.equal(isQuotaReached({}), false)
  assert.equal(isQuotaReached(), false)
})

test('deriveProvenance 由服务端按来源判定：会话整理=模型推断，手工新建=本人所写', () => {
  assert.equal(deriveProvenance('conversation'), 'inferred')
  assert.equal(deriveProvenance('manual'), 'user_stated')
  // 未知来源只可能是手工路径（客户端传坏值也不产生第三种取值）
  assert.equal(deriveProvenance(undefined), 'user_stated')
  assert.equal(deriveProvenance('guessed'), 'user_stated')
})

test('assertOwnerAction 只放行所有者本人，管理员代他人操作也被拒绝', () => {
  const note = { id: 7, ownerUserId: 2 }
  const owner = { id: 2, role: 'operator', status: 'enabled' }
  const admin = { id: 1, role: 'admin', status: 'enabled' }
  assert.doesNotThrow(() => assertOwnerAction({ note, user: owner, action: 'submit' }))
  assert.throws(
    () => assertOwnerAction({ note, user: admin, action: 'submit' }),
    NoteValidationError
  )
  assert.throws(() => assertOwnerAction({ note: null, user: owner }), NoteValidationError)
  assert.throws(() => assertOwnerAction({ note, user: null }), NoteValidationError)
})

test('assertOwnerAction 的报错文案带上动作，便于提报人理解被拒原因', () => {
  const error = (() => {
    try {
      assertOwnerAction({ note: { ownerUserId: 2 }, user: { id: 1 }, action: 'delete' })
      return null
    } catch (caught) {
      return caught
    }
  })()
  assert.ok(error instanceof NoteValidationError)
  assert.match(error.message, /删除/)
})

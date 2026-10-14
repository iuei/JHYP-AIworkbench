import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHUNK_DEFAULTS,
  KnowledgeValidationError,
  chunkText,
  estimateTokenCount,
  extractDocumentText,
  extractQueryTokens,
  expandQueryTokens,
  parsePositiveInt,
} from './knowledge.mjs'

test('chunkText 对空文本返回空数组', () => {
  assert.deepEqual(chunkText(''), [])
  assert.deepEqual(chunkText('   \n\n  '), [])
  assert.deepEqual(chunkText(null), [])
})

test('chunkText 超长单段按 size 硬切且相邻片保留 100 字重叠', () => {
  const paragraph = Array.from({ length: 2000 }, (_, index) => String(index % 10)).join('')
  const chunks = chunkText(paragraph)
  assert.ok(chunks.length >= 3, `实际切片数 ${chunks.length}`)
  assert.equal(chunks[0].length, CHUNK_DEFAULTS.size)
  assert.equal(chunks[0].slice(-CHUNK_DEFAULTS.overlap), chunks[1].slice(0, CHUNK_DEFAULTS.overlap))
  assert.equal(chunks[1].slice(-CHUNK_DEFAULTS.overlap), chunks[2].slice(0, CHUNK_DEFAULTS.overlap))
  assert.ok(chunks.at(-1).endsWith(paragraph.slice(-10)))
})

test('chunkText 按段落聚合，不把短段落切碎', () => {
  const text = '第一段内容。\n\n第二段内容。\n\n第三段内容。'
  const chunks = chunkText(text, { size: 800, overlap: 100 })
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0], text)
})

test('chunkText 在累计超过 size 时另起一片', () => {
  const paragraph = 'a'.repeat(300)
  const text = [paragraph, paragraph, paragraph].join('\n\n')
  const chunks = chunkText(text, { size: 800, overlap: 100 })
  assert.equal(chunks.length, 2)
  assert.equal(chunks[0], `${paragraph}\n\n${paragraph}`)
  assert.equal(chunks[1], paragraph)
})

test('chunkText 单段本身接近 size 时每段独立成片', () => {
  const paragraph = 'b'.repeat(500)
  const chunks = chunkText([paragraph, paragraph, paragraph].join('\n\n'), {
    size: 800,
    overlap: 100,
  })
  assert.equal(chunks.length, 3)
  for (const chunk of chunks) assert.equal(chunk, paragraph)
})

test('chunkText 拒绝非法 size', () => {
  assert.throws(() => chunkText('内容', { size: 0 }), KnowledgeValidationError)
  assert.throws(() => chunkText('内容', { size: -1 }), KnowledgeValidationError)
})

test('extractQueryTokens 对中文问题生成可用的双字关键词', () => {
  const tokens = extractQueryTokens('亚马逊断货怎么补货')
  assert.ok(tokens.includes('断货'), tokens.join(','))
  assert.ok(tokens.includes('补货'), tokens.join(','))
  assert.ok(tokens.includes('亚马'), tokens.join(','))
  assert.ok(!tokens.includes('怎么'), '疑问词应作为噪声剔除')
})

test('extractQueryTokens 提取拉丁词与数字混合词', () => {
  const tokens = extractQueryTokens('SKU-1234 的库存，看 B0XXXX 的 ACoS')
  assert.ok(tokens.includes('sku-1234'), tokens.join(','))
  assert.ok(tokens.includes('b0xxxx'), tokens.join(','))
  assert.ok(tokens.includes('acos'), tokens.join(','))
})

test('extractQueryTokens 去重、限制数量、处理空输入', () => {
  assert.deepEqual(extractQueryTokens(''), [])
  assert.deepEqual(extractQueryTokens(null), [])
  const long = '亚马逊断货补货流程制度规范库存订单查询广告销售报表归因分析'
  const tokens = extractQueryTokens(long)
  assert.ok(tokens.length <= 12, `实际 ${tokens.length}`)
  assert.equal(new Set(tokens).size, tokens.length)
  assert.deepEqual(extractQueryTokens('很长的内容', { max: 1 }).length, 1)
})

test('expandQueryTokens 为口语化提问补领域同义词，且不回吐原词', () => {
  const tokens = extractQueryTokens('考勤')
  assert.deepEqual(tokens, ['考勤'])
  const expanded = expandQueryTokens(tokens, '考勤')
  assert.ok(expanded.includes('工作时间'), expanded.join(','))
  assert.ok(!expanded.includes('考勤'), '扩展词里不应重复原词')
})

test('expandQueryTokens 对整词查询也能扩展（双字切分拿不到整词）', () => {
  const expanded = expandQueryTokens(extractQueryTokens('作息时间'), '作息时间')
  assert.ok(expanded.includes('工作时间'), expanded.join(','))
})

test('expandQueryTokens 不给表外词乱扩展，避免把相关性下限刷掉', () => {
  assert.deepEqual(expandQueryTokens(extractQueryTokens('星际飞船停放规定'), '星际飞船停放规定'), [])
  assert.deepEqual(expandQueryTokens([], ''), [])
})

test('extractDocumentText 支持文本类格式并去掉 BOM', () => {
  const result = extractDocumentText({
    fileName: '制度.md',
    buffer: Buffer.from('\uFEFF# 补货制度\n\n第一步：确认断货。', 'utf8'),
  })
  assert.equal(result.ok, true)
  assert.ok(result.text.startsWith('# 补货制度'))
})

test('extractDocumentText 明确拒绝 PDF / Word / Excel，提示可读错误', () => {
  for (const fileName of ['制度.pdf', '制度.docx', '库存.xlsx', '制度.doc']) {
    const result = extractDocumentText({ fileName, buffer: Buffer.from('x') })
    assert.equal(result.ok, false, fileName)
    assert.match(result.error, /暂不支持/)
  }
})

test('extractDocumentText 拒绝未知扩展名与空文件', () => {
  const unknown = extractDocumentText({ fileName: 'data.bin', buffer: Buffer.from('x') })
  assert.equal(unknown.ok, false)
  assert.match(unknown.error, /无法识别的文件格式/)

  const empty = extractDocumentText({ fileName: '制度.txt', buffer: Buffer.alloc(0) })
  assert.equal(empty.ok, false)
  assert.match(empty.error, /为空/)
})

test('extractDocumentText 拒绝超过 2MB 的文件', () => {
  const result = extractDocumentText({
    fileName: '大文件.txt',
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 0x61),
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /上限/)
})

test('estimateTokenCount 对中文按字计、对拉丁按 4 字符计', () => {
  assert.equal(estimateTokenCount(''), 0)
  assert.equal(estimateTokenCount('补货流程'), 4)
  assert.equal(estimateTokenCount('abcdefgh'), 2)
})

test('parsePositiveInt 对越界与非法值做兜底', () => {
  assert.equal(parsePositiveInt('5', { fallback: 1, min: 1, max: 10 }), 5)
  assert.equal(parsePositiveInt(999, { fallback: 1, min: 1, max: 10 }), 10)
  assert.equal(parsePositiveInt(0, { fallback: 3, min: 1, max: 10 }), 1)
  assert.equal(parsePositiveInt('abc', { fallback: 3, min: 1, max: 10 }), 3)
  assert.equal(parsePositiveInt(undefined, { fallback: 3, min: 1, max: 10 }), 3)
  assert.equal(parsePositiveInt(2.5, { fallback: 3, min: 1, max: 10 }), 3)
})

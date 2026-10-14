import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ATTRIBUTE_KEY_PREFIX,
  MANUAL_DIMENSIONS,
  MAX_ATTRIBUTE_KEY_LENGTH,
  MAX_DYNAMIC_DIMENSIONS,
  ProductDevValidationError,
  REPORT_DIMENSIONS,
  STAGE_LABELS,
  STAGES,
  buildComparisonNote,
  buildComparisonRows,
  candidateDedupeKey,
  collectDynamicDimensions,
  normalizeAttributes,
  normalizeCandidateInput,
  normalizeText,
  parseMarketplace,
  parseStage,
  parseTargetPrice,
} from './product-dev.mjs'

/* ---------- 文本与枚举校验 ---------- */

test('normalizeText 合并空白、去首尾，并按需强制必填', () => {
  assert.equal(normalizeText('  便携  榨汁杯 ', { max: 10, label: '名称' }), '便携 榨汁杯')
  assert.equal(normalizeText('', { max: 10, label: '名称' }), null)
  assert.equal(normalizeText(undefined, { max: 10, label: '名称' }), undefined, '未传 ≠ 传空')
  assert.throws(
    () => normalizeText('', { max: 10, label: '名称', required: true }),
    ProductDevValidationError
  )
  assert.throws(() => normalizeText('一二三四五六', { max: 5, label: '名称' }), ProductDevValidationError)
})

test('parseMarketplace 只接受支持范围内的站点', () => {
  assert.equal(parseMarketplace('us'), 'US')
  assert.equal(parseMarketplace(undefined), 'US', '不传用默认站点')
  assert.throws(() => parseMarketplace('XX'), ProductDevValidationError)
})

test('parseStage 认枚举与中文标签，空值表示"不改"，非法值报错', () => {
  assert.equal(parseStage('researching'), 'researching')
  assert.equal(parseStage('已立项'), 'approved')
  assert.equal(parseStage(''), undefined)
  assert.throws(() => parseStage('随便看看'), ProductDevValidationError)
})

test('parseTargetPrice 只接受非负有限数，空串表示清空', () => {
  assert.equal(parseTargetPrice('19.99'), 19.99)
  assert.equal(parseTargetPrice(''), null)
  assert.equal(parseTargetPrice(null), null)
  assert.equal(parseTargetPrice(undefined), undefined)
  assert.throws(() => parseTargetPrice('abc'), ProductDevValidationError)
  assert.throws(() => parseTargetPrice(-1), ProductDevValidationError)
})

test('normalizeAttributes 全部转字符串，跳过空值，守住键数与长度上限', () => {
  assert.deepEqual(normalizeAttributes({ 评分: 4.3, 评论数: 1200, 空值: '' }), {
    评分: '4.3',
    评论数: '1200',
  })
  assert.deepEqual(normalizeAttributes(null), {})
  assert.deepEqual(normalizeAttributes(undefined), undefined)
  assert.throws(() => normalizeAttributes([]), ProductDevValidationError)
  assert.throws(
    () => normalizeAttributes({ ['长'.repeat(MAX_ATTRIBUTE_KEY_LENGTH + 1)]: '1' }),
    ProductDevValidationError
  )
})

/* ---------- 候选写入体 ---------- */

test('normalizeCandidateInput 归一化完整输入', () => {
  const input = normalizeCandidateInput({
    productName: '便携榨汁杯',
    asin: 'b0sample01',
    category: '厨房小家电',
    targetPrice: '19.99',
    marketplace: 'us',
    stage: '调研中',
    note: '看评论区痛点',
    attributes: { 评分: '4.3' },
  })
  assert.equal(input.product_name, '便携榨汁杯')
  assert.equal(input.asin, 'B0SAMPLE01')
  assert.equal(input.category, '厨房小家电')
  assert.equal(input.target_price, 19.99)
  assert.equal(input.marketplace, 'US')
  assert.equal(input.stage, 'researching')
  assert.equal(input.note, '看评论区痛点')
  assert.deepEqual(input.attributes, { 评分: '4.3' })
})

test('normalizeCandidateInput 接受亚马逊商品链接作为 ASIN', () => {
  const input = normalizeCandidateInput({
    productName: '榨汁杯',
    asin: 'https://www.amazon.com/dp/B0SAMPLE01?ref_=x',
  })
  assert.equal(input.asin, 'B0SAMPLE01')
})

test('normalizeCandidateInput 拒绝无法识别的 ASIN', () => {
  assert.throws(
    () => normalizeCandidateInput({ productName: '榨汁杯', asin: '不是ASIN' }),
    ProductDevValidationError
  )
})

test('normalizeCandidateInput 要求名称与 ASIN 至少有一个', () => {
  assert.throws(() => normalizeCandidateInput({}), ProductDevValidationError)
  assert.throws(
    () => normalizeCandidateInput({ productName: '  ', asin: null }),
    ProductDevValidationError
  )
  // 只有 ASIN 也可以：名称可以后补
  const onlyAsin = normalizeCandidateInput({ asin: 'B0SAMPLE01' })
  assert.equal(onlyAsin.asin, 'B0SAMPLE01')
  assert.equal(onlyAsin.product_name, '')
})

test('normalizeCandidateInput 的 partial 模式只处理传进来的字段', () => {
  const input = normalizeCandidateInput({ category: '户外' }, { partial: true })
  assert.deepEqual(Object.keys(input), ['category'], '没传的字段不能出现在更新体里（否则会被清空）')
  assert.equal(input.category, '户外')
})

test('normalizeCandidateInput 的 partial 模式禁止把名称与 ASIN 同时清空', () => {
  assert.throws(
    () => normalizeCandidateInput(
      { productName: '', currentName: '', currentAsin: null },
      { partial: true }
    ),
    ProductDevValidationError
  )
  // 保留 ASIN 时清空名称是允许的
  const cleared = normalizeCandidateInput(
    { productName: '', currentName: '旧名', currentAsin: 'B0SAMPLE01' },
    { partial: true }
  )
  assert.equal(cleared.product_name, '')
})

/* ---------- 判重键 ---------- */

test('candidateDedupeKey 有 ASIN 按 ASIN，没有则按站点 + 名称', () => {
  assert.equal(
    candidateDedupeKey({ marketplace: 'US', asin: 'B0SAMPLE01', product_name: '榨汁杯' }),
    'asin:US:B0SAMPLE01'
  )
  assert.equal(
    candidateDedupeKey({ marketplace: 'US', asin: null, product_name: '榨汁杯' }),
    'name:US:榨汁杯',
    '同名不同站点不冲突，因此站点要进键'
  )
  assert.notEqual(
    candidateDedupeKey({ marketplace: 'US', asin: null, product_name: '榨汁杯' }),
    candidateDedupeKey({ marketplace: 'JP', asin: null, product_name: '榨汁杯' })
  )
})

/* ---------- 动态维度 ---------- */

test('collectDynamicDimensions 按出现次数降序，同频次保持首次出现顺序', () => {
  const { keys, omitted } = collectDynamicDimensions([
    { attributes: { 评分: '4.3', 评论数: '100' } },
    { attributes: { 评分: '4.5', 月销量: '300' } },
    { attributes: { 评分: '4.1' } },
  ])
  assert.deepEqual(keys, ['评分', '评论数', '月销量'])
  assert.equal(omitted, 0)
})

test('collectDynamicDimensions 超限时截断并如实报出被省略的数量', () => {
  const attributes = {}
  for (let i = 0; i < MAX_DYNAMIC_DIMENSIONS + 3; i += 1) attributes[`维度${i}`] = '1'
  const { keys, omitted } = collectDynamicDimensions([{ attributes }])
  assert.equal(keys.length, MAX_DYNAMIC_DIMENSIONS)
  assert.equal(omitted, 3, '静默截断会让用户以为"我就填了这么几列"')
})

/* ---------- 对比装配 ---------- */

const CANDIDATE_A = {
  id: 1,
  marketplace: 'US',
  asin: 'B0SAMPLE01',
  product_name: '便携榨汁杯',
  category: '厨房小家电',
  target_price: 19.99,
  stage: 'candidate',
  note: null,
  attributes: { 评分: '4.3' },
}

const METRICS = {
  impressions: 10000,
  clicks: 200,
  spend: 60,
  adSales: 300,
  orders: 15,
  acos: 20,
  ctr: 2,
  cvr: 7.5,
  cpc: 0.3,
  units: 40,
  businessSales: 800,
  returns: 2,
  returnRate: 5,
}

test('buildComparisonRows 把维度摊平成 values，前端不需要再写取值分支', () => {
  const rows = buildComparisonRows({
    candidates: [CANDIDATE_A],
    metricsByAsin: new Map([['B0SAMPLE01', METRICS]]),
    dynamicKeys: ['评分'],
  })
  const row = rows[0]
  assert.equal(row.coverage, 'ok')
  assert.equal(row.coverageLabel, '有我方报表数据')
  assert.equal(row.emptyReason, null)
  assert.equal(row.values.product_name, '便携榨汁杯')
  assert.equal(row.values.target_price, 19.99)
  assert.equal(row.values.stage, STAGE_LABELS.candidate, '阶段按中文标签展示')
  assert.equal(row.values[`${ATTRIBUTE_KEY_PREFIX}评分`], '4.3')
  assert.equal(row.values.spend, 60)
  assert.equal(row.values.adSales, 300, '广告销售额是独立维度')
  assert.equal(row.values.businessSales, 800, '业务销售额不能被广告销售额覆盖')
  assert.equal(row.values.units, 40)
})

test('buildComparisonRows 对没有 ASIN 的候选给出 no_asin 并不编造指标', () => {
  const rows = buildComparisonRows({
    candidates: [{ ...CANDIDATE_A, asin: null, product_name: '未上架水壶' }],
    metricsByAsin: new Map(),
    dynamicKeys: [],
  })
  const row = rows[0]
  assert.equal(row.coverage, 'no_asin')
  assert.match(row.emptyReason, /没有填写 ASIN/)
  // 关键：无数据是 null 而不是 0，否则"没填"会被算成"表现差"
  for (const dimension of REPORT_DIMENSIONS) {
    assert.equal(row.values[dimension.key], null, `${dimension.key} 应为 null`)
  }
  assert.equal(row.values.product_name, '未上架水壶')
})

test('buildComparisonRows 对有 ASIN 但报表无记录的候选给出 no_report_data', () => {
  const rows = buildComparisonRows({
    candidates: [CANDIDATE_A],
    metricsByAsin: new Map(),
    dynamicKeys: [],
  })
  assert.equal(rows[0].coverage, 'no_report_data')
  assert.match(rows[0].emptyReason, /没有该 ASIN 在所选区间的记录/)
  assert.equal(rows[0].values.spend, null)
})

test('buildComparisonRows 对未填写的可选字段给出 null 而不是空串', () => {
  const rows = buildComparisonRows({
    candidates: [{ ...CANDIDATE_A, category: '', note: null, target_price: null }],
    metricsByAsin: new Map(),
    dynamicKeys: [],
  })
  assert.equal(rows[0].values.category, null)
  assert.equal(rows[0].values.note, null)
  assert.equal(rows[0].values.target_price, null)
})

test('buildComparisonRows 的候选名回退到 ASIN，再回退到编号', () => {
  const rows = buildComparisonRows({
    candidates: [
      { ...CANDIDATE_A, product_name: '', asin: 'B0SAMPLE01' },
      { ...CANDIDATE_A, id: 7, product_name: '', asin: null },
    ],
    metricsByAsin: new Map(),
    dynamicKeys: [],
  })
  assert.equal(rows[0].name, 'B0SAMPLE01')
  assert.equal(rows[1].name, '候选 #7')
})

test('维度定义把人工录入与我方报表分开标注来源', () => {
  for (const dimension of MANUAL_DIMENSIONS) assert.equal(dimension.source, 'manual')
  for (const dimension of REPORT_DIMENSIONS) assert.equal(dimension.source, 'report')
})

test('buildComparisonNote 说明双轨来源，并在省略维度时如实声明', () => {
  const note = buildComparisonNote({
    marketplaceLabel: '美国',
    startDate: '2026-08-01',
    endDate: '2026-08-30',
    omitted: 0,
  })
  assert.match(note, /人工录入/)
  assert.match(note, /非实时|人工导出/)
  assert.match(note, /不使用 0 代替/)
  assert.doesNotMatch(note, /未展示/)

  const trimmed = buildComparisonNote({
    marketplaceLabel: '美国',
    startDate: '2026-08-01',
    endDate: '2026-08-30',
    omitted: 5,
  })
  assert.match(trimmed, /另有 5 个未展示/)
})

test('阶段枚举与标签一一对应', () => {
  for (const stage of STAGES) {
    assert.equal(typeof STAGE_LABELS[stage], 'string')
  }
  assert.equal(STAGES.length, Object.keys(STAGE_LABELS).length)
})

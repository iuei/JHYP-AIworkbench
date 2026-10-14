import assert from 'node:assert/strict'
import test from 'node:test'
import {
  asinMetricRow,
  buildDailyComparisonBlock,
  buildFindings,
  buildHeadline,
  CompetitorInputError,
  DEFAULT_WINDOW_DAYS,
  diffDays,
  extractAsin,
  finalizeFindings,
  MAX_ASIN_COUNT,
  MAX_RANGE_DAYS,
  normalizeDateInput,
  parseAsinList,
  parseCompetitorInput,
  shiftDays,
  summarizeComparison,
  SUPPORTED_INPUT_TYPES,
  toHistoryItem,
} from './competitor-analysis.mjs'

test('extractAsin 接受直接输入的 ASIN，并忽略大小写与首尾空白', () => {
  assert.equal(extractAsin('B0C1D2E3F4'), 'B0C1D2E3F4')
  assert.equal(extractAsin('  b0c1d2e3f4  '), 'B0C1D2E3F4')
})

test('extractAsin 能从亚马逊商品链接里取出 ASIN', () => {
  assert.equal(
    extractAsin('https://www.amazon.com/dp/B0C1D2E3F4?ref_=xxx'),
    'B0C1D2E3F4',
    '/dp/ 路径'
  )
  assert.equal(
    extractAsin('https://www.amazon.com/gp/product/B0C1D2E3F4/ref=ox_sc_act_title'),
    'B0C1D2E3F4',
    '/gp/product/ 路径'
  )
})

test('extractAsin 不做模糊提取，避免把无关片段当成 ASIN', () => {
  assert.equal(extractAsin('https://www.amazon.com/s?k=portable+blender'), null)
  assert.equal(extractAsin('B0C1D2E3F'), null, '长度不足')
  assert.equal(extractAsin('B0C1D2E3F45'), null, '长度超出')
  assert.equal(extractAsin('B0C1D2E3F-'), null, '含非法字符')
  assert.equal(extractAsin(''), null)
  assert.equal(extractAsin(null), null)
})

test('parseCompetitorInput 归一化合法输入', () => {
  const parsed = parseCompetitorInput({ inputType: 'asin', inputValue: 'b0c1d2e3f4' })
  assert.equal(parsed.inputType, 'ASIN')
  assert.equal(parsed.primaryAsin, 'B0C1D2E3F4')
  assert.deepEqual(parsed.asins, ['B0C1D2E3F4'])
  assert.deepEqual(parsed.competitorAsins, [])
  assert.equal(parsed.compareWith, 'previous_period', '默认环比')
  assert.equal(parsed.windowDays, null, '未指定时由服务端按数据推导')
})

test('parseAsinList 支持多种分隔符、去重且保序（第一个是本品）', () => {
  const { asins, invalid } = parseAsinList(
    'B0AAAAAAAA, B0BBBBBBBB\nB0CCCCCCCC、B0AAAAAAAA；b0dddddddd'
  )
  assert.deepEqual(asins, ['B0AAAAAAAA', 'B0BBBBBBBB', 'B0CCCCCCCC', 'B0DDDDDDDD'])
  assert.deepEqual(invalid, [])
})

test('parseAsinList 能从混入的商品链接里取出 ASIN，并收集无法识别的片段', () => {
  const { asins, invalid } = parseAsinList(
    'https://www.amazon.com/dp/B0AAAAAAAA, B0BBBBBBBB, not-an-asin'
  )
  assert.deepEqual(asins, ['B0AAAAAAAA', 'B0BBBBBBBB'])
  assert.deepEqual(invalid, ['not-an-asin'])
})

test('parseCompetitorInput 支持多 ASIN 并给出对比分组', () => {
  const parsed = parseCompetitorInput({
    inputType: 'ASIN',
    inputValue: 'B0AAAAAAAA, B0BBBBBBBB',
  })
  assert.equal(parsed.primaryAsin, 'B0AAAAAAAA')
  assert.deepEqual(parsed.competitorAsins, ['B0BBBBBBBB'])
  assert.equal(parsed.inputValue, 'B0AAAAAAAA,B0BBBBBBBB', '入库用归一化列表')
})

test('parseCompetitorInput 拦下无法识别的 ASIN 片段，并指出是哪一段', () => {
  assert.throws(
    () => parseCompetitorInput({ inputType: 'ASIN', inputValue: 'B0AAAAAAAA, XYZ' }),
    (error) => {
      assert.ok(error instanceof CompetitorInputError)
      assert.match(error.message, /XYZ/)
      return true
    }
  )
})

test('parseCompetitorInput 限制单次对比数量', () => {
  const many = Array.from({ length: MAX_ASIN_COUNT + 1 }, (_, index) =>
    `B0${String(index).padStart(8, '0')}`
  ).join(',')
  assert.throws(
    () => parseCompetitorInput({ inputType: 'ASIN', inputValue: many }),
    (error) => {
      assert.match(error.message, new RegExp(`最多对比 ${MAX_ASIN_COUNT} 个`))
      return true
    }
  )
})

test('parseCompetitorInput 对没有数据源的维度明确报错，而不是编造结果', () => {
  // 品牌名 / 店铺链接在现有数据集里没有对应字段：这里必须 400，
  // 而不是回一份看起来专业的分析（历史实现无论输入什么都返回同一组写死结论）。
  assert.deepEqual(SUPPORTED_INPUT_TYPES, ['ASIN'])
  for (const inputType of ['品牌名', '店铺链接', 'BRAND']) {
    assert.throws(
      () => parseCompetitorInput({ inputType, inputValue: 'something' }),
      (error) => {
        assert.ok(error instanceof CompetitorInputError)
        assert.match(error.message, /尚未接入/)
        return true
      },
      `${inputType} 应被拒绝`
    )
  }
})

test('parseCompetitorInput 拒绝缺失与非法输入', () => {
  assert.throws(() => parseCompetitorInput({}), CompetitorInputError)
  assert.throws(
    () => parseCompetitorInput({ inputType: 'ASIN', inputValue: '   ' }),
    CompetitorInputError
  )
  assert.throws(
    () => parseCompetitorInput({ inputType: 'ASIN', inputValue: 'not-an-asin' }),
    CompetitorInputError
  )
  assert.throws(
    () => parseCompetitorInput({ inputType: 'ASIN', inputValue: 'B0C1D2E3F4'.repeat(30) }),
    CompetitorInputError,
    '超长输入必须在进库前被拦下（competitor_analyses.input_value 是 VARCHAR(200)）'
  )
})

test('parseCompetitorInput 校验站点代码', () => {
  assert.equal(
    parseCompetitorInput({ inputType: 'ASIN', inputValue: 'B0AAAAAAAA', marketplace: 'us' })
      .marketplace,
    'US',
    '小写归一化为大写'
  )
  assert.throws(
    () => parseCompetitorInput({ inputType: 'ASIN', inputValue: 'B0AAAAAAAA', marketplace: 'USA' }),
    (error) => {
      assert.match(error.message, /两位站点代码/)
      return true
    }
  )
})

test('parseCompetitorInput 校验统计天数与自定义区间', () => {
  assert.equal(
    parseCompetitorInput({ inputType: 'ASIN', inputValue: 'B0AAAAAAAA', windowDays: 90 }).windowDays,
    90
  )
  assert.throws(
    () => parseCompetitorInput({ inputType: 'ASIN', inputValue: 'B0AAAAAAAA', windowDays: 3 }),
    /统计天数/
  )
  /*
   * 2026-09-16：页面新增「半年 / 一年」预设 —— 180 与 365 都必须被接受
   * （上限从 180 放宽到 365），366 才越界。
   */
  assert.equal(
    parseCompetitorInput({ inputType: 'ASIN', inputValue: 'B0AAAAAAAA', windowDays: 180 }).windowDays,
    180
  )
  assert.equal(
    parseCompetitorInput({ inputType: 'ASIN', inputValue: 'B0AAAAAAAA', windowDays: 365 }).windowDays,
    365
  )
  assert.throws(
    () => parseCompetitorInput({ inputType: 'ASIN', inputValue: 'B0AAAAAAAA', windowDays: 366 }),
    /统计天数/
  )
  assert.throws(
    () =>
      parseCompetitorInput({
        inputType: 'ASIN',
        inputValue: 'B0AAAAAAAA',
        startDate: '2026-08-01',
      }),
    /同时提供开始日期与结束日期/
  )
  assert.throws(
    () =>
      parseCompetitorInput({
        inputType: 'ASIN',
        inputValue: 'B0AAAAAAAA',
        startDate: '2026-08-31',
        endDate: '2026-08-01',
      }),
    /结束日期不能早于开始日期/
  )
  assert.throws(
    () =>
      parseCompetitorInput({
        inputType: 'ASIN',
        inputValue: 'B0AAAAAAAA',
        startDate: '2024-01-01',
        endDate: '2026-08-01',
      }),
    new RegExp(`最长 ${MAX_RANGE_DAYS} 天`)
  )
  assert.throws(
    () =>
      parseCompetitorInput({
        inputType: 'ASIN',
        inputValue: 'B0AAAAAAAA',
        windowDays: 30,
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      }),
    /不能同时使用/
  )
})

test('parseCompetitorInput 校验对比基线枚举', () => {
  assert.equal(
    parseCompetitorInput({ inputType: 'ASIN', inputValue: 'B0AAAAAAAA', compareWith: 'last_year' })
      .compareWith,
    'last_year'
  )
  assert.equal(
    parseCompetitorInput({ inputType: 'ASIN', inputValue: 'B0AAAAAAAA', compareWith: 'none' })
      .compareWith,
    'none'
  )
  assert.throws(
    () =>
      parseCompetitorInput({ inputType: 'ASIN', inputValue: 'B0AAAAAAAA', compareWith: 'MoM' }),
    /对比基线/
  )
})

test('normalizeDateInput 校验格式与真实日期', () => {
  assert.equal(normalizeDateInput('2026-08-31', '开始日期'), '2026-08-31')
  assert.equal(normalizeDateInput('', '开始日期'), null)
  assert.throws(() => normalizeDateInput('2026/08/31', '开始日期'), /YYYY-MM-DD/)
  assert.throws(() => normalizeDateInput('2026-02-30', '开始日期'), /不是有效日期/)
})

test('shiftDays 按 UTC 位移，跨月跨年不跑偏', () => {
  assert.equal(shiftDays('2026-09-11', -29), '2026-08-13')
  assert.equal(shiftDays('2026-03-01', -1), '2026-02-28')
  assert.equal(shiftDays('2026-01-01', -1), '2025-12-31')
  assert.equal(shiftDays('2024-03-01', -1), '2024-02-29', '闰年')
  assert.equal(shiftDays('不是日期', -1), '不是日期', '非法输入原样返回，不抛错')
})

test('diffDays 按 UTC 计算天数差', () => {
  assert.equal(diffDays('2026-08-01', '2026-08-31'), 30)
  assert.equal(diffDays('2026-08-31', '2026-08-31'), 0)
  assert.equal(diffDays('2026-01-01', '2026-03-01'), 59)
})

test('默认分析窗口为 30 天（含首尾）', () => {
  assert.equal(DEFAULT_WINDOW_DAYS, 30)
  assert.equal(shiftDays(shiftDays('2026-09-11', -(DEFAULT_WINDOW_DAYS - 1)), 1), '2026-08-14')
})

/* ---------- 指标行与组内对比 ---------- */

function payloadOf(current, extra = {}) {
  return {
    ok: true,
    empty: false,
    analysis: {
      current,
      anomalies: extra.anomalies ?? [],
      comparison: extra.comparison ?? { metrics: {}, notes: [] },
      decomposition: extra.decomposition ?? { ok: false, reason: '缺少对比期数据，无法分解' },
    },
    summary: extra.summary ?? '事实清单',
  }
}

test('asinMetricRow 把无数据的 ASIN 标成 hasData=false 而不是 0', () => {
  const row = asinMetricRow({
    asin: 'B0AAAAAAAA',
    role: 'competitor',
    payload: { empty: true, summary: '没有查到数据' },
  })
  assert.equal(row.hasData, false)
  assert.equal(row.spend, null)
  assert.equal(row.acos, null)
  assert.equal(row.emptyReason, '没有查到数据')
})

test('asinMetricRow 提取汇总指标并标记角色', () => {
  const row = asinMetricRow({
    asin: 'B0AAAAAAAA',
    role: 'subject',
    payload: payloadOf({ spend: 100, sales: 500, acos: 20, clicks: 80, cvr: 10, cpc: 1.25, units: 12, orders: 6 }),
  })
  assert.equal(row.hasData, true)
  assert.equal(row.roleLabel, '本品')
  assert.equal(row.acos, 20)
  assert.equal(row.units, 12)
})

test('summarizeComparison 只把有数据的 ASIN 计入均值与排名', () => {
  const rows = [
    { asin: 'B0AAAAAAAA', role: 'subject', roleLabel: '本品', hasData: true, acos: 40, cvr: 5, spend: 100, sales: 250, cpc: 1.5 },
    { asin: 'B0BBBBBBBB', role: 'competitor', roleLabel: '竞品', hasData: true, acos: 20, cvr: 10, spend: 200, sales: 1000, cpc: 1 },
    { asin: 'B0CCCCCCCC', role: 'competitor', roleLabel: '竞品', hasData: false, acos: null, cvr: null, spend: null, sales: null, cpc: null },
  ]
  const summary = summarizeComparison(rows)
  assert.equal(summary.enabled, true)
  assert.equal(summary.comparedCount, 2)
  assert.equal(summary.missingCount, 1)
  assert.equal(summary.competitorAverages.acos, 20, '缺数据的竞品不拉低均值')
  assert.equal(summary.acosRank.rank, 2, '本品 ACoS 40 高于竞品 20，排名第 2')
  assert.equal(summary.acosRank.total, 2)
  assert.equal(summary.acosRank.best.asin, 'B0BBBBBBBB')
  assert.equal(summary.cvrRank.rank, 2, '转化率 5 低于 10，排名第 2')
})

test('summarizeComparison 单 ASIN 时不启用对比', () => {
  const summary = summarizeComparison([
    { asin: 'B0AAAAAAAA', role: 'subject', roleLabel: '本品', hasData: true, acos: 30, cvr: 8 },
  ])
  assert.equal(summary.enabled, false)
  assert.equal(summary.competitorAverages.acos, null)
  assert.equal(summary.acosRank.rank, 1)
})

/* ---------- 结论生成 ---------- */

test('buildFindings 在本品无数据时如实说明，而不是给"整体健康"的评语', () => {
  const findings = buildFindings({
    subject: { empty: true, summary: '没有查到 B0AAAAAAAA（US）在区间内的数据。' },
  })
  assert.equal(findings.items.length, 1)
  assert.equal(findings.items[0].level, 'high')
  assert.match(findings.items[0].detail, /没有查到/)
  assert.ok(findings.items[0].action)
})

test('buildFindings 逐条转写预警线，并给出建议动作', () => {
  const findings = buildFindings({
    subject: payloadOf(
      { acos: 42.5, cvr: 5.2, ctr: 0.6 },
      {
        anomalies: [
          { metric: 'acos', label: 'ACoS', value: 42.5, threshold: 35, direction: 'above' },
          { metric: 'cvr', label: '转化率', value: 5.2, threshold: 7, direction: 'below' },
        ],
      }
    ),
    marketplace: 'US',
  })
  assert.equal(findings.items.length, 2)
  assert.equal(findings.level, 'high')
  assert.equal(findings.items[0].title, 'ACoS高于预警线')
  assert.match(findings.items[0].action, /竞价/)
  assert.equal(findings.items[1].level, 'medium')
  assert.match(findings.items[1].detail, /5.2/)
})

test('buildFindings 在 ACoS 环比上涨超 20% 时引用服务端驱动分解', () => {
  const findings = buildFindings({
    subject: payloadOf(
      { acos: 32.03, cvr: 9.46 },
      {
        comparison: {
          metrics: {
            acos: { current: 32.03, previous: 16.39, delta: 15.64, deltaPct: 95.42 },
          },
          notes: [],
        },
        decomposition: {
          ok: true,
          totalDelta: 15.64,
          spendEffect: 4.81,
          salesEffect: 10.83,
          dominantLabel: '销售额变化',
        },
      }
    ),
    comparisonLabel: '环比（上一等长区间）',
  })
  const item = findings.items.find((entry) => entry.title.includes('ACoS'))
  assert.ok(item, '应生成 ACoS 环比上涨结论')
  assert.match(item.detail, /花费效应 4.81/)
  assert.match(item.detail, /销售额变化/)
  assert.match(item.action, /转化端/)
})

test('buildFindings 在花费上涨但销售额下滑时给出高优先级结论', () => {
  const findings = buildFindings({
    subject: payloadOf(
      { acos: 32 },
      {
        comparison: {
          metrics: {
            spend: { current: 4030, previous: 2790, delta: 1240, deltaPct: 44.44 },
            sales: { current: 12580, previous: 17020, delta: -4440, deltaPct: -26.09 },
          },
          notes: [],
        },
      }
    ),
    comparisonLabel: '环比（上一等长区间）',
  })
  const item = findings.items.find((entry) => entry.title === '花费上涨但广告销售额下滑')
  assert.ok(item)
  assert.equal(item.level, 'high')
  assert.match(item.action, /增量花费/)
})

test('buildFindings 对首期为零的环比不给百分比结论（避免"增长 ∞%"）', () => {
  const findings = buildFindings({
    subject: payloadOf(
      { acos: 30 },
      {
        comparison: {
          metrics: { acos: { current: 30, previous: 0, delta: 30, deltaPct: null } },
          notes: [],
        },
      }
    ),
    comparisonLabel: '环比（上一等长区间）',
  })
  assert.equal(
    findings.items.some((entry) => entry.title.includes('ACoS 环比（上一等长区间）上涨')),
    false
  )
  assert.equal(findings.items[0].level, 'info')
})

test('buildFindings 在组内表现落后时给出对比结论', () => {
  const rows = [
    { asin: 'B0AAAAAAAA', role: 'subject', roleLabel: '本品', hasData: true, acos: 40, cvr: 5, spend: 100, sales: 250, cpc: 1.5 },
    { asin: 'B0BBBBBBBB', role: 'competitor', roleLabel: '竞品', hasData: true, acos: 20, cvr: 10, spend: 200, sales: 1000, cpc: 1 },
  ]
  const findings = buildFindings({
    subject: payloadOf({ acos: 40, cvr: 5 }),
    comparisonRows: rows,
    comparison: summarizeComparison(rows),
  })
  const acosItem = findings.items.find((entry) => entry.title.includes('高于组内竞品均值'))
  const cvrItem = findings.items.find((entry) => entry.title === '转化率低于组内竞品均值')
  assert.ok(acosItem)
  assert.match(acosItem.detail, /均值 20/)
  assert.ok(cvrItem)
  assert.match(cvrItem.evidence[0], /本品 5% vs 竞品均值 10%/)
})

test('buildFindings 在组内 ACoS 最低时给出可供复用的正向结论', () => {
  const rows = [
    { asin: 'B0AAAAAAAA', role: 'subject', roleLabel: '本品', hasData: true, acos: 12, cvr: 10, spend: 100, sales: 833, cpc: 1 },
    { asin: 'B0BBBBBBBB', role: 'competitor', roleLabel: '竞品', hasData: true, acos: 30, cvr: 6, spend: 200, sales: 666, cpc: 1.4 },
  ]
  const findings = buildFindings({
    subject: payloadOf({ acos: 12, cvr: 10 }),
    comparisonRows: rows,
    comparison: summarizeComparison(rows),
  })
  const item = findings.items.find((entry) => entry.title === 'ACoS 在组内最低')
  assert.ok(item)
  assert.equal(item.level, 'info')
})

test('buildFindings 把库存断货风险与建议补货量写进结论', () => {
  const findings = buildFindings({
    subject: payloadOf({ acos: 20, cvr: 9 }),
    inventory: {
      mapped: true,
      items: [
        {
          sku: 'KT-JH-001-BK',
          available: 40,
          inTransit: 0,
          dailySales: 5,
          daysOfSupply: 8,
          risk: 'stockout',
          suggestedReorder: 185,
        },
      ],
    },
  })
  const item = findings.items.find((entry) => entry.title.includes('断货风险'))
  assert.ok(item)
  assert.equal(item.level, 'high')
  assert.match(item.detail, /可售天数 8 天/)
  assert.match(item.action, /185 件/)
})

test('buildFindings 在本品未登记产品主数据时提示补数据，而不是报风险', () => {
  const findings = buildFindings({
    subject: payloadOf({ acos: 20, cvr: 9 }),
    inventory: {
      mapped: false,
      note: '「产品主数据」里没有 B0AAAAAAAA（US 站）的 SKU 映射，无法关联库存与可售天数。',
    },
  })
  const item = findings.items.find((entry) => entry.title === '没有关联到库存数据')
  assert.ok(item)
  assert.equal(item.level, 'info')
})

test('buildFindings 无任何命中时给出 info 级"未触发预警线"，不编造评语', () => {
  const findings = buildFindings({ subject: payloadOf({ acos: 18, cvr: 11, ctr: 0.9 }) })
  assert.equal(findings.items.length, 1)
  assert.equal(findings.items[0].level, 'info')
  assert.match(findings.items[0].title, /未触发/)
  assert.match(findings.items[0].detail, /18/)
})

test('finalizeFindings 按严重度排序并汇总最高级别', () => {
  const findings = finalizeFindings([
    { level: 'info', title: 'c' },
    { level: 'high', title: 'a' },
    { level: 'medium', title: 'b' },
  ])
  assert.deepEqual(
    findings.items.map((item) => item.title),
    ['a', 'b', 'c']
  )
  assert.equal(findings.level, 'high')
  assert.equal(findings.count, 3)
  assert.equal(findings.headline, 'a')
})

test('buildHeadline 在无高优问题时说明未触发预警', () => {
  const headline = buildHeadline({
    asin: 'B0AAAAAAAA',
    findings: finalizeFindings([{ level: 'info', title: '未触发预警线与库存风险' }]),
    marketplace: 'US',
    startDate: '2026-08-02',
    endDate: '2026-08-31',
    windowDays: 30,
  })
  assert.match(headline, /B0AAAAAAAA（US 站，2026-08-02 ~ 2026-08-31，30 天）/)
  assert.match(headline, /未触发预警/)
})

test('buildHeadline 列出需要处理的问题标题', () => {
  const headline = buildHeadline({
    asin: 'B0AAAAAAAA',
    findings: finalizeFindings([
      { level: 'high', title: 'ACoS高于预警线' },
      { level: 'medium', title: '转化率环比下滑 28%' },
      { level: 'info', title: '没有关联到库存数据' },
    ]),
    marketplace: 'US',
    startDate: '2026-08-02',
    endDate: '2026-08-31',
    windowDays: 30,
  })
  assert.match(headline, /命中 2 项/)
  assert.match(headline, /ACoS高于预警线/)
  assert.equal(headline.includes('转化率环比下滑 28%'), false, '标题不重复铺开全部问题')
  assert.equal(headline.includes('没有关联到库存数据'), false, 'info 不进标题')
})

/* ---------- 历史记录 ---------- */

test('toHistoryItem 优先用 asins 数组，快照缺失时回退 input_value', () => {
  const item = toHistoryItem({
    id: 12,
    input_type: 'ASIN',
    input_value: 'B0AAAAAAAA,B0BBBBBBBB',
    asins: ['B0AAAAAAAA', 'B0BBBBBBBB'],
    marketplace: 'US',
    start_date: '2026-08-02',
    end_date: '2026-08-31',
    window_days: 30,
    compare_with: 'previous_period',
    headline: '命中 1 项',
    level: 'high',
    finding_count: 3,
    has_snapshot: true,
    created_at: '2026-09-14T08:00:00.000Z',
  })
  assert.deepEqual(item.asins, ['B0AAAAAAAA', 'B0BBBBBBBB'])
  assert.equal(item.hasSnapshot, true)
  assert.equal(item.findingCount, 3)

  const legacy = toHistoryItem({
    id: 3,
    input_type: 'ASIN',
    input_value: 'B0CCCCCCCC',
    asins: [],
    result: null,
  })
  assert.deepEqual(legacy.asins, ['B0CCCCCCCC'], '旧记录没有 asins 列内容时从 input_value 解析')
  assert.equal(legacy.hasSnapshot, false)
  assert.equal(legacy.marketplace, null)
})

test('toHistoryItem 对空输入返回 null', () => {
  assert.equal(toHistoryItem(null), null)
})

/*
  2026-09-18 实测缺陷（用户在对话框问「我的asin列表 / 列出我分析过的竞品」时看到
  `query_competitor_analysis（rows.filter is not a function）`）：
  `competitorAnalysisPayload` 里写成 `list.map(toHistoryItem)`，而 `Array.map` 会把**数组下标**
  作为第二个参数传进来 —— 于是 `dispositions` 变成 `0`、`1`…，`clearedDispositionKeys(0)`
  里 `0.filter` 直接抛 `rows.filter is not a function`，整条历史列表接口/工具全挂。
*/
test('toHistoryItem 传入非数组 dispositions（map 下标）不崩，且按"无销账"处理', () => {
  const row = {
    id: 12,
    input_type: 'ASIN',
    input_value: 'B0AAAAAAAA',
    asins: ['B0AAAAAAAA'],
    finding_keys: [
      { code: 'high_acos', target: 'B0AAAAAAAA', level: 'high' },
      { code: 'info_note', target: 'B0AAAAAAAA', level: 'info' },
    ],
    finding_count: 2,
    level: 'high',
    has_snapshot: true,
  }
  // 旧写法 `list.map(toHistoryItem)` 传进来的就是下标
  for (const dirty of [0, 1, 'x']) {
    const item = toHistoryItem(row, dirty)
    assert.equal(item.openFindingCount, 1, String(dirty))
    assert.equal(item.clearedFindingCount, 0, String(dirty))
    assert.equal(item.openLevel, 'high', String(dirty))
  }
})


/* ---------- 按日对比（本品 vs 竞品） ---------- */

/** 造一个含「按日明细」块的载荷（列结构与 AI 助手载荷一致）。 */
function payloadWithDaily(rows) {
  return {
    blocks: [
      { kind: 'metrics', title: '期间汇总', items: [] },
      {
        kind: 'table',
        title: '按日明细',
        dataset: 'amazon_ads_daily',
        columns: [
          { key: 'date', label: '日期' },
          { key: 'impressions', label: '曝光', align: 'right' },
          { key: 'clicks', label: '点击', align: 'right' },
          { key: 'spend', label: '花费', align: 'right' },
          { key: 'orders', label: '广告订单', align: 'right' },
          { key: 'sales', label: '广告销售额', align: 'right' },
          { key: 'acos', label: 'ACoS(%)', align: 'right' },
          { key: 'units', label: '销量', align: 'right' },
        ],
        rows,
      },
    ],
  }
}

test('buildDailyComparisonBlock：一行一天、每个 ASIN 一组指标（本品与竞品逐日并排）', () => {
  const block = buildDailyComparisonBlock({
    asins: ['B0PRIMARY1', 'B0COMPETI1'],
    payloads: [
      payloadWithDaily([
        { date: '2026-08-01', spend: 128.61, sales: 383.75, acos: 33.51, orders: 9, impressions: 17199, clicks: 98, units: 10 },
        { date: '2026-08-02', spend: 129.43, sales: 396.99, acos: 32.6, orders: 9, impressions: 17772, clicks: 100, units: 9 },
      ]),
      payloadWithDaily([
        { date: '2026-08-01', spend: 96.2, sales: 210.5, acos: 45.7, orders: 5, impressions: 9000, clicks: 60, units: 6 },
        { date: '2026-08-02', spend: 88.1, sales: 205.0, acos: 42.98, orders: 6, impressions: 8800, clicks: 58, units: 7 },
      ]),
    ],
  })

  assert.equal(block.title, '按日对比（本品 vs 竞品）')
  assert.equal(block.dataset, 'amazon_ads_daily')
  assert.equal(block.rows.length, 2)
  // 列：日期 + 每个 ASIN 一组 7 个指标（列名只写字段名，归属交给分组表头）
  assert.equal(block.columns.length, 1 + 2 * 7)
  assert.equal(block.columns[0].key, 'date')
  assert.equal(block.columns[1].label, '花费')
  assert.equal(block.columns[8].label, '花费')
  // 分组表头：第一行是「本品（ASIN）| 竞品1（ASIN）」，span 之和 = 列数 - 1
  assert.deepEqual(block.groups, [
    { label: '本品（B0PRIMARY1）', span: 7, tone: 1 },
    { label: '竞品1（B0COMPETI1）', span: 7, tone: 2 },
  ])
  // 整组列同一档底色：本品 7 列都是 1、竞品 7 列都是 2
  assert.ok(block.columns.slice(1, 8).every((column) => column.tone === 1))
  assert.ok(block.columns.slice(8).every((column) => column.tone === 2))
  assert.equal(
    block.groups.reduce((sum, group) => sum + group.span, 0),
    block.columns.length - 1
  )
  // 同一行的本品与竞品值都在，且各自 7 个指标齐全
  const day1 = block.rows[0]
  assert.equal(day1.date, '2026-08-01')
  assert.equal(day1['B0PRIMARY1__spend'], 128.61)
  assert.equal(day1['B0COMPETI1__spend'], 96.2)
  assert.equal(day1['B0COMPETI1__acos'], 45.7)
})

test('buildDailyComparisonBlock：日期取并集，缺数据的那天为 null（不折算 0）', () => {
  const block = buildDailyComparisonBlock({
    asins: ['B0PRIMARY1', 'B0COMPETI1'],
    payloads: [
      payloadWithDaily([
        { date: '2026-08-01', spend: 10 },
        { date: '2026-08-02', spend: 11 },
      ]),
      // 竞品只有 08-02 一天有记录
      payloadWithDaily([{ date: '2026-08-02', spend: 20 }]),
    ],
  })

  assert.deepEqual(
    block.rows.map((row) => row.date),
    ['2026-08-01', '2026-08-02']
  )
  assert.equal(block.rows[0]['B0COMPETI1__spend'], null)
  assert.equal(block.rows[1]['B0COMPETI1__spend'], 20)
})

test('buildDailyComparisonBlock：没有按日数据的 ASIN 不占列（列头不会出现空 ASIN）', () => {
  const block = buildDailyComparisonBlock({
    asins: ['B0PRIMARY1', 'B0NODATA001'],
    payloads: [payloadWithDaily([{ date: '2026-08-01', spend: 10 }]), { empty: true, blocks: [] }],
  })
  assert.equal(block.columns.length, 1 + 7)
  assert.deepEqual(block.groups, [
    { label: '本品（B0PRIMARY1）', span: 7, tone: 1 },
  ])
})

test('buildDailyComparisonBlock：全都没有按日数据时返回 null（不产出空卡片）', () => {
  assert.equal(
    buildDailyComparisonBlock({ asins: ['B0PRIMARY1'], payloads: [{ blocks: [] }] }),
    null
  )
  assert.equal(buildDailyComparisonBlock(), null)
})

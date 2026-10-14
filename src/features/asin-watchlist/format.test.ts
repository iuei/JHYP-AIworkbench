/**
 * 「我的 ASIN」列表纯函数单测（合并行 / 筛选 / 排序 / 导出 / 格式化）。
 *
 * 这些逻辑决定了"用户看到的行"，而它们最容易出的错都是**静默**的：
 * 无指标被当成 0、按 ASIN 而不是 (ASIN, 站点) 连接、空值排在最前面。
 * 用固定输入直接钉住这些语义，比在页面上点一遍更可靠。
 */
import { describe, expect, it } from 'vitest'
import {
  ACOS_ALERT_THRESHOLD,
  addOutcomeSentence,
  coverageTone,
  errorMessage,
  filterMyAsinRows,
  formatMoney,
  formatNumber,
  formatPercent,
  joinMyAsinRows,
  myAsinRowsToCsv,
  sortMyAsinRows,
  toDateInputValue,
} from './format'
import type { MyAsinItem, MyAsinMetricRow, MyAsinTableRow } from './types'

function item(overrides: Partial<MyAsinItem> = {}): MyAsinItem {
  return {
    id: 1,
    asin: 'B0AAAAAAAA',
    marketplace: 'US',
    alias: null,
    note: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function metric(overrides: Partial<MyAsinMetricRow> = {}): MyAsinMetricRow {
  return {
    asin: 'B0AAAAAAAA',
    marketplace: 'US',
    coverage: '广告+销售',
    risk: '正常',
    severity: null,
    spend: 100,
    adSales: 400,
    acos: 25,
    acosDelta: null,
    orders: 5,
    cvr: null,
    ctr: null,
    units: 3,
    businessSales: 900,
    signals: '',
    ...overrides,
  }
}

describe('joinMyAsinRows', () => {
  it('按 (ASIN, 站点) 连接，同一 ASIN 的两个站点各取自己的指标', () => {
    const items = [
      item({ id: 1, asin: 'B0AAAAAAAA', marketplace: 'US' }),
      item({ id: 2, asin: 'B0AAAAAAAA', marketplace: 'DE' }),
    ]
    const rows = joinMyAsinRows(items, [
      metric({ asin: 'B0AAAAAAAA', marketplace: 'US', spend: 100 }),
      metric({ asin: 'B0AAAAAAAA', marketplace: 'DE', spend: 50 }),
    ])

    expect(rows.map((row) => row.metrics?.spend)).toEqual([100, 50])
  })

  it('指标里没有的组合得到 null（不是 0）', () => {
    const rows = joinMyAsinRows([item()], [metric({ asin: 'B0ZZZZZZZZ' })])
    expect(rows[0].metrics).toBeNull()
  })

  it('指标还没回来时全部为 null', () => {
    const rows = joinMyAsinRows([item(), item({ id: 2 })], undefined)
    expect(rows.every((row) => row.metrics === null)).toBe(true)
  })
})

describe('filterMyAsinRows', () => {
  const rows: MyAsinTableRow[] = [
    {
      ...item({ asin: 'B0AAAAAAAA', marketplace: 'US', alias: '主力款' }),
      metrics: null,
    },
    {
      ...item({
        id: 2,
        asin: 'B0BBBBBBBB',
        marketplace: 'DE',
        note: '德国站新品',
      }),
      metrics: null,
    },
  ]

  it('关键词匹配 ASIN / 别名 / 备注，且大小写不敏感', () => {
    expect(filterMyAsinRows(rows, 'b0aaaa').length).toBe(1)
    expect(filterMyAsinRows(rows, '主力').length).toBe(1)
    expect(filterMyAsinRows(rows, '德国').length).toBe(1)
    expect(filterMyAsinRows(rows, '不存在').length).toBe(0)
  })

  it('站点筛选只留该站点的行', () => {
    expect(filterMyAsinRows(rows, '', 'DE').map((row) => row.asin)).toEqual([
      'B0BBBBBBBB',
    ])
    expect(filterMyAsinRows(rows, '', 'all').length).toBe(2)
  })

  it('关键词与站点筛选同时生效', () => {
    expect(filterMyAsinRows(rows, '主力', 'DE').length).toBe(0)
  })
})

describe('sortMyAsinRows', () => {
  const withMetrics = (
    asin: string,
    spend: number | null,
    alias: string | null = null
  ): MyAsinTableRow => ({
    ...item({ asin, alias }),
    metrics: spend === null ? null : metric({ asin, spend }),
  })

  it('按指标升/降序，且无指标的行永远排在最后', () => {
    const rows = [
      withMetrics('B0CCCCCCCC', null),
      withMetrics('B0AAAAAAAA', 300),
      withMetrics('B0BBBBBBBB', 100),
    ]

    expect(sortMyAsinRows(rows, 'spend', 'asc').map((row) => row.asin)).toEqual(
      ['B0BBBBBBBB', 'B0AAAAAAAA', 'B0CCCCCCCC']
    )
    expect(
      sortMyAsinRows(rows, 'spend', 'desc').map((row) => row.asin)
    ).toEqual(['B0AAAAAAAA', 'B0BBBBBBBB', 'B0CCCCCCCC'])
  })

  it('空别名恒排最后（无论升降序）', () => {
    const rows = [
      withMetrics('B0AAAAAAAA', 1, null),
      withMetrics('B0BBBBBBBB', 1, '主力款'),
    ]
    expect(sortMyAsinRows(rows, 'alias', 'asc')[0].asin).toBe('B0BBBBBBBB')
    expect(sortMyAsinRows(rows, 'alias', 'desc')[0].asin).toBe('B0BBBBBBBB')
  })

  it('可以按站点排序', () => {
    const rows: MyAsinTableRow[] = [
      { ...item({ asin: 'B0AAAAAAAA', marketplace: 'US' }), metrics: null },
      {
        ...item({ id: 2, asin: 'B0BBBBBBBB', marketplace: 'DE' }),
        metrics: null,
      },
    ]
    expect(
      sortMyAsinRows(rows, 'marketplace', 'asc').map((row) => row.marketplace)
    ).toEqual(['DE', 'US'])
  })
})

describe('格式化：null 与 0 必须长得不一样', () => {
  it('金额 / 计数 / 百分数', () => {
    expect(formatMoney(null)).toBe('—')
    expect(formatMoney(0)).toBe('0.00')
    expect(formatNumber(null)).toBe('—')
    expect(formatNumber(0)).toBe('0')
    expect(formatPercent(null)).toBe('—')
    expect(formatPercent(0)).toBe('0%')
  })

  it('覆盖情况的色阶：无数据是异常态，仅广告/仅销售是警告', () => {
    expect(coverageTone('无数据')).toBe('empty')
    expect(coverageTone(undefined)).toBe('empty')
    expect(coverageTone('仅广告')).toBe('warning')
    expect(coverageTone('广告+销售')).toBe('normal')
  })

  it('预警线是 35%', () => {
    expect(ACOS_ALERT_THRESHOLD).toBe(35)
  })
})

describe('myAsinRowsToCsv', () => {
  it('跟随当前行导出，空指标导出空单元格并带站点列', () => {
    const rows: MyAsinTableRow[] = [
      { ...item({ alias: '含,逗号' }), metrics: metric({ spend: 100 }) },
      {
        ...item({ id: 2, asin: 'B0BBBBBBBB', marketplace: 'DE' }),
        metrics: null,
      },
    ]
    const csv = myAsinRowsToCsv(rows)
    const lines = csv
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n')

    expect(lines[0]).toContain('站点')
    expect(lines[0]).toContain('ACoS(%)')
    expect(lines[1]).toContain('"含,逗号"')
    expect(lines[1]).toContain('100')
    // 无指标 → 空单元格，而不是 0
    expect(lines[2]).toContain('DE')
    expect(lines[2]).toContain('无数据')
  })
})

describe('addOutcomeSentence', () => {
  it('四类结果分别报告', () => {
    const sentence = addOutcomeSentence({
      added: [{ asin: 'B0AAAAAAAA', marketplace: 'US' }],
      duplicated: ['B0BBBBBBBB'],
      repeated: ['B0CCCCCCCC'],
      invalid: ['夏季款水杯'],
    })
    expect(sentence).toContain('新增 1 条')
    expect(sentence).toContain('列表已有 1 条')
    expect(sentence).toContain('输入内重复 1 条')
    expect(sentence).toContain('夏季款水杯')
  })

  it('没有任何新增时也如实说明', () => {
    expect(
      addOutcomeSentence({
        added: [],
        duplicated: ['B0AAAAAAAA'],
        repeated: [],
        invalid: [],
      })
    ).toContain('没有新增')
  })
})

describe('toDateInputValue', () => {
  it('用本地年月日拼接，不会因时区前移一天', () => {
    // 东八区的 2026-06-01 00:00 若走 toISOString 会变成 2026-05-31T16:00Z
    expect(toDateInputValue(new Date(2026, 5, 1))).toBe('2026-06-01')
    expect(toDateInputValue(undefined)).toBeNull()
  })
})

describe('errorMessage', () => {
  it('优先展示服务端中文原因，缺失时用兜底文案', () => {
    expect(
      errorMessage(
        {
          response: {
            data: { message: '这个 ASIN 在目标站点已经有一条记录了。' },
          },
        },
        '失败'
      )
    ).toContain('已经有一条记录')
    expect(errorMessage(new Error('网络错误'), '保存失败')).toBe('保存失败')
  })
})

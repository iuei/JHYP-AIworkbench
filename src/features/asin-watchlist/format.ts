import { TABLE_EMPTY_VALUE, type SortDirection } from '@/lib/table-styles'
import type {
  ImportOutcome,
  Marketplace,
  MyAsinItem,
  MyAsinMetricRow,
  MyAsinTableRow,
} from './types'

/** 站点下拉选项（表单与筛选共用；清单必须明确站点，服务端据此取数）。 */
export const MARKETPLACE_OPTIONS = [
  { label: '美国 US', value: 'US' },
  { label: '英国 UK', value: 'UK' },
  { label: '德国 DE', value: 'DE' },
  { label: '法国 FR', value: 'FR' },
  { label: '意大利 IT', value: 'IT' },
  { label: '西班牙 ES', value: 'ES' },
  { label: '日本 JP', value: 'JP' },
  { label: '加拿大 CA', value: 'CA' },
  { label: '墨西哥 MX', value: 'MX' },
  { label: '澳大利亚 AU', value: 'AU' },
] satisfies { label: string; value: Marketplace }[]

/**
 * 统计区间预设（与服务端 MIN/MAX_WINDOW_DAYS 一致：7–180 天）。
 *
 * `'custom'` 不是天数，是"改用自定义起止日期"这一档 —— 表格必须把它与数字档位分开，
 * 否则用户切到自定义后会被当成"30 天"。
 */
export const WINDOW_OPTIONS = [
  { label: '近 7 天', value: '7' },
  { label: '近 30 天', value: '30' },
  { label: '近 90 天', value: '90' },
  { label: '自定义', value: 'custom' },
]

/**
 * ACoS 预警线（与服务端 `analytics.mjs` 的判定口径一致：> 35%）。
 *
 * 前端**只用它标色**，不拿它下结论 —— 判定等级仍以服务端返回的 `risk` 为准。
 */
export const ACOS_ALERT_THRESHOLD = 35

/** 时间戳（ISO 字符串）→ 本地时区可读时间。 */
export function formatDateTime(value?: string | null): string {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知'
  return date.toLocaleString('zh-CN', { hour12: false })
}

/* ───────────────────────────── 指标格式化 ───────────────────────────── */

/*
 * 三个格式化函数共享一条口径：**`null` 与 `0` 必须长得不一样**。
 *
 * `null` 表示"这条数据不存在"（该 ASIN 在这个区间没有广告记录 / 没有销售记录），
 * `0` 表示"确实发生了 0"。把它们都渲染成 `0` 或都渲染成 `—`，都会让运营得出
 * 相反的动作结论（"这款没出单要停掉" vs "报表还没覆盖，先别动"）。
 */

/** 金额。不带货币符号：站点决定币种，而币种映射不在本模块的职责里（表头已说明）。 */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return TABLE_EMPTY_VALUE
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** 计数（广告订单 / 销量）。 */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return TABLE_EMPTY_VALUE
  return value.toLocaleString('zh-CN')
}

/** 百分数：服务端给的已经是百分值（35.2 表示 35.2%），这里只补符号。 */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return TABLE_EMPTY_VALUE
  return `${value}%`
}

/**
 * 覆盖情况的展示映射。
 *
 * 「无数据」必须是显眼的异常态，而不是一个灰色的普通取值：它意味着这个 ASIN
 * 在所选区间与站点 **完全没有报表记录**（站点选错、报表没导、或商品确实没动），
 * 和"销量为 0"是两回事。
 */
export function coverageTone(
  coverage: string | null | undefined
): 'empty' | 'warning' | 'normal' {
  if (!coverage || coverage === '无数据') return 'empty'
  if (coverage === '仅广告' || coverage === '仅销售') return 'warning'
  return 'normal'
}

/**
 * 统一提取服务端返回的中文原因（axios 错误体里的 `message`）。
 *
 * 服务端已经把可操作的原因写清楚了（"这个 ASIN 在目标站点已经有一条记录了"
 * "一次最多导入 5000 个 ASIN"），前端要原样展示，而不是统一吞成"操作失败"。
 */
export function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: string } } })
    ?.response?.data?.message
  return typeof message === 'string' && message ? message : fallback
}

/** 新增结果 → 一句话提示（四类分别报告，用户要做的动作不同）。 */
export function addOutcomeSentence(outcome: {
  added: Array<unknown>
  duplicated: string[]
  repeated: string[]
  invalid: string[]
}): string {
  const parts: string[] = []
  parts.push(outcome.added.length ? `新增 ${outcome.added.length} 条` : '没有新增')
  if (outcome.duplicated.length)
    parts.push(`列表已有 ${outcome.duplicated.length} 条`)
  if (outcome.repeated.length)
    parts.push(`输入内重复 ${outcome.repeated.length} 条`)
  if (outcome.invalid.length) {
    parts.push(
      `无法识别 ${outcome.invalid.length} 段：${outcome.invalid.slice(0, 3).join('、')}`
    )
  }
  return parts.join('，')
}

/** 供调用方直接按 `ImportOutcome` 使用（避免每处都写结构化类型）。 */
export function importOutcomeSentence(outcome: ImportOutcome): string {
  return addOutcomeSentence(outcome)
}

/**
 * 表格 → CSV 文本。
 *
 * 为什么不复用服务端的 `toCsv`：数据已经在浏览器里（分页展示用的就是这批），
 * 为了导出一份完整清单再往返一次接口，多出来的失败点（超时、大响应）比省下的几行代码贵。
 * 表头用中文列名、带 BOM —— 与数据源导出保持同一口径，Excel 直接双击打开不乱码。
 */
export function tableBlockToCsv(
  columns: Array<{ key: string; label: string }>,
  rows: Array<Record<string, unknown>>
): string {
  const escape = (value: unknown) => {
    if (value === null || value === undefined) return ''
    const text =
      typeof value === 'object' ? JSON.stringify(value) : String(value)
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [
    columns.map((column) => escape(column.label)).join(','),
    ...rows.map((row) =>
      columns.map((column) => escape(row[column.key])).join(',')
    ),
  ]
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

/** 触发浏览器下载（Blob URL 用完即释放，避免长会话里堆积）。 */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * DatePicker 的 Date → `YYYY-MM-DD`。
 *
 * 刻意用本地年月日拼接，而不是 `toISOString()`：后者按时区整体前移一天（东八区必现），
 * 会让"开始日期"比用户选的早一天，进而静默丢掉区间第一天的数据。
 */
export function toDateInputValue(date: Date | undefined): string | null {
  if (!date) return null
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 复制文本到剪贴板，返回是否成功。
 *
 * 为什么不用 `navigator.clipboard` 一条路：它只在安全上下文（https / localhost）可用，
 * 而本项目明确支持局域网 IP 访问（`http://192.168.x.x:5173`）—— 那种环境下
 * `navigator.clipboard` 是 `undefined`，直接调用会抛错。降级到 `execCommand('copy')`
 * 覆盖老浏览器与非安全上下文，两条都失败时由调用方如实提示"请手动复制"。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 落到下面的降级路径：权限被拒或非安全上下文时都会走到这里
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

/* ──────────────────────── 数据表：合并 / 筛选 / 排序 / 导出 ──────────────────────── */

/** 行内可以排序的键：身份列 + 全部数值指标列。 */
export type ItemSortKey =
  | 'createdAt'
  | 'asin'
  | 'marketplace'
  | 'alias'
  | 'spend'
  | 'adSales'
  | 'orders'
  | 'acos'
  | 'units'
  | 'businessSales'

/** 数值指标列的键（用于把 `metrics` 上的字段取出来比较）。 */
const METRIC_SORT_KEYS = [
  'spend',
  'adSales',
  'orders',
  'acos',
  'units',
  'businessSales',
] as const satisfies readonly ItemSortKey[]

/**
 * 排序方向的类型定义在 `@/lib/table-styles`（全站共享），这里只做转发，
 * 避免同一概念在两处各定义一份、各自漂移。
 */
export type { SortDirection }

/**
 * 条目 + 指标行 → 表格行（纯函数）。
 *
 * 连接键是 **`(ASIN, 站点)`**：服务端保证 ASIN 已大写，站点也已归一化；
 * 只按 ASIN 连接会把同一款商品在两个站点的两行混成一行（数字取错站点）。
 * 指标行里没有的组合得到 `metrics: null` —— 界面显示「—」，**不显示 0**。
 */
export function joinMyAsinRows(
  items: MyAsinItem[],
  metricsRows: MyAsinMetricRow[] | undefined
): MyAsinTableRow[] {
  if (!metricsRows || metricsRows.length === 0) {
    return items.map((item) => ({ ...item, metrics: null }))
  }
  const byKey = new Map(
    metricsRows.map((row) => [`${row.asin}::${row.marketplace}`, row])
  )
  return items.map((item) => ({
    ...item,
    metrics: byKey.get(`${item.asin}::${item.marketplace}`) ?? null,
  }))
}

/**
 * 关键词（ASIN / 别名 / 备注）+ 站点筛选。
 *
 * 站点筛选不是可选项：一个账号可以同时有多个站点的商品，而不同站点的数字不能比较，
 * 想"只看德国站"时必须有办法把其它站点收起来。
 */
export function filterMyAsinRows(
  rows: MyAsinTableRow[],
  keyword: string,
  marketplace: string = 'all'
): MyAsinTableRow[] {
  const text = keyword.trim().toUpperCase()
  return rows.filter((row) => {
    if (marketplace !== 'all' && row.marketplace !== marketplace) return false
    if (!text) return true
    return (
      row.asin.includes(text) ||
      (row.alias ?? '').toUpperCase().includes(text) ||
      (row.note ?? '').toUpperCase().includes(text)
    )
  })
}

function metricValue(row: MyAsinTableRow, key: ItemSortKey): number | null {
  const metrics = row.metrics
  if (!metrics) return null
  if (!(METRIC_SORT_KEYS as readonly string[]).includes(key)) return null
  const value = metrics[key as (typeof METRIC_SORT_KEYS)[number]]
  return typeof value === 'number' ? value : null
}

/**
 * 排序。默认按加入时间倒序（新加的排在最前）。
 *
 * 两类"空值"一律排在最后（无论升降序），这是刻意的：
 * ① 空别名 —— 几千条里"没写别名的"是待办项，混在中间等于让人一页页翻着找；
 * ② 无指标（`null`）—— 它们代表"该区间没有记录"，与 0 不同，排在最前面
 *    （花费升序时的第一屏）会被误读成"这些花得最少，可以不管"。
 */
export function sortMyAsinRows(
  rows: MyAsinTableRow[],
  key: ItemSortKey,
  direction: SortDirection
): MyAsinTableRow[] {
  const factor = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (key === 'alias') {
      const left = a.alias?.trim() ?? ''
      const right = b.alias?.trim() ?? ''
      if (!left && !right) return 0
      if (!left) return 1
      if (!right) return -1
      return left.localeCompare(right, 'zh-CN') * factor
    }
    if (key === 'asin') return a.asin.localeCompare(b.asin) * factor
    if (key === 'marketplace') {
      return a.marketplace.localeCompare(b.marketplace) * factor
    }
    if (key === 'createdAt') {
      // ISO 字符串按字典序即时间序，但服务端格式若变化就会失效，用 Date.parse 更稳
      const left = Date.parse(a.createdAt)
      const right = Date.parse(b.createdAt)
      if (Number.isNaN(left) || Number.isNaN(right)) {
        return a.createdAt.localeCompare(b.createdAt) * factor
      }
      return (left - right) * factor
    }

    const left = metricValue(a, key)
    const right = metricValue(b, key)
    if (left === null && right === null) return 0
    if (left === null) return 1
    if (right === null) return -1
    return (left - right) * factor
  })
}

/**
 * 数据表 → CSV。
 *
 * 复用 `tableBlockToCsv`（与全站导出同一份转义实现），并**跟随列表当前的筛选条件** ——
 * 导出的行必须与屏幕上看到的行一致，否则"导出来对不上"会让人怀疑数据本身。
 * 指标为 `null` 时导出空单元格（不是 0），与界面上的「—」保持同一语义。
 */
export function myAsinRowsToCsv(rows: MyAsinTableRow[]): string {
  return tableBlockToCsv(
    [
      { key: 'asin', label: 'ASIN' },
      { key: 'marketplace', label: '站点' },
      { key: 'alias', label: '别名' },
      { key: 'note', label: '备注' },
      { key: 'coverage', label: '数据覆盖' },
      { key: 'spend', label: '花费' },
      { key: 'adSales', label: '广告销售额' },
      { key: 'orders', label: '广告订单' },
      { key: 'acos', label: 'ACoS(%)' },
      { key: 'units', label: '销量' },
      { key: 'businessSales', label: '销售额' },
      { key: 'createdAt', label: '加入时间' },
    ],
    rows.map((row) => ({
      asin: row.asin,
      marketplace: row.marketplace,
      alias: row.alias ?? '',
      note: row.note ?? '',
      coverage: row.metrics?.coverage ?? '无数据',
      spend: row.metrics?.spend ?? '',
      adSales: row.metrics?.adSales ?? '',
      orders: row.metrics?.orders ?? '',
      acos: row.metrics?.acos ?? '',
      units: row.metrics?.units ?? '',
      businessSales: row.metrics?.businessSales ?? '',
      createdAt: formatDateTime(row.createdAt),
    }))
  )
}

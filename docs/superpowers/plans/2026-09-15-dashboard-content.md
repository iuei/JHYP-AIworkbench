# 仪表盘内容扩容实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已有但未上首页的真实数据接上首页——新增主操作条、需处理的分析分区，升级最近分析字段与两处深链，全程不改服务端。

**Architecture:** 首页新增一次 `fetchAnalysisHistory(20)` 查询（query key `['dashboard','recent-analyses']`），其结果同时驱动「需处理的分析」与「最近分析」两块卡片；筛选与时间格式化抽成 `analyses.ts` 纯函数先测后用。深链通过两个路由各自的可选 search 参数实现（`/competitor-analysis?analysisId=&focus=`、`/ai-agent?conversationId=&focus=`），参数解析函数放在 feature 侧以便单测，路由文件只做装配。

**Tech Stack:** Vite + React 19 + TypeScript、TanStack Router（`validateSearch` / `useSearch`）、TanStack Query v5、shadcn/ui（Button/Card/Badge/Skeleton）、vitest browser 模式（`vitest-browser-react`）。

**Spec:** `docs/superpowers/specs/2026-09-15-dashboard-content-design.md`（执行前请连同本计划一起阅读）

## Global Constraints

- **服务端零改动**：不改 `server/**`，不新增接口。所用接口均为员工可读的既有接口。
- **新查询 query key 必须是 `['dashboard', 'recent-analyses']`**。绝不可复用 `['competitor-analyses']`——竞品分析页同 key 的 `queryFn` 是 `fetchAnalysisHistory(10)`，React Query 同 key 共享缓存会让两个页面互相覆盖条数。
- **`src/features/dashboard/index.tsx` 的排序保存失效范围改为 `{ queryKey: ['dashboard'], exact: true }`**，避免每次拖动入口连带重刷首页全部查询。
- **时间显示一律按浏览器本地时区计算，禁止 `toISOString().slice(0,10)` 这类 UTC 切片**（东八区会整体早一天）。
- **「需处理的分析」的筛选范围必须对用户可见**：卡片描述写「来自最近 20 次分析」；空态分两种——有记录但范围内无 `high`：`最近 20 次分析里没有需要立即处理的问题`；一条记录都没有：`还没有分析记录，从上面的「新建分析」开始`。
- **首页不得出现 AI 治理面词汇**（知识库、数据源、经验审核、模型配置、审计台）——`src/features/dashboard/index.test.tsx` 有守护断言。
- 不引入 `console`（ESLint 报错）；颜色只用主题 token；装饰性图标一律 `aria-hidden='true'`，图标按钮必须有 `aria-label`。
- 组件复用顺序：`Main` / shadcn `Button`(`asChild` 已支持) `Card` `Badge` `Skeleton` / `lucide-react`。`Button` 与 `Link` 组合用 `<Button asChild><Link …/></Button>`。
- **测试里 `@tanstack/react-router` 的 `Link` mock 必须支持 `search` prop**（现有 mock 丢弃 `search`，不改造就断言不出深链参数），拼成 `to + '?' + new URLSearchParams(search)`。
- 验证命令：`pnpm run lint`、`pnpm run build`；测试优先 `pnpm run test`，若报 `Executable doesn't exist … chrome-headless-shell`，改用系统 Chrome 的替代跑法（临时 vitest 配置把 provider 换成 `playwright({ launchOptions: { channel: 'chrome' } })`，配置放工作区根目录，跑完删除，见 `docs/用户信息只读化-交接文档.md` 的「环境备忘」）。
- `src/features/auth/auth-layout.test.tsx` 有 **2 项预先存在的失败**，与本次改动无关，不计入本次回归判定。
- **提交需用户确认**（`AGENTS.md`）：每个任务末尾的 commit 步骤统一在用户确认后执行；禁止 `push`、禁止 `--force`。提交信息中文，格式 `类型: 描述`。

## File Structure

| 文件 | 职责 |
| --- | --- |
| `src/features/dashboard/analyses.ts`（新建） | 纯函数：筛 `high`、截断条数、本地时区相对时间 |
| `src/features/dashboard/action-bar.tsx`（新建） | 主操作条，纯展示，无数据依赖 |
| `src/features/dashboard/analyses-cards.tsx`（新建） | `AttentionCard`（需处理）+ `RecentAnalysesCard`（最近分析） |
| `src/features/dashboard/index.tsx`（改） | 查询编排 + 布局；删除 `RecentActivityCard`；修正失效范围 |
| `src/features/dashboard/types.ts`（改） | 删除 `DashboardAnalysis`（不再被消费） |
| `src/features/dashboard/my-ai-card.tsx`（改） | 对话链接带 `conversationId` |
| `src/features/competitor-analysis/search-params.ts`（新建） | `analysisId` / `focus` 参数解析（可单测） |
| `src/routes/_authenticated/competitor-analysis.tsx`（改） | 挂 `validateSearch` |
| `src/features/competitor-analysis/index.tsx`（改） | 首屏按 `analysisId` 打开快照；`focus=asin` 聚焦 |
| `src/features/competitor-analysis/components/analysis-form.tsx`（改） | 新增 `autoFocusAsin` prop + textarea ref |
| `src/features/ai-agent/search-params.ts`（新建） | `conversationId` / `focus` 参数解析（可单测） |
| `src/routes/_authenticated/ai-agent/index.tsx`（改） | 挂 `validateSearch` |
| `src/features/ai-agent/pages/chat-workbench.tsx`（改） | 按 `conversationId` 初始化会话；`focus=composer` 聚焦输入框 |

---

### Task 1: 分析数据纯函数（筛选、截断、本地时区时间）

**Files:**
- Create: `src/features/dashboard/analyses.ts`
- Test: `src/features/dashboard/analyses.test.ts`

**Interfaces:**
- Consumes: `HistoryItem` 类型，来自 `@/features/competitor-analysis/types`（字段：`id`、`inputType`、`inputValue`、`asins`、`marketplace`、`headline`、`level: 'high'|'medium'|'low'|'info'|null`、`findingCount`、`createdAt: string|null`）。
- Produces（后续任务依赖，签名必须一致）：
  - `ATTENTION_SCAN_LIMIT = 20`、`ATTENTION_DISPLAY_LIMIT = 3`、`RECENT_DISPLAY_LIMIT = 5`
  - `pickAttentionAnalyses(items: HistoryItem[]): HistoryItem[]`
  - `takeRecentAnalyses(items: HistoryItem[]): HistoryItem[]`
  - `formatRelativeTime(value: string | null | undefined, now?: Date): string`

- [ ] **Step 1: 写失败测试** `src/features/dashboard/analyses.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import {
  ATTENTION_DISPLAY_LIMIT,
  RECENT_DISPLAY_LIMIT,
  formatRelativeTime,
  pickAttentionAnalyses,
  takeRecentAnalyses,
} from './analyses'
import type { HistoryItem } from '@/features/competitor-analysis/types'

function item(overrides: Partial<HistoryItem>): HistoryItem {
  return {
    id: 1,
    inputType: 'ASIN',
    inputValue: 'B0C1D2E3F4',
    asins: ['B0C1D2E3F4'],
    marketplace: 'US',
    startDate: null,
    endDate: null,
    windowDays: 30,
    compareWith: 'previous_period',
    headline: null,
    level: null,
    findingCount: 0,
    hasSnapshot: true,
    createdAt: '2026-09-15T02:00:00.000Z',
    ...overrides,
  }
}

describe('pickAttentionAnalyses', () => {
  it('只保留 level 为 high 的记录，并保持输入顺序', () => {
    const items = [
      item({ id: 1, level: 'medium' }),
      item({ id: 2, level: 'high' }),
      item({ id: 3, level: null }),
      item({ id: 4, level: 'high' }),
    ]

    expect(pickAttentionAnalyses(items).map((row) => row.id)).toEqual([2, 4])
  })

  it(`最多返回 ${3} 条`, () => {
    const items = Array.from({ length: 6 }, (_, index) =>
      item({ id: index + 1, level: 'high' })
    )

    expect(pickAttentionAnalyses(items)).toHaveLength(ATTENTION_DISPLAY_LIMIT)
  })

  it('没有 high 时返回空数组', () => {
    expect(pickAttentionAnalyses([item({ level: 'low' })])).toEqual([])
  })
})

describe('takeRecentAnalyses', () => {
  it(`最多返回 ${5} 条且顺序不变`, () => {
    const items = Array.from({ length: 8 }, (_, index) => item({ id: index + 1 }))

    expect(takeRecentAnalyses(items).map((row) => row.id)).toEqual([1, 2, 3, 4, 5])
    expect(takeRecentAnalyses(items)).toHaveLength(RECENT_DISPLAY_LIMIT)
  })
})

describe('formatRelativeTime', () => {
  const now = new Date(2026, 8, 15, 10, 0, 0) // 本地 2026-09-15 10:00

  it('1 分钟内显示「刚刚」', () => {
    expect(formatRelativeTime(new Date(2026, 8, 15, 9, 59, 30).toISOString(), now)).toBe('刚刚')
  })

  it('1 小时内显示分钟', () => {
    expect(formatRelativeTime(new Date(2026, 8, 15, 9, 20).toISOString(), now)).toBe('40 分钟前')
  })

  it('24 小时内显示小时', () => {
    expect(formatRelativeTime(new Date(2026, 8, 15, 3, 0).toISOString(), now)).toBe('7 小时前')
  })

  it('7 天内显示天数', () => {
    expect(formatRelativeTime(new Date(2026, 8, 12, 10, 0).toISOString(), now)).toBe('3 天前')
  })

  it('超过 7 天按本地日期显示，不使用 UTC 切片', () => {
    // 本地时间 2026-09-01 23:30：UTC 切片在负时区会给出 09-02，本地日期才是唯一正确答案
    const created = new Date(2026, 8, 1, 23, 30)

    expect(formatRelativeTime(created.toISOString(), now)).toBe('2026-09-01')
  })

  it('未来时间按本地日期显示，不出现负数', () => {
    const future = new Date(2026, 8, 20, 10, 0)

    expect(formatRelativeTime(future.toISOString(), now)).toBe('2026-09-20')
  })

  it('空值与不可解析值都显示「未知」', () => {
    expect(formatRelativeTime(null, now)).toBe('未知')
    expect(formatRelativeTime(undefined, now)).toBe('未知')
    expect(formatRelativeTime('not-a-date', now)).toBe('未知')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/features/dashboard/analyses.test.ts --browser.headless`
Expected: FAIL —— 无法解析 `./analyses`（模块不存在）

- [ ] **Step 3: 实现** `src/features/dashboard/analyses.ts`

```ts
import type { HistoryItem } from '@/features/competitor-analysis/types'

/** 首页一次拉取的分析条数：既要支撑「最近分析」展示，也要作为「需处理」的扫描范围。 */
export const ATTENTION_SCAN_LIMIT = 20
/** 「需处理的分析」最多展示条数。 */
export const ATTENTION_DISPLAY_LIMIT = 3
/** 「最近分析」最多展示条数。 */
export const RECENT_DISPLAY_LIMIT = 5

/**
 * 需要立即处理的记录（服务端 `level` 分级里 `high` 的文案是「需立即处理」）。
 *
 * 只说"这批记录里没有"，不讲"全库没有"：调用方必须在卡片上写明扫描范围，
 * 否则用户会把「最近 20 次里没有」读成「全部历史都没有」。
 */
export function pickAttentionAnalyses(items: HistoryItem[]): HistoryItem[] {
  return items
    .filter((item) => item.level === 'high')
    .slice(0, ATTENTION_DISPLAY_LIMIT)
}

export function takeRecentAnalyses(items: HistoryItem[]): HistoryItem[] {
  return items.slice(0, RECENT_DISPLAY_LIMIT)
}

/**
 * 相对时间（本地时区）。
 *
 * 刻意不用 `toISOString().slice(0, 10)`：那是 UTC 日期，东八区凌晨会整体早一天
 * （`src/features/ai-agent/format.ts` 的 `formatDate` 就是这个问题，属该模块独立改动）。
 */
export function formatRelativeTime(
  value: string | null | undefined,
  now: Date = new Date()
): string {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知'

  const diff = now.getTime() - date.getTime()
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < 0) return formatLocalDate(date)
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  return formatLocalDate(date)
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/features/dashboard/analyses.test.ts --browser.headless`
Expected: PASS（11 项）

- [ ] **Step 5: 提交**（需用户确认后执行）

```bash
git add src/features/dashboard/analyses.ts src/features/dashboard/analyses.test.ts
git commit -m "feat: 首页分析数据纯函数（筛选、截断、本地时区时间）"
```

---

### Task 2: 主操作条

**Files:**
- Create: `src/features/dashboard/action-bar.tsx`
- Test: `src/features/dashboard/action-bar.test.tsx`

**Interfaces:**
- Consumes: `Button`（`src/components/ui/button.tsx`，已支持 `asChild`）、`Link`（`@tanstack/react-router`）。
- Produces: `ActionBar({ lastAnalysisId }: { lastAnalysisId: number | null })`——`null` 表示没有可继续的分析。

- [ ] **Step 1: 写失败测试** `src/features/dashboard/action-bar.test.tsx`

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { ActionBar } from './action-bar'

/** 真实 Link 用 `search` 生成查询串，测试里必须等效拼出来，否则断言不出深链参数。 */
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    ...props
  }: React.PropsWithChildren<{ to: string; search?: Record<string, unknown> }>) => {
    const query = search ? `?${new URLSearchParams(
      Object.entries(search).map(([key, value]) => [key, String(value)])
    ).toString()}` : ''
    return (
      <a href={`${to}${query}`} {...props}>
        {children}
      </a>
    )
  },
}))

function hrefs() {
  return Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'))
}

describe('ActionBar', () => {
  it('有历史记录时提供「继续上次分析」，并指向那条记录', async () => {
    await render(<ActionBar lastAnalysisId={7} />)

    expect(hrefs()).toContain('/competitor-analysis?analysisId=7')
  })

  it('没有历史记录时不渲染「继续上次分析」', async () => {
    await render(<ActionBar lastAnalysisId={null} />)

    expect(document.body.textContent).not.toContain('继续上次分析')
    expect(hrefs().some((href) => href?.includes('analysisId'))).toBe(false)
  })

  it('「新建分析」聚焦 ASIN 输入框、「问 AI」聚焦输入框', async () => {
    await render(<ActionBar lastAnalysisId={null} />)

    expect(hrefs()).toContain('/competitor-analysis?focus=asin')
    expect(hrefs()).toContain('/ai-agent?focus=composer')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/features/dashboard/action-bar.test.tsx --browser.headless`
Expected: FAIL —— 无法解析 `./action-bar`

- [ ] **Step 3: 实现** `src/features/dashboard/action-bar.tsx`

```tsx
import { Link } from '@tanstack/react-router'
import { History, Plus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

type ActionBarProps = {
  /** 最近一条分析记录的 id；为空表示没有可继续的记录，此时不渲染「继续上次分析」。 */
  lastAnalysisId: number | null
}

/**
 * 首页主操作条。
 *
 * 三个动作都必须比常用入口卡「少一步」才有存在价值，因此都带上下文：
 * 继续上次分析直接打开快照；另两个在目标页聚焦对应输入框。
 *
 * 刻意不做「分析我的 ASIN」：ASIN 清单页本来就默认选中第一个清单
 * （`src/features/asin-watchlist/index.tsx` 的 `selectedId ?? list[0]?.id`），
 * 纯跳转与常用入口卡重复，属于看起来有用的假动作。
 */
export function ActionBar({ lastAnalysisId }: ActionBarProps) {
  return (
    <section aria-labelledby='action-bar-heading' className='mb-6'>
      <h2 id='action-bar-heading' className='sr-only'>
        开始工作
      </h2>
      <div className='flex flex-wrap gap-2'>
        {lastAnalysisId !== null && (
          <Button asChild>
            <Link
              to='/competitor-analysis'
              search={{ analysisId: lastAnalysisId }}
            >
              <History aria-hidden='true' />
              继续上次分析
            </Link>
          </Button>
        )}
        <Button asChild variant={lastAnalysisId === null ? 'default' : 'outline'}>
          <Link to='/competitor-analysis' search={{ focus: 'asin' }}>
            <Plus aria-hidden='true' />
            新建分析
          </Link>
        </Button>
        <Button asChild variant='outline'>
          <Link to='/ai-agent' search={{ focus: 'composer' }}>
            <Sparkles aria-hidden='true' />
            问 AI
          </Link>
        </Button>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/features/dashboard/action-bar.test.tsx --browser.headless`
Expected: PASS（3 项）

- [ ] **Step 5: 提交**（需用户确认后执行）

```bash
git add src/features/dashboard/action-bar.tsx src/features/dashboard/action-bar.test.tsx
git commit -m "feat: 首页主操作条（继续上次分析/新建分析/问 AI）"
```

---

### Task 3: 需处理的分析 + 最近分析（含首页编排）

**Files:**
- Create: `src/features/dashboard/analyses-cards.tsx`
- Modify: `src/features/dashboard/index.tsx`（查询、布局、删除 `RecentActivityCard`、失效范围）
- Modify: `src/features/dashboard/types.ts`（删除 `DashboardAnalysis`）
- Test: `src/features/dashboard/index.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `analyses.ts` 全部导出；`fetchAnalysisHistory(limit?: number): Promise<HistoryItem[]>`（`@/features/competitor-analysis/api`）；`FINDING_LEVEL_LABELS` / `FINDING_LEVEL_VARIANTS`（`@/features/competitor-analysis/format`）。
- Produces：
  - `AttentionCard({ items, hasRecords, isLoading, isError, onRetry, className })`
  - `RecentAnalysesCard({ items, isLoading, isError, onRetry, className })`
  - 两处链接：`/competitor-analysis?analysisId=<id>`

  > 执行时的修正（见文末「执行偏差记录」）：`AttentionCard` 比原计划多一个 `hasRecords`。
  > 没有它就无法区分「扫描范围内没有 high」与「一条记录都没有」这两种空态——这是规格里的硬要求。

- [ ] **Step 1: 更新测试桩并写失败断言** `src/features/dashboard/index.test.tsx`

把 `Link` mock 换成支持 `search`（关键，否则深链断言写不出来）：

```tsx
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    ...props
  }: React.PropsWithChildren<{ to: string; search?: Record<string, unknown> }>) => {
    const query = search
      ? `?${new URLSearchParams(
          Object.entries(search).map(([key, value]) => [key, String(value)])
        ).toString()}`
      : ''
    return (
      <a href={`${to}${query}`} {...props}>
        {children}
      </a>
    )
  },
}))
```

在 `mockDashboardApi` 里补一条分支（首页现在共打 5 个请求）：

```tsx
const analysisHistory = [
  {
    id: 31,
    inputType: 'ASIN',
    inputValue: 'B0BBB222',
    asins: ['B0BBB222'],
    marketplace: 'US',
    startDate: null,
    endDate: null,
    windowDays: 30,
    compareWith: 'previous_period',
    headline: 'ACoS 环比上升 12%，需立即处理',
    level: 'high' as const,
    findingCount: 3,
    hasSnapshot: true,
    createdAt: '2026-09-14T02:00:00.000Z',
  },
  {
    id: 32,
    inputType: 'ASIN',
    inputValue: 'B0CCC333',
    asins: ['B0CCC333'],
    marketplace: 'US',
    startDate: null,
    endDate: null,
    windowDays: 30,
    compareWith: 'previous_period',
    headline: '库存偏低，需关注',
    level: 'medium' as const,
    findingCount: 1,
    hasSnapshot: true,
    createdAt: '2026-09-13T02:00:00.000Z',
  },
]

function mockDashboardApi(url: string) {
  if (url === '/dashboard') return Promise.resolve({ data: dashboardData })
  if (url.startsWith('/competitor-analyses')) {
    return Promise.resolve({ data: { items: analysisHistory } })
  }
  // …其余分支保持原样（/ai/conversations、/ai/notes）
}
```

新增用例：

```tsx
it('需处理只取 level 为 high 的记录，并链接到那条快照', async () => {
  mocks.get.mockImplementation(mockDashboardApi)
  await renderDashboard()

  await expect.element(page.getByText('需立即处理').first()).toBeVisible()
  expect(document.body.textContent).not.toContain('库存偏低，需关注')
  expect(
    Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'))
  ).toContain('/competitor-analysis?analysisId=31')
})

it('有分析但没有需立即处理的结论时，空态写明扫描范围', async () => {
  mocks.get.mockImplementation((url: string) =>
    url.startsWith('/competitor-analyses')
      ? Promise.resolve({ data: { items: [analysisHistory[1]] } })
      : mockDashboardApi(url)
  )
  await renderDashboard()

  await expect
    .element(page.getByText('最近 20 次分析里没有需要立即处理的问题'))
    .toBeVisible()
})

it('一条分析记录都没有时给出引导，且不提供「继续上次分析」', async () => {
  mocks.get.mockImplementation((url: string) =>
    url.startsWith('/competitor-analyses')
      ? Promise.resolve({ data: { items: [] } })
      : mockDashboardApi(url)
  )
  await renderDashboard()

  await expect
    .element(page.getByText('还没有分析记录，从上面的「新建分析」开始'))
    .toBeVisible()
  expect(document.body.textContent).not.toContain('继续上次分析')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/features/dashboard/index.test.tsx --browser.headless`
Expected: FAIL —— 文案与链接都不存在

- [ ] **Step 3: 实现卡片** `src/features/dashboard/analyses-cards.tsx`

```tsx
import { Link } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  FINDING_LEVEL_LABELS,
  FINDING_LEVEL_VARIANTS,
} from '@/features/competitor-analysis/format'
import type { HistoryItem } from '@/features/competitor-analysis/types'
import { ATTENTION_SCAN_LIMIT, formatRelativeTime } from './analyses'

type AnalysisCardProps = {
  items: HistoryItem[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
  className?: string
}

/** 需立即处理的分析。空态分两种：范围内没有 high ≠ 全库没有。 */
export function AttentionCard({
  items,
  isLoading,
  isError,
  onRetry,
  className,
}: AnalysisCardProps) {
  return (
    <Card className={className}>
      <CardHeader className='gap-1'>
        <CardTitle className='flex items-center gap-2 text-base'>
          <AlertTriangle aria-hidden='true' className='size-4 text-destructive' />
          需处理的分析
        </CardTitle>
        <CardDescription>
          来自最近 {ATTENTION_SCAN_LIMIT} 次分析中结论为「需立即处理」的记录。
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-2'>
        {isError ? (
          <AnalysisError onRetry={onRetry} />
        ) : isLoading ? (
          <Skeleton className='h-20 rounded-lg' />
        ) : items.length > 0 ? (
          items.map((item) => (
            <Link
              key={item.id}
              to='/competitor-analysis'
              search={{ analysisId: item.id }}
              className='block rounded-lg border border-destructive/40 p-3 transition-colors hover:bg-muted/50'
            >
              <p className='flex items-center gap-2 text-sm font-medium'>
                <span className='min-w-0 flex-1 truncate'>
                  {item.headline ?? item.inputValue}
                </span>
                <Badge variant={FINDING_LEVEL_VARIANTS.high}>
                  {FINDING_LEVEL_LABELS.high}
                </Badge>
              </p>
              <p className='mt-1 text-xs text-muted-foreground'>
                {item.inputValue} · {item.findingCount} 个问题 ·{' '}
                {formatRelativeTime(item.createdAt)}
              </p>
            </Link>
          ))
        ) : (
          <p className='py-6 text-center text-sm text-muted-foreground'>
            最近 {ATTENTION_SCAN_LIMIT} 次分析里没有需要立即处理的问题
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** 最近分析：字段比改造前厚（时间、站点、结论、问题数），点击可打开那条快照。 */
export function RecentAnalysesCard({
  items,
  isLoading,
  isError,
  onRetry,
  className,
}: AnalysisCardProps) {
  return (
    <Card className={className}>
      <CardHeader className='gap-1'>
        <CardTitle className='text-base'>最近分析</CardTitle>
        <CardDescription>点击任意记录可回看当时的分析结果。</CardDescription>
      </CardHeader>
      <CardContent className='space-y-2'>
        {isError ? (
          <AnalysisError onRetry={onRetry} />
        ) : isLoading ? (
          <div className='space-y-2'>
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className='h-16 rounded-lg' />
            ))}
          </div>
        ) : items.length > 0 ? (
          items.map((item) => (
            <Link
              key={item.id}
              to='/competitor-analysis'
              search={{ analysisId: item.id }}
              className='block rounded-lg border p-3 transition-colors hover:bg-muted/50'
            >
              <p className='truncate text-sm font-medium'>
                {item.inputValue}
              </p>
              <p className='mt-1 flex items-center gap-2 text-xs text-muted-foreground'>
                <span>{item.marketplace ?? '未指定站点'}</span>
                <span>·</span>
                <span>{item.findingCount} 个问题</span>
                <span>·</span>
                <span>{formatRelativeTime(item.createdAt)}</span>
                {item.level && (
                  <Badge variant={FINDING_LEVEL_VARIANTS[item.level]}>
                    {FINDING_LEVEL_LABELS[item.level]}
                  </Badge>
                )}
              </p>
            </Link>
          ))
        ) : (
          <p className='py-8 text-center text-sm text-muted-foreground'>
            还没有分析记录，从上面的「新建分析」开始
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function AnalysisError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={cn('flex flex-col items-center gap-3 py-6 text-center')}>
      <p className='text-sm text-muted-foreground'>
        分析记录加载失败，请检查网络后重试。
      </p>
      <Button variant='outline' size='sm' onClick={onRetry}>
        重新加载
      </Button>
    </div>
  )
}
```

- [ ] **Step 4: 在 `index.tsx` 接线**

新增查询（放在 `dashboard` 查询之后）：

```tsx
const analyses = useQuery<HistoryItem[]>({
  // 不能复用竞品分析页的 ['competitor-analyses']：那边 limit 是 10，同 key 会互相覆盖条数
  queryKey: ['dashboard', 'recent-analyses'],
  queryFn: () => fetchAnalysisHistory(ATTENTION_SCAN_LIMIT),
})
```

修正失效范围（原第 46 行）：

```tsx
onSuccess: () =>
  queryClient.invalidateQueries({ queryKey: ['dashboard'], exact: true }),
```

渲染改为（替换原 `RecentActivityCard` 所在的部分）：

```tsx
<ActionBar lastAnalysisId={analyses.data?.[0]?.id ?? null} />

{/* …常用入口与 aria-live 保持不变… */}

{dashboard.isError ? (
  <DashboardRetry … />
) : (
  <div className='space-y-6'>
    <AttentionCard
      items={attentionItems}
      isLoading={analyses.isLoading}
      isError={analyses.isError}
      onRetry={() => void analyses.refetch()}
    />
    <div className='grid gap-6 xl:grid-cols-12'>
      <RecentAnalysesCard
        className='min-w-0 xl:col-span-7'
        items={recentItems}
        isLoading={analyses.isLoading}
        isError={analyses.isError}
        onRetry={() => void analyses.refetch()}
      />
      <MyAiCard className='min-w-0 xl:col-span-5' />
    </div>
  </div>
)}
```

其中 `const attentionItems = pickAttentionAnalyses(analyses.data ?? [])`、`const recentItems = takeRecentAnalyses(analyses.data ?? [])`；删除 `RecentActivityCard`、`ListSkeleton` 与 `DashboardAnalysis` 的 import。`types.ts` 删除 `DashboardAnalysis`，`DashboardData` 只留 `shortcutIds`。

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm exec vitest run src/features/dashboard/index.test.tsx --browser.headless`
Expected: PASS（原有用例 + 3 项新用例）。注意横向溢出断言必须仍然通过。

- [ ] **Step 6: 静态检查**

Run: `pnpm run lint && pnpm run build`
Expected: 均通过（`analyses` 查询与 `HistoryItem` 类型无未使用变量）

- [ ] **Step 7: 提交**（需用户确认后执行）

```bash
git add src/features/dashboard/
git commit -m "feat: 首页新增需处理的分析分区并升级最近分析字段"
```

---

### Task 4: 竞品分析深链（`analysisId` 与 `focus=asin`）

**Files:**
- Create: `src/features/competitor-analysis/search-params.ts`
- Create: `src/features/competitor-analysis/search-params.test.ts`
- Modify: `src/routes/_authenticated/competitor-analysis.tsx`
- Modify: `src/features/competitor-analysis/index.tsx`
- Modify: `src/features/competitor-analysis/components/analysis-form.tsx`

**Interfaces:**
- Produces：
  - `type CompetitorAnalysisSearch = { analysisId?: number; focus?: 'asin' }`
  - `parseCompetitorAnalysisSearch(search: Record<string, unknown>): CompetitorAnalysisSearch`
  - `AnalysisForm({ pending, onSubmit, autoFocusAsin }: AnalysisFormProps)`
- Consumes：已有 `snapshot` mutation（`index.tsx:70-85`，按 id 拉快照并处理无快照 toast）。

- [ ] **Step 1: 写失败测试** `src/features/competitor-analysis/search-params.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { parseCompetitorAnalysisSearch } from './search-params'

describe('parseCompetitorAnalysisSearch', () => {
  it('解析正整数 analysisId 与 focus=asin', () => {
    expect(parseCompetitorAnalysisSearch({ analysisId: '7', focus: 'asin' })).toEqual({
      analysisId: 7,
      focus: 'asin',
    })
  })

  it('容忍 router 解析出的数字类型', () => {
    expect(parseCompetitorAnalysisSearch({ analysisId: 7 })).toEqual({ analysisId: 7 })
  })

  it('非法 analysisId 一律忽略，不抛错', () => {
    for (const value of ['abc', '-1', '0', '1.5', '', null, undefined, {}, []]) {
      expect(parseCompetitorAnalysisSearch({ analysisId: value })).toEqual({})
    }
  })

  it('非枚举 focus 忽略', () => {
    expect(parseCompetitorAnalysisSearch({ focus: 'composer' })).toEqual({})
    expect(parseCompetitorAnalysisSearch({ focus: 'asin' })).toEqual({ focus: 'asin' })
  })

  it('空 search 返回空对象', () => {
    expect(parseCompetitorAnalysisSearch({})).toEqual({})
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/features/competitor-analysis/search-params.test.ts --browser.headless`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现** `src/features/competitor-analysis/search-params.ts`

```ts
/**
 * 竞品分析的 URL 参数解析。
 *
 * 放在 feature 侧而不是路由文件里：路由文件只做装配，纯函数才好单测。
 * 所有脏值（手改 URL、负数、小数、非枚举 focus）一律忽略并回落默认行为，不抛错、不白屏。
 */
export type CompetitorAnalysisSearch = {
  analysisId?: number
  focus?: 'asin'
}

export function parseCompetitorAnalysisSearch(
  search: Record<string, unknown>
): CompetitorAnalysisSearch {
  const result: CompetitorAnalysisSearch = {}

  const id = toPositiveInt(search.analysisId)
  if (id !== null) result.analysisId = id
  if (search.focus === 'asin') result.focus = 'asin'

  return result
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm exec vitest run src/features/competitor-analysis/search-params.test.ts --browser.headless`
Expected: PASS（5 项）

- [ ] **Step 5: 挂到路由** `src/routes/_authenticated/competitor-analysis.tsx`

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { CompetitorAnalysis } from '@/features/competitor-analysis'
import { parseCompetitorAnalysisSearch } from '@/features/competitor-analysis/search-params'

export const Route = createFileRoute('/_authenticated/competitor-analysis')({
  staticData: { title: '竞品分析' },
  // 首页深链靠这两个可选参数：analysisId 打开那条快照，focus=asin 聚焦输入框；
  // 脏值由解析器忽略，旧链接（无参数）行为完全不变
  validateSearch: parseCompetitorAnalysisSearch,
  component: CompetitorAnalysis,
})
```

- [ ] **Step 6: 页面消费参数** `src/features/competitor-analysis/index.tsx`

```tsx
import { useEffect, useRef, useState } from 'react'
import { useSearch } from '@tanstack/react-router'
// …

const search = useSearch({ from: '/_authenticated/competitor-analysis' })
const handledAnalysisIdRef = useRef<number | null>(null)

useEffect(() => {
  const id = search.analysisId
  if (id === undefined || handledAnalysisIdRef.current === id) return
  handledAnalysisIdRef.current = id
  snapshot.mutate(id)
}, [search.analysisId, snapshot])
```

因为 `snapshot` 是 mutation 对象、引用会变，effect 可能重跑，但 `handledAnalysisIdRef` 保证同一 id 只请求一次（同时挡住 StrictMode 双调用）。表单加聚焦：

```tsx
<AnalysisForm
  pending={analysis.isPending}
  onSubmit={handleSubmit}
  autoFocusAsin={search.focus === 'asin'}
/>
```

- [ ] **Step 7: 表单支持聚焦** `src/features/competitor-analysis/components/analysis-form.tsx`

```tsx
import { useEffect, useRef, useState } from 'react'

type AnalysisFormProps = {
  pending: boolean
  onSubmit: (values: AnalysisFormValues) => void
  /** 从首页「新建分析」进来时为 true：进场即聚焦 ASIN 输入框。 */
  autoFocusAsin?: boolean
}

export function AnalysisForm({ pending, onSubmit, autoFocusAsin = false }: AnalysisFormProps) {
  const asinRef = useRef<HTMLTextAreaElement>(null)
  // …
  useEffect(() => {
    if (autoFocusAsin) asinRef.current?.focus()
  }, [autoFocusAsin])
  // …
  <Textarea
    id='competitor-asin'
    ref={asinRef}
    value={asin}
    // …其余 props 不变
  />
```

- [ ] **Step 8: 验证**

Run: `pnpm exec vitest run src/features/competitor-analysis/ --browser.headless && pnpm run lint`
Expected: PASS + 无 lint 报错（重点看 `react-hooks/exhaustive-deps`）

- [ ] **Step 9: 提交**（需用户确认后执行）

```bash
git add src/features/competitor-analysis/ src/routes/_authenticated/competitor-analysis.tsx
git commit -m "feat: 竞品分析支持 analysisId 深链与 focus=asin 聚焦"
```

---

### Task 5: AI 助手深链（`conversationId` 与 `focus=composer`）

**Files:**
- Create: `src/features/ai-agent/search-params.ts`
- Create: `src/features/ai-agent/search-params.test.ts`
- Modify: `src/routes/_authenticated/ai-agent/index.tsx`
- Modify: `src/features/ai-agent/pages/chat-workbench.tsx`

**Interfaces:**
- Produces：
  - `type AiAgentSearch = { conversationId?: number; focus?: 'composer' }`
  - `parseAiAgentSearch(search: Record<string, unknown>): AiAgentSearch`
- Consumes：`chat-workbench.tsx` 现有 `activeId`（`:88`）、`conversationIdRef`（`:107`）、`promptTextareaRef`（`:109`）；`activeId` 变化会自动驱动 `['ai','messages',conversationId]` 查询。

- [ ] **Step 1: 写失败测试** `src/features/ai-agent/search-params.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { parseAiAgentSearch } from './search-params'

describe('parseAiAgentSearch', () => {
  it('解析正整数 conversationId 与 focus=composer', () => {
    expect(
      parseAiAgentSearch({ conversationId: '11', focus: 'composer' })
    ).toEqual({ conversationId: 11, focus: 'composer' })
  })

  it('非法 conversationId 忽略，不抛错', () => {
    for (const value of ['abc', '0', '-3', '2.5', null, undefined, {}, []]) {
      expect(parseAiAgentSearch({ conversationId: value })).toEqual({})
    }
  })

  it('非枚举 focus 忽略', () => {
    expect(parseAiAgentSearch({ focus: 'asin' })).toEqual({})
    expect(parseAiAgentSearch({ focus: 'composer' })).toEqual({ focus: 'composer' })
  })

  it('空 search 返回空对象', () => {
    expect(parseAiAgentSearch({})).toEqual({})
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/features/ai-agent/search-params.test.ts --browser.headless`
Expected: FAIL —— 模块不存在

- [ ] **Step 3: 实现** `src/features/ai-agent/search-params.ts`

```ts
/**
 * AI 助手的 URL 参数解析（首页深链用）。
 *
 * `conversationId` 让「最近对话」直接打开那个会话，`focus=composer` 让「问 AI」进场即聚焦输入框。
 * 脏值一律忽略并回落默认行为：落不到具体会话时就是普通的新对话入口，不报错。
 */
export type AiAgentSearch = {
  conversationId?: number
  focus?: 'composer'
}

export function parseAiAgentSearch(
  search: Record<string, unknown>
): AiAgentSearch {
  const result: AiAgentSearch = {}

  const id = toPositiveInt(search.conversationId)
  if (id !== null) result.conversationId = id
  if (search.focus === 'composer') result.focus = 'composer'

  return result
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm exec vitest run src/features/ai-agent/search-params.test.ts --browser.headless`
Expected: PASS（4 项）

- [ ] **Step 5: 挂到路由** `src/routes/_authenticated/ai-agent/index.tsx`

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { ChatWorkbench } from '@/features/ai-agent/pages/chat-workbench'
import { parseAiAgentSearch } from '@/features/ai-agent/search-params'

export const Route = createFileRoute('/_authenticated/ai-agent/')({
  staticData: { wide: true },
  // 只作用于 /ai-agent 本身，不影响 notes / asin-watchlists 等子路由
  validateSearch: parseAiAgentSearch,
  component: ChatWorkbench,
})
```

- [ ] **Step 6: 工作台消费参数** `src/features/ai-agent/pages/chat-workbench.tsx`

```tsx
import { useSearch } from '@tanstack/react-router'

const search = useSearch({ from: '/_authenticated/ai-agent/' })

// 首页深链：带着会话进来时直接选中它，语义与 onSelect 一致（选中 + 清空流式状态）
const [activeId, setActiveId] = useState<number | null>(search.conversationId ?? null)
const conversationIdRef = useRef<number | null>(search.conversationId ?? null)

useEffect(() => {
  if (search.focus !== 'composer') return
  promptTextareaRef.current?.focus()
}, [search.focus])
```

- [ ] **Step 7: 手动验证聚焦与深链**

启动 `pnpm run dev` 后在浏览器验证（该行为不适合自动化，ChatWorkbench 依赖流式与面板宽度，自动化成本远高于收益）：
1. 打开 `/ai-agent?focus=composer` → 输入框获得焦点，可直接输入。
2. 打开 `/ai-agent?conversationId=<真实会话 id>` → 左栏对应会话高亮、中栏显示该会话消息。
3. 打开 `/ai-agent?conversationId=abc`、`?conversationId=-1` → 与 `/ai-agent` 表现一致，无报错、无白屏。
4. 无 console error。

- [ ] **Step 8: 验证**

Run: `pnpm exec vitest run src/features/ai-agent/ --browser.headless && pnpm run lint`
Expected: PASS（既有用例无回归）+ lint 通过

- [ ] **Step 9: 提交**（需用户确认后执行）

```bash
git add src/features/ai-agent/ src/routes/_authenticated/ai-agent/index.tsx
git commit -m "feat: AI 助手支持 conversationId 深链与 focus=composer 聚焦"
```

---

### Task 6: 最近对话链接、责任田文档与全量验证

**Files:**
- Modify: `src/features/dashboard/my-ai-card.tsx`
- Modify: `docs/modules/仪表盘.md`、`docs/modules/竞品分析.md`、`docs/modules/AI 助手.md`
- Test: `src/features/dashboard/index.test.tsx`

**Interfaces:**
- Consumes: Task 3 改造后的 `Link` mock（支持 `search`）。

- [ ] **Step 1: 写失败断言**（`index.test.tsx` 追加）

```tsx
it('最近对话可直接继续该会话', async () => {
  mocks.get.mockImplementation(mockDashboardApi)
  await renderDashboard()

  await expect
    .element(page.getByText('上个月广告 ACoS 为什么变高'))
    .toBeVisible()
  expect(
    Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'))
  ).toContain('/ai-agent?conversationId=11')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/features/dashboard/index.test.tsx --browser.headless`
Expected: FAIL —— 链接仍是 `/ai-agent`（无参数）

- [ ] **Step 3: 改链接** `src/features/dashboard/my-ai-card.tsx`

```tsx
<Link
  to='/ai-agent'
  search={{ conversationId: item.id }}
  className='flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50'
>
```

（`最近对话` 区块头部「打开 AI 助手」的链接保持不带参数，它是去新对话。）

- [ ] **Step 4: 运行确认通过**

Run: `pnpm exec vitest run src/features/dashboard/index.test.tsx --browser.headless`
Expected: PASS

- [ ] **Step 5: 更新责任田文档**

`docs/modules/仪表盘.md`：
- 功能清单：补主操作条（三个动作及其增量、为何不做「分析我的 ASIN」）、需处理的分析（扫描范围 20、展示上限 3、两种空态）、最近分析（富字段与深链）。
- API 明细：补 `GET /api/competitor-analyses?limit=20`；注明 `/api/dashboard` 的 `analyses` 首页不再消费（服务端保留）。
- 依赖关系：新增跨模块依赖 `competitor-analysis/api`、`competitor-analysis/format`。
- 注意事项：query key 不得复用 `['competitor-analyses']`；时间必须按本地时区；失效范围 `exact: true`。
- 历史变更：追加一行（2026-09-15 内容扩容）。
- 第 11 行「四个有真实路由的入口」改为三项（实际已收敛，文档未同步）。

`docs/modules/竞品分析.md`：补 `?analysisId=` 与 `?focus=asin` 两个可选参数及其容错口径。
`docs/modules/AI 助手.md`：补 `/ai-agent?conversationId=&focus=composer`。

- [ ] **Step 6: 全量验证**

```bash
pnpm run lint
pnpm run build
pnpm run test          # 若缺 Chromium 用系统 Chrome 临时配置跑
pnpm run test:server   # 服务端未改动，确认无回归
```

Expected：lint / build 通过；测试通过（仅 `src/features/auth/auth-layout.test.tsx` 的 2 项预先存在失败不计入）；`test:server` 283 项通过。

- [ ] **Step 7: 手动验收（桌面 + 窄屏）**

`pnpm run dev` 后确认：
1. 首屏顺序为 主操作条 → 常用入口 → 需处理的分析 → 最近分析 + 我的 AI。
2. 待处理卡片点击进入 `/competitor-analysis?analysisId=<id>` 并展示那条快照。
3. 窄屏（<640px）无横向滚动、无文本遮挡；常用入口仍可排序，排序保存后不再连带刷新分析卡片。
4. 桌面端最近分析与我的 AI 仍为 7:5 分栏。

- [ ] **Step 8: 提交**（需用户确认后执行）

```bash
git add src/features/dashboard/my-ai-card.tsx src/features/dashboard/index.test.tsx docs/modules/
git commit -m "docs: 同步仪表盘内容扩容的责任田与深链说明"
```

---

## 自审记录

- **规格覆盖**：首页结构（Task 3）、主操作条（Task 2）、数据契约与 query key（Task 3）、需处理口径与两种空态（Task 1 + Task 3）、不再消费的 `analyses`（Task 3）、失效范围修正（Task 3）、`analysisId` 深链（Task 4）、`conversationId` + 两个 focus（Task 4、Task 5）、最近对话链接（Task 6）、测试与文档（各任务 + Task 6）。规格的「不做」清单在实现中无对应改动，符合预期。
- **类型一致性**：`HistoryItem`（既有类型）在 Task 1/2/3 中的字段名与 `types.ts:151-166` 一致；`FINDING_LEVEL_VARIANTS` 的键 `high/medium/low/info` 与 `FindingLevel` 一致；`pickAttentionAnalyses` / `takeRecentAnalyses` / `formatRelativeTime` / `parseCompetitorAnalysisSearch` / `parseAiAgentSearch` 的签名在定义任务与消费任务中完全一致。
- **占位符扫描**：无 TBD / TODO / 「同 Task N」省略写法；每个改动步骤都带具体代码或具体命令。

## 执行偏差记录（2026-09-15 实施）

| 偏差 | 原因与处理 |
| --- | --- |
| `AttentionCard` 增加 `hasRecords` prop | 原计划的 props 无法区分两种空态（范围内没有 high / 一条记录都没有），规格要求区分，故补该参数 |
| 「最近对话深链」未新增独立用例，改为把既有窄屏用例的 href 断言从 `/ai-agent` 改成 `/ai-agent?conversationId=21` | 两条用例走的是同一条代码路径，新增等于重复；既有用例同时覆盖了窄屏不溢出 |
| `?? 全部任务的 commit 步骤未执行` | 用户明确要求就地实现且不做任何 commit（工作区有 185 个未提交改动，其中包含本次要改的 `chat-workbench.tsx` 与三份责任田文档） |
| 竞品分析的 effect 依赖从 `snapshot` 改为解构出的 `loadSnapshot` | `@tanstack/query/no-unstable-deps` 拒绝把 useMutation 返回值整个放进依赖数组（lint 报错），改用稳定的 `mutate` 引用 |
| 测试命令用 `--config vitest.chrome.config.ts` | 本机缺 Playwright Chromium（`pnpm run test` 直接失败），仓库自带系统 Chrome 的替代配置 |

**执行中新发现的两个测试陷阱**（已写进测试注释，避免后人重踩）：

1. 断言渲染就绪时不能用「需立即处理」这类文本：它在卡片描述里也存在，会匹配到未完成加载的卡片。要用 `vi.waitFor + hrefs()` 等真实内容出现。
2. React Query v5 不接受 `undefined` 作为查询数据：mock 里 `GET /competitor-analyses` 若只返回 `{ rows, total }`（缺 `items`），查询会进入 **error** 态，测出来的是"加载失败"而不是"空数据"。空数据必须返回 `{ items: [] }`。

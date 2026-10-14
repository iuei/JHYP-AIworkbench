/**
 * 表格列语义约定（全站唯一一份）。
 *
 * 为什么要有这个文件：审计 15 个表格实例时发现同类列各有各的写法 ——
 * 数字列只有一处完整正确（`text-right tabular-nums`），其余要么左对齐，要么反向过头
 * 给所有列无条件加 `tabular-nums`；次要信息有 `text-sm muted` 与 `text-xs muted` 两套；
 * 搜索框一个用逻辑类（`start-*` / `ps-*`）另一个用物理类（`left-*` / `pl-*`，RTL 下错位）。
 *
 * 这里只放**字符串常量**，不放组件：导出常量与组件混在一个文件里会让 fast refresh 失效
 * （见 `table-pagination.tsx` 里同款说明）。列与行的渲染仍由各页面自己写 ——
 * 表格之间的行结构差异（多选、双行单元格、徽标、行内操作）不值得再用一层抽象抹平。
 */

/** 数字列表头：右对齐，与下方单元格对齐 */
export const TABLE_HEAD_NUMERIC = 'text-right'

/** 数字列单元格：右对齐 + 等宽数字（金额、数量、耗时、切片数） */
export const TABLE_CELL_NUMERIC = 'text-right tabular-nums'

/** 等宽标识列（ASIN / ID / 工具名 / campaign）：避免形近字符误读 */
export const TABLE_CELL_MONO = 'font-mono text-xs'

/** 次要信息列（时间、来源、账号、备注）：统一降一级，不要再用 text-sm */
export const TABLE_CELL_META = 'text-xs text-muted-foreground'

/**
 * 长文本列：截断 + 必须配 `title` 兜底。
 * 不用 `break-words` 换行 —— 那会把行高撑成多行，表格纵向密度失控。
 */
export const TABLE_CELL_TRUNCATE = 'max-w-64 truncate'

/** 操作列表头 / 单元格：统一右对齐，与行尾按钮的位置一致 */
export const TABLE_HEAD_ACTIONS = 'text-right'
export const TABLE_CELL_ACTIONS = 'text-right whitespace-nowrap'

/** 空值占位：统一用短横线，不要写"未设置""尚未登录"之类的整句 */
export const TABLE_EMPTY_VALUE = '—'

/** 工具区里的搜索框：图标 + 逻辑内边距（RTL 安全，不要用 left-3/pl-9） */
export const TABLE_SEARCH_ICON =
  'pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground'
export const TABLE_SEARCH_INPUT = 'ps-8'

/* ─────────────────────────── 行密度与排序（2026-09-16 起为全站共享） ─────────────────────────── */

/**
 * 表格行密度。
 *
 * 两档而不是自由缩放：密度是二元偏好，给滑杆只会让人反复调。
 * 「紧凑」用于"一屏尽量多"的场景（ASIN 清单上限 5000 条、提示词广场列表）。
 */
export type TableDensity = 'comfortable' | 'compact'

/**
 * 密度 → 单元格/表头的覆盖类。
 *
 * 用任意变体（`[&_td]:py-1`）而不是让每个调用方自己拼 `TableCell className`：
 * 任意变体编译出的选择器特异性 (0,1,1) 高于基线 `.p-2` (0,1,0)，**必然覆盖**；
 * 而逐格传 `py-1` 与基线的 `p-2` 同特异性，只靠样式表顺序决定胜负 —— 那是脆的。
 * 调用方只需给 `DataTable` 传 `density`，不必逐个单元格改类名。
 */
export const TABLE_DENSITY_CLASS: Record<TableDensity, string | undefined> = {
  comfortable: undefined,
  compact: '[&_td]:py-1 [&_th]:h-9',
}

/** 排序方向：升序 / 降序。与 `SortableHead` 及各页的排序状态共用一份定义。 */
export type SortDirection = 'asc' | 'desc'

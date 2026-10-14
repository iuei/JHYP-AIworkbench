import * as React from 'react'
import { TABLE_DENSITY_CLASS, type TableDensity } from '@/lib/table-styles'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TablePagination } from '@/components/table-pagination'

export type DataTablePagination = {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  /** 传了才渲染「每页条数」选择器 */
  onPageSizeChange?: (pageSize: number) => void
  /** 加载中禁用翻页（连点会产生交错请求，最后到哪一页取决于响应顺序） */
  disabled?: boolean
  /** 透传给分页器的「跳至第 N 页」输入（长列表用，默认关闭） */
  jumpTo?: boolean
}

export type DataTableProps = {
  /** 列数：空态行与骨架行跨列用，必须与 header 的列数一致 */
  columns: number
  /** 表头内容：一个 TableRow（列顺序、列宽与对齐由各页自己写） */
  header: React.ReactNode
  /** 数据行。只在「非加载中且非空且非错误」时渲染 */
  children: React.ReactNode
  isEmpty: boolean
  isLoading?: boolean
  isError?: boolean
  errorText?: string
  /** 空态文案。有无筛选条件应由调用方给不同文案，不要把两种情况混成一句 */
  emptyText: string
  /** 骨架行数，默认 4 */
  skeletonRows?: number
  /** 工具区（搜索 / 筛选 / 批量操作）。统一放在表格上方、外框之外 */
  toolbar?: React.ReactNode
  pagination?: DataTablePagination
  /** 外框，默认 true。已在带边框的容器里时可关掉，避免双层描边 */
  bordered?: boolean
  /** 表头吸顶：需配合 maxHeightClass 使用 */
  stickyHeader?: boolean
  /** 内部滚动区高度类，如 `max-h-[55vh]`（弹窗内长表用） */
  maxHeightClass?: string
  /**
   * 行密度：`compact` 收紧单元格纵向内边距与表头高度（长列表用）。
   * 覆盖类由 `TABLE_DENSITY_CLASS` 统一给 —— 调用方不必逐个单元格改 `className`。
   */
  density?: TableDensity
  className?: string
}

/**
 * 全站统一的表格外壳。
 *
 * 它只接管"每张表都该长一样"的部分：外框、工具区位置、加载态、空态、错误态、分页器。
 * **列与行的渲染仍由各页自己写** —— 各表的行结构差异很大（多选、双行单元格、徽标、
 * 行内操作、可排序表头），再抽一层列配置只会把复杂度搬个地方，不会减少。
 *
 * 三条硬约定（都是审计出的真实缺陷）：
 * 1. **加载态与空态互斥**：`isLoading` 优先。审计发现 3 处表格同时渲染骨架和
 *    "没有匹配的记录"，用户看到的是一句自相矛盾的提示。
 * 2. **空态居中且统一高度**：此前有"表内一行无样式""表内 h-28 居中""表外 dashed 块"
 *    "表外无样式排在表格下方"四种写法，同一系统里四种空表长相。
 * 3. **分页器与表格同一个容器**：间距由外层的 `space-y-3` 统一给，调用方不再各写
 *    `mt-3`（此前有写有没写，同一个组件在不同页面上间距不同）。
 *
 * 外框默认开启：基线 `Table`（`components/ui/table.tsx`）自带 `overflow-x-auto`，
 * 因此宽表**不需要**再自己包一层滚动容器 —— 那层包裹此前在 5 处重复出现。
 */
export function DataTable({
  columns,
  header,
  children,
  isEmpty,
  isLoading,
  isError,
  errorText,
  emptyText,
  skeletonRows = 4,
  toolbar,
  pagination,
  bordered = true,
  stickyHeader,
  maxHeightClass,
  density = 'comfortable',
  className,
}: DataTableProps) {
  /*
   * 吸顶表头的两个必要条件（2026-09-16 修复，此前 `stickyHeader` 其实从未生效）。
   *
   * 表格默认是 `border-collapse: collapse`（Tailwind preflight），而 Chromium 在该模式下
   * **不认 thead 的 `position: sticky`** —— 实测滚动 240px 后 thead 的 top 从 256 掉到 16，
   * 也就是表头跟着滚走了（复现：`node verify-artifacts/table-ux-sticky.mjs`）。
   *
   *  ① 改成 `border-separate border-spacing-0` —— sticky 才会生效（spacing-0 保证不留列缝）；
   *  ② 行线必须从 `<tr>` 迁到单元格：separate 模式下 `<tr>` 的 border 不渲染，
   *     不迁就没有任何行线（`tbody` 最后一行的底边还要单独去掉，否则外框内侧多一条）。
   *
   * 只在 `stickyHeader` 的表上加这两个类：其余 15 处表格的 DOM 与视觉**零变化** ——
   * 修的是"要不要吸顶"，不是全站行线口径（全站口径的变更留给基座 `ui/table.tsx` 单独一轮）。
   */
  const stickyTableClass = stickyHeader
    ? 'border-separate border-spacing-0 [&_tr>*]:border-b [&_tbody_tr:last-child>*]:border-b-0'
    : undefined

  /*
   * 第三件事：让开 `Table` 自带的那层横向滚动容器。
   *
   * `ui/table.tsx` 的 `Table` 渲染为 `<div class="relative w-full overflow-x-auto"><table/></div>` ——
   * `overflow-x: auto` 会让 `overflow-y` 也计算成 `auto`（CSS 规范），于是**这一层成了最近的可滚动祖先**：
   * thead 的 `sticky` 相对它定位，而它自己不纵向滚动、只跟着外层滚走 —— 表头照样看不见。
   * 实测：只把 `collapse` 改成 `separate` 后，滚动 240px 表头 top 依旧从 256 掉到 16。
   *
   * 吸顶 + 限高同时存在时，横向滚动交给外层那个 `overflow-auto` 容器承担（它本来就能滚 x），
   * 内层 div 让开即可。两个条件缺一不可：没有 `maxHeightClass` 时外层不滚，这层必须保留 overflow-x。
   */
  const stickyScrollerClass =
    stickyHeader && maxHeightClass ? '[&>div]:overflow-visible' : undefined

  return (
    <div className={cn('space-y-3', className)}>
      {toolbar}

      <div className={cn(bordered && 'overflow-hidden rounded-lg border')}>
        {isError ? (
          <p className={cn('p-4 text-sm text-destructive', maxHeightClass)}>
            {errorText ?? '数据加载失败，请稍后重试。'}
          </p>
        ) : (
          <div
            className={cn(
              maxHeightClass,
              maxHeightClass && 'overflow-auto',
              stickyScrollerClass
            )}
          >
            <Table
              className={cn(TABLE_DENSITY_CLASS[density], stickyTableClass)}
            >
              <TableHeader
                className={
                  stickyHeader ? 'sticky top-0 z-10 bg-background' : undefined
                }
              >
                {header}
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: skeletonRows }).map((_, index) => (
                    <TableRow key={`data-table-skeleton-${index}`}>
                      <TableCell colSpan={columns}>
                        <Skeleton className='h-5 w-full' />
                      </TableCell>
                    </TableRow>
                  ))
                ) : isEmpty ? (
                  <TableRow>
                    <TableCell
                      className='h-24 text-center text-muted-foreground'
                      colSpan={Math.max(1, columns)}
                    >
                      {emptyText}
                    </TableCell>
                  </TableRow>
                ) : (
                  children
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {pagination && (
        <TablePagination
          disabled={pagination.disabled}
          jumpTo={pagination.jumpTo}
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onPageChange={pagination.onPageChange}
          onPageSizeChange={pagination.onPageSizeChange}
        />
      )}
    </div>
  )
}

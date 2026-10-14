import * as React from 'react'
import { cn } from '@/lib/utils'

function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div
      data-slot='table-container'
      className='relative w-full overflow-x-auto'
    >
      <table
        data-slot='table'
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot='table-header'
      className={cn('[&_tr]:border-b', className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot='table-body'
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot='table-footer'
      className={cn(
        'border-t bg-muted/50 font-medium [&>tr]:last:border-b-0',
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot='table-row'
      className={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        className
      )}
      {...props}
    />
  )
}

/**
 * 表头单元格：全站表格的视觉锚点。
 *
 * 为什么要这四组类（改动前这里是 `h-10 px-2 ... text-foreground`，表头与数据行同为白底、
 * 同为 14px 深色字，整张表没有任何层级，日志式台账看起来"散"）：
 * 1. `bg-muted` 实色底 —— 表头与数据区分开。用实色而不是半透明是为吸顶场景准备的：
 *    `DataTable` 的吸顶表头会随滚动压在数据行之上，半透明底色会让滚动内容透出来。
 *    （吸顶曾长期不生效，**2026-09-16 已在 `DataTable` 内局部修好**：该模式给表格加
 *    `border-separate border-spacing-0`、把行线从 `<tr>` 挪到单元格，并让开 `Table` 自带的
 *    `overflow-x-auto` 包裹层 —— 三层缺一不可，详见 `docs/modules/表格与列表规范.md` 的注意事项。
 *    本条只解释"为什么用实色底"，与吸顶是否生效无关。）
 * 2. `text-xs text-muted-foreground` —— 表头降一级：列名是坐标而不是数据，缩到 12px 灰色后
 *    数据行的 14px 深色字才成为视觉主体。注意 `text-foreground` 必须去掉，否则
 *    可排序表头里的 `<button>` 会继承深色而显得比其它列重。
 * 3. `h-9` —— 紧凑一档（36px），配合下方 `py-2.5` 的单行数据行（约 40px）形成"短表头 + 数据行"的台账比例。
 * 4. `px-3 first:ps-4 last:pe-4` —— 首末列各留 16px，列内容不再紧贴外框描边（此前统一 8px，贴边）。
 */
function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot='table-head'
      className={cn(
        'h-9 bg-muted px-3 text-start align-middle text-xs font-medium whitespace-nowrap text-muted-foreground first:ps-4 last:pe-4 *:[[role=checkbox]]:translate-y-0.5',
        className
      )}
      {...props}
    />
  )
}

/**
 * 数据单元格：`py-2.5` 让单行内容约 40px 高（原 `p-2` 为 36px 但上下留白不均），
 * 首末列内边距与表头一致，保证列首内容与列名对齐在同一条竖线上。
 */
function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot='table-cell'
      className={cn(
        'px-3 py-2.5 align-middle whitespace-nowrap first:ps-4 last:pe-4 *:[[role=checkbox]]:translate-y-0.5',
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot='table-caption'
      className={cn('mt-4 text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}

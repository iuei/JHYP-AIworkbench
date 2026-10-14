/**
 * 「我的 ASIN」导入模板（真 `.xlsx`，2026-09-18）。
 *
 * 为什么从 CSV 换成 xlsx：CSV 是纯文本，中文 Excel 双击打开时按本地代码页（GBK）解码，
 * 表头先变乱码；ASIN 这种"看着像数字"的值还会被 Excel 自作主张改成 `8.51E+09`，
 * 用户照着模板填完再导入就变成另一批商品。xlsx 自带编码声明与单元格类型，两个坑都不存在。
 *
 * 表头文字必须与导入解析器认的列名一致（`watchlist-table.mjs` 的 `detectColumnMapping`：
 * 'asin' / '站点' / '别名' / '备注'）—— 改这里的文案前先看那边，
 * 否则"按模板填的却识别不到列"会变成最难查的一类问题。
 *
 * 站点列 2026-09-18 新增（站点从清单下沉到每条 ASIN）：模板里必须带上它，
 * 否则用户按模板填完导入，整批 ASIN 会落到默认站点上，数字取的是另一个站点。
 */
import writeXlsxFile from 'write-excel-file/node'

/** 列定义即模板的对外契约：ASIN 必填，站点可留空（按导入时选的默认站点），别名与备注可空。 */
const COLUMNS = [
  { header: 'ASIN', width: 18 },
  { header: '站点', width: 10 },
  { header: '别名', width: 24 },
  { header: '备注', width: 36 },
]

/**
 * 示例行：让用户看到"填成什么样"，同时第 1 行显式写明可删 ——
 * 模板里留着示例数据被一起导进去，是这类功能最常见的脏数据来源。
 */
const SAMPLE_ROWS = [
  ['B0SAMPLE01', 'US', '主力款', '示例行，导入前请删除'],
  ['B0SAMPLE02', 'US', '', '别名与备注可以留空'],
]

const HEADER_STYLE = { fontWeight: 'bold', backgroundColor: '#F1F5F9' }

/** 生成模板的 xlsx 二进制内容（调用方负责设置响应头并下发）。 */
export async function buildWatchlistTemplateXlsx() {
  const sheetData = [
    COLUMNS.map((column) => ({ value: column.header, ...HEADER_STYLE })),
    ...SAMPLE_ROWS.map((cells) =>
      cells.map((value, index) => ({
        value,
        /*
         * ASIN 与站点都按文本写出：ASIN 不指定类型时 Excel 会把 `B0...` 这类串当数字，
         * 站点列保持文本可以让 `US` 原样保留（不会变成日期或数字）。
         */
        ...(index === 0 || index === 1 ? { type: String } : {}),
      }))
    ),
  ]

  return writeXlsxFile(sheetData, {
    sheet: '我的 ASIN',
    columns: COLUMNS.map((column) => ({ width: column.width })),
  }).toBuffer()
}

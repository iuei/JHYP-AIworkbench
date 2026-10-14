import { Main } from '@/components/layout/main'
import { ItemManager } from '../components/item-manager'

/**
 * 「我的 ASIN」唯一页面（`/asin-watchlists`）。
 *
 * 它回答的问题是"我登记的这批商品在这个区间里表现如何"：
 * 一张带业务指标的数据（花费 / 广告销售额 / 广告订单 / ACoS / 销量 / 销售额 / 数据覆盖），
 * 支持表格与卡片两种读法，加搜索、站点筛选、区间选择、就地编辑、单条添加与模板批量导入。
 *
 * 2026-09-18 起**没有清单这一层**：账号即一份列表，站点挂在每条 ASIN 上。
 * 趋势、对比与结论交给 AI 助手对话（工具 `query_my_asins` 用的是同一套服务端计算，
 * 数字不会两套口径）。
 */
export function WatchlistPage() {
  return (
    <Main className='space-y-5'>
      <ItemManager />
    </Main>
  )
}

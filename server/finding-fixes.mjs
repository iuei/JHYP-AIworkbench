/**
 * 「结论 → 待办事项」的结构化处置建议（2026-09-17）。
 *
 * 用户口径：「竞品与分析的结论与建议里面的需立即处理没有任何交互 继续处理是处理什么，如何处理
 * 去哪里处理都没有」。经选项确认两条：
 * 1. **可点入口 + 三段式处置说明** —— 系统内真实可达的入口给按钮，系统内做不到的如实标注；
 * 2. 系统外动作（Listing 优化、广告后台调价、补货）**标注「系统外」并给出具体步骤**。
 *
 * 三条纪律：
 * - **不给假链接**：`links` 里的 `to` 必须是站内真实存在的路由，且**不指向当前用户没有权限的页面**
 *   （`adminOnly` 的入口由前端按角色过滤，普通员工看不到按钮、只看到一句说明）；
 * - **诊断码而不是标题文案**：结论标题是动态拼接的（`ACoS 环比上涨 57.05%`），
 *   按标题匹配一改文案就静默失效；因此每条结论带一个稳定的 `code`，本文件按 `code` 出处置方案；
 * - **只写事实与操作**：`what` 描述处理对象（哪个 ASIN / SKU / 类目），不重复结论标题与数字
 *   （数字在 `detail` 里，且必须能被复算）。
 *
 * 纯函数、无 IO：便于单测（`finding-fixes.node-test.mjs`）。
 */

/** 站内入口常量：集中定义，避免每条结论各写一遍路径字符串（写错一处就是 404）。 */
const ROUTES = {
  competitorAnalysis: '/competitor-analysis',
  competitorResults: '/competitor-analysis/results',
  competitorAsin: '/competitor-analysis/$asin',
  watchlistItems: '/asin-watchlists/items',
  productDev: '/product-dev',
  market: '/product-dev/market',
  /** 管理员专属：数据源与导入（普通员工看不到按钮）。 */
  datasources: '/admin/ai/datasources',
}

/**
 * 各诊断码的处置方案。
 *
 * `links`：`{ label, to, params?, adminOnly? }` —— `params` 原样交给 `Link search`；
 *   需要 `analysisId` 的入口（竞品详情、结果页）**刻意不在这里给** —— 分析在当时还没落库、
 *   拿不到 id；由前端渲染时补上当前页面的 `analysisId`（见 `findings-panel.tsx`）。
 * `offSystem`：系统里做不到、必须去卖家后台/广告后台/采购买手那里做的步骤（会标「系统外」）。
 */
const FIX_BY_CODE = {
  /* ---------- 自家经营数据 ---------- */
  no_data: () => ({
    what: '这次分析的 ASIN 在所选站点与区间内没有任何广告或销售记录',
    links: [
      { label: '去数据源与导入上传报表', to: ROUTES.datasources, adminOnly: true },
      { label: '回到分析页换区间重新分析', to: ROUTES.competitorAnalysis },
    ],
    offSystem: [
      '在亚马逊广告后台确认这些 ASIN 本期是否真的有投放（未投放则本条无需处理）',
      '确认报表导出时站点与日期范围是否选对',
    ],
  }),
  metric_acos_above: (ctx) => ({
    what: `本品${ctx.asin ? ` ${ctx.asin}` : ''}的 ACoS 高于预警线`,
    links: [
      { label: '打开该 ASIN 的明细', to: ROUTES.competitorAsin, params: { asin: ctx.asin } },
      { label: '看本次横向对比', to: ROUTES.competitorResults },
    ],
    offSystem: [
      '亚马逊广告后台 → 广告活动 → 按「花费降序 + 转化率升序」逐个降竞价或暂停',
      '核对 Listing 主图、价格、评分与库存状态本期是否有变动',
    ],
  }),
  metric_cvr_below: (ctx) => ({
    what: `本品${ctx.asin ? ` ${ctx.asin}` : ''}的转化率低于预警线`,
    links: [
      { label: '打开该 ASIN 的明细', to: ROUTES.competitorAsin, params: { asin: ctx.asin } },
    ],
    offSystem: [
      '排查 Listing 转化要素：主图、价格、评分、Coupon / A+、库存状态',
      '广告后台 → 搜索词报告 → 否掉高点击零转化的词，确认是否引入了低转化流量',
    ],
  }),
  metric_ctr_below: (ctx) => ({
    what: `本品${ctx.asin ? ` ${ctx.asin}` : ''}的点击率低于预警线`,
    links: [
      { label: '打开该 ASIN 的明细', to: ROUTES.competitorAsin, params: { asin: ctx.asin } },
    ],
    offSystem: [
      '检查主图与标题的点击吸引力（缩略图对比竞品）',
      '广告后台 → 投放位与关键词相关性低的直接否掉',
    ],
  }),
  acos_up: (ctx) => ({
    what: `本品${ctx.asin ? ` ${ctx.asin}` : ''}的 ACoS 相比上一等长区间明显上涨`,
    links: [
      { label: '看本次横向对比', to: ROUTES.competitorResults },
      { label: '打开该 ASIN 的明细', to: ROUTES.competitorAsin, params: { asin: ctx.asin } },
    ],
    offSystem: [
      '广告后台 → 按「花费降序」找出增量花费集中在哪些活动/关键词',
      '对增量花费高且零转化的流量：降竞价或暂停，预算集中到已验证出单的词与投放位',
      '若销售额端是主因，先解决转化端（Listing、价格、评分、库存），不要只加预算',
    ],
  }),
  cvr_down: (ctx) => ({
    what: `本品${ctx.asin ? ` ${ctx.asin}` : ''}的转化率相比上一等长区间下滑`,
    links: [
      { label: '打开该 ASIN 的明细', to: ROUTES.competitorAsin, params: { asin: ctx.asin } },
    ],
    offSystem: [
      '逐项核对 Listing 转化要素（主图 / 价格 / 评分 / 库存状态）本期是否有变动',
      '广告后台 → 搜索词报告，确认是否引入了低转化流量',
    ],
  }),
  spend_up_sales_down: (ctx) => ({
    what: `本品${ctx.asin ? ` ${ctx.asin}` : ''}出现"花费上涨、广告销售额下滑"`,
    links: [
      { label: '看本次横向对比', to: ROUTES.competitorResults },
      { label: '打开该 ASIN 的明细', to: ROUTES.competitorAsin, params: { asin: ctx.asin } },
    ],
    offSystem: [
      '广告后台 → 按投放位与关键词拆分花费增量，先砍「增量花费高且零转化」的流量',
      '评估是否需要重建高转化词的投放结构（旧结构可能已被无效流量稀释）',
    ],
  }),
  acos_above_group: (ctx) => ({
    what: `本品${ctx.asin ? ` ${ctx.asin}` : ''}的 ACoS 高于组内竞品均值`,
    links: [
      { label: '看本次横向对比', to: ROUTES.competitorResults },
      { label: '打开该 ASIN 的明细', to: ROUTES.competitorAsin, params: { asin: ctx.asin } },
    ],
    offSystem: [
      '对照组内表现更好的 ASIN：比较投放词结构、出价与 Listing 转化要素的差异',
      '先动结构（词/投放位），再动出价',
    ],
  }),
  cvr_below_group: (ctx) => ({
    what: `本品${ctx.asin ? ` ${ctx.asin}` : ''}的转化率低于组内竞品均值`,
    links: [
      { label: '看本次横向对比', to: ROUTES.competitorResults },
      { label: '打开该 ASIN 的明细', to: ROUTES.competitorAsin, params: { asin: ctx.asin } },
    ],
    offSystem: [
      '排查本品的 Listing 转化要素（主图、价格、评分、库存状态）—— 这类差距通常不是出价能解决的',
      '对照竞品的公开属性（价格/评分/评分数）判断差在哪一项',
    ],
  }),
  stockout_risk: (ctx) => ({
    what: `SKU ${ctx.sku ?? ''}存在断货风险`,
    links: [{ label: '去我的 ASIN 看清单', to: ROUTES.watchlistItems }],
    offSystem: [
      '按建议补货量安排采购下单，并确认在途货物的到仓时间',
      '补货到位前评估是否临时收紧广告预算，避免断货期间继续买流量',
    ],
  }),
  overstock: (ctx) => ({
    what: `SKU ${ctx.sku ?? ''}库存积压`,
    links: [{ label: '去我的 ASIN 看清单', to: ROUTES.watchlistItems }],
    offSystem: [
      '控制补货节奏，暂停下一批采购',
      '评估是否放缓广告投入，避免为滞销库存继续买流量',
    ],
  }),
  slow_moving: (ctx) => ({
    what: `SKU ${ctx.sku ?? ''}判定为滞销`,
    links: [{ label: '去我的 ASIN 看清单', to: ROUTES.watchlistItems }],
    offSystem: [
      '评估清库动作（促销 / 捆绑 / 站外），不要继续为无转化流量付费',
      '确认该 SKU 是否为季节性商品，若是则按季节窗口安排',
    ],
  }),
  inventory_unmapped: () => ({
    what: '本品的 ASIN 还没有关联到 SKU，因此这次分析看不到库存与可售天数',
    links: [{ label: '去产品主数据登记映射', to: ROUTES.productDev }],
    offSystem: [],
  }),
  inventory_unknown: (ctx) => ({
    what: `SKU ${ctx.sku ?? ''}的库存数据不足，无法测算可售天数`,
    links: [{ label: '去产品主数据补充映射', to: ROUTES.productDev }],
    offSystem: ['补齐产品主数据映射，或导入覆盖更长周期的销售报告后再评估'],
  }),

  /* ---------- 卖家精灵公开数据 ---------- */
  public_price_below: (ctx) => ({
    what: `本品${ctx.asin ? ` ${ctx.asin}` : ''}价格低于竞品均值`,
    links: [
      { label: '打开该 ASIN 的竞品详情', to: ROUTES.competitorAsin, params: { asin: ctx.asin } },
    ],
    offSystem: [
      '先确认低价是否已牺牲毛利（算一遍到手毛利）',
      '若要提价：小幅试探并观察 BSR 与转化率变化，不要一次到位',
    ],
  }),
  public_price_above: (ctx) => ({
    what: `本品${ctx.asin ? ` ${ctx.asin}` : ''}价格高于竞品均值`,
    links: [
      { label: '打开该 ASIN 的竞品详情', to: ROUTES.competitorAsin, params: { asin: ctx.asin } },
      { label: '看这个类目的市场结构', to: ROUTES.market, params: { keyword: ctx.keyword, marketplace: ctx.marketplace } },
    ],
    offSystem: ['核对价格带：确认主推款是否落在销量最集中的区间', '若坚持高价，需要用评分/评论量/差异化作支撑'],
  }),
  public_rating_below: (ctx) => ({
    what: `本品${ctx.asin ? ` ${ctx.asin}` : ''}评分低于竞品均值`,
    links: [
      { label: '打开该 ASIN 的竞品详情', to: ROUTES.competitorAsin, params: { asin: ctx.asin } },
    ],
    offSystem: ['定位最近的低分评价，逐条确认是产品问题还是预期不符', '针对问题点修正 Listing 描述，避免继续引入不匹配的流量'],
  }),
  public_ratings_fewer: (ctx) => ({
    what: `本品${ctx.asin ? ` ${ctx.asin}` : ''}评分数显著少于竞品`,
    links: [
      { label: '打开该 ASIN 的竞品详情', to: ROUTES.competitorAsin, params: { asin: ctx.asin } },
    ],
    offSystem: [
      '把评论获取纳入固定节奏：Request a Review、售后卡片、Vine',
      '评论量补齐之前，不要用加预算的方式硬拉排名',
    ],
  }),
  public_bsr_behind: (ctx) => ({
    what: `本品${ctx.asin ? ` ${ctx.asin}` : ''}的 BSR 落后于竞品均值`,
    links: [
      { label: '打开该 ASIN 的竞品详情', to: ROUTES.competitorAsin, params: { asin: ctx.asin } },
    ],
    offSystem: ['从关键词覆盖与转化率两头查（排名是两者的结果）', '检查是否需要补长尾词覆盖'],
  }),
  public_trend_down: (ctx) => ({
    what: `本品${ctx.asin ? ` ${ctx.asin}` : ''}的月销量趋势相对竞品走弱`,
    links: [
      { label: '看这个类目的市场结构', to: ROUTES.market, params: { keyword: ctx.keyword, marketplace: ctx.marketplace } },
      { label: '打开该 ASIN 的竞品详情', to: ROUTES.competitorAsin, params: { asin: ctx.asin } },
    ],
    offSystem: [
      '先区分是类目整体下行还是本品份额流失（对照竞品同期趋势）',
      '若是份额流失：优先补关键词覆盖与评论，而不是加预算',
    ],
  }),
  public_lowest_in_group: (ctx) => ({
    what: `本品${ctx.asin ? ` ${ctx.asin}` : ''}在组内表现最好，可作为参照`,
    links: [
      { label: '看本次横向对比', to: ROUTES.competitorResults },
      { label: '打开该 ASIN 的竞品详情', to: ROUTES.competitorAsin, params: { asin: ctx.asin } },
    ],
    offSystem: ['把本品的投放结构与出价策略复用到组内表现较差的 ASIN 上'],
  }),
  public_ad_dependency_high: (ctx) => ({
    what: `本品${ctx.asin ? ` ${ctx.asin}` : ''}的流量对广告依赖偏高`,
    links: [
      { label: '打开该 ASIN 的竞品详情', to: ROUTES.competitorAsin, params: { asin: ctx.asin } },
    ],
    offSystem: [
      '优先做关键词覆盖与转化优化（主图、A+、评论），把一部分词做成自然位',
      '降预算测试自然流量承接能力，避免"一降预算排名就掉"',
    ],
  }),
  public_not_indexed: (ctx) => ({
    what: `${ctx.asin ? `${ctx.asin} ` : '本品'}没有被卖家精灵收录，这次分析看不到它的公开属性`,
    links: [
      { label: '回到分析页重新分析', to: ROUTES.competitorAnalysis },
      { label: '打开该 ASIN 的详情', to: ROUTES.competitorAsin, params: { asin: ctx.asin } },
    ],
    offSystem: ['在卖家精灵开放平台确认该 ASIN 是否在收录范围内'],
  }),
  public_review_weakness: (ctx) => ({
    what: '竞品差评集中在这几个词上，是可利用的切入点',
    links: [
      { label: '打开竞品详情看差评明细', to: ROUTES.competitorAsin, params: { asin: ctx.asin } },
    ],
    offSystem: ['把这些痛点写进五点描述与 A+（明确"我们不这样"）', '评估产品端是否也能规避同样的问题'],
  }),
}

/**
 * 按诊断码生成处置方案；没有对应诊断码时返回 `null`（前端回退到旧的文字建议）。
 *
 * `context` 里可用的字段来自结论本身与本次分析的参数：`asin` / `marketplace` / `keyword` / `sku`。
 * 缺字段时**不猜** —— 例如没有 `keyword` 就不给"市场调研"按钮（宁可少一个入口，也不要给一个
 * 点进去查不到东西的链接）。
 */
export function buildFix(code, context = {}) {
  const builder = FIX_BY_CODE[code]
  if (typeof builder !== 'function') return null
  const fix = builder(context) ?? null
  if (!fix) return null
  /* `$asin` 路由少了 asin 会直接报错，必须丢弃；其余参数（如市场调研的 keyword）由前端按当前
     上下文补，补不上就在渲染层不显示按钮 —— 宁可少一个入口，也不要给一个点进去查不到东西的链接。 */
  const links = (fix.links ?? []).filter((link) => {
    if (!link?.to || !link?.label) return false
    if (link.to.includes('$asin')) return Boolean(link.params?.asin)
    return true
  })
  return {
    what: fix.what ?? '',
    links,
    offSystem: (fix.offSystem ?? []).filter((step) => Boolean(step)),
  }
}

/** 供测试与文档使用：全部已定义的诊断码。 */
export function knownFixCodes() {
  return Object.keys(FIX_BY_CODE)
}

/**
 * AI 助手工具契约（纯数据）。
 *
 * 需求文档 §6.6：每个工具必须声明「名称、描述、参数 JSON Schema、所需角色、审计字段」，
 * 禁止出现无权限声明的工具。这里只放元信息，执行实现放在 tools.mjs，两者通过 name 关联。
 *
 * requiredRole 取值说明：
 * - 'user'  → 任意启用状态的账号（对应库内角色 admin / operator）
 * - 'admin' → 必须是 admin 角色且账号启用
 */

export const TOOL_CONTRACTS = [
  {
    name: 'search_knowledge',
    description:
      '在企业知识库中检索与问题相关的资料片段（制度文档、SOP、已审核员工经验），返回片段内容、来源文档、更新时间与提报人。回答制度、流程、SOP、经验类问题前必须先调用本工具。',
    requiredRole: 'user',
    paramsSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '检索关键词或自然语言问题，例如「亚马逊断货补货流程」',
          maxLength: 200,
        },
        topK: {
          type: 'integer',
          description: '返回片段数量，默认 5',
          minimum: 1,
          maximum: 10,
        },
        sourceType: {
          type: 'string',
          enum: ['all', 'feishu', 'upload', 'experience'],
          description: '限定知识来源类型，默认 all',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    auditFields: ['query', 'topK', 'sourceType'],
  },
  {
    name: 'rebuild_knowledge_index',
    description:
      '重建知识库检索索引，使新增或更新的文档立即可被检索到。仅管理员可用。',
    requiredRole: 'admin',
    paramsSchema: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    auditFields: [],
  },
  {
    name: 'deactivate_document',
    description:
      '将指定知识文档下线，下线后不再被检索与引用。仅管理员可用，需提供文档 ID 与下线原因。',
    requiredRole: 'admin',
    paramsSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'integer',
          description: '要下线的文档 ID',
          minimum: 1,
        },
        reason: {
          type: 'string',
          description: '下线原因，写入审计',
          maxLength: 200,
        },
      },
      required: ['documentId'],
      additionalProperties: false,
    },
    auditFields: ['documentId', 'reason'],
  },
  {
    name: 'query_amazon_performance',
    description:
      '查询指定 ASIN 在日期区间内的 Amazon 广告与销售表现，返回按日明细、期间汇总、环比/同比对比、ACoS 涨跌驱动因子分解与异常判定。回答任何关于 ACoS 变化、广告效果、销量波动、同比环比的问题都必须先调用本工具，不要凭记忆估算数字。',
    requiredRole: 'user',
    paramsSchema: {
      type: 'object',
      properties: {
        asin: {
          type: 'string',
          description:
            '商品 ASIN，例如 B0XXXXXXXX。不传表示按站点做全站聚合（返回整体汇总与各 ASIN 排行表），用户问"整体表现怎么样""哪个 ASIN 花费/ACoS 最高"这类问题时不要传 asin',
          maxLength: 40,
        },
        marketplace: {
          type: 'string',
          enum: ['US', 'UK', 'DE', 'FR', 'IT', 'ES', 'JP', 'CA', 'MX', 'AU'],
          description: '站点，默认 US',
        },
        startDate: { type: 'string', description: '开始日期 YYYY-MM-DD，最长区间 366 天', maxLength: 10 },
        endDate: { type: 'string', description: '结束日期 YYYY-MM-DD', maxLength: 10 },
        compareWith: {
          type: 'string',
          enum: ['previous_period', 'last_year', 'none'],
          description:
            '对比基准：previous_period 环比紧邻等长区间（默认），last_year 对比去年同期，none 不对比',
        },
      },
      required: ['startDate', 'endDate'],
      additionalProperties: false,
    },
    auditFields: ['asin', 'marketplace', 'startDate', 'endDate', 'compareWith'],
  },
  {
    name: 'query_inventory_orders',
    description:
      '查询指定 SKU 的库存状态（可用、在途、占用）与最近订单明细。回答库存还剩多少、有多少在途、订单状态这类问题必须调用本工具，不要凭记忆回答。',
    requiredRole: 'user',
    paramsSchema: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: '商品 SKU，例如 KT-JH-001-BK', maxLength: 80 },
        includeOrders: { type: 'boolean', description: '是否同时返回订单明细，默认 true' },
        orderStatus: { type: 'string', description: '按订单状态筛选，例如 已发货', maxLength: 40 },
        limit: { type: 'integer', description: '订单明细返回条数上限，默认 20', minimum: 1, maximum: 100 },
      },
      required: ['sku'],
      additionalProperties: false,
    },
    auditFields: ['sku', 'includeOrders', 'orderStatus', 'limit'],
  },
  {
    name: 'scan_amazon_anomalies',
    description:
      '扫描某站点在指定周期内**全部 ASIN** 的广告表现异常，返回按严重度排序的异常清单、每项命中的信号（ACoS 超预警线、转化率下滑、花费上涨但销售额下滑等）与各 ASIN ACoS 对比。用户问"哪些 ASIN 出问题了""整体哪里异常""有没有需要处理的 ASIN"时必须调用本工具。回答单个 ASIN 的具体归因请用 query_amazon_performance。',
    requiredRole: 'user',
    paramsSchema: {
      type: 'object',
      properties: {
        marketplace: {
          type: 'string',
          enum: ['US', 'UK', 'DE', 'FR', 'IT', 'ES', 'JP', 'CA', 'MX', 'AU'],
          description: '站点，默认 US',
        },
        startDate: { type: 'string', description: '开始日期 YYYY-MM-DD', maxLength: 10 },
        endDate: { type: 'string', description: '结束日期 YYYY-MM-DD', maxLength: 10 },
        minSeverity: {
          type: 'string',
          enum: ['medium', 'high'],
          description: '只列出该等级及以上的异常，默认 medium',
        },
      },
      required: ['startDate', 'endDate'],
      additionalProperties: false,
    },
    auditFields: ['marketplace', 'startDate', 'endDate', 'minSeverity'],
  },
  {
    name: 'analyze_inventory_risk',
    description:
      '库存风险分析：按 SKU 计算日均销量与可售天数，判定断货风险 / 积压 / 滞销，并给出建议补货量。不传 sku 时分析全部 SKU。销量口径优先用「产品主数据 → 销售报告」的完整销售历史，缺少映射时回退订单快照（样本短、置信度低），回答中必须说明用的是哪一种口径。用户问"哪些 SKU 快断货了""有没有滞销库存""要不要补货"时必须调用本工具；只问某个 SKU 的库存数量用 query_inventory_orders。',
    requiredRole: 'user',
    paramsSchema: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: '商品 SKU；不传表示分析全部 SKU', maxLength: 80 },
        velocityWindowDays: {
          type: 'integer',
          description: '销量统计窗口天数，默认 30，范围 7-180。窗口锚点为销售数据的最后一天（不是今天）',
          minimum: 7,
          maximum: 180,
        },
      },
      required: [],
      additionalProperties: false,
    },
    auditFields: ['sku', 'velocityWindowDays'],
  },
  {
    name: 'query_my_asins',
    description:
      '查询当前账号「我的 ASIN」列表（员工自己在「我的 ASIN」页维护的那批商品，每条 ASIN 属于一个站点）内**全部 ASIN** 的广告与销售表现：按站点分组的整体汇总、环比/同比、各 ASIN 明细与 ACoS 排行、需要处理的异常 ASIN、以及没有报表数据的 ASIN。' +
      '用户提到"我的 ASIN""我的清单""我负责的这批商品""我的主力款/主力 ASIN"时使用本工具。' +
      '**站点之间不能相加**：不同站点货币不同，回答时必须按站点分别陈述，不得给出跨站点的金额或 ACoS 合计。' +
      '不传 marketplace 就是全部站点（按站点分组给出）；传 marketplace 只看某个站点；传 asins 只看指定商品。' +
      '**startDate / endDate 可以都不传**：不传时按默认统计窗口（以最新可用报表日期为终点的近 30 天）查询，' +
      '用户只问"有哪些 ASIN / 列出清单"时**不要为了凑参数编造日期**，也不要因此拒绝回答。' +
      '用户要求「列出我的 ASIN 列表 / 有哪些 ASIN」时，**必须逐条列出 ASIN 编码**（按站点分组、带上别名），不得只回答数量。' +
      '列表为空时如实告知用户到「我的 ASIN」页添加商品。问单个 ASIN 自身的归因用 query_amazon_performance，问全站用 scan_amazon_anomalies。',
    requiredRole: 'user',
    paramsSchema: {
      type: 'object',
      properties: {
        marketplace: {
          type: 'string',
          enum: ['US', 'UK', 'DE', 'FR', 'IT', 'ES', 'JP', 'CA', 'MX', 'AU'],
          description: '只看某个站点；不传则按站点分组给出全部站点',
        },
        asins: {
          type: 'array',
          items: { type: 'string' },
          description: '只看指定的 ASIN（最多 50 个）；不传则为列表内全部 ASIN',
        },
        startDate: { type: 'string', description: '开始日期 YYYY-MM-DD，最长区间 366 天', maxLength: 10 },
        endDate: { type: 'string', description: '结束日期 YYYY-MM-DD', maxLength: 10 },
        compareWith: {
          type: 'string',
          enum: ['previous_period', 'last_year', 'none'],
          description:
            '对比基准：previous_period 环比紧邻等长区间（默认），last_year 对比去年同期，none 不对比',
        },
      },
      required: [],
      additionalProperties: false,
    },
    auditFields: ['marketplace', 'asins', 'startDate', 'endDate', 'compareWith'],
  },
  {
    name: 'query_competitor_analysis',
    description:
      '调取**已落库的竞品分析记录**（在「竞品分析 → 分析结果」页看到的那一份：结论与建议、本品 vs 竞品的广告与销售横向对比、卖家精灵公开属性、以及当时的分析参数）。' +
      '**只读历史快照：本工具不重新分析、不调用卖家精灵、不消耗任何额度**，数字与页面上当时保存的完全一致；需要最新结果请让用户到「竞品分析」页重新分析（那会消耗额度）。' +
      '三种用法：传 analysisId 取指定那一次；传 asin 取包含该 ASIN 的最近一次；都不传则列出最近的几次让用户挑。' +
      '用户提到"竞品分析""上次对某 ASIN 做的对比分析""我做过哪些竞品分析""之前那个竞品分析结论"时使用本工具。' +
      /*
       * 工具区分说明（2026-09-18 实测）：用户问「我的 asin 列表」时模型曾误选本工具，
       * 而它只查"分析记录"、给不出清单 —— 这类问法必须走 query_my_asins。
       */
      '**本工具给不出"我的 ASIN 清单"**：用户问"我的 ASIN 列表 / 我的 ASIN 有哪些 / 我维护了哪些商品"时，必须用 `query_my_asins`，不要用本工具。' +
      '问单个 ASIN 自身的广告表现用 query_amazon_performance；问"我负责的这批商品"的表现在用 query_my_asins；问全站异常用 scan_amazon_anomalies。',
    requiredRole: 'user',
    paramsSchema: {
      type: 'object',
      properties: {
        analysisId: {
          type: 'integer',
          description: '分析记录 ID（页面上显示为「分析记录 #N」）；已知记录号时使用',
          minimum: 1,
        },
        asin: {
          type: 'string',
          description:
            '商品 ASIN（10 位）；取"包含这个 ASIN 的最近一次分析"。不传 analysisId 时才生效',
          maxLength: 20,
        },
        limit: {
          type: 'integer',
          description: '不传 analysisId / asin 时，列出最近几次，默认 5，范围 1-20',
          minimum: 1,
          maximum: 20,
        },
      },
      required: [],
      additionalProperties: false,
    },
    auditFields: ['analysisId', 'asin', 'limit'],
  },
]

export function findToolContract(name) {
  return TOOL_CONTRACTS.find((tool) => tool.name === name) ?? null
}

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
]

export function findToolContract(name) {
  return TOOL_CONTRACTS.find((tool) => tool.name === name) ?? null
}

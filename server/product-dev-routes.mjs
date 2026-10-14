/**
 * 产品开发接口。
 *
 * 资源全部是**账号私有**的：候选池与对比记录都只属于本人，管理员访问他人数据同样 404
 * （沿用 `/api/ai/notes/*` 与 ASIN 清单的"所有者视角"：可见 ≠ 可操作）。
 * 候选与对比属个人工作数据，与竞品分析历史同样**不写管理审计**。
 *
 * 写管道顺序：校验 → 权限（归属） → 冲突 → 执行。
 */
import express from 'express'
import { toCsv } from './ai-agent/csv.mjs'
import { WatchlistTableError, readTableRowsFromBuffer } from './ai-agent/watchlist-table.mjs'
import {
  analyzeMarket,
  isMarketInputError,
  parseCategoryQuery,
  searchMarketCategories,
} from './market-research.mjs'
import { parseTtlHours } from './sellersprite-config.mjs'
import {
  DEFAULT_PAGE_SIZE,
  MAX_COMPARE_ITEMS,
  MAX_CANDIDATES_PER_USER,
  MAX_IMPORT_ROWS,
  MAX_KEYWORD_LENGTH,
  MAX_PAGE_SIZE,
  MIN_COMPARE_ITEMS,
  ProductDevConflictError,
  ProductDevNotFoundError,
  ProductDevValidationError,
  STAGE_LABELS,
  STAGES,
  buildComparison,
  commitImport,
  createCandidate,
  deleteCandidate,
  deleteComparison,
  getCandidate,
  getComparison,
  listCandidates,
  listComparisons,
  normalizeCandidateInput,
  parseImport,
  parseMarketplace,
  parseStage,
  recordComparison,
  updateCandidate,
} from './product-dev.mjs'

/** 单个上传文件上限（8MB）：2000 行 CSV 只有几百 KB，xlsx 也在这个量级内。 */
const MAX_IMPORT_BYTES = 8 * 1024 * 1024

function resourceId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** `X-File-Name` 是 `encodeURIComponent` 后的文件名 —— 中文名直接进 header 会被拒。 */
function decodeFileName(value) {
  const text = typeof value === 'string' ? value.slice(0, 900) : ''
  if (!text) return null
  try {
    return decodeURIComponent(text).slice(0, 300)
  } catch {
    return text.slice(0, 300)
  }
}

/** 分页参数：非法值一律回落到默认，不报错（页码越界由返回的空列表体现）。 */
function parsePaging(query) {
  const page = Math.max(1, Number(query.page) || 1)
  const rawSize = Number(query.pageSize) || DEFAULT_PAGE_SIZE
  const pageSize = Math.min(Math.max(rawSize, 1), MAX_PAGE_SIZE)
  return { page, pageSize }
}

function parseKeyword(query) {
  const keyword = String(query.keyword ?? '').trim()
  if (!keyword) return null
  if (keyword.length > MAX_KEYWORD_LENGTH) {
    throw new ProductDevValidationError(`关键词不能超过 ${MAX_KEYWORD_LENGTH} 个字符。`)
  }
  return keyword
}

/** 统一错误映射：400 改输入 / 404 刷新列表 / 409 处理冲突，三种语义必须区分。 */
function handleProductDevError(error, res, next) {
  if (error instanceof ProductDevValidationError) {
    return res.status(400).json({ message: error.message })
  }
  if (error instanceof ProductDevNotFoundError) {
    return res.status(404).json({ message: error.message })
  }
  if (error instanceof ProductDevConflictError) {
    return res.status(409).json({ message: error.message })
  }
  // 表格解析失败（列识别不到、格式不支持、行数超限）属于"用户的输入问题"，按 400 返回原文
  if (error instanceof WatchlistTableError) {
    return res.status(400).json({ message: error.message, code: error.code })
  }
  return next(error)
}

export function createProductDevRouter({ requireUser }) {
  const router = express.Router()
  router.use(requireUser)

  /**
   * 候选池检索。
   *
   * 一并下发站点枚举、阶段枚举与分页上限：这些是"口径"而不是"数据"，
   * 让前端自己维护一份副本，改一处忘一处就会让筛选器出现服务端不认的选项。
   */
  router.get('/candidates', async (req, res, next) => {
    try {
      const { page, pageSize } = parsePaging(req.query)
      const result = await listCandidates({
        userId: req.user.id,
        keyword: parseKeyword(req.query),
        marketplace: req.query.marketplace ? parseMarketplace(req.query.marketplace) : null,
        stage: req.query.stage ? parseStage(req.query.stage) : null,
        page,
        pageSize,
      })
      res.json({
        ...result,
        stages: STAGES.map((value) => ({ value, label: STAGE_LABELS[value] })),
        maxCandidates: MAX_CANDIDATES_PER_USER,
        maxPageSize: MAX_PAGE_SIZE,
        maxImportRows: MAX_IMPORT_ROWS,
      })
    } catch (error) {
      handleProductDevError(error, res, next)
    }
  })

  /**
   * 导入模板下载。
   *
   * **必须注册在 `/candidates/:id` 之前**：Express 按注册顺序匹配，放后面时 `template`
   * 会被当成 `:id`，请求变成"候选 ID 无效"（ASIN 清单已经踩过这个坑）。同理，
   * 下面 `/candidates/import` 也必须排在 `/candidates/:id` 前面。
   */
  router.get('/candidates/template', (req, res, next) => {
    try {
      const csv = toCsv(
        [
          { key: 'product_name', label: '产品名称' },
          { key: 'asin', label: 'ASIN' },
          { key: 'category', label: '类目' },
          { key: 'target_price', label: '目标售价' },
          { key: 'marketplace', label: '站点' },
          { key: 'stage', label: '阶段' },
          { key: 'note', label: '备注' },
          { key: 'rating', label: '评分' },
          { key: 'reviews', label: '评论数' },
        ],
        [
          {
            product_name: '示例·便携榨汁杯',
            asin: 'B0SAMPLE01',
            category: '厨房小家电',
            target_price: '19.99',
            marketplace: 'US',
            stage: '候选',
            note: '示例行，导入前可删除',
            rating: '4.3',
            reviews: '1200',
          },
          {
            product_name: '示例·硅胶折叠水壶',
            asin: '',
            category: '户外',
            target_price: '15.99',
            marketplace: 'US',
            stage: '调研中',
            note: '没有 ASIN 也可以导入（未上架的候选）',
            rating: '4.6',
            reviews: '860',
          },
        ]
      )
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent('产品开发候选导入模板.csv')}"`
      )
      res.send(csv)
    } catch (error) {
      handleProductDevError(error, res, next)
    }
  })

  /**
   * 导入候选：**表格文件**（原始 body + `X-File-Name`）或**粘贴文本**（JSON `{ text }`）。
   *
   * 上传沿用与知识库、数据源、ASIN 清单一致的"原始 body + 文件名头"方案，
   * 不为了一期引入 multipart 依赖。`?dryRun=true` 只解析并回报"会新增什么"，**不写库** ——
   * 前端先给用户看识别结果，确认后再发一次。
   *
   * `express.raw` 的 `type` 刻意排除 `application/json`：粘贴文本走全局的 `express.json`，
   * 两者用同一个端点而不互相抢占 body（用 `type: () => true` 会把 JSON 也吞掉，
   * 而且此时 body 已被上游解析器消费，拿到的是一个空 Buffer —— 表现为"粘贴导入永远 0 行"）。
   */
  router.post(
    '/candidates/import',
    express.raw({
      type: (req) => !req.is('application/json'),
      limit: `${Math.ceil(MAX_IMPORT_BYTES / 1024 / 1024)}mb`,
    }),
    async (req, res, next) => {
      try {
        const dryRun = String(req.query.dryRun ?? '') === 'true'
        const isJson = req.is('application/json')

        let preview
        if (isJson) {
          const text = req.body?.text ?? ''
          if (!String(text).trim()) {
            throw new ProductDevValidationError('没有读到任何内容，请粘贴表格或产品清单。')
          }
          preview = await parseImport({ userId: req.user.id, text })
        } else {
          const fileName = decodeFileName(req.get('X-File-Name'))
          const rows = await readTableRowsFromBuffer({ buffer: req.body, fileName: fileName ?? '' })
          preview = await parseImport({ userId: req.user.id, rows: rows.rows, fileName })
        }

        if (dryRun) {
          // 预览不返回内部条目，避免前端把它当成"已写入"的凭据
          const { _fresh, ...safe } = preview
          return res.json({ dryRun: true, ...safe })
        }

        const result = await commitImport({ userId: req.user.id, preview })
        res.json({ dryRun: false, ...result })
      } catch (error) {
        handleProductDevError(error, res, next)
      }
    }
  )

  router.post('/candidates', async (req, res, next) => {
    try {
      const input = normalizeCandidateInput(req.body ?? {})
      const candidate = await createCandidate({ userId: req.user.id, input })
      res.status(201).json({ candidate })
    } catch (error) {
      handleProductDevError(error, res, next)
    }
  })

  router.get('/candidates/:id', async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) throw new ProductDevValidationError('候选 ID 无效。')
      const candidate = await getCandidate(req.user.id, id)
      if (!candidate) throw new ProductDevNotFoundError('候选不存在或不属于当前账号。')
      res.json({ candidate })
    } catch (error) {
      handleProductDevError(error, res, next)
    }
  })

  router.patch('/candidates/:id', async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) throw new ProductDevValidationError('候选 ID 无效。')
      const existing = await getCandidate(req.user.id, id)
      if (!existing) throw new ProductDevNotFoundError('候选不存在或不属于当前账号。')
      const input = normalizeCandidateInput(
        { ...(req.body ?? {}), currentName: existing.product_name, currentAsin: existing.asin },
        { partial: true }
      )
      const candidate = await updateCandidate({ userId: req.user.id, id, input })
      res.json({ candidate })
    } catch (error) {
      handleProductDevError(error, res, next)
    }
  })

  /** 删除候选（软删：只置 `deleted_at`，因此之后可以重新添加同一个 ASIN）。 */
  router.delete('/candidates/:id', async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) throw new ProductDevValidationError('候选 ID 无效。')
      await deleteCandidate(req.user.id, id)
      res.json({ deleted: true, id })
    } catch (error) {
      handleProductDevError(error, res, next)
    }
  })

  /**
   * 发起对比：勾选 2–10 个候选 → 服务端装配结果并**落库快照**。
   *
   * 返回里带上 `comparisonId` 与 `createdAt`：前端据此在"历史对比"里高亮刚生成的这条，
   * 与竞品分析的行为一致。
   */
  router.post('/comparisons', async (req, res, next) => {
    try {
      const result = await buildComparison({
        userId: req.user.id,
        candidateIds: req.body?.candidateIds ?? [],
        windowDays: req.body?.windowDays,
        startDate: req.body?.startDate,
        endDate: req.body?.endDate,
      })
      const record = await recordComparison({
        userId: req.user.id,
        result,
        title: req.body?.title ?? '',
      })
      res.json({
        record: {
          id: record.id,
          title: record.title,
          createdAt: record.created_at,
        },
        result: { ...result, comparisonId: record.id, createdAt: record.created_at },
      })
    } catch (error) {
      handleProductDevError(error, res, next)
    }
  })

  /** 历史对比列表（只回摘要，不回快照，避免列表接口传大 JSON）。 */
  router.get('/comparisons', async (req, res, next) => {
    try {
      const items = await listComparisons(req.user.id, req.query.limit)
      res.json({ items, minCompareItems: MIN_COMPARE_ITEMS, maxCompareItems: MAX_COMPARE_ITEMS })
    } catch (error) {
      handleProductDevError(error, res, next)
    }
  })

  /** 单条对比（含结果快照）；越权或不存在一律 404，不区分两者。 */
  router.get('/comparisons/:id', async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) throw new ProductDevValidationError('对比记录 ID 无效。')
      const record = await getComparison(req.user.id, id)
      if (!record) throw new ProductDevNotFoundError('对比记录不存在。')
      res.json({ record: { id: record.id, createdAt: record.createdAt }, result: record.result })
    } catch (error) {
      handleProductDevError(error, res, next)
    }
  })

  router.delete('/comparisons/:id', async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) throw new ProductDevValidationError('对比记录 ID 无效。')
      await deleteComparison(req.user.id, id)
      res.json({ deleted: true, id })
    } catch (error) {
      handleProductDevError(error, res, next)
    }
  })

  /**
   * 市场调研：按关键词搜类目节点。
   *
   * 市场调研的输入是**类目**而不是 ASIN，所以第一步必须能把"用户脑子里的品类词"
   * 换成卖家精灵的 `nodeIdPath` —— 这一步消耗 1 次调用（24h 缓存）。
   */
  router.get('/market/categories', async (req, res, next) => {
    try {
      const { keyword, marketplace } = parseCategoryQuery(req.query ?? {})
      const result = await searchMarketCategories({
        keyword,
        marketplace,
        ttlHours: parseTtlHours(req.query?.publicTtlHours),
        force: req.query?.refresh === 'true',
      })
      res.json(result)
    } catch (error) {
      handleMarketError(error, res, next)
    }
  })

  /** 市场调研：类目市场结构分析（规模 / 集中度 / 价格带 / 新品），固定两次外部调用。 */
  router.post('/market/analyze', async (req, res, next) => {
    try {
      const result = await analyzeMarket(req.body ?? {})
      res.json({ result })
    } catch (error) {
      handleMarketError(error, res, next)
    }
  })

  return router
}

/**
 * 市场调研的错误映射：**输入问题一律 400**（含卖家精灵采集层的配置类错误），
 * 其余交给产品开发既有的错误出口 —— 否则用户会因为"参数写错"看到 500。
 */
function handleMarketError(error, res, next) {
  if (isMarketInputError(error)) {
    return res.status(400).json({ message: error.message })
  }
  return handleProductDevError(error, res, next)
}

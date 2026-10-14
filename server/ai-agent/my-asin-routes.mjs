/**
 * 「我的 ASIN」接口（2026-09-18 取代 ASIN 清单路由）。
 *
 * 与其它 AI 路由的差异：这里的资源全部是**账号私有**的，因此没有 adminGuard 分支 ——
 * 管理员访问他人条目同样 404（沿用 `/api/ai/notes/*` 的所有者视角：可见 ≠ 可操作）。
 *
 * 写管道顺序与沉淀一致：校验 → 权限（归属）→ 冲突 → 执行。个人工作数据不写管理审计；
 * 调用它的 AI 工具本身已落 `ai_runs`。
 */
import express from 'express'
import {
  MAX_ITEMS_PER_USER,
  MY_ASIN_MARKETPLACES,
  MyAsinNotFoundError,
  MyAsinValidationError,
  addMyAsins,
  importMyAsinTable,
  listMyAsinMetricOverrides,
  listMyAsins,
  parseAddPayload,
  removeMyAsinItem,
  removeMyAsinMetricOverride,
  updateMyAsinItem,
  upsertMyAsinMetricOverride,
} from './my-asins.mjs'
import { WatchlistTableError } from './watchlist-table.mjs'
import { buildWatchlistTemplateXlsx } from './watchlist-template.mjs'
import {
  DEFAULT_WINDOW_DAYS,
  MAX_RANGE_DAYS,
  MAX_WINDOW_DAYS,
  MIN_WINDOW_DAYS,
  diffDays,
  normalizeDateInput,
  shiftDays,
} from '../competitor-analysis.mjs'
import {
  myAsinMetricsPayload,
  queryLatestAmazonDateAcrossMarketplaces,
} from './data-queries.mjs'

/** 单个上传文件上限（8MB）：5000 行 CSV 约几百 KB，xlsx 也在这个量级之内。 */
const MAX_IMPORT_BYTES = 8 * 1024 * 1024

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

function resourceId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * 统一错误映射：校验 400 / 不存在 404。
 *
 * 竞品分析的输入错误（日期格式等）与表格解析错误一并按 400 返回 —— 它们都是
 * "用户输入的问题"，让用户看到 500 只会让人以为系统坏了。
 */
function handleMyAsinError(error, res, next) {
  if (error instanceof MyAsinValidationError) {
    return res.status(400).json({ message: error.message })
  }
  if (error instanceof MyAsinNotFoundError) {
    return res.status(404).json({ message: error.message })
  }
  if (error?.name === 'CompetitorInputError') {
    return res.status(400).json({ message: error.message })
  }
  if (error instanceof WatchlistTableError) {
    return res.status(400).json({ message: error.message, code: error.code })
  }
  return next(error)
}

/**
 * 统计区间解析。
 *
 * 与竞品分析同一套规则，只有锚点不同：显式区间优先；否则以**所有站点里最新的报表日期**
 * 为终点向前取 windowDays（而不是今天 —— 报表是人工导出的，可能滞后数天，
 * 以今天为终点会得到一个大半为空的区间，看起来像"没有数据"）。
 * 多站点共用一个区间，是为了让页面上的"近 30 天"对所有行都是同一个意思。
 *
 * **导出给 AI 工具复用（2026-09-18）**：`query_my_asins` 的统计区间改成可选之后，
 * 缺省值必须与页面完全一致（同一套默认窗口与锚点），否则会出现"页面看近 30 天、
 * AI 按另一个区间回答"的口径漂移。
 */
export async function resolveWindow({ windowDays, startDate, endDate }) {
  const explicit = startDate !== undefined || endDate !== undefined
  if (explicit) {
    if (!startDate || !endDate) {
      throw new MyAsinValidationError('自定义区间需要同时提供开始与结束日期。')
    }
    const start = normalizeDateInput(startDate, '开始日期')
    const end = normalizeDateInput(endDate, '结束日期')
    if (start > end) throw new MyAsinValidationError('开始日期不能晚于结束日期。')
    const days = diffDays(start, end) + 1
    if (days > MAX_RANGE_DAYS) {
      throw new MyAsinValidationError(`区间不能超过 ${MAX_RANGE_DAYS} 天，请缩小范围后重试。`)
    }
    return { startDate: start, endDate: end, windowDays: days, customRange: true }
  }

  const parsed = Number(windowDays ?? DEFAULT_WINDOW_DAYS)
  if (!Number.isInteger(parsed) || parsed < MIN_WINDOW_DAYS || parsed > MAX_WINDOW_DAYS) {
    throw new MyAsinValidationError(
      `统计天数需要在 ${MIN_WINDOW_DAYS}–${MAX_WINDOW_DAYS} 之间。`
    )
  }
  const anchor =
    (await queryLatestAmazonDateAcrossMarketplaces()) ??
    new Date().toISOString().slice(0, 10)
  return {
    startDate: shiftDays(anchor, -(parsed - 1)),
    endDate: anchor,
    windowDays: parsed,
    customRange: false,
  }
}

export function createMyAsinRouter() {
  const router = express.Router()

  /** 列表 + 上限 + 支持的站点（上限由服务端下发，避免前端再写一份会漂移的常量）。 */
  router.get('/my-asins', async (req, res, next) => {
    try {
      const items = await listMyAsins({ userId: req.user.id })
      res.json({ items, marketplaces: MY_ASIN_MARKETPLACES, maxItems: MAX_ITEMS_PER_USER })
    } catch (error) {
      handleMyAsinError(error, res, next)
    }
  })

  /**
   * 导入模板下载（真 `.xlsx`：ASIN / 站点 / 别名 / 备注）。
   *
   * 表头即导入约定 —— 给一份带示例的模板比让用户猜"ASIN 列该叫什么"省事得多，
   * 也让"格式统一、解析稳定"这件事成立（用户不必自造表头）。
   *
   * **必须注册在参数路由之前**：Express 按注册顺序匹配，放在后面时
   * `template` 会被当成 `:itemId` 吃掉（历史上踩过一次）。
   */
  router.get('/my-asins/template', async (req, res, next) => {
    try {
      const buffer = await buildWatchlistTemplateXlsx()
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent('我的 ASIN 导入模板.xlsx')}"`
      )
      res.send(buffer)
    } catch (error) {
      handleMyAsinError(error, res, next)
    }
  })

  /**
   * 新增 ASIN：两条输入形态共用这一条路径。
   *
   * - `{ items: [{ asin, marketplace?, alias?, note? }] }`：单条弹窗表单（结构化，字段明确）；
   * - `{ asins: '...' }`：批量粘贴（纯 ASIN 文本或从 Excel 复制的一片区域，表格感知）。
   *
   * 返回四分类结果：`added` / `duplicated` / `repeated` / `invalid` —— 四类对用户要做的
   * 动作完全不同，合并成一个数字等于让人自己去猜哪里出了问题。
   */
  router.post('/my-asins/items', async (req, res, next) => {
    try {
      const userId = req.user.id
      const defaultMarketplace = req.body?.defaultMarketplace

      if (Array.isArray(req.body?.items)) {
        const result = await addMyAsins({
          userId,
          entries: req.body.items,
          defaultMarketplace,
        })

        /*
         * 新增时顺带录入人工指标（2026-09-18）：**合并成一次请求**。
         *
         * 之前由前端分两步（先建条目、再 PUT 指标），而"建条目"会让列表从空变非空、
         * 触发页面分支切换把弹窗卸载重挂载 —— 第二步的回调再也回不到界面上，
         * 用户看到的是"又弹出一个录入窗口"，在里面二次提交（ASIN 已存在）就把指标丢了。
         *
         * 指标写入失败时**不整体回滚**（条目已经建好），而是如实回报 manualError，
         * 让界面明确告诉用户"ASIN 加上了、指标没保存成功"。
         */
        let override = null
        let manualError = null
        const metrics = req.body?.metrics
        const period = req.body?.period
        if (metrics && period && result.added.length === 1) {
          try {
            const saved = await upsertMyAsinMetricOverride({
              userId,
              itemId: result.added[0].id,
              startDate: period.startDate,
              endDate: period.endDate,
              metrics,
            })
            override = saved.override
          } catch (error) {
            manualError =
              error instanceof Error ? error.message : '人工指标保存失败。'
          }
        }

        return res.status(201).json({
          ...result,
          override,
          manualError,
          repeated: [],
          invalid: [],
          table: false,
          columns: [],
          mapping: { asin: null, marketplace: null, alias: null, note: null },
          invalidRows: [],
          repeatedRows: [],
        })
      }

      const parsed = parseAddPayload({
        raw: req.body?.asins ?? '',
        defaultMarketplace,
      })
      const result = await addMyAsins({
        userId,
        entries: parsed.entries,
        repeated: parsed.repeated,
        invalid: parsed.invalid,
        defaultMarketplace,
      })
      return res.status(201).json({
        ...result,
        table: parsed.table,
        columns: parsed.columns,
        mapping: parsed.mapping,
        invalidRows: parsed.invalidRows,
        repeatedRows: parsed.repeatedRows,
      })
    } catch (error) {
      handleMyAsinError(error, res, next)
    }
  })

  /**
   * 从表格文件导入（CSV / XLSX）：**先预览后落库**。
   *
   * 上传沿用与知识库、数据源导入一致的"原始 body + `X-File-Name` 头"方案，
   * 不为了一期引入 multipart 依赖。`?dryRun=true` 只解析并回报"会新增什么"，不写库。
   */
  router.post(
    '/my-asins/import',
    express.raw({ type: () => true, limit: `${Math.ceil(MAX_IMPORT_BYTES / 1024 / 1024)}mb` }),
    async (req, res, next) => {
      try {
        const result = await importMyAsinTable({
          userId: req.user.id,
          buffer: req.body,
          fileName: decodeFileName(req.get('X-File-Name')),
          dryRun: String(req.query.dryRun ?? '') === 'true',
          defaultMarketplace: req.query.defaultMarketplace ?? req.get('X-Default-Marketplace'),
        })
        res.json(result)
      } catch (error) {
        handleMyAsinError(error, res, next)
      }
    }
  )

  /**
   * 多站点指标（页面数据表的唯一数据源）。
   *
   * 与 AI 工具共用 `myAsinMetricsPayload`（进而共用 `asinSetPerformancePayload`）：
   * 页面里的数字必须与对话里问出来的是同一套，否则"页面一个说法、AI 一个说法"
   * 必然引发信任问题。**空列表返回空表而不是 400** —— 列表还没有 ASIN 是正常状态。
   */
  router.get('/my-asins/metrics', async (req, res, next) => {
    try {
      const items = await listMyAsins({ userId: req.user.id })
      const window = await resolveWindow({
        windowDays: req.query.windowDays,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      })
      const payload = await myAsinMetricsPayload({
        items,
        startDate: window.startDate,
        endDate: window.endDate,
        // 人工录入的区间指标（手工值优先，未填的字段用报表）；页面上会标「手工」
        overridesByItemId: await listMyAsinMetricOverrides({
          userId: req.user.id,
          startDate: window.startDate,
          endDate: window.endDate,
        }),
      })
      res.json({
        period: {
          ...payload.period,
          windowDays: window.windowDays,
          customRange: window.customRange,
        },
        groups: payload.groups,
        rows: payload.rows,
        summary: payload.summary,
        dataFreshness: payload.dataFreshness,
      })
    } catch (error) {
      handleMyAsinError(error, res, next)
    }
  })

  /**
   * 录入 / 更新某条 ASIN 在某个区间的人工指标（2026-09-18）。
   *
   * 六个数字全部留空 = 清除该区间的人工值（回到报表口径）。
   * 区间必须是**具体起止日期**：页面上选「近 30 天」时，前端用服务端返回的实际区间回填，
   * 保证"录入的区间"与"页面看到的区间"是同一个。
   */
  router.put('/my-asins/items/:itemId/metrics', async (req, res, next) => {
    try {
      const itemId = resourceId(req.params.itemId)
      if (!itemId) throw new MyAsinValidationError('条目 ID 无效。')
      const result = await upsertMyAsinMetricOverride({
        userId: req.user.id,
        itemId,
        startDate: req.body?.startDate,
        endDate: req.body?.endDate,
        metrics: {
          spend: req.body?.spend,
          adSales: req.body?.adSales,
          orders: req.body?.orders,
          acos: req.body?.acos,
          units: req.body?.units,
          businessSales: req.body?.businessSales,
        },
      })
      res.json(result)
    } catch (error) {
      handleMyAsinError(error, res, next)
    }
  })

  /** 清除某条 ASIN 在某个区间的人工指标。 */
  router.delete('/my-asins/items/:itemId/metrics', async (req, res, next) => {
    try {
      const itemId = resourceId(req.params.itemId)
      if (!itemId) throw new MyAsinValidationError('条目 ID 无效。')
      const result = await removeMyAsinMetricOverride({
        userId: req.user.id,
        itemId,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      })
      res.json(result)
    } catch (error) {
      handleMyAsinError(error, res, next)
    }
  })

  /** 修改某条 ASIN 的身份与备注：ASIN / 站点 / 别名 / 备注。 */
  router.patch('/my-asins/items/:itemId', async (req, res, next) => {
    try {
      const itemId = resourceId(req.params.itemId)
      if (!itemId) throw new MyAsinValidationError('条目 ID 无效。')
      const result = await updateMyAsinItem({
        userId: req.user.id,
        itemId,
        asin: req.body?.asin,
        alias: req.body?.alias,
        note: req.body?.note,
        marketplace: req.body?.marketplace,
      })
      res.json(result)
    } catch (error) {
      handleMyAsinError(error, res, next)
    }
  })

  /** 移除一条 ASIN。 */
  router.delete('/my-asins/items/:itemId', async (req, res, next) => {
    try {
      const itemId = resourceId(req.params.itemId)
      if (!itemId) throw new MyAsinValidationError('条目 ID 无效。')
      const result = await removeMyAsinItem({ userId: req.user.id, itemId })
      res.json({ deleted: true, id: result.id })
    } catch (error) {
      handleMyAsinError(error, res, next)
    }
  })

  return router
}

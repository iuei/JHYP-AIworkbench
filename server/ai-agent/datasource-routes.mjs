/**
 * 数据源与导入接口（管理员，需求文档 §5.3 / §8.5）。
 *
 * 上传沿用与知识库上传一致的"原始 body + X-File-Name 头"方案，避免为了一期引入 multipart 依赖。
 * 数据集、导入模式等元信息通过查询参数传递；导入动作本身写审计。
 */
import express from 'express'
import { AUDIT_ACTIONS, recordAudit } from './audit.mjs'
import { toCsv } from './csv.mjs'
import {
  DATASET_SPECS,
  DatasetValidationError,
  MAX_IMPORT_BYTES,
  countImports,
  datasetOverview,
  datasetRowColumns,
  datasetTemplate,
  findDatasetSpec,
  importDataset,
  listDatasetRows,
  listDatasetRowsForExport,
  listImports,
} from './datasets.mjs'
import { clientIp, handleAiError, optionalString, parsePageQuery } from './http-utils.mjs'

function decodeFileName(value) {
  const text = optionalString(value, { max: 900 })
  if (!text) return null
  try {
    return optionalString(decodeURIComponent(text), { max: 300 })
  } catch {
    return text.slice(0, 300)
  }
}

/** 导入结果序列化：把失败行明细一并返回，管理员才知道该改哪一行。 */
function serializeImport(result) {
  return {
    ok: result.ok,
    importId: result.importId ?? null,
    inserted: result.inserted ?? 0,
    skipped: result.skipped ?? 0,
    rowCount: result.rowCount ?? 0,
    failedRows: result.failedRows ?? 0,
    period: result.period ?? null,
    ignoredColumns: result.ignoredColumns ?? [],
    rowErrors: result.rowErrors ?? [],
    encoding: result.encoding ?? null,
    error: result.error ?? null,
  }
}

export function createDatasourceRouter({ adminGuard }) {
  const router = express.Router()

  /** 数据集清单：行数、最近导入时间、周期、最后一次导入状态（含失败原因）。 */
  router.get('/datasets', adminGuard, async (req, res, next) => {
    try {
      const [datasets, imports] = await Promise.all([
        datasetOverview(),
        listImports({ limit: 5 }),
      ])
      res.json({
        datasets,
        recentImports: imports.map(serializeImportRow),
        specs: DATASET_SPECS.map((spec) => ({ key: spec.key, label: spec.label })),
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /**
   * 数据集行详情（分页 + 关键词）。
   *
   * 这条接口存在的原因：数据集清单只给"多少行、覆盖哪段周期"，管理员导入完一批报表后
   * 无法在页面上确认到底写进去了什么。行详情是"导入结果可核对"的最后一环。
   */
  router.get('/datasets/rows', adminGuard, async (req, res, next) => {
    try {
      const spec = findDatasetSpec(optionalString(req.query.dataset, { max: 40 }) ?? '')
      if (!spec) {
        return res.status(400).json({ message: '未知数据集，请先选择数据集。' })
      }
      const { page, pageSize } = parsePageQuery(req.query)
      const keyword = optionalString(req.query.keyword, { max: 100 })
      const { rows, total } = await listDatasetRows({
        spec,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        keyword,
      })
      res.json({
        dataset: spec.key,
        label: spec.label,
        description: spec.description,
        columns: datasetRowColumns(spec),
        rows,
        total,
        page,
        pageSize,
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /**
   * 行数据导出 CSV：与页面同一筛选条件（含关键词）。
   *
   * 导出是"数据出境"动作，与审计导出、沉淀导出同一口径写审计；
   * 触达行数上限时用 `X-Export-Truncated` 明示，避免把"部分导出"当成"全量导出"。
   */
  router.get('/datasets/rows/export', adminGuard, async (req, res, next) => {
    try {
      const spec = findDatasetSpec(optionalString(req.query.dataset, { max: 40 }) ?? '')
      if (!spec) {
        return res.status(400).json({ message: '未知数据集，请先选择数据集。' })
      }
      const keyword = optionalString(req.query.keyword, { max: 100 })
      const { rows, total, truncated } = await listDatasetRowsForExport({ spec, keyword })
      await recordAudit({
        actorId: req.user.id,
        action: AUDIT_ACTIONS.datasetExport,
        targetType: 'ai_dataset',
        targetId: spec.key,
        detail: {
          dataset: spec.key,
          keyword: keyword ?? null,
          rows: rows.length,
          total,
          truncated,
        },
        ip: clientIp(req),
      })
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(
          `${spec.label}-${new Date().toISOString().slice(0, 10)}.csv`
        )}"`
      )
      if (truncated) res.setHeader('X-Export-Truncated', 'true')
      res.send(toCsv(datasetRowColumns(spec), rows))
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /** 模板下载：表头即导入要求，避免"列名不匹配整批拒绝"时用户反复试错。 */
  router.get('/imports/template', adminGuard, (req, res, next) => {
    try {
      const spec = findDatasetSpec(optionalString(req.query.dataset, { max: 40 }) ?? '')
      if (!spec) {
        return res.status(400).json({ message: '未知数据集，请先选择数据集再下载模板。' })
      }
      // 模板带上列说明，直接用 Excel 打开即可填写
      const csv = datasetTemplate(spec)
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(`${spec.label}-导入模板.csv`)}"`
      )
      res.send(csv)
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /** 导入记录（分页）：失败的导入同样留痕，因此历史必须可往前翻，不能只给"最近 N 条"。 */
  router.get('/imports', adminGuard, async (req, res, next) => {
    try {
      const { page, pageSize } = parsePageQuery(req.query)
      const spec = findDatasetSpec(optionalString(req.query.dataset, { max: 40 }) ?? '')
      const dataset = spec?.key ?? null
      const [rows, total] = await Promise.all([
        listImports({ dataset, limit: pageSize, offset: (page - 1) * pageSize }),
        countImports({ dataset }),
      ])
      res.json({ imports: rows.map(serializeImportRow), total, page, pageSize })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  /**
   * 上传导入。
   * 期望：Content-Type 任意二进制 + 头 `X-File-Name`（encodeURIComponent 后的文件名）+ 查询参数 dataset/mode/onRowError。
   */
  router.post(
    '/imports',
    adminGuard,
    express.raw({ type: () => true, limit: `${Math.ceil(MAX_IMPORT_BYTES / 1024 / 1024)}mb` }),
    async (req, res, next) => {
      try {
        const dataset = optionalString(req.query.dataset, { max: 40 }) ?? ''
        const spec = findDatasetSpec(dataset)
        if (!spec) {
          return res.status(400).json({ message: `未知数据集：${dataset || '(未指定)'}。` })
        }
        const mode = optionalString(req.query.mode, { max: 20 }) ?? 'overwrite'
        if (!['overwrite', 'append'].includes(mode)) {
          return res.status(400).json({ message: '导入模式只能是 overwrite（覆盖）或 append（追加）。' })
        }
        const onRowError = optionalString(req.query.onRowError, { max: 10 }) ?? 'reject'

        const fileName = decodeFileName(req.headers['x-file-name']) ?? `${spec.label}.csv`
        const result = await importDataset({
          spec,
          buffer: req.body,
          mode,
          userId: req.user.id,
          fileName,
          onRowError,
        })

        await recordAudit({
          actorId: req.user.id,
          action: 'import',
          targetType: 'ai_import',
          targetId: String(result.importId ?? spec.key),
          detail: {
            dataset: spec.key,
            mode,
            fileName,
            status: result.ok ? 'ok' : 'failed',
            inserted: result.inserted ?? 0,
            failedRows: result.failedRows ?? 0,
            period: result.period ?? null,
            ignoredColumns: result.ignoredColumns ?? [],
            error: result.ok ? null : result.error,
          },
          ip: clientIp(req),
        })

        // 校验失败按 400 返回，但仍带上 importId 与失败行明细，便于前端展示与排查
        const status = result.ok ? 201 : 400
        return res.status(status).json(serializeImport(result))
      } catch (error) {
        if (error instanceof DatasetValidationError) {
          return res.status(400).json({ message: error.message })
        }
        if (error?.type === 'entity.too.large') {
          return res
            .status(413)
            .json({ message: `文件超过 ${Math.ceil(MAX_IMPORT_BYTES / 1024 / 1024)}MB 上限，请拆分后导入。` })
        }
        return handleAiError(error, res, next)
      }
    }
  )

  router.use((error, _req, res, next) => handleAiError(error, res, next))

  return router
}

function serializeImportRow(row) {
  return {
    id: row.id,
    dataset: row.dataset,
    datasetLabel: findDatasetSpec(row.dataset)?.label ?? row.dataset,
    fileName: row.file_name,
    mode: row.mode,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    rowCount: row.row_count,
    failedRows: row.failed_rows,
    failReason: row.fail_reason,
    status: row.status,
    importedAt: row.imported_at,
    importedByName: row.imported_by_name,
    importedByLogin: row.imported_by_login,
  }
}

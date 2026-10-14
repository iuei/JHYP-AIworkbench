import express from 'express'
import {
  createMarketInsightReport,
  getMarketInsightReport,
  listMarketInsightReports,
  MarketInsightNotFoundError,
  MarketInsightValidationError,
} from './market-insights.mjs'

function resourceId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

function handleMarketInsightError(error, res, next) {
  if (error instanceof MarketInsightValidationError) {
    return res.status(400).json({ message: error.message })
  }
  if (error instanceof MarketInsightNotFoundError) {
    return res.status(404).json({ message: error.message })
  }
  return next(error)
}

export function createMarketInsightRouter({ requireUser }) {
  const router = express.Router()
  router.use(requireUser)

  router.get('/reports', async (req, res, next) => {
    try {
      const result = await listMarketInsightReports(req.user.id, {
        limit: req.query.limit,
        offset: req.query.offset,
        marketplace: req.query.marketplace,
        scopeType: req.query.scopeType,
      })
      res.json(result)
    } catch (error) {
      handleMarketInsightError(error, res, next)
    }
  })

  router.post('/reports', async (req, res, next) => {
    try {
      const report = await createMarketInsightReport({
        userId: req.user.id,
        input: req.body ?? {},
      })
      res.status(201).json({ report })
    } catch (error) {
      handleMarketInsightError(error, res, next)
    }
  })

  router.get('/reports/:id', async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) throw new MarketInsightValidationError('报告 ID 无效。')
      const report = await getMarketInsightReport(req.user.id, id)
      if (!report) throw new MarketInsightNotFoundError('报告不存在。')
      res.json({ report })
    } catch (error) {
      handleMarketInsightError(error, res, next)
    }
  })

  return router
}

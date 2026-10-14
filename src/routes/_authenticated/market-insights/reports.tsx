import { createFileRoute } from '@tanstack/react-router'
import { MarketInsightReportsPage } from '@/features/market-insights/pages/reports-page'

export const Route = createFileRoute('/_authenticated/market-insights/reports')({
  component: MarketInsightReportsPage,
})

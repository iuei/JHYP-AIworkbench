import { createFileRoute } from '@tanstack/react-router'
import { MarketInsightsPage } from '@/features/market-insights/pages/market-insights-page'

export const Route = createFileRoute('/_authenticated/market-insights/')({
  component: MarketInsightsPage,
})

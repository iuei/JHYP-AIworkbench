import { createFileRoute } from '@tanstack/react-router'
import { MarketInsightsLayout } from '@/features/market-insights/pages/layout'

export const Route = createFileRoute('/_authenticated/market-insights')({
  staticData: { title: '市场洞察' },
  component: MarketInsightsLayout,
})

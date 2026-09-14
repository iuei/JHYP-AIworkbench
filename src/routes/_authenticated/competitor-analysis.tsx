import { createFileRoute } from '@tanstack/react-router'
import { CompetitorAnalysis } from '@/features/competitor-analysis'

export const Route = createFileRoute('/_authenticated/competitor-analysis')({
  staticData: { title: '竞品分析' },
  component: CompetitorAnalysis,
})

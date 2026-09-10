import { createFileRoute } from '@tanstack/react-router'
import { QuickNavigation } from '@/features/quick-navigation'

export const Route = createFileRoute('/_authenticated/quick-navigation/')({
  component: QuickNavigation,
})


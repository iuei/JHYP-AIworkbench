import { createFileRoute } from '@tanstack/react-router'
import { QuickNavigation } from '@/features/quick-navigation'

export const Route = createFileRoute('/_authenticated/quick-navigation/')({
  staticData: { title: '快捷导航' },
  component: QuickNavigation,
})


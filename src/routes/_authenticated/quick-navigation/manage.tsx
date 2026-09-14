import { createFileRoute } from '@tanstack/react-router'
import { QuickNavigationManage } from '@/features/quick-navigation/manage'

export const Route = createFileRoute(
  '/_authenticated/quick-navigation/manage'
)({
  staticData: { title: '管理快捷导航' },
  component: QuickNavigationManage,
})


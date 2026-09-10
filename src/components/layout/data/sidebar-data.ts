import {
  Command,
  Compass,
  LayoutDashboard,
  Palette,
  Settings,
  UsersRound,
} from 'lucide-react'
import { type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  user: {
    name: '内部用户',
    email: 'user@company.local',
    avatar: '/avatars/01.png',
  },
  teams: [
    {
      name: '智能工作台',
      logo: Command,
      plan: '公司内部系统',
    },
  ],
  navGroups: [
    {
      title: '常用',
      items: [
        {
          title: '仪表盘',
          url: '/',
          icon: LayoutDashboard,
        },
        {
          title: '快捷导航',
          url: '/quick-navigation',
          icon: Compass,
        },
      ],
    },
    {
      title: '其他',
      items: [
        {
          title: '设置',
          icon: Settings,
          items: [
            {
              title: '用户管理',
              url: '/settings/users',
              icon: UsersRound,
            },
            {
              title: '外观',
              url: '/settings/appearance',
              icon: Palette,
            },
          ],
        },
      ],
    },
  ],
}

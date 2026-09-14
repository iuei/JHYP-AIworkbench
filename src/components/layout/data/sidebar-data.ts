import {
  Bot,
  Command,
  Compass,
  LayoutDashboard,
  MessageSquareText,
  NotebookPen,
  Palette,
  Settings,
  ShieldCheck,
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
      name: 'JHYP 智能工作台',
      logo: Command,
      plan: '公司内部工作台',
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
        {
          title: 'AI 助手',
          icon: Bot,
          items: [
            {
              title: '对话',
              url: '/ai-agent',
              icon: MessageSquareText,
            },
            {
              title: '我的沉淀',
              url: '/ai-agent/notes',
              icon: NotebookPen,
            },
          ],
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
              adminOnly: true,
            },
            {
              title: '外观',
              url: '/settings/appearance',
              icon: Palette,
            },
            {
              // 治理面整体收缩在「设置」下面：只留一个入口，
              // 五个子页由该页顶部的横向导航承载（避免侧边栏三级菜单与导航层级分散）
              title: 'AI 治理',
              url: '/admin/ai',
              icon: ShieldCheck,
              adminOnly: true,
              matchPrefix: true,
            },
          ],
        },
      ],
    },
  ],
}

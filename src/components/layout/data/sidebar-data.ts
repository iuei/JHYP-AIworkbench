import {
  BarChart3,
  BookOpen,
  Bot,
  Command,
  GitCompareArrows,
  LayoutDashboard,
  Map,
  Megaphone,
  PackageSearch,
  ScrollText,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquareLibrary,
  TableProperties,
  Tags,
  TrendingUp,
  Upload,
  UsersRound,
} from 'lucide-react'
import { type NavChildItem, type SidebarData } from '../types'

export const sidebarData: SidebarData = {
  // 这里曾经有一份 `user: { name: '内部用户', email: 'user@company.local' }` 的**硬编码假数据**，
  // 被侧边栏底部直接渲染成"当前用户"，于是谁登录看到的都是一样的名字和邮箱。
  // 底部用户区现在由 `AppSidebar` 注入真实登录用户（`/auth/me` + 登录态兜底），
  // 静态数据里不再保留任何用户身份字段。
  teams: [
    {
      name: 'JHYP 智能工作台',
      logo: Command,
      plan: '公司内部工作台',
    },
  ],
  // 扁平的一级类目列表：侧边栏不再出现「常用 / 其他」这类分组标题，
  // 少一层包裹后每个入口都是同等权限的类目，新增入口也无需纠结"该放哪一组"。
  navItems: [
    {
      section: '工作台',
      title: '仪表盘',
      url: '/',
      icon: LayoutDashboard,
    },
    {
      // 一级类目（2026-09-16 阶段 C 由「AI 助手」子项升级）：运营每天要进的高频入口，
      // 且导入表格 / 维护清单 / 看表现都不需要 AI。路径随之规范化为 `/asin-watchlists`。
      section: '业务运营',
      title: '我的 ASIN',
      url: '/asin-watchlists',
      icon: Tags,
    },
    {
      // 既有的独立类目，此前**只在首页「常用入口」有卡片**，侧边栏一直没有它，
      // 从别的页面想再进一次只能先回首页。
      //
      // **2026-09-16 起由叶子类目改为折叠类目**：主页减负后，分析结果被拆到
      // `/competitor-analysis/results` 独立路由（用户口径：「当前竞品分析页面展示内容过于复杂…
      // 且主次不明确」）。子页没有导航入口时，从侧边栏只能进主页、再滚到结果卡上点按钮 ——
      // 而它已经是**并列的第二种读法**，不是主页的一个附属视图。
      // 竞品详情页（`/competitor-analysis/<ASIN>`）**刻意不进导航**：它是"从卡片点进去的单个竞品"，
      // 与 AI 对话里的某条会话同理，不是别人要找的目标（顶栏导航会把它算作「分析」）。
      section: '业务运营',
      title: '竞品分析',
      icon: BarChart3,
      items: [
        { title: '分析', url: '/competitor-analysis', icon: BarChart3 },
        {
          // 2026-09-16 由「数据明细」改名为「分析结果」：它现在承载一次分析的全部产出
          // （结果卡 + 结论与建议 + 全部数据块 + 口径声明），分析页只留"参数设置 + 历史"。
          title: '分析结果',
          url: '/competitor-analysis/results',
          icon: TableProperties,
        },
      ],
    },
    {
      // 市场洞察是面向运营的类目研究入口；首期复用已验证的市场调研与报告快照能力，
      // 后续产品地图、机会记录等能力在同一工作台内渐进补齐。
      section: '业务运营',
      title: '市场洞察',
      url: '/market-insights',
      icon: Map,
    },
    {
      // 与「竞品分析」相邻（同属选品/调研链路）但对象不同：竞品分析比的是**在售**商品，
      // 产品开发维护的是**上架前**的候选新品池。放在它后面，位置记忆上最省事。
      //
      // **2026-09-16 起由叶子类目改为折叠类目**：它内部本来就是三件不同的事
      // （维护候选 / 横向对比 / 类目市场研究），此前却只是**一个页面的三个页签** ——
      // 页签没有 URL，侧边栏、顶栏与命令菜单都无法表达"市场调研在哪"，
      // 而市场调研是独立成果（竞品分析页会专程跳转过来）。三个子页现在各有真实路径。
      section: '业务运营',
      title: '产品开发',
      icon: PackageSearch,
      /*
       * 2026-09-18 按用户口径标注「开发中」（原话：「任务中心板块和产品开发板块标注为开发中」）。
       * 三个子页的入口都是可用的真实功能，徽标这里表达的是**对外状态**而不是"点了是说明页"——
       * 与「任务中心」同批标注，语义口径见 `docs/modules/全局布局与导航.md`「占位类目」那条。
       */
      badge: '开发中',
      items: [
        { title: '候选池', url: '/product-dev', icon: PackageSearch },
        {
          title: '对比与历史',
          url: '/product-dev/compare',
          icon: GitCompareArrows,
        },
        { title: '市场调研', url: '/product-dev/market', icon: TrendingUp },
      ],
    },
    {
      /*
       * 2026-09-18：由折叠类目（对话 / 我的沉淀）改为**单页类目**。
       * 「我的沉淀」迁进「知识库 → 个人知识库」（它是知识资产，与对话不是一类东西），
       * 于是这里只剩一个子项 —— 一个子项的折叠类目在侧边栏只多一层没意义的展开。
       */
      section: 'AI 工作台',
      title: 'AI 助手',
      url: '/ai-agent',
      icon: Bot,
    },
    {
      // 提示词是 AI 工作台中的可复用资产，与对话和沉淀保持同一业务域。
      section: 'AI 工作台',
      title: '提示词广场',
      url: '/prompts',
      icon: SquareLibrary,
    },
    {
      /*
       * 「知识库」（2026-09-18 新增）：个人知识库（原「我的沉淀」）+ 团队知识库
       * （全员可见的知识文档，只读）。两个子页由它自己的顶栏导航承载
       * （`KnowledgeNav`），与「提示词广场」的「我的 / 共享」同一形态 ——
       * 侧边栏只留一个一级入口，避免"一级类目住在别人子项里"的旧问题。
       *
       * 管理员的上传 / 切片 / 下线 / 纠错反馈仍在「系统管理 → AI 治理 → 知识库」，
       * 本入口只承载使用面。
       */
      section: 'AI 工作台',
      title: '知识库',
      url: '/knowledge',
      icon: BookOpen,
    },
    /*
     * 「系统管理」这一组（2026-09-16 阶段 D：原名「设置」；2026-09-18 去掉同名折叠项）。
     *
     * **为什么三个入口直接平铺、不再套一个折叠类目**：此前分组标签（`section`）叫
     * 「系统管理」，它下面唯一的折叠类目 `title` 也叫「系统管理」—— 侧边栏上同一个词
     * 连着出现两次（小字分组 + 可点类目），用户口径「现在不需要这个一级类目为系统管理了」。
     * 现在分组名保留「系统管理」作为归类，三个治理入口各自成为一级入口：
     * AI 治理 / 用户管理 / 公告管理。代价是面包屑不再有中间那一层
     * （`/admin/users` 由三级变两级），这是有意的取舍。
     *
     * **权限**：三项逐个带 `adminOnly`（分组标签本身不参与角色过滤，但三项全被过滤掉后
     * 侧边栏不会留下一个空的「系统管理」标题 —— 见 `NavGroup` 的 `showSection` 与
     * `filterNavItemsByRole`）。服务端每个接口另有 `requireAdmin` 兜底，前端过滤只解决"看得见"。
     *
     * 2026-09-15 删除「显示」「通知」两个子项：两页是模板遗留的纯演示表单
     * （显示页是"最近/首页/应用/桌面"复选框、通知页是邮件开关组，提交只走 showSubmittedData，
     * 既无接口也无数据），实用性为零，路由与页面一并删除。
     */
    {
      // 治理面（数据源与导入 / 经验审核 / 模型与配置 / 审计台）的入口。
      // 四个子页由该页顶部的横向导航承载（`adminAiNavItems` + `AdminAiNav`），
      // 侧边栏不再往下长三级菜单；`matchPrefix` 让子页下这一项保持高亮。
      // 知识库治理 2026-09-18 起不在这里：它并入「AI 工作台 → 知识库 → 团队知识库」的管理视图。
      section: '系统管理',
      title: 'AI 治理',
      url: '/admin/ai',
      icon: ShieldCheck,
      adminOnly: true,
      matchPrefix: true,
    },
    {
      section: '系统管理',
      title: '用户管理',
      url: '/admin/users',
      icon: UsersRound,
      adminOnly: true,
    },
    {
      // 公告是面向全公司的广播：管理员在这里发布，员工在**登录后**看到弹窗
      // （见 src/features/announcements）。员工侧没有独立页面可看，
      // 因此它只是管理入口、不做成一类。
      section: '系统管理',
      title: '公告管理',
      url: '/admin/announcements',
      icon: Megaphone,
      adminOnly: true,
    },
  ],
}

/**
 * 「AI 治理」内部的治理子页（管理员专属）。
 *
 * **为什么放在数据层而不是组件里（2026-09-16）**：导航层级只到二级 ——
 * 「AI 治理」本身已是侧边栏的一级入口（2026-09-18 前它是「系统管理」折叠类目下的二级项），
 * 它的子页不再进侧边栏，改由顶栏中段导航承载（`features/ai-agent/components/admin-ai-nav.tsx`）。
 * 这份清单原先写在那个组件内部，与 `navItems` 分成两处维护；
 * 收进这里之后，顶栏导航与全局命令菜单取同一份数据，不会再出现"加了子页只改了一边"。
 *
 * **2026-09-18 去掉「知识库」**（用户口径：「知识库已经迁移到 AI 工作台下，AI 治理子页面
 * 不应该保留知识库」）：知识库使用面已是侧边栏一级入口 `/knowledge`，治理动作并入它的
 * 「团队知识库」子页（管理员看到的是管理视图，员工仍只读，见 `pages/knowledge-base.tsx`）。
 * 这里留着的四项都是**与知识库无关**的治理面；旧链接 `/admin/ai/knowledge` 仍可跳转。
 */
export const adminAiNavItems: NavChildItem[] = [
  { title: '数据源与导入', url: '/admin/ai/datasources', icon: Upload },
  { title: '经验审核', url: '/admin/ai/distill', icon: Sparkles },
  { title: '模型与配置', url: '/admin/ai/settings', icon: Settings2 },
  { title: '审计台', url: '/admin/ai/audit', icon: ScrollText },
]

# 快捷导航设计规格

## 目标

在现有智能工作台中新增快捷导航模块，将 `E:\codex\index.html` 的静态导航数据迁移到 PostgreSQL。所有已登录用户可浏览和搜索，只有数据库中实时状态为 `enabled` 的 `admin` 可管理分类、导航项和标签。

## 页面结构

- 浏览路由：`/_authenticated/quick-navigation`，用户路径 `/quick-navigation`。
- 管理路由：`/_authenticated/quick-navigation/manage`，用户路径 `/quick-navigation/manage`。
- 侧边栏“常用”分组增加“快捷导航”入口。
- 浏览页复用 `Header`、`Main`、`ThemeSwitch`、`ProfileDropdown`。
- 顶部栏承载唯一页面标题；主内容直接从搜索框开始，之后是常用入口、分类标题分隔线和导航卡片网格。
- 卡片在小屏单列、中屏双列、宽屏四列；列表仅展示名称、单行说明和外链图标，标签不直接展示但仍参与搜索。
- 搜索匹配分类名、导航名称、说明和标签，匹配文本高亮，无结果时展示明确空状态。
- 管理员显示“管理导航”按钮；普通用户不渲染管理入口。

## 视觉规范

- 信息层级采用低饱和石板风格、轻边框、弱阴影、分类分隔线和短时交互反馈；优先保证首屏密度，不展示重复介绍和装饰性英文标题。
- 颜色只使用项目已有 `background`、`foreground`、`card`、`muted`、`primary`、`border` 等主题变量。
- 圆角使用项目 `rounded-*` token，控件复用 shadcn/ui，图标使用 `lucide-react`。
- 暗色模式、键盘焦点、响应式布局和外链安全属性必须完整支持。
- 标签由统一组件渲染，不允许数据记录携带任意颜色类名。

## 管理交互

- 管理页包含“分类”“导航项”“标签”三个选项卡。
- 分类支持新增、重命名、排序和删除；存在分类导航项时服务端返回冲突，不级联误删。
- 导航项支持新增、编辑、删除、设置展示位置和排序。`featured` 为顶部链接，不属于分类；`category` 必须选择分类。
- 标签支持新增、重命名和删除；删除标签时只解除导航关联，不删除导航项。
- 导航项编辑表单支持多选标签，并保存标签展示顺序。
- 删除操作使用 `ConfirmDialog` 二次确认；写操作成功后刷新 React Query 缓存并显示 toast。
- 普通用户直接访问管理路由时展示无权限状态；服务端对每个写接口再次实时校验管理员身份。

## 数据模型

### navigation_categories

- `id SERIAL PRIMARY KEY`
- `name VARCHAR(80) UNIQUE NOT NULL`
- `sort_order INTEGER NOT NULL DEFAULT 0`
- `created_at`、`updated_at TIMESTAMPTZ`

### navigation_items

- `id SERIAL PRIMARY KEY`
- `category_id INTEGER NULL REFERENCES navigation_categories(id)`
- `name VARCHAR(120) NOT NULL`
- `url TEXT NOT NULL`
- `description VARCHAR(300) NOT NULL DEFAULT ''`
- `placement VARCHAR(20) NOT NULL CHECK (placement IN ('featured', 'category'))`
- `sort_order INTEGER NOT NULL DEFAULT 0`
- `created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL`
- `created_at`、`updated_at TIMESTAMPTZ`
- 约束：`category` 必须有 `category_id`；`featured` 必须没有 `category_id`。

### navigation_tags

- `id SERIAL PRIMARY KEY`
- `name VARCHAR(40) UNIQUE NOT NULL`
- `created_at`、`updated_at TIMESTAMPTZ`

### navigation_item_tags

- `item_id INTEGER REFERENCES navigation_items(id) ON DELETE CASCADE`
- `tag_id INTEGER REFERENCES navigation_tags(id) ON DELETE CASCADE`
- `sort_order INTEGER NOT NULL DEFAULT 0`
- 复合主键：`item_id, tag_id`

## API 契约

- `GET /api/quick-navigation`：登录用户读取 `{ featuredItems, categories, tags }`，分类内嵌排序后的导航项及标签。
- `POST /api/navigation-categories`：管理员新增分类。
- `PATCH /api/navigation-categories/:id`：管理员修改名称和排序。
- `DELETE /api/navigation-categories/:id`：管理员删除空分类。
- `POST /api/navigation-items`：管理员新增导航项和标签关联。
- `PATCH /api/navigation-items/:id`：管理员更新导航项并在事务内替换标签关联。
- `DELETE /api/navigation-items/:id`：管理员删除导航项。
- `POST /api/navigation-tags`：管理员新增标签。
- `PATCH /api/navigation-tags/:id`：管理员重命名标签。
- `DELETE /api/navigation-tags/:id`：管理员删除标签并自动解除关联。

所有写入字段在服务端校验：去除首尾空白、限制长度、`http/https` URL、非负整数排序、合法展示位置、有效分类和标签 ID。不存在返回 404，冲突返回 409，校验失败返回 400，无权限返回 403。

## 初始化数据

- 将参考页 3 个顶部链接导入为 `featured` 导航项。
- 将参考页 6 个分类及其全部导航项导入为 `category` 导航项。
- 将参考页逗号和中文逗号分隔的标签拆为独立标签，去除空白并复用同名标签。
- 使用 `schema_migrations` 记录版本；API 启动和 `pnpm run db:setup` 共用同一事务化迁移入口。
- 初始化数据逐条使用 `ON CONFLICT`/存在性判断进行非破坏写入，重复启动不产生重复数据或覆盖管理员修改。

## 测试与验收

- Node 单元测试覆盖请求解析、URL 校验、展示位置约束和标签 ID 去重。
- React 测试覆盖搜索过滤、多个标签渲染、管理员入口和普通用户权限状态。
- 手动/API 验证覆盖分类、导航项和标签的增删改查及权限拒绝。
- 运行 `pnpm run test`、`pnpm run lint`、`pnpm run build`。
- 对比仪表盘、设置页和参考页检查主题、暗色模式、间距、圆角、图标和响应式一致性。

## 边界

- 不增加公开访问，不增加细粒度权限角色，不记录点击统计。
- 不支持拖拽排序；通过整数排序字段维护顺序。
- 不迁移或改造现有仪表盘 `shortcut_preferences`，避免改变既有业务含义。

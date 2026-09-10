# 责任田：服务端 API 与开发启动

## 功能描述

提供本地 API 服务，并协调 API 与 Vite 前端的开发启动方式。

## 功能清单

- API 服务：在默认 `8787` 端口提供认证、用户、仪表盘和竞品分析接口。
- 静态站点托管：非开发模式下在 `5173` 端口托管 `dist` 目录。
- 联合开发：`pnpm run dev:all` 启动 API 与 Vite，API 进程不再占用前端端口。

## 入口与出口

- 入口：`server/index.mjs`、`server/dev.mjs` 和 `package.json` 脚本。
- 出口：REST API、生产静态站点与本地开发进程。

## API 明细

- `POST /api/auth/login`：账号登录。
- `GET /api/auth/me`：获取当前用户。
- `GET /api/users`：获取用户列表。
- `GET /api/dashboard`：获取仪表盘数据。
- `POST /api/competitor-analyses`：创建竞品分析记录。
- `GET /api/quick-navigation`：读取快捷导航聚合数据。
- `/api/navigation-categories`：管理员分类 CRUD。
- `/api/navigation-items`：管理员导航项 CRUD。
- `/api/navigation-tags`：管理员标签 CRUD。

## 依赖关系

- 依赖：Express、PostgreSQL 查询封装、环境变量和前端 Vite 服务。
- 被依赖：前端通过 `VITE_API_BASE_URL` 访问 API。
- 共享字段：JWT 用户身份、用户、工作项、快捷方式和竞品分析数据。

## 影响范围

修改启动逻辑会影响本地 API 与前端的端口协作；不得改变 API 路径、鉴权逻辑或数据库结构。

## 修改边界

- 可以改：服务启动参数、端口协调、静态资源托管开关。
- 绝对不能改：API 契约、权限规则、数据库 schema，除非需求明确要求。

## 注意事项

- `SERVE_STATIC=false` 仅用于联合开发，避免与 Vite 争用 `5173`。
- 未设置该变量时，保留原有的生产静态站点托管行为。
- 未设置 `CORS_ORIGIN` 时，本地开发同时允许 `localhost:5173` 与 `127.0.0.1:5173`；如需限制来源，可通过逗号分隔的环境变量显式配置。
- Windows 本地依赖使用 pnpm `hoisted` 布局，避免原生构建依赖在虚拟仓库导入阶段发生目录重命名冲突。
- API 启动前自动应用 `schema_migrations` 中尚未登记的快捷导航迁移；迁移失败时不监听端口。
- 所有认证接口会实时检查用户是否仍存在且处于启用状态，停用账号的旧 JWT 不再继续生效。

## 约束

- 验证要求：`pnpm run lint`、`pnpm run build`，并验证 `5173` 前端与 `8787/api` 可访问。

## 历史变更

| 日期 | 变更内容 | 修改人 / AI |
| --- | --- | --- |
| 2026-07-17 | 建立服务端 API 与开发启动责任田；开发模式禁用静态站点监听以避免端口冲突。 | AI |
| 2026-07-17 | 本地开发默认允许 `localhost` 与 `127.0.0.1` 前端来源，修复跨域登录失败。 | AI |
| 2026-08-13 | 清理未使用依赖，并固定 pnpm `hoisted` 安装布局以兼容 Windows 原生构建依赖。 | AI |
| 2026-08-29 | 新增快捷导航数据库表、初始化数据、读取接口和管理员 CRUD API。 | AI |
| 2026-08-29 | 快捷导航数据库升级改为版本化启动迁移，并为认证请求增加实时账号状态校验。 | AI |

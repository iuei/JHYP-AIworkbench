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
- `GET /api/auth/me`：获取当前用户（`id / login / name / role / department`），只读，不接受写入。
- `GET /api/users`：获取用户列表（含 `department`）。
- `POST /api/users`：管理员开通账号（账号、姓名、初始密码、角色、部门）。
- `PATCH /api/users/:id`：管理员修改姓名、角色、部门（部门用 `COALESCE` 保留原值）。
- `GET /api/dashboard`：获取仪表盘数据。
- `POST /api/competitor-analyses`：创建竞品分析记录。
- `GET /api/quick-navigation`：读取快捷导航聚合数据。
- `/api/navigation-categories`：管理员分类 CRUD。
- `/api/navigation-items`：管理员导航项 CRUD。
- `/api/navigation-tags`：管理员标签 CRUD。
- `/api/ai/*`：AI 助手模块（对话 SSE、会话与反馈、知识库管理、审计台、用量与配置），由 `server/ai-agent/router.mjs` 挂载，详见 `docs/modules/AI 助手.md`。

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
- API 启动前同时应用 AI 助手迁移（`server/ai-agent/migrations.mjs`，版本号从 **100** 起，因为 `schema_migrations.version = 1` 已被快捷导航占用；`CREATE EXTENSION vector` 与 `pg_trgm` 也在该批迁移内执行）。
- API 启动前应用用户表迁移（`server/user-migrations.mjs`，version 2 添加 `users.department`）；该模块自带迁移器，沿用同一 `schema_migrations` 表，新增版本号前先查库确认未被占用。
- `requireUser` 会把 `status` 一并写入 `req.user`：AI 助手模块的权限判定依赖它，漏下发会导致所有工具被误判为无权。

## 约束

- 验证要求：`pnpm run lint`、`pnpm run build`、`pnpm run test:server`（`node --test` 跑服务端测试），并验证 `5173` 前端与 `8787/api` 可访问。

## 历史变更

| 日期 | 变更内容 | 修改人 / AI |
| --- | --- | --- |
| 2026-07-17 | 建立服务端 API 与开发启动责任田；开发模式禁用静态站点监听以避免端口冲突。 | AI |
| 2026-07-17 | 本地开发默认允许 `localhost` 与 `127.0.0.1` 前端来源，修复跨域登录失败。 | AI |
| 2026-08-13 | 清理未使用依赖，并固定 pnpm `hoisted` 安装布局以兼容 Windows 原生构建依赖。 | AI |
| 2026-08-29 | 新增快捷导航数据库表、初始化数据、读取接口和管理员 CRUD API。 | AI |
| 2026-08-29 | 快捷导航数据库升级改为版本化启动迁移，并为认证请求增加实时账号状态校验。 | AI |
| 2026-09-10 | 启动日志名称统一为「JHYP 智能工作台」，与前端品牌名保持一致；数据库名 `jhyp_workbench` 保持不变。 | AI |
| 2026-09-10 | 挂载 `/api/ai/*`；启动与 `db:setup` 时应用 AI 助手迁移（version 100/101）；`requireUser` 补下发 `status`；新增 `test:server` 脚本。 | AI |
| 2026-09-11 | 新增用户表迁移模块（version 2 添加 `users.department`）并接入启动与 `db:setup`；认证与用户接口统一下发 `department`，开通与编辑接口接受该字段。 | AI |

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
- `POST /api/competitor-analyses`：创建竞品分析记录。落库后会按处置台账**核验**用户上次标记的「我已处理」
  （不再命中 → 已核验解决；仍命中 → 打回），核验结果随响应里的结论一起返回。
- `GET /api/competitor-analyses`：历史分析摘要列表，含**未销账口径** `openLevel` / `openFindingCount`
  （首页「需处理的分析」与概览统计用它；与快照口径的 `level` / `findingCount` 不是一回事）。
- `GET /api/competitor-analyses/:id`：单条分析快照，结论上带当前处置状态；越权与不存在一律 404。
- `PUT /api/competitor-analyses/:id/findings/disposition`：标记一条结论的处置状态
  （`claimed` = 我已处理（待核验）／`ignored` = 不处理且**必填原因**）。`code` + `target`
  必须属于该次分析（老记录回退到从快照现算），否则 400；`verified` / `open` 只能由核验产生。
- `DELETE /api/competitor-analyses/:id/findings/disposition?code=&target=`：撤销自己的标记（删行）。
  处置闭环的完整口径见 `docs/modules/竞品分析.md` 的「结论的处置闭环：销账 + 自动核验」。
- ~~`GET /api/quick-navigation` 与 `/api/navigation-{categories,items,tags}`~~：**已于 2026-09-15 随快捷导航模块整体删除**（连 4 张 `navigation_*` 表一起 DROP），不再存在这些路由。
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
- API 启动前依次应用各模块迁移（用户表 → 竞品分析 → AI 助手），迁移失败时不监听端口。**快捷导航迁移已于 2026-09-15 删除**，`schema_migrations.version = 1` 随之空出（每个模块的迁移器都自带 `CREATE TABLE IF NOT EXISTS schema_migrations`，删掉它不影响其他模块启动）。
- 所有认证接口会实时检查用户是否仍存在且处于启用状态，停用账号的旧 JWT 不再继续生效。
- API 启动前同时应用 AI 助手迁移（`server/ai-agent/migrations.mjs`，版本号从 **100** 起——当年是为了避开快捷导航占用的 1 号段，快捷导航已删除但号段保持不变，避免与已落库的 100+ 记录错位；`CREATE EXTENSION vector` 与 `pg_trgm` 也在该批迁移内执行）。
- API 启动前应用用户表迁移（`server/user-migrations.mjs`，version 2 添加 `users.department`）；该模块自带迁移器，沿用同一 `schema_migrations` 表，新增版本号前先查库确认未被占用。
- `requireUser` 会把 `status` 一并写入 `req.user`：AI 助手模块的权限判定依赖它，漏下发会导致所有工具被误判为无权。
- **连接池与超时（勿删）**：`server/db.mjs` 显式设置 `max`（默认 20）、`statement_timeout`（15s）、`query_timeout`（20s）与连接/空闲超时，均可用 `PG_POOL_MAX` / `PG_STATEMENT_TIMEOUT_MS` / `PG_QUERY_TIMEOUT_MS` / `PG_CONNECT_TIMEOUT_MS` / `PG_IDLE_TIMEOUT_MS` 覆盖。pg 默认 `max=10` 且**没有任何超时**：一次慢查询在上层 `Promise.race` 超时后连接不会释放，约 10 个并发问答就能占满连接池，此后所有接口永久排队（整站挂死，日志里还看不到错误）。
- **统一错误出口**：所有路由之后注册了 JSON 错误中间件（`server/index.mjs` 末尾）。未捕获异常返回 `{ message: '服务器内部错误，请稍后重试。' }`，堆栈只写服务端日志 —— 前端所有接口都按 JSON 解析错误体，返回 Express 默认 HTML 会让错误原因丢失，非 production 下还会把堆栈（含绝对路径与 SQL 片段）回给客户端。
- **DATE 列按字符串回传**：`pg.types.setTypeParser(1082, v => v)` 让 DATE 返回 `'YYYY-MM-DD'`。pg 默认会把它解析成**本地时区午夜**的 Date，再经 `toISOString()` 就整体前移一天（东八区必现），曾导致按区间取数丢掉第一天。
- **真实 IP 与代理**：默认**不信任** `X-Forwarded-For`（审计 IP 取直连地址，该请求头客户端可随意伪造）；部署在反向代理之后时设 `TRUST_PROXY=true`，届时采信转发头并取链尾一跳。
- **用户迁移 3 新增 `users.token_version`**：JWT 里带 `ver` 声明，`requireUser` 与 AI 模块的 `identityGuard` 都比对，重置密码时 `+1` → 旧 token 立即失效。**这两处守卫必须同时改**：AI 路由挂在独立 router 上、不共用 `requireUser`，漏一处旧 token 仍能访问 `/api/ai/*`。
- **`test:server` 的覆盖范围**：脚本显式列出 `server/*.node-test.mjs`、`server/ai-agent/*.node-test.mjs`、`server/ai-agent/providers/*.node-test.mjs`。**新增子目录测试时必须同步加进去** —— 此前 `providers/` 被漏掉，那 24 项 provider 测试长期没有执行过。
- **批量写入**：数据集导入按 500 行、文档切片按 200 片分批 `INSERT`（`datasets.mjs` / `knowledge.mjs`）。不要退回逐行 `client.query` —— 那是"一行一次往返"，且全程占着同一事务与连接。
- **局域网访问开发服务（2026-09-14 起）**：`vite.config.ts` 设了 `server.host: true` 与 `/api` 代理，并新增 `.env.development`（`VITE_API_BASE_URL=/api`）；内网机器访问 `http://<本机内网IP>:5173` 即可（Vite 启动日志会打印 `Network:` 行）。
  - **为什么用相对路径 + 代理**：浏览器侧变成同源请求，不必把每个访问来源加进 `CORS_ORIGIN` 白名单（白名单不含来源时预检会直接失败），换网络/IP 也不用改配置；代理是服务端行为，所以内网访问时后端仍然可达。改回绝对地址会同时踩到"跨域"和"内网机器请求打到它自己的 localhost"两个坑。
  - `.env.development` **只在 dev 模式加载**，`pnpm run build` 的产物仍用 `.env` 的绝对地址 —— 生产部署若静态站点与 API 不同端口，需要在网关层做同样的 `/api` 转发，或把 `VITE_API_BASE_URL` 指向后端绝对地址。
  - 注意 Vite 默认只绑回环，去掉 `server.host` 后内网访问会直接 `ERR_CONNECTION_REFUSED`。
- **macOS 本机常驻运行（2026-10-14 起）**：新增 `deploy/macos-service.sh` 与三个 launchd 配置
  （`deploy/com.jhyp.{api,web,logrotate}.plist`）、`deploy/rotate-logs.sh`，把手动
  `nohup pnpm run dev:all` 换成 launchd 常驻：`RunAtLoad` 登录自启、`KeepAlive` 崩溃自动重启、
  日志落 `logs/{api,web}.log` 并由每日 04:00 的任务轮转（超 10MB 才切，保留 7 份）。
  - **API 与 Vite 必须是两个独立 Label**：`server/dev.mjs` 只负责把两个子进程拉起来，
    子进程死掉时它自己不退出，`KeepAlive` 便永远不触发；拆开才能各自自愈。
  - **API 的 plist 必须带 `SERVE_STATIC=false`**，否则 `index.mjs` 会在 5173 再起一个静态站与 Vite 抢端口。
  - **内网访问仍依赖 dev 模式**：`dist` 产物把 `VITE_API_BASE_URL` 写死成 `.env` 的
    `http://localhost:8787/api`，直接托管会让内网用户的请求打到自己的 localhost。
  - 早期用 `launchctl submit` 提交的 `jhyp-dev-all`（日志在 `/tmp`）由 `install` 自动移除，
    否则它的 Vite 会漂移到 5174 空转。
  - 脚本取内网 IP 走 `route -n get default` 而非写死 `en0`：本机 IPv4 实际挂在 `en1`。

## 约束

- 验证要求：`pnpm run lint`、`pnpm run build`、`pnpm run test:server`（`node --test` 跑服务端测试），并验证 `5173` 前端与 `8787/api` 可访问。

## 历史变更

| 日期 | 变更内容 | 修改人 / AI |
| --- | --- | --- |
| 2026-10-14 | **新增 macOS launchd 常驻运行方案**（`deploy/macos-service.sh`、`deploy/com.jhyp.{api,web,logrotate}.plist`、`deploy/rotate-logs.sh`，配套 `docs/部署与运维.md` 第 15 节）：取代手工 `nohup pnpm run dev:all`，实现登录自启 + 崩溃自动重启 + 日志落 `logs/` 并每日轮转。API 与 Vite 拆成两个 Label 各自自愈（`dev.mjs` 在子进程死掉时自己不退出，`KeepAlive` 不触发）；API 侧固定 `SERVE_STATIC=false` 避免抢 5173。同时移除历史遗留的 `launchctl submit` 服务 `jhyp-dev-all`（其 Vite 曾漂移到 5174 空转，API 子进程因端口被占静默退出）。实测 `kill -9` 前后端均能自动恢复。未改任何 API 契约、权限规则与数据库结构。 | AI |
| 2026-09-17 | **竞品分析新增 4 个结论处置接口，`POST` 落库后多一步台账核验**（配套 `docs/modules/竞品分析.md` 的「结论的处置闭环」）：`GET /api/competitor-analyses` 增加未销账口径字段 `openLevel`/`openFindingCount`；`GET /:id` 的快照结论带当前处置状态；新增 `PUT /:id/findings/disposition`（`claimed` / `ignored`，`ignored` 必填原因，`code`+`target` 必须属于该次分析否则 400）与 `DELETE /:id/findings/disposition`（撤销即删行）。四个路由与既有三个竞品路由一样**内联在 `server/index.mjs`**，业务逻辑在新增的 `server/finding-dispositions.mjs`（纯函数 + SQL，单测 16 项）；任务中心执行器（`task-center-runner.mjs`）落库后同样调核验。迁移 **202** 新增 `competitor_analyses.finding_keys` 列与 `competitor_finding_dispositions` 表。 | AI |
| 2026-07-17 | 建立服务端 API 与开发启动责任田；开发模式禁用静态站点监听以避免端口冲突。 | AI |
| 2026-07-17 | 本地开发默认允许 `localhost` 与 `127.0.0.1` 前端来源，修复跨域登录失败。 | AI |
| 2026-08-13 | 清理未使用依赖，并固定 pnpm `hoisted` 安装布局以兼容 Windows 原生构建依赖。 | AI |
| 2026-08-29 | 新增快捷导航数据库表、初始化数据、读取接口和管理员 CRUD API。 | AI |
| 2026-08-29 | 快捷导航数据库升级改为版本化启动迁移，并为认证请求增加实时账号状态校验。 | AI |
| 2026-09-15 | **删除快捷导航服务端**：`server/quick-navigation.mjs`、`server/navigation-migrations.mjs` 及其两个 node-test 文件删除；`server/index.mjs` 移除 `runNavigationMigrations` 导入/调用、`quick-navigation.mjs` 的 6 个导入、4 个 navigation 辅助函数（`handleNavigationError` / `loadQuickNavigation` / `validateNavigationReferences` / `replaceNavigationItemTags`）与整段路由（`/api/quick-navigation` + `/api/navigation-{categories,items,tags}`，原 451–688 行）；`server/setup.mjs` 同步去掉迁移调用。**数据库**：`DROP TABLE navigation_item_tags, navigation_items, navigation_tags, navigation_categories CASCADE` 并清掉 `schema_migrations` 的 version 1 记录（删除前导出 6 分类 / 16 项 / 22 标签 / 25 关联到 `/tmp/quick-navigation-backup.json`）。实测重启后 `GET /api/quick-navigation` → 404、`/api/ai/tools` → 401（鉴权正常）、`npm run test:server` 423/423。 | AI |
| 2026-09-10 | 启动日志名称统一为「JHYP 智能工作台」，与前端品牌名保持一致；数据库名 `jhyp_workbench` 保持不变。 | AI |
| 2026-09-10 | 挂载 `/api/ai/*`；启动与 `db:setup` 时应用 AI 助手迁移（version 100/101）；`requireUser` 补下发 `status`；新增 `test:server` 脚本。 | AI |
| 2026-09-11 | 新增用户表迁移模块（version 2 添加 `users.department`）并接入启动与 `db:setup`；认证与用户接口统一下发 `department`，开通与编辑接口接受该字段。 | AI |

# JHYP 智能工作台

公司内部使用的智能工作台，工程标识 `jhyp-ai-workbench`，英文目录名 `JHYP-AIworkbench`。

前端基于 Vite + React 19 + TypeScript + TanStack Router + TanStack Query + shadcn/ui + Tailwind CSS v4；后端为 Node.js + Express + PostgreSQL（含 pgvector 向量检索），并非纯前端项目。

> **上游基线**：本项目基于开源项目 [shadcn-admin](https://github.com/satnaing/shadcn-admin)（MIT License，Copyright (c) 2024 Sat Naing）二次开发，[LICENSE](LICENSE) 沿用上游。

## 功能范围

| 模块           | 能力                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| 认证           | 登录、注册、忘记密码与 OTP，真实 JWT 鉴权与令牌吊销                                                          |
| 全局布局与导航 | 侧边栏、顶部导航、面包屑、页签、命令搜索、主题与布局配置                                                     |
| 仪表盘         | 概览统计与最近分析入口                                                                                       |
| AI 助手        | 多轮会话与 SSE 流式回答、提示词广场、知识库检索、数据源管理、蒸馏、笔记空间、运行审计台、模型与 MCP 工具配置 |
| 竞品分析       | ASIN 竞品对比、产品明细、历史快照与销账                                                                      |
| 市场洞察       | 类目检索与市场结构分析、市场报告快照保存与回看                                                               |
| 产品开发       | 候选新品池、方案对比、市场调研                                                                               |
| ASIN 清单      | 自有 ASIN 清单维护、批量导入、指标覆写                                                                       |
| 公告           | 后台发布、登录弹窗触达                                                                                       |
| 用户管理       | 用户增删改查、角色与状态管理                                                                                 |
| 设置中心       | 账户信息与个人资料                                                                                           |
| 错误页         | 401 / 403 / 404 / 500 / 503                                                                                  |

各模块的职责边界、影响范围与历史变更见 [`docs/modules/`](docs/modules/README.md)。

## 技术栈

- **前端**：Vite 8、React 19、TypeScript、TanStack Router（文件路由）、TanStack Query、TanStack Table、shadcn/ui（Radix）、Tailwind CSS v4、Zustand、React Hook Form + Zod、Recharts、react-markdown
- **后端**：Node.js 20、Express 5、PostgreSQL（`pg`）、JWT（`jsonwebtoken`）+ `bcryptjs`、SSE 流式响应、Excel 读写（`read-excel-file` / `write-excel-file`）
- **数据库**：PostgreSQL 14 及以上，依赖 `vector`（pgvector）与 `pg_trgm` 扩展

## 环境要求

- Node.js 20+
- pnpm 11（`packageManager` 已固定为 `pnpm@11.11.0`）
- PostgreSQL 14+（本机实例或云 RDS 均可）

## 本地开发

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量：按注释填写 PG 连接信息与 JWT_SECRET
cp .env.example .env

# 3. 初始化数据库：自动建库、建表并执行全部迁移
pnpm run db:setup

# 4. 启动后端（8787）与前端（5173）
pnpm run dev:all
```

浏览器打开 <http://localhost:5173>。

开发模式下 [.env.development](.env.development) 将前端 API 基址设为同源 `/api`，由 [vite.config.ts](vite.config.ts) 代理转发到后端，浏览器侧不存在跨域，因此局域网内其他机器访问 `http://<内网IP>:5173` 同样可用，无需维护 CORS 白名单。

> 也可分开启动：`pnpm run server`（仅后端）、`pnpm run dev`（仅前端）。

## 常用命令

| 命令                   | 说明                                   |
| ---------------------- | -------------------------------------- |
| `pnpm run dev:all`     | 同时启动后端与前端，本地开发推荐       |
| `pnpm run dev`         | 仅启动前端 Vite                        |
| `pnpm run server`      | 仅启动后端 API                         |
| `pnpm run db:setup`    | 建库、建表并执行迁移                   |
| `pnpm run build`       | 类型检查 + 生产构建                    |
| `pnpm run lint`        | ESLint 检查                            |
| `pnpm run test`        | 前端组件测试（Vitest + 无头 Chromium） |
| `pnpm run test:server` | 服务端 Node 测试                       |
| `pnpm run format`      | Prettier 格式化                        |

首次运行前端测试前需安装测试浏览器：`pnpm run test:browser:install`。

## 部署

上线与运维步骤见 [`docs/部署与运维.md`](docs/部署与运维.md)，配套产物在 [`deploy/`](deploy) 目录：

- `nginx.conf`：站点入口与 `/api` 反向代理（SSE 流式需关闭缓冲）
- `jhyp.service`：后端 systemd 常驻服务
- `deploy.sh` / `backup.sh` / `rotate-logs.sh`：一键更新、数据库备份与日志轮转
- `macos-service.sh`：macOS 本机常驻运行（launchd）

## 目录结构

```
src/routes/            TanStack Router 文件路由，只做路由定义与页面装配
src/features/          业务模块主体（页面、组件、数据、schema）
src/components/ui/     shadcn/ui 基础组件，不承载业务逻辑
src/components/layout/ 全局布局、侧边栏、顶部导航
src/context/           主题、字体、方向、搜索、布局等全局 Context
src/hooks/             跨模块复用 Hook
src/lib/               通用工具与错误处理
src/stores/            Zustand 全局状态
src/styles/            全局样式与主题变量
server/                后端 API、数据库迁移与服务端测试
server/ai-agent/       AI 助手后端（会话、检索、工具编排、审计）
deploy/                部署脚本与 Nginx / systemd / launchd 配置
docs/modules/          模块责任田文档
```

## 开发约定

- 包管理器统一使用 pnpm。
- 路由使用 TanStack Router 文件路由，路由文件不承载复杂 UI。
- 业务页面放在 `src/features/`，基础 UI 复用 `src/components/ui/`，不重复实现基础交互控件。
- 修改任何模块前先阅读 [`docs/modules/`](docs/modules/README.md) 对应责任田文档，修改完成后同步更新其影响范围与历史变更。
- 提交前通过 `pnpm run lint`、`pnpm run build` 与受影响模块的测试。
- 完整开发规范见 [`DEVELOPMENT_GUIDE.md`](DEVELOPMENT_GUIDE.md)，AI 协作规则见 [`AGENTS.md`](AGENTS.md)，历史变更见 [`CHANGELOG.md`](CHANGELOG.md)。

# JHYP 智能工作台

公司内部使用的智能工作台前端项目，基于 Vite、React 19、TypeScript、TanStack Router、TanStack Query、shadcn/ui 和 Tailwind CSS v4 构建。

## 功能范围

- 内部登录入口
- 登录后全局布局、侧边栏和顶部导航
- 仪表盘基础入口
- 账户与个人资料设置
- 外观主题设置
- 错误页与基础反馈组件

## 技术栈

- Vite
- React 19
- TypeScript
- TanStack Router
- TanStack Query
- shadcn/ui
- Tailwind CSS v4
- Zustand
- React Hook Form
- Zod

## 本地开发

```bash
pnpm install
pnpm run dev
```

## 常用命令

```bash
pnpm run lint
pnpm run build
pnpm run test
```

## 开发约定

- 包管理器统一使用 pnpm。
- 路由使用 TanStack Router 文件路由。
- 业务页面放在 `src/features/`。
- 基础 UI 复用 `src/components/ui/`。
- 修改模块前先阅读 `docs/modules/` 对应责任田文档。
- 当前认证仍为前端演示状态，接入真实鉴权前不得将 mock token 视为有效权限。

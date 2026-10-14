# 责任田目录说明

`docs/modules/` 用来记录每个页面、模块或横向能力的职责边界。后续改代码前先读对应责任田，改完后同步更新责任田。

## 使用规则

- 新增模块前，先复制 `责任田模板.md` 建立模块责任田。
- 修改已有模块前，先阅读对应责任田，确认可以改什么、不能动什么。
- 修改完成后，更新责任田中的影响范围、修改边界和历史变更。
- 一个责任田只描述一个清晰模块或横向能力，避免把多个业务流程混在同一份文档中。

## 当前责任田

| 文档 | 对应范围 |
| --- | --- |
| `全局布局与导航.md` | `src/components/layout/`、全局导航、认证布局壳 |
| `表格与列表规范.md` | `src/components/data-table.tsx`、`src/components/table-pagination.tsx`、`src/lib/table-styles.ts`、全站表格与列表分页口径 |
| `仪表盘.md` | `src/features/dashboard/`、`src/routes/_authenticated/index.tsx` |
| `认证模块.md` | `src/features/auth/`、`src/routes/(auth)/`、认证状态 |
| `设置中心.md` | `src/features/settings/`、`src/routes/_authenticated/settings/` |
| `用户管理.md` | `src/features/settings/users/`、`/api/users` |
| `公告.md` | `src/features/announcements/`、`server/announcements*.mjs`、`/api/announcements`、`/admin/announcements`（2026-09-16 阶段 D 由 `/settings/announcements` 迁入）、登录公告弹窗 |
| `错误页.md` | `src/features/errors/`、`src/routes/(errors)/` |
| `AI 助手.md` | `src/features/ai-agent/`、`server/ai-agent/`、`/admin/ai/*` |
| `ASIN 清单.md` | `src/features/asin-watchlist/`、`server/ai-agent/asin-watchlists.mjs` |
| `竞品分析.md` | `src/features/competitor-analysis/`、`server/competitor-analysis.mjs` |
| `产品开发.md` | `src/features/product-dev/`、`server/product-dev*.mjs`、`/product-dev` |
| `市场洞察.md` | 计划中的 `src/features/market-insights/`、市场报告快照 API、产品地图与类目洞察能力 |

> 「任务中心」责任田已于 2026-09-20 随该板块整体下线删除（用户口径：当前项目不需要任务中心板块）。
> 如需重建，设计档案（表结构 / API / 执行器要点）与后端代码归档见 `/tmp/jhyp-task-center-backup/`。

## 命名规则

- 文件名使用中文模块名，业务同学和开发都能直接理解。
- 横向能力可使用能力名，例如 `全局布局与导航.md`。
- 新业务页面建议使用页面名，例如 `采购入库单.md`。

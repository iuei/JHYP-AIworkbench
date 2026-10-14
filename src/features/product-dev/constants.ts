/**
 * 产品开发模块的共享常量。
 *
 * 2026-09-16 阶段 B：页面从单文件（原 `index.tsx`，642 行）拆成「布局 + 三个子路由」，
 * 原先散在文件顶部、被多个视图共用的数值统一收在这里，避免子页各写一份而漂移。
 */

/** 关键词防抖时长：候选池走服务端检索，逐字请求会让"敲一个词"变成五六次查询。 */
export const KEYWORD_DEBOUNCE_MS = 300

/** 与 `server/product-dev.mjs` 的 MAX_COMPARE_ITEMS 对齐，用于前端即时提示。 */
export const MAX_COMPARE_ITEMS = 10

/** 候选池每页条数（与 `server/product-dev.mjs` 的 DEFAULT_PAGE_SIZE 一致）。 */
export const DEFAULT_PAGE_SIZE = 20

/** 站点 / 阶段筛选的"全部"哨兵值（下拉框与查询参数共用同一个字面值）。 */
export const ALL = 'all'

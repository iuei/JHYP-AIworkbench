/**
 * 待办聚合接口（管理员）。
 *
 * **为什么聚合在一个接口里**：待办散落在用户管理、知识沉淀、提示词广场、知识库文档、
 * 纠错反馈五处。前端各请求一次，顶栏按钮每轮就要发 5 个并发请求，而它实际只需要
 * "每类有几条"。服务端一次 count 完返回，前端只负责渲染。
 *
 * **为什么只返回 `key` 而不是跳转 URL**：跳转目标是**前端路由**，属于前端知识
 * （TanStack Router 的 `to` 需要字面量才能保住类型安全）。服务端给稳定 `key`，
 * 前端按 key 映射 `to` + `search`，两边各自只维护自己那份。
 *
 * **口径**：
 * 1. 只统计**需要管理员动手**的事项 —— 员工侧的"我的提报被驳回"之类不在其中；
 * 2. 0 条的类型**不出现在列表里**（否则顶栏永远挂着一串 0，反而没有信号）；
 * 3. "文档即将过期"只算**还没过期且在预警窗口内**的生效文档 —— 已经过期的文档
 *    已被检索层排除，不再需要管理员干预。
 */
import express from 'express'
import { query } from '../db.mjs'
import { handleAiError } from './http-utils.mjs'

/** 文档到期预警窗口（天）：窗口内即将失效的生效文档计入待办。 */
export const EXPIRING_WINDOW_DAYS = 7

/**
 * 待办项定义。`key` 是稳定标识（前端据此决定跳到哪个页面），文案随查询一起下发。
 */
const TODO_SPECS = [
  {
    key: 'user_register',
    label: '注册申请待审核',
    hint: '新账号等待开通',
    run: async () => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS count FROM users WHERE status = 'pending'`
      )
      return rows[0]?.count ?? 0
    },
  },
  {
    key: 'note_review',
    label: '沉淀待审核',
    hint: '员工经验等待准入',
    run: async () => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS count FROM ai_knowledge_notes WHERE status = 'pending'`
      )
      return rows[0]?.count ?? 0
    },
  },
  {
    key: 'prompt_review',
    label: '提示词待审核',
    hint: '通过后全员可在对话中 @ 引用',
    run: async () => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS count FROM ai_prompts WHERE status = 'pending'`
      )
      return rows[0]?.count ?? 0
    },
  },
  {
    key: 'document_expiring',
    label: '知识库文档即将过期',
    hint: `${EXPIRING_WINDOW_DAYS} 天内失效`,
    run: async () => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS count
           FROM ai_documents
          WHERE status = 'active'
            AND expires_at IS NOT NULL
            AND expires_at > NOW()
            AND expires_at <= NOW() + make_interval(days => $1)`,
        [EXPIRING_WINDOW_DAYS]
      )
      return rows[0]?.count ?? 0
    },
  },
  {
    key: 'feedback_pending',
    label: '纠错反馈待处理',
    hint: '回答被标记为有问题',
    run: async () => {
      const { rows } = await query(
        `SELECT COUNT(*)::int AS count FROM ai_feedback WHERE handled = false`
      )
      return rows[0]?.count ?? 0
    },
  },
]

export function createTodoRouter({ adminGuard }) {
  const router = express.Router()

  /*
   * GET /ai/todos —— 顶栏待办按钮的数据源（仅管理员）。
   *
   * 五项 count 并发执行：彼此独立、都是走索引的小查询，串行没有意义。
   * 返回 `todos`（只有非零项）+ `total`（徽章数字）+ `windowDays`（供界面解释口径）。
   */
  router.get('/todos', adminGuard, async (req, res, next) => {
    try {
      const counts = await Promise.all(TODO_SPECS.map((spec) => spec.run()))
      const todos = TODO_SPECS.map((spec, index) => ({
        key: spec.key,
        label: spec.label,
        hint: spec.hint,
        count: counts[index],
      })).filter((item) => item.count > 0)

      res.json({
        todos,
        total: todos.reduce((sum, item) => sum + item.count, 0),
        windowDays: EXPIRING_WINDOW_DAYS,
      })
    } catch (error) {
      handleAiError(error, res, next)
    }
  })

  return router
}

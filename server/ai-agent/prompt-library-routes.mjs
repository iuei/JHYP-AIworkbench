/**
 * 提示词广场接口：员工侧「提示词广场」+ 管理员侧审核队列。
 *
 * 与 ASIN 清单的差异：清单是纯个人工作数据、不写管理审计；提示词一旦审核通过就是
 * **全员可用的公司资产**，因此创建/修改/提报/审核/删除全部写审计，与知识沉淀同一口径。
 *
 * 写管道顺序固定为：校验 → 权限（归属） → 冲突 → 状态流转 → 审计。
 * 越权一律 404（不区分"不存在"与"无权"），避免拿 id 探测他人条目。
 *
 * 术语提醒：本文件的"提示词"是**员工提问模板**，与 `prompt.mjs`（系统提示词组装与注入防护）
 * 是两件事。
 */
import express from 'express'
import { AUDIT_ACTIONS, recordAudit } from './audit.mjs'
import { clientIp, parsePageQuery } from './http-utils.mjs'
import { loadSettings } from './knowledge.mjs'
import { PromptOptimizeError, optimizePromptBody } from './prompt-optimize.mjs'
import { resolveProvider } from './providers/index.mjs'
import {
  PROMPT_STATUS,
  PromptConflictError,
  PromptNotFoundError,
  PromptValidationError,
  countPendingPrompts,
  createPrompt,
  deletePrompt,
  findOwnedPrompt,
  findVisiblePrompt,
  incrementPromptUsage,
  listPrompts,
  listPromptsForReview,
  serializePrompt,
  transitionPrompt,
  updatePrompt,
} from './prompt-library.mjs'

/** 员工侧可用范围白名单：`usable` 供对话内 @ 浮层使用。 */
const LIST_SCOPES = new Set(['mine', 'published', 'usable'])

function resourceId(value) {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

/**
 * 统一错误映射。
 *
 * 校验 400 / 不存在 404 / 冲突 409 三种语义必须区分：前端据此决定"改输入"还是"刷新列表"。
 * 尤其名称冲突与非法流转必须是 409 —— 它们是"当前状态不允许"，不是"参数写错了"。
 */
function handlePromptError(error, res, next) {
  if (error instanceof PromptValidationError) {
    return res.status(400).json({ message: error.message })
  }
  if (error instanceof PromptNotFoundError) {
    return res.status(404).json({ message: error.message })
  }
  if (error instanceof PromptConflictError) {
    return res.status(409).json({ message: error.message })
  }
  // 模型侧失败是**上游**问题：502 而不是 500 —— "稍后重试可能就好"与"代码有 bug"要分开
  if (error instanceof PromptOptimizeError) {
    return res.status(502).json({ message: error.message })
  }
  return next(error)
}

async function auditPrompt({ req, action, id, detail }) {
  await recordAudit({
    actorId: req.user.id,
    action,
    targetType: 'ai_prompt',
    targetId: id,
    detail,
    ip: clientIp(req),
  })
}

export function createPromptLibraryRouter({ adminGuard }) {
  const router = express.Router()

  /* ---------- 员工侧 ---------- */

  router.get('/prompts', async (req, res, next) => {
    try {
      const scope = String(req.query.scope ?? 'mine').trim() || 'mine'
      if (!LIST_SCOPES.has(scope)) {
        throw new PromptValidationError(`不支持的查询范围：${scope}。`)
      }
      // 统一分页口径（page 默认 1、pageSize 默认 20、上限 100），与其它列表接口一致
      const { page, pageSize } = parsePageQuery(req.query)
      const result = await listPrompts({
        userId: req.user.id,
        scope,
        keyword: req.query.keyword,
        page,
        pageSize,
      })
      res.json(result)
    } catch (error) {
      handlePromptError(error, res, next)
    }
  })

  router.get('/prompts/:id', async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) throw new PromptValidationError('提示词 ID 无效。')
      // 管理员在这里同样按"可见范围"读取：审核队列走 /distill/prompts，不靠这条越权
      const prompt = await findVisiblePrompt({ id, userId: req.user.id })
      if (!prompt) throw new PromptNotFoundError('提示词不存在。')
      res.json({ prompt: serializePrompt(prompt, { userId: req.user.id }) })
    } catch (error) {
      handlePromptError(error, res, next)
    }
  })

  /**
   * AI 优化提示词正文（**不落库**）。
   *
   * 返回的只是建议：用户在弹窗里点「采用」才会替换正文，再点「保存」才写库。
   * 因此这里刻意不写审计 —— 没有公司资产被改变（对比创建/提报/审核/删除的留痕口径）。
   *
   * 只优化正文：名称牵扯两层唯一性（个人库内 + 共享池全局），交给模型只会凭空制造 409；
   * 标题/说明/标签是给人看的元信息，模型写得不一定比人准。
   *
   * 演示模式（未配置 API Key）**直接拒绝**：演示 provider 遇到非工具类提问只会回
   * "我没有理解这个问题"，把它当优化结果返回等于编造（项目口径：失败不编造）。
   */
  router.post('/prompts/optimize', async (req, res, next) => {
    try {
      const settings = await loadSettings()
      const provider = resolveProvider({ settings })
      if (provider.mode !== 'live') {
        return res.status(400).json({
          message:
            '当前未接入云模型（演示模式），无法优化提示词。请先在「系统管理 → AI 治理 → 模型与配置」配置 API Key。',
        })
      }

      const result = await optimizePromptBody({
        provider,
        body: req.body?.body,
        // 名称只作为上下文（"这条模板是干什么的"）；标题字段已下线，不再作为入参
        name: req.body?.name,
      })

      res.json({
        body: result.body,
        truncated: result.truncated,
        model: result.model,
        demo: false,
      })
    } catch (error) {
      handlePromptError(error, res, next)
    }
  })

  router.post('/prompts', async (req, res, next) => {
    try {
      const prompt = await createPrompt({ userId: req.user.id, input: req.body ?? {} })
      await auditPrompt({
        req,
        action: AUDIT_ACTIONS.promptCreate,
        id: prompt.id,
        detail: { name: prompt.name },
      })
      res.status(201).json({ prompt })
    } catch (error) {
      handlePromptError(error, res, next)
    }
  })

  router.patch('/prompts/:id', async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) throw new PromptValidationError('提示词 ID 无效。')
      const prompt = await updatePrompt({ id, userId: req.user.id, patch: req.body ?? {} })
      if (!prompt) throw new PromptNotFoundError('提示词不存在。')
      await auditPrompt({
        req,
        action: AUDIT_ACTIONS.promptUpdate,
        id,
        detail: { name: prompt.name, status: prompt.status },
      })
      res.json({ prompt })
    } catch (error) {
      handlePromptError(error, res, next)
    }
  })

  router.delete('/prompts/:id', async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) throw new PromptValidationError('提示词 ID 无效。')
      const existing = await findOwnedPrompt({ id, userId: req.user.id })
      if (!existing) throw new PromptNotFoundError('提示词不存在。')
      await deletePrompt({ id, userId: req.user.id })
      await auditPrompt({
        req,
        action: AUDIT_ACTIONS.promptDelete,
        id,
        detail: { name: existing.name, previousStatus: existing.status },
      })
      res.json({ ok: true })
    } catch (error) {
      handlePromptError(error, res, next)
    }
  })

  /** 提报共享：private / rejected → pending。 */
  router.post('/prompts/:id/submit', async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) throw new PromptValidationError('提示词 ID 无效。')
      const prompt = await transitionPrompt({
        id,
        user: req.user,
        to: PROMPT_STATUS.pending,
        scope: 'self',
      })
      if (!prompt) throw new PromptNotFoundError('提示词不存在。')
      await auditPrompt({
        req,
        action: AUDIT_ACTIONS.promptSubmit,
        id,
        detail: { name: prompt.name },
      })
      res.json({ prompt })
    } catch (error) {
      handlePromptError(error, res, next)
    }
  })

  /** 撤回提报：pending → private（改完可重新提报）。 */
  router.post('/prompts/:id/withdraw', async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) throw new PromptValidationError('提示词 ID 无效。')
      const prompt = await transitionPrompt({
        id,
        user: req.user,
        to: PROMPT_STATUS.private,
        scope: 'self',
      })
      if (!prompt) throw new PromptNotFoundError('提示词不存在。')
      await auditPrompt({
        req,
        action: AUDIT_ACTIONS.promptUpdate,
        id,
        detail: { name: prompt.name, action: 'withdraw' },
      })
      res.json({ prompt })
    } catch (error) {
      handlePromptError(error, res, next)
    }
  })

  /**
   * 调用计数 +1。
   *
   * 刻意写成"尽力而为"：计数失败不该让用户用不了提示词，因此不向客户端报错，
   * 只在服务端日志留痕。
   */
  router.post('/prompts/:id/use', async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) throw new PromptValidationError('提示词 ID 无效。')
      const ok = await incrementPromptUsage({ id, userId: req.user.id })
      res.json({ ok })
    } catch (error) {
      process.stderr.write('[ai-agent] 提示词计数失败\n')
      handlePromptError(error, res, next)
    }
  })

  /* ---------- 管理员侧：审核队列 ---------- */

  router.get('/distill/prompts', adminGuard, async (req, res, next) => {
    try {
      const { page, pageSize } = parsePageQuery(req.query)
      const result = await listPromptsForReview({
        status: req.query.status === undefined ? PROMPT_STATUS.pending : req.query.status,
        keyword: req.query.keyword,
        page,
        pageSize,
      })
      // pendingTotal 是"待审总数"（与当前筛选无关的角标口径），与列表的 total 不是同一个数
      const pendingTotal = await countPendingPrompts()
      res.json({ ...result, pendingTotal })
    } catch (error) {
      handlePromptError(error, res, next)
    }
  })

  router.post('/distill/prompts/:id/approve', adminGuard, async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) throw new PromptValidationError('提示词 ID 无效。')
      const prompt = await transitionPrompt({
        id,
        user: req.user,
        to: PROMPT_STATUS.published,
        scope: 'admin',
      })
      if (!prompt) throw new PromptNotFoundError('提示词不存在。')
      await auditPrompt({
        req,
        action: AUDIT_ACTIONS.promptReview,
        id,
        detail: { name: prompt.name, decision: 'approve' },
      })
      res.json({ prompt })
    } catch (error) {
      handlePromptError(error, res, next)
    }
  })

  router.post('/distill/prompts/:id/reject', adminGuard, async (req, res, next) => {
    try {
      const id = resourceId(req.params.id)
      if (!id) throw new PromptValidationError('提示词 ID 无效。')
      // 驳回原因由领域层强制必填：没有原因的驳回会让提报人不知道改什么
      const prompt = await transitionPrompt({
        id,
        user: req.user,
        to: PROMPT_STATUS.rejected,
        comment: req.body?.comment,
        scope: 'admin',
      })
      if (!prompt) throw new PromptNotFoundError('提示词不存在。')
      await auditPrompt({
        req,
        action: AUDIT_ACTIONS.promptReview,
        id,
        detail: { name: prompt.name, decision: 'reject' },
      })
      res.json({ prompt })
    } catch (error) {
      handlePromptError(error, res, next)
    }
  })

  return router
}

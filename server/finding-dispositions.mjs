/**
 * 结论的**处置台账**（2026-09-17）。
 *
 * 用户口径：「用户修改完成后回到系统调整为修改完成」。
 *
 * 要解决的问题：结论不是一条持久化的记录，而是**每次分析用当期数据重算出来的**
 * （`competitor_analyses.result` 只是当时的快照）。因此：
 * - 处置状态不能挂在"某一次分析"上 —— 下次分析的 finding 是全新的对象，挂上去等于每次都要重新标记；
 * - 也不能做成"点一下就算完成" —— 用户点了完成、数据却没变，下次分析这条又冒出来，
 *   用户会认为系统在骗他。
 *
 * 因此状态挂在 **(账号, 诊断码 code, 处置目标 target)** 上，并采用**两段式**：
 *
 * | 状态 | 谁置的 | 含义 |
 * | --- | --- | --- |
 * | （无行） | —— | 待处理（默认） |
 * | `claimed` | 用户点「标记已处理」 | 只是"销账"，**不代表已解决** |
 * | `verified` | 系统在下次分析时自动核验 | 该码在同一个目标上不再命中 → 确实解决了 |
 * | `open` | 系统在下次分析时自动打回 | 标记过已处理 / 曾核验通过，但本次仍命中（含复发） |
 * | `ignored` | 用户点「不处理」并**必填原因** | 用户的长期决定，系统不再自动改动它 |
 *
 * 三条纪律：
 * 1. **只在"本次分析评估过该目标"时才判定** —— 用户跑了一次别的 ASIN 的分析，
 *    不能因为"这次没出现"就把待核验当成已解决（那是最容易犯的错，会造成虚假销账）；
 * 2. **`ignored` 是终局** —— 用户已经说了不处理，系统再自动打回就是打扰；
 * 3. **不删行** —— 打回时保留 `reopen_count` 与 `verify_detail`，界面才能如实说
 *    「你 10-12 标记已处理，本次仍命中」，而不是无声地把状态改回去。
 *
 * 纯函数（`dispositionTargetOf` / `collectFindingKeys` / `summarizeOpenFindings` /
 * `planDispositionUpdates`）不碰 IO，便于单测（`finding-dispositions.node-test.mjs`）；
 * SQL 层在本文件下半部分。
 */

import { query } from './db.mjs'

/** 台账状态取值（与迁移 202 的列注释、前端 `FindingDispositionStatus` 一一对应）。 */
export const DISPOSITION_STATUSES = ['open', 'claimed', 'verified', 'ignored']

/** 用户主动可以置的状态：`open` 走撤销（删行）、`verified` 只能由核验产生。 */
export const USER_SETTABLE_STATUSES = ['claimed', 'ignored']

/**
 * 级别权重，**只用于**取"未销账问题里的最高级别"。
 *
 * 与 `competitor-analysis.mjs` 的 `FINDING_WEIGHTS` 必须一致 —— 这里不 import 它，
 * 是为了避开循环依赖（那个模块要用本模块的 `collectFindingKeys` 落库）。
 * `finding-dispositions.node-test.mjs` 有断言守住两者一致。
 */
export const LEVEL_RANK = { high: 3, medium: 2, low: 1, info: 0 }

/** 台账的唯一键：诊断码 + 处置目标。 */
export function dispositionKeyOf(code, target) {
  return `${code}|${target}`
}

/**
 * 老快照的**位置键前缀**（2026-09-17 补）。
 *
 * 处置功能上线前落库的分析，其 `result.findings` **没有 `code`**（诊断码是 2026-09-17
 * 才随 `finding-fixes.mjs` 一起加的），因此无法建立"跨分析核验"的键 —— 下次分析算出来的
 * 结论是全新对象，没有码就没法把两者对应起来。
 *
 * 但它们**仍然必须能销账**：首页「需处理的分析」列出的恰恰是这些**历史 high 记录**
 * （新记录反而常常只是 medium），如果既报警又不可标记，用户就只能干看着
 * （用户实测反馈：「需立即处理的结论为什么不能标记」）。
 */
export const LEGACY_CODE_PREFIX = 'legacy:'

/**
 * 给没有诊断码的老结论派生一个**记录内位置键** `legacy:<index>`；有码或 `info` 级返回 null。
 *
 * 三条约束：
 * - **稳定**：快照是冻结的 JSON 数组，同一条记录每次读出来的下标完全一致；
 * - **永不参与核验**：只在该记录内有效，新分析里不可能出现 `legacy:*`
 *   —— `planDispositionUpdates` 显式跳过，否则会被判成"不再命中 → 已核验解决"（虚假销账）；
 * - **不给 `info` 级派生**：认知型结论不是待办，避免制造无效待办。
 */
export function legacyCodeFor(finding, index) {
  if (finding?.code) return null
  if (!finding || finding.level === 'info') return null
  return `${LEGACY_CODE_PREFIX}${index}`
}

/**
 * 一次分析里**可处置的结论清单**（轻量：`code` + `target` + `level`）。
 *
 * 这份清单会随分析一起落进 `competitor_analyses.finding_keys`：首页要算
 * "这条记录里还有几条没销账"，而**不能**为此把几百 KB 的 `result` 读出来。
 *
 * **老快照**（`code` 缺失）在这里派生 `legacy:<index>`（见 `legacyCodeFor`），
 * 因此迁移 **203** 的回填与运行时读取走的是**同一个函数**，键不会漂移。
 *
 * 同一次分析里"同码同目标"只保留第一条 —— 与台账的唯一键一致；若真出现重复，
 * 说明某类结论的归属目标需要更细的区分（`finding-dispositions.node-test.mjs`
 * 对真实分析结果断言过唯一性，不靠"应该不会重复"）。
 */
export function collectFindingKeys(findings, { asin = null } = {}) {
  const keys = []
  const seen = new Set()
  const list = Array.isArray(findings) ? findings : []
  for (let index = 0; index < list.length; index += 1) {
    const finding = list[index]
    const target = dispositionTargetOf(finding, asin)
    if (!target) continue
    const code = finding?.code ?? legacyCodeFor(finding, index)
    if (!code) continue
    const key = dispositionKeyOf(code, target)
    if (seen.has(key)) continue
    seen.add(key)
    keys.push({ code: String(code), target, level: finding.level ?? 'info' })
  }
  return keys
}

/**
 * 一条结论的**处置目标**（稳定标识）。
 *
 * 用 ASIN 而不是 SKU：ASIN 是分析输入的单位，也是"本次分析是否评估过这个目标"的判据
 * （`result.asins`）。库存类结论的 SKU 只用于显示"处理对象是哪个 SKU"，
 * 当键会让核验失去依据。
 */
export function dispositionTargetOf(finding, fallbackAsin = null) {
  const explicit = Array.isArray(finding?.targetAsins)
    ? finding.targetAsins.filter(Boolean)
    : []
  if (explicit.length > 0) return String(explicit[0])
  if (fallbackAsin) return String(fallbackAsin)
  return null
}

/**
 * 已销账的键：`claimed`（用户已销账，等核验）、`verified`（已核验解决）、
 * `ignored`（用户决定不处理）都**不再计入首页报警**。
 *
 * `open`（被打回）与"没有行"都算未处理 —— 前者会带着 `reopen_count` 在界面上说明
 * "这条你标记过、但数据仍命中"。
 */
export function clearedDispositionKeys(rows = []) {
  return new Set(
    rows
      .filter((row) => ['claimed', 'verified', 'ignored'].includes(row.status))
      .map((row) => dispositionKeyOf(row.code, row.target))
  )
}

/**
 * 一条分析记录里**还有多少条未销账的问题**、最高级别是什么。
 *
 * 只数 `high` / `medium` / `low` —— `info` 是"认知与机会"型结论（例如"竞品差评集中在这些点"、
 * "本品在组内表现最好可作参照"），它们**不是待办**，不该出现在首页的"待处理"数字里
 * （它们仍然可以销账，只是不计入报警口径）。
 *
 * 同时给出 `clearedCount`（**已销账的待办条数**）：列表要能告诉用户"你标记过、生效了"。
 * **必须用 actionable 总数去减**，不能拿 `finding_count`（含 `info`）相减 ——
 * 那样一条都没销账的记录也会显示"已销账 N 条"（踩过）。
 *
 * 首页「需处理的分析」与概览统计「需立即处理 N」都由 `openLevel` / `openCount` 决定 ——
 * 否则用户处理完了，首页还一直报警，闭环就没闭上。
 */
export function summarizeOpenFindings({ findingKeys = [], dispositions = [] } = {}) {
  const cleared = clearedDispositionKeys(dispositions)
  const actionable = findingKeys.filter((key) => key.level !== 'info')
  const open = actionable.filter(
    (key) => !cleared.has(dispositionKeyOf(key.code, key.target))
  )
  const openLevel = open.reduce(
    (worst, key) => ((LEVEL_RANK[key.level] ?? 0) > (LEVEL_RANK[worst] ?? 0) ? key.level : worst),
    'info'
  )
  return {
    openCount: open.length,
    openLevel,
    actionableCount: actionable.length,
    clearedCount: actionable.length - open.length,
  }
}

/**
 * 核验：算出每条台账行在这次分析之后的新状态（纯函数，不写库）。
 *
 * `inScopeTargets` 是**本次分析评估过的 ASIN**（`result.asins`）：
 * 只有目标在范围内时才能判定"不再命中"，否则一律不动 —— 这是本模块第一条纪律。
 */
export function planDispositionUpdates({
  rows = [],
  findingKeys = [],
  inScopeTargets = [],
  analysisId = null,
} = {}) {
  const present = new Set(findingKeys.map((key) => dispositionKeyOf(key.code, key.target)))
  const scope = new Set((Array.isArray(inScopeTargets) ? inScopeTargets : []).filter(Boolean).map(String))
  const updates = []

  for (const row of rows) {
    const target = String(row.target ?? '')
    const hit = present.has(dispositionKeyOf(row.code, target))

    /*
     * 老快照的位置键（`legacy:<index>`）**永不参与核验**：新分析里不可能出现 `legacy:*`，
     * 继续往下走会被判成"不再命中 → 已核验解决"，那是最糟的一种假销账。
     * 这类台账行只能由用户手动撤销。
     */
    if (String(row.code).startsWith(LEGACY_CODE_PREFIX)) continue
    // 用户已决定不处理：终局，不再自动改动（含"又命中了"）
    if (row.status === 'ignored') continue
    // 本次分析没评估这个目标 → 无从判定，保持原状（不制造虚假销账）
    if (!scope.has(target)) continue

    if (row.status === 'claimed') {
      updates.push(
        hit
          ? { code: row.code, target, status: 'open', analysisId, reopened: true }
          : { code: row.code, target, status: 'verified', analysisId, reopened: false }
      )
      continue
    }

    if (row.status === 'verified') {
      // 已核验解决又命中 = 复发，重新回到待处理（要报警，且带上"第 N 次"）
      if (hit) {
        updates.push({ code: row.code, target, status: 'open', analysisId, reopened: true })
      }
      continue
    }

    if (row.status === 'open' && hit) {
      // 已打回、本次仍命中：只刷新"最近一次出现"，不算再次打回（否则计数会虚高）
      updates.push({ code: row.code, target, status: 'open', analysisId, reopened: false })
    }
  }

  return updates
}

/* ---------- SQL 层 ---------- */

const DISPOSITION_COLUMNS = `
  code, target, status, note, claimed_analysis_id, claimed_at,
  verified_analysis_id, verified_at, reopen_count, verify_detail,
  last_seen_analysis_id, last_seen_at, updated_at`

/** 某个账号的全部台账行（量级：几十行，一次读全比按需查更省事）。 */
export async function listDispositions(userId) {
  const { rows } = await query(
    `SELECT ${DISPOSITION_COLUMNS}
       FROM competitor_finding_dispositions
      WHERE user_id = $1
      ORDER BY updated_at DESC`,
    [userId]
  )
  return rows
}

/** 台账行 → 前端形状（camelCase；日期保留 ISO 字符串，由前端格式化）。 */
export function toDisposition(row) {
  if (!row) return null
  return {
    status: row.status,
    note: row.note ?? null,
    claimedAt: row.claimed_at ?? null,
    verifiedAt: row.verified_at ?? null,
    reopenCount: row.reopen_count ?? 0,
    /** 打回时本次仍命中的事实描述（"ACoS 仍为 57.05%，高于预警线 35%"）。 */
    verifyDetail: row.verify_detail ?? null,
    lastSeenAt: row.last_seen_at ?? null,
    updatedAt: row.updated_at ?? null,
  }
}

/**
 * 把台账状态**附加到分析结果的每条结论上**。
 *
 * 前端不自己拼 `code|target` 去匹配 —— 唯一键的派生只在服务端一处发生。
 * 没有台账行的结论 `disposition` 为 `null`，界面按"待处理"渲染。
 */
export async function attachDispositions(userId, result) {
  if (!result || !Array.isArray(result.findings) || result.findings.length === 0) return result
  const rows = await listDispositions(userId)
  const map = new Map(rows.map((row) => [dispositionKeyOf(row.code, row.target), row]))
  const asin = result.asin ?? null

  const findings = result.findings.map((finding, index) => {
    const target = dispositionTargetOf(finding, asin)
    if (!target) return finding
    // 老快照没有诊断码 → 派生位置键（与迁移 203 的回填同一个函数，键不会漂移）
    const code = finding?.code ?? legacyCodeFor(finding, index)
    if (!code) return finding
    const row = map.get(dispositionKeyOf(code, target))
    return {
      ...finding,
      // 补上 `code`：前端要用它调处置接口（老 finding 原本没有这个字段），
      // 否则界面上有按钮、一点却是 400。
      code,
      dispositionTarget: target,
      /** 老快照的手动销账标记：界面据此说明"可以手动销账，但系统不会自动核验"。 */
      legacy: !finding?.code,
      disposition: toDisposition(row),
    }
  })

  return { ...result, findings }
}

/**
 * 分析落库后的**自动核验**：`claimed` → `verified` / 打回 `open`；`verified` 复发 → 打回。
 *
 * 在 `POST /api/competitor-analyses` 与任务中心执行器两处都要调（两条路径都会落库）。
 * 返回本次的核验结果（供调用方记日志或界面提示）；不抛错 —— 核验失败不该让一次
 * 已经花掉额度的分析整体失败。
 */
export async function verifyDispositions({ userId, analysisId, result }) {
  if (!userId || !result) return []
  let rows = []
  try {
    rows = await listDispositions(userId)
  } catch {
    // 台账表还没建好（例如只跑了旧迁移）时不应拖垮分析主流程
    return []
  }
  if (rows.length === 0) return []

  const fallbackAsin = result.asin ?? null
  const findingKeys = collectFindingKeys(result.findings, { asin: fallbackAsin })
  const detailOf = new Map(
    (Array.isArray(result.findings) ? result.findings : [])
      .filter((finding) => finding?.code)
      .map((finding) => {
        const target = dispositionTargetOf(finding, fallbackAsin)
        return [target ? dispositionKeyOf(finding.code, target) : '', finding.detail ?? null]
      })
  )
  const inScopeTargets =
    Array.isArray(result.asins) && result.asins.length > 0
      ? result.asins
      : fallbackAsin
        ? [fallbackAsin]
        : []

  const updates = planDispositionUpdates({ rows, findingKeys, inScopeTargets, analysisId })

  for (const update of updates) {
    const key = dispositionKeyOf(update.code, update.target)
    try {
      if (update.status === 'verified') {
        await query(
          `UPDATE competitor_finding_dispositions
              SET status = 'verified', verified_analysis_id = $3, verified_at = NOW(),
                  verify_detail = NULL, updated_at = NOW()
            WHERE user_id = $1 AND code = $2 AND target = $4`,
          [userId, update.code, analysisId, update.target]
        )
        continue
      }
      if (update.reopened) {
        await query(
          `UPDATE competitor_finding_dispositions
              SET status = 'open', reopen_count = reopen_count + 1,
                  verify_detail = $4, last_seen_analysis_id = $3, last_seen_at = NOW(),
                  updated_at = NOW()
            WHERE user_id = $1 AND code = $2 AND target = $5`,
          [userId, update.code, analysisId, detailOf.get(key) ?? null, update.target]
        )
        continue
      }
      await query(
        `UPDATE competitor_finding_dispositions
            SET last_seen_analysis_id = $3, last_seen_at = NOW(), updated_at = NOW()
          WHERE user_id = $1 AND code = $2 AND target = $4`,
        [userId, update.code, analysisId, update.target]
      )
    } catch {
      // 单条核验失败不影响其余行，也不影响分析本身
    }
  }

  return updates
}

/**
 * 用户主动标记：`claimed`（我已处理，待核验）或 `ignored`（不处理，必须给原因）。
 *
 * 行不存在时插入，存在时覆盖用户可写的字段（`reopen_count` 保留 —— 它记录的是
 * "这条问题被打回过几次"，跨多轮标记累计才有意义）。
 */
export async function setDisposition({ userId, analysisId, code, target, status, note = null }) {
  const { rows } = await query(
    `INSERT INTO competitor_finding_dispositions
       (user_id, code, target, status, note, claimed_analysis_id, claimed_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
     ON CONFLICT (user_id, code, target) DO UPDATE
       SET status = EXCLUDED.status,
           note = EXCLUDED.note,
           claimed_analysis_id = EXCLUDED.claimed_analysis_id,
           claimed_at = NOW(),
           verified_analysis_id = NULL,
           verified_at = NULL,
           verify_detail = NULL,
           updated_at = NOW()
     RETURNING ${DISPOSITION_COLUMNS}`,
    [userId, code, target, status, note, analysisId]
  )
  // 与 `attachDispositions` 同一种输出形状（camelCase）—— 前端只认一种
  return toDisposition(rows[0] ?? null)
}

/** 撤销用户自己的标记（回到"待处理"）—— 删行最干净，语义是"我什么都没标记过"。 */
export async function clearDisposition({ userId, code, target }) {
  const { rowCount } = await query(
    `DELETE FROM competitor_finding_dispositions
      WHERE user_id = $1 AND code = $2 AND target = $3`,
    [userId, code, target]
  )
  return rowCount > 0
}

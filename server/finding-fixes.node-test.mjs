/**
 * 处置方案映射的单测（纯函数，不连库）。
 *
 * 守住三条：① 已定义的诊断码都能出方案、且方案非空（"处理什么"必须有）；
 * ② `$asin` 路由缺 asin 时链接被丢弃（否则点进去直接报错）；
 * ③ 未定义的码返回 null（前端据此回退到旧的文字建议，而不是渲染半截方案）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildFix, knownFixCodes } from './finding-fixes.mjs'

test('每个已定义的诊断码都能生成含"处理什么"的方案', () => {
  const codes = knownFixCodes()
  assert.ok(codes.length >= 20, `已定义 ${codes.length} 个诊断码`)
  for (const code of codes) {
    const fix = buildFix(code, { asin: 'B0TEST0001', marketplace: 'US', sku: 'KT-1', keyword: 'candle' })
    assert.ok(fix, `${code} 应有方案`)
    assert.ok(fix.what.length > 0, `${code} 的 what 不能为空`)
    // 方案至少要有"去哪做"或"系统外怎么做"之一，否则等于没给处置办法
    assert.ok(
      fix.links.length > 0 || fix.offSystem.length > 0,
      `${code} 既没有入口也没有系统外步骤`
    )
  }
})

test('预警线三条各走各的诊断码，处置入口指向竞品详情', () => {
  const acos = buildFix('metric_acos_above', { asin: 'B0TEST0001', marketplace: 'US' })
  assert.match(acos.what, /B0TEST0001/)
  const detail = acos.links.find((link) => link.to === '/competitor-analysis/$asin')
  assert.equal(detail?.params?.asin, 'B0TEST0001')
  assert.ok(acos.offSystem.some((step) => /广告后台/.test(step)))
})

test('$asin 路由缺 asin 时该入口被丢弃（不许留下点进去报错的按钮）', () => {
  const fix = buildFix('metric_cvr_below', { marketplace: 'US' })
  assert.equal(
    fix.links.some((link) => link.to === '/competitor-analysis/$asin'),
    false
  )
  // 其余入口不受影响
  assert.ok(fix.links.length >= 0)
})

test('库存类结论带 SKU 进 what，并要求线下补货动作', () => {
  const fix = buildFix('stockout_risk', { sku: 'KT-JH-001-BK' })
  assert.match(fix.what, /KT-JH-001-BK/)
  assert.ok(fix.offSystem.some((step) => /补货/.test(step)))
  assert.ok(fix.links.some((link) => link.to === '/asin-watchlists/items'))
})

test('无数据结论给出"上传报表"（管理员入口）与"换区间重跑"两个方向', () => {
  const fix = buildFix('no_data', { marketplace: 'US' })
  const upload = fix.links.find((link) => link.to === '/admin/ai/datasources')
  assert.equal(upload?.adminOnly, true)
  assert.ok(fix.links.some((link) => link.to === '/competitor-analysis'))
  assert.ok(fix.offSystem.length > 0)
})

test('未定义的诊断码返回 null（前端回退到文字建议）', () => {
  assert.equal(buildFix('something_new'), null)
  assert.equal(buildFix(null), null)
  assert.equal(buildFix(undefined), null)
})

test('系统外步骤与入口都不为空字符串（空步骤会渲染成空 li）', () => {
  for (const code of knownFixCodes()) {
    const fix = buildFix(code, { asin: 'B0TEST0001', sku: 'KT-1', keyword: 'candle', marketplace: 'US' })
    assert.ok(fix.offSystem.every((step) => String(step).trim().length > 0), `${code} 有空步骤`)
    assert.ok(fix.links.every((link) => link.label.trim().length > 0), `${code} 有空按钮文案`)
  }
})

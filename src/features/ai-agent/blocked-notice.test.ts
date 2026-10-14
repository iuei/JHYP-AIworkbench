import { describe, expect, it } from 'vitest'
import { DEFAULT_BLOCKED_NOTICE, blockedNoticeText } from './blocked-notice'

/**
 * 拦截提示的分层文案（2026-09-17）。
 *
 * 守住的是一件事：**三种原因不许再共用一句"无权"** —— 用户实测被这句误导过
 * （工具没上线却显示"没权限"，排查方向直接跑偏）。
 */
describe('blockedNoticeText', () => {
  it('工具不可用：说明与账号权限无关', () => {
    const text = blockedNoticeText('tool_unavailable')
    expect(text).toContain('当前不可用')
    expect(text).toContain('与你的账号权限无关')
  })

  it('确实没权限：保留原有的管理员文案', () => {
    expect(blockedNoticeText('forbidden')).toBe(DEFAULT_BLOCKED_NOTICE)
    expect(blockedNoticeText('forbidden')).toContain('请联系管理员')
  })

  it('模型措辞被护栏拦下：说清与账号权限无关，并给出可行下一步', () => {
    const text = blockedNoticeText('wording:described_own_tools')
    expect(text).toContain('权限护栏')
    expect(text).toContain('与账号权限无关')
    expect(text).toContain('换个问法')
  })

  it('三种原因给出三种不同文案（这就是本次修复的全部意义）', () => {
    const texts = new Set([
      blockedNoticeText('tool_unavailable'),
      blockedNoticeText('forbidden'),
      blockedNoticeText('wording:self_described_refusal'),
    ])
    expect(texts.size).toBe(3)
  })

  it('没有原因或未知原因：退回通用文案，不编造细节', () => {
    expect(blockedNoticeText(null)).toBe(DEFAULT_BLOCKED_NOTICE)
    expect(blockedNoticeText(undefined)).toBe(DEFAULT_BLOCKED_NOTICE)
    expect(blockedNoticeText('something_new')).toBe(DEFAULT_BLOCKED_NOTICE)
  })
})

import { describe, expect, it } from 'vitest'
import {
  ackIdForDismiss,
  dismissAnnouncement,
  dismissedIdsForLogin,
  EMPTY_DISMISS_STATE,
  visibleAnnouncements,
} from './gate'
import type { AnnouncementDisplayMode, PendingAnnouncement } from './types'

function pending(
  id: number,
  displayMode: AnnouncementDisplayMode = 'once'
): PendingAnnouncement {
  return {
    id,
    title: `公告 ${id}`,
    body: '正文',
    displayMode,
    publishedAt: '2026-09-15T09:00:00.000Z',
  }
}

describe('公告弹窗队列', () => {
  it('按服务端给的顺序返回待弹公告（前端不重排）', () => {
    const items = [pending(3), pending(1), pending(2)]

    expect(visibleAnnouncements(items, []).map((item) => item.id)).toEqual([
      3, 1, 2,
    ])
  })

  it('过滤掉本次登录内已经关闭的公告', () => {
    const items = [pending(1), pending(2), pending(3)]

    expect(visibleAnnouncements(items, [1]).map((item) => item.id)).toEqual([
      2, 3,
    ])
    expect(visibleAnnouncements(items, [1, 2, 3])).toEqual([])
  })

  it('空列表返回空数组，不返回新对象以外的意外结果', () => {
    expect(visibleAnnouncements([], [1])).toEqual([])
  })

  it('关闭一条后累加，重复关闭同一条是幂等的', () => {
    const first = dismissAnnouncement(EMPTY_DISMISS_STATE, 1000, 7)
    const second = dismissAnnouncement(first, 1000, 9)
    const again = dismissAnnouncement(second, 1000, 7)

    expect(second.dismissedIds).toEqual([7, 9])
    expect(again.dismissedIds).toEqual([7, 9])
  })

  it('换一次登录就丢弃上一位使用者关掉的记录（"每次登录都弹"靠这条重新出现）', () => {
    const state = dismissAnnouncement(EMPTY_DISMISS_STATE, 1000, 7)

    // 同一次登录：记录仍在，队列不会重复弹
    expect(dismissedIdsForLogin(state, 1000)).toEqual([7])
    // 又登录了一次（loginAt 变化）：从零开始，之前关掉的公告该弹还是要弹
    expect(dismissedIdsForLogin(state, 2000)).toEqual([])
    expect(
      visibleAnnouncements([pending(7)], dismissedIdsForLogin(state, 2000))
    ).toHaveLength(1)
  })
})

describe('关闭弹窗即视为"已读"', () => {
  /*
    这条断言是 2026-09-16 的缺陷修复留下的护栏。
    早期实现只在点「我知道了」时上报已读，用 ✕ / Esc / 遮罩关掉则不算 ——
    实测复现：用户用 ✕ 关掉「只弹一次」的公告后，下次登录它又弹，
    表现为"关掉了还一直弹"。弹窗是模态阻塞的，关掉它本身就是"已处理"。
  */
  it('关闭当前公告就上报它的已读（不分关闭方式）', () => {
    expect(ackIdForDismiss(pending(5))).toBe(5)
    expect(ackIdForDismiss(pending(7, 'every_login'))).toBe(7)
  })

  it('没有当前公告时什么都不上报', () => {
    expect(ackIdForDismiss(undefined)).toBeNull()
  })
})

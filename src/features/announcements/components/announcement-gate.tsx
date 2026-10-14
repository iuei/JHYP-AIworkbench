import { useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { MarkdownContent } from '@/components/markdown-content'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAcknowledgeAnnouncement, usePendingAnnouncements } from '../api'
import {
  ackIdForDismiss,
  dismissAnnouncement,
  dismissedIdsForLogin,
  EMPTY_DISMISS_STATE,
  visibleAnnouncements,
} from '../gate'

/**
 * 公告弹窗（登录后进入系统时触发）。
 *
 * 挂在 `AuthenticatedLayout` 里而不是各页面：公告是全站行为，挂到页面上会有两个后果 ——
 * 漏挂的页面永远看不到公告，而每个页面都挂又会各弹一次。
 *
 * 触发条件是 `auth.loginAt`（**只存在于内存**，登录成功那一刻写入）：
 * - 登录 → 布局挂载 → 拉一次待弹公告 → 逐条弹；
 * - 刷新页面 / 站内跳转 / 重新打开标签页 → `loginAt` 为 0，一次都不弹。
 *
 * 队列是**派生**出来的（`待弹列表 - 本次登录已关闭`），没有 `useEffect` 同步状态：
 * "已关闭"只在用户点按钮时变化，服务端待弹列表在本次登录内是不可变的快照
 * （见 `usePendingAnnouncements` 的 staleTime），因此不存在需要 effect 去对齐的两份状态。
 *
 * 多条公告**排队逐条展示**，而不是拼成一大坨：每条各有标题与发布时间，合并展示会让
 * "这是哪一条"无法回答，也会让正文的长度限制形同取消。
 */
export function AnnouncementGate() {
  const loginAt = useAuthStore((state) => state.auth.loginAt)
  const [dismissState, setDismissState] = useState(EMPTY_DISMISS_STATE)
  const pending = usePendingAnnouncements(loginAt)
  const acknowledge = useAcknowledgeAnnouncement()

  const dismissedIds = dismissedIdsForLogin(dismissState, loginAt)
  const queue = visibleAnnouncements(pending.data ?? [], dismissedIds)
  const current = queue[0]

  /**
   * 关闭当前公告：**任何关闭方式都会上报已读**（「我知道了」/ ✕ / Esc / 点遮罩）。
   *
   * 弹窗是模态阻塞的，用户必须先处理掉它才能继续用系统 —— 关掉即代表"已处理"。
   * 早期只把「我知道了」当确认，结果是用户用 ✕ 关掉后下次登录又弹（实测复现）。
   * 需要反复提醒的内容请用「每次登录都弹」。
   */
  function dismiss() {
    if (!current) return
    const ackId = ackIdForDismiss(current)
    if (ackId !== null) acknowledge.mutate(ackId)
    setDismissState((state) => dismissAnnouncement(state, loginAt, current.id))
  }

  return (
    <Dialog
      open={Boolean(current)}
      onOpenChange={(open) => {
        if (!open) dismiss()
      }}
    >
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>{current?.title}</DialogTitle>
          <DialogDescription>
            {current?.publishedAt
              ? `发布于 ${new Date(current.publishedAt).toLocaleString()}`
              : '系统公告'}
          </DialogDescription>
        </DialogHeader>
        {/* 正文可能很长：限高内滚，避免把确认按钮挤出视口（弹窗底部按钮必须始终可点） */}
        <div className='max-h-[55vh] overflow-y-auto pe-1'>
          <MarkdownContent content={current?.body ?? ''} />
        </div>
        <DialogFooter className='items-center gap-3 sm:justify-between'>
          <span className='text-xs text-muted-foreground'>
            {queue.length > 1 ? `还有 ${queue.length - 1} 条公告待查看` : ''}
          </span>
          <Button onClick={() => dismiss()}>我知道了</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

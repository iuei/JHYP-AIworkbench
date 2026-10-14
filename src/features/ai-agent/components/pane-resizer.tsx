import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  clampPaneWidth,
  KEYBOARD_RESIZE_STEP,
  limitPaneWidths,
  PANE_RESIZER_WIDTH,
  PANE_SPEC,
  type PaneWidths,
} from '../pane-width'

type PaneResizerProps = {
  /** 当前展示宽度（已按容器收敛） */
  widths: PaneWidths
  /** 左栏是否真的可见（隐藏时不参与宽度预算） */
  leftVisible: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
  /** 拖拽 / 键盘调整中：只更新界面，不写偏好 */
  onResize: (next: PaneWidths) => void
  /** 调整结束：落偏好（cookie），键盘调整直接提交 */
  onCommit: (next: PaneWidths) => void
  /** 双击 / 菜单：恢复默认宽度 */
  onReset: () => void
}

/**
 * 左栏与中栏之间的分隔条：**拖拽调整会话列表宽度**，并可键盘操作。
 *
 * 为什么要支持键盘：WCAG 2.2 要求"作者实现的拖动操作必须有单指针替代方案"，
 * 拖拽不能是唯一入口。这里 `←/→` 调整、`Home/End` 到极限、双击或 `Enter` 恢复默认宽度。
 *
 * 右栏（本次回答的依据）已取消，所以只剩这一根分隔条，
 * 但**键盘分支必须保留**——它是"拖动不是唯一方式"的唯一实现。
 *
 * 拖拽热区就是原布局里 `gap-4` 那 16px，所以视觉间距与改造前一致，也没有额外的布局抖动。
 */
export function PaneResizer({
  widths,
  leftVisible,
  containerRef,
  onResize,
  onCommit,
  onReset,
}: PaneResizerProps) {
  const dragRef = useRef<{
    pointerId: number
    startX: number
    startWidth: number
  } | null>(null)
  // 拖拽过程中最后一次算出的宽度：pointerup 与最后一次 pointermove 之间可能还没重渲染，
  // 直接读 props 会提交到上一帧的值（表现为"松手后又弹回去一点"）。
  const latestRef = useRef<PaneWidths | null>(null)
  const [dragging, setDragging] = useState(false)

  const build = useCallback(
    (rawValue: number, base: PaneWidths): PaneWidths =>
      limitPaneWidths(
        { ...base, left: clampPaneWidth(rawValue) },
        {
          containerWidth: containerRef.current?.clientWidth ?? 0,
          leftVisible,
        }
      ),
    [containerRef, leftVisible]
  )

  useEffect(() => {
    if (!dragging) return
    const previousCursor = document.body.style.cursor
    const previousSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousSelect
    }
  }, [dragging])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: widths.left,
    }
    latestRef.current = null
    setDragging(true)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    // 分隔条在左栏右侧：指针右移 = 左栏变宽
    const delta = event.clientX - drag.startX
    const next = build(drag.startWidth + delta, widths)
    latestRef.current = next
    onResize(next)
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId)
    }
    const next = latestRef.current ?? widths
    latestRef.current = null
    onCommit(next)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Enter 是"恢复默认"的键盘等价操作（双击是鼠标通路，键盘用户也得能回去）
    if (event.key === 'Enter') {
      event.preventDefault()
      onReset()
      return
    }
    let rawValue: number | null = null
    if (event.key === 'ArrowRight')
      rawValue = widths.left + KEYBOARD_RESIZE_STEP
    else if (event.key === 'ArrowLeft')
      rawValue = widths.left - KEYBOARD_RESIZE_STEP
    else if (event.key === 'Home') rawValue = PANE_SPEC.min
    else if (event.key === 'End') rawValue = PANE_SPEC.max
    if (rawValue === null) return
    event.preventDefault()
    onCommit(build(rawValue, widths))
  }

  return (
    <div
      aria-label='调整会话列表宽度'
      aria-orientation='vertical'
      aria-valuemax={PANE_SPEC.max}
      aria-valuemin={PANE_SPEC.min}
      aria-valuenow={widths.left}
      className={cn(
        'group relative hidden shrink-0 cursor-col-resize touch-none items-center justify-center',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        'lg:flex'
      )}
      role='separator'
      style={{ width: PANE_RESIZER_WIDTH }}
      tabIndex={0}
      title='拖动调整宽度，双击恢复默认'
      onDoubleClick={onReset}
      onKeyDown={handleKeyDown}
      onPointerCancel={endDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
    >
      {/* 分隔线：视觉上与改造前的 border-e 一致，只是现在可以拖 */}
      <span
        aria-hidden
        className={cn(
          'h-full w-px bg-border transition-colors',
          'group-hover:bg-primary/60 group-focus-visible:bg-primary',
          dragging && 'bg-primary'
        )}
      />
      {/* 抓手：可发现性提示，绝对定位所以不参与布局（hover 不会引起抖动） */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1/2 h-8 w-1 -translate-y-1/2 rounded-full bg-primary/70',
          'opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
          dragging && 'opacity-100'
        )}
      />
    </div>
  )
}

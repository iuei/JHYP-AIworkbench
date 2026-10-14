import { afterEach, describe, expect, it } from 'vitest'
import {
  clampPaneWidth,
  clearPaneWidths,
  defaultPaneWidths,
  limitPaneWidths,
  MIN_CENTER_WIDTH,
  PANE_RESIZER_WIDTH,
  PANE_SPEC,
  parsePaneWidths,
  readPaneWidths,
  serializePaneWidths,
  writePaneWidths,
} from './pane-width'

afterEach(() => {
  clearPaneWidths()
})

describe('clampPaneWidth', () => {
  it('夹在最小/最大宽度之间', () => {
    expect(clampPaneWidth(10)).toBe(PANE_SPEC.min)
    expect(clampPaneWidth(9999)).toBe(PANE_SPEC.max)
  })

  it('取整，非法值回落到最小宽度', () => {
    expect(clampPaneWidth(260.6)).toBe(261)
    expect(clampPaneWidth(Number.NaN)).toBe(PANE_SPEC.min)
  })
})

describe('parsePaneWidths / serializePaneWidths', () => {
  it('解析合法值并往返一致', () => {
    const parsed = parsePaneWidths('300')
    expect(parsed).toEqual({ left: 300 })
    expect(serializePaneWidths({ left: 300 })).toBe('300')
  })

  it('兼容取消右栏前的 "左,右" 格式：只认左栏，旧偏好不丢', () => {
    expect(parsePaneWidths('300,400')).toEqual({ left: 300 })
  })

  it('空值与非数字一律返回 null（宁可用默认值）', () => {
    expect(parsePaneWidths(undefined)).toBeNull()
    expect(parsePaneWidths('')).toBeNull()
    expect(parsePaneWidths('a')).toBeNull()
    expect(parsePaneWidths(',400')).toBeNull()
  })

  it('越界值按栏约束收敛，而不是整条丢弃', () => {
    expect(parsePaneWidths('10')).toEqual({ left: PANE_SPEC.min })
    expect(parsePaneWidths('9999,480')).toEqual({ left: PANE_SPEC.max })
  })
})

describe('defaultPaneWidths', () => {
  it('2xl 及以上放宽，其余用基础值', () => {
    expect(defaultPaneWidths(false)).toEqual({ left: PANE_SPEC.base })
    expect(defaultPaneWidths(true)).toEqual({ left: PANE_SPEC.wide })
  })

  it('默认值落在 min/max 区间内', () => {
    for (const widths of [defaultPaneWidths(false), defaultPaneWidths(true)]) {
      expect(widths.left).toBeGreaterThanOrEqual(PANE_SPEC.min)
      expect(widths.left).toBeLessThanOrEqual(PANE_SPEC.max)
    }
  })
})

describe('limitPaneWidths', () => {
  it('容器够宽时原样返回', () => {
    const widths = { left: 256 }
    expect(
      limitPaneWidths(widths, { containerWidth: 1600, leftVisible: true })
    ).toEqual(widths)
  })

  it('预算不足时压左栏，但不低于下限', () => {
    // 预算 = 900 - 360 - 16 = 524，左栏 600 需要让出 76
    expect(
      limitPaneWidths({ left: 600 }, { containerWidth: 900, leftVisible: true })
    ).toEqual({ left: 524 })
  })

  it('保不住中栏时停在下限，不再继续缩', () => {
    // 预算 = 500 - 360 - 16 = 124 < 下限，窗口再小也不把左栏压到 200 以下
    expect(
      limitPaneWidths({ left: 420 }, { containerWidth: 500, leftVisible: true })
    ).toEqual({ left: PANE_SPEC.min })
  })

  it('左栏隐藏时不占预算、也不被压缩', () => {
    expect(
      limitPaneWidths(
        { left: 420 },
        {
          containerWidth: MIN_CENTER_WIDTH + PANE_RESIZER_WIDTH,
          leftVisible: false,
        }
      )
    ).toEqual({ left: 420 })
  })

  it('容器宽度未知（首帧未测量）时不做限制', () => {
    const widths = { left: 420 }
    expect(
      limitPaneWidths(widths, { containerWidth: 0, leftVisible: true })
    ).toEqual(widths)
    expect(
      limitPaneWidths(widths, { containerWidth: Number.NaN, leftVisible: true })
    ).toEqual(widths)
  })
})

describe('cookie 偏好读写', () => {
  it('写入后可读回，清除后回到默认值', () => {
    const fallback = defaultPaneWidths(false)
    expect(readPaneWidths(fallback)).toEqual(fallback)

    writePaneWidths({ left: 384 })
    expect(readPaneWidths(fallback)).toEqual({ left: 384 })

    clearPaneWidths()
    expect(readPaneWidths(fallback)).toEqual(fallback)
  })
})

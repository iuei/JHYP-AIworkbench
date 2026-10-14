import { beforeEach, describe, expect, it } from 'vitest'
import {
  closePageTab,
  neighborPageTab,
  upsertPageTab,
  usePageTabsStore,
  type PageTab,
} from './tabs-store'

const tab = (key: string, title = key): PageTab => ({ key, title, href: key })

describe('upsertPageTab', () => {
  it('同一个路径只占一个标签，重复打开只是更新标题', () => {
    const once = upsertPageTab([], tab('/admin/users', '用户管理'))
    const twice = upsertPageTab(once, tab('/admin/users', '用户管理'))
    expect(twice).toHaveLength(1)
    expect(twice[0].title).toBe('用户管理')
  })

  it('标题变化时原地更新，不新增标签', () => {
    const tabs = upsertPageTab([tab('/a', '旧名')], tab('/a', '新名'))
    expect(tabs).toHaveLength(1)
    expect(tabs[0].title).toBe('新名')
  })

  it('标题与地址都没变时返回原引用（避免无意义的重渲染）', () => {
    const initial = [tab('/a', 'A')]
    expect(upsertPageTab(initial, tab('/a', 'A'))).toBe(initial)
  })

  it('新标签追加在末尾', () => {
    const tabs = upsertPageTab(upsertPageTab([], tab('/a')), tab('/b'))
    expect(tabs.map((entry) => entry.key)).toEqual(['/a', '/b'])
  })

  it('超过上限时丢最早打开的，且不丢刚打开的那条', () => {
    let tabs: PageTab[] = []
    for (let index = 0; index < 22; index += 1) {
      tabs = upsertPageTab(tabs, tab(`/p${index}`), 20)
    }
    expect(tabs).toHaveLength(20)
    expect(tabs[0].key).toBe('/p2')
    expect(tabs[tabs.length - 1].key).toBe('/p21')
  })
})

describe('closePageTab', () => {
  it('关掉指定标签，其余保持顺序', () => {
    const tabs = [tab('/a'), tab('/b'), tab('/c')]
    expect(closePageTab(tabs, '/b').map((entry) => entry.key)).toEqual([
      '/a',
      '/c',
    ])
  })
})

describe('neighborPageTab', () => {
  it('优先停到右边那个（浏览器习惯）', () => {
    const tabs = [tab('/a'), tab('/b'), tab('/c')]
    expect(neighborPageTab(tabs, '/b')?.key).toBe('/c')
  })

  it('关最后一个时停到左边那个', () => {
    const tabs = [tab('/a'), tab('/b')]
    expect(neighborPageTab(tabs, '/b')?.key).toBe('/a')
  })

  it('一个都不剩时返回 null，由调用方决定回哪', () => {
    expect(neighborPageTab([tab('/a')], '/a')).toBeNull()
  })

  it('关一个不存在的标签返回 null', () => {
    expect(neighborPageTab([tab('/a')], '/zzz')).toBeNull()
  })
})

describe('usePageTabsStore', () => {
  beforeEach(() => {
    usePageTabsStore.setState({ tabs: [], activeKey: null, owner: null })
  })

  it('打开标签后它成为激活项', () => {
    usePageTabsStore.getState().open(tab('/a'), 'u1')
    expect(usePageTabsStore.getState().activeKey).toBe('/a')
  })

  it('关掉当前页返回应该跳去的地址', () => {
    const { open, close } = usePageTabsStore.getState()
    open(tab('/a'), 'u1')
    open(tab('/b'), 'u1')
    expect(close('/b')).toBe('/a')
    expect(usePageTabsStore.getState().activeKey).toBe('/a')
  })

  it('关掉不是当前页的标签返回 null（不需要跳转）', () => {
    const { open, close } = usePageTabsStore.getState()
    open(tab('/a'), 'u1')
    open(tab('/b'), 'u1')
    expect(close('/a')).toBeNull()
    expect(usePageTabsStore.getState().activeKey).toBe('/b')
  })

  it('关掉最后一个标签后回到首页', () => {
    const { open, close } = usePageTabsStore.getState()
    open(tab('/a'), 'u1')
    expect(close('/a')).toBe('/')
    expect(usePageTabsStore.getState().tabs).toHaveLength(0)
    expect(usePageTabsStore.getState().activeKey).toBeNull()
  })

  it('换账号登录时旧标签整份丢弃（否则会点出 403 的治理页）', () => {
    const { open } = usePageTabsStore.getState()
    open(tab('/admin/users', '用户管理'), 'u1')
    open(tab('/admin/announcements', '公告管理'), 'u1')
    open(tab('/prompts', '提示词广场'), 'u2')
    const state = usePageTabsStore.getState()
    expect(state.tabs.map((entry) => entry.key)).toEqual(['/prompts'])
    expect(state.owner).toBe('u2')
  })
})

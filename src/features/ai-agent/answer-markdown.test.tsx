/**
 * `AnswerMarkdown` 的回归测试 —— 保护的是**用户实际看到什么**。
 *
 * 背景：真实模型（deepseek-chat）一直在输出 Markdown，而改造前正文用
 * `<p whitespace-pre-wrap>` 按纯文本渲染，用户看到的是 `## 结论`、`**20.17%**`、
 * `| 驱动因子 |` 这些**源码符号**。这个文件锁死两件事：
 * 1. 约定内的语法（标题 / 加粗 / 列表 / 软换行）必须渲染成视觉层级，符号不得出现在可见文本里；
 * 2. 约定外的语法（表格、原始 HTML）必须安全降级 —— 前者兜底成可读表格，后者一律不执行。
 *
 * 下面第一个用例直接取自 `server/ai-agent/eval/reports/` 里真实模型的输出形态，
 * 它一旦回归就说明"用户又看到源码符号了"。
 */
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { AnswerMarkdown } from './components/answer-markdown'

/** 真实模型历史输出的形态（D01：`## 结论` + 加粗 + 正文表格，三种混在一段里）。 */
const REAL_MODEL_OUTPUT = [
  '## 结论',
  '',
  '美国站 B0SAMPLE01 上个月 ACoS 从 **20.17% 涨到 32.1%**，涨了 **11.93 个百分点**。',
  '',
  '| 驱动因子 | 对 ACoS 变化的影响 |',
  '| --- | --- |',
  '| 广告销售额下滑 | 贡献 9.46 个百分点 |',
].join('\n')

describe('AnswerMarkdown 统一渲染', () => {
  it('把 `## 结论` 渲染成标题，符号不再出现在可见文本里', async () => {
    const { container } = await render(
      <AnswerMarkdown content={REAL_MODEL_OUTPUT} />
    )

    expect(container.querySelector('h2')?.textContent).toBe('结论')
    // 核心回归：这些符号一旦出现在 textContent 里，就说明又按纯文本渲染了
    expect(container.textContent).not.toContain('##')
    expect(container.textContent).not.toContain('**')
    expect(container.textContent).not.toContain('|')
  })

  it('加粗渲染成 strong，而不是显示星号', async () => {
    const { container } = await render(
      <AnswerMarkdown content={'ACoS 从 **20.17%** 涨到 **32.1%**。'} />
    )

    const strong = [...container.querySelectorAll('strong')].map(
      (node) => node.textContent
    )
    expect(strong).toEqual(['20.17%', '32.1%'])
  })

  it('`- ` 列表渲染成真实列表项', async () => {
    const { container } = await render(
      <AnswerMarkdown
        content={'## 关键数据\n\n- 广告花费 3,855.37\n- 广告销售额 13,845.29'}
      />
    )

    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.textContent).not.toContain('- 广告花费')
  })

  it('`1. ` 有序列表渲染成 ol（执行步骤用）', async () => {
    const { container } = await render(
      <AnswerMarkdown
        content={'## 执行步骤\n\n1. 确认断货天数\n2. 联系供应链确认到货时间'}
      />
    )

    expect(container.querySelectorAll('ol > li')).toHaveLength(2)
  })

  it('保留单行软换行（中文回答常一句一行，不能被合并成一整段）', async () => {
    const { container } = await render(
      <AnswerMarkdown content={'第一句。\n第二句。'} />
    )

    expect(container.querySelectorAll('br')).toHaveLength(1)
  })

  it('模型违令排了表格时兜底成可读表格，而不是一屏竖线', async () => {
    const { container } = await render(
      <AnswerMarkdown content={REAL_MODEL_OUTPUT} />
    )

    expect(container.querySelectorAll('table')).toHaveLength(1)
    expect(container.querySelectorAll('th')).toHaveLength(2)
  })

  it('外链新窗口打开并带 noopener noreferrer', async () => {
    const { container } = await render(
      <AnswerMarkdown content={'参考 [文档](https://example.com/a)'} />
    )

    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://example.com/a')
    expect(link?.getAttribute('target')).toBe('_blank')
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('原始 HTML 一律不渲染（不加 rehype-raw）', async () => {
    const { container } = await render(
      <AnswerMarkdown content={'<img src=x onerror="alert(1)">正文'} />
    )

    // 不加 rehype-raw 时 HTML 节点被丢弃：既不执行，也不进 DOM
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('正文')
  })

  it('容器保留 wrap-anywhere：长串撑宽消息流的回归保护', async () => {
    const { container } = await render(<AnswerMarkdown content={'普通正文'} />)

    expect(container.firstElementChild?.className).toContain('wrap-anywhere')
  })

  it('空内容不渲染空容器', async () => {
    const { container } = await render(<AnswerMarkdown content='' />)

    expect(container.firstElementChild).toBeNull()
  })
})

/**
 * AI 回答正文的渲染层（AI 助手模块内的名字）。
 *
 * 元素映射与三条硬约束已移到 `src/components/markdown-content.tsx`：
 * 公告弹窗要渲染同一套 Markdown 排版，两边各留一份映射必然分叉。
 * 这里保留模块内的名字与调用点不变（`answer-card.tsx` / `chat-workbench.tsx` / 单测都还按这个名字引用），
 * 只是把它变成指向共享组件的一层薄转发。
 */
export { MarkdownContent as AnswerMarkdown } from '@/components/markdown-content'

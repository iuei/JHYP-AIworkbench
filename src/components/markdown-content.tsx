import { memo, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

/**
 * 全站 Markdown 正文的**统一渲染层**。
 *
 * 为什么要提到 `src/components/`：AI 回答正文（`features/ai-agent`）与公告弹窗
 * （`features/announcements`）渲染的是同一种内容 —— 人写的 Markdown。两边各写一份元素映射，
 * 分叉是必然的（今天改行距、明天改链接颜色，只改一处就会出现"同样是 Markdown，长得不一样"）。
 * 渲染规则只有一份，改这里两个调用方同时生效。
 *
 * 三条硬约束（改这个文件前先读）：
 * 1. **`wrap-anywhere` 不能去掉**：AI 对话中栏仍在 Radix ScrollArea 的 `display:table` 包装层里
 *    （`chat-workbench.tsx` 已改用原生滚动容器规避），任何含长 URL / 无空格长串（工具返回的
 *    JSON、ASIN、哈希）的文本都会按 min-content 撑宽整条消息流。`overflow-wrap` 是**继承**属性，
 *    所以放在容器上一次即可覆盖所有子元素 —— 不要改成 `break-words`，它不参与 min-content 计算。
 * 2. **不启用原始 HTML**：不加 `rehype-raw`。AI 正文里可能混入知识库检索片段的原文，
 *    公告正文也由管理员从别处粘贴而来，一旦允许 HTML 就等于给不可信内容开了注入面。
 * 3. **外链一律带 `rel="noopener noreferrer"`**：正文里可能出现外部 URL。
 *
 * 关于 `remark-breaks`：中文内容常用「每句一行」的软换行，Markdown 语义下会被合并成一整段。
 * 保留软换行既贴合用户预期，也让不守规范的文本退化成"接近原来的 whitespace-pre-wrap"，
 * 而不是把多行挤成一行。
 *
 * 表格元素是**兜底**而非主要载体：AI 的结构化数据走 `ai_messages.blocks`（指标 / 表格 / 趋势图），
 * 正文被明令禁止排表格（避免同一份数字展示两遍）。这里映射只是防止模型或管理员排了表格时
 * 用户看到一堆 `|`。
 */

const REMARK_PLUGINS = [remarkGfm, remarkBreaks]

const HEADING_BASE =
  'mt-4 mb-1.5 text-sm font-semibold text-foreground first:mt-0'

const COMPONENTS = {
  // 规范禁止一级标题；真收到时按卡片内的二级标题渲染，避免与页面 h1 抢大纲
  h1: ({ children }: { children?: ReactNode }) => (
    <h2 className={HEADING_BASE}>{children}</h2>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2 className={HEADING_BASE}>{children}</h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h3 className={HEADING_BASE}>{children}</h3>
  ),
  h4: ({ children }: { children?: ReactNode }) => (
    <h3 className={HEADING_BASE}>{children}</h3>
  ),
  h5: ({ children }: { children?: ReactNode }) => (
    <h3 className={HEADING_BASE}>{children}</h3>
  ),
  h6: ({ children }: { children?: ReactNode }) => (
    <h3 className={HEADING_BASE}>{children}</h3>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className='my-2 first:mt-0 last:mb-0'>{children}</p>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className='font-semibold text-foreground'>{children}</strong>
  ),
  em: ({ children }: { children?: ReactNode }) => (
    <em className='italic'>{children}</em>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className='my-2 list-disc space-y-1 pl-5 marker:text-muted-foreground'>
      {children}
    </ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className='my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground'>
      {children}
    </ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className='pl-0.5'>{children}</li>
  ),
  a: ({ children, href }: { children?: ReactNode; href?: string }) => (
    <a
      className='text-primary underline underline-offset-2 hover:no-underline'
      href={href}
      rel='noopener noreferrer'
      target='_blank'
    >
      {children}
    </a>
  ),
  code: ({ children }: { children?: ReactNode }) => (
    <code className='rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]'>
      {children}
    </code>
  ),
  // 块级代码由 pre 承担外观（后代选择器把行内样式在代码块内还原）
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className='my-2 overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit'>
      {children}
    </pre>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className='my-2 border-l-2 border-border pl-3 text-muted-foreground'>
      {children}
    </blockquote>
  ),
  hr: () => <hr className='my-3 border-border' />,
  // 表格兜底：真排了表格时，至少是一张可读的表，而不是一屏竖线
  table: ({ children }: { children?: ReactNode }) => (
    <div className='my-2 w-full overflow-x-auto'>
      <table className='w-full text-xs'>{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: ReactNode }) => (
    <thead className='border-b border-border'>{children}</thead>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className='px-2 py-1 text-left font-medium'>{children}</th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className='px-2 py-1 align-top'>{children}</td>
  ),
  img: ({ src, alt }: { src?: string; alt?: string }) => (
    <img
      alt={alt ?? ''}
      className='my-2 max-w-full rounded-md'
      src={src}
      // 正文里的图片不参与布局计算，避免加载后推动下方内容
      loading='lazy'
    />
  ),
}

type MarkdownContentProps = {
  content: string
  className?: string
}

function MarkdownContentBase({ content, className }: MarkdownContentProps) {
  if (!content) return null
  return (
    <div
      className={cn(
        'text-sm leading-relaxed wrap-anywhere text-foreground',
        className
      )}
    >
      <Markdown
        components={COMPONENTS}
        remarkPlugins={REMARK_PLUGINS}
        // 不加 rehype-raw：原始 HTML 一律不渲染（见文件头约束 2）
      >
        {content}
      </Markdown>
    </div>
  )
}

/**
 * `memo` 不是可选优化：AI 流式回答每个增量都会重渲染消息流，没有它整段正文会被反复重新解析。
 */
export const MarkdownContent = memo(MarkdownContentBase)

/**
 * Tiptap 编辑器的 Markdown 内容助手。
 *
 * `getMarkdown` 把当前文档读回字符串；`setContent` 把 markdown
 * 字符串喂进去。两者都很薄但容易出错——`@tiptap/markdown` 的 API
 * 在不同版本间有变动，回退链放在这里，让 `editor.ts` 专注于组装。
 * 从 `editor.ts`（体量过大）中拆出。
 */

import type { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { normalizeListContinuations } from './markdown-normalize'
import { extractBlockImages } from './markdown-structure'

export function getMarkdown(editor: Editor): string {
  const md = editor.getMarkdown()
  // CommonMark 序列化器会过度转义：正文中的 `[` `]` `_` 前都会加
  // 反斜杠（如 `\[` `\_`）。编辑器自己重新打开没问题（解析时反转
  // 义），但落盘字节与 Obsidian / GitHub 等工具不兼容，且反链 /
  // wikilink 补全的磁盘扫描会因 `\[\[` 失配，搜索 `EXTERNAL_LINE`
  // 这类词也会因 `\_` 失配。这里做保守的反转义：
  //   \[\[ → [[   \]\] → ]]   \_ → _   \\ → \(先行还原，放最后)
  // 代码块内容不含反斜杠转义序列，不受影响；若用户原本就想输入
  // 字面 `\_`，序列化产物是 `\\_`，反转义后恰为 `\_`，语义不变。
  return md
    .replace(/\\\\/g, '\u0000')
    .replace(/\\\[\\\[/g, '[[')
    .replace(/\\\]\\\]/g, ']]')
    .replace(/\\_/g, '_')
    .replace(/\u0000/g, '\\\\')
}

export function setContent(editor: Editor, markdown: string): void {
  // `@tiptap/markdown` v3 的 API 一直在
  // `editor.markdown.parse(md)` 与
  // `editor.storage.markdown.parser.parse(md)` 之间摇摆。先试文档
  // 中的形态，再回退到 storage 路径，最后落到 `commands.setContent`
  // ——编辑器会把它当 HTML 处理，虽不是 markdown 想要的结果，
  // 但至少不为空。
  try {
    // 解析前先修正列表续行的缩进，绕开 marked 在「懒续行」上会
    // 弄坏行内标记的缺陷。详见 `markdown-normalize.ts`。
    const normalized = normalizeListContinuations(markdown)
    // `??` 串联一串回退；`?:` 只在整个链条末尾作为最终的
    // `undefined` 兜底出现。用括号包住内层链，让优先级一目了然，
    // 也防止未来重构时不小心把链改成对 `editor.storage.markdown`
    // 的三元判断。
    const storageParser = (
      editor.storage as { markdown?: { parser?: { parse?: (md: string) => unknown } } }
    )?.markdown?.parser?.parse
    const parser =
      (editor.markdown as { parse?: (md: string) => unknown })?.parse
      ?? storageParser
    if (typeof parser === 'function') {
      const parsed = parser.call(
        (editor.storage as { markdown?: { parser?: unknown } })?.markdown?.parser
          ?? editor.markdown,
        normalized,
      )
      editor.commands.setContent(extractBlockImages(parsed as JSONContent))
      return
    }
  } catch (err) {
    // 落到下面的最后兜底路径。记日志是为了让缺失或被改名的解析器
    // 不会悄无声息地退化成 HTML 渲染。
    console.error('[editor] markdown parse failed, falling back:', err)
  }
  // 最后的兜底：把 markdown 字符串交给 `setContent`。Tiptap 会
  // 当作 HTML 解析——不对，但编辑器保持可用，用户可手动纠正。
  // 总比白屏好。
  console.warn('[editor] no markdown parser found; treating content as HTML')
  editor.commands.setContent(markdown)
}
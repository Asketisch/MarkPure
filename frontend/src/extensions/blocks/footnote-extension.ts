/**
 * 脚注引用 mark。
 *
 * 识别文档中的行内 `[^id]` 文本，渲染为带样式的
 * `<sup class="footnote-ref">` 角标。Markdown 往返无损：保存时
 * 编辑器保留字面 `[^id]` 文本，导出时 Rust 后端的
 * `markdown::to_html_with_diagrams_and_footnotes` 重新编号并
 * 加链接。
 *
 * mark 携带 `label` 属性（即 `id` 部分：`1`、`note-1`、行内用的
 * `i0` 等）。它**不需要**跟踪文档顺序编号——那在渲染时计算。
 *
 * 配套的块级定义（`[^id]: content`）故意保留为纯文本：
 * pulldown-cmark 的 `ENABLE_FOOTNOTES` 原生识别它，导出管线
 * 直接拾取，我们无需自定义 ProseMirror 节点。
 */
import { Mark, mergeAttributes, InputRule } from '@tiptap/core'

export interface FootnoteRefOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnoteRef: {
      setFootnoteRef: (label: string) => ReturnType
      unsetFootnoteRef: () => ReturnType
      insertFootnoteRef: (label?: string) => ReturnType
    }
  }
}

/// 匹配光标处完整 `[^id]` 引用的模式。供关闭 `]` 时触发的
/// 输入规则使用。
const FOOTNOTE_REF_INPUT_RE = /\[\^([^\[\]\s]+)\]$/

/// 扫描整段文本中 `[^id]` 出现的模式。供重新标记粘贴文本的
/// 粘贴规则使用。
const FOOTNOTE_REF_GLOBAL_RE = /\[\^([^\[\]\s]+)\]/g

let nextLabelCounter = 0
function nextAutoLabel(): string {
  // 简单的单调递增计数器；导出管线按文档顺序重新编号，因此
  // 磁盘上的标签在 markdown 重新生成之前只是装饰性的。
  nextLabelCounter += 1
  return String(nextLabelCounter)
}

export const FootnoteRefExtension = Mark.create<FootnoteRefOptions>({
  name: 'footnoteRef',

  addOptions() {
    return { HTMLAttributes: {} }
  },

  addAttributes() {
    return {
      label: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-label'),
        renderHTML: (attrs) => {
          if (!attrs.label) return {}
          return { 'data-label': attrs.label }
        },
      },
    }
  },

  parseHTML() {
    return [
      { tag: 'sup[data-footnoteref]' },
      // 也接受后端往返时输出的 `[^id]` 原始文本——这样用户把导出的
      // HTML 块粘贴回来时，编辑器→HTML→编辑器保持无损。
      { tag: 'sup.footnote-ref' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'sup',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-footnoteref': '',
        class: 'footnote-ref',
      }),
      0,
    ]
  },

  addCommands() {
    return {
      setFootnoteRef:
        (label) =>
        ({ commands }) =>
          commands.setMark(this.name, { label }),
      unsetFootnoteRef:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      insertFootnoteRef:
        (label) =>
        ({ chain }) => {
          const finalLabel = label ?? nextAutoLabel()
          return chain()
            .insertContent({
              type: 'text',
              text: `[^${finalLabel}]`,
              marks: [{ type: this.name, attrs: { label: finalLabel } }],
            })
            .run()
        },
    }
  },

  /// 用户输入闭合 `]` 时把 `[^N]` 转成带标记的脚注引用。
  /// 与 wikilink 输入规则对应。
  addInputRules() {
    return [
      new InputRule({
        find: FOOTNOTE_REF_INPUT_RE,
        handler: ({ range, match, chain }) => {
          const [, label] = match
          chain()
            .insertContentAt({ from: range.from, to: range.to }, [
              {
                type: 'text',
                text: `[^${label}]`,
                marks: [{ type: this.name, attrs: { label } }],
              },
            ])
            // 光标落在插入的引用之后。
            .setTextSelection(range.from + label.length + 3)
            .run()
        },
      }),
    ]
  },

  /// 重新标记粘贴的 `[^id]` 文本，避免它沦为纯文本。
  addPasteRules() {
    return [
      {
        find: FOOTNOTE_REF_GLOBAL_RE,
        handler: ({ range, match, chain }) => {
          const [, label] = match
          chain()
            .insertContentAt({ from: range.from, to: range.to }, [
              {
                type: 'text',
                text: `[^${label}]`,
                marks: [{ type: this.name, attrs: { label } }],
              },
            ])
            .run()
        },
      },
    ]
  },
})

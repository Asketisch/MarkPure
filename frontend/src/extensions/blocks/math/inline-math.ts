/**
 * InlineMath —— 行内数学公式节点（KaTeX 渲染）。
 *
 * 自 vendor 自 @tiptap/extension-mathematics 3.22（上游 MIT）。
 * 上游的 `$$..$$` 输入规则写作 `/(?<!\$)(\$\$...)(?!\$)/`——
 * lookbehind 正则字面量在 macOS 12 WKWebView 的**脚本解析期**抛
 * SyntaxError（`invalid group specifier name`），令整个应用白屏。
 * 这里改为无 lookbehind 的等价实现：匹配后再检查 `range.from` 前
 * 一个字符是否为 `$`，命中则放弃（语义与 lookbehind 相同）。
 */
// @ts-nocheck
// ^ vendor 自 @tiptap/extension-mathematics（JS 包，无精确类型）；
// 命令/输入规则的 tiptap 泛型签名在此无法严格对齐，豁免本文件类型检查。
import { Node, InputRule, mergeAttributes } from '@tiptap/core'
import katex from 'katex'

export const InlineMath = Node.create({
  name: 'inlineMath',
  group: 'inline',
  inline: true,
  atom: true,
  addOptions() {
    return {
      onClick: undefined,
      katexOptions: undefined,
    }
  },
  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-latex'),
        renderHTML: (attributes) => ({ 'data-latex': attributes.latex }),
      },
    }
  },
  addCommands() {
    return {
      insertInlineMath:
        (options: { latex: string; pos?: number }) =>
        ({ editor, tr }) => {
          const latex = options.latex
          const from = options?.pos ?? editor.state.selection.from
          if (!latex) return false
          tr.replaceWith(from, from, this.type.create({ latex }))
          return true
        },
      deleteInlineMath:
        (options?: { pos?: number }) =>
        ({ editor, tr }) => {
          const pos = options?.pos ?? editor.state.selection.$from.pos
          const node = editor.state.doc.nodeAt(pos)
          if (!node || node.type.name !== this.name) return false
          tr.delete(pos, pos + node.nodeSize)
          return true
        },
      updateInlineMath:
        (options?: { latex?: string; pos?: number }) =>
        ({ editor, tr }) => {
          const latex = options?.latex
          let pos = options?.pos
          if (pos === undefined) pos = editor.state.selection.$from.pos
          const node = editor.state.doc.nodeAt(pos)
          if (!node || node.type.name !== this.name) return false
          tr.setNodeMarkup(pos, this.type, { ...node.attrs, latex })
          return true
        },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-type="inline-math"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'inline-math' })]
  },
  parseMarkdown: (token: { latex: string }) => ({
    type: 'inlineMath',
    attrs: { latex: token.latex },
  }),
  renderMarkdown: (node) => `$${node.attrs?.latex || ''}$`,
  markdownTokenizer: {
    name: 'inlineMath',
    level: 'inline',
    start: (src) => src.indexOf('$'),
    tokenize: (src: string) => {
      const match = src.match(/^\$([^$]+)\$(?!\$)/)
      if (!match) return
      const [fullMatch, latex] = match
      return { type: 'inlineMath', raw: fullMatch, latex: latex.trim() }
    },
  },
  addInputRules() {
    return [
      new InputRule({
        // 无 lookbehind：`(?<!\$)` 的等价检查在 handler 内完成。
        find: /(\$\$([^$\n]+?)\$\$)(?!\$)/,
        handler: ({ state, range, match }) => {
          if (range.from > 0) {
            const before = state.doc.textBetween(range.from - 1, range.from)
            if (before === '$') return
          }
          const latex = match[2]
          const { tr } = state
          tr.replaceWith(range.from, range.to, this.type.create({ latex }))
        },
      }),
    ]
  },
  addNodeView() {
    const { katexOptions } = this.options
    return ({ node, getPos }) => {
      const wrapper = document.createElement('span')
      wrapper.className = 'tiptap-mathematics-render'
      if (this.editor.isEditable) wrapper.classList.add('tiptap-mathematics-render--editable')
      wrapper.dataset.type = 'inline-math'
      wrapper.setAttribute('data-latex', node.attrs.latex)
      function renderMath() {
        try {
          katex.render(node.attrs.latex, wrapper, katexOptions)
          wrapper.classList.remove('inline-math-error')
        } catch {
          wrapper.textContent = node.attrs.latex
          wrapper.classList.add('inline-math-error')
        }
      }
      const handleClick = (event) => {
        event.preventDefault()
        event.stopPropagation()
        const pos = getPos()
        if (pos == null) return
        if (this.options.onClick) this.options.onClick(node, pos)
      }
      if (this.options.onClick) wrapper.addEventListener('click', handleClick)
      renderMath()
      return {
        dom: wrapper,
        destroy() {
          wrapper.removeEventListener('click', handleClick)
        },
      }
    }
  },
})

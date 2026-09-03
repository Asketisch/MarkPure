/**
 * BlockMath —— 块级数学公式节点（KaTeX 渲染）。
 *
 * 自 vendor 自 @tiptap/extension-mathematics 3.22（上游 MIT）。
 * 为什么不直接 import 上游包：其 InlineMath 输入规则含 lookbehind
 * 正则字面量，macOS 12 WKWebView 在**脚本解析期**即抛 SyntaxError
 * 令整个应用白屏——正则字面量无法通过 extend 绕过（原函数体仍会
 * 被打进包并解析）。vendor 同时把该规则改为等价的无 lookbehind
 * 写法（见 `inline-math.ts` 中的注释）。
 */
// @ts-nocheck
// ^ vendor 自 @tiptap/extension-mathematics（JS 包，无精确类型）；
// 命令/输入规则的 tiptap 泛型签名在此无法严格对齐，豁免本文件类型检查。
import { Node, InputRule, mergeAttributes } from '@tiptap/core'
import katex from 'katex'

export const BlockMath = Node.create({
  name: 'blockMath',
  group: 'block',
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
      insertBlockMath:
        (options: { latex: string; pos?: number }) =>
        ({ commands, editor }) => {
          const { latex, pos } = options
          if (!latex) return false
          return commands.insertContentAt(pos ?? editor.state.selection.from, {
            type: this.name,
            attrs: { latex },
          })
        },
      deleteBlockMath:
        (options?: { pos?: number }) =>
        ({ editor, tr }) => {
          const pos = options?.pos ?? editor.state.selection.$from.pos
          const node = editor.state.doc.nodeAt(pos)
          if (!node || node.type.name !== this.name) return false
          tr.delete(pos, pos + node.nodeSize)
          return true
        },
      updateBlockMath:
        (options?: { latex?: string; pos?: number }) =>
        ({ editor, tr }) => {
          const latex = options?.latex
          let pos = options?.pos
          if (pos === undefined) pos = editor.state.selection.$from.pos
          const node = editor.state.doc.nodeAt(pos)
          if (!node || node.type.name !== this.name) return false
          tr.setNodeMarkup(pos, this.type, {
            ...node.attrs,
            latex: latex ?? node.attrs.latex,
          })
          return true
        },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-type="block-math"]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'block-math' })]
  },
  parseMarkdown: (token: { latex: string }) => ({
    type: 'blockMath',
    attrs: { latex: token.latex },
  }),
  renderMarkdown: (node) => ['$$', node.attrs?.latex || '', '$$'].join('\n'),
  markdownTokenizer: {
    name: 'blockMath',
    level: 'block',
    start: (src) => src.indexOf('$$'),
    tokenize: (src: string) => {
      const match = src.match(/^\$\$([^$]+)\$\$/)
      if (!match) return
      const [fullMatch, latex] = match
      return { type: 'blockMath', raw: fullMatch, latex: latex.trim() }
    },
  },
  addInputRules() {
    // 与上游一致的 `$$$latex$$$` 整段块公式规则；本身无 lookbehind。
    return [
      new InputRule({
        find: /^\$\$\$([^$]+)\$\$$/,
        handler: ({ state, range, match }) => {
          const [, latex] = match
          const { tr } = state
          const $from = state.doc.resolve(range.from)
          const node = this.type.create({ latex })
          const replacementRange =
            $from.depth > 0 &&
            $from.parent.isTextblock &&
            range.from === $from.start() &&
            range.to === $from.end() &&
            $from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), this.type)
              ? { from: $from.before(), to: $from.after() }
              : range
          tr.replaceWith(replacementRange.from, replacementRange.to, node)
        },
      }),
    ]
  },
  addNodeView() {
    const { katexOptions } = this.options
    return ({ node, getPos }) => {
      const wrapper = document.createElement('div')
      const innerWrapper = document.createElement('div')
      wrapper.className = 'tiptap-mathematics-render'
      if (this.editor.isEditable) wrapper.classList.add('tiptap-mathematics-render--editable')
      innerWrapper.className = 'block-math-inner'
      wrapper.dataset.type = 'block-math'
      wrapper.setAttribute('data-latex', node.attrs.latex)
      wrapper.appendChild(innerWrapper)
      function renderMath() {
        try {
          katex.render(node.attrs.latex, innerWrapper, katexOptions)
          wrapper.classList.remove('block-math-error')
        } catch {
          wrapper.textContent = node.attrs.latex
          wrapper.classList.add('block-math-error')
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

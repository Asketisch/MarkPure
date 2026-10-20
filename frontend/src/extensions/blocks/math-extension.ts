/**
 * 数学公式扩展（块级 `$$…$$` 与行内 `$…$`）。
 *
 * ## 为什么自己实现，而不是直接用 `@tiptap/extension-mathematics`
 *
 * 上游扩展**静态** `import katex from "katex"`。KaTeX 连同它的
 * CSS 约 280 KB，会被塞进首屏 bundle 并出现在 `index.html` 的
 * `modulepreload` 里——也就是说，**即使文档里一个公式都没有**，
 * 应用启动时也要下载并解析这 280 KB。
 *
 * 这里的实现把 KaTeX 改成**按需加载**：第一个公式出现时才
 * `import('katex')` 与 `import('katex/dist/katex.min.css')`。
 * 启动路径因此不再包含 KaTeX。
 *
 * 顺带修掉一个真实缺陷：上游扩展要求使用者自行引入 KaTeX 的
 * CSS，而本项目**从未引入**——公式因此以未排版的裸 HTML 呈现。
 * 现在 CSS 与 JS 一起按需加载，样式一定到位。
 *
 * 节点名、属性、命令与 Markdown 往返钩子与上游保持一致，
 * 因此已有文档的 `$$…$$` / `$…$` 行为不变。
 */
import { Extension, InputRule, Node, mergeAttributes } from '@tiptap/core'

/** KaTeX 的加载选项（与上游扩展的 `katexOptions` 同义）。 */
export interface KatexOptions {
  throwOnError?: boolean
  strict?: boolean
  [key: string]: unknown
}

type KatexModule = typeof import('katex')

let katexPromise: Promise<KatexModule> | null = null

/**
 * 按需加载 KaTeX（JS + CSS）。
 *
 * 同一个 promise 被所有公式节点共享——文档里有十个公式也只加载一次。
 */
function loadKatex(): Promise<KatexModule> {
  if (katexPromise) return katexPromise

  katexPromise = (async () => {
    // CSS 与 JS 一起加载：KaTeX 的排版完全依赖那张样式表，
    // 缺了它公式会显示成一堆未排版的标记。
    await import('katex/dist/katex.min.css')
    const mod = await import('katex')
    return (mod.default ?? mod) as KatexModule
  })().catch((err) => {
    console.error('[math] failed to load KaTeX:', err)
    katexPromise = null
    throw err
  })

  return katexPromise
}

/** 公式节点的公共选项。 */
interface MathOptions {
  katexOptions?: KatexOptions
  onClick?: (node: { attrs: { latex: string } }, pos: number) => void
}

/**
 * 渲染一个公式节点。
 *
 * KaTeX 是异步加载的，因此先写入原始 LaTeX 文本作为占位，
 * 加载完成后再替换为排版结果。视图销毁后不再写 DOM。
 */
function renderMathInto(
  wrapper: HTMLElement,
  latex: string,
  options: KatexOptions | undefined,
  errorClass: string,
  isAlive: () => boolean,
): void {
  void loadKatex()
    .then((katex) => {
      if (!isAlive()) return
      try {
        katex.render(latex, wrapper, options)
        wrapper.classList.remove(errorClass)
      } catch (err) {
        console.error('[math] KaTeX render failed:', err)
        wrapper.textContent = latex
        wrapper.classList.add(errorClass)
      }
    })
    .catch(() => {
      if (!isAlive()) return
      wrapper.textContent = latex
      wrapper.classList.add(errorClass)
    })
}

// ============================== 块级公式 ==============================

const BlockMath = Node.create<MathOptions>({
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
        (options: { latex?: string; pos?: number }) =>
        ({ commands, editor }: any) => {
          const { latex, pos } = options
          if (!latex) return false
          return commands.insertContentAt(pos != null ? pos : editor.state.selection.from, {
            type: this.name,
            attrs: { latex },
          })
        },
      deleteBlockMath:
        (options: { pos?: number } = {}) =>
        ({ editor, tr }: any) => {
          const pos = options.pos ?? editor.state.selection.$from.pos
          const node = editor.state.doc.nodeAt(pos)
          if (!node || node.type.name !== this.name) return false
          tr.delete(pos, pos + node.nodeSize)
          return true
        },
      updateBlockMath:
        (options: { latex?: string; pos?: number }) =>
        ({ editor, tr }: any) => {
          const pos = options.pos ?? editor.state.selection.$from.pos
          const node = editor.state.doc.nodeAt(pos)
          if (!node || node.type.name !== this.name) return false
          tr.setNodeMarkup(pos, this.type, { ...node.attrs, ...options })
          return true
        },
    } as never
  },

  parseHTML() {
    return [{ tag: 'div[data-type="block-math"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'block-math' })]
  },

  // ---- Markdown 往返钩子 ----
  //
  // **块级** `$$…$$` 必须有自己的 tokenizer。
  //
  // 只有行内 `$…$` 的 tokenizer 是不够的：marked 会先把
  // `$$…$$` 当成段落，再交给行内 tokenizer 处理其中的 `$`。
  // 行内正则 `^\$([^$]+)\$(?!\$)` 匹配不上以 `$$` 开头的
  // 段落（第二个 `$` 挡住了 `[^$]+`），tokenizer 返回 undefined
  // 后 marked 会反复尝试同一个位置——最终要么抛
  // “Infinite loop on byte”，要么把页面卡死。
  //
  // 有了块级 tokenizer，`$$…$$` 在块级就被完整消费掉，行内
  // tokenizer 根本看不到它。
  parseMarkdown: (token: any) => ({
    type: 'blockMath',
    attrs: { latex: token.latex },
  }),

  renderMarkdown: (node: any) => {
    const latex = node.attrs?.latex || ''
    return ['$$', latex, '$$'].join('\n')
  },

  markdownTokenizer: {
    name: 'blockMath',
    level: 'block',
    start: (src: string) => src.indexOf('$$'),
    tokenize: (src: string) => {
      const match = src.match(/^\$\$([^$]+)\$\$/)
      if (!match) return undefined
      const [fullMatch, latex] = match
      return {
        type: 'blockMath',
        raw: fullMatch,
        latex: latex.trim(),
      } as never
    },
  },
  // ---- 结束：Markdown 往返钩子 ----

  addInputRules() {
    return [
      new InputRule({
        find: /^\$\$([^$]+)\$\$$/,
        handler: ({ state, range, match }) => {
          const [, latex] = match
          const { tr } = state
          const $from = state.doc.resolve(range.from)
          const node = this.type.create({ latex })
          const consumesHostTextblock =
            $from.depth > 0 &&
            $from.parent.isTextblock &&
            range.from === $from.start() &&
            range.to === $from.end()
          const canReplaceHostTextblock =
            consumesHostTextblock &&
            $from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), this.type)
          const replacementRange = canReplaceHostTextblock
            ? { from: $from.before(), to: $from.after() }
            : range
          tr.replaceWith(replacementRange.from, replacementRange.to, node)
        },
      }),
    ]
  },

  addNodeView() {
    const { katexOptions } = this.options
    return ({ node, getPos }: any) => {
      const wrapper = document.createElement('div')
      const innerWrapper = document.createElement('div')
      wrapper.className = 'tiptap-mathematics-render'
      if (this.editor.isEditable) {
        wrapper.classList.add('tiptap-mathematics-render--editable')
      }
      innerWrapper.className = 'block-math-inner'
      wrapper.dataset.type = 'block-math'
      wrapper.setAttribute('data-latex', node.attrs.latex)
      wrapper.appendChild(innerWrapper)

      let alive = true
      const isAlive = () => alive

      const handleClick = (event: Event) => {
        event.preventDefault()
        event.stopPropagation()
        const pos = getPos()
        if (pos == null) return
        this.options.onClick?.(node, pos)
      }
      if (this.options.onClick) {
        wrapper.addEventListener('click', handleClick)
      }

      renderMathInto(innerWrapper, node.attrs.latex, katexOptions, 'block-math-error', isAlive)

      return {
        dom: wrapper,
        update: (updatedNode: any) => {
          if (updatedNode.type !== node.type) return false
          if (updatedNode.attrs.latex === node.attrs.latex) return true
          wrapper.setAttribute('data-latex', updatedNode.attrs.latex)
          innerWrapper.textContent = ''
          renderMathInto(
            innerWrapper,
            updatedNode.attrs.latex,
            katexOptions,
            'block-math-error',
            isAlive,
          )
          return true
        },
        // 公式渲染会改写节点自己的 DOM。必须告诉 ProseMirror 忽略
        // 这些变更，否则「DOM 变了 → 重绘 → DOM 又变了」会形成
        // 无限循环，页面直接卡死。
        ignoreMutation: () => true,
        destroy: () => {
          alive = false
          wrapper.removeEventListener('click', handleClick)
        },
      }
    }
  },
})

// ============================== 行内公式 ==============================

const InlineMath = Node.create<MathOptions>({
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
        (options: { latex?: string; pos?: number }) =>
        ({ editor, tr }: any) => {
          const latex = options.latex
          if (!latex) return false
          const from = options.pos ?? editor.state.selection.from
          tr.replaceWith(from, from, this.type.create({ latex }))
          return true
        },
      deleteInlineMath:
        (options: { pos?: number } = {}) =>
        ({ editor, tr }: any) => {
          const pos = options.pos ?? editor.state.selection.$from.pos
          const node = editor.state.doc.nodeAt(pos)
          if (!node || node.type.name !== this.name) return false
          tr.delete(pos, pos + node.nodeSize)
          return true
        },
      updateInlineMath:
        (options: { latex?: string; pos?: number }) =>
        ({ editor, tr }: any) => {
          const pos = options.pos ?? editor.state.selection.$from.pos
          const node = editor.state.doc.nodeAt(pos)
          if (!node || node.type.name !== this.name) return false
          tr.setNodeMarkup(pos, this.type, { ...node.attrs, ...options })
          return true
        },
    } as never
  },

  parseHTML() {
    return [{ tag: 'span[data-type="inline-math"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'inline-math' })]
  },

  // ---- Markdown 往返钩子 ----
  parseMarkdown: (token: any) => ({
    type: 'inlineMath',
    attrs: { latex: token.latex },
  }),

  renderMarkdown: (node: any) => {
    const latex = node.attrs?.latex || ''
    return `$${latex}$`
  },

  markdownTokenizer: {
    name: 'inlineMath',
    level: 'inline',
    start: (src: string) => src.indexOf('$'),
    tokenize: (src: string) => {
      const match = src.match(/^\$([^$]+)\$(?!\$)/)
      if (!match) return undefined
      const [fullMatch, latex] = match
      return {
        type: 'inlineMath',
        raw: fullMatch,
        latex: latex.trim(),
      } as never
    },
  },
  // ---- 结束：Markdown 往返钩子 ----

  addInputRules() {
    return [
      new InputRule({
        find: /(?<!\$)(\$\$([^$\n]+?)\$\$)(?!\$)/,
        handler: ({ state, range, match }) => {
          const latex = match[2]
          const { tr } = state
          tr.replaceWith(range.from, range.to, this.type.create({ latex }))
        },
      }),
    ]
  },

  addNodeView() {
    const { katexOptions } = this.options
    return ({ node, getPos }: any) => {
      const wrapper = document.createElement('span')
      wrapper.className = 'tiptap-mathematics-render'
      if (this.editor.isEditable) {
        wrapper.classList.add('tiptap-mathematics-render--editable')
      }
      wrapper.dataset.type = 'inline-math'
      wrapper.setAttribute('data-latex', node.attrs.latex)

      let alive = true
      const isAlive = () => alive

      const handleClick = (event: Event) => {
        event.preventDefault()
        event.stopPropagation()
        const pos = getPos()
        if (pos == null) return
        this.options.onClick?.(node, pos)
      }
      if (this.options.onClick) {
        wrapper.addEventListener('click', handleClick)
      }

      renderMathInto(wrapper, node.attrs.latex, katexOptions, 'inline-math-error', isAlive)

      return {
        dom: wrapper,
        update: (updatedNode: any) => {
          if (updatedNode.type !== node.type) return false
          if (updatedNode.attrs.latex === node.attrs.latex) return true
          wrapper.setAttribute('data-latex', updatedNode.attrs.latex)
          wrapper.textContent = ''
          renderMathInto(
            wrapper,
            updatedNode.attrs.latex,
            katexOptions,
            'inline-math-error',
            isAlive,
          )
          return true
        },
        // 见块级版本的说明：忽略公式渲染造成的 DOM 变更，
        // 否则会与 ProseMirror 形成无限重绘循环。
        ignoreMutation: () => true,
        destroy: () => {
          alive = false
          wrapper.removeEventListener('click', handleClick)
        },
      }
    }
  },
})

// ============================== 组合扩展 ==============================

export const MathExtension = Extension.create<{
  blockOptions?: Partial<MathOptions>
  inlineOptions?: Partial<MathOptions>
  katexOptions?: KatexOptions
}>({
  name: 'Mathematics',

  addOptions() {
    return {
      blockOptions: {},
      inlineOptions: {},
      katexOptions: undefined,
    }
  },

  addExtensions() {
    const katexOptions = { ...this.options.katexOptions }
    return [
      BlockMath.configure({ ...this.options.blockOptions, katexOptions }),
      InlineMath.configure({ ...this.options.inlineOptions, katexOptions }),
    ]
  },
})

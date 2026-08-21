/**
 * Mermaid 图表 —— 原生 ProseMirror NodeView。
 *
 * `@tiptap/core` v3 的 FOSS 构建没有附带 Svelte NodeViewRenderer，
 * 因此直接操作 DOM。视图通过动态导入 `mermaid` 库并调用
 * `mermaid.render(id, code)` 在客户端渲染图表。Rust 后端的
 * `mmdc` 路径不再用于编辑器预览（仍保留在导出管线中——见
 * `backend/crates/markdown/src/mermaid.rs`）。
 *
 * 若图表源码无效，`mermaid.render` 会抛错，此时回退为一段带样式
 * 的代码块，展示原始源码加错误信息。
 */
import { Node, mergeAttributes } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Mermaid 采用懒加载，避免约 500KB 的初始成本阻塞编辑器启动。
// 第一个渲染的 NodeView 触发动态导入；后续渲染等待同一个 promise。
let mermaidInitPromise: Promise<typeof import('mermaid').default> | null = null

async function getMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidInitPromise) {
    mermaidInitPromise = (async () => {
      const mod = await import('mermaid')
      const mermaid = mod.default
      mermaid.initialize({
        startOnLoad: false,
        // `strict`：渲染产物经 DOMPurify 净化，剥离 click 回调与
        // 内嵌脚本——编辑器会打开用户来源不可信的 .md 文件，
        // 图表里的 `<script>`/click handler 不得有机会执行。
        // 代价是图表内 click 跳转失效（可接受）。
        securityLevel: 'strict',
        theme: 'default',
      })
      return mermaid
    })()
  }
  return mermaidInitPromise
}

class MermaidNodeView {
  dom: HTMLElement
  contentDOM: HTMLElement | undefined = undefined
  private currentCode: string
  private pending = false
  private lastRendered = ''

  constructor(node: PMNode, _view: EditorView, _getPos: () => number | undefined) {
    this.currentCode = node.textContent
    this.dom = document.createElement('div')
    this.dom.className = 'mermaid-block'
    this.render()
  }

  update(node: PMNode): boolean {
    if (node.type.name !== 'mermaid') return false
    this.currentCode = node.textContent
    if (this.currentCode !== this.lastRendered) {
      this.render()
    }
    return true
  }

  selectNode() { this.dom.classList.add('ProseMirror-selectednode') }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode') }

  destroy() { /* 无需清理 */ }

  private render() {
    this.dom.innerHTML = ''
    const placeholder = document.createElement('div')
    placeholder.className = 'mermaid-loading'
    placeholder.textContent = 'Rendering diagram…'
    this.dom.appendChild(placeholder)
    void this.fetchAndPaint()
  }

  private async fetchAndPaint() {
    if (this.pending) return
    this.pending = true
    // 捕获本次渲染的目标代码：渲染是异步的，期间用户可能又改了
    // 代码——完成时若已过期则丢弃结果并按最新代码补渲染，
    // 否则画面会停留在旧代码（stale SVG）直到下一次编辑。
    const code = this.currentCode
    try {
      const mermaid = await getMermaid()
      // mermaid.render() 每次调用需要一个唯一的 DOM id，
      // 避免同一页面里并发渲染互相覆盖。
      const id = `mmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const { svg } = await mermaid.render(id, code)
      if (code !== this.currentCode) {
        this.pending = false
        this.render()
        return
      }
      this.lastRendered = code
      this.dom.innerHTML = ''
      const wrap = document.createElement('div')
      wrap.className = 'mermaid-svg'
      wrap.innerHTML = svg
      this.dom.appendChild(wrap)
      const details = document.createElement('details')
      details.className = 'mermaid-source'
      const sum = document.createElement('summary')
      sum.textContent = 'Source'
      const pre = document.createElement('pre')
      const codeEl = document.createElement('code')
      codeEl.textContent = code
      pre.appendChild(codeEl)
      details.appendChild(sum)
      details.appendChild(pre)
      this.dom.appendChild(details)
    } catch (e) {
      if (code !== this.currentCode) {
        this.pending = false
        this.render()
        return
      }
      // mermaid.render() 在语法错误时抛错。展示原始源码和错误
      // 信息，便于用户修复——与之前 `mmdc` 回退路径的体验一致。
      this.dom.innerHTML = ''
      const fb = document.createElement('div')
      fb.className = 'mermaid-fallback'
      const pre = document.createElement('pre')
      const codeEl = document.createElement('code')
      codeEl.textContent = code
      pre.appendChild(codeEl)
      fb.appendChild(pre)
      const err = document.createElement('div')
      err.className = 'mermaid-error'
      err.textContent = `Failed to render: ${e instanceof Error ? e.message : String(e)}`
      fb.appendChild(err)
      this.dom.appendChild(fb)
    } finally {
      this.pending = false
    }
  }
}

export const MermaidExtension = Node.create({
  name: 'mermaid',
  group: 'block',
  code: true,
  defining: true,
  marks: '',
  content: 'text*',

  parseHTML() {
    return [
      { tag: 'pre.mermaid', preserveContents: true },
      { tag: 'pre[data-language="mermaid"]', preserveContents: true },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['pre', mergeAttributes(HTMLAttributes, { class: 'mermaid' }), 0]
  },

  // ---- Markdown 往返钩子 ----
  // 独占一个 `mermaid` token 名，避免与内置的 CodeBlock 扩展竞争
  // （它已经通过 StarterKit 优先注册并处理 `code` token）。我们的
  // `markdownTokenizer` 只匹配 `` ```mermaid `` 围栏；其他围栏
  // 交回 marked 内置的 `code` tokenizer。
  markdownTokenName: 'mermaid',

  markdownTokenizer: {
    name: 'mermaid',
    level: 'block',
    start: (src: string) => {
      // 查找下一个位于行首的 ```mermaid 围栏。非 mermaid 围栏
      // 返回 -1，交给 marked 的 `code` tokenizer 处理。
      const re = /^[ \t]*```mermaid\b/m
      const m = re.exec(src)
      return m ? m.index : -1
    },
    tokenize: (src: string) => {
      // 匹配完整的 ```mermaid ... ``` 块。把主体（分组 1）捕获为
      // 结果 token 的 `text` 字段。
      const re = /^[ \t]*```mermaid[ \t]*\n([\s\S]*?)\n?[ \t]*```(?:[ \t]*$|\n)/m
      const m = re.exec(src)
      if (!m) return undefined
      return {
        type: 'mermaid',
        raw: m[0],
        text: m[1],
        lang: 'mermaid',
      } as never
    },
  },

  parseMarkdown: (token, helpers) => {
    const body = (token.text ?? '') as string
    return helpers.createNode(
      'mermaid',
      undefined,
      body ? [helpers.createTextNode(body)] : [],
    ) as never
  },

  renderMarkdown: (node, helpers) => {
    const body = helpers.renderChildren(node.content ?? []) as string
    return ['```mermaid', body, '```'].join('\n')
  },
  // ---- 结束：Markdown 往返钩子 ----

  addNodeView() {
    return (props) => {
      const nv = new MermaidNodeView(props.node, props.editor.view, props.getPos as () => number | undefined)
      return {
        dom: nv.dom,
        update: (n) => nv.update(n),
        selectNode: () => nv.selectNode(),
        deselectNode: () => nv.deselectNode(),
        destroy: () => nv.destroy(),
      }
    }
  },

  addCommands() {
    return {
      insertMermaid:
        (code = 'graph TD\n  A --> B') =>
        ({ commands }: { commands: { insertContent: (c: unknown) => boolean } }) => {
          return commands.insertContent({
            type: this.name,
            content: [{ type: 'text', text: code }],
          })
        },
    } as never
  },
})

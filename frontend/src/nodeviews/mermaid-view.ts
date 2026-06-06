/**
 * Mermaid diagram — vanilla ProseMirror NodeView.
 *
 * `@tiptap/core` v3 doesn't ship a Svelte NodeViewRenderer in
 * the FOSS build, so we manage the DOM directly. The view
 * delegates the actual rendering to the Rust backend
 * (`render_mermaid` IPC → `mmdc` CLI). When the CLI isn't
 * installed we fall back to a styled code block that exposes
 * the original source plus a one-line install hint.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { renderMermaid } from '$lib/editor/commands'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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

  destroy() { /* nothing to clean up */ }

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
    try {
      const result = await renderMermaid(this.currentCode)
      this.lastRendered = this.currentCode
      this.dom.innerHTML = ''
      if (result.svg) {
        const wrap = document.createElement('div')
        wrap.className = 'mermaid-svg'
        wrap.innerHTML = result.svg
        this.dom.appendChild(wrap)
        const details = document.createElement('details')
        details.className = 'mermaid-source'
        const sum = document.createElement('summary')
        sum.textContent = 'Source'
        const pre = document.createElement('pre')
        const code = document.createElement('code')
        code.textContent = this.currentCode
        pre.appendChild(code)
        details.appendChild(sum)
        details.appendChild(pre)
        this.dom.appendChild(details)
      } else {
        // Fallback: show the original code so the user can read
        // and edit it. The error string tells them how to
        // install the CLI.
        const fb = document.createElement('div')
        fb.className = 'mermaid-fallback'
        const pre = document.createElement('pre')
        const code = document.createElement('code')
        code.textContent = this.currentCode
        pre.appendChild(code)
        fb.appendChild(pre)
        if (result.error) {
          const err = document.createElement('div')
          err.className = 'mermaid-error'
          err.textContent = result.error
          fb.appendChild(err)
        }
        this.dom.appendChild(fb)
      }
    } catch (e) {
      this.dom.innerHTML = ''
      const err = document.createElement('div')
      err.className = 'mermaid-error'
      err.textContent = e instanceof Error ? e.message : String(e)
      this.dom.appendChild(err)
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

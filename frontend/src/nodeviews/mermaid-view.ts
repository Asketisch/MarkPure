/**
 * Mermaid diagram — vanilla ProseMirror NodeView.
 *
 * `@tiptap/core` v3 doesn't ship a Svelte NodeViewRenderer in
 * the FOSS build, so we manage the DOM directly. The view
 * renders the diagram client-side by dynamically importing the
 * `mermaid` library and calling `mermaid.render(id, code)`. The
 * Rust backend `mmdc` path is no longer used for the editor
 * preview (it remains in the export pipeline — see
 * `backend/crates/markdown/src/mermaid.rs`).
 *
 * If the diagram source is invalid, `mermaid.render` throws
 * and we fall back to a styled code block showing the original
 * source plus the error message.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Mermaid is loaded lazily so the ~500KB initial cost doesn't
// block editor startup. The first NodeView to render kicks off
// the dynamic import; subsequent renders await the same promise.
let mermaidInitPromise: Promise<typeof import('mermaid').default> | null = null

async function getMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidInitPromise) {
    mermaidInitPromise = (async () => {
      const mod = await import('mermaid')
      const mermaid = mod.default
      mermaid.initialize({
        startOnLoad: false,
        // `loose` keeps the parser forgiving of features the strict
        // mode would reject; this is the same default the upstream
        // Mermaid Live Editor uses.
        securityLevel: 'loose',
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
      const mermaid = await getMermaid()
      // mermaid.render() requires a unique DOM id per call to
      // avoid clobbering concurrent renders in the same page.
      const id = `mmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const { svg } = await mermaid.render(id, this.currentCode)
      this.lastRendered = this.currentCode
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
      const code = document.createElement('code')
      code.textContent = this.currentCode
      pre.appendChild(code)
      details.appendChild(sum)
      details.appendChild(pre)
      this.dom.appendChild(details)
    } catch (e) {
      // mermaid.render() throws on syntax errors. Show the
      // original source plus the error so the user can fix it
      // — same UX as the previous `mmdc` fallback path.
      this.dom.innerHTML = ''
      const fb = document.createElement('div')
      fb.className = 'mermaid-fallback'
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      code.textContent = this.currentCode
      pre.appendChild(code)
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

  // ---- Markdown round-trip hooks ----
  // We own a dedicated `mermaid` token name so we don't race with the
  // built-in CodeBlock extension (which already handles `code` tokens
  // and is registered first via StarterKit). Our `markdownTokenizer`
  // matches only `` ```mermaid `` fences; any other fence falls through
  // to marked's built-in `code` tokenizer.
  markdownTokenName: 'mermaid',

  markdownTokenizer: {
    name: 'mermaid',
    level: 'block',
    start: (src: string) => {
      // Look for the next ```mermaid fence at the start of a line.
      // Returning -1 for non-mermaid fences lets marked's `code`
      // tokenizer handle them.
      const re = /^[ \t]*```mermaid\b/m
      const m = re.exec(src)
      return m ? m.index : -1
    },
    tokenize: (src: string) => {
      // Match a complete ```mermaid ... ``` block. Captures the body
      // (group 1) for the `text` field of the resulting token.
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
  // ---- end markdown round-trip hooks ----

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

/**
 * TOC extension.
 *
 * A block-level node that represents a table of contents in the
 * document. The node is round-tripped through markdown as an HTML
 * comment (`<!-- TOC -->`) so that opening a markdown file written
 * outside MarkPure still surfaces the TOC block in the editor.
 *
 * The actual heading list is rendered by `TocNodeView` at runtime
 * by walking the editor's ProseMirror document — same approach as
 * the outline side panel.
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { TocNodeView } from '../../nodeviews/toc-view'

/// Markdown round-trip marker. We use the VSCode / markdown-all-in-one
/// convention so users hand-writing a TOC can opt in by typing
/// `<!-- TOC -->` on its own line.
const TOC_MARKER = '<!-- TOC -->'
const TOC_MARKER_RE = /^[ \t]*<!--\s*TOC\s*-->[ \t]*$/m

export const TocExtension = Node.create({
  name: 'toc',
  group: 'block',
  code: true,
  defining: true,
  marks: '',
  content: 'text*',
  atom: true,

  parseHTML() {
    return [
      { tag: 'div[data-type="toc"]' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toc', class: 'toc-block' })]
  },

  // ---- Markdown round-trip hooks ----
  // We own a dedicated `toc` token name so we don't race with any
  // block-level extension that might also process HTML comments.
  markdownTokenName: 'toc',

  markdownTokenizer: {
    name: 'toc',
    level: 'block',
    start: (src: string) => {
      const m = TOC_MARKER_RE.exec(src)
      return m ? m.index : -1
    },
    tokenize: (src: string) => {
      const m = TOC_MARKER_RE.exec(src)
      if (!m) return undefined
      return {
        type: 'toc',
        raw: m[0],
        text: '',
        lang: '',
      } as never
    },
  },

  parseMarkdown: (_token, helpers) => {
    return helpers.createNode('toc', undefined, []) as never
  },

  renderMarkdown: (_node, _helpers) => {
    return TOC_MARKER
  },
  // ---- end markdown round-trip hooks ----

  addNodeView() {
    return (props) => {
      const nv = new TocNodeView(props.node, props.editor, props.getPos as () => number | undefined)
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
      insertToc:
        () =>
        ({ commands }: { commands: { insertContent: (c: unknown) => boolean } }) => {
          return commands.insertContent({
            type: this.name,
            content: [],
          })
        },
    } as never
  },
})

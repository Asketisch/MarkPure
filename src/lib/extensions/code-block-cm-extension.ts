import { Node, mergeAttributes } from '@tiptap/core'
import { CodeBlockView } from '../nodeviews/code-block-view'

export const CodeBlockCMExtension = Node.create({
  name: 'codeBlock',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,

  addAttributes() {
    return {
      language: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-language') || el.querySelector('code')?.className?.replace('language-', '') || null,
        renderHTML: (attrs) => {
          if (!attrs.language) return {}
          return { 'data-language': attrs.language }
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: 'pre' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['pre', mergeAttributes(HTMLAttributes), ['code', 0]]
  },

  addNodeView() {
    return (props) => {
      const view = props.editor.view
      const getPos = props.getPos
      const nodeView = new CodeBlockView(props.node, view, getPos as () => number | undefined)
      return {
        dom: nodeView.dom,
        contentDOM: undefined,
        update: (node) => nodeView.update(node),
        selectNode: () => nodeView.selectNode(),
        deselectNode: () => nodeView.deselectNode(),
        stopEvent: (event) => nodeView.stopEvent(event),
        ignoreMutation: () => nodeView.ignoreMutation(),
        destroy: () => nodeView.destroy(),
      }
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-c': () => this.editor.commands.toggleNode(this.name, 'paragraph'),
      'Backspace': () => {
        const { empty, $anchor } = this.editor.state.selection
        if (!empty) return false
        const isCodeBlock = $anchor.parent.type.name === this.name
        if (!isCodeBlock) return false
        if ($anchor.parentOffset !== 0) return false
        return this.editor.commands.toggleNode(this.name, 'paragraph')
      },
    }
  },
})

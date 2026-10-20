import { Node, mergeAttributes } from '@tiptap/core'
import { CodeBlockView } from '../../nodeviews/code-block-view'

export const CodeBlockCMExtension = Node.create({
  name: 'codeBlock',
  // **必须声明 `group: 'block'`**（上游 `@tiptap/extension-code-block`
  // 也有）。没有它，codeBlock 就不是块级组的一员，无法作为文档的
  // 直接子节点——于是**任何含围栏代码块的文档都是非法文档**，
  // ProseMirror 会在每次事务里抛 “Called contentMatchAt on a node
  // with invalid content”，编辑器随之卡顿/异常。
  group: 'block',
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

  // ---- Markdown 往返钩子 ----
  //
  // **必需**：StarterKit 的内置 CodeBlock 在 `createEditor` 里被禁用
  // （`codeBlock: false`，因为我们用 CodeMirror 的 NodeView 取代
  // 它）。但 `@tiptap/markdown` 是靠扩展上的 `parseMarkdown` 钩子
  // 来处理 marked 的 `code` token 的——内置 CodeBlock 一旦禁用，就
  // **没有任何扩展**认领 `code` token，结果是围栏代码块在解析时被
  // 静默丢弃：文件里的代码块在编辑器里消失，保存后就被抹掉了。
  //
  // 下面的钩子与 `@tiptap/extension-code-block` 的实现等价。
  markdownTokenName: 'code',

  parseMarkdown: (token, helpers) => {
    // 只认真正的围栏代码块（``` 或 ~~~ 开头）。缩进式代码块不在
    // 我们的支持范围内，交给 marked 的默认行为处理。
    const raw = (token as { raw?: string }).raw ?? ''
    if (!raw.startsWith('```') && !raw.startsWith('~~~')) return []
    const text = (token as { text?: string }).text ?? ''
    const lang = (token as { lang?: string }).lang || null
    return helpers.createNode(
      'codeBlock',
      { language: lang },
      text ? [helpers.createTextNode(text)] : [],
    ) as never
  },

  renderMarkdown: (node, helpers) => {
    const language = (node.attrs as { language?: string | null })?.language || ''
    const body = helpers.renderChildren(node.content ?? []) as string
    return ['```' + language, body, '```'].join('\n')
  },
  // ---- 结束：Markdown 往返钩子 ----

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

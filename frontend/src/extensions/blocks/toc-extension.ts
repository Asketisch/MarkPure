/**
 * 目录（TOC）扩展。
 *
 * 一个块级节点，表示文档中的目录。该节点通过 HTML 注释
 * （`<!-- TOC -->`）与 Markdown 相互往返，因此用 MarkPure 之外
 * 的工具编写、且内含该注释的 Markdown 文件，打开后仍能在编辑器中
 * 显示出 TOC 块。
 *
 * 实际的标题列表由 `TocNodeView` 在运行时遍历编辑器的 ProseMirror
 * 文档渲染而成——与大纲侧边栏的实现方式一致。
 */
import { Node, mergeAttributes } from '@tiptap/core'
import { TocNodeView } from '../../nodeviews/toc-view'

/// Markdown 往返标记。沿用业界常见的写法，手写目录的用户
/// 只需在单独一行输入 `<!-- TOC -->` 即可启用自动目录。
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

  // ---- Markdown 往返钩子 ----
  // 独占一个 `toc` token 名，避免与其他同样处理 HTML 注释的
  // 块级扩展产生竞争。
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
  // ---- 结束：Markdown 往返钩子 ----

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

/**
 * YAML frontmatter 扩展。
 *
 * ## 为什么需要它
 *
 * Pandoc / Jekyll / Hugo 约定在文档开头用 `---` 围栏包一段 YAML。
 * 没有这个扩展时，`@tiptap/markdown` 会把它当成普通 Markdown 解析：
 * 起始的 `---` 变成水平线，中间的 `title: X` 变成段落，而结尾的
 * `---` 变成 **setext 二级标题的下划线**。结果是 frontmatter 在
 * 编辑器里显示为一堆杂乱的行，**保存时原文被彻底改写**——
 * 这是数据丢失级 bug。
 *
 * 本扩展把整块 frontmatter 收进一个 `frontmatter` 节点：
 *
 * - `markdownTokenizer` 只在**文档最开头**匹配 `---…---` 围栏，
 *   因此文档中间的 `---` 仍然是水平线（setext 标题照常工作）。
 * - `parseMarkdown` 把 YAML 正文放进节点的文本内容里，用户可以
 *   直接在编辑器里编辑。
 * - `renderMarkdown` 把它还原成 `---\n<yaml>\n---`，逐字节往返。
 */
import { Node, mergeAttributes } from '@tiptap/core'

/**
 * 匹配文档开头的 frontmatter 围栏。
 *
 * 捕获组 1 是 YAML 正文（不含两端的 `---` 行）。`\r\n` 行尾也被
 * 接受——文档内部统一存 LF，但外部文件可能是 CRLF。
 */
const FRONTMATTER_RE = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

export const FrontmatterExtension = Node.create({
  name: 'frontmatter',
  group: 'block',
  code: true,
  defining: true,
  marks: '',
  content: 'text*',

  parseHTML() {
    return [{ tag: 'div[data-type="frontmatter"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'frontmatter',
        class: 'frontmatter-block',
      }),
      ['pre', 0],
    ]
  },

  // ---- Markdown 往返钩子 ----
  //
  // 独占一个 `frontmatter` token 名——marked 没有同名 token，不会
  // 与其它扩展竞争。
  markdownTokenName: 'frontmatter',

  markdownTokenizer: {
    name: 'frontmatter',
    level: 'block',
    start: (src: string) => {
      // 只在源文本的**最开头**可能是 frontmatter。返回 -1 时
      // marked 完全跳过本扩展，后面的 `---` 走它自己的水平线 /
      // setext 标题规则。
      const m = FRONTMATTER_RE.exec(src)
      return m ? m.index : -1
    },
    tokenize: (src: string, tokens: unknown[]) => {
      // marked 在每个块位置都会尝试扩展的 tokenizer。文档中间的
      // `---`（水平线 / setext 下划线）必须留在 marked 的默认规则
      // 里，因此这里要求：到目前为止还没有解析出任何**内容**块
      // （只允许空白）。
      const onlyWhitespaceSoFar = (tokens ?? []).every(
        (t) => (t as { type?: string })?.type === 'space',
      )
      if (!onlyWhitespaceSoFar) return undefined

      const m = FRONTMATTER_RE.exec(src)
      if (!m) return undefined
      return {
        type: 'frontmatter',
        raw: m[0],
        text: m[1],
      } as never
    },
  },

  parseMarkdown: (token, helpers) => {
    const text = (token as { text?: string }).text ?? ''
    return helpers.createNode(
      'frontmatter',
      undefined,
      text ? [helpers.createTextNode(text)] : [],
    ) as never
  },

  renderMarkdown: (node, helpers) => {
    const body = helpers.renderChildren(node.content ?? []) as string
    return ['---', body, '---'].join('\n')
  },
  // ---- 结束：Markdown 往返钩子 ----

  addCommands() {
    return {
      insertFrontmatter:
        () =>
        ({ commands }: { commands: { insertContent: (c: unknown) => boolean } }) => {
          const template = 'title: \ndate: '
          return commands.insertContent({
            type: this.name,
            content: [{ type: 'text', text: template }],
          })
        },
    } as never
  },
})

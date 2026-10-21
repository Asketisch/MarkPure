/**
 * Markdown 解析后的**结构**修正。
 *
 * ## 为什么需要
 *
 * CommonMark 里图片是 **inline** 的（`文字 ![图](url) 文字` 是一个段落），
 * 而 Tiptap 的 Image 节点是**块级**的（`group: 'block'`）。marked 对
 * 「独占一行的图片」会把它提升为块级 token（顶层 image 节点，合法），
 * 但对「段落中间 / 表格单元格里的图片」保持 inline（落进 paragraph
 * 里）——而 paragraph 的 content 是 `inline*`，块级节点放进去就是
 * **非法文档**。
 *
 * 后果不是「显示不对」，而是**整篇文档打不开**：ProseMirror 抛
 * `Invalid content for node paragraph`，编辑器退化成把 markdown 当
 * HTML 渲染，用户看到的是一堆源码；再保存就把原文改写掉。
 *
 * ## 做法
 *
 * 在解析出的 JSON 上做一次结构提升：把「只允许 inline 的容器」
 * （paragraph / heading）里的 image 节点提取出来，变成它的兄弟节点。
 * 这样：
 *
 * - 独占一行的图片 —— marked 已经给出顶层块级 image，本就合法，不动；
 * - 段落中间的图片 —— 拆成 `段落` + `图片` + `段落`；
 * - 表格单元格里的图片 —— 单元格里补一个空段落 + 块级图片。
 *
 * 代价是**段落会被拆开**：保存时 `文字 ![图](url) 文字` 变成三段。
 * 这是必须的——图片在 Tiptap 里只能是块级。内容一字不丢。
 */

import type { JSONContent } from '@tiptap/core'

/** 图片节点的类型名。 */
const IMAGE_NODE = 'image'

/** 只允许 inline 内容的容器——image 在它们里面必须被提出来。 */
const INLINE_ONLY_CONTAINERS = new Set(['paragraph', 'heading'])

/** 表格单元格——它们的内容必须以段落开头。 */
const CELL_NODES = new Set(['tableCell', 'tableHeader'])

/**
 * 只允许**块**内容的容器——它们的 content 里不能直接放裸文本。
 *
 * marked 在解析「列表项之间的懒续行」时会把缩进的续行文本直接挂在
 * 列表项下（而不是包成段落），于是产出 `taskItem > [paragraph, text]`，
 * 而 taskItem 的 content 是 `paragraph block*` ——裸 text 放不进去，
 * 整篇文档变成非法。
 */
const BLOCK_CONTAINERS = new Set([
  'listItem',
  'taskItem',
  'tableCell',
  'tableHeader',
  'blockquote',
])

/**
 * 把段落 / 标题里的行内图片提升为块级兄弟节点。
 *
 * @param doc 解析出的文档 JSON
 * @returns 结构修正后的文档 JSON
 */
export function extractBlockImages(doc: JSONContent): JSONContent {
  const children = expandChildren(doc, false)
  return { ...doc, content: children }
}

/** 展开一个节点的子节点，返回可能因图片提升而变长的序列。 */
function expandChildren(node: JSONContent, inCell: boolean): JSONContent[] {
  const isCell = CELL_NODES.has(node.type ?? '')
  const out: JSONContent[] = []
  for (const child of node.content ?? []) {
    out.push(...expandNode(child, inCell))
  }
  // 单元格里若只剩下块级图片（没有段落开头），补一个空段落——
  // tableCell 的 content 是 `paragraph block*`，段落必须在前。
  if (isCell && out.length > 0 && out[0].type !== 'paragraph') {
    out.unshift({ type: 'paragraph', content: [] })
  }
  // 空引用（`> >` 单独一行）——blockquote 的 content 是 `block+`，
  // 至少要有一个块。补一个空段落让它合法。
  if (node.type === 'blockquote' && out.length === 0) {
    out.push({ type: 'paragraph', content: [] })
  }
  return out
}

/**
 * 拆分标题里多余的换行。
 *
 * marked 的 setext 标题（`段落\n---`）会把**整个多行段落**吞成标题
 * 内容——`title: x\ntags: y\n---` 变成一个内容为「title: x\ntags: y」的
 * 标题。CommonMark 只把**最后一行**当标题，前面的行仍是段落。
 *
 * 不还原的话，序列化会输出 `## title: x\ntags: y`——一个内容里带
 * 换行的 ATX 标题。它再解析回来就被拆成「标题 + 段落」，于是每次
 * 往返都会漂移一次。
 */
function splitHeadingLines(
  node: JSONContent,
  children: JSONContent[],
): JSONContent[] | null {
  // 只处理「一个纯文本节点」的标题内容——setext 标题吞多行时就是这个形状。
  if (children.length !== 1 || children[0].type !== 'text') return null
  const text = children[0].text ?? ''
  if (!text.includes('\n')) return null

  const marks = children[0].marks
  const lines = text.split('\n')
  const head = lines.shift() ?? ''
  if (!lines.some((l) => l.trim() !== '')) return null

  const out: JSONContent[] = [
    {
      type: node.type,
      ...(node.attrs ? { attrs: node.attrs } : {}),
      content: [{ type: 'text', text: head, ...(marks ? { marks } : {}) }],
    },
  ]
  for (const line of lines) {
    out.push({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line, ...(marks ? { marks } : {}) }] : [],
    })
  }
  return out
}

/** 把容器内容里的**裸文本**（无 mark 的 text 节点）包成段落。 */function wrapBareText(children: JSONContent[], nodeType: string): JSONContent[] {
  if (!BLOCK_CONTAINERS.has(nodeType)) return children
  const out: JSONContent[] = []
  let buf: JSONContent[] = []
  const flush = () => {
    if (buf.length) {
      out.push({ type: 'paragraph', content: buf })
      buf = []
    }
  }
  for (const child of children) {
    const isBareText = child.type === 'text' && !child.marks
    if (isBareText) {
      buf.push(child)
    } else {
      flush()
      out.push(child)
    }
  }
  flush()
  return out
}

/** 展开单个节点；若它是 inline-only 容器且含图片，则把图片提出来。 */
function expandNode(node: JSONContent, inCell: boolean): JSONContent[] {
  const isCell = CELL_NODES.has(node.type ?? '')
  const children = wrapBareText(expandChildren(node, isCell), node.type ?? '')

  const type = node.type ?? ''
  if (type === 'heading') {
    const split = splitHeadingLines(node, children)
    if (split) return split
  }
  if (!INLINE_ONLY_CONTAINERS.has(type) || !children.some((c) => c.type === IMAGE_NODE)) {
    return [{ ...node, content: children }]
  }

  // 把 image 从 inline 序列里摘出来：图片前后的 inline 内容各自成段。
  const out: JSONContent[] = []
  let buf: JSONContent[] = []
  const flush = () => {
    if (buf.length) out.push({ ...node, content: buf })
    buf = []
  }
  for (const child of children) {
    if (child.type === IMAGE_NODE) {
      flush()
      out.push(child)
    } else {
      buf.push(child)
    }
  }
  flush()

  // 整段只有一张图片时，段落被完全替换掉了。在单元格里这会丢掉
  // 「段落开头」的要求，因此补一个空段落。
  if (out.length === 1 && out[0].type === IMAGE_NODE && inCell) {
    out.unshift({ type: 'paragraph', content: [] })
  }
  return out
}

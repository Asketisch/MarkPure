/**
 * Markdown 预处理：修复列表续行的缩进。
 *
 * ## 为什么需要
 *
 * marked 在解析**列表项的续行**时有个陷阱：续行的缩进只要比列表项
 * 的内容缩进少、但又不是 0（也就是「懒续行」），行内的标记就会被
 * 弄坏——行内代码丢掉开头的反引号、`**粗体**` 变成斜体加一个孤零零
 * 的 `*`、`[链接](url)` 丢掉开头的 `[`。
 *
 * ```text
 * 1. 列表项 `a` 文本
 *  `code` 字段      ← 缩进 1 个空格：行内代码被弄坏
 * ```
 *
 * 缩进 0、2、3、4 个空格都没问题，**只有 1 个空格会坏**。
 *
 * 这是 marked / `@tiptap/markdown` 的上游问题，本模块在**解析之前**
 * 把这类续行重新缩进到列表项的内容缩进，绕开它。
 *
 * ## 安全性
 *
 * - 只改动「列表项的续行且缩进小于内容缩进」的行——而这些行本来
 *   就会被解析坏，所以改动它们不引入新的风险。
 * - 围栏代码块（``` / ~~~）内部原样不动。
 * - 缩进本来就是「排版」，修正后语义不变。
 */

/** 列表项标记：`-`、`*`、`+`、`1.`、`1)`。 */
const LIST_ITEM_RE = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)/

/** 围栏代码块的起止。 */
const FENCE_RE = /^\s*(```+|~~~+)/

/**
 * 修正列表续行的缩进。
 *
 * @param md 原始 markdown
 * @returns 缩进被修正过的 markdown
 */
export function normalizeListContinuations(md: string): string {
  if (!md.includes('\n')) return md

  const lines = md.split('\n')
  const out: string[] = []

  /** 当前列表项的内容缩进（列表标记之后的位置）；不在列表里时为 -1。 */
  let contentIndent = -1
  /** 当前是否位于围栏代码块内。 */
  let inFence = false
  /** 围栏的标记字符（``` 或 ~~~），用于判断闭合。 */
  let fenceMarker = ''

  for (const line of lines) {
    const fence = FENCE_RE.exec(line)
    if (fence) {
      const marker = fence[1][0]
      if (!inFence) {
        inFence = true
        fenceMarker = marker
      } else if (marker === fenceMarker) {
        inFence = false
        fenceMarker = ''
      }
      contentIndent = -1
      out.push(line)
      continue
    }

    if (inFence) {
      out.push(line)
      continue
    }

    const item = LIST_ITEM_RE.exec(line)
    if (item) {
      // 列表项本身：记录它的内容缩进 = 前导空白 + 标记 + 标记后的空白。
      contentIndent = item[1].length + item[2].length + item[3].length
      out.push(line)
      continue
    }

    if (contentIndent >= 0 && line.trim() !== '') {
      const indent = /^(\s*)/.exec(line)![1].length
      if (indent > 0 && indent < contentIndent) {
        // 懒续行：补齐到内容缩进，绕开 marked 的解析缺陷。
        out.push(' '.repeat(contentIndent) + line.slice(indent))
        continue
      }
      if (indent === 0) {
        // 顶格的非空行结束列表项。
        contentIndent = -1
      }
    }

    out.push(line)
  }

  return out.join('\n')
}

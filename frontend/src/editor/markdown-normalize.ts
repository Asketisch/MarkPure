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

  /**
   * 列表项**内容缩进**的栈（外层 → 内层）。
   *
   * 不能只记住最近一个列表项：缩进比最近列表项浅的行并不属于它，
   * 而是要向上回溯到真正包含它的那一层（CommonMark 的规则）。
   * 只记最近一个会把内容归到错误的列表项上——例如
   *
   * ```text
   * - [ ] A          ← 内容缩进 2
   *   - B            ← 内容缩进 4
   *
   *     - [ ] C      ← 内容缩进 6
   *
   *    缩进的文本     ← 缩进 3：属于 A（2），不属于 B / C
   * ```
   *
   * 这行若被归给 C，保存后就会变成 C 的续行——文档结构被改写。
   */
  const indentStack: number[] = []

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
      indentStack.length = 0
      out.push(line)
      continue
    }

    if (inFence) {
      out.push(line)
      continue
    }

    const item = LIST_ITEM_RE.exec(line)
    if (item) {
      // 列表项本身：它的内容缩进 = 前导空白 + 标记 + 标记后的空白。
      const thisIndent = item[1].length + item[2].length + item[3].length
      // 同层（或更外层）的列表项出现时，把比它更深的那几层弹出。
      while (
        indentStack.length > 0 &&
        indentStack[indentStack.length - 1] >= thisIndent
      ) {
        indentStack.pop()
      }
      indentStack.push(thisIndent)
      out.push(line)
      continue
    }

    if (line.trim() !== '') {
      const indent = /^(\s*)/.exec(line)![1].length
      if (indent === 0) {
        // 顶格的非空行结束所有列表项。
        indentStack.length = 0
        out.push(line)
        continue
      }
      // 找出**包含**该行的层级：栈中内容缩进 ≤ 本行缩进的最大那一层。
      //
      // - 找到了（owner ≥ 0）且 indent > owner → 该行是那一层的正常
      //   子内容（缩进够深），不需要动。
      // - 找到了且 indent < owner → 懒续行，补齐到 owner。
      // - 没找到（所有层都比它深）→ 按 marked 的懒续行行为归给最近的
      //   列表项（栈顶），补齐到栈顶——这保留了单层列表的原有行为。
      let owner = -1
      for (const ci of indentStack) {
        if (ci <= indent) owner = ci
      }
      if (owner < 0) {
        owner = indentStack.length > 0 ? indentStack[indentStack.length - 1] : -1
      }
      if (owner >= 0 && indent < owner) {
        // 懒续行：补齐到内容缩进，绕开 marked 的解析缺陷。
        out.push(' '.repeat(owner) + line.slice(indent))
        continue
      }
    }

    out.push(line)
  }

  return out.join('\n')
}
